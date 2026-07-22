/**
 * Desktop agent that auto-accepts Super-Admin monitoring requests and streams
 * the primary screen via WebRTC (Socket.IO monitor:* signaling + ICE API).
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
  signal: RTCSessionDescriptionInit | RTCIceCandidateInit;
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

function sdpPayload(desc: RTCSessionDescription | RTCSessionDescriptionInit | null | undefined) {
  if (!desc?.type || !desc.sdp) return null;
  return { type: desc.type, sdp: desc.sdp };
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
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        // Prefer a stable full-desktop capture when the OS picker is suppressed.
        frameRate: { ideal: 15, max: 30 },
      } as MediaTrackConstraints,
      audio: false,
    });
    if (!stream.getVideoTracks().length) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error("No video track from display capture");
    }
    return stream;
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
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteSetRef = useRef(false);

  useEffect(() => {
    if (!isDesktop()) return;

    const announce = () => {
      const installationId = resolveInstallationId("messenger");
      if (import.meta.env.DEV) {
        console.info("[MONITOR] desktop:register", { installationId });
      }
      emitReliable("desktop:register", {
        installationId,
        appId: "messenger",
        capabilities: { monitoring: true, webrtc: true },
      });
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

    const flushCandidates = async (pc: RTCPeerConnection) => {
      const queued = pendingCandidatesRef.current.splice(0, pendingCandidatesRef.current.length);
      for (const c of queued) {
        try {
          await pc.addIceCandidate(c);
        } catch (err) {
          if (import.meta.env.DEV) console.warn("[MONITOR] addIceCandidate failed", err);
        }
      }
    };

    const cleanup = async (reason: string, hangup = true) => {
      if (import.meta.env.DEV) console.info("[MONITOR] cleanup", reason);
      const sid = sessionIdRef.current;
      if (hangup) sessionIdRef.current = null;
      remoteSetRef.current = false;
      pendingCandidatesRef.current = [];
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
      if (hangup && sid) emitReliable("monitor:hangup", { sessionId: sid });
    };

    const startSession = async (incoming: MonitorIncoming) => {
      if (import.meta.env.DEV) {
        console.info("[MONITOR] incoming request", incoming);
      }
      if (sessionIdRef.current) {
        if (import.meta.env.DEV) console.info("[MONITOR] reject — already monitoring");
        emitReliable("monitor:reject", { sessionId: incoming.sessionId, reason: "busy" });
        return;
      }
      if (isBusy(callRef.current)) {
        if (import.meta.env.DEV) {
          console.info("[MONITOR] reject — busy", {
            phase: callRef.current?.phase,
            screenSharing: callRef.current?.screenSharing,
          });
        }
        emitReliable("monitor:reject", { sessionId: incoming.sessionId, reason: "busy" });
        return;
      }

      sessionIdRef.current = incoming.sessionId;
      remoteSetRef.current = false;
      pendingCandidatesRef.current = [];
      emitReliable("monitor:accept", { sessionId: incoming.sessionId });
      if (import.meta.env.DEV) console.info("[MONITOR] accepted", incoming.sessionId);

      try {
        const stream = await captureScreenSilent();
        if (sessionIdRef.current !== incoming.sessionId) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const iceServers = await resolveIceServers();
        const pc = new RTCPeerConnection({ iceServers });
        pcRef.current = pc;

        for (const track of stream.getVideoTracks()) {
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
          if (import.meta.env.DEV) console.info("[MONITOR] pc state", state);
          if (state === "failed" || state === "closed") {
            void cleanup(`pc-${state}`);
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const payload = sdpPayload(pc.localDescription);
        if (!payload) throw new Error("Failed to create offer SDP");

        emitReliable("monitor:signal", {
          sessionId: incoming.sessionId,
          signal: payload,
        });
        if (import.meta.env.DEV) {
          console.info("[MONITOR] sent offer", { sdpBytes: payload.sdp.length });
        }
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
        if (!pc) {
          // Answer/candidates can arrive before local PC finishes setup — queue ICE only.
          if (data.signal && "candidate" in data.signal && data.signal.candidate) {
            pendingCandidatesRef.current.push(data.signal);
          }
          return;
        }
        const signal = data.signal;
        if (!signal) return;
        try {
          if (signal.type === "answer" && signal.sdp) {
            if (import.meta.env.DEV) console.info("[MONITOR] got answer");
            await pc.setRemoteDescription({ type: "answer", sdp: signal.sdp });
            remoteSetRef.current = true;
            await flushCandidates(pc);
          } else if (signal.candidate || (signal as RTCIceCandidateInit).sdpMid != null) {
            if (!remoteSetRef.current) {
              pendingCandidatesRef.current.push(signal as RTCIceCandidateInit);
              return;
            }
            await pc.addIceCandidate(signal as RTCIceCandidateInit);
          }
        } catch (err) {
          if (import.meta.env.DEV) console.warn("[MONITOR] signal error", err);
        }
      }),
      onRealtimeEvent<{ sessionId: string }>("monitor:ended", (data) => {
        if (data?.sessionId && data.sessionId === sessionIdRef.current) {
          void cleanup("remote-ended", false);
          sessionIdRef.current = null;
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
