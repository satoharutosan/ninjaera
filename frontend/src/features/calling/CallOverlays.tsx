import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import CallIcon from "@mui/icons-material/Call";
import CallEndIcon from "@mui/icons-material/CallEnd";
import VideocamIcon from "@mui/icons-material/Videocam";
import VideocamOffIcon from "@mui/icons-material/VideocamOff";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import ScreenShareIcon from "@mui/icons-material/ScreenShare";
import StopScreenShareIcon from "@mui/icons-material/StopScreenShare";
import CloseIcon from "@mui/icons-material/Close";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
import ChatIcon from "@mui/icons-material/Chat";
import { useC, SH2, ChatAvatar, BADGE_BG } from "@/app/shared";
import { useCall } from "./CallProvider";
import { CallChatPanel } from "./CallChatPanel";
import { getNinja, isDesktop } from "@/shared/electronBridge";

const DESKTOP_CHROME_TOP = "var(--ninja-titlebar-h, 44px)";
/** Idle ms before call controls fade in desktop remote full-screen. */
const FS_CONTROLS_HIDE_MS = 2500;


function formatElapsed(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function DeviceSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  options: MediaDeviceInfo[];
}) {
  if (options.length < 1) return null;
  return (
    <label className="flex flex-col gap-0.5 text-left min-w-[9rem]">
      <span className="text-[10px] uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.55)", fontFamily: "Roboto" }}>{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="text-xs rounded-lg px-2 py-1.5 border focus:outline-none focus-visible:ring-2"
        style={{
          background: "#1C1B1F",
          color: "#E6E1E5",
          borderColor: "#938F99",
          fontFamily: "Roboto",
        }}
      >
        {options.map(d => (
          <option
            key={d.deviceId}
            value={d.deviceId}
            style={{ background: "#1C1B1F", color: "#E6E1E5" }}
          >
            {d.label || label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Binds a video-only MediaStream to <video>.
 *
 * IDEMPOTENT binding: srcObject is set only when the element is not already
 * showing this exact stream/track — unless `rebindToken` changes (screen-share
 * start/stop). Electron often needs a detach/reattach after a large resolution
 * jump on the same receiver track (replaceTrack does not fire ontrack again).
 */
function VideoTile({
  stream,
  muted,
  label,
  videoRef: videoRefProp,
  rebindToken = 0,
}: {
  stream: MediaStream | null;
  muted?: boolean;
  label: string;
  videoRef?: RefObject<HTMLVideoElement | null>;
  /** Bump to force srcObject rebind (e.g. remoteBindEpoch on screen share). */
  rebindToken?: number;
}) {
  const localRef = useRef<HTMLVideoElement>(null);
  const ref = videoRefProp ?? localRef;
  const lastRebindRef = useRef(0);
  const videoTrack = stream?.getVideoTracks()[0] ?? null;
  const hasLiveVideo = !!videoTrack && videoTrack.readyState === "live";
  const trackId = videoTrack?.id ?? "none";

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (!stream || !videoTrack) {
      if (el.srcObject) el.srcObject = null;
      return;
    }

    const already = el.srcObject === stream
      || (el.srcObject instanceof MediaStream
        && el.srcObject.getVideoTracks()[0] === videoTrack);
    const force = rebindToken !== lastRebindRef.current;
    if (force) lastRebindRef.current = rebindToken;

    if (!already || force) {
      // Detach first so Chromium/Electron reset the decoder for resolution jumps.
      if (el.srcObject) {
        try { el.srcObject = null; } catch { /* */ }
      }
      el.srcObject = stream;
      if (import.meta.env.DEV) {
        console.log("[STREAM] video attached", {
          localPreview: !!muted,
          trackId: trackId.slice(0, 12),
          mutedTrack: videoTrack.muted,
          enabled: videoTrack.enabled,
          readyState: videoTrack.readyState,
          rebindToken,
          force,
        });
      }
    }

    const play = () => { void el.play().catch(() => {}); };
    play();
    const onUnmute = () => {
      play();
      // Ensure paint after first camera/screen frame arrives.
      if (el.srcObject !== stream) el.srcObject = stream;
    };
    videoTrack.addEventListener("unmute", onUnmute);
    return () => {
      videoTrack.removeEventListener("unmute", onUnmute);
    };
  }, [stream, trackId, muted, videoTrack, rebindToken, ref]);

  // Show <video> whenever a remote track exists (even if still muted / not yet
  // "live"). Requiring live+unmuted hid the element for Web↔Electron shares
  // where the track stays muted until the first RTP frame.
  if (!stream || !videoTrack || videoTrack.readyState === "ended") {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black/40 text-white/70 text-sm" style={{ fontFamily: "Roboto" }}>
        {label}
      </div>
    );
  }

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={!!muted}
      className={`w-full h-full ${hasLiveVideo ? "object-contain bg-black" : "object-cover"}`}
    />
  );
}

/** Dedicated remote audio sink — keeps <video> free of audio tracks for autoplay. */
function RemoteAudioSink({
  stream,
  sinkId,
}: {
  stream: MediaStream | null;
  sinkId?: string;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const trackId = stream?.getAudioTracks()[0]?.id ?? "none";
  const [needsGesture, setNeedsGesture] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!stream || !stream.getAudioTracks().length) {
      el.srcObject = null;
      setNeedsGesture(false);
      return;
    }
    const attached = el.srcObject instanceof MediaStream ? el.srcObject : null;
    const attachedId = attached?.getAudioTracks()[0]?.id;
    if (attachedId === stream.getAudioTracks()[0]?.id && el.srcObject) {
      void el.play().then(() => setNeedsGesture(false)).catch(() => setNeedsGesture(true));
      return;
    }
    el.srcObject = stream;
    void el.play().then(() => setNeedsGesture(false)).catch(() => setNeedsGesture(true));
  }, [stream, trackId]);

  useEffect(() => {
    const el = ref.current as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> } | null;
    if (!el || !sinkId || typeof el.setSinkId !== "function") return;
    void el.setSinkId(sinkId).catch(() => {});
  }, [sinkId, stream, trackId]);

  return (
    <>
      <audio ref={ref} autoPlay playsInline className="hidden" />
      {needsGesture && (
        <button
          type="button"
          className="absolute bottom-20 left-1/2 -translate-x-1/2 z-[5] px-4 py-2 rounded-full text-sm font-medium bg-black/70 text-white"
          style={{ fontFamily: "Roboto" }}
          onClick={() => {
            const el = ref.current;
            if (!el) return;
            void el.play().then(() => setNeedsGesture(false)).catch(() => {});
          }}
        >
          Click to enable sound
        </button>
      )}
    </>
  );
}

function ScreenReceiveWatch({
  peerSharing,
  videoElRef,
  getStats,
  onNeedsRebind,
}: {
  peerSharing: boolean;
  videoElRef: RefObject<HTMLVideoElement | null>;
  getStats?: () => Promise<RTCStatsReport> | undefined;
  /** Called when RTP frames arrive but the <video> still has no real paint. */
  onNeedsRebind?: () => void;
}) {
  const [fail, setFail] = useState(false);

  useEffect(() => {
    if (!peerSharing) {
      setFail(false);
      return;
    }
    setFail(false);
    const started = performance.now();
    let lastFrames = 0;
    let rebound = false;
    const id = window.setInterval(async () => {
      const el = videoElRef.current;
      const w = el?.videoWidth ?? 0;
      const h = el?.videoHeight ?? 0;
      if (w > 32 && h > 32) {
        setFail(false);
        window.clearInterval(id);
        return;
      }
      try {
        const stats = await getStats?.();
        let frames = 0;
        stats?.forEach((r) => {
          if (r.type === "inbound-rtp" && (r as { kind?: string }).kind === "video") {
            frames = Math.max(frames, (r as { framesReceived?: number }).framesReceived || 0);
          }
        });
        if (frames > lastFrames) {
          lastFrames = frames;
          setFail(false);
          // Frames arriving but element still tiny — force a decoder rebind once.
          if (!rebound && performance.now() - started > 2_500) {
            rebound = true;
            if (import.meta.env.DEV) {
              console.log("[SCREEN_SHARE] frames received but video not painting — rebind");
            }
            onNeedsRebind?.();
          }
        }
      } catch { /* */ }
      // Only treat as hard failure when no inbound frames arrived at all.
      if (performance.now() - started > 15_000) {
        if (w <= 32 && h <= 32 && lastFrames === 0) setFail(true);
        window.clearInterval(id);
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [peerSharing, videoElRef, getStats, onNeedsRebind]);

  if (!fail || !peerSharing) return null;
  return (
    <div
      className="absolute inset-x-3 top-3 z-[2] text-center text-xs px-3 py-2 rounded-lg bg-black/70 text-white/90"
      style={{ fontFamily: "Roboto" }}
    >
      Unable to receive shared screen
    </div>
  );
}

/**
 * Dev-only live probe that directly answers "is the stream coming through?".
 * Shows the remote <video> intrinsic size plus inbound-rtp frame stats so we
 * can distinguish "no RTP arriving" (transmission bug) from "frames arriving
 * but not painting" (render bug).
 */
function RemoteStreamDebug({
  videoElRef,
  getStats,
  getVideoDirection,
  remoteStream,
}: {
  videoElRef: RefObject<HTMLVideoElement | null>;
  getStats: () => Promise<RTCStatsReport> | undefined;
  getVideoDirection: () => string | null;
  remoteStream: MediaStream | null;
}) {
  const [info, setInfo] = useState<string>("");

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const id = window.setInterval(async () => {
      const el = videoElRef.current;
      const w = el?.videoWidth ?? 0;
      const h = el?.videoHeight ?? 0;
      const track = remoteStream?.getVideoTracks()[0];
      let rx = 0;
      let rxFps = 0;
      let tx = 0;
      let txFps = 0;
      try {
        const stats = await getStats();
        stats?.forEach((r) => {
          const kind = (r as { kind?: string; mediaType?: string }).kind
            ?? (r as { mediaType?: string }).mediaType;
          if (r.type === "inbound-rtp" && kind === "video") {
            const o = r as unknown as { framesReceived?: number; framesPerSecond?: number };
            rx = o.framesReceived ?? 0;
            rxFps = o.framesPerSecond ?? 0;
          }
          if (r.type === "outbound-rtp" && kind === "video") {
            const o = r as unknown as { framesSent?: number; framesPerSecond?: number };
            tx = o.framesSent ?? 0;
            txFps = o.framesPerSecond ?? 0;
          }
        });
      } catch { /* */ }
      const dir = getVideoDirection() ?? "?";
      setInfo(
        `${dir} · ${w}×${h} ${track ? track.readyState : "none"}${track?.muted ? "/muted" : ""} · tx ${tx}f/${Math.round(txFps)} · rx ${rx}f/${Math.round(rxFps)}`,
      );
    }, 1000);
    return () => window.clearInterval(id);
  }, [videoElRef, getStats, getVideoDirection, remoteStream]);

  if (!import.meta.env.DEV || !info) return null;
  return (
    <div
      className="absolute top-3 right-3 z-[2] text-[10px] px-2 py-1 rounded bg-black/80 text-emerald-300 font-mono pointer-events-none max-w-[95%] truncate"
    >
      {info}
    </div>
  );
}

/**
 * Media frame with Full Screen control.
 *
 * - Web (`mode="native"`): HTML Fullscreen API (unchanged).
 * - Desktop (`mode="layout"`): in-app layout expansion so the custom Electron
 *   title bar stays visible and usable. Electron denies the HTML "fullscreen"
 *   permission, so requestFullscreen() is a silent no-op there.
 */
function FullscreenMediaFrame({
  children,
  label,
  topLeft,
  mode = "native",
  expanded = false,
  onToggle,
  className,
  hideChrome = false,
  enableFullscreen = true,
}: {
  children: ReactNode;
  label: string;
  topLeft?: ReactNode;
  /** "native" = document fullscreen (web); "layout" = React expand (desktop). */
  mode?: "native" | "layout";
  expanded?: boolean;
  onToggle?: () => void;
  className?: string;
  /** Hide label / corner chrome while layout-expanded (controls overlay elsewhere). */
  hideChrome?: boolean;
  /** When false, frame chrome remains but the Full Screen control is omitted. */
  enableFullscreen?: boolean;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [nativeFs, setNativeFs] = useState(false);
  const isFs = mode === "layout" ? expanded : nativeFs;

  useEffect(() => {
    if (mode !== "native") return;
    const onChange = () => {
      const el = frameRef.current;
      const fsEl = document.fullscreenElement
        || (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement;
      setNativeFs(!!el && fsEl === el);
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange as EventListener);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange as EventListener);
    };
  }, [mode]);

  const toggleNative = useCallback(async () => {
    const el = frameRef.current as (HTMLDivElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    }) | null;
    if (!el) return;
    try {
      const fsEl = document.fullscreenElement
        || (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement;
      if (fsEl === el) {
        const doc = document as Document & { webkitExitFullscreen?: () => Promise<void> | void };
        if (document.exitFullscreen) await document.exitFullscreen();
        else doc.webkitExitFullscreen?.();
      } else if (el.requestFullscreen) {
        await el.requestFullscreen();
      } else {
        el.webkitRequestFullscreen?.();
      }
    } catch {
      /* fullscreen blocked */
    }
  }, []);

  const toggle = useCallback(() => {
    if (mode === "layout") {
      onToggle?.();
      return;
    }
    void toggleNative();
  }, [mode, onToggle, toggleNative]);

  const frameClass = [
    "relative overflow-hidden bg-black/50 h-full w-full",
    expanded && mode === "layout"
      ? "rounded-none min-h-0"
      : "rounded-2xl min-h-[30vh] md:min-h-0",
    className,
  ].filter(Boolean).join(" ");

  return (
    <div ref={frameRef} className={frameClass}>
      {children}
      {!hideChrome && (
        <div className="absolute bottom-3 left-3 text-xs text-white/80 px-2 py-1 rounded-full bg-black/50" style={{ fontFamily: "Roboto" }}>
          {label}
        </div>
      )}
      {topLeft && !hideChrome && (
        <div className="absolute top-3 left-3 flex gap-1 z-[1]">
          {topLeft}
        </div>
      )}
      {enableFullscreen && (
        <button
          type="button"
          aria-label={isFs ? "Exit full screen" : "View full screen"}
          title={isFs ? "Exit full screen" : "View full screen"}
          onClick={toggle}
          className="absolute top-3 right-3 z-[3] w-9 h-9 rounded-full flex items-center justify-center text-white transition-opacity hover:opacity-100 opacity-90 focus:outline-none focus-visible:ring-2"
          style={{ background: "rgba(0,0,0,0.55)", boxShadow: "0 1px 4px rgba(0,0,0,0.35)" }}
        >
          {isFs ? <FullscreenExitIcon style={{ fontSize: 20 }} /> : <FullscreenIcon style={{ fontSize: 20 }} />}
        </button>
      )}
    </div>
  );
}

export function CallOverlays() {
  const C = useC();
  const call = useCall();
  const desktop = isDesktop();
  const [chatOpen, setChatOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);
  const [badgePulse, setBadgePulse] = useState(false);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  /** Extra remounts when RTP arrives but Electron/Chromium refuses to paint. */
  const [paintKick, setPaintKick] = useState(0);
  /**
   * Desktop-only: expand remote media to fill the client area under the title bar.
   * Web keeps HTML Fullscreen via FullscreenMediaFrame mode="native".
   */
  const [remoteLayoutFs, setRemoteLayoutFs] = useState(false);
  const [fsControlsVisible, setFsControlsVisible] = useState(true);
  const fsHideTimerRef = useRef<number | null>(null);

  // Reset chat UI / layout FS when leaving a call
  useEffect(() => {
    if (call.phase !== "active" && call.phase !== "connecting") {
      setChatOpen(false);
      setChatUnread(0);
      setPaintKick(0);
      setRemoteLayoutFs(false);
      setFsControlsVisible(true);
    }
  }, [call.phase]);

  useEffect(() => {
    if (!call.peerScreenSharing) setPaintKick(0);
  }, [call.peerScreenSharing]);

  const clearFsHideTimer = useCallback(() => {
    if (fsHideTimerRef.current != null) {
      window.clearTimeout(fsHideTimerRef.current);
      fsHideTimerRef.current = null;
    }
  }, []);

  const bumpFsControls = useCallback(() => {
    if (!desktop || !remoteLayoutFs) return;
    setFsControlsVisible(true);
    clearFsHideTimer();
    fsHideTimerRef.current = window.setTimeout(() => {
      setFsControlsVisible(false);
      fsHideTimerRef.current = null;
    }, FS_CONTROLS_HIDE_MS);
  }, [desktop, remoteLayoutFs, clearFsHideTimer]);

  // Esc exits desktop layout full-screen; auto-hide controls while expanded.
  useEffect(() => {
    if (!desktop || !remoteLayoutFs) {
      clearFsHideTimer();
      setFsControlsVisible(true);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setRemoteLayoutFs(false);
      }
    };
    window.addEventListener("keydown", onKey);
    bumpFsControls();
    return () => {
      window.removeEventListener("keydown", onKey);
      clearFsHideTimer();
    };
  }, [desktop, remoteLayoutFs, bumpFsControls, clearFsHideTimer]);

  const toggleRemoteLayoutFs = useCallback(() => {
    setRemoteLayoutFs((prev) => {
      const next = !prev;
      if (next) setChatOpen(false);
      return next;
    });
  }, []);

  const closeChat = useCallback(() => setChatOpen(false), []);
  const toggleChat = useCallback(() => {
    setChatOpen(prev => {
      if (!prev) setChatUnread(0);
      return !prev;
    });
  }, []);

  const onUnread = useCallback((delta: number) => {
    setChatUnread(n => n + delta);
    setBadgePulse(true);
    window.setTimeout(() => setBadgePulse(false), 400);
  }, []);

  // Dev-only: which gate keeps Share disabled (must stay above early returns).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (call.phase !== "active" && call.phase !== "connecting") return;
    const disabled = call.phase !== "active";
    const reasons: string[] = [];
    if (call.phase !== "active") reasons.push(`phase=${call.phase} (need active)`);
    console.info("[SCREEN_SHARE] button gate", {
      platform: getNinja() ? "electron" : "web",
      phase: call.phase,
      connectionState: call.connectionState,
      screenSharing: call.screenSharing,
      displayCapture: typeof navigator.mediaDevices?.getDisplayMedia === "function",
      disabled,
      disabledReason: reasons.length ? reasons.join("; ") : "none (enabled)",
    });
  }, [call.phase, call.connectionState, call.screenSharing]);

  if (call.phase === "incoming" && call.invite) {
    return (
      <div className="fixed inset-x-0 bottom-0 z-[80] flex items-center justify-center bg-black/60 p-4" style={{ top: getNinja() ? DESKTOP_CHROME_TOP : 0 }} role="dialog" aria-modal="true" aria-label="Incoming call">
        <div className="w-full max-w-sm rounded-3xl p-6 text-center relative" style={{ background: C.surface, boxShadow: SH2 }}>
          <button
            type="button"
            aria-label="Dismiss call"
            title="Dismiss"
            onClick={call.ignoreIncoming}
            className="absolute top-3 right-3 w-9 h-9 rounded-full flex items-center justify-center hover:opacity-80"
            style={{ color: C.onSurfaceVar }}
          >
            <CloseIcon style={{ fontSize: 20 }} />
          </button>
          <div
            className="mx-auto mb-4 w-20 h-20 rounded-full overflow-hidden"
            style={{
              boxShadow: `0 0 0 6px ${C.primary}33`,
              animation: "ne-ring-pulse 1.4s ease-in-out infinite",
            }}
          >
            <ChatAvatar name={call.invite.callerName} avatarUrl={call.invite.callerAvatar} size={80} />
          </div>
          <p className="text-lg font-medium mb-1" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{call.invite.callerName}</p>
          <p className="text-sm mb-1" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
            Incoming {call.invite.type === "video" ? "video" : "voice"} call
          </p>
          <p className="text-xs mb-6 tabular-nums" style={{ color: C.onSurfaceVar, fontFamily: "Roboto Mono, monospace" }}>
            Ringing · {formatElapsed(call.ringingSec)}
          </p>
          <div className="flex justify-center gap-6">
            <button
              type="button"
              aria-label="Decline call"
              onClick={call.declineIncoming}
              className="w-14 h-14 rounded-full flex items-center justify-center text-white hover:opacity-90"
              style={{ background: C.error }}
            >
              <CallEndIcon />
            </button>
            <button
              type="button"
              aria-label="Accept call"
              onClick={() => void call.acceptIncoming()}
              className="w-14 h-14 rounded-full flex items-center justify-center text-white hover:opacity-90"
              style={{ background: "#386A20" }}
            >
              <CallIcon />
            </button>
          </div>
          <style>{`@keyframes ne-ring-pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.06)} }`}</style>
        </div>
      </div>
    );
  }

  if (call.phase === "outgoing") {
    return (
      <div className="fixed inset-x-0 bottom-0 z-[80] flex items-center justify-center bg-black/60 p-4" style={{ top: getNinja() ? DESKTOP_CHROME_TOP : 0 }} role="dialog" aria-modal="true" aria-label="Outgoing call">
        <div className="w-full max-w-sm rounded-3xl p-6 text-center" style={{ background: C.surface, boxShadow: SH2 }}>
          <div
            className="mx-auto mb-4 w-20 h-20 rounded-full overflow-hidden"
            style={{ animation: "ne-ring-pulse 1.4s ease-in-out infinite" }}
          >
            <ChatAvatar name={call.invite?.callerName || "?"} avatarUrl={call.invite?.callerAvatar} size={80} />
          </div>
          <p className="text-lg font-medium mb-1" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
            Calling {call.invite?.callerName || "…"}
          </p>
          <p className="text-sm mb-1" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
            {call.callType === "video" ? "Video" : "Voice"} · Ringing…
          </p>
          <p className="text-xs mb-6 tabular-nums" style={{ color: C.onSurfaceVar, fontFamily: "Roboto Mono, monospace" }}>
            {formatElapsed(call.ringingSec)}
          </p>
          <button
            type="button"
            aria-label="Cancel call"
            onClick={call.hangup}
            className="w-14 h-14 rounded-full flex items-center justify-center text-white mx-auto hover:opacity-90"
            style={{ background: C.error }}
          >
            <CallEndIcon />
          </button>
          <style>{`@keyframes ne-ring-pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.06)} }`}</style>
        </div>
      </div>
    );
  }

  if (call.phase !== "active" && call.phase !== "connecting") return null;

  const conversationId = call.invite?.conversationId ?? 0;
  const chatActive = call.phase === "active" && !!conversationId;
  const showLocalSwitch = call.screenSharing;
  const peerName = call.invite?.callerName || "Peer";
  // Screen share must be available once the call UI is active. Do NOT gate on
  // pc.connectionState === "connected" — Web↔Electron calls often keep A/V
  // working while React still sees "connecting"/"new", which left the button
  // disabled forever (regression). Sender readiness is checked inside shareScreen.
  const screenShareDisabled = call.phase !== "active";

  const viewBtn = (active: boolean) => ({
    background: active ? C.primary : "rgba(0,0,0,0.5)",
    color: "#fff",
    fontFamily: "Roboto" as const,
  });

  const ctrlBtn = (active: boolean, danger = false) => ({
    background: danger ? C.error : active ? "#49454F" : C.error,
  });

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[80] flex flex-col bg-[#1C1B1F]"
      style={{ top: getNinja() ? DESKTOP_CHROME_TOP : 0 }}
      role="dialog"
      aria-modal="true"
      aria-label="In call"
      onMouseMove={remoteLayoutFs ? bumpFsControls : undefined}
    >
      {/* Main column: video + controls only — chat overlays and never shrinks this. */}
      <div className="relative flex-1 min-h-0 flex flex-col">
        <div
          className={
            remoteLayoutFs
              ? "flex-1 relative min-h-0"
              : "flex-1 relative min-h-0 grid grid-cols-1 md:grid-cols-2 gap-2 p-3"
          }
        >
          <FullscreenMediaFrame
            mode={desktop ? "layout" : "native"}
            expanded={remoteLayoutFs}
            onToggle={desktop ? toggleRemoteLayoutFs : undefined}
            hideChrome={remoteLayoutFs}
            label={[
              peerName,
              !call.peerMicOn ? "Muted" : "",
              !call.peerCamOn && !call.peerScreenReceiving && !call.peerScreenSharing ? "Cam off" : "",
              call.peerScreenReceiving
                ? "is sharing their screen"
                : call.peerScreenSharing
                  ? "is starting screen share"
                  : "",
            ].filter(Boolean).join(" · ")}
          >
            {/* Remote video is always muted; audio plays via RemoteAudioSink. */}
            <VideoTile
              key={`remote-${call.remoteBindEpoch}-${paintKick}`}
              stream={call.remoteStream}
              muted
              videoRef={remoteVideoRef}
              rebindToken={call.remoteBindEpoch + paintKick}
              label={
                call.phase === "connecting"
                  ? "Connecting…"
                  : call.peerScreenReceiving
                    ? `${peerName} is sharing their screen`
                    : call.peerScreenSharing
                      ? `${peerName} is starting screen share…`
                      : call.callType === "video"
                        ? (call.remoteStream ? peerName : "Waiting for video…")
                        : "Voice connected"
              }
            />
            <ScreenReceiveWatch
              peerSharing={call.peerScreenSharing}
              videoElRef={remoteVideoRef}
              getStats={call.getPeerStats}
              onNeedsRebind={() => setPaintKick((n) => n + 1)}
            />
            <RemoteStreamDebug
              videoElRef={remoteVideoRef}
              getStats={call.getPeerStats}
              getVideoDirection={call.getVideoDirection}
              remoteStream={call.remoteStream}
            />
            <RemoteAudioSink
              stream={call.remoteAudioStream}
              sinkId={call.selectedOutputId || undefined}
            />
          </FullscreenMediaFrame>

          <div className={remoteLayoutFs ? "hidden" : "contents"}>
            <FullscreenMediaFrame
              enableFullscreen={!desktop}
              label={[
                "You",
                !call.micOn ? "Muted" : "",
                !call.camOn && !call.screenSharing ? "Cam off" : "",
                call.screenSharing ? "are sharing your screen" : "",
              ].filter(Boolean).join(" · ")}
              topLeft={showLocalSwitch ? (
                <>
                  <button type="button" onClick={() => call.setLocalView("camera")}
                    className="text-[10px] px-2 py-1 rounded-full hover:opacity-90"
                    style={viewBtn(call.localView === "camera")}>
                    Camera
                  </button>
                  <button type="button" onClick={() => call.setLocalView("screen")}
                    className="text-[10px] px-2 py-1 rounded-full hover:opacity-90"
                    style={viewBtn(call.localView === "screen" || call.localView === "auto")}>
                    Screen
                  </button>
                </>
              ) : undefined}
            >
              <VideoTile
                stream={call.localStream}
                muted
                label={
                  call.screenSharing
                    ? "You are sharing your screen"
                    : call.camOn
                      ? "You"
                      : "Camera off"
                }
              />
            </FullscreenMediaFrame>
          </div>
        </div>

        {/* Overlay sidebar — does not resize video; no dimming backdrop.
            Stay mounted during layout FS so session lines/unread are preserved. */}
        {chatActive && (
          <div className={remoteLayoutFs ? "hidden" : "contents"}>
            <CallChatPanel
              conversationId={conversationId}
              active={chatActive}
              open={chatOpen && !remoteLayoutFs}
              onClose={closeChat}
              onUnread={onUnread}
            />
          </div>
        )}
      </div>

      <div
        className={
          remoteLayoutFs
            ? `absolute inset-x-0 bottom-0 z-[4] px-4 py-4 flex flex-col items-center gap-3 transition-opacity duration-300 ${
                fsControlsVisible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
              }`
            : "px-4 py-4 flex flex-col items-center gap-3 border-t shrink-0"
        }
        style={
          remoteLayoutFs
            ? {
                background: "linear-gradient(transparent, rgba(0,0,0,0.75))",
                borderColor: "transparent",
              }
            : { borderColor: "#49454F", background: "#2B2930" }
        }
        onMouseEnter={remoteLayoutFs ? () => { clearFsHideTimer(); setFsControlsVisible(true); } : undefined}
        onMouseLeave={remoteLayoutFs ? bumpFsControls : undefined}
      >
        <p className="text-sm text-white/80" style={{ fontFamily: "Roboto Mono, monospace" }}>
          {call.phase === "connecting" ? "Connecting…" : formatElapsed(call.elapsedSec)} · {call.callType === "video" ? "Video" : "Voice"}
          {call.connectionState === "connected" ? "" : ` · ${call.connectionState}`}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button type="button" aria-label={call.micOn ? "Mute" : "Unmute"} onClick={call.toggleMic}
            className="w-12 h-12 rounded-full flex items-center justify-center text-white hover:opacity-90 transition-opacity"
            style={ctrlBtn(call.micOn)}>
            {call.micOn ? <MicIcon /> : <MicOffIcon />}
          </button>
          <button type="button" aria-label={call.camOn ? "Camera off" : "Camera on"} onClick={call.toggleCam}
            className="w-12 h-12 rounded-full flex items-center justify-center text-white hover:opacity-90 transition-opacity"
            style={ctrlBtn(call.camOn)}>
            {call.camOn ? <VideocamIcon /> : <VideocamOffIcon />}
          </button>
          <button
            type="button"
            aria-label={call.screenSharing ? "Stop sharing" : "Share screen"}
            disabled={screenShareDisabled}
            onClick={() => void (call.screenSharing ? call.stopScreenShare() : call.shareScreen())}
            className="w-12 h-12 rounded-full flex items-center justify-center text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:pointer-events-none"
            style={{ background: call.screenSharing ? C.primary : "#49454F" }}
          >
            {call.screenSharing ? <StopScreenShareIcon /> : <ScreenShareIcon />}
          </button>
          {!!conversationId && !remoteLayoutFs && (
            <button
              type="button"
              data-call-chat-toggle
              aria-label={chatOpen ? "Hide call chat" : "Show call chat"}
              aria-pressed={chatOpen}
              onClick={toggleChat}
              className="relative w-12 h-12 rounded-full flex items-center justify-center text-white hover:opacity-90 transition-opacity"
              style={{ background: chatOpen ? C.primary : "#49454F" }}
            >
              <ChatIcon />
              {chatUnread > 0 && !chatOpen && (
                <span
                  className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center text-white"
                  style={{
                    background: BADGE_BG,
                    fontFamily: "Roboto",
                    transform: badgePulse ? "scale(1.15)" : "scale(1)",
                    transition: "transform 180ms ease",
                  }}
                  aria-label={`${chatUnread} unread`}
                >
                  {chatUnread > 99 ? "99+" : chatUnread}
                </span>
              )}
            </button>
          )}
          <button type="button" aria-label="Leave call" onClick={call.hangup}
            className="w-14 h-12 rounded-full flex items-center justify-center text-white px-4 hover:opacity-90 transition-opacity"
            style={{ background: C.error }}>
            <CallEndIcon />
          </button>
        </div>
        {!remoteLayoutFs && (
          <div className="flex flex-wrap gap-3 justify-center max-w-2xl w-full">
            {call.audioInputs.length > 0 && (
              <DeviceSelect
                label="Microphone"
                value={call.selectedMicId || call.audioInputs[0]?.deviceId || ""}
                onChange={id => void call.switchMic(id)}
                options={call.audioInputs}
              />
            )}
            {call.videoInputs.length > 0 && (
              <DeviceSelect
                label="Camera"
                value={call.selectedCamId || call.videoInputs[0]?.deviceId || ""}
                onChange={id => void call.switchCam(id)}
                options={call.videoInputs}
              />
            )}
            {call.audioOutputs.length > 0 && (
              <DeviceSelect
                label="Speaker"
                value={call.selectedOutputId || call.audioOutputs[0]?.deviceId || ""}
                onChange={id => void call.setAudioOutput(id)}
                options={call.audioOutputs}
              />
            )}
          </div>
        )}
      </div>
      <style>{`
        @keyframes ne-badge-pop { 0%{transform:scale(1)} 50%{transform:scale(1.2)} 100%{transform:scale(1)} }
      `}</style>
    </div>
  );
}
