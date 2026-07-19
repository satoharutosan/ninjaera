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
 * Force clear → reattach on every relevant change (stream identity, track id,
 * or an explicit bindKey bump). This is deliberate: some Chrome versions do
 * not repaint a still-mounted <video> after RTCRtpSender.replaceTrack() on the
 * remote side unless srcObject is re-set. This is now safe to do unconditionally
 * because the stream is video-only (audio lives in a separate <audio> element),
 * so there is no autoplay-policy conflict from an unmuted audio track.
 */
function VideoTile({
  stream,
  muted,
  label,
  videoRef: videoRefProp,
  bindKey,
}: {
  stream: MediaStream | null;
  muted?: boolean;
  label: string;
  videoRef?: RefObject<HTMLVideoElement | null>;
  bindKey?: string | number;
}) {
  const localRef = useRef<HTMLVideoElement>(null);
  const ref = videoRefProp ?? localRef;
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

    el.srcObject = null;
    el.srcObject = stream;
    if (import.meta.env.DEV) {
      console.log("[VIDEO] stream attached", {
        localPreview: !!muted,
        bindKey,
        trackId: trackId.slice(0, 12),
        mutedTrack: videoTrack.muted,
        readyState: videoTrack.readyState,
        audioTracksInStream: stream.getAudioTracks().length,
      });
    }
    const play = () => { void el.play().catch(() => {}); };
    play();
    videoTrack.addEventListener("unmute", play);
    return () => {
      videoTrack.removeEventListener("unmute", play);
    };
  }, [stream, trackId, muted, videoTrack, bindKey]);

  if (!stream || (!hasLiveVideo && muted)) {
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

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!stream || !stream.getAudioTracks().length) {
      el.srcObject = null;
      return;
    }
    const attached = el.srcObject instanceof MediaStream ? el.srcObject : null;
    const attachedId = attached?.getAudioTracks()[0]?.id;
    if (attachedId === stream.getAudioTracks()[0]?.id && el.srcObject) {
      void el.play().catch(() => {});
      return;
    }
    el.srcObject = stream;
    void el.play().catch(() => {});
  }, [stream, trackId]);

  useEffect(() => {
    const el = ref.current as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> } | null;
    if (!el || !sinkId || typeof el.setSinkId !== "function") return;
    void el.setSinkId(sinkId).catch(() => {});
  }, [sinkId, stream, trackId]);

  return <audio ref={ref} autoPlay playsInline className="hidden" />;
}

function ScreenReceiveWatch({
  peerSharing,
  videoElRef,
}: {
  peerSharing: boolean;
  videoElRef: RefObject<HTMLVideoElement | null>;
}) {
  const [fail, setFail] = useState(false);

  useEffect(() => {
    if (!peerSharing) {
      setFail(false);
      return;
    }
    setFail(false);
    const started = performance.now();
    const id = window.setInterval(() => {
      const el = videoElRef.current;
      const w = el?.videoWidth ?? 0;
      const h = el?.videoHeight ?? 0;
      // Placeholder outbound is 16×16 — real camera/screen is larger.
      if (w > 32 && h > 32) {
        setFail(false);
        window.clearInterval(id);
        return;
      }
      if (performance.now() - started > 5000) {
        setFail(true);
        window.clearInterval(id);
      }
    }, 400);
    return () => window.clearInterval(id);
  }, [peerSharing, videoElRef]);

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

function FullscreenMediaFrame({
  children,
  label,
  topLeft,
}: {
  children: ReactNode;
  label: string;
  topLeft?: ReactNode;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [isFs, setIsFs] = useState(false);

  useEffect(() => {
    const onChange = () => {
      const el = frameRef.current;
      const fsEl = document.fullscreenElement
        || (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement;
      setIsFs(!!el && fsEl === el);
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange as EventListener);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange as EventListener);
    };
  }, []);

  const toggle = useCallback(async () => {
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

  return (
    <div ref={frameRef} className="relative rounded-2xl overflow-hidden bg-black/50 min-h-[30vh] md:min-h-0 h-full w-full">
      {children}
      <div className="absolute bottom-3 left-3 text-xs text-white/80 px-2 py-1 rounded-full bg-black/50" style={{ fontFamily: "Roboto" }}>
        {label}
      </div>
      {topLeft && (
        <div className="absolute top-3 left-3 flex gap-1 z-[1]">
          {topLeft}
        </div>
      )}
      <button
        type="button"
        aria-label={isFs ? "Exit full screen" : "View full screen"}
        title={isFs ? "Exit full screen" : "View full screen"}
        onClick={() => void toggle()}
        className="absolute top-3 right-3 z-[2] w-9 h-9 rounded-full flex items-center justify-center text-white transition-opacity hover:opacity-100 opacity-90 focus:outline-none focus-visible:ring-2"
        style={{ background: "rgba(0,0,0,0.55)", boxShadow: "0 1px 4px rgba(0,0,0,0.35)" }}
      >
        {isFs ? <FullscreenExitIcon style={{ fontSize: 20 }} /> : <FullscreenIcon style={{ fontSize: 20 }} />}
      </button>
    </div>
  );
}

export function CallOverlays() {
  const C = useC();
  const call = useCall();
  const [chatOpen, setChatOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);
  const [badgePulse, setBadgePulse] = useState(false);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  // Reset chat UI when leaving a call
  useEffect(() => {
    if (call.phase !== "active" && call.phase !== "connecting") {
      setChatOpen(false);
      setChatUnread(0);
    }
  }, [call.phase]);

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

  if (call.phase === "incoming" && call.invite) {
    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Incoming call">
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
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Outgoing call">
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

  const viewBtn = (active: boolean) => ({
    background: active ? C.primary : "rgba(0,0,0,0.5)",
    color: "#fff",
    fontFamily: "Roboto" as const,
  });

  const ctrlBtn = (active: boolean, danger = false) => ({
    background: danger ? C.error : active ? "#49454F" : C.error,
  });

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-[#1C1B1F]" role="dialog" aria-modal="true" aria-label="In call">
      {/* Main column: video + controls only — chat overlays and never shrinks this. */}
      <div className="relative flex-1 min-h-0 flex flex-col">
        <div className="flex-1 relative min-h-0 grid grid-cols-1 md:grid-cols-2 gap-2 p-3">
          <FullscreenMediaFrame
            label={[
              peerName,
              !call.peerMicOn ? "Muted" : "",
              !call.peerCamOn && !call.peerScreenSharing ? "Cam off" : "",
              call.peerScreenSharing ? "is sharing their screen" : "",
            ].filter(Boolean).join(" · ")}
          >
            {/* Remote video is always muted; audio plays via RemoteAudioSink. */}
            <VideoTile
              stream={call.remoteStream}
              muted
              videoRef={remoteVideoRef}
              bindKey={`${call.remoteBindEpoch}-${call.peerScreenSharing ? "screen" : "cam"}-${call.remoteStream?.getVideoTracks()[0]?.id ?? "x"}`}
              label={
                call.phase === "connecting"
                  ? "Connecting…"
                  : call.peerScreenSharing
                    ? `${peerName} is sharing their screen`
                    : call.callType === "video"
                      ? "Waiting for video…"
                      : "Voice connected"
              }
            />
            <ScreenReceiveWatch
              peerSharing={call.peerScreenSharing}
              videoElRef={remoteVideoRef}
            />
            <RemoteAudioSink
              stream={call.remoteAudioStream}
              sinkId={call.selectedOutputId || undefined}
            />
          </FullscreenMediaFrame>

          <FullscreenMediaFrame
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

        {/* Overlay sidebar — does not resize video; no dimming backdrop. */}
        {chatActive && (
          <CallChatPanel
            conversationId={conversationId}
            active={chatActive}
            open={chatOpen}
            onClose={closeChat}
            onUnread={onUnread}
          />
        )}
      </div>

      <div className="px-4 py-4 flex flex-col items-center gap-3 border-t shrink-0" style={{ borderColor: "#49454F", background: "#2B2930" }}>
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
            onClick={() => void (call.screenSharing ? call.stopScreenShare() : call.shareScreen())}
            className="w-12 h-12 rounded-full flex items-center justify-center text-white hover:opacity-90 transition-opacity"
            style={{ background: call.screenSharing ? C.primary : "#49454F" }}
          >
            {call.screenSharing ? <StopScreenShareIcon /> : <ScreenShareIcon />}
          </button>
          {!!conversationId && (
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
        <div className="flex flex-wrap gap-3 justify-center max-w-2xl w-full">
          {call.audioInputs.length > 0 && (
            <DeviceSelect
              label="Microphone"
              value={call.audioInputs[0]?.deviceId || ""}
              onChange={id => void call.switchMic(id)}
              options={call.audioInputs}
            />
          )}
          {call.videoInputs.length > 0 && (
            <DeviceSelect
              label="Camera"
              value={call.videoInputs[0]?.deviceId || ""}
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
      </div>
      <style>{`
        @keyframes ne-badge-pop { 0%{transform:scale(1)} 50%{transform:scale(1.2)} 100%{transform:scale(1)} }
      `}</style>
    </div>
  );
}
