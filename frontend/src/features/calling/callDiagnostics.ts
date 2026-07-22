/**
 * Dev-only WebRTC pipeline snapshots for Browser ↔ Electron call debugging.
 * Compare working vs broken sessions in the console ([CALL_PIPELINE]).
 */
import type { CallPeer } from "./webrtc";

export type PipelineSnapshot = {
  platform: "web" | "electron";
  ts: number;
  label: string;
  pc: {
    connectionState: RTCPeerConnectionState;
    iceConnectionState: RTCIceConnectionState;
    signalingState: RTCSignalingState;
  };
  mediaReady: boolean;
  polite: boolean;
  transceivers: Array<{
    mid: string | null;
    direction: RTCRtpTransceiverDirection;
    currentDirection: RTCRtpTransceiverDirection | null;
    sendTrack: string;
    recvTrack: string;
  }>;
  rtp: {
    outboundVideo: { framesSent: number; bytesSent: number; packetsSent: number };
    inboundVideo: { framesReceived: number; bytesReceived: number; packetsReceived: number };
  };
  remoteVideo: {
    trackId: string | null;
    readyState: MediaStreamTrackState | null;
    muted: boolean | null;
  };
};

function platformLabel(): "web" | "electron" {
  if (typeof navigator !== "undefined" && /Electron/i.test(navigator.userAgent)) return "electron";
  try {
    if ((window as unknown as { ninja?: unknown }).ninja) return "electron";
  } catch { /* */ }
  return "web";
}

async function readVideoRtp(
  stats: RTCStatsReport,
  direction: "outbound" | "inbound",
): Promise<{ frames: number; bytes: number; packets: number }> {
  let frames = 0;
  let bytes = 0;
  let packets = 0;
  const rtpType = direction === "outbound" ? "outbound-rtp" : "inbound-rtp";
  stats.forEach((r) => {
    const kind = (r as { kind?: string }).kind
      ?? (r as { mediaType?: string }).mediaType;
    if (r.type !== rtpType || kind !== "video") return;
    const row = r as {
      framesSent?: number;
      framesReceived?: number;
      bytesSent?: number;
      bytesReceived?: number;
      packetsSent?: number;
      packetsReceived?: number;
    };
    if (direction === "outbound") {
      frames = Math.max(frames, row.framesSent ?? 0);
      bytes = Math.max(bytes, row.bytesSent ?? 0);
      packets = Math.max(packets, row.packetsSent ?? 0);
    } else {
      frames = Math.max(frames, row.framesReceived ?? 0);
      bytes = Math.max(bytes, row.bytesReceived ?? 0);
      packets = Math.max(packets, row.packetsReceived ?? 0);
    }
  });
  return { frames, bytes, packets };
}

/** Collect a point-in-time snapshot of the media pipeline (dev console). */
export async function collectPipelineSnapshot(
  peer: CallPeer,
  label: string,
): Promise<PipelineSnapshot> {
  const pc = peer.pc;
  const stats = await pc.getStats();
  const out = await readVideoRtp(stats, "outbound");
  const inn = await readVideoRtp(stats, "inbound");
  const remoteId = peer.getRemoteVideoTrackId();
  const receivers = pc.getReceivers();
  const rv = receivers.find((r) => r.track?.kind === "video")?.track ?? null;

  return {
    platform: platformLabel(),
    ts: Date.now(),
    label,
    pc: {
      connectionState: pc.connectionState,
      iceConnectionState: pc.iceConnectionState,
      signalingState: pc.signalingState,
    },
    mediaReady: peer.isMediaReady(),
    polite: peer.isPolite(),
    transceivers: pc.getTransceivers().map((t) => ({
      mid: t.mid,
      direction: t.direction,
      currentDirection: t.currentDirection,
      sendTrack: t.sender.track?.kind ?? "null",
      recvTrack: t.receiver.track?.kind ?? "null",
    })),
    rtp: {
      outboundVideo: {
        framesSent: out.frames,
        bytesSent: out.bytes,
        packetsSent: out.packets,
      },
      inboundVideo: {
        framesReceived: inn.frames,
        bytesReceived: inn.bytes,
        packetsReceived: inn.packets,
      },
    },
    remoteVideo: {
      trackId: remoteId,
      readyState: rv?.readyState ?? null,
      muted: rv?.muted ?? null,
    },
  };
}

export function logPipelineSnapshot(peer: CallPeer | null, label: string) {
  if (!import.meta.env.DEV || !peer) return;
  void collectPipelineSnapshot(peer, label).then((snap) => {
    console.info("[CALL_PIPELINE]", label, snap);
  });
}
