import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  emitCallAccept,
  emitCallBusy,
  emitCallDecline,
  emitCallHangup,
  emitCallIgnore,
  emitCallInvite,
  emitCallMediaState,
  emitCallSignal,
  onRealtimeEvent,
  onRealtimeReconnect,
} from "@/app/realtime";
import { validateAndGetMedia } from "./devices";
import { CallPeer } from "./webrtc";
import { resolveIceServers } from "./iceConfig";
import { CALL_OFFLINE_MESSAGE } from "./permissions";
import { getNinja } from "@/shared/electronBridge";
import type { CallInvite, CallPhase, CallType, IceSignal, VideoViewMode } from "./types";

type CallContextValue = {
  phase: CallPhase;
  invite: CallInvite | null;
  callId: string | null;
  callType: CallType;
  elapsedSec: number;
  ringingSec: number;
  micOn: boolean;
  camOn: boolean;
  screenSharing: boolean;
  peerScreenSharing: boolean;
  peerMicOn: boolean;
  peerCamOn: boolean;
  localView: VideoViewMode;
  remoteView: VideoViewMode;
  connectionState: string;
  localStream: MediaStream | null;
  /** Remote video-only stream for the <video> tile (never includes audio). */
  remoteStream: MediaStream | null;
  /** Remote audio-only stream for a dedicated <audio> element. */
  remoteAudioStream: MediaStream | null;
  /** Increments when peer screen-share signaling arrives. */
  remoteBindEpoch: number;
  audioInputs: MediaDeviceInfo[];
  videoInputs: MediaDeviceInfo[];
  audioOutputs: MediaDeviceInfo[];
  selectedOutputId: string;
  startCall: (opts: {
    conversationId: number;
    calleeId: number;
    type: CallType;
    peerName: string;
    peerAvatar?: string | null;
  }) => void;
  acceptIncoming: () => void;
  declineIncoming: () => void;
  ignoreIncoming: () => void;
  hangup: () => void;
  toggleMic: () => void;
  toggleCam: () => void;
  switchMic: (deviceId: string) => Promise<void>;
  switchCam: (deviceId: string) => Promise<void>;
  setAudioOutput: (deviceId: string) => Promise<void>;
  selectedMicId: string;
  selectedCamId: string;
  shareScreen: () => Promise<void>;
  stopScreenShare: () => Promise<void>;
  /** Live WebRTC stats for the active peer (dev diagnostics). */
  getPeerStats: () => Promise<RTCStatsReport> | undefined;
  /** Negotiated video transceiver direction (dev diagnostics). */
  getVideoDirection: () => string | null;
  setLocalView: (mode: VideoViewMode) => void;
  setRemoteView: (mode: VideoViewMode) => void;
};

const CallContext = createContext<CallContextValue | null>(null);

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall requires CallProvider");
  return ctx;
}

export function useCallOptional() {
  return useContext(CallContext);
}

function syncMediaState(
  callId: string | null,
  patch: { micOn?: boolean; camOn?: boolean; screenSharing?: boolean },
) {
  if (!callId) return;
  emitCallMediaState({ callId, ...patch });
}

export function CallProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [invite, setInvite] = useState<CallInvite | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [callType, setCallType] = useState<CallType>("voice");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [ringingSec, setRingingSec] = useState(0);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [peerScreenSharing, setPeerScreenSharing] = useState(false);
  const [peerMicOn, setPeerMicOn] = useState(true);
  const [peerCamOn, setPeerCamOn] = useState(true);
  const [localView, setLocalView] = useState<VideoViewMode>("auto");
  const [remoteView, setRemoteView] = useState<VideoViewMode>("auto");
  const [connectionState, setConnectionState] = useState("new");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [remoteAudioStream, setRemoteAudioStream] = useState<MediaStream | null>(null);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedOutputId, setSelectedOutputId] = useState("");
  /** Bumps when peer screen-share state changes to force <video> rebind. */
  const [remoteBindEpoch, setRemoteBindEpoch] = useState(0);

  const peerRef = useRef<CallPeer | null>(null);
  /** Signals (offer/answer/ice) received before the peer exists — flushed on create. */
  const pendingSignalsRef = useRef<IceSignal[]>([]);
  const callIdRef = useRef<string | null>(null);
  const isCallerRef = useRef(false);
  const cancelledRef = useRef(false);
  /** Bumped on every reset so async accept/beginMedia can abort stale work. */
  const callGenRef = useRef(0);
  const phaseRef = useRef<CallPhase>("idle");
  const callTypeRef = useRef<CallType>("voice");
  const localViewRef = useRef<VideoViewMode>("auto");
  const remoteViewRef = useRef<VideoViewMode>("auto");
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const outgoingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iceRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iceRestartAttemptedRef = useRef(false);
  const pendingStreamRef = useRef<MediaStream | null>(null);
  /** Peer signaled screen share via call:media-state (may precede unmuted frames). */
  const peerAnnouncedScreenRef = useRef(false);
  const [selectedMicId, setSelectedMicId] = useState("");
  const [selectedCamId, setSelectedCamId] = useState("");

  phaseRef.current = phase;
  callTypeRef.current = callType;
  localViewRef.current = localView;
  remoteViewRef.current = remoteView;

  const refreshDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioInputs(devices.filter(d => d.kind === "audioinput"));
      setVideoInputs(devices.filter(d => d.kind === "videoinput"));
      setAudioOutputs(devices.filter(d => d.kind === "audiooutput"));
    } catch { /* */ }
  }, []);

  // Desktop: seed the preferred speaker (audio output) from saved Calls settings.
  useEffect(() => {
    const ninja = getNinja();
    if (!ninja) return;
    ninja.settings
      .getAll()
      .then((s) => {
        const spk = (s as { calls?: { speakerId?: string } })?.calls?.speakerId;
        if (spk && spk !== "default") setSelectedOutputId(spk);
      })
      .catch(() => {});
  }, []);

  const refreshLocalPreview = useCallback(() => {
    const peer = peerRef.current;
    if (!peer) return;
    const mode = localViewRef.current;
    if ((mode === "screen" || (mode === "auto" && peer.isScreenSharing())) && peer.getLocalScreenStream()) {
      setLocalStream(peer.getLocalScreenStream());
    } else {
      setLocalStream(peer.getLocalCameraStream());
    }
  }, []);

  const refreshRemotePreview = useCallback(() => {
    const peer = peerRef.current;
    if (!peer) return;
    setRemoteStream(peer.cloneRemoteViewStream());
    setRemoteAudioStream(peer.cloneRemoteAudioStream());
  }, []);

  const stopRingTimer = useCallback(() => {
    if (ringTickRef.current) {
      clearInterval(ringTickRef.current);
      ringTickRef.current = null;
    }
    setRingingSec(0);
  }, []);

  const startRingTimer = useCallback(() => {
    stopRingTimer();
    setRingingSec(0);
    ringTickRef.current = setInterval(() => setRingingSec(s => s + 1), 1000);
  }, [stopRingTimer]);

  const cleanupPeer = useCallback(() => {
    peerRef.current?.close();
    peerRef.current = null;
    pendingSignalsRef.current = [];
    if (pendingStreamRef.current) {
      pendingStreamRef.current.getTracks().forEach(t => t.stop());
      pendingStreamRef.current = null;
    }
    if (outgoingTimeoutRef.current) {
      clearTimeout(outgoingTimeoutRef.current);
      outgoingTimeoutRef.current = null;
    }
    if (iceRestartTimerRef.current) {
      clearTimeout(iceRestartTimerRef.current);
      iceRestartTimerRef.current = null;
    }
    iceRestartAttemptedRef.current = false;
    setLocalStream(null);
    setRemoteStream(null);
    setRemoteAudioStream(null);
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    stopRingTimer();
    setElapsedSec(0);
    setConnectionState("new");
    setScreenSharing(false);
    setPeerScreenSharing(false);
    peerAnnouncedScreenRef.current = false;
    setRemoteBindEpoch(0);
    setPeerMicOn(true);
    setPeerCamOn(true);
    setLocalView("auto");
    setRemoteView("auto");
    setSelectedMicId("");
    setSelectedCamId("");
  }, [stopRingTimer]);

  const reset = useCallback((opts?: { keepCancelFlag?: boolean }) => {
    callGenRef.current += 1;
    cleanupPeer();
    phaseRef.current = "idle";
    setPhase("idle");
    setInvite(null);
    setCallId(null);
    callIdRef.current = null;
    isCallerRef.current = false;
    if (!opts?.keepCancelFlag) cancelledRef.current = false;
    setMicOn(true);
    setCamOn(false);
  }, [cleanupPeer]);

  const resetRef = useRef(reset);
  resetRef.current = reset;

  const beginMedia = useCallback(async (type: CallType, asCaller: boolean, id: string, stream: MediaStream, gen: number) => {
    if (callGenRef.current !== gen || callIdRef.current !== id) {
      stream.getTracks().forEach(t => t.stop());
      return;
    }
    setLocalStream(stream);
    setCamOn(type === "video");
    const audioId = stream.getAudioTracks()[0]?.getSettings?.().deviceId;
    const videoId = stream.getVideoTracks()[0]?.getSettings?.().deviceId;
    if (audioId) setSelectedMicId(audioId);
    if (videoId) setSelectedCamId(videoId);
    await refreshDevices();
    if (callGenRef.current !== gen || callIdRef.current !== id) {
      stream.getTracks().forEach(t => t.stop());
      return;
    }

    const iceServers = await resolveIceServers();
    if (callGenRef.current !== gen || callIdRef.current !== id) {
      stream.getTracks().forEach(t => t.stop());
      return;
    }

    if (import.meta.env.PROD) {
      const { getLastTurnConfigured } = await import("./iceConfig");
      if (!getLastTurnConfigured() && import.meta.env.DEV === false) {
        // Soft hint once per call session — avoid spamming.
        if (!(window as unknown as { __neTurnWarned?: boolean }).__neTurnWarned) {
          (window as unknown as { __neTurnWarned?: boolean }).__neTurnWarned = true;
          console.warn("[CALL] TURN not configured — connection may fail on restricted networks");
        }
      }
    }

    iceRestartAttemptedRef.current = false;
    const peer = new CallPeer(
      {
        onRemoteStream: () => refreshRemotePreview(),
        onHasRemoteScreen: () => refreshRemotePreview(),
        onConnectionState: (state) => {
          setConnectionState(state);
          if (import.meta.env.DEV) console.info("[CALL] connectionState", state);

          if (state === "connected" || state === "completed") {
            if (iceRestartTimerRef.current) {
              clearTimeout(iceRestartTimerRef.current);
              iceRestartTimerRef.current = null;
            }
            iceRestartAttemptedRef.current = false;
            return;
          }

          if (state === "disconnected") {
            if (iceRestartTimerRef.current) return;
            iceRestartTimerRef.current = setTimeout(() => {
              iceRestartTimerRef.current = null;
              const p = peerRef.current;
              if (!p || callIdRef.current !== id) return;
              if (p.pc.connectionState === "connected" || p.pc.connectionState === "completed") return;
              if (!iceRestartAttemptedRef.current) {
                iceRestartAttemptedRef.current = true;
                if (import.meta.env.DEV) console.info("[ICE] restart after disconnect");
                p.restartIce();
                return;
              }
              toast.message("Connection lost");
              if (callIdRef.current) emitCallHangup(callIdRef.current);
              resetRef.current();
            }, 12_000);
            return;
          }

          if (state === "failed") {
            const p = peerRef.current;
            if (p && !iceRestartAttemptedRef.current) {
              iceRestartAttemptedRef.current = true;
              if (import.meta.env.DEV) console.info("[ICE] restart after failed");
              p.restartIce();
              return;
            }
            toast.error("Connection failed");
            if (callIdRef.current) emitCallHangup(callIdRef.current);
            resetRef.current();
          }
        },
        onSignal: (signal) => emitCallSignal(id, signal),
        onScreenShareStopped: () => {
          setScreenSharing(false);
          setLocalView("camera");
          refreshLocalPreview();
          syncMediaState(callIdRef.current, { screenSharing: false });
        },
      },
      !asCaller,
      iceServers,
    );
    if (callGenRef.current !== gen || callIdRef.current !== id) {
      peer.close();
      stream.getTracks().forEach(t => t.stop());
      return;
    }
    peerRef.current = peer;
    // Attaching tracks here triggers onnegotiationneeded inside CallPeer, which
    // drives the offer (perfect negotiation) — no manual createOffer needed and
    // no track-attach race. Flush any signals that arrived before this point.
    await peer.setLocalStream(stream, type === "video");
    if (callGenRef.current !== gen || callIdRef.current !== id) {
      peer.close();
      if (peerRef.current === peer) peerRef.current = null;
      return;
    }
    refreshLocalPreview();
    const buffered = pendingSignalsRef.current.splice(0);
    for (const sig of buffered) {
      try { await peer.handleSignal(sig); } catch { /* */ }
    }
  }, [refreshDevices, refreshLocalPreview, refreshRemotePreview]);

  const beginMediaRef = useRef(beginMedia);
  beginMediaRef.current = beginMedia;

  const startCall = useCallback(async (opts: {
    conversationId: number;
    calleeId: number;
    type: CallType;
    peerName: string;
    peerAvatar?: string | null;
  }) => {
    if (phaseRef.current !== "idle") {
      toast.message("Already in a call");
      return;
    }

    const validation = await validateAndGetMedia(opts.type === "video");
    if (!validation.ok) {
      toast.error(validation.error);
      if (validation.code === "no-cam" && opts.type === "video") {
        toast.message("Tip: try a voice call instead.");
      }
      return;
    }
    // Hold devices only after invite succeeds — stop stream if invite fails
    const pendingStream = validation.stream;
    const gen = callGenRef.current;

    cancelledRef.current = false;
    isCallerRef.current = true;
    setCallType(opts.type);
    phaseRef.current = "outgoing";
    setPhase("outgoing");
    startRingTimer();
    setInvite({
      callId: "",
      type: opts.type,
      conversationId: opts.conversationId,
      callerId: 0,
      callerName: opts.peerName,
      callerAvatar: opts.peerAvatar,
    });

    // Keep stream alive until accepted.
    pendingStreamRef.current = pendingStream;
    setLocalStream(pendingStream);
    setCamOn(opts.type === "video");
    const audioId = pendingStream.getAudioTracks()[0]?.getSettings?.().deviceId;
    const videoId = pendingStream.getVideoTracks()[0]?.getSettings?.().deviceId;
    if (audioId) setSelectedMicId(audioId);
    if (videoId) setSelectedCamId(videoId);

    const ok = emitCallInvite({
      conversationId: opts.conversationId,
      calleeId: opts.calleeId,
      type: opts.type,
    });
    if (!ok) {
      pendingStream.getTracks().forEach(t => t.stop());
      pendingStreamRef.current = null;
      toast.error("Not connected — try again");
      reset();
      return;
    }

    if (outgoingTimeoutRef.current) clearTimeout(outgoingTimeoutRef.current);
    outgoingTimeoutRef.current = setTimeout(() => {
      outgoingTimeoutRef.current = null;
      if (callGenRef.current !== gen) return;
      if (phaseRef.current !== "outgoing" && phaseRef.current !== "connecting") return;
      if (import.meta.env.DEV) console.info("[CALL] outgoing timeout");
      toast.message("No answer — call ended");
      if (callIdRef.current) emitCallHangup(callIdRef.current);
      else cancelledRef.current = true;
      resetRef.current({ keepCancelFlag: true });
      window.setTimeout(() => { cancelledRef.current = false; }, 4000);
    }, 60_000);
  }, [reset, startRingTimer]);

  const acceptIncoming = useCallback(async () => {
    if (!invite?.callId) return;
    const acceptId = invite.callId;
    const acceptType = invite.type;
    const gen = callGenRef.current;
    const validation = await validateAndGetMedia(acceptType === "video");
    if (!validation.ok) {
      toast.error(validation.error);
      if (validation.code === "no-cam" && acceptType === "video") {
        toast.message("Tip: ask the caller to switch to a voice call.");
      }
      return;
    }
    if (callGenRef.current !== gen || callIdRef.current !== acceptId || phaseRef.current !== "incoming") {
      validation.stream.getTracks().forEach(t => t.stop());
      return;
    }
    try {
      isCallerRef.current = false;
      callIdRef.current = acceptId;
      setCallId(acceptId);
      setCallType(acceptType);
      phaseRef.current = "connecting";
      setPhase("connecting");
      stopRingTimer();
      emitCallAccept(acceptId);
      await beginMedia(acceptType, false, acceptId, validation.stream, gen);
      if (callGenRef.current !== gen || callIdRef.current !== acceptId) {
        return;
      }
      phaseRef.current = "active";
      setPhase("active");
      tickRef.current = setInterval(() => setElapsedSec(s => s + 1), 1000);
    } catch (e) {
      validation.stream.getTracks().forEach(t => t.stop());
      if (callGenRef.current !== gen) return;
      toast.error(e instanceof Error ? e.message : "Could not start call media");
      emitCallDecline(acceptId);
      reset();
    }
  }, [invite, beginMedia, reset, stopRingTimer]);

  const declineIncoming = useCallback(() => {
    const id = (invite?.callId || callIdRef.current || "").trim();
    if (!id) {
      // No signaling id — still clear local UI so the recipient is never stuck.
      reset();
      return;
    }
    // Emit first so the caller receives call:ended / call:declined before we tear down.
    emitCallDecline(id);
    reset();
  }, [invite, reset]);

  const ignoreIncoming = useCallback(() => {
    const id = (invite?.callId || callIdRef.current || "").trim();
    if (!id) {
      reset();
      return;
    }
    // Server ends the ring for both sides; call:ended / call:declined clear UIs.
    emitCallIgnore(id);
    reset();
  }, [invite, reset]);

  const hangup = useCallback(() => {
    cancelledRef.current = true;
    if (pendingStreamRef.current) {
      pendingStreamRef.current.getTracks().forEach(t => t.stop());
      pendingStreamRef.current = null;
    }
    if (callIdRef.current) emitCallHangup(callIdRef.current);
    reset({ keepCancelFlag: true });
    window.setTimeout(() => { cancelledRef.current = false; }, 4000);
  }, [reset]);

  const toggleMic = useCallback(() => {
    setMicOn(on => {
      const next = !on;
      peerRef.current?.setMicEnabled(next);
      syncMediaState(callIdRef.current, { micOn: next });
      return next;
    });
  }, []);

  const toggleCam = useCallback(() => {
    setCamOn(on => {
      const next = !on;
      peerRef.current?.setCamEnabled(next);
      syncMediaState(callIdRef.current, { camOn: next });
      refreshLocalPreview();
      return next;
    });
  }, [refreshLocalPreview]);

  const switchMic = useCallback(async (deviceId: string) => {
    await peerRef.current?.replaceAudioInput(deviceId);
    setSelectedMicId(deviceId);
  }, []);

  const switchCam = useCallback(async (deviceId: string) => {
    await peerRef.current?.replaceVideoInput(deviceId);
    setSelectedCamId(deviceId);
    refreshLocalPreview();
  }, [refreshLocalPreview]);

  const setAudioOutput = useCallback(async (deviceId: string) => {
    setSelectedOutputId(deviceId);
  }, []);

  const shareScreen = useCallback(async () => {
    const peer = peerRef.current;
    if (!peer) {
      toast.error("Call is not connected yet");
      return;
    }
    if (!peer.isMediaReady()) {
      peer.dumpMediaTopology("share-blocked-not-ready");
      toast.message("Wait until the call is fully connected before sharing your screen.");
      return;
    }
    try {
      await peer.startScreenShare();
      setScreenSharing(true);
      setLocalView("screen");
      localViewRef.current = "screen";
      refreshLocalPreview();
      // Notify peer so their UI shows "Screen" even before first remote frame.
      syncMediaState(callIdRef.current, { screenSharing: true });
      toast.success("Sharing screen");
    } catch (e) {
      setScreenSharing(false);
      setLocalView("camera");
      localViewRef.current = "camera";
      refreshLocalPreview();
      syncMediaState(callIdRef.current, { screenSharing: false });
      const name = e instanceof Error ? e.name : "";
      const msg = e instanceof Error ? e.message : "Screen share unavailable";
      if (import.meta.env.DEV) {
        console.error("[WebRTC] screen share failed", {
          callId: callIdRef.current,
          name,
          msg,
          connectionState: peer.pc.connectionState,
          signalingState: peer.pc.signalingState,
          mediaReady: peer.isMediaReady(),
        });
        peer.dumpMediaTopology("share-failed");
      }
      if (name === "NotAllowedError" || name === "AbortError") {
        toast.message("Screen sharing permission was denied.");
      } else if (name === "NotSupportedError" || /not supported/i.test(msg)) {
        toast.error("Screen sharing is not supported in this browser.");
      } else if (/Video sender unavailable/i.test(msg)) {
        toast.error("Video sender unavailable — wait until the call is connected, then try again.");
      } else if (/establish|connection/i.test(msg)) {
        toast.error("Unable to establish screen sharing connection.");
      } else {
        toast.error(msg || "Could not start screen sharing.");
      }
    }
  }, [refreshLocalPreview]);

  const stopScreenShare = useCallback(async () => {
    try {
      await peerRef.current?.stopScreenShare();
    } catch (e) {
      if (import.meta.env.DEV) console.error("[WebRTC] stop screen share failed", e);
    }
    setScreenSharing(false);
    setLocalView("camera");
    localViewRef.current = "camera";
    refreshLocalPreview();
    syncMediaState(callIdRef.current, { screenSharing: false });
  }, [refreshLocalPreview]);

  const setLocalViewMode = useCallback((mode: VideoViewMode) => {
    setLocalView(mode);
    localViewRef.current = mode;
    refreshLocalPreview();
  }, [refreshLocalPreview]);

  const setRemoteViewMode = useCallback((mode: VideoViewMode) => {
    setRemoteView(mode);
    remoteViewRef.current = mode;
    refreshRemotePreview();
  }, [refreshRemotePreview]);

  const getPeerStats = useCallback(() => peerRef.current?.pc.getStats(), []);
  const getVideoDirection = useCallback(() => peerRef.current?.getVideoDirection() ?? null, []);

  useEffect(() => {
    const unsubs = [
      onRealtimeEvent<CallInvite>("call:incoming", (data) => {
        if (!data?.callId) return;
        if (phaseRef.current !== "idle") {
          emitCallBusy(data.callId);
          return;
        }
        isCallerRef.current = false;
        callIdRef.current = data.callId;
        setCallId(data.callId);
        setInvite(data);
        setCallType(data.type);
        setPhase("incoming");
        startRingTimer();
      }),
      onRealtimeEvent<CallInvite>("call:ringing", async (data) => {
        if (!data?.callId) return;
        // Cancel-before-ringing or already idle after hangup — always tear down server call.
        if (cancelledRef.current || phaseRef.current === "idle") {
          if (import.meta.env.DEV) console.info("[SIGNALING] hangup late ringing", data.callId);
          emitCallHangup(data.callId);
          if (cancelledRef.current) resetRef.current();
          return;
        }
        if (!isCallerRef.current) {
          // Not our outgoing invite — ignore (don't hang up someone else's call id).
          return;
        }
        if (outgoingTimeoutRef.current) {
          // Keep timeout until accepted.
        }
        callIdRef.current = data.callId;
        setCallId(data.callId);
        setInvite(prev => prev
          ? { ...prev, callId: data.callId, type: data.type, callerId: data.callerId }
          : data);
        phaseRef.current = "outgoing";
        setPhase("outgoing");
      }),
      onRealtimeEvent<{ callId: string; type: CallType }>("call:accepted", async (data) => {
        if (!isCallerRef.current || !data?.callId) return;
        if (callIdRef.current && callIdRef.current !== data.callId) return;
        const gen = callGenRef.current;
        callIdRef.current = data.callId;
        setCallId(data.callId);
        phaseRef.current = "connecting";
        setPhase("connecting");
        stopRingTimer();
        if (outgoingTimeoutRef.current) {
          clearTimeout(outgoingTimeoutRef.current);
          outgoingTimeoutRef.current = null;
        }
        try {
          let stream = pendingStreamRef.current;
          pendingStreamRef.current = null;
          if (!stream) {
            const validation = await validateAndGetMedia((data.type || callTypeRef.current) === "video");
            if (callGenRef.current !== gen || callIdRef.current !== data.callId) {
              if (validation.ok) validation.stream.getTracks().forEach(t => t.stop());
              return;
            }
            if (!validation.ok) {
              toast.error(validation.error);
              emitCallHangup(data.callId);
              resetRef.current();
              return;
            }
            stream = validation.stream;
          }
          await beginMediaRef.current(data.type || callTypeRef.current, true, data.callId, stream, gen);
          if (callGenRef.current !== gen || callIdRef.current !== data.callId) return;
          phaseRef.current = "active";
          setPhase("active");
          if (tickRef.current) clearInterval(tickRef.current);
          tickRef.current = setInterval(() => setElapsedSec(s => s + 1), 1000);
        } catch (e) {
          if (callGenRef.current !== gen) return;
          toast.error(e instanceof Error ? e.message : "Media error");
          emitCallHangup(data.callId);
          resetRef.current();
        }
      }),
      onRealtimeEvent<{ callId: string }>("call:declined", (data) => {
        if (phaseRef.current === "idle") return;
        if (callIdRef.current && data?.callId && callIdRef.current !== data.callId) return;
        if (pendingStreamRef.current) {
          pendingStreamRef.current.getTracks().forEach(t => t.stop());
          pendingStreamRef.current = null;
        }
        // Toast comes from call:ended (authoritative) to avoid duplicates.
        resetRef.current();
      }),
      onRealtimeEvent<{ callId: string; reason?: string }>("call:ended", (data) => {
        if (phaseRef.current === "idle") return;
        // Outgoing before ringing may have empty callIdRef — still accept end events.
        if (callIdRef.current && data?.callId && callIdRef.current !== data.callId) return;
        if (pendingStreamRef.current) {
          pendingStreamRef.current.getTracks().forEach(t => t.stop());
          pendingStreamRef.current = null;
        }
        const reason = data?.reason;
        if (reason === "declined") toast.message("Call declined");
        else if (reason === "timeout") toast.message("Missed call");
        else if (reason === "cancelled") toast.message("Call canceled");
        else if (reason === "busy") toast.message("User is busy");
        else if (reason === "failed") toast.error("Call failed");
        else if (reason === "disconnect") toast.message("Connection lost");
        else if (reason === "offline") toast.message(CALL_OFFLINE_MESSAGE);
        resetRef.current();
      }),
      onRealtimeEvent<{ callId: string }>("call:busy", (data) => {
        if (callIdRef.current && data?.callId && callIdRef.current !== data.callId) return;
        if (pendingStreamRef.current) {
          pendingStreamRef.current.getTracks().forEach(t => t.stop());
          pendingStreamRef.current = null;
        }
        toast.message("User is busy");
        resetRef.current();
      }),
      onRealtimeEvent<{ callId: string }>("call:ignored", ({ callId: id }) => {
        if (phaseRef.current === "idle") return;
        if (callIdRef.current && id && callIdRef.current !== id) return;
        if (pendingStreamRef.current) {
          pendingStreamRef.current.getTracks().forEach(t => t.stop());
          pendingStreamRef.current = null;
        }
        resetRef.current();
      }),
      onRealtimeEvent<{ callId: string; signal: IceSignal }>("call:signal", async ({ callId: id, signal }) => {
        if (callIdRef.current && callIdRef.current !== id) return;
        const peer = peerRef.current;
        if (!peer) {
          // Offer/answer/ICE can arrive before beginMedia finishes constructing
          // the peer — buffer instead of dropping, or negotiation deadlocks.
          pendingSignalsRef.current.push(signal);
          return;
        }
        try {
          await peer.handleSignal(signal);
          refreshRemotePreview();
        } catch (e) {
          if (import.meta.env.DEV) console.warn("[WebRTC] signal error", e);
        }
      }),
      onRealtimeEvent<{
        callId: string;
        micOn?: boolean;
        camOn?: boolean;
        screenSharing?: boolean;
      }>("call:media-state", (data) => {
        if (callIdRef.current && data.callId !== callIdRef.current) return;
        if (typeof data.micOn === "boolean") setPeerMicOn(data.micOn);
        if (typeof data.camOn === "boolean") setPeerCamOn(data.camOn);
        if (typeof data.screenSharing === "boolean") {
          peerAnnouncedScreenRef.current = data.screenSharing;
          setPeerScreenSharing(data.screenSharing);
          setRemoteBindEpoch(e => e + 1);
          if (import.meta.env.DEV) {
            console.log("[SCREEN_SHARE] peer status", data.screenSharing, {
              remoteTrackId: peerRef.current?.getRemoteVideoTrackId(),
              connectionState: peerRef.current?.pc.connectionState,
            });
          }
          // replaceTrack does not fire ontrack again — bump remoteBindEpoch and
          // refresh so Electron/Chromium re-attach <video> after resolution jumps.
          refreshRemotePreview();
          window.setTimeout(() => refreshRemotePreview(), 200);
          window.setTimeout(() => {
            refreshRemotePreview();
            setRemoteBindEpoch(e => e + 1);
          }, 600);
          window.setTimeout(() => refreshRemotePreview(), 1200);
          window.setTimeout(() => setRemoteBindEpoch(e => e + 1), 2000);
        }
      }),
      onRealtimeEvent<{ error: string; code?: string; callId?: string }>("call:error", ({ error, code }) => {
        if (pendingStreamRef.current) {
          pendingStreamRef.current.getTracks().forEach(t => t.stop());
          pendingStreamRef.current = null;
        }
        // Always clear modals — never leave caller/callee stuck after a signaling error.
        const raw = (error || "").toLowerCase();
        if (code === "busy") toast.message("User is busy");
        else if (code === "offline") toast.message(CALL_OFFLINE_MESSAGE);
        else if (code === "forbidden" || raw.includes("not authorized") || raw.includes("not a participant")) {
          toast.error("Call failed");
        } else if (code === "not_found" || code === "invalid_state") {
          toast.message("Call is no longer available");
        } else if (code === "rate_limited") {
          toast.message("Too many call attempts — try again shortly");
        } else {
          toast.error(error || "Call failed");
        }
        resetRef.current();
      }),
      onRealtimeReconnect(() => {
        const p = phaseRef.current;
        if (p === "idle") return;
        // Active calls with a healthy peer connection survive brief drops.
        if (p === "active") {
          const live = peerRef.current?.pc.connectionState;
          if (live === "connected" || live === "connecting") return;
          if (callIdRef.current) emitCallHangup(callIdRef.current);
          toast.message("Connection lost");
          resetRef.current();
          return;
        }
        // Ringing / outgoing / connecting UIs are usually stale after a socket drop
        // (server cleans calls when the last device disconnects).
        if (callIdRef.current) emitCallHangup(callIdRef.current);
        resetRef.current();
      }),
    ];
    return () => unsubs.forEach(u => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    callGenRef.current += 1;
    cleanupPeer();
  }, [cleanupPeer]);

  const value = useMemo<CallContextValue>(() => ({
    phase, invite, callId, callType, elapsedSec, ringingSec, micOn, camOn,
    screenSharing, peerScreenSharing, peerMicOn, peerCamOn, localView, remoteView,
    connectionState, localStream, remoteStream, remoteAudioStream, remoteBindEpoch,
    audioInputs, videoInputs, audioOutputs, selectedOutputId, selectedMicId, selectedCamId,
    startCall: (opts) => { void startCall(opts); },
    acceptIncoming: () => { void acceptIncoming(); },
    declineIncoming, ignoreIncoming, hangup,
    toggleMic, toggleCam, switchMic, switchCam, setAudioOutput,
    shareScreen, stopScreenShare, getPeerStats, getVideoDirection,
    setLocalView: setLocalViewMode,
    setRemoteView: setRemoteViewMode,
  }), [
    phase, invite, callId, callType, elapsedSec, ringingSec, micOn, camOn,
    screenSharing, peerScreenSharing, peerMicOn, peerCamOn, localView, remoteView,
    connectionState, localStream, remoteStream, remoteAudioStream, remoteBindEpoch,
    audioInputs, videoInputs, audioOutputs, selectedOutputId, selectedMicId, selectedCamId,
    startCall, acceptIncoming, declineIncoming, ignoreIncoming, hangup,
    toggleMic, toggleCam, switchMic, switchCam, setAudioOutput,
    shareScreen, stopScreenShare, getPeerStats, getVideoDirection, setLocalViewMode, setRemoteViewMode,
  ]);

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}
