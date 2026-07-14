import { io, type Socket } from "socket.io-client";
import { getToken } from "./api";

let socket: Socket | null = null;
const listeners = new Map<string, Set<(data: unknown) => void>>();

function ensureSocket(): Socket | null {
  const token = getToken();
  if (!token) {
    disconnectRealtime();
    return null;
  }
  if (socket?.connected) return socket;
  if (socket) return socket;

  socket = io({
    path: "/socket.io",
    auth: { token },
    transports: ["websocket", "polling"],
    autoConnect: true,
  });

  socket.on("connect", () => {
    for (const [event, handlers] of listeners) {
      for (const handler of handlers) {
        socket?.on(event, handler);
      }
    }
  });

  socket.on("disconnect", () => {});

  return socket;
}

export function connectRealtime() {
  return ensureSocket();
}

export function disconnectRealtime() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  listeners.clear();
}

export function onRealtimeEvent<T = unknown>(event: string, handler: (data: T) => void) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  const wrapped = handler as (data: unknown) => void;
  listeners.get(event)!.add(wrapped);
  ensureSocket()?.on(event, wrapped);
  return () => {
    listeners.get(event)?.delete(wrapped);
    socket?.off(event, wrapped);
  };
}

export function emitTyping(conversationId: number, typing: boolean) {
  ensureSocket()?.emit("typing", { conversationId, typing });
}

export function joinConversation(convId: number) {
  ensureSocket()?.emit("join:conversation", convId);
}

export function onConversationNew(handler: (data: { conversationId: number }) => void) {
  return onRealtimeEvent("conversation:new", handler as (data: unknown) => void);
}
