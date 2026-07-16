import { qGet, qRun } from "../db/query.js";
import { broadcast, scheduleAdminStatsRefresh } from "./realtime.js";

export const ONLINE_WINDOW_MS = 5 * 60 * 1000;
/** Skip redundant last_seen writes within this window (cuts SQLite write amp on free hosts). */
const TOUCH_THROTTLE_MS = 45_000;
/** Grace period after last socket leaves before marking offline (covers quick reconnect / refresh). */
const DISCONNECT_GRACE_MS = 4_000;

const lastTouchWrite = new Map<number, number>();
/** Live authenticated socket counts per user (unique online users ≠ connection count). */
const socketCounts = new Map<number, number>();
const disconnectTimers = new Map<number, ReturnType<typeof setTimeout>>();

export type PresencePayload = {
  userId: number;
  status: string;
  online: boolean;
  lastSeenAt: string | null;
};

async function readStatus(userId: number): Promise<{ status: string; is_online: number; last_seen_at: string | null } | undefined> {
  return qGet<{ status: string; is_online: number; last_seen_at: string | null }>(
    "SELECT status, is_online, last_seen_at FROM users WHERE id = ?", userId,
  );
}

export async function getPresencePayload(userId: number): Promise<PresencePayload | null> {
  const row = await readStatus(userId);
  if (!row) return null;
  const online = isUserOnline(row) && row.status !== "Offline";
  return {
    userId,
    status: online ? (row.status || "Online") : "Offline",
    online,
    lastSeenAt: row.last_seen_at,
  };
}

export async function emitPresenceUpdate(userId: number) {
  const payload = await getPresencePayload(userId);
  if (payload) broadcast("presence:update", payload);
  // Keep admin "Online Users" / overview in sync without flooding the bus.
  scheduleAdminStatsRefresh(1500);
}

export async function touchPresence(userId: number) {
  const nowMs = Date.now();
  const last = lastTouchWrite.get(userId) ?? 0;
  if (nowMs - last < TOUCH_THROTTLE_MS) return;
  lastTouchWrite.set(userId, nowMs);

  const ts = new Date().toISOString();
  const row = await readStatus(userId);
  // Don't force Online if user explicitly set Offline
  if (row?.status === "Offline") {
    await qRun("UPDATE users SET last_seen_at = ?, updated_at = ? WHERE id = ?", ts, ts, userId);
  } else {
    await qRun("UPDATE users SET is_online = 1, last_seen_at = ?, updated_at = ? WHERE id = ?", ts, ts, userId);
  }
}

export async function setUserOnline(userId: number) {
  const ts = new Date().toISOString();
  await qRun(`
    UPDATE users SET is_online = 1,
      status = CASE WHEN status = 'Offline' OR status IS NULL OR status = '' THEN 'Online' ELSE status END,
      last_seen_at = ?, updated_at = ? WHERE id = ?
  `, ts, ts, userId);
  await emitPresenceUpdate(userId);
}

export async function setUserOffline(userId: number) {
  cancelDisconnectGrace(userId);
  socketCounts.delete(userId);
  const ts = new Date().toISOString();
  await qRun("UPDATE users SET is_online = 0, status = 'Offline', last_seen_at = ?, updated_at = ? WHERE id = ?", ts, ts, userId);
  await emitPresenceUpdate(userId);
}

/** Clear live-online flag without forcing Away/DND → Offline (used on last socket disconnect). */
export async function clearLivePresence(userId: number) {
  const ts = new Date().toISOString();
  const row = await readStatus(userId);
  if (!row || row.is_online !== 1) {
    await emitPresenceUpdate(userId);
    return;
  }
  await qRun("UPDATE users SET is_online = 0, last_seen_at = ?, updated_at = ? WHERE id = ?", ts, ts, userId);
  await emitPresenceUpdate(userId);
}

export async function setUserStatus(userId: number, status: string) {
  const ts = new Date().toISOString();
  const allowed = ["Online", "Away", "Do Not Disturb", "Offline"];
  const next = allowed.includes(status) ? status : "Online";
  if (next === "Offline") {
    cancelDisconnectGrace(userId);
    socketCounts.delete(userId);
    await qRun("UPDATE users SET status = ?, is_online = 0, last_seen_at = ?, updated_at = ? WHERE id = ?", next, ts, ts, userId);
  } else {
    await qRun("UPDATE users SET status = ?, is_online = 1, last_seen_at = ?, updated_at = ? WHERE id = ?", next, ts, ts, userId);
  }
  await emitPresenceUpdate(userId);
}

export function isUserOnline(row: { is_online?: number; last_seen_at?: string | null; status?: string }): boolean {
  if (row.status === "Offline") return false;
  if (row.is_online !== 1) return false;
  if (!row.last_seen_at) return false;
  return Date.now() - new Date(row.last_seen_at).getTime() < ONLINE_WINDOW_MS;
}

/** ISO cutoff string matching ONLINE_WINDOW_MS — safe against SQLite datetime()/ISO lexicography bugs. */
export function onlineCutoffIso(): string {
  return new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
}

/** Unique authenticated users with at least one live Socket.IO session. */
export function countOnlineUsers(): number {
  return socketCounts.size;
}

/** DB-backed estimate (fallback / diagnostics). Prefer countOnlineUsers() for the dashboard. */
export async function countOnlineUsersFromDb(): Promise<number> {
  const cutoff = onlineCutoffIso();
  const row = await qGet<{ c: number }>(`
    SELECT COUNT(*) as c FROM users
    WHERE is_npc = 0 AND is_deleted = 0
      AND is_online = 1
      AND last_seen_at IS NOT NULL
      AND last_seen_at > ?
  `, cutoff);
  return row?.c ?? 0;
}

export function getSocketConnectionCount(userId: number): number {
  return socketCounts.get(userId) ?? 0;
}

function cancelDisconnectGrace(userId: number) {
  const t = disconnectTimers.get(userId);
  if (t) {
    clearTimeout(t);
    disconnectTimers.delete(userId);
  }
}

/**
 * Track an authenticated Socket.IO session. First connection marks the user online.
 * Multiple tabs/devices share one presence row (refcount).
 */
export async function registerSocketConnection(userId: number) {
  cancelDisconnectGrace(userId);
  const next = (socketCounts.get(userId) ?? 0) + 1;
  socketCounts.set(userId, next);
  if (next === 1) {
    const row = await readStatus(userId);
    // Respect explicit Offline preference until they change status / re-login.
    if (row?.status === "Offline") {
      await touchPresence(userId);
      await emitPresenceUpdate(userId);
    } else {
      await setUserOnline(userId);
    }
  } else {
    await touchPresence(userId);
  }
}

/**
 * Release one socket. When the last session disconnects, clear online after a short grace
 * so refresh/reconnect does not flicker the dashboard.
 */
export async function unregisterSocketConnection(userId: number): Promise<{ wasLast: boolean }> {
  const prev = socketCounts.get(userId) ?? 0;
  const next = Math.max(0, prev - 1);
  if (next === 0) socketCounts.delete(userId);
  else socketCounts.set(userId, next);

  if (next > 0) return { wasLast: false };

  cancelDisconnectGrace(userId);
  disconnectTimers.set(userId, setTimeout(() => {
    disconnectTimers.delete(userId);
    if ((socketCounts.get(userId) ?? 0) > 0) return;
    void clearLivePresence(userId);
  }, DISCONNECT_GRACE_MS));

  return { wasLast: true };
}
