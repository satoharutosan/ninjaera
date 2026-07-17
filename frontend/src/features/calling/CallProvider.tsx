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
} from "@/app/realtime";
import { validateAndGetMedia } from "./devices";
import { CallPeer } from "./webrtc";
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
  remoteStream: MediaStream | null;
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
  shareScreen: () => Promise<void>;
  stopScreenShare: () => Promise<void>;
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
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedOutputId, setSelectedOutputId] = useState("");

  const peerRef = useRef<CallPeer | null>(null);
  const callIdRef = useRef<string | null>(null);
  const isCallerRef = useRef(false);
  const cancelledRef = useRef(false);
  const phaseRef = useRef<CallPhase>("idle");
  const callTypeRef = useRef<CallType>("voice");
  const localViewRef = useRef<VideoViewMode>("auto");
  const remoteViewRef = useRef<VideoViewMode>("auto");
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingStreamRef = useRef<MediaStream | null>(null);

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
    setRemoteStream(peer.buildRemoteViewStream(remoteViewRef.current));
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
    setLocalStream(null);
    setRemoteStream(null);
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    stopRingTimer();
    setElapsedSec(0);
    setConnectionState("new");
    setScreenSharing(false);
    setPeerScreenSharing(false);
    setPeerMicOn(true);
    setPeerCamOn(true);
    setLocalView("auto");
    setRemoteView("auto");
  }, [stopRingTimer]);

  const reset = useCallback((opts?: { keepCancelFlag?: boolean }) => {
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

  const beginMedia = useCallback(async (type: CallType, asCaller: boolean, id: string, stream: MediaStream) => {
    setLocalStream(stream);
    setCamOn(type === "video");
    await refreshDevices();

    const peer = new CallPeer(
      {
        onRemoteStream: () => refreshRemotePreview(),
        onHasRemoteScreen: (has) => {
          setPeerScreenSharing(has);
          if (has && remoteViewRef.current === "auto") refreshRemotePreview();
        },
        onConnectionState: (state) => {
          setConnectionState(state);
          if (state === "failed") {
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
    );
    peerRef.current = peer;
    await peer.setLocalStream(stream, type === "video");
    refreshLocalPreview();
    if (asCaller) {
      await peer.createOffer();
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

    cancelledRef.current = false;
    isCallerRef.current = true;
    setCallType(opts.type);
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
    }
  }, [reset, startRingTimer]);

  const acceptIncoming = useCallback(async () => {
    if (!invite?.callId) return;
    const validation = await validateAndGetMedia(invite.type === "video");
    if (!validation.ok) {
      toast.error(validation.error);
      if (validation.code === "no-cam" && invite.type === "video") {
        toast.message("Tip: ask the caller to switch to a voice call.");
      }
      return;
    }
    try {
      isCallerRef.current = false;
      callIdRef.current = invite.callId;
      setCallId(invite.callId);
      setCallType(invite.type);
      setPhase("connecting");
      stopRingTimer();
      emitCallAccept(invite.callId);
      await beginMedia(invite.type, false, invite.callId, validation.stream);
      setPhase("active");
      tickRef.current = setInterval(() => setElapsedSec(s => s + 1), 1000);
    } catch (e) {
      validation.stream.getTracks().forEach(t => t.stop());
      toast.error(e instanceof Error ? e.message : "Could not start call media");
      emitCallDecline(invite.callId);
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
    if (!invite?.callId) return;
    emitCallIgnore(invite.callId);
    setPhase("ignored");
    toast.message("Call ignored — open the conversation to Accept or Decline.");
  }, [invite]);

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
  }, []);

  const switchCam = useCallback(async (deviceId: string) => {
    await peerRef.current?.replaceVideoInput(deviceId);
    refreshLocalPreview();
  }, [refreshLocalPreview]);

  const setAudioOutput = useCallback(async (deviceId: string) => {
    setSelectedOutputId(deviceId);
  }, []);

  const shareScreen = useCallback(async () => {
    try {
      await peerRef.current?.startScreenShare();
      setScreenSharing(true);
      setLocalView("screen");
      refreshLocalPreview();
      syncMediaState(callIdRef.current, { screenSharing: true });
      toast.success("Sharing screen");
    } catch {
      toast.error("Screen share unavailable");
    }
  }, [refreshLocalPreview]);

  const stopScreenShare = useCallback(async () => {
    await peerRef.current?.stopScreenShare();
    setScreenSharing(false);
    setLocalView("camera");
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

  useEffect(() => {
    const unsubs = [
      onRealtimeEvent<CallInvite>("call:incoming", (data) => {
        if (!data?.callId) return;
        if (phaseRef.current !== "idle" && phaseRef.current !== "ignored") {
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
        if (cancelledRef.current) {
          emitCallHangup(data.callId);
          resetRef.current();
          return;
        }
        if (!isCallerRef.current) return;
        callIdRef.current = data.callId;
        setCallId(data.callId);
        setInvite(prev => prev
          ? { ...prev, callId: data.callId, type: data.type, callerId: data.callerId }
          : data);
        setPhase("outgoing");
      }),
      onRealtimeEvent<{ callId: string; type: CallType }>("call:accepted", async (data) => {
        if (!isCallerRef.current || !data?.callId) return;
        if (callIdRef.current && callIdRef.current !== data.callId) return;
        callIdRef.current = data.callId;
        setCallId(data.callId);
        setPhase("connecting");
        stopRingTimer();
        try {
          let stream = pendingStreamRef.current;
          pendingStreamRef.current = null;
          if (!stream) {
            const validation = await validateAndGetMedia((data.type || callTypeRef.current) === "video");
            if (!validation.ok) {
              toast.error(validation.error);
              emitCallHangup(data.callId);
              resetRef.current();
              return;
            }
            stream = validation.stream;
          }
          await beginMediaRef.current(data.type || callTypeRef.current, true, data.callId, stream);
          setPhase("active");
          if (tickRef.current) clearInterval(tickRef.current);
          tickRef.current = setInterval(() => setElapsedSec(s => s + 1), 1000);
        } catch (e) {
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
        toast.message("Call declined");
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
        else if (reason === "cancelled") toast.message("Call cancelled");
        else if (reason === "busy") toast.message("User is busy");
        else if (reason === "disconnect") toast.message("Call disconnected");
        else if (reason === "offline") toast.message("User is offline");
        resetRef.current();
      }),
      onRealtimeEvent<{ callId: string }>("call:busy", () => {
        if (pendingStreamRef.current) {
          pendingStreamRef.current.getTracks().forEach(t => t.stop());
          pendingStreamRef.current = null;
        }
        resetRef.current();
      }),
      onRealtimeEvent<{ callId: string }>("call:ignored", ({ callId: id }) => {
        if (callIdRef.current === id && phaseRef.current === "incoming") {
          setPhase("ignored");
        }
      }),
      onRealtimeEvent<{ callId: string; signal: IceSignal }>("call:signal", async ({ callId: id, signal }) => {
        if (callIdRef.current && callIdRef.current !== id) return;
        try {
          await peerRef.current?.handleSignal(signal);
        } catch { /* glare */ }
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
          setPeerScreenSharing(data.screenSharing);
          refreshRemotePreview();
        }
      }),
      onRealtimeEvent<{ error: string; code?: string }>("call:error", ({ error, code }) => {
        if (pendingStreamRef.current) {
          pendingStreamRef.current.getTracks().forEach(t => t.stop());
          pendingStreamRef.current = null;
        }
        if (code === "busy") toast.message("User is busy");
        else if (code === "offline") toast.message("User is offline");
        else toast.error(error || "Call failed");
        resetRef.current();
      }),
    ];
    return () => unsubs.forEach(u => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => { cleanupPeer(); }, [cleanupPeer]);

  const value = useMemo<CallContextValue>(() => ({
    phase, invite, callId, callType, elapsedSec, ringingSec, micOn, camOn,
    screenSharing, peerScreenSharing, peerMicOn, peerCamOn, localView, remoteView,
    connectionState, localStream, remoteStream, audioInputs, videoInputs, audioOutputs, selectedOutputId,
    startCall: (opts) => { void startCall(opts); },
    acceptIncoming: () => { void acceptIncoming(); },
    declineIncoming, ignoreIncoming, hangup,
    toggleMic, toggleCam, switchMic, switchCam, setAudioOutput,
    shareScreen, stopScreenShare,
    setLocalView: setLocalViewMode,
    setRemoteView: setRemoteViewMode,
  }), [
    phase, invite, callId, callType, elapsedSec, ringingSec, micOn, camOn,
    screenSharing, peerScreenSharing, peerMicOn, peerCamOn, localView, remoteView,
    connectionState, localStream, remoteStream, audioInputs, videoInputs, audioOutputs, selectedOutputId,
    startCall, acceptIncoming, declineIncoming, ignoreIncoming, hangup,
    toggleMic, toggleCam, switchMic, switchCam, setAudioOutput,
    shareScreen, stopScreenShare, setLocalViewMode, setRemoteViewMode,
  ]);

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}
