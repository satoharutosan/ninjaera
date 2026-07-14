import type { Server as HttpServer } from "http";
import { Server, type Socket } from "socket.io";
import { db } from "../db/index.js";
import { verifyToken, getUserById } from "../middleware/auth.js";
import { isUserActive } from "../middleware/admin.js";

let io: Server | null = null;

const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

function userRoom(userId: number) {
  return `user:${userId}`;
}

function convRoom(convId: number) {
  return `conv:${convId}`;
}

export function getConversationParticipantIds(convId: number): number[] {
  return (db.prepare("SELECT user_id FROM conversation_participants WHERE conversation_id = ?").all(convId) as { user_id: number }[])
    .map(r => r.user_id);
}

export function initRealtime(httpServer: HttpServer, corsOrigin: string) {
  io = new Server(httpServer, {
    cors: { origin: corsOrigin, credentials: true },
    path: "/socket.io",
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      next(new Error("Authentication required"));
      return;
    }
    try {
      const payload = verifyToken(token);
      const user = getUserById(payload.userId);
      if (!user || !isUserActive(user)) {
        next(new Error("Invalid user"));
        return;
      }
      socket.data.userId = user.id;
      socket.data.username = user.username;
      socket.data.isAdmin = (user as { is_admin?: number }).is_admin === 1;
      next();
    } catch {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const userId = socket.data.userId as number;
    const isAdmin = socket.data.isAdmin as boolean;

    socket.join(userRoom(userId));

    const convIds = db.prepare(`
      SELECT conversation_id FROM conversation_participants WHERE user_id = ?
    `).all(userId) as { conversation_id: number }[];
    for (const { conversation_id } of convIds) {
      socket.join(convRoom(conversation_id));
    }

    if (isAdmin) socket.join("admin");

    socket.on("join:conversation", (convId: number) => {
      const participant = db.prepare(
        "SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?"
      ).get(convId, userId);
      if (participant) socket.join(convRoom(convId));
    });

    socket.on("typing", (data: { conversationId: number; typing: boolean }) => {
      const { conversationId, typing } = data;
      if (!conversationId) return;
      const participant = db.prepare(
        "SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?"
      ).get(conversationId, userId);
      if (!participant) return;

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

    socket.on("disconnect", () => {
      for (const key of typingTimers.keys()) {
        if (key.endsWith(`:${userId}`)) {
          clearTimeout(typingTimers.get(key)!);
          typingTimers.delete(key);
        }
      }
    });
  });

  return io;
}

export function emitToUser(userId: number, event: string, data: unknown) {
  io?.to(userRoom(userId)).emit(event, data);
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

export function broadcast(event: string, data: unknown) {
  io?.emit(event, data);
}

export function emitMessageToParticipants(
  convId: number,
  event: string,
  buildPayload: (viewerUserId: number) => unknown,
) {
  for (const pid of getConversationParticipantIds(convId)) {
    emitToUser(pid, event, buildPayload(pid));
  }
}

export function emitConversationUpdate(convId: number) {
  const participantIds = getConversationParticipantIds(convId);
  for (const pid of participantIds) {
    emitToUser(pid, "conversation:update", { conversationId: convId });
  }
}
