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
  const sessionIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number>(Date.now());
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [statusDetail, setStatusDetail] = useState("Requesting screen…");
  const [elapsed, setElapsed] = useState(0);
  const [bitrate, setBitrate] = useState(0);
  const [resolution, setResolution] = useState("—");

  const teardown = useCallback((reason: string) => {
    if (import.meta.env.DEV) console.info("[MONITOR_ADMIN] teardown", reason);
    const sid = sessionIdRef.current;
    sessionIdRef.current = null;
    try { pcRef.current?.close(); } catch { /* */ }
    pcRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (sid) emitReliable("monitor:hangup", { sessionId: sid });
  }, []);

  const startMonitor = useCallback(() => {
    teardown("restart");
    setStatus("connecting");
    setStatusDetail("Requesting screen…");
    setBitrate(0);
    setResolution("—");
    startedAtRef.current = Date.now();
    emitReliable("monitor:request", {
      installationId: target.installationId,
      targetUsername: target.username || undefined,
    });
  }, [target.installationId, target.username, teardown]);

  useEffect(() => {
    startMonitor();
    return () => {
      teardown("unmount");
    };
  }, [startMonitor, teardown]);

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
        // Approximate instantaneous rate from cumulative bytes vs elapsed.
        const sec = Math.max(1, (Date.now() - startedAtRef.current) / 1000);
        setBitrate((bytes * 8) / sec);
      } catch { /* */ }
    }, 2000);
    return () => window.clearInterval(statsId);
  }, []);

  useEffect(() => {
    const ensurePc = async () => {
      if (pcRef.current) return pcRef.current;
      const iceServers = await resolveIceServers();
      const pc = new RTCPeerConnection({ iceServers });
      pcRef.current = pc;
      pc.ontrack = (ev) => {
        const stream = ev.streams[0] || new MediaStream([ev.track]);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {});
        }
        setStatus("connected");
        setStatusDetail("Live");
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
        if (st === "connected") {
          setStatus("connected");
          setStatusDetail("Live");
        } else if (st === "failed" || st === "disconnected") {
          setStatus("disconnected");
          setStatusDetail(st);
        }
      };
      return pc;
    };

    const unsubs = [
      onRealtimeEvent<{ sessionId: string; installationId: string }>("monitor:ringing", (data) => {
        if (data?.installationId !== target.installationId) return;
        sessionIdRef.current = data.sessionId;
        setStatusDetail("Waiting for endpoint…");
      }),
      onRealtimeEvent<{ sessionId: string }>("monitor:accepted", (data) => {
        if (!data?.sessionId) return;
        if (sessionIdRef.current && sessionIdRef.current !== data.sessionId) return;
        sessionIdRef.current = data.sessionId;
        setStatusDetail("Negotiating WebRTC…");
        void ensurePc();
      }),
      onRealtimeEvent<{ sessionId: string; signal: RTCSessionDescriptionInit & RTCIceCandidateInit }>(
        "monitor:signal",
        async (data) => {
          if (!data?.sessionId || data.sessionId !== sessionIdRef.current) return;
          const pc = await ensurePc();
          const signal = data.signal;
          try {
            if (signal.type === "offer") {
              await pc.setRemoteDescription(signal);
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              emitReliable("monitor:signal", {
                sessionId: data.sessionId,
                signal: pc.localDescription,
              });
            } else if (signal.candidate) {
              await pc.addIceCandidate(signal);
            }
          } catch (err) {
            if (import.meta.env.DEV) console.warn("[MONITOR_ADMIN] signal error", err);
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
        teardown("busy");
      }),
      onRealtimeEvent<{ sessionId: string }>("monitor:rejected", (data) => {
        if (sessionIdRef.current && data.sessionId !== sessionIdRef.current) return;
        setStatus("error");
        setStatusDetail("Endpoint rejected monitoring");
        teardown("rejected");
      }),
      onRealtimeEvent<{ sessionId: string; reason?: string }>("monitor:ended", (data) => {
        if (sessionIdRef.current && data.sessionId !== sessionIdRef.current) return;
        setStatus("disconnected");
        setStatusDetail(data.reason === "ended" ? "Session ended" : "Disconnected");
        teardown("ended");
      }),
    ];

    return () => unsubs.forEach((u) => u());
  }, [target.installationId, teardown]);

  const handleClose = () => {
    teardown("close");
    onClose();
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
                onClick={startMonitor}
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
