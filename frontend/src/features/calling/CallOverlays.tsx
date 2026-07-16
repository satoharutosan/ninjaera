import { useEffect, useRef } from "react";
import CallIcon from "@mui/icons-material/Call";
import CallEndIcon from "@mui/icons-material/CallEnd";
import VideocamIcon from "@mui/icons-material/Videocam";
import VideocamOffIcon from "@mui/icons-material/VideocamOff";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import ScreenShareIcon from "@mui/icons-material/ScreenShare";
import StopScreenShareIcon from "@mui/icons-material/StopScreenShare";
import CloseIcon from "@mui/icons-material/Close";
import { useC, SH2, ChatAvatar } from "@/app/shared";
import { useCall } from "./CallProvider";

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
  C,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  options: MediaDeviceInfo[];
  C: ReturnType<typeof useC>;
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

function VideoTile({
  stream,
  muted,
  label,
  sinkId,
}: {
  stream: MediaStream | null;
  muted?: boolean;
  label: string;
  sinkId?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    const el = ref.current as HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> } | null;
    if (!el || !sinkId || muted || typeof el.setSinkId !== "function") return;
    void el.setSinkId(sinkId).catch(() => {});
  }, [sinkId, muted, stream]);

  const hasVideo = !!stream?.getVideoTracks().some(t => t.enabled && t.readyState === "live");

  if (!stream || (!hasVideo && muted)) {
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
      muted={muted}
      className={`w-full h-full ${hasVideo ? "object-contain bg-black" : "object-cover"}`}
    />
  );
}

export function CallOverlays() {
  const C = useC();
  const call = useCall();

  // Incoming modal — not shown when ignored (banner handles that)
  if (call.phase === "incoming" && call.invite) {
    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Incoming call">
        <div className="w-full max-w-sm rounded-3xl p-6 text-center relative" style={{ background: C.surface, boxShadow: SH2 }}>
          <button
            type="button"
            aria-label="Ignore call"
            title="Ignore"
            onClick={call.ignoreIncoming}
            className="absolute top-3 right-3 w-9 h-9 rounded-full flex items-center justify-center hover:bg-black/5"
            style={{ color: C.onSurfaceVar }}
          >
            <CloseIcon style={{ fontSize: 20 }} />
          </button>
          <div
            className="mx-auto mb-4 w-20 h-20 rounded-full overflow-hidden ring-4"
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
              className="w-14 h-14 rounded-full flex items-center justify-center text-white"
              style={{ background: C.error }}
            >
              <CallEndIcon />
            </button>
            <button
              type="button"
              aria-label="Accept call"
              onClick={() => void call.acceptIncoming()}
              className="w-14 h-14 rounded-full flex items-center justify-center text-white"
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
            className="w-14 h-14 rounded-full flex items-center justify-center text-white mx-auto"
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

  const showLocalSwitch = call.screenSharing;
  const showRemoteSwitch = call.peerScreenSharing;

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-[#1C1B1F]" role="dialog" aria-modal="true" aria-label="In call">
      <div className="flex-1 relative min-h-0 grid grid-cols-1 md:grid-cols-2 gap-2 p-3">
        <div className="relative rounded-2xl overflow-hidden bg-black/50 min-h-[40vh]">
          <VideoTile
            stream={call.remoteStream}
            sinkId={call.selectedOutputId || undefined}
            label={
              call.phase === "connecting"
                ? "Connecting…"
                : call.peerScreenSharing
                  ? "Screen share"
                  : call.callType === "video"
                    ? "Waiting for video…"
                    : "Voice connected"
            }
          />
          <div className="absolute bottom-3 left-3 text-xs text-white/80 px-2 py-1 rounded-full bg-black/50" style={{ fontFamily: "Roboto" }}>
            Peer
            {!call.peerMicOn ? " · Muted" : ""}
            {!call.peerCamOn ? " · Cam off" : ""}
            {call.peerScreenSharing ? " · Screen" : ""}
            {" · "}{call.connectionState}
          </div>
          {showRemoteSwitch && (
            <div className="absolute top-3 right-3 flex gap-1">
              <button type="button" onClick={() => call.setRemoteView("camera")}
                className="text-[10px] px-2 py-1 rounded-full"
                style={{ background: call.remoteView === "camera" ? C.primary : "rgba(0,0,0,0.5)", color: "#fff", fontFamily: "Roboto" }}>
                View Camera
              </button>
              <button type="button" onClick={() => call.setRemoteView("screen")}
                className="text-[10px] px-2 py-1 rounded-full"
                style={{ background: call.remoteView === "screen" || call.remoteView === "auto" ? C.primary : "rgba(0,0,0,0.5)", color: "#fff", fontFamily: "Roboto" }}>
                View Screen
              </button>
            </div>
          )}
        </div>
        <div className="relative rounded-2xl overflow-hidden bg-black/50 min-h-[30vh] md:min-h-[40vh]">
          <VideoTile
            stream={call.localStream}
            muted
            label={call.camOn || call.screenSharing ? "You" : "Camera off"}
          />
          <div className="absolute bottom-3 left-3 text-xs text-white/80 px-2 py-1 rounded-full bg-black/50" style={{ fontFamily: "Roboto" }}>
            You {!call.micOn ? "· Muted" : ""} {!call.camOn && !call.screenSharing ? "· Cam off" : ""} {call.screenSharing ? "· Sharing" : ""}
          </div>
          {showLocalSwitch && (
            <div className="absolute top-3 right-3 flex gap-1">
              <button type="button" onClick={() => call.setLocalView("camera")}
                className="text-[10px] px-2 py-1 rounded-full"
                style={{ background: call.localView === "camera" ? C.primary : "rgba(0,0,0,0.5)", color: "#fff", fontFamily: "Roboto" }}>
                View Camera
              </button>
              <button type="button" onClick={() => call.setLocalView("screen")}
                className="text-[10px] px-2 py-1 rounded-full"
                style={{ background: call.localView === "screen" || call.localView === "auto" ? C.primary : "rgba(0,0,0,0.5)", color: "#fff", fontFamily: "Roboto" }}>
                View Screen
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="px-4 py-4 flex flex-col items-center gap-3 border-t" style={{ borderColor: "#49454F", background: "#2B2930" }}>
        <p className="text-sm text-white/80" style={{ fontFamily: "Roboto Mono, monospace" }}>
          {call.phase === "connecting" ? "Connecting…" : formatElapsed(call.elapsedSec)} · {call.callType === "video" ? "Video" : "Voice"}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button type="button" aria-label={call.micOn ? "Mute" : "Unmute"} onClick={call.toggleMic}
            className="w-12 h-12 rounded-full flex items-center justify-center text-white"
            style={{ background: call.micOn ? "#49454F" : C.error }}>
            {call.micOn ? <MicIcon /> : <MicOffIcon />}
          </button>
          <button type="button" aria-label={call.camOn ? "Camera off" : "Camera on"} onClick={call.toggleCam}
            className="w-12 h-12 rounded-full flex items-center justify-center text-white"
            style={{ background: call.camOn ? "#49454F" : C.error }}>
            {call.camOn ? <VideocamIcon /> : <VideocamOffIcon />}
          </button>
          <button
            type="button"
            aria-label={call.screenSharing ? "Stop sharing" : "Share screen"}
            onClick={() => void (call.screenSharing ? call.stopScreenShare() : call.shareScreen())}
            className="w-12 h-12 rounded-full flex items-center justify-center text-white"
            style={{ background: call.screenSharing ? C.primary : "#49454F" }}
          >
            {call.screenSharing ? <StopScreenShareIcon /> : <ScreenShareIcon />}
          </button>
          <button type="button" aria-label="Leave call" onClick={call.hangup}
            className="w-14 h-12 rounded-full flex items-center justify-center text-white px-4" style={{ background: C.error }}>
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
              C={C}
            />
          )}
          {call.videoInputs.length > 0 && (
            <DeviceSelect
              label="Camera"
              value={call.videoInputs[0]?.deviceId || ""}
              onChange={id => void call.switchCam(id)}
              options={call.videoInputs}
              C={C}
            />
          )}
          {call.audioOutputs.length > 0 && (
            <DeviceSelect
              label="Speaker"
              value={call.selectedOutputId || call.audioOutputs[0]?.deviceId || ""}
              onChange={id => void call.setAudioOutput(id)}
              options={call.audioOutputs}
              C={C}
            />
          )}
        </div>
      </div>
    </div>
  );
}
