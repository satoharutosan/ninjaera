import { ICE_SERVERS, type IceSignal } from "./types";

export type PeerHandlers = {
  onRemoteStream: (stream: MediaStream) => void;
  onHasRemoteScreen?: (has: boolean) => void;
  onConnectionState?: (state: RTCPeerConnectionState) => void;
  onSignal: (signal: IceSignal) => void;
  onScreenShareStopped?: () => void;
};

const isDev = typeof import.meta !== "undefined" && !!(import.meta as { env?: { DEV?: boolean } }).env?.DEV;

function webrtcLog(...args: unknown[]) {
  if (isDev) console.log("[WebRTC]", ...args);
}

/**
 * Tiny always-on black video track so the screen m-line is negotiated as
 * sendrecv for BOTH caller and callee. Screen share then uses replaceTrack
 * only — no renegotiation (which previously regressed both directions).
 */
function createPlaceholderVideoTrack(): { track: MediaStreamTrack; dispose: () => void } {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas unavailable for screen placeholder");
  }
  const paint = () => {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };
  paint();
  const stream = canvas.captureStream(2);
  const track = stream.getVideoTracks()[0];
  if (!track) throw new Error("Failed to create placeholder video track");
  try {
    track.contentHint = "detail";
  } catch { /* */ }
  const timer = window.setInterval(paint, 1000);
  return {
    track,
    dispose: () => {
      window.clearInterval(timer);
      try { track.stop(); } catch { /* */ }
    },
  };
}

/**
 * 1:1 WebRTC peer — role-independent.
 *
 * Transceivers (created symmetrically before the first offer):
 *   0 audio, 1 camera video, 2 screen video (placeholder until share)
 *
 * Screen share: replaceTrack on the screen sender only. No renegotiation.
 */
export class CallPeer {
  pc: RTCPeerConnection;
  localStream: MediaStream | null = null;
  cameraTrack: MediaStreamTrack | null = null;
  screenTrack: MediaStreamTrack | null = null;

  private makingOffer = false;
  private polite: boolean;
  private closed = false;

  private audioTransceiver: RTCRtpTransceiver;
  private cameraTransceiver: RTCRtpTransceiver;
  private screenTransceiver: RTCRtpTransceiver;
  private audioSender: RTCRtpSender;
  private cameraSender: RTCRtpSender;
  private screenSender: RTCRtpSender;

  private remoteAudio: MediaStreamTrack | null = null;
  private remoteCamera: MediaStreamTrack | null = null;
  private remoteScreen: MediaStreamTrack | null = null;

  private placeholder: { track: MediaStreamTrack; dispose: () => void } | null = null;
  private sendingScreen = false;

  constructor(
    private handlers: PeerHandlers,
    polite: boolean,
  ) {
    this.polite = polite;
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this.audioTransceiver = this.pc.addTransceiver("audio", { direction: "sendrecv" });
    this.cameraTransceiver = this.pc.addTransceiver("video", { direction: "sendrecv" });
    this.screenTransceiver = this.pc.addTransceiver("video", { direction: "sendrecv" });
    this.audioSender = this.audioTransceiver.sender;
    this.cameraSender = this.cameraTransceiver.sender;
    this.screenSender = this.screenTransceiver.sender;

    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.handlers.onSignal({ kind: "ice", candidate: e.candidate.toJSON() });
      }
    };

    this.pc.ontrack = (e) => {
      const track = e.track;
      webrtcLog("remote track", {
        kind: track.kind,
        id: track.id.slice(0, 8),
        mid: e.transceiver.mid,
        muted: track.muted,
      });

      if (e.transceiver === this.audioTransceiver || track.kind === "audio") {
        if (track.kind === "audio") this.remoteAudio = track;
      } else if (e.transceiver === this.screenTransceiver) {
        this.remoteScreen = track;
      } else if (e.transceiver === this.cameraTransceiver) {
        this.remoteCamera = track;
      } else if (track.kind === "video") {
        const idx = this.pc.getTransceivers().indexOf(e.transceiver);
        if (idx === 2) this.remoteScreen = track;
        else this.remoteCamera = track;
      }

      this.emitRemote();
      track.onunmute = () => {
        webrtcLog("remote unmute", track.kind);
        this.emitRemote();
      };
      track.onmute = () => this.emitRemote();
      track.onended = () => {
        if (this.remoteCamera === track) this.remoteCamera = null;
        if (this.remoteScreen === track) this.remoteScreen = null;
        if (this.remoteAudio === track) this.remoteAudio = null;
        this.emitRemote();
      };
    };

    this.pc.onconnectionstatechange = () => {
      webrtcLog("connectionState", this.pc.connectionState);
      this.handlers.onConnectionState?.(this.pc.connectionState);
    };
  }

  private syncReceivers() {
    try {
      const a = this.audioTransceiver.receiver.track;
      const c = this.cameraTransceiver.receiver.track;
      const s = this.screenTransceiver.receiver.track;
      if (a?.readyState === "live") this.remoteAudio = a;
      if (c?.readyState === "live") this.remoteCamera = c;
      if (s?.readyState === "live") this.remoteScreen = s;
    } catch { /* closed */ }
  }

  private emitRemote() {
    this.syncReceivers();
    const tracks = [this.remoteAudio, this.remoteCamera, this.remoteScreen].filter(
      (t): t is MediaStreamTrack => !!t && t.readyState !== "ended",
    );
    this.handlers.onRemoteStream(new MediaStream(tracks));
  }

  private assertCanMutateMedia() {
    if (this.closed || this.pc.signalingState === "closed") {
      throw new Error("Call is not connected");
    }
    if (this.pc.connectionState === "closed" || this.pc.connectionState === "failed") {
      throw new Error("Call connection is not available");
    }
    if (!this.screenSender) {
      throw new Error("Screen sender unavailable");
    }
  }

  async setLocalStream(stream: MediaStream, withVideo: boolean) {
    this.localStream = stream;
    const audio = stream.getAudioTracks()[0] || null;
    const video = stream.getVideoTracks()[0] || null;
    this.cameraTrack = video;

    if (audio) await this.audioSender.replaceTrack(audio);

    if (withVideo && video) {
      video.enabled = true;
      await this.cameraSender.replaceTrack(video);
    } else if (video) {
      video.enabled = false;
      await this.cameraSender.replaceTrack(video);
    } else {
      await this.cameraSender.replaceTrack(null);
    }

    // Placeholder keeps the screen m-line sendrecv for caller AND callee.
    if (!this.placeholder) {
      this.placeholder = createPlaceholderVideoTrack();
      webrtcLog("screen placeholder attached");
    }
    await this.screenSender.replaceTrack(this.placeholder.track);

    try {
      this.cameraTransceiver.direction = "sendrecv";
      this.screenTransceiver.direction = "sendrecv";
    } catch { /* */ }
  }

  async createOffer() {
    if (this.closed) return;
    this.makingOffer = true;
    try {
      webrtcLog("createOffer", { polite: this.polite });
      await this.pc.setLocalDescription(await this.pc.createOffer());
      if (this.pc.localDescription) {
        this.handlers.onSignal({ kind: "offer", sdp: this.pc.localDescription });
      }
    } finally {
      this.makingOffer = false;
    }
  }

  async handleSignal(signal: IceSignal) {
    if (this.closed) return;

    if (signal.kind === "ice") {
      try {
        await this.pc.addIceCandidate(signal.candidate);
      } catch { /* ignore */ }
      return;
    }

    const description = signal.sdp;
    const offerCollision =
      signal.kind === "offer"
      && (this.makingOffer || this.pc.signalingState !== "stable");

    if (offerCollision) {
      if (!this.polite) {
        webrtcLog("ignore colliding offer (impolite)");
        return;
      }
      webrtcLog("glare — polite rollback");
      await Promise.all([
        this.pc.setLocalDescription({ type: "rollback" }),
        this.pc.setRemoteDescription(description),
      ]);
    } else {
      await this.pc.setRemoteDescription(description);
    }

    if (signal.kind === "offer") {
      await this.pc.setLocalDescription(await this.pc.createAnswer());
      if (this.pc.localDescription) {
        this.handlers.onSignal({ kind: "answer", sdp: this.pc.localDescription });
      }
    }

    this.emitRemote();
  }

  setMicEnabled(on: boolean) {
    this.localStream?.getAudioTracks().forEach(t => { t.enabled = on; });
    if (this.audioSender.track) this.audioSender.track.enabled = on;
  }

  setCamEnabled(on: boolean) {
    if (this.cameraTrack) this.cameraTrack.enabled = on;
    this.localStream?.getVideoTracks().forEach(t => { t.enabled = on; });
    if (this.cameraSender.track) this.cameraSender.track.enabled = on;
  }

  async replaceAudioInput(deviceId: string) {
    if (!this.localStream) return;
    const next = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: deviceId } },
      video: false,
    });
    const newTrack = next.getAudioTracks()[0];
    const old = this.localStream.getAudioTracks()[0];
    if (newTrack) await this.audioSender.replaceTrack(newTrack);
    if (old) {
      this.localStream.removeTrack(old);
      old.stop();
    }
    if (newTrack) this.localStream.addTrack(newTrack);
    next.getVideoTracks().forEach(t => t.stop());
  }

  async replaceVideoInput(deviceId: string) {
    if (!this.localStream) return;
    const next = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { deviceId: { exact: deviceId } },
    });
    const newTrack = next.getVideoTracks()[0];
    const old = this.cameraTrack || this.localStream.getVideoTracks()[0];
    if (newTrack) {
      await this.cameraSender.replaceTrack(newTrack);
      this.cameraTrack = newTrack;
    }
    if (old) {
      this.localStream.removeTrack(old);
      old.stop();
    }
    if (newTrack) this.localStream.addTrack(newTrack);
    next.getAudioTracks().forEach(t => t.stop());
  }

  /**
   * Screen share — same path for caller and callee.
   * replaceTrack on the pre-negotiated screen sender; no renegotiation.
   */
  async startScreenShare(): Promise<MediaStreamTrack> {
    this.assertCanMutateMedia();

    if (typeof navigator.mediaDevices?.getDisplayMedia !== "function") {
      const err = new Error("Screen sharing is not supported in this browser.");
      (err as Error & { name: string }).name = "NotSupportedError";
      throw err;
    }

    webrtcLog("screen share start", { polite: this.polite, role: this.polite ? "answerer" : "offerer" });

    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15 }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      if (name === "NotAllowedError" || name === "AbortError") {
        const err = new Error("Screen sharing was canceled.");
        (err as Error & { name: string }).name = "NotAllowedError";
        throw err;
      }
      throw e;
    }

    const track = display.getVideoTracks()[0];
    if (!track) throw new Error("No screen track");

    // Stop a previous real screen track if any (not the placeholder).
    if (this.screenTrack && this.screenTrack !== this.placeholder?.track) {
      try {
        this.screenTrack.onended = null;
        this.screenTrack.stop();
      } catch { /* */ }
    }

    this.screenTrack = track;
    this.sendingScreen = true;

    webrtcLog("replacing screen sender track", {
      trackId: track.id.slice(0, 8),
      senderTrack: this.screenSender.track?.id?.slice(0, 8) ?? null,
      direction: this.screenTransceiver.currentDirection,
    });

    try {
      await this.screenSender.replaceTrack(track);
    } catch (e) {
      this.sendingScreen = false;
      this.screenTrack = null;
      try { track.stop(); } catch { /* */ }
      webrtcLog("replaceTrack failed", e);
      throw new Error("Could not switch to screen share.");
    }

    track.onended = () => {
      webrtcLog("screen track ended (browser picker)");
      void this.stopScreenShare();
    };

    webrtcLog("screen share active — no renegotiation");
    return track;
  }

  async stopScreenShare(): Promise<void> {
    webrtcLog("screen share stop");
    if (this.screenTrack && this.screenTrack !== this.placeholder?.track) {
      this.screenTrack.onended = null;
      try { this.screenTrack.stop(); } catch { /* */ }
    }
    this.screenTrack = null;
    this.sendingScreen = false;

    if (!this.closed && this.pc.signalingState !== "closed") {
      // Ensure placeholder still exists for re-attach.
      if (!this.placeholder || this.placeholder.track.readyState === "ended") {
        this.placeholder?.dispose();
        this.placeholder = createPlaceholderVideoTrack();
      }
      try {
        await this.screenSender.replaceTrack(this.placeholder.track);
        webrtcLog("camera/screen placeholder restored on screen sender");
      } catch (e) {
        webrtcLog("restore placeholder failed", e);
      }
    }

    this.handlers.onScreenShareStopped?.();
  }

  isScreenSharing() {
    return this.sendingScreen && !!this.screenTrack && this.screenTrack.readyState === "live";
  }

  getLocalCameraStream(): MediaStream | null {
    if (!this.cameraTrack || this.cameraTrack.readyState !== "live") {
      return this.localStream;
    }
    const audio = this.localStream?.getAudioTracks() || [];
    return new MediaStream([this.cameraTrack, ...audio]);
  }

  getLocalScreenStream(): MediaStream | null {
    if (!this.sendingScreen || !this.screenTrack || this.screenTrack.readyState !== "live") {
      return null;
    }
    if (this.screenTrack === this.placeholder?.track) return null;
    const audio = this.localStream?.getAudioTracks() || [];
    return new MediaStream([this.screenTrack, ...audio]);
  }

  /**
   * Build the stream shown in the remote tile.
   * Prefer screen when `prefer === "screen"` (peer is sharing); otherwise camera.
   * Never prefer the black placeholder — CallProvider drives prefer via media-state.
   */
  buildRemoteViewStream(prefer: "auto" | "camera" | "screen"): MediaStream | null {
    this.syncReceivers();
    const audio = this.remoteAudio ? [this.remoteAudio] : [];
    const cameraOk = !!(this.remoteCamera && this.remoteCamera.readyState === "live");
    const screenOk = !!(this.remoteScreen && this.remoteScreen.readyState === "live");

    if (prefer === "screen" && screenOk && this.remoteScreen) {
      return new MediaStream([...audio, this.remoteScreen]);
    }
    if (prefer === "camera" && cameraOk && this.remoteCamera) {
      return new MediaStream([...audio, this.remoteCamera]);
    }
    // auto → camera first (placeholder screen is black when idle)
    if (cameraOk && this.remoteCamera) {
      return new MediaStream([...audio, this.remoteCamera]);
    }
    if (screenOk && this.remoteScreen) {
      return new MediaStream([...audio, this.remoteScreen]);
    }
    if (audio.length) return new MediaStream(audio);
    return null;
  }

  close() {
    this.closed = true;
    try {
      if (this.screenTrack && this.screenTrack !== this.placeholder?.track) {
        this.screenTrack.onended = null;
        this.screenTrack.stop();
      }
      this.screenTrack = null;
      this.sendingScreen = false;
      this.placeholder?.dispose();
      this.placeholder = null;
      this.localStream?.getTracks().forEach(t => t.stop());
      this.localStream = null;
      this.cameraTrack = null;
      this.pc.getSenders().forEach(s => {
        try { s.track?.stop(); } catch { /* */ }
      });
      this.pc.close();
    } catch { /* */ }
  }
}
