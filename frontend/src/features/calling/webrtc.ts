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
 * 1:1 WebRTC peer — role-independent media.
 *
 * Layout: 1 audio + 1 video (sendrecv).
 * Screen share: replaceTrack(camera ↔ screen) + renegotiation so the
 * answerer (callee) can transmit, not only the offerer (caller).
 */
export class CallPeer {
  pc: RTCPeerConnection;
  localStream: MediaStream | null = null;
  cameraTrack: MediaStreamTrack | null = null;
  screenTrack: MediaStreamTrack | null = null;

  private makingOffer = false;
  private polite: boolean;
  private closed = false;
  /** Renegotiate again once signaling returns to stable. */
  private pendingNegotiate = false;

  private audioTransceiver: RTCRtpTransceiver;
  private videoTransceiver: RTCRtpTransceiver;
  private audioSender: RTCRtpSender;
  private videoSender: RTCRtpSender;

  private remoteAudio: MediaStreamTrack | null = null;
  private remoteVideo: MediaStreamTrack | null = null;
  private sendingScreen = false;

  constructor(
    private handlers: PeerHandlers,
    polite: boolean,
  ) {
    this.polite = polite;
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this.audioTransceiver = this.pc.addTransceiver("audio", { direction: "sendrecv" });
    this.videoTransceiver = this.pc.addTransceiver("video", { direction: "sendrecv" });
    this.audioSender = this.audioTransceiver.sender;
    this.videoSender = this.videoTransceiver.sender;

    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.handlers.onSignal({ kind: "ice", candidate: e.candidate.toJSON() });
      }
    };

    this.pc.ontrack = (e) => {
      const track = e.track;
      webrtcLog("remote track received", {
        kind: track.kind,
        id: track.id,
        muted: track.muted,
        readyState: track.readyState,
        mid: e.transceiver.mid,
      });

      if (e.transceiver === this.audioTransceiver || track.kind === "audio") {
        if (track.kind === "audio") this.remoteAudio = track;
      } else if (e.transceiver === this.videoTransceiver || track.kind === "video") {
        this.remoteVideo = track;
      }

      this.emitRemote();
      track.onunmute = () => {
        webrtcLog("remote track unmute", track.kind, track.id);
        this.emitRemote();
      };
      track.onmute = () => this.emitRemote();
      track.onended = () => {
        if (this.remoteVideo === track) this.remoteVideo = null;
        if (this.remoteAudio === track) this.remoteAudio = null;
        this.emitRemote();
      };
    };

    this.pc.onconnectionstatechange = () => {
      webrtcLog("connectionState", this.pc.connectionState);
      this.handlers.onConnectionState?.(this.pc.connectionState);
    };

    this.pc.onsignalingstatechange = () => {
      webrtcLog("signalingState", this.pc.signalingState);
    };

    this.pc.oniceconnectionstatechange = () => {
      webrtcLog("iceConnectionState", this.pc.iceConnectionState);
    };
  }

  private emitRemote() {
    // Prefer live receiver tracks after renegotiation.
    try {
      const a = this.audioTransceiver.receiver.track;
      const v = this.videoTransceiver.receiver.track;
      if (a && a.readyState !== "ended") this.remoteAudio = a;
      if (v && v.readyState !== "ended") this.remoteVideo = v;
    } catch { /* closed */ }

    const tracks = [this.remoteAudio, this.remoteVideo].filter(
      (t): t is MediaStreamTrack => !!t && t.readyState !== "ended",
    );
    this.handlers.onRemoteStream(new MediaStream(tracks));
  }

  private assertCanMutateMedia(action: string) {
    if (this.closed || this.pc.signalingState === "closed") {
      throw new Error("Call is not connected");
    }
    const conn = this.pc.connectionState;
    if (conn === "closed" || conn === "failed") {
      throw new Error("Call connection is not available");
    }
    if (!this.videoSender) {
      throw new Error("Video sender unavailable");
    }
    webrtcLog("assertCanMutateMedia ok", action, {
      connectionState: conn,
      signalingState: this.pc.signalingState,
      iceConnectionState: this.pc.iceConnectionState,
      polite: this.polite,
    });
  }

  async setLocalStream(stream: MediaStream, withVideo: boolean) {
    this.localStream = stream;
    const audio = stream.getAudioTracks()[0] || null;
    const video = stream.getVideoTracks()[0] || null;
    this.cameraTrack = video;

    if (audio) await this.audioSender.replaceTrack(audio);
    if (withVideo && video) {
      video.enabled = true;
      await this.videoSender.replaceTrack(video);
    } else if (video) {
      video.enabled = false;
      await this.videoSender.replaceTrack(video);
    } else {
      await this.videoSender.replaceTrack(null);
    }
    // Keep direction sendrecv so either peer can later attach a screen track.
    try {
      this.videoTransceiver.direction = "sendrecv";
    } catch { /* */ }
  }

  async createOffer() {
    if (this.closed) return;
    this.makingOffer = true;
    try {
      webrtcLog("createOffer", { polite: this.polite, signalingState: this.pc.signalingState });
      await this.pc.setLocalDescription(await this.pc.createOffer());
      if (this.pc.localDescription) {
        this.handlers.onSignal({ kind: "offer", sdp: this.pc.localDescription });
      }
    } finally {
      this.makingOffer = false;
    }
  }

  /**
   * Perfect negotiation: either peer may create an offer (screen-share renegotiation).
   * Polite peer rolls back on glare; impolite peer ignores colliding remote offers.
   */
  private async renegotiate(reason: string) {
    if (this.closed) return;
    webrtcLog("renegotiate", reason, {
      signalingState: this.pc.signalingState,
      polite: this.polite,
    });
    if (this.pc.signalingState !== "stable") {
      this.pendingNegotiate = true;
      webrtcLog("renegotiate deferred until stable");
      return;
    }
    try {
      await this.createOffer();
    } catch (err) {
      this.pendingNegotiate = true;
      webrtcLog("renegotiate error", err);
      throw err;
    }
  }

  private async flushPendingNegotiate() {
    if (!this.pendingNegotiate || this.closed) return;
    if (this.pc.signalingState !== "stable") return;
    this.pendingNegotiate = false;
    webrtcLog("flush pending renegotiate");
    try {
      await this.createOffer();
    } catch (err) {
      this.pendingNegotiate = true;
      webrtcLog("flush renegotiate error", err);
    }
  }

  async handleSignal(signal: IceSignal) {
    if (this.closed) return;

    if (signal.kind === "ice") {
      try {
        await this.pc.addIceCandidate(signal.candidate);
      } catch {
        /* ignore late/bad ICE */
      }
      return;
    }

    const description = signal.sdp;
    const offerCollision =
      signal.kind === "offer"
      && (this.makingOffer || this.pc.signalingState !== "stable");

    const ignoreOffer = !this.polite && offerCollision;
    if (ignoreOffer) {
      webrtcLog("ignore colliding offer (impolite)");
      return;
    }

    try {
      if (offerCollision) {
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
      await this.flushPendingNegotiate();
    } catch (err) {
      webrtcLog("handleSignal error", signal.kind, err);
      throw err;
    }
  }

  setMicEnabled(on: boolean) {
    this.localStream?.getAudioTracks().forEach(t => { t.enabled = on; });
    if (this.audioSender.track) this.audioSender.track.enabled = on;
  }

  setCamEnabled(on: boolean) {
    if (this.cameraTrack) this.cameraTrack.enabled = on;
    if (!this.sendingScreen) {
      this.localStream?.getVideoTracks().forEach(t => { t.enabled = on; });
      if (this.videoSender.track) this.videoSender.track.enabled = on;
    }
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
      this.cameraTrack = newTrack;
      if (!this.sendingScreen) {
        await this.videoSender.replaceTrack(newTrack);
      }
    }
    if (old && old !== this.screenTrack) {
      this.localStream.removeTrack(old);
      old.stop();
    }
    if (newTrack) this.localStream.addTrack(newTrack);
    next.getAudioTracks().forEach(t => t.stop());
  }

  /**
   * Start screen share — identical for caller and callee:
   * getDisplayMedia → replaceTrack → ensure sendrecv → renegotiate.
   */
  async startScreenShare(): Promise<MediaStreamTrack> {
    this.assertCanMutateMedia("startScreenShare");

    if (typeof navigator.mediaDevices?.getDisplayMedia !== "function") {
      const err = new Error("Screen sharing is not supported in this browser.");
      (err as Error & { name: string }).name = "NotSupportedError";
      throw err;
    }

    webrtcLog("screen share start", { polite: this.polite });

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

    if (this.screenTrack) {
      try { this.screenTrack.stop(); } catch { /* */ }
    }

    try {
      this.videoTransceiver.direction = "sendrecv";
    } catch { /* */ }

    this.screenTrack = track;
    this.sendingScreen = true;

    webrtcLog("replacing video sender track with screen", {
      trackId: track.id,
      prevSenderTrack: this.videoSender.track?.id ?? null,
      currentDirection: this.videoTransceiver.currentDirection,
    });

    try {
      await this.videoSender.replaceTrack(track);
    } catch (e) {
      this.sendingScreen = false;
      this.screenTrack = null;
      try { track.stop(); } catch { /* */ }
      webrtcLog("replaceTrack failed", e);
      throw new Error("Could not switch to screen share.");
    }

    // Critical for the answerer: activate/send on the video m-line.
    try {
      await this.renegotiate("screen-share-start");
    } catch (e) {
      webrtcLog("screen-share renegotiation failed (track still attached)", e);
      // Keep local screen attached; remote may still get frames after a later stable renegotiate.
      this.pendingNegotiate = true;
    }

    track.onended = () => {
      webrtcLog("screen track ended by browser UI");
      void this.stopScreenShare();
    };

    webrtcLog("screen share active");
    return track;
  }

  /** Restore camera (or null) on the outbound video sender + renegotiate. */
  async stopScreenShare(): Promise<void> {
    webrtcLog("screen share stop");
    if (this.screenTrack) {
      this.screenTrack.onended = null;
      try { this.screenTrack.stop(); } catch { /* */ }
      this.screenTrack = null;
    }
    this.sendingScreen = false;

    if (!this.closed && this.pc.signalingState !== "closed") {
      const cam = this.cameraTrack && this.cameraTrack.readyState === "live" ? this.cameraTrack : null;
      try {
        this.videoTransceiver.direction = "sendrecv";
      } catch { /* */ }
      try {
        await this.videoSender.replaceTrack(cam);
        webrtcLog("restored camera track", cam?.id ?? null);
      } catch (e) {
        webrtcLog("restore camera replaceTrack failed", e);
      }
      try {
        await this.renegotiate("screen-share-stop");
      } catch (e) {
        webrtcLog("stop-share renegotiation failed", e);
        this.pendingNegotiate = true;
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
    if (!this.screenTrack || this.screenTrack.readyState !== "live") return null;
    const audio = this.localStream?.getAudioTracks() || [];
    return new MediaStream([this.screenTrack, ...audio]);
  }

  buildRemoteViewStream(_prefer: "auto" | "camera" | "screen"): MediaStream | null {
    try {
      const a = this.audioTransceiver.receiver.track;
      const v = this.videoTransceiver.receiver.track;
      if (a && a.readyState !== "ended") this.remoteAudio = a;
      if (v && v.readyState !== "ended") this.remoteVideo = v;
    } catch { /* closed */ }
    const audio = this.remoteAudio ? [this.remoteAudio] : [];
    if (this.remoteVideo && this.remoteVideo.readyState === "live") {
      return new MediaStream([...audio, this.remoteVideo]);
    }
    if (audio.length) return new MediaStream(audio);
    return null;
  }

  close() {
    this.closed = true;
    this.pendingNegotiate = false;
    try {
      if (this.screenTrack) {
        this.screenTrack.onended = null;
        this.screenTrack.stop();
        this.screenTrack = null;
      }
      this.sendingScreen = false;
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
