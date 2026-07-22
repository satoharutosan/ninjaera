import type { Server as HttpServer } from "http";
import { Server, type Socket } from "socket.io";
import { qGet, qAll } from "../db/query.js";
import { verifyToken, getUserById } from "../middleware/auth.js";
import { isUserActive } from "../middleware/admin.js";
import {
  acceptCall,
  asUserId,
  assertCallParticipant,
  busyCall,
  cleanupUserCalls,
  declineCall,
  getCall,
  failCall,
  hangupCall,
  ignoreCall,
  insertMissedCallNotification,
  peerIdFor,
  setCallEndedHandler,
  startCall,
  type ActiveCall,
  type CallType,
} from "./calls.js";
import {
  acceptMonitor,
  assertMonitorParticipant,
  cleanupUserMonitors,
  endMonitor,
  peerIdForMonitor,
  startMonitor,
} from "./monitorSessions.js";
import {
  isInstallationOnline,
  registerDesktopEndpoint,
  unregisterDesktopEndpoint,
} from "./desktopEndpoints.js";
import { isSuperAdmin } from "./adminPermissions.js";
import {
  insertCallTimelineMessage,
  loadMessageRow,
  reasonToTimelineEvent,
  type CallTimelineEvent,
} from "./callMessages.js";
import { formatTime } from "../middleware/auth.js";
import { registerSocketConnection, unregisterSocketConnection, getPresencePayload } from "./presence.js";
import { assertCanAccessConversation, assertNotBlockedInConversation, usersAreBlocked } from "./conversationAccess.js";
import { allowSocketRate } from "../middleware/rateLimit.js";
import { invalidateAdminStatsCache } from "./adminStatsCache.js";

let io: Server | null = null;

const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

function userRoom(userId: number) {
  return `user:${asUserId(userId)}`;
}

function isUserSocketOnline(userId: number): boolean {
  const room = io?.sockets.adapter.rooms.get(userRoom(userId));
  return !!room && room.size > 0;
}

function formatCallMessageForViewer(raw: Record<string, unknown>, viewerId: number) {
  const userId = asUserId(raw.user_id);
  return {
    id: asUserId(raw.id),
    userId,
    user: raw.username as string,
    msg: raw.content as string,
    time: formatTime(raw.created_at as string),
    self: userId === asUserId(viewerId),
    avatarUrl: (raw.avatar_url as string | null) || undefined,
    mediaUrl: (raw.media_url as string | null) || undefined,
    mediaType: (raw.media_type as string | null) || undefined,
    fileName: (raw.file_name as string | null) || undefined,
    fileSize: raw.file_size != null ? Number(raw.file_size) : undefined,
    edited: !!raw.edited_at,
  };
}

async function publishCallTimeline(call: ActiveCall, event: CallTimelineEvent) {
  const inserted = await insertCallTimelineMessage(call, event);
  if (!inserted) {
    console.error(`[calls] failed to persist timeline event=${event} callId=${call.id}`);
    return;
  }
  const raw = await loadMessageRow(inserted.id);
  if (!raw) {
    console.error(`[calls] timeline message missing after insert id=${inserted.id}`);
    return;
  }
  const conversationId = asUserId(call.conversationId);
  await emitMessageToParticipants(conversationId, "message:new", (viewerId) => ({
    conversationId,
    message: formatCallMessageForViewer(raw, viewerId),
  }));
  await emitConversationUpdate(conversationId);
}

function convRoom(convId: number) {
  return `conv:${asUserId(convId)}`;
}

export async function getConversationParticipantIds(convId: number): Promise<number[]> {
  const rows = await qAll<{ user_id: number }>("SELECT user_id FROM conversation_participants WHERE conversation_id = ?", asUserId(convId));
  return rows.map(r => asUserId(r.user_id)).filter(Number.isFinite);
}

export function initRealtime(httpServer: HttpServer, corsOrigin: string) {
  const origins = corsOrigin.split(",").map((s) => s.trim()).filter(Boolean);
  io = new Server(httpServer, {
    cors: {
      origin: origins.length === 1 ? origins[0] : origins,
      credentials: true,
    },
    path: "/socket.io",
    maxHttpBufferSize: 1e5, // 100KB — signaling payloads only
  });

  setCallEndedHandler(async (call, reason, notifyMissed, wasActive) => {
    const payload = { callId: call.id, reason, type: call.type, conversationId: call.conversationId };
    emitToUser(call.callerId, "call:ended", payload);
    emitToUser(call.calleeId, "call:ended", payload);
    const event = reasonToTimelineEvent(reason, wasActive);
    if (event) await publishCallTimeline(call, event);
    if (notifyMissed) {
      await insertMissedCallNotification(call);
      emitToUser(call.calleeId, "notification:new", {});
      emitToUser(call.calleeId, "counts:update", {});
    }
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      next(new Error("Authentication required"));
      return;
    }
    try {
      const payload = verifyToken(token);
      const user = await getUserById(asUserId(payload.userId));
      if (!user || !isUserActive(user)) {
        next(new Error("Invalid user"));
        return;
      }
      const expected = Number((user as { token_version?: number }).token_version ?? 0) || 0;
      const got = Number(payload.tv ?? 0) || 0;
      if (got !== expected) {
        next(new Error("Invalid token"));
        return;
      }
      // Always numeric — Postgres may return BIGINT user ids as strings.
      socket.data.userId = asUserId(user.id);
      socket.data.username = user.username;
      socket.data.email = (user as { email?: string }).email || "";
      socket.data.isAdmin = (user as { is_admin?: number }).is_admin === 1;
      socket.data.isSuperAdmin = isSuperAdmin(user);
      socket.data.avatarUrl = (user as { avatar_url?: string | null }).avatar_url ?? null;
      next();
    } catch {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", async (socket: Socket) => {
    const userId = asUserId(socket.data.userId);
    const isAdmin = socket.data.isAdmin as boolean;

    socket.join(userRoom(userId));
    await registerSocketConnection(userId);

    const convIds = await qAll<{ conversation_id: number }>(
      "SELECT conversation_id FROM conversation_participants WHERE user_id = ?", userId,
    );
    for (const { conversation_id } of convIds) {
      const cid = asUserId(conversation_id);
      if (Number.isFinite(cid)) socket.join(convRoom(cid));
    }

    if (isAdmin) socket.join("admin");
    if (socket.data.isSuperAdmin) socket.join("super-admin");

    // Desktop endpoints announce their installation id so admins can see live status.
    socket.on("desktop:register", (data: { installationId?: string; appId?: string }) => {
      const ep = registerDesktopEndpoint({
        socketId: socket.id,
        userId,
        installationId: data?.installationId,
        appId: data?.appId,
      });
      if (!ep) return;
      emitToAdmins("installation:presence", {
        installationId: ep.installationId,
        userId: ep.userId,
        online: true,
        appId: ep.appId,
      });
    });

    socket.on("join:conversation", async (convId: number) => {
      const access = await assertCanAccessConversation(userId, Number(convId));
      if (!access.ok) return;
      const blocked = await assertNotBlockedInConversation(userId, Number(convId));
      if (!blocked.ok) return;
      socket.join(convRoom(Number(convId)));
    });

    socket.on("leave:conversation", (convId: number) => {
      socket.leave(convRoom(Number(convId)));
    });

    socket.on("typing", async (data: { conversationId: number; typing: boolean }) => {
      const { conversationId, typing } = data;
      if (!conversationId) return;
      if (!allowSocketRate(userId, "typing", 30, 10_000)) return;
      const access = await assertCanAccessConversation(userId, conversationId);
      if (!access.ok) return;
      const blocked = await assertNotBlockedInConversation(userId, conversationId);
      if (!blocked.ok) return;

      const key = `${conversationId}:${userId}`;
      if (typingTimers.has(key)) {
        clearTimeout(typingTimers.get(key)!);
        typingTimers.delete(key);
      }

      socket.to(convRoom(conversationId)).emit("typing", {
        conversationId,
        userId,
        username: socket.data.username,
        typing,
      });

      if (typing) {
        typingTimers.set(key, setTimeout(() => {
          typingTimers.delete(key);
          socket.to(convRoom(conversationId)).emit("typing", {
            conversationId,
            userId,
            username: socket.data.username,
            typing: false,
          });
        }, 3000));
      }
    });

    // ── WebRTC call signaling (1:1) ──────────────────────────────────────────
    socket.on("call:invite", async (data: { conversationId: number; calleeId: number; type: CallType }) => {
      if (!allowSocketRate(userId, "call:invite", 10, 60_000)) {
        socket.emit("call:error", { error: "Too many call attempts", code: "rate_limited" });
        return;
      }
      const type: CallType = data?.type === "video" ? "video" : "voice";
      const conversationId = Number(data?.conversationId);
      const calleeId = Number(data?.calleeId);
      if (!conversationId || !calleeId || !Number.isFinite(conversationId) || !Number.isFinite(calleeId)) {
        socket.emit("call:error", { error: "Invalid invite", code: "invalid" });
        return;
      }
      if (await usersAreBlocked(userId, calleeId)) {
        socket.emit("call:error", { error: "You cannot call this user", code: "blocked" });
        return;
      }
      if (!isUserSocketOnline(calleeId)) {
        socket.emit("call:error", { error: "User is offline", code: "offline" });
        return;
      }
      const presence = await getPresencePayload(calleeId);
      if (!presence?.online || presence.status !== "Online") {
        socket.emit("call:error", { error: "User is offline", code: "offline" });
        return;
      }
      const result = await startCall({ type, conversationId, callerId: userId, calleeId });
      if (!result.ok) {
        socket.emit("call:error", { error: result.error, code: result.code });
        return;
      }
      const call = result.call;
      const invite = {
        callId: call.id,
        type: call.type,
        conversationId: call.conversationId,
        callerId: userId,
        callerName: socket.data.username as string,
        callerAvatar: socket.data.avatarUrl as string | null,
      };
      socket.emit("call:ringing", invite);
      emitToUser(calleeId, "call:incoming", invite);
    });

    socket.on("call:accept", async (data: { callId: string }) => {
      const callId = String(data?.callId || "").trim();
      if (!callId) {
        socket.emit("call:error", { error: "Call failed", code: "invalid", callId: "" });
        return;
      }
      const result = acceptCall(callId, userId);
      if (!result.ok) {
        const existing = getCall(callId);
        const isCallee = !!existing && asUserId(existing.calleeId) === userId;
        // Legitimate callee failed while still ringing — end for both so caller isn't stuck.
        // Do not tear down the call if a non-participant hit this handler.
        if (isCallee && existing.state === "ringing") {
          await failCall(callId, userId).catch(() => {});
          // call:ended (reason=failed) clears both UIs; avoid a second error toast.
          return;
        }
        socket.emit("call:ended", {
          callId,
          reason: "failed",
          type: existing?.type,
          conversationId: existing?.conversationId,
        });
        socket.emit("call:error", {
          error: result.error || "Call failed",
          code: result.code || "accept_failed",
          callId,
        });
        return;
      }
      const call = result.call;
      const payload = {
        callId: call.id,
        type: call.type,
        conversationId: call.conversationId,
        accepterId: userId,
      };
      emitToUser(call.callerId, "call:accepted", payload);
      socket.emit("call:accepted", payload);
      await publishCallTimeline(call, "started");
    });

    socket.on("call:decline", async (data: { callId: string }) => {
      const callId = String(data?.callId || "").trim();
      if (!callId) {
        socket.emit("call:error", { error: "Call failed", code: "invalid" });
        return;
      }
      const existing = getCall(callId) || assertCallParticipant(callId, userId);
      if (!existing) {
        // Already ended — ack both sides so no modal stays open.
        socket.emit("call:declined", { callId, by: userId });
        socket.emit("call:ended", { callId, reason: "declined" });
        return;
      }
      const peerId = peerIdFor(existing, userId);
      const result = await declineCall(callId, userId);
      if (!result.ok) {
        emitToUser(existing.callerId, "call:ended", {
          callId, reason: "failed", type: existing.type, conversationId: existing.conversationId,
        });
        emitToUser(existing.calleeId, "call:ended", {
          callId, reason: "failed", type: existing.type, conversationId: existing.conversationId,
        });
        socket.emit("call:error", { error: result.error || "Call failed", code: result.code, callId });
        return;
      }
      // call:ended is emitted inside declineCall → endCallInternal.
      emitToUser(peerId, "call:declined", { callId, by: userId });
      socket.emit("call:declined", { callId, by: userId });
    });

    socket.on("call:busy", async (data: { callId: string }) => {
      const callId = String(data?.callId || "");
      const snapshot = assertCallParticipant(callId, userId);
      const result = await busyCall(callId, userId);
      if (!result.ok || !snapshot) {
        if (callId) {
          socket.emit("call:ended", { callId, reason: "busy" });
        }
        return;
      }
      const peerId = peerIdFor(snapshot, userId);
      emitToUser(peerId, "call:busy", { callId, by: userId });
      socket.emit("call:busy", { callId, by: userId });
    });

    /** Ignore ends the ring for both sides so the caller is never stuck. */
    socket.on("call:ignore", async (data: { callId: string }) => {
      const callId = String(data?.callId || "").trim();
      if (!callId) return;
      const result = await ignoreCall(callId, userId);
      if (!result.ok) {
        socket.emit("call:ended", { callId, reason: "declined" });
        socket.emit("call:ignored", { callId, by: userId });
        return;
      }
      const call = result.call;
      const peerId = peerIdFor(call, userId);
      // call:ended already broadcast via endCallInternal; also send declined for caller toast/UI.
      emitToUser(peerId, "call:declined", { callId, by: userId });
      socket.emit("call:ignored", { callId, conversationId: call.conversationId, by: userId });
      socket.emit("call:declined", { callId, by: userId });
    });

    socket.on("call:hangup", async (data: { callId: string }) => {
      const callId = String(data?.callId || "").trim();
      if (!callId) {
        socket.emit("call:ended", { callId: "", reason: "cancelled" });
        return;
      }
      const result = await hangupCall(callId, userId);
      if (!result.ok) {
        // Still clear local UI if the call is already gone.
        socket.emit("call:ended", { callId, reason: "ended" });
      }
    });

    socket.on("call:signal", (data: { callId: string; signal: unknown }) => {
      if (!allowSocketRate(userId, "call:signal", 400, 10_000)) return;
      const signal = data?.signal;
      if (!signal || typeof signal !== "object") return;
      // Cap serialized payload size to reduce abuse
      try {
        if (JSON.stringify(signal).length > 64_000) return;
      } catch {
        return;
      }
      const call = assertCallParticipant(String(data?.callId || ""), userId);
      if (!call) return;
      emitToUser(peerIdFor(call, userId), "call:signal", {
        callId: call.id,
        from: userId,
        signal,
      });
    });

    socket.on("call:media-state", (data: {
      callId: string;
      micOn?: boolean;
      camOn?: boolean;
      screenSharing?: boolean;
    }) => {
      const call = assertCallParticipant(String(data?.callId || ""), userId);
      if (!call || call.state !== "active") return;
      emitToUser(peerIdFor(call, userId), "call:media-state", {
        callId: call.id,
        from: userId,
        micOn: data.micOn,
        camOn: data.camOn,
        screenSharing: data.screenSharing,
      });
    });

    // ── Super-Admin desktop monitoring (screen view) ─────────────────────────
    socket.on("monitor:request", (data: { installationId?: string; targetUsername?: string }) => {
      if (!socket.data.isSuperAdmin) {
        socket.emit("monitor:error", { error: "Super Administrator access required", code: "forbidden" });
        return;
      }
      if (!allowSocketRate(userId, "monitor:request", 20, 60_000)) {
        socket.emit("monitor:error", { error: "Too many monitor attempts", code: "rate_limited" });
        return;
      }
      const installationId = String(data?.installationId || "").trim();
      const result = startMonitor({
        adminId: userId,
        adminUsername: String(socket.data.username || "admin"),
        installationId,
        targetUsername: data?.targetUsername,
      });
      if (!result.ok) {
        socket.emit("monitor:error", { error: result.error, code: result.code, installationId });
        return;
      }
      const session = result.session;
      socket.emit("monitor:ringing", {
        sessionId: session.id,
        installationId: session.installationId,
        targetUserId: session.targetUserId,
        targetUsername: session.targetUsername,
      });
      emitToUser(session.targetUserId, "monitor:incoming", {
        sessionId: session.id,
        installationId: session.installationId,
        adminId: session.adminId,
        adminUsername: session.adminUsername,
      });
    });

    socket.on("monitor:accept", (data: { sessionId?: string }) => {
      const sessionId = String(data?.sessionId || "").trim();
      const result = acceptMonitor(sessionId, userId);
      if (!result.ok) {
        socket.emit("monitor:error", { error: result.error, code: result.code, sessionId });
        if (result.code === "busy" && sessionId) {
          void endMonitor(sessionId, "busy").then((ended) => {
            if (!ended) return;
            emitToUser(ended.adminId, "monitor:busy", {
              sessionId: ended.id,
              reason: result.error,
            });
            emitToUser(ended.targetUserId, "monitor:ended", {
              sessionId: ended.id,
              reason: "busy",
            });
          });
        }
        return;
      }
      const session = result.session;
      const payload = {
        sessionId: session.id,
        installationId: session.installationId,
        targetUserId: session.targetUserId,
        adminId: session.adminId,
      };
      emitToUser(session.adminId, "monitor:accepted", payload);
      socket.emit("monitor:accepted", payload);
    });

    socket.on("monitor:reject", async (data: { sessionId?: string; reason?: string }) => {
      const sessionId = String(data?.sessionId || "").trim();
      const session = assertMonitorParticipant(sessionId, userId);
      if (!session) return;
      const code = data?.reason === "busy" ? "busy" : "rejected";
      const ended = await endMonitor(sessionId, code);
      if (!ended) return;
      emitToUser(ended.adminId, code === "busy" ? "monitor:busy" : "monitor:rejected", {
        sessionId: ended.id,
        reason: data?.reason || code,
      });
      emitToUser(ended.targetUserId, "monitor:ended", { sessionId: ended.id, reason: code });
    });

    socket.on("monitor:hangup", async (data: { sessionId?: string }) => {
      const sessionId = String(data?.sessionId || "").trim();
      const session = assertMonitorParticipant(sessionId, userId);
      if (!session) {
        if (sessionId) socket.emit("monitor:ended", { sessionId, reason: "ended" });
        return;
      }
      const ended = await endMonitor(sessionId, "completed");
      if (!ended) return;
      emitToUser(ended.adminId, "monitor:ended", { sessionId: ended.id, reason: "ended" });
      emitToUser(ended.targetUserId, "monitor:ended", { sessionId: ended.id, reason: "ended" });
    });

    socket.on("monitor:signal", (data: { sessionId?: string; signal?: unknown }) => {
      if (!allowSocketRate(userId, "monitor:signal", 400, 10_000)) return;
      const session = assertMonitorParticipant(String(data?.sessionId || ""), userId);
      if (!session || session.state !== "active") return;
      emitToUser(peerIdForMonitor(session, userId), "monitor:signal", {
        sessionId: session.id,
        signal: data.signal,
        from: userId,
      });
    });

    socket.on("disconnect", async () => {
      for (const key of typingTimers.keys()) {
        if (key.endsWith(`:${userId}`)) {
          clearTimeout(typingTimers.get(key)!);
          typingTimers.delete(key);
        }
      }
      const desktop = unregisterDesktopEndpoint(socket.id);
      if (desktop) {
        emitToAdmins("installation:presence", {
          installationId: desktop.installationId,
          userId: desktop.userId,
          online: isInstallationOnline(desktop.installationId),
          appId: desktop.appId,
        });
      }
      const { wasLast } = await unregisterSocketConnection(userId);
      // Only tear down calls/monitors when no tabs/devices remain for this user.
      if (wasLast) {
        await cleanupUserCalls(userId);
        await cleanupUserMonitors(userId);
      }
    });
  });

  return io;
}

export function emitToUser(userId: number, event: string, data: unknown) {
  const uid = asUserId(userId);
  if (!Number.isFinite(uid)) return;
  io?.to(userRoom(uid)).emit(event, data);
}

/** Force a user's sockets out of a conversation room (e.g. after private-channel revoke). */
export function forceLeaveConversation(userId: number, conversationId: number) {
  if (!io) return;
  const room = userRoom(userId);
  const sockets = io.sockets.adapter.rooms.get(room);
  if (!sockets) return;
  for (const sid of sockets) {
    const s = io.sockets.sockets.get(sid);
    s?.leave(convRoom(conversationId));
  }
  emitToUser(userId, "conversation:revoked", { conversationId });
}

export function forceLeaveConversationMany(userIds: number[], conversationId: number) {
  for (const uid of userIds) forceLeaveConversation(uid, conversationId);
}

export function emitToUsers(userIds: number[], event: string, data: unknown) {
  for (const id of userIds) emitToUser(id, event, data);
}

export function emitToConversation(convId: number, event: string, data: unknown, excludeUserId?: number) {
  if (excludeUserId) {
    io?.to(convRoom(convId)).except(userRoom(excludeUserId)).emit(event, data);
  } else {
    io?.to(convRoom(convId)).emit(event, data);
  }
}

export function emitToAdmins(event: string, data: unknown) {
  io?.to("admin").emit(event, data);
}

/** Coalesce high-frequency metric changes into at most one admin:stats pulse per window. */
let adminStatsTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleAdminStatsRefresh(delayMs = 750) {
  // Drop cached dashboard body immediately so the next /admin/stats refetch is authoritative.
  invalidateAdminStatsCache();
  if (adminStatsTimer) return;
  adminStatsTimer = setTimeout(() => {
    adminStatsTimer = null;
    emitToAdmins("admin:stats", {});
  }, delayMs);
}

export function broadcast(event: string, data: unknown) {
  io?.emit(event, data);
}

export async function emitMessageToParticipants(
  convId: number,
  event: string,
  buildPayload: (viewerUserId: number) => unknown,
) {
  const participantIds = await getConversationParticipantIds(convId);
  for (const pid of participantIds) {
    emitToUser(pid, event, buildPayload(pid));
  }
}

export async function emitConversationUpdate(convId: number) {
  const participantIds = await getConversationParticipantIds(convId);
  for (const pid of participantIds) {
    emitToUser(pid, "conversation:update", { conversationId: convId });
  }
}
