import type { Server as HttpServer } from "http";
import { Server, type Socket } from "socket.io";
import { qGet, qAll } from "../db/query.js";
import { verifyToken, getUserById } from "../middleware/auth.js";
import { isUserActive } from "../middleware/admin.js";
import {
  acceptCall,
  assertCallParticipant,
  busyCall,
  cleanupUserCalls,
  declineCall,
  hangupCall,
  insertMissedCallNotification,
  peerIdFor,
  setCallEndedHandler,
  startCall,
  type ActiveCall,
  type CallType,
} from "./calls.js";
import {
  insertCallTimelineMessage,
  loadMessageRow,
  reasonToTimelineEvent,
  type CallTimelineEvent,
} from "./callMessages.js";
import { formatTime } from "../middleware/auth.js";
import { registerSocketConnection, unregisterSocketConnection } from "./presence.js";
import { assertCanAccessConversation, assertNotBlockedInConversation, usersAreBlocked } from "./conversationAccess.js";
import { allowSocketRate } from "../middleware/rateLimit.js";

let io: Server | null = null;

const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

function userRoom(userId: number) {
  return `user:${userId}`;
}

function isUserSocketOnline(userId: number): boolean {
  const room = io?.sockets.adapter.rooms.get(userRoom(userId));
  return !!room && room.size > 0;
}

function formatCallMessageForViewer(raw: Record<string, unknown>, viewerId: number) {
  return {
    id: raw.id as number,
    userId: raw.user_id as number,
    user: raw.username as string,
    msg: raw.content as string,
    time: formatTime(raw.created_at as string),
    self: (raw.user_id as number) === viewerId,
    avatarUrl: (raw.avatar_url as string | null) || undefined,
    mediaUrl: (raw.media_url as string | null) || undefined,
    mediaType: (raw.media_type as string | null) || undefined,
    fileName: (raw.file_name as string | null) || undefined,
    fileSize: (raw.file_size as number | null) || undefined,
    edited: !!raw.edited_at,
  };
}

async function publishCallTimeline(call: ActiveCall, event: CallTimelineEvent) {
  const inserted = await insertCallTimelineMessage(call, event);
  if (!inserted) return;
  const raw = await loadMessageRow(inserted.id);
  if (!raw) return;
  await emitMessageToParticipants(call.conversationId, "message:new", (viewerId) => ({
    conversationId: call.conversationId,
    message: formatCallMessageForViewer(raw, viewerId),
  }));
  await emitConversationUpdate(call.conversationId);
}

function convRoom(convId: number) {
  return `conv:${convId}`;
}

export async function getConversationParticipantIds(convId: number): Promise<number[]> {
  const rows = await qAll<{ user_id: number }>("SELECT user_id FROM conversation_participants WHERE conversation_id = ?", convId);
  return rows.map(r => r.user_id);
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
      const user = await getUserById(payload.userId);
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
      socket.data.userId = user.id;
      socket.data.username = user.username;
      socket.data.isAdmin = (user as { is_admin?: number }).is_admin === 1;
      socket.data.avatarUrl = (user as { avatar_url?: string | null }).avatar_url ?? null;
      next();
    } catch {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", async (socket: Socket) => {
    const userId = socket.data.userId as number;
    const isAdmin = socket.data.isAdmin as boolean;

    socket.join(userRoom(userId));
    await registerSocketConnection(userId);

    const convIds = await qAll<{ conversation_id: number }>(
      "SELECT conversation_id FROM conversation_participants WHERE user_id = ?", userId,
    );
    for (const { conversation_id } of convIds) {
      socket.join(convRoom(conversation_id));
    }

    if (isAdmin) socket.join("admin");

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
      const result = await acceptCall(String(data?.callId || ""), userId);
      if (!result.ok) {
        socket.emit("call:error", { error: result.error });
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
        socket.emit("call:error", { error: "Invalid call", code: "invalid" });
        return;
      }
      const call = assertCallParticipant(callId, userId);
      if (!call) {
        // Call already ended elsewhere — ack so the declining client UI stays consistent.
        socket.emit("call:declined", { callId, by: userId });
        return;
      }
      const peerId = peerIdFor(call, userId);
      const result = await declineCall(callId, userId);
      if (!result.ok) {
        socket.emit("call:error", { error: result.error || "Could not decline call" });
        return;
      }
      // call:ended is already emitted inside declineCall → endCallInternal.
      // Emit call:declined immediately so the caller closes the outgoing modal + toast.
      emitToUser(peerId, "call:declined", { callId, by: userId });
      socket.emit("call:declined", { callId, by: userId });
    });

    socket.on("call:busy", async (data: { callId: string }) => {
      const callId = String(data?.callId || "");
      const snapshot = assertCallParticipant(callId, userId);
      const result = await busyCall(callId, userId);
      if (!result.ok || !snapshot) return;
      const peerId = peerIdFor(snapshot, userId);
      emitToUser(peerId, "call:busy", { callId, by: userId });
      socket.emit("call:busy", { callId, by: userId });
    });

    /** Ignore = dismiss UI only; call keeps ringing. Ephemeral — not persisted. */
    socket.on("call:ignore", (data: { callId: string }) => {
      const callId = String(data?.callId || "");
      const call = assertCallParticipant(callId, userId);
      if (!call || call.state !== "ringing" || call.calleeId !== userId) return;
      emitToUser(userId, "call:ignored", { callId, conversationId: call.conversationId, by: userId });
    });

    socket.on("call:hangup", async (data: { callId: string }) => {
      await hangupCall(String(data?.callId || ""), userId);
    });

    socket.on("call:signal", (data: { callId: string; signal: unknown }) => {
      if (!allowSocketRate(userId, "call:signal", 120, 10_000)) return;
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
    socket.on("disconnect", async () => {
      for (const key of typingTimers.keys()) {
        if (key.endsWith(`:${userId}`)) {
          clearTimeout(typingTimers.get(key)!);
          typingTimers.delete(key);
        }
      }
      const { wasLast } = await unregisterSocketConnection(userId);
      // Only tear down calls when no tabs/devices remain for this user.
      if (wasLast) await cleanupUserCalls(userId);
    });
  });

  return io;
}

export function emitToUser(userId: number, event: string, data: unknown) {
  io?.to(userRoom(userId)).emit(event, data);
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
