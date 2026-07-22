/**
 * Super-Admin → desktop endpoint screen-monitoring sessions.
 * Reuses Socket.IO signaling (monitor:signal) + existing WebRTC ICE servers.
 */
import { randomUUID } from "crypto";
import { qRun } from "../db/query.js";
import { asUserId, getUserCall } from "./calls.js";
import { getDesktopEndpoint, isInstallationOnline } from "./desktopEndpoints.js";

// Avoid realtime ↔ activityLog circular import at module load.

export type MonitorSession = {
  id: string;
  adminId: number;
  adminUsername: string;
  targetUserId: number;
  targetUsername: string;
  installationId: string;
  state: "ringing" | "active" | "ended";
  createdAt: number;
  startedAt: number | null;
  ringTimer?: ReturnType<typeof setTimeout>;
};

const RING_TIMEOUT_MS = 30_000;

const sessionsById = new Map<string, MonitorSession>();
const sessionByAdmin = new Map<number, string>();
const sessionByTarget = new Map<number, string>();

export function getMonitor(sessionId: string) {
  return sessionsById.get(sessionId);
}

export function getAdminMonitor(adminId: number) {
  const id = sessionByAdmin.get(asUserId(adminId));
  return id ? sessionsById.get(id) : undefined;
}

export function getTargetMonitor(userId: number) {
  const id = sessionByTarget.get(asUserId(userId));
  return id ? sessionsById.get(id) : undefined;
}

function clearMaps(session: MonitorSession) {
  sessionsById.delete(session.id);
  sessionByAdmin.delete(session.adminId);
  sessionByTarget.delete(session.targetUserId);
  if (session.ringTimer) {
    clearTimeout(session.ringTimer);
    session.ringTimer = undefined;
  }
}

async function persistMonitorLog(opts: {
  session: MonitorSession;
  result: "completed" | "disconnected" | "rejected" | "busy" | "timeout" | "failed";
  endedAt?: number;
}) {
  const { session, result } = opts;
  const endedAt = opts.endedAt ?? Date.now();
  const startMs = session.startedAt ?? session.createdAt;
  const durationSec = Math.max(0, Math.round((endedAt - startMs) / 1000));
  const startedIso = new Date(session.startedAt ?? session.createdAt).toISOString();
  const endedIso = new Date(endedAt).toISOString();

  try {
    await qRun(
      `INSERT INTO monitor_session_logs (
        session_id, admin_user_id, admin_username, target_user_id, target_username,
        installation_id, started_at, ended_at, duration_sec, result
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      session.id,
      session.adminId,
      session.adminUsername,
      session.targetUserId,
      session.targetUsername,
      session.installationId,
      startedIso,
      endedIso,
      durationSec,
      result,
    );
  } catch (err) {
    console.error("[monitor] failed to persist session log", err);
  }

  try {
    const { logActivitySync } = await import("./activityLog.js");
    logActivitySync({
      userId: session.adminId,
      username: session.adminUsername,
      userRole: "super_administrator",
      eventType: "monitor_session",
      eventCategory: "security",
      description: `Monitoring ${session.targetUsername} (${result}) — ${durationSec}s`,
      affectedObject: `installation:${session.installationId}`,
      result: result === "completed" || result === "disconnected" ? "success" : "failure",
      metadata: {
        sessionId: session.id,
        targetUserId: session.targetUserId,
        installationId: session.installationId,
        durationSec,
        result,
      },
    });
  } catch {
    /* ignore audit failures */
  }
}

export async function endMonitor(
  sessionId: string,
  result: "completed" | "disconnected" | "rejected" | "busy" | "timeout" | "failed" = "completed",
): Promise<MonitorSession | null> {
  const session = sessionsById.get(sessionId);
  if (!session || session.state === "ended") return session ?? null;
  session.state = "ended";
  clearMaps(session);
  await persistMonitorLog({ session, result });
  return session;
}

export function startMonitor(opts: {
  adminId: number;
  adminUsername: string;
  installationId: string;
  targetUsername?: string | null;
}): { ok: true; session: MonitorSession } | { ok: false; error: string; code: string } {
  const adminId = asUserId(opts.adminId);
  const installationId = String(opts.installationId || "").trim();
  if (!Number.isFinite(adminId) || !installationId) {
    return { ok: false, error: "Invalid monitor request", code: "invalid" };
  }

  const endpoint = getDesktopEndpoint(installationId);
  if (!endpoint || !isInstallationOnline(installationId)) {
    return { ok: false, error: "Endpoint is offline", code: "offline" };
  }

  const targetUserId = endpoint.userId;
  if (targetUserId === adminId) {
    return { ok: false, error: "Cannot monitor your own session", code: "invalid" };
  }

  if (getAdminMonitor(adminId)) {
    return { ok: false, error: "You already have an active monitoring session", code: "busy" };
  }
  if (getTargetMonitor(targetUserId)) {
    return { ok: false, error: "Endpoint is already being monitored", code: "busy" };
  }
  if (getUserCall(targetUserId)) {
    return { ok: false, error: "Endpoint is in an active call", code: "busy" };
  }
  if (getUserCall(adminId)) {
    return { ok: false, error: "Finish your call before monitoring", code: "busy" };
  }

  const session: MonitorSession = {
    id: randomUUID(),
    adminId,
    adminUsername: opts.adminUsername || "admin",
    targetUserId,
    targetUsername: (opts.targetUsername || "").trim() || `user-${targetUserId}`,
    installationId,
    state: "ringing",
    createdAt: Date.now(),
    startedAt: null,
  };

  session.ringTimer = setTimeout(() => {
    const cur = sessionsById.get(session.id);
    if (cur && cur.state === "ringing") {
      void endMonitor(session.id, "timeout");
    }
  }, RING_TIMEOUT_MS);

  sessionsById.set(session.id, session);
  sessionByAdmin.set(adminId, session.id);
  sessionByTarget.set(targetUserId, session.id);
  return { ok: true, session };
}

export function acceptMonitor(sessionId: string, targetUserId: number):
  | { ok: true; session: MonitorSession }
  | { ok: false; error: string; code: string } {
  const session = sessionsById.get(sessionId);
  if (!session) return { ok: false, error: "Session not found", code: "missing" };
  if (asUserId(session.targetUserId) !== asUserId(targetUserId)) {
    return { ok: false, error: "Not a participant", code: "forbidden" };
  }
  if (session.state !== "ringing") {
    return { ok: false, error: "Session is not awaiting accept", code: "invalid" };
  }
  if (getUserCall(targetUserId)) {
    return { ok: false, error: "Endpoint is in an active call", code: "busy" };
  }
  if (session.ringTimer) {
    clearTimeout(session.ringTimer);
    session.ringTimer = undefined;
  }
  session.state = "active";
  session.startedAt = Date.now();
  return { ok: true, session };
}

export function assertMonitorParticipant(sessionId: string, userId: number): MonitorSession | null {
  const session = sessionsById.get(sessionId);
  if (!session || session.state === "ended") return null;
  const uid = asUserId(userId);
  if (uid !== session.adminId && uid !== session.targetUserId) return null;
  return session;
}

export function peerIdForMonitor(session: MonitorSession, userId: number): number {
  return asUserId(userId) === session.adminId ? session.targetUserId : session.adminId;
}

/** Tear down monitor sessions involving this user (e.g. last socket left). */
export async function cleanupUserMonitors(userId: number) {
  const uid = asUserId(userId);
  const asAdmin = getAdminMonitor(uid);
  if (asAdmin) await endMonitor(asAdmin.id, "disconnected");
  const asTarget = getTargetMonitor(uid);
  if (asTarget) await endMonitor(asTarget.id, "disconnected");
}
