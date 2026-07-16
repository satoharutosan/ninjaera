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
 * Always negotiates 1 audio + 2 video m-lines so camera and screen can both be live,
 * and replaceTrack works on voice-only calls without missing transceivers.
 */
export class CallPeer {
  pc: RTCPeerConnection;
  localStream: MediaStream | null = null;
  cameraTrack: MediaStreamTrack | null = null;
  screenTrack: MediaStreamTrack | null = null;
  private makingOffer = false;
  private polite: boolean;
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

    this.audioSender = this.pc.addTransceiver("audio", { direction: "sendrecv" }).sender;
    this.cameraSender = this.pc.addTransceiver("video", { direction: "sendrecv" }).sender;
    this.screenSender = this.pc.addTransceiver("video", { direction: "sendrecv" }).sender;

    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.handlers.onSignal({ kind: "ice", candidate: e.candidate.toJSON() });
      }
    };

    this.pc.ontrack = (e) => {
      const track = e.track;
      const all = this.pc.getTransceivers();
      const idx = all.indexOf(e.transceiver);

      if (track.kind === "audio") {
        this.remoteAudio = track;
      } else if (track.kind === "video") {
        // Transceiver order: 0=audio, 1=camera, 2=screen (created symmetrically).
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

  private emitRemote() {
    const tracks = [
      this.remoteAudio,
      this.remoteCamera,
      this.remoteScreen,
    ].filter((t): t is MediaStreamTrack => !!t && t.readyState !== "ended");
    this.handlers.onRemoteStream(new MediaStream(tracks));
    this.handlers.onHasRemoteScreen?.(
      !!(this.remoteScreen && this.remoteScreen.readyState === "live"),
    );
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
    this.makingOffer = true;
    try {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      if (this.pc.localDescription) {
        this.handlers.onSignal({ kind: "offer", sdp: this.pc.localDescription });
      }
    } finally {
      this.makingOffer = false;
    }
  }

  async handleSignal(signal: IceSignal) {
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

    if (offerCollision) {
      if (!this.polite) return;
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
    const audio = this.remoteAudio ? [this.remoteAudio] : [];
    const screenOk = !!(this.remoteScreen && this.remoteScreen.readyState === "live");
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

  close() {
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
