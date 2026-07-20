export type CallType = "voice" | "video";

export type CallInvite = {
  callId: string;
  type: CallType;
  conversationId: number;
  callerId: number;
  callerName: string;
  callerAvatar?: string | null;
};

export type CallPhase = "idle" | "outgoing" | "incoming" | "ignored" | "connecting" | "active";

export type VideoViewMode = "auto" | "camera" | "screen";

export type IceSignal =
  | { kind: "offer"; sdp: RTCSessionDescriptionInit }
  | { kind: "answer"; sdp: RTCSessionDescriptionInit }
  | { kind: "ice"; candidate: RTCIceCandidateInit };

/** Default STUN-only fallback — production should load TURN via /api/webrtc/ice-servers. */
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];
