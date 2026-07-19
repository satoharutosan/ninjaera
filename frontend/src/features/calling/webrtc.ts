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

/** Black canvas track so voice calls still negotiate a sendrecv video m-line. */
function createPlaceholderVideoTrack(): { track: MediaStreamTrack; dispose: () => void } {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  const paint = () => {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 16, 16);
  };
  paint();
  const stream = canvas.captureStream(2);
  const track = stream.getVideoTracks()[0];
  if (!track) throw new Error("No placeholder track");
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
 * One audio + one video m-line. Screen share swaps the *same* outbound video
 * sender via replaceTrack(camera ↔ screen). The remote video element already
 * bound to that RTP stream updates in place — no second m-line, no display switch.
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
  private videoTransceiver: RTCRtpTransceiver;
  private audioSender: RTCRtpSender;
  private videoSender: RTCRtpSender;

  private remoteAudio: MediaStreamTrack | null = null;
  private remoteVideo: MediaStreamTrack | null = null;

  private placeholder: { track: MediaStreamTrack; dispose: () => void } | null = null;
  private sendingScreen = false;
  /** Camera (or placeholder) restored when screen share ends. */
  private outboundBaseTrack: MediaStreamTrack | null = null;

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
      webrtcLog("Remote track received", {
        kind: track.kind,
        id: track.id.slice(0, 10),
        mid: e.transceiver.mid,
        muted: track.muted,
        readyState: track.readyState,
      });

      if (track.kind === "audio" || e.transceiver === this.audioTransceiver) {
        if (track.kind === "audio") this.remoteAudio = track;
      } else {
        this.remoteVideo = track;
      }

      this.emitRemote();
      track.onunmute = () => {
        webrtcLog("Remote track unmute", track.kind);
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
  }

  private syncReceivers() {
    try {
      const a = this.audioTransceiver.receiver.track;
      const v = this.videoTransceiver.receiver.track;
      if (a?.readyState === "live") this.remoteAudio = a;
      if (v?.readyState === "live") this.remoteVideo = v;
    } catch { /* */ }
  }

  private emitRemote() {
    this.syncReceivers();
    const tracks = [this.remoteAudio, this.remoteVideo].filter(
      (t): t is MediaStreamTrack => !!t && t.readyState !== "ended",
    );
    const stream = new MediaStream(tracks);
    webrtcLog("Remote stream attached", {
      audio: !!this.remoteAudio,
      video: !!this.remoteVideo,
      videoMuted: this.remoteVideo?.muted,
    });
    this.handlers.onRemoteStream(stream);
  }

  private assertCanMutateMedia() {
    if (this.closed || this.pc.signalingState === "closed") {
      throw new Error("Call is not connected");
    }
    if (this.pc.connectionState === "closed" || this.pc.connectionState === "failed") {
      throw new Error("Call connection is not available");
    }
    if (!this.videoSender) throw new Error("Video sender unavailable");
  }

  /**
   * If the answerer never negotiated sending on video, replaceTrack alone won't
   * transmit. Renegotiate once to flip the m-line to sendrecv.
   */
  private async ensureSendingAfterReplace() {
    const dir = this.videoTransceiver.currentDirection;
    webrtcLog("video currentDirection after replace", dir);
    if (dir === "sendrecv" || dir === "sendonly") return;
    if (this.pc.signalingState !== "stable") {
      webrtcLog("skip renegotiate — not stable", this.pc.signalingState);
      return;
    }
    try {
      this.videoTransceiver.direction = "sendrecv";
    } catch { /* */ }
    webrtcLog("Renegotiation started (activate send on video m-line)");
    await this.createOffer();
  }

  async setLocalStream(stream: MediaStream, withVideo: boolean) {
    this.localStream = stream;
    const audio = stream.getAudioTracks()[0] || null;
    const video = stream.getVideoTracks()[0] || null;
    this.cameraTrack = video;

    if (audio) await this.audioSender.replaceTrack(audio);

    // Always put a live track on the video sender before the first offer/answer
    // so BOTH peers negotiate sendrecv (fixes callee screen share).
    let outbound: MediaStreamTrack | null = null;
    if (withVideo && video) {
      video.enabled = true;
      outbound = video;
    } else if (video) {
      video.enabled = false;
      outbound = video;
    } else {
      if (!this.placeholder) this.placeholder = createPlaceholderVideoTrack();
      outbound = this.placeholder.track;
    }

    this.outboundBaseTrack = outbound;
    await this.videoSender.replaceTrack(outbound);
    try {
      this.videoTransceiver.direction = "sendrecv";
    } catch { /* */ }

    webrtcLog("Local video sender ready", {
      trackId: outbound?.id.slice(0, 10),
      withVideo,
      hasCamera: !!video,
    });
  }

  async createOffer() {
    if (this.closed) return;
    this.makingOffer = true;
    try {
      webrtcLog("Creating offer", { polite: this.polite });
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
      } catch { /* */ }
      return;
    }

    const description = signal.sdp;
    const offerCollision =
      signal.kind === "offer"
      && (this.makingOffer || this.pc.signalingState !== "stable");

    if (offerCollision) {
      if (!this.polite) {
        webrtcLog("Ignore colliding offer (impolite)");
        return;
      }
      await Promise.all([
        this.pc.setLocalDescription({ type: "rollback" }),
        this.pc.setRemoteDescription(description),
      ]);
    } else {
      await this.pc.setRemoteDescription(description);
    }

    if (signal.kind === "offer") {
      webrtcLog("Receiving offer → creating answer");
      await this.pc.setLocalDescription(await this.pc.createAnswer());
      if (this.pc.localDescription) {
        this.handlers.onSignal({ kind: "answer", sdp: this.pc.localDescription });
      }
    } else {
      webrtcLog("Receiving answer");
    }

    this.emitRemote();
  }

  setMicEnabled(on: boolean) {
    this.localStream?.getAudioTracks().forEach(t => { t.enabled = on; });
    if (this.audioSender.track) this.audioSender.track.enabled = on;
  }

  setCamEnabled(on: boolean) {
    if (this.cameraTrack) this.cameraTrack.enabled = on;
    if (!this.sendingScreen) {
      this.localStream?.getVideoTracks().forEach(t => { t.enabled = on; });
      if (this.videoSender.track && this.videoSender.track === this.cameraTrack) {
        this.videoSender.track.enabled = on;
      }
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
      this.outboundBaseTrack = newTrack;
      if (!this.sendingScreen) {
        await this.videoSender.replaceTrack(newTrack);
      }
    }
    if (old && old !== this.screenTrack && old !== this.placeholder?.track) {
      this.localStream.removeTrack(old);
      old.stop();
    }
    if (newTrack) this.localStream.addTrack(newTrack);
    next.getAudioTracks().forEach(t => t.stop());
  }

  /**
   * Replace the outbound video sender track with the screen capture.
   * Same code path for caller and callee.
   */
  async startScreenShare(): Promise<MediaStreamTrack> {
    this.assertCanMutateMedia();

    if (typeof navigator.mediaDevices?.getDisplayMedia !== "function") {
      const err = new Error("Screen sharing is not supported in this browser.");
      (err as Error & { name: string }).name = "NotSupportedError";
      throw err;
    }

    webrtcLog("ScreenShare started", { polite: this.polite });

    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 15 },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
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
    if (!track || track.readyState !== "live") {
      throw new Error("No active screen track");
    }
    track.enabled = true;
    try {
      track.contentHint = "detail";
    } catch { /* */ }

    webrtcLog("Created track", {
      id: track.id.slice(0, 10),
      readyState: track.readyState,
      enabled: track.enabled,
      muted: track.muted,
      settings: track.getSettings?.(),
    });

    if (this.screenTrack) {
      try {
        this.screenTrack.onended = null;
        this.screenTrack.stop();
      } catch { /* */ }
    }

    // Keep camera/placeholder as restore target; do not stop camera.
    this.screenTrack = track;
    this.sendingScreen = true;

    webrtcLog("Replacing sender track", {
      sender: "video",
      prev: this.videoSender.track?.id?.slice(0, 10) ?? null,
      next: track.id.slice(0, 10),
      direction: this.videoTransceiver.currentDirection,
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

    // Verify attachment
    if (this.videoSender.track !== track) {
      webrtcLog("WARNING: sender.track !== screen track after replace");
    }

    await this.ensureSendingAfterReplace();

    track.onended = () => {
      webrtcLog("Screen track ended by browser UI");
      void this.stopScreenShare();
    };

    webrtcLog("Screen share active", {
      senderTrack: this.videoSender.track?.id?.slice(0, 10),
      direction: this.videoTransceiver.currentDirection,
    });
    return track;
  }

  async stopScreenShare(): Promise<void> {
    webrtcLog("ScreenShare stopped");
    if (this.screenTrack) {
      this.screenTrack.onended = null;
      try { this.screenTrack.stop(); } catch { /* */ }
      this.screenTrack = null;
    }
    this.sendingScreen = false;

    if (!this.closed && this.pc.signalingState !== "closed") {
      let restore = this.outboundBaseTrack;
      if (!restore || restore.readyState === "ended") {
        if (this.cameraTrack && this.cameraTrack.readyState === "live") {
          restore = this.cameraTrack;
        } else {
          if (!this.placeholder || this.placeholder.track.readyState === "ended") {
            this.placeholder?.dispose();
            this.placeholder = createPlaceholderVideoTrack();
          }
          restore = this.placeholder.track;
        }
        this.outboundBaseTrack = restore;
      }
      try {
        await this.videoSender.replaceTrack(restore);
        webrtcLog("Camera track restored", restore?.id.slice(0, 10));
        await this.ensureSendingAfterReplace();
      } catch (e) {
        webrtcLog("restore camera failed", e);
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
    const audio = this.localStream?.getAudioTracks() || [];
    return new MediaStream([this.screenTrack, ...audio]);
  }

  /** Always the remote camera/video m-line — screen frames arrive on the same track via replaceTrack. */
  buildRemoteViewStream(_prefer: "auto" | "camera" | "screen"): MediaStream | null {
    this.syncReceivers();
    const audio = this.remoteAudio ? [this.remoteAudio] : [];
    if (this.remoteVideo && this.remoteVideo.readyState === "live") {
      return new MediaStream([...audio, this.remoteVideo]);
    }
    if (audio.length) return new MediaStream(audio);
    return null;
  }

  close() {
    this.closed = true;
    try {
      if (this.screenTrack) {
        this.screenTrack.onended = null;
        this.screenTrack.stop();
        this.screenTrack = null;
      }
      this.sendingScreen = false;
      this.placeholder?.dispose();
      this.placeholder = null;
      this.outboundBaseTrack = null;
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
