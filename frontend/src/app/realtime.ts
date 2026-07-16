import { io, type Socket } from "socket.io-client";
import { getToken } from "./api";

let socket: Socket | null = null;
/** Persists across socket reconnects so CallProvider handlers stay registered after login. */
const listeners = new Map<string, Set<(data: unknown) => void>>();

function bindStoredListeners(s: Socket) {
  for (const [event, set] of listeners) {
    for (const handler of set) {
      s.off(event, handler);
      s.on(event, handler);
    }
  }
}

/**
 * Single shared socket. Handlers registered via `onRealtimeEvent` are stored in a Map
 * and (re)bound whenever a socket is created — do NOT clear the Map on disconnect.
 */
function ensureSocket(): Socket | null {
  const token = getToken();
  if (!token) {
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }
    return null;
  }

  if (socket) {
    socket.auth = { token };
    if (!socket.connected) socket.connect();
    return socket;
  }

  socket = io({
    path: "/socket.io",
    auth: { token },
    transports: ["websocket", "polling"],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    reconnectionDelayMax: 5000,
  });

  bindStoredListeners(socket);

  socket.on("connect_error", () => {
    /* auth / network — auto-retry via reconnection */
  });

  return socket;
}

/** Emit after the socket is connected (buffers until connect if needed). */
export function emitReliable(event: string, payload: unknown): boolean {
  const s = ensureSocket();
  if (!s) return false;
  if (s.connected) {
    s.emit(event, payload);
    return true;
  }
  s.once("connect", () => {
    s.emit(event, payload);
  });
  return true;
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
  // Keep `listeners` so CallProvider (always mounted) rebinds on next login.
}

export function onRealtimeEvent<T = unknown>(event: string, handler: (data: T) => void) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  const wrapped = handler as (data: unknown) => void;
  const set = listeners.get(event)!;
  if (set.has(wrapped)) {
    return () => {
      set.delete(wrapped);
      socket?.off(event, wrapped);
    };
  }
  set.add(wrapped);
  ensureSocket()?.on(event, wrapped);
  return () => {
    set.delete(wrapped);
    socket?.off(event, wrapped);
  };
}

export function emitTyping(conversationId: number, typing: boolean) {
  emitReliable("typing", { conversationId, typing });
}

export function joinConversation(convId: number) {
  emitReliable("join:conversation", convId);
}

export function emitCallInvite(payload: { conversationId: number; calleeId: number; type: "voice" | "video" }) {
  return emitReliable("call:invite", payload);
}

export function emitCallAccept(callId: string) {
  return emitReliable("call:accept", { callId });
}

export function emitCallDecline(callId: string) {
  return emitReliable("call:decline", { callId });
}

export function emitCallBusy(callId: string) {
  return emitReliable("call:busy", { callId });
}

export function emitCallIgnore(callId: string) {
  return emitReliable("call:ignore", { callId });
}

export function emitCallHangup(callId: string) {
  return emitReliable("call:hangup", { callId });
}

export function emitCallSignal(callId: string, signal: unknown) {
  return emitReliable("call:signal", { callId, signal });
}

export function emitCallMediaState(payload: {
  callId: string;
  micOn?: boolean;
  camOn?: boolean;
  screenSharing?: boolean;
}) {
  return emitReliable("call:media-state", payload);
}

export function onConversationNew(handler: (data: { conversationId: number }) => void) {
  return onRealtimeEvent("conversation:new", handler as (data: unknown) => void);
}

export function getRealtimeSocket() {
  return socket;
}
