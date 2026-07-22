/**
 * Super-Admin live desktop monitor viewer.
 * Receives a screen stream from the desktop agent via Socket.IO monitor:* signaling.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import CloseIcon from "@mui/icons-material/Close";
import StopCircleIcon from "@mui/icons-material/StopCircle";
import RefreshIcon from "@mui/icons-material/Refresh";
import { useC, SH2 } from "@/app/shared";
import { emitReliable, onRealtimeEvent } from "@/app/realtime";
import { resolveIceServers } from "@/features/calling/iceConfig";
import type { AppInstallationRecord } from "@/app/api";

type ConnStatus = "connecting" | "connected" | "disconnected" | "busy" | "error";

function formatElapsed(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatBitrate(bps: number) {
  if (bps <= 0) return "—";
  if (bps < 1_000_000) return `${Math.round(bps / 1000)} kbps`;
  return `${(bps / 1_000_000).toFixed(2)} Mbps`;
}

/** Plain JSON SDP — RTCSessionDescription can lose fields over Socket.IO. */
function sdpPayload(desc: RTCSessionDescription | RTCSessionDescriptionInit | null | undefined) {
  if (!desc?.type || !desc.sdp) return null;
  return { type: desc.type, sdp: desc.sdp };
}

export function AdminMonitorModal({
  target,
  onClose,
}: {
  target: AppInstallationRecord;
  onClose: () => void;
}) {
  const C = useC();
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pcCreatingRef = useRef<Promise<RTCPeerConnection> | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteSetRef = useRef(false);
  const startedAtRef = useRef<number>(Date.now());
  const listenersReadyRef = useRef(false);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [statusDetail, setStatusDetail] = useState("Connecting…");
  const [elapsed, setElapsed] = useState(0);
  const [bitrate, setBitrate] = useState(0);
  const [resolution, setResolution] = useState("—");
  const lastBytesRef = useRef({ bytes: 0, at: 0 });

  const attachStream = useCallback((stream: MediaStream) => {
    const el = videoRef.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    void el.play().catch(() => {});
    setStatus("connected");
    setStatusDetail("Live");
  }, []);

  const flushCandidates = useCallback(async (pc: RTCPeerConnection) => {
    const queued = pendingCandidatesRef.current.splice(0, pendingCandidatesRef.current.length);
    for (const c of queued) {
      try {
        await pc.addIceCandidate(c);
      } catch (err) {
        if (import.meta.env.DEV) console.warn("[MONITOR_ADMIN] addIceCandidate failed", err);
      }
    }
  }, []);

  const ensurePc = useCallback(async () => {
    if (pcRef.current) return pcRef.current;
    if (pcCreatingRef.current) return pcCreatingRef.current;

    pcCreatingRef.current = (async () => {
      const iceServers = await resolveIceServers();
      if (pcRef.current) return pcRef.current;

      const pc = new RTCPeerConnection({ iceServers });
      // Explicit recv transceiver so the answer always includes video receive.
      pc.addTransceiver("video", { direction: "recvonly" });

      pc.ontrack = (ev) => {
        if (import.meta.env.DEV) {
          console.info("[MONITOR_ADMIN] ontrack", {
            kind: ev.track.kind,
            streams: ev.streams.length,
            readyState: ev.track.readyState,
          });
        }
        const stream = ev.streams[0] ?? new MediaStream([ev.track]);
        attachStream(stream);
      };

      pc.onicecandidate = (ev) => {
        if (!ev.candidate || !sessionIdRef.current) return;
        emitReliable("monitor:signal", {
          sessionId: sessionIdRef.current,
          signal: ev.candidate.toJSON(),
        });
      };

      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        if (import.meta.env.DEV) console.info("[MONITOR_ADMIN] pc state", st);
        if (st === "connected") {
          setStatus("connected");
          setStatusDetail("Live");
        } else if (st === "failed") {
          setStatus("disconnected");
          setStatusDetail("Connection failed");
        } else if (st === "disconnected") {
          setStatus("disconnected");
          setStatusDetail("Disconnected");
        }
      };

      pcRef.current = pc;
      return pc;
    })();

    try {
      return await pcCreatingRef.current;
    } finally {
      pcCreatingRef.current = null;
    }
  }, [attachStream]);

  const teardownPc = useCallback((reason: string, hangup: boolean) => {
    if (import.meta.env.DEV) console.info("[MONITOR_ADMIN] teardown", reason);
    const sid = sessionIdRef.current;
    if (hangup) sessionIdRef.current = null;
    remoteSetRef.current = false;
    pendingCandidatesRef.current = [];
    pcCreatingRef.current = null;
    try { pcRef.current?.close(); } catch { /* */ }
    pcRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (hangup && sid) emitReliable("monitor:hangup", { sessionId: sid });
  }, []);

  const requestMonitor = useCallback(() => {
    teardownPc("restart", true);
    setStatus("connecting");
    setStatusDetail("Requesting screen…");
    setBitrate(0);
    setResolution("—");
    lastBytesRef.current = { bytes: 0, at: 0 };
    startedAtRef.current = Date.now();
    if (import.meta.env.DEV) {
      console.info("[MONITOR_ADMIN] request", { installationId: target.installationId });
    }
    emitReliable("monitor:request", {
      installationId: target.installationId,
      targetUsername: target.username || undefined,
    });
  }, [target.installationId, target.username, teardownPc]);

  // Register listeners first, then send the request (avoids dropping early signals).
  useEffect(() => {
    listenersReadyRef.current = false;

    const unsubs = [
      onRealtimeEvent<{ sessionId: string; installationId: string }>("monitor:ringing", (data) => {
        if (data?.installationId !== target.installationId) return;
        sessionIdRef.current = data.sessionId;
        setStatusDetail("Waiting for endpoint…");
        if (import.meta.env.DEV) console.info("[MONITOR_ADMIN] ringing", data.sessionId);
      }),
      onRealtimeEvent<{ sessionId: string }>("monitor:accepted", (data) => {
        if (!data?.sessionId) return;
        if (sessionIdRef.current && sessionIdRef.current !== data.sessionId) return;
        sessionIdRef.current = data.sessionId;
        setStatusDetail("Negotiating WebRTC…");
        if (import.meta.env.DEV) console.info("[MONITOR_ADMIN] accepted", data.sessionId);
        void ensurePc();
      }),
      onRealtimeEvent<{ sessionId: string; signal: RTCSessionDescriptionInit & RTCIceCandidateInit }>(
        "monitor:signal",
        async (data) => {
          if (!data?.sessionId) return;
          // Accept first signal even if ringing was missed.
          if (!sessionIdRef.current) sessionIdRef.current = data.sessionId;
          if (data.sessionId !== sessionIdRef.current) return;

          const signal = data.signal;
          if (!signal) return;

          try {
            if (signal.type === "offer" && signal.sdp) {
              if (import.meta.env.DEV) {
                console.info("[MONITOR_ADMIN] got offer", { sdpBytes: signal.sdp.length });
              }
              const pc = await ensurePc();
              if (pc.signalingState !== "stable" && pc.remoteDescription) {
                // Already have a remote offer — ignore duplicates.
                return;
              }
              await pc.setRemoteDescription({ type: "offer", sdp: signal.sdp });
              remoteSetRef.current = true;
              await flushCandidates(pc);
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              const payload = sdpPayload(pc.localDescription);
              if (!payload) throw new Error("Failed to create answer SDP");
              emitReliable("monitor:signal", {
                sessionId: data.sessionId,
                signal: payload,
              });
              if (import.meta.env.DEV) console.info("[MONITOR_ADMIN] sent answer");
              setStatusDetail("Negotiating WebRTC…");
            } else if (signal.candidate || (signal as { sdpMid?: string }).sdpMid != null) {
              const pc = pcRef.current;
              if (!pc || !remoteSetRef.current) {
                pendingCandidatesRef.current.push(signal);
                return;
              }
              await pc.addIceCandidate(signal);
            }
          } catch (err) {
            if (import.meta.env.DEV) console.warn("[MONITOR_ADMIN] signal error", err);
            setStatus("error");
            setStatusDetail(err instanceof Error ? err.message : "WebRTC negotiation failed");
          }
        },
      ),
      onRealtimeEvent<{ sessionId?: string; error?: string; code?: string; installationId?: string }>(
        "monitor:error",
        (data) => {
          if (data?.installationId && data.installationId !== target.installationId) return;
          setStatus(data?.code === "busy" ? "busy" : "error");
          setStatusDetail(data?.error || "Monitoring failed");
        },
      ),
      onRealtimeEvent<{ sessionId: string; reason?: string }>("monitor:busy", (data) => {
        if (sessionIdRef.current && data.sessionId !== sessionIdRef.current) return;
        setStatus("busy");
        setStatusDetail(data.reason || "Endpoint is busy");
        teardownPc("busy", true);
      }),
      onRealtimeEvent<{ sessionId: string }>("monitor:rejected", (data) => {
        if (sessionIdRef.current && data.sessionId !== sessionIdRef.current) return;
        setStatus("error");
        setStatusDetail("Endpoint rejected monitoring");
        teardownPc("rejected", true);
      }),
      onRealtimeEvent<{ sessionId: string; reason?: string }>("monitor:ended", (data) => {
        if (sessionIdRef.current && data.sessionId !== sessionIdRef.current) return;
        setStatus("disconnected");
        setStatusDetail(data.reason === "ended" ? "Session ended" : "Disconnected");
        teardownPc("ended", false);
        sessionIdRef.current = null;
      }),
    ];

    listenersReadyRef.current = true;
    // Defer request until after listeners are attached.
    const t = window.setTimeout(() => requestMonitor(), 0);

    return () => {
      window.clearTimeout(t);
      unsubs.forEach((u) => u());
      teardownPc("unmount", true);
    };
  }, [target.installationId, ensurePc, flushCandidates, requestMonitor, teardownPc]);

  useEffect(() => {
    const tick = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    const statsId = window.setInterval(async () => {
      const pc = pcRef.current;
      const el = videoRef.current;
      if (el && el.videoWidth > 0) {
        setResolution(`${el.videoWidth}×${el.videoHeight}`);
      }
      if (!pc) return;
      try {
        const report = await pc.getStats();
        let bytes = 0;
        report.forEach((r) => {
          if (r.type === "inbound-rtp" && (r as { kind?: string }).kind === "video") {
            bytes = Math.max(bytes, (r as { bytesReceived?: number }).bytesReceived || 0);
          }
        });
        const now = Date.now();
        const prev = lastBytesRef.current;
        if (prev.at > 0 && bytes >= prev.bytes) {
          const dt = (now - prev.at) / 1000;
          if (dt > 0) setBitrate(((bytes - prev.bytes) * 8) / dt);
        }
        lastBytesRef.current = { bytes, at: now };
      } catch { /* */ }
    }, 2000);
    return () => window.clearInterval(statsId);
  }, []);

  const handleClose = () => {
    teardownPc("close", true);
    onClose();
  };

  const handleReconnect = () => {
    requestMonitor();
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex flex-col"
      style={{ background: "rgba(0,0,0,0.72)" }}
      role="dialog"
      aria-modal="true"
      aria-label="Monitor desktop"
    >
      <div
        className="m-3 md:m-5 flex-1 min-h-0 flex flex-col rounded-2xl overflow-hidden"
        style={{ background: C.surface, boxShadow: SH2 }}
      >
        <div
          className="flex items-center justify-between gap-3 px-4 py-3 border-b shrink-0"
          style={{ borderColor: C.outlineVar }}
        >
          <div>
            <p className="text-sm font-medium" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
              Monitoring {target.username || "endpoint"}
            </p>
            <p className="text-xs" style={{ color: C.onSurfaceVar, fontFamily: "Roboto Mono, monospace" }}>
              {statusDetail} · {formatElapsed(elapsed)} · {formatBitrate(bitrate)} · {resolution}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {(status === "disconnected" || status === "error" || status === "busy") && (
              <button
                type="button"
                onClick={handleReconnect}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs text-white"
                style={{ background: C.primary, fontFamily: "Roboto" }}
              >
                <RefreshIcon style={{ fontSize: 16 }} /> Reconnect
              </button>
            )}
            <button
              type="button"
              onClick={handleClose}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs text-white"
              style={{ background: C.error, fontFamily: "Roboto" }}
            >
              <StopCircleIcon style={{ fontSize: 16 }} /> Stop Monitoring
            </button>
            <button
              type="button"
              aria-label="Close"
              onClick={handleClose}
              className="w-9 h-9 rounded-full flex items-center justify-center hover:opacity-80"
              style={{ color: C.onSurfaceVar }}
            >
              <CloseIcon style={{ fontSize: 20 }} />
            </button>
          </div>
        </div>

        <div className="relative flex-1 min-h-0 bg-black flex items-center justify-center">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="max-w-full max-h-full w-full h-full object-contain"
          />
          {status !== "connected" && (
            <div
              className="absolute inset-0 flex items-center justify-center text-sm text-white/80"
              style={{ fontFamily: "Roboto" }}
            >
              {statusDetail}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AdminMonitorModal;
