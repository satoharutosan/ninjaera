/**
 * Desktop agent that auto-accepts Super-Admin monitoring requests and streams
 * the primary screen via WebRTC (reuses Socket.IO monitor:* signaling + ICE API).
 */
import { useEffect, useRef } from "react";
import { onRealtimeEvent, emitReliable, onRealtimeReconnect } from "@/app/realtime";
import { resolveIceServers } from "@/features/calling/iceConfig";
import { useCallOptional } from "@/features/calling/CallProvider";
import { getNinja, isDesktop } from "@/shared/electronBridge";
import { resolveInstallationId } from "@/shared/appInstallRegistration";

type MonitorIncoming = {
  sessionId: string;
  installationId: string;
  adminId: number;
  adminUsername: string;
};

type MonitorSignal = {
  sessionId: string;
  signal: RTCSessionDescriptionInit | RTCIceCandidateInit | { type: string };
  from: number;
};

function isBusy(call: ReturnType<typeof useCallOptional>): boolean {
  if (!call) return false;
  if (call.phase === "active" || call.phase === "connecting" || call.phase === "incoming" || call.phase === "outgoing") {
    return true;
  }
  if (call.screenSharing) return true;
  return false;
}

async function captureScreenSilent(): Promise<MediaStream> {
  const ninja = getNinja();
  try {
    await ninja?.displayMedia?.setSilent(true);
  } catch { /* */ }
  try {
    if (typeof navigator.mediaDevices?.getDisplayMedia !== "function") {
      throw new Error("getDisplayMedia unavailable");
    }
    return await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });
  } finally {
    try {
      await ninja?.displayMedia?.setSilent(false);
    } catch { /* */ }
  }
}

/**
 * Mount inside CallProvider on the desktop shell only.
 */
export function DesktopMonitorAgent() {
  const call = useCallOptional();
  const callRef = useRef(call);
  callRef.current = call;

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isDesktop()) return;

    const announce = () => {
      const installationId = resolveInstallationId("messenger");
      emitReliable("desktop:register", { installationId, appId: "messenger" });
    };

    announce();
    const unsubDesktopReconnect = getNinja()?.socket.onReconnected(() => announce());
    const unsubRealtimeReconnect = onRealtimeReconnect(() => announce());
    const unsubStatus = getNinja()?.socket.onStatus((s) => {
      if (s === "connected") announce();
    });

    return () => {
      unsubDesktopReconnect?.();
      unsubRealtimeReconnect();
      unsubStatus?.();
    };
  }, []);

  useEffect(() => {
    if (!isDesktop()) return;

    const cleanup = async (reason: string) => {
      if (import.meta.env.DEV) console.info("[MONITOR] cleanup", reason);
      const sid = sessionIdRef.current;
      sessionIdRef.current = null;
      try {
        pcRef.current?.close();
      } catch { /* */ }
      pcRef.current = null;
      streamRef.current?.getTracks().forEach((t) => {
        try { t.stop(); } catch { /* */ }
      });
      streamRef.current = null;
      try {
        await getNinja()?.displayMedia?.setSilent(false);
      } catch { /* */ }
      if (sid) emitReliable("monitor:hangup", { sessionId: sid });
    };

    const startSession = async (incoming: MonitorIncoming) => {
      if (sessionIdRef.current) {
        emitReliable("monitor:reject", { sessionId: incoming.sessionId, reason: "busy" });
        return;
      }
      if (isBusy(callRef.current)) {
        emitReliable("monitor:reject", { sessionId: incoming.sessionId, reason: "busy" });
        return;
      }

      sessionIdRef.current = incoming.sessionId;
      emitReliable("monitor:accept", { sessionId: incoming.sessionId });

      try {
        const stream = await captureScreenSilent();
        streamRef.current = stream;
        const iceServers = await resolveIceServers();
        const pc = new RTCPeerConnection({ iceServers });
        pcRef.current = pc;

        for (const track of stream.getTracks()) {
          pc.addTrack(track, stream);
          track.addEventListener("ended", () => {
            void cleanup("track-ended");
          });
        }

        pc.onicecandidate = (ev) => {
          if (!ev.candidate || !sessionIdRef.current) return;
          emitReliable("monitor:signal", {
            sessionId: sessionIdRef.current,
            signal: ev.candidate.toJSON(),
          });
        };

        pc.onconnectionstatechange = () => {
          const state = pc.connectionState;
          if (state === "failed" || state === "closed") {
            void cleanup(`pc-${state}`);
          }
        };

        const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
        await pc.setLocalDescription(offer);
        emitReliable("monitor:signal", {
          sessionId: incoming.sessionId,
          signal: pc.localDescription,
        });
      } catch (err) {
        if (import.meta.env.DEV) console.warn("[MONITOR] start failed", err);
        emitReliable("monitor:reject", { sessionId: incoming.sessionId, reason: "failed" });
        await cleanup("start-failed");
      }
    };

    const unsubs = [
      onRealtimeEvent<MonitorIncoming>("monitor:incoming", (data) => {
        void startSession(data);
      }),
      onRealtimeEvent<MonitorSignal>("monitor:signal", async (data) => {
        if (!data?.sessionId || data.sessionId !== sessionIdRef.current) return;
        const pc = pcRef.current;
        if (!pc) return;
        const signal = data.signal as RTCSessionDescriptionInit & RTCIceCandidateInit;
        try {
          if (signal.type === "answer") {
            await pc.setRemoteDescription(signal);
          } else if (signal.candidate) {
            await pc.addIceCandidate(signal);
          }
        } catch (err) {
          if (import.meta.env.DEV) console.warn("[MONITOR] signal error", err);
        }
      }),
      onRealtimeEvent<{ sessionId: string }>("monitor:ended", (data) => {
        if (data?.sessionId && data.sessionId === sessionIdRef.current) {
          void cleanup("remote-ended");
        }
      }),
    ];

    return () => {
      unsubs.forEach((u) => u());
      void cleanup("unmount");
    };
  }, []);

  return null;
}
