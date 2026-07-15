import { db } from "../db/index.js";
import { broadcast, scheduleAdminStatsRefresh } from "./realtime.js";

const ONLINE_WINDOW_MS = 5 * 60 * 1000;
/** Skip redundant last_seen writes within this window (cuts SQLite write amp on free hosts). */
const TOUCH_THROTTLE_MS = 45_000;

const lastTouchWrite = new Map<number, number>();

export type PresencePayload = {
  userId: number;
  status: string;
  online: boolean;
  lastSeenAt: string | null;
};

function readStatus(userId: number): { status: string; is_online: number; last_seen_at: string | null } | undefined {
  return db.prepare("SELECT status, is_online, last_seen_at FROM users WHERE id = ?").get(userId) as
    | { status: string; is_online: number; last_seen_at: string | null }
    | undefined;
}

export function getPresencePayload(userId: number): PresencePayload | null {
  const row = readStatus(userId);
  if (!row) return null;
  const online = isUserOnline(row) && row.status !== "Offline";
  return {
    userId,
    status: online ? (row.status || "Online") : "Offline",
    online,
    lastSeenAt: row.last_seen_at,
  };
}

export function emitPresenceUpdate(userId: number) {
  const payload = getPresencePayload(userId);
  if (payload) broadcast("presence:update", payload);
  // Keep admin "Online Users" / overview in sync without flooding the bus.
  scheduleAdminStatsRefresh(1500);
}

export function touchPresence(userId: number) {
  const nowMs = Date.now();
  const last = lastTouchWrite.get(userId) ?? 0;
  if (nowMs - last < TOUCH_THROTTLE_MS) return;
  lastTouchWrite.set(userId, nowMs);

  const ts = new Date().toISOString();
  const row = readStatus(userId);
  // Don't force Online if user explicitly set Offline
  if (row?.status === "Offline") {
    db.prepare("UPDATE users SET last_seen_at = ?, updated_at = ? WHERE id = ?").run(ts, ts, userId);
  } else {
    db.prepare("UPDATE users SET is_online = 1, last_seen_at = ?, updated_at = ? WHERE id = ?").run(ts, ts, userId);
  }
}

export function setUserOnline(userId: number) {
  const ts = new Date().toISOString();
  db.prepare(`
    UPDATE users SET is_online = 1,
      status = CASE WHEN status = 'Offline' OR status IS NULL OR status = '' THEN 'Online' ELSE status END,
      last_seen_at = ?, updated_at = ? WHERE id = ?
  `).run(ts, ts, userId);
  emitPresenceUpdate(userId);
}

export function setUserOffline(userId: number) {
  const ts = new Date().toISOString();
  db.prepare("UPDATE users SET is_online = 0, status = 'Offline', last_seen_at = ?, updated_at = ? WHERE id = ?").run(ts, ts, userId);
  emitPresenceUpdate(userId);
}

export function setUserStatus(userId: number, status: string) {
  const ts = new Date().toISOString();
  const allowed = ["Online", "Away", "Do Not Disturb", "Offline"];
  const next = allowed.includes(status) ? status : "Online";
  if (next === "Offline") {
    db.prepare("UPDATE users SET status = ?, is_online = 0, last_seen_at = ?, updated_at = ? WHERE id = ?").run(next, ts, ts, userId);
  } else {
    db.prepare("UPDATE users SET status = ?, is_online = 1, last_seen_at = ?, updated_at = ? WHERE id = ?").run(next, ts, ts, userId);
  }
  emitPresenceUpdate(userId);
}

export function isUserOnline(row: { is_online?: number; last_seen_at?: string | null; status?: string }): boolean {
  if (row.status === "Offline") return false;
  if (row.is_online !== 1) return false;
  if (!row.last_seen_at) return false;
  return Date.now() - new Date(row.last_seen_at).getTime() < ONLINE_WINDOW_MS;
}
