import { io, type Socket } from "socket.io-client";
import { getToken } from "./api";
import { getNinja, type NinjaSocketStatus } from "../shared/electronBridge";

export type RealtimeStatus = NinjaSocketStatus;

let socket: Socket | null = null;
/** Persists across socket reconnects so CallProvider handlers stay registered after login. */
const listeners = new Map<string, Set<(data: unknown) => void>>();
const statusListeners = new Set<(status: RealtimeStatus) => void>();
const reconnectListeners = new Set<() => void>();

let webStatus: RealtimeStatus = "disconnected";
let webEverConnected = false;
let lifecycleBound = false;

function devLog(tag: string, message: string, extra?: unknown) {
  if (!import.meta.env.DEV) return;
  if (extra !== undefined) console.info(`[${tag}] ${message}`, extra);
  else console.info(`[${tag}] ${message}`);
}

function setWebStatus(next: RealtimeStatus) {
  if (webStatus === next) return;
  webStatus = next;
  for (const handler of statusListeners) {
    try {
      handler(next);
    } catch {
      /* isolate */
    }
  }
}

function notifyReconnect() {
  devLog("RECONNECT", "realtime restored — running sync handlers");
  for (const handler of reconnectListeners) {
    try {
      handler();
    } catch {
      /* isolate */
    }
  }
}

function bindStoredListeners(s: Socket) {
  for (const [event, set] of listeners) {
    for (const handler of set) {
      s.off(event, handler);
      s.on(event, handler);
    }
  }
}

function bindWebLifecycle(s: Socket) {
  if (lifecycleBound) return;
  lifecycleBound = true;

  s.on("connect", () => {
    const wasReconnect = webEverConnected;
    webEverConnected = true;
    setWebStatus("connected");
    devLog("SOCKET", wasReconnect ? "reconnected" : "connected");
    if (wasReconnect) notifyReconnect();
  });

  s.on("disconnect", (reason) => {
    setWebStatus("disconnected");
    devLog("SOCKET", `disconnected (${reason})`);
  });

  s.io.on("reconnect_attempt", (attempt) => {
    setWebStatus("reconnecting");
    const token = getToken();
    if (token) s.auth = { token };
    devLog("RECONNECT", `attempt #${attempt}`);
  });

  s.on("connect_error", (err) => {
    const msg = String((err as Error)?.message || err || "");
    devLog("SOCKET", `connect_error: ${msg}`);
    if (webEverConnected) setWebStatus("reconnecting");
    else setWebStatus("connecting");
  });
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
      socket.io.removeAllListeners();
      socket.disconnect();
      socket = null;
      lifecycleBound = false;
      webEverConnected = false;
      setWebStatus("disconnected");
    }
    return null;
  }

  if (socket) {
    socket.auth = { token };
    if (!socket.connected) {
      setWebStatus(webEverConnected ? "reconnecting" : "connecting");
      socket.connect();
    }
    return socket;
  }

  setWebStatus("connecting");
  socket = io({
    path: "/socket.io",
    auth: { token },
    transports: ["websocket", "polling"],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 15000,
    randomizationFactor: 0.5,
    timeout: 20000,
  });

  bindStoredListeners(socket);
  bindWebLifecycle(socket);

  return socket;
}

/** Emit after the socket is connected (buffers until connect if needed). */
export function emitReliable(event: string, payload: unknown): boolean {
  const ninja = getNinja();
  if (ninja) {
    ninja.socket.emit(event, payload);
    return true;
  }
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
  const ninja = getNinja();
  if (ninja) {
    ninja.socket.connect();
    return null;
  }
  return ensureSocket();
}

export function disconnectRealtime() {
  const ninja = getNinja();
  if (ninja) {
    ninja.socket.disconnect();
    return;
  }
  if (socket) {
    socket.removeAllListeners();
    socket.io.removeAllListeners();
    socket.disconnect();
    socket = null;
    lifecycleBound = false;
    webEverConnected = false;
    setWebStatus("disconnected");
  }
  // Keep `listeners` so CallProvider (always mounted) rebinds on next login.
}

export function onRealtimeEvent<T = unknown>(event: string, handler: (data: T) => void) {
  const ninja = getNinja();
  if (ninja) {
    // Desktop: subscribe through the main-process socket bridge (survives window hide).
    return ninja.socket.on(event, handler as (data: unknown) => void);
  }
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

/** Connection status for UI banners (desktop bridge or web Socket.IO). */
export function onRealtimeStatus(handler: (status: RealtimeStatus) => void): () => void {
  const ninja = getNinja();
  if (ninja) {
    return ninja.socket.onStatus(handler);
  }
  statusListeners.add(handler);
  try {
    handler(webStatus);
  } catch {
    /* isolate */
  }
  return () => {
    statusListeners.delete(handler);
  };
}

/**
 * Fires after a successful reconnect (not the initial connect).
 * Use to refetch conversations, catch up messages, and restore presence.
 */
export function onRealtimeReconnect(handler: () => void): () => void {
  const ninja = getNinja();
  if (ninja?.socket.onReconnected) {
    return ninja.socket.onReconnected(handler);
  }
  // Fallback: infer from status transitions when onReconnected is unavailable.
  if (ninja) {
    let prev: RealtimeStatus | null = null;
    let hadConnected = false;
    return ninja.socket.onStatus((s) => {
      if (s === "connected" && hadConnected && prev && prev !== "connected") {
        handler();
      }
      if (s === "connected") hadConnected = true;
      prev = s;
    });
  }
  reconnectListeners.add(handler);
  return () => {
    reconnectListeners.delete(handler);
  };
}

/** Browser / OS online events — nudge the socket without creating duplicates. */
export function nudgeRealtimeOnOnline(): void {
  if (typeof window === "undefined") return;
  if (!navigator.onLine) return;
  devLog("REALTIME", "navigator online — nudging socket");
  connectRealtime();
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
  // Always send plain JSON-safe objects. RTCSessionDescription / RTCIceCandidate
  // lose getter-backed fields when cloned across Electron IPC → empty SDP →
  // setRemoteDescription parse errors (Browser↔Electron only).
  return emitReliable("call:signal", { callId, signal: sanitizeCallSignal(signal) });
}

function sanitizeCallSignal(signal: unknown): unknown {
  if (!signal || typeof signal !== "object") return signal;
  const s = signal as {
    kind?: string;
    sdp?: { type?: RTCSdpType; sdp?: string } | null;
    candidate?: RTCIceCandidateInit | { toJSON?: () => RTCIceCandidateInit };
  };

  if (s.kind === "ice") {
    const c = s.candidate;
    if (c && typeof (c as { toJSON?: () => RTCIceCandidateInit }).toJSON === "function") {
      return { kind: "ice", candidate: (c as { toJSON: () => RTCIceCandidateInit }).toJSON() };
    }
    return { kind: "ice", candidate: c ?? null };
  }

  if (s.kind === "offer" || s.kind === "answer") {
    const type = s.sdp?.type;
    const sdp = typeof s.sdp?.sdp === "string" ? s.sdp.sdp : null;
    if (!type || !sdp || !sdp.includes("v=0")) {
      if (import.meta.env.DEV) {
        console.error("[CALL_SIGNAL] refuse emit — SDP not serializable", {
          kind: s.kind,
          type,
          sdpType: typeof s.sdp?.sdp,
          keys: s.sdp && typeof s.sdp === "object" ? Object.keys(s.sdp) : [],
        });
      }
      return signal;
    }
    return { kind: s.kind, sdp: { type, sdp } };
  }

  return signal;
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
