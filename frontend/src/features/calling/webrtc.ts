import { ICE_SERVERS, type IceSignal } from "./types";

export type PeerHandlers = {
  onRemoteStream: (stream: MediaStream) => void;
  onHasRemoteScreen?: (has: boolean) => void;
  onConnectionState?: (state: RTCPeerConnectionState) => void;
  onSignal: (signal: IceSignal) => void;
  onScreenShareStopped?: () => void;
};

/**
 * 1:1 WebRTC peer.
 * Always negotiates 1 audio + 2 video m-lines so camera and screen can both be live.
 * Screen share uses replaceTrack + renegotiation so caller and callee both send/receive.
 */
export class CallPeer {
  pc: RTCPeerConnection;
  localStream: MediaStream | null = null;
  cameraTrack: MediaStreamTrack | null = null;
  screenTrack: MediaStreamTrack | null = null;
  private makingOffer = false;
  private ignoreOffer = false;
  private polite: boolean;
  private needsRenegotiate = false;
  private closed = false;
  /** Serialize offer/answer so screen-share renegotiation cannot race ICE/glare. */
  private signalingChain: Promise<void> = Promise.resolve();

  private audioTransceiver: RTCRtpTransceiver;
  private cameraTransceiver: RTCRtpTransceiver;
  private screenTransceiver: RTCRtpTransceiver;
  private audioSender: RTCRtpSender;
  private cameraSender: RTCRtpSender;
  private screenSender: RTCRtpSender;

  private remoteAudio: MediaStreamTrack | null = null;
  private remoteCamera: MediaStreamTrack | null = null;
  private remoteScreen: MediaStreamTrack | null = null;

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
      if (e.transceiver === this.audioTransceiver || track.kind === "audio") {
        if (track.kind === "audio") this.remoteAudio = track;
      } else if (e.transceiver === this.screenTransceiver) {
        this.remoteScreen = track;
      } else if (e.transceiver === this.cameraTransceiver) {
        this.remoteCamera = track;
      } else if (track.kind === "video") {
        // Fallback if transceiver identity was lost across renegotiation.
        const idx = this.pc.getTransceivers().indexOf(e.transceiver);
        if (idx === 2) this.remoteScreen = track;
        else this.remoteCamera = track;
      }

      this.emitRemote();
      track.onunmute = () => this.emitRemote();
      track.onmute = () => this.emitRemote();
      track.onended = () => {
        if (this.remoteCamera === track) this.remoteCamera = null;
        if (this.remoteScreen === track) this.remoteScreen = null;
        if (this.remoteAudio === track) this.remoteAudio = null;
        this.emitRemote();
      };
    };

    this.pc.onconnectionstatechange = () => {
      this.handlers.onConnectionState?.(this.pc.connectionState);
    };
  }

  private enqueueSignal(op: () => Promise<void>) {
    this.signalingChain = this.signalingChain.then(op).catch(() => { /* glare / closed */ });
    return this.signalingChain;
  }

  private emitRemote() {
    const tracks = [
      this.remoteAudio,
      this.remoteCamera,
      this.remoteScreen,
    ].filter((t): t is MediaStreamTrack => !!t && t.readyState !== "ended");
    this.handlers.onRemoteStream(new MediaStream(tracks));
    // Live + unmuted screen track = peer is actively sharing frames.
    // media-state also drives peerScreenSharing for UI before the first frame arrives.
    const screenLive = !!(
      this.remoteScreen
      && this.remoteScreen.readyState === "live"
      && !this.remoteScreen.muted
    );
    this.handlers.onHasRemoteScreen?.(screenLive);
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
  }

  async createOffer() {
    if (this.closed) return;
    this.makingOffer = true;
    try {
      const offer = await this.pc.createOffer();
      if (this.pc.signalingState !== "stable" && this.pc.signalingState !== "have-local-offer") {
        this.needsRenegotiate = true;
        return;
      }
      await this.pc.setLocalDescription(offer);
      if (this.pc.localDescription) {
        this.handlers.onSignal({ kind: "offer", sdp: this.pc.localDescription });
      }
    } finally {
      this.makingOffer = false;
    }
  }

  /**
   * Renegotiate after screen track attach/detach so the answerer can send
   * on the screen m-line (replaceTrack alone is not enough in both roles).
   */
  async renegotiate() {
    return this.enqueueSignal(async () => {
      if (this.closed) return;
      if (this.pc.signalingState !== "stable") {
        this.needsRenegotiate = true;
        return;
      }
      await this.createOffer();
    });
  }

  private async flushRenegotiate() {
    if (!this.needsRenegotiate || this.closed) return;
    if (this.pc.signalingState !== "stable") return;
    this.needsRenegotiate = false;
    await this.createOffer();
  }

  async handleSignal(signal: IceSignal) {
    return this.enqueueSignal(async () => {
      if (this.closed) return;

      if (signal.kind === "ice") {
        try {
          await this.pc.addIceCandidate(signal.candidate);
        } catch {
          /* ignore */
        }
        return;
      }

      const description = signal.sdp;
      const offerCollision =
        signal.kind === "offer"
        && (this.makingOffer || this.pc.signalingState !== "stable");

      this.ignoreOffer = !this.polite && offerCollision;
      if (this.ignoreOffer) return;

      if (offerCollision) {
        await Promise.all([
          this.pc.setLocalDescription({ type: "rollback" }),
          this.pc.setRemoteDescription(description),
        ]);
      } else {
        await this.pc.setRemoteDescription(description);
      }

      if (signal.kind === "offer") {
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        if (this.pc.localDescription) {
          this.handlers.onSignal({ kind: "answer", sdp: this.pc.localDescription });
        }
      }

      // Refresh remote track refs from receivers after SDP apply (replaceTrack / renegotiation).
      this.syncRemoteFromReceivers();
      await this.flushRenegotiate();
    });
  }

  private syncRemoteFromReceivers() {
    const audioTrack = this.audioTransceiver.receiver.track;
    const cameraTrack = this.cameraTransceiver.receiver.track;
    const screenTrack = this.screenTransceiver.receiver.track;
    if (audioTrack && audioTrack.readyState !== "ended") this.remoteAudio = audioTrack;
    if (cameraTrack && cameraTrack.readyState !== "ended") this.remoteCamera = cameraTrack;
    if (screenTrack && screenTrack.readyState !== "ended") this.remoteScreen = screenTrack;
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

  async startScreenShare(): Promise<MediaStreamTrack> {
    const display = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 15 }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    const track = display.getVideoTracks()[0];
    if (!track) throw new Error("No screen track");
    if (this.screenTrack) {
      try { this.screenTrack.stop(); } catch { /* */ }
    }
    this.screenTrack = track;
    await this.screenSender.replaceTrack(track);
    // Ensure the screen m-line is sendrecv for both roles (critical for callee → caller).
    this.needsRenegotiate = true;
    await this.renegotiate();
    track.onended = () => {
      void this.stopScreenShare();
    };
    return track;
  }

  async stopScreenShare(): Promise<void> {
    if (this.screenTrack) {
      this.screenTrack.onended = null;
      try { this.screenTrack.stop(); } catch { /* */ }
      this.screenTrack = null;
    }
    await this.screenSender.replaceTrack(null);
    this.needsRenegotiate = true;
    await this.renegotiate();
    this.handlers.onScreenShareStopped?.();
  }

  isScreenSharing() {
    return !!this.screenTrack && this.screenTrack.readyState === "live";
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

  buildRemoteViewStream(prefer: "auto" | "camera" | "screen"): MediaStream | null {
    this.syncRemoteFromReceiversQuiet();
    const audio = this.remoteAudio ? [this.remoteAudio] : [];
    const screenOk = !!(
      this.remoteScreen
      && this.remoteScreen.readyState === "live"
      && !this.remoteScreen.muted
    );
    const cameraOk = !!(this.remoteCamera && this.remoteCamera.readyState === "live");

    if (prefer === "screen" && this.remoteScreen) {
      return new MediaStream([...audio, this.remoteScreen]);
    }
    if (prefer === "camera" && this.remoteCamera) {
      return new MediaStream([...audio, this.remoteCamera]);
    }
    if (screenOk && this.remoteScreen) {
      return new MediaStream([...audio, this.remoteScreen]);
    }
    if (cameraOk && this.remoteCamera) {
      return new MediaStream([...audio, this.remoteCamera]);
    }
    if (audio.length) return new MediaStream(audio);
    return null;
  }

  private syncRemoteFromReceiversQuiet() {
    try {
      const audioTrack = this.audioTransceiver.receiver.track;
      const cameraTrack = this.cameraTransceiver.receiver.track;
      const screenTrack = this.screenTransceiver.receiver.track;
      if (audioTrack && audioTrack.readyState !== "ended") this.remoteAudio = audioTrack;
      if (cameraTrack && cameraTrack.readyState !== "ended") this.remoteCamera = cameraTrack;
      if (screenTrack && screenTrack.readyState !== "ended") this.remoteScreen = screenTrack;
    } catch { /* pc closed */ }
  }

  close() {
    this.closed = true;
    try {
      if (this.screenTrack) {
        this.screenTrack.onended = null;
        this.screenTrack.stop();
        this.screenTrack = null;
      }
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
