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

function screenLog(...args: unknown[]) {
  if (isDev) console.log("[ScreenShare]", ...args);
}

/** Tiny live track so voice calls still negotiate sendrecv video. */
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
  const stream = canvas.captureStream(5);
  const track = stream.getVideoTracks()[0];
  if (!track) throw new Error("No placeholder track");
  const timer = window.setInterval(paint, 500);
  return {
    track,
    dispose: () => {
      window.clearInterval(timer);
      try { track.stop(); } catch { /* */ }
    },
  };
}

/**
 * Single audio + single video transceiver.
 * Screen share: replaceTrack on the video sender, then always renegotiate so
 * both offerer and answerer transmit the new source (replaceTrack alone is not
 * enough on many browser/role combinations).
 */
export class CallPeer {
  pc: RTCPeerConnection;
  localStream: MediaStream | null = null;
  cameraTrack: MediaStreamTrack | null = null;
  screenTrack: MediaStreamTrack | null = null;

  private makingOffer = false;
  private polite: boolean;
  private closed = false;
  private negotiateChain: Promise<void> = Promise.resolve();

  private audioTransceiver: RTCRtpTransceiver;
  private videoTransceiver: RTCRtpTransceiver;

  private remoteAudio: MediaStreamTrack | null = null;
  private remoteVideo: MediaStreamTrack | null = null;

  private placeholder: { track: MediaStreamTrack; dispose: () => void } | null = null;
  private sendingScreen = false;
  private outboundBaseTrack: MediaStreamTrack | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private handlers: PeerHandlers,
    polite: boolean,
  ) {
    this.polite = polite;
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this.audioTransceiver = this.pc.addTransceiver("audio", { direction: "sendrecv" });
    this.videoTransceiver = this.pc.addTransceiver("video", { direction: "sendrecv" });

    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.handlers.onSignal({ kind: "ice", candidate: e.candidate.toJSON() });
      }
    };

    this.pc.ontrack = (e) => {
      const track = e.track;
      webrtcLog("Remote track received", {
        kind: track.kind,
        id: track.id.slice(0, 12),
        mid: e.transceiver?.mid,
        muted: track.muted,
        readyState: track.readyState,
        streams: e.streams.length,
      });

      if (track.kind === "audio") this.remoteAudio = track;
      else if (track.kind === "video") this.remoteVideo = track;

      this.emitRemote();
      track.onunmute = () => {
        webrtcLog("Remote track unmute", track.kind, track.id.slice(0, 12));
        this.emitRemote();
      };
      track.onmute = () => {
        webrtcLog("Remote track mute", track.kind);
        this.emitRemote();
      };
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
  }

  /** Resolve the live video RTCRtpSender — never assume getSenders()[0]. */
  private findVideoSender(): RTCRtpSender {
    const byTransceiver = this.videoTransceiver.sender;
    if (byTransceiver) return byTransceiver;
    const found = this.pc.getSenders().find(s => s.track?.kind === "video");
    if (found) return found;
    const emptyVideo = this.pc.getSenders().find(s => {
      const params = s.getParameters?.();
      return !!params && (!s.track || s.track.kind === "video");
    });
    if (emptyVideo) return emptyVideo;
    throw new Error("Video sender unavailable");
  }

  private syncReceivers() {
    try {
      const a = this.audioTransceiver.receiver.track;
      const v = this.videoTransceiver.receiver.track;
      if (a && a.readyState !== "ended") this.remoteAudio = a;
      if (v && v.readyState !== "ended") this.remoteVideo = v;
    } catch { /* */ }
  }

  private emitRemote() {
    this.syncReceivers();
    const tracks = [this.remoteAudio, this.remoteVideo].filter(
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
  }

  private async waitForStable(timeoutMs = 2500) {
    if (this.pc.signalingState === "stable") return true;
    return new Promise<boolean>((resolve) => {
      const done = (ok: boolean) => {
        this.pc.removeEventListener("signalingstatechange", onChange);
        window.clearTimeout(timer);
        resolve(ok);
      };
      const onChange = () => {
        if (this.pc.signalingState === "stable") done(true);
      };
      const timer = window.setTimeout(() => done(this.pc.signalingState === "stable"), timeoutMs);
      this.pc.addEventListener("signalingstatechange", onChange);
    });
  }

  /**
   * Always renegotiate after camera↔screen swap so RTP actually switches
   * for both caller and callee (replaceTrack alone is insufficient in practice).
   */
  private renegotiate(reason: string): Promise<void> {
    this.negotiateChain = this.negotiateChain
      .then(async () => {
        if (this.closed) return;
        webrtcLog("Renegotiation started", reason, {
          signalingState: this.pc.signalingState,
          direction: this.videoTransceiver.direction,
          currentDirection: this.videoTransceiver.currentDirection,
          polite: this.polite,
        });
        try {
          this.videoTransceiver.direction = "sendrecv";
        } catch { /* */ }

        const stable = await this.waitForStable();
        if (!stable || this.closed) {
          webrtcLog("Renegotiation aborted — not stable");
          return;
        }
        await this.createOffer();
        webrtcLog("Renegotiation offer sent", reason);
      })
      .catch((err) => {
        webrtcLog("Renegotiation failed", reason, err);
      });
    return this.negotiateChain;
  }

  private async logVideoStats(label: string) {
    if (!isDev || this.closed) return;
    try {
      const stats = await this.pc.getStats();
      stats.forEach((r) => {
        if (r.type === "outbound-rtp" && (r as { kind?: string }).kind === "video") {
          const o = r as unknown as {
            framesSent?: number;
            bytesSent?: number;
            frameWidth?: number;
            frameHeight?: number;
          };
          webrtcLog(`Stats outbound (${label})`, {
            framesSent: o.framesSent,
            bytesSent: o.bytesSent,
            size: `${o.frameWidth || 0}x${o.frameHeight || 0}`,
          });
        }
        if (r.type === "inbound-rtp" && (r as { kind?: string }).kind === "video") {
          const o = r as unknown as {
            framesReceived?: number;
            bytesReceived?: number;
            frameWidth?: number;
            frameHeight?: number;
            framesDecoded?: number;
          };
          webrtcLog(`Stats inbound (${label})`, {
            framesReceived: o.framesReceived,
            framesDecoded: o.framesDecoded,
            bytesReceived: o.bytesReceived,
            size: `${o.frameWidth || 0}x${o.frameHeight || 0}`,
          });
        }
      });
    } catch { /* */ }
  }

  private startStatsWatch() {
    if (!isDev) return;
    this.stopStatsWatch();
    let n = 0;
    this.statsTimer = setInterval(() => {
      n += 1;
      void this.logVideoStats(`t=${n}s`);
      if (n >= 5) this.stopStatsWatch();
    }, 1000);
  }

  private stopStatsWatch() {
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
  }

  async setLocalStream(stream: MediaStream, withVideo: boolean) {
    this.localStream = stream;
    const audio = stream.getAudioTracks()[0] || null;
    const video = stream.getVideoTracks()[0] || null;
    this.cameraTrack = video;

    const audioSender = this.audioTransceiver.sender;
    if (audio) await audioSender.replaceTrack(audio);

    let outbound: MediaStreamTrack;
    if (video) {
      video.enabled = !!withVideo;
      outbound = video;
    } else {
      if (!this.placeholder) this.placeholder = createPlaceholderVideoTrack();
      outbound = this.placeholder.track;
    }

    this.outboundBaseTrack = outbound;
    const videoSender = this.findVideoSender();
    await videoSender.replaceTrack(outbound);
    try {
      this.videoTransceiver.direction = "sendrecv";
    } catch { /* */ }

    webrtcLog("Local video sender ready", {
      trackId: outbound.id.slice(0, 12),
      enabled: outbound.enabled,
      withVideo,
      senders: this.pc.getSenders().map(s => s.track?.kind || "empty"),
    });
  }

  async createOffer() {
    if (this.closed) return;
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
      webrtcLog("Glare — polite rollback");
      await Promise.all([
        this.pc.setLocalDescription({ type: "rollback" }),
        this.pc.setRemoteDescription(description),
      ]);
    } else {
      await this.pc.setRemoteDescription(description);
    }

    if (signal.kind === "offer") {
      webrtcLog("Receiving offer → creating answer");
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      if (this.pc.localDescription) {
        this.handlers.onSignal({ kind: "answer", sdp: this.pc.localDescription });
      }
    } else {
      webrtcLog("Receiving answer");
    }

    this.emitRemote();
    // After renegotiation answer, refresh remote binding for peers
    window.setTimeout(() => this.emitRemote(), 100);
  }

  setMicEnabled(on: boolean) {
    this.localStream?.getAudioTracks().forEach(t => { t.enabled = on; });
    const t = this.audioTransceiver.sender.track;
    if (t) t.enabled = on;
  }

  setCamEnabled(on: boolean) {
    if (this.cameraTrack) this.cameraTrack.enabled = on;
    if (!this.sendingScreen) {
      this.localStream?.getVideoTracks().forEach(t => { t.enabled = on; });
      const t = this.findVideoSender().track;
      if (t && t === this.cameraTrack) t.enabled = on;
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
    if (newTrack) await this.audioTransceiver.sender.replaceTrack(newTrack);
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
        await this.findVideoSender().replaceTrack(newTrack);
      }
    }
    if (old && old !== this.screenTrack && old !== this.placeholder?.track) {
      this.localStream.removeTrack(old);
      old.stop();
    }
    if (newTrack) this.localStream.addTrack(newTrack);
    next.getAudioTracks().forEach(t => t.stop());
  }

  async startScreenShare(): Promise<MediaStreamTrack> {
    this.assertCanMutateMedia();

    if (typeof navigator.mediaDevices?.getDisplayMedia !== "function") {
      const err = new Error("Screen sharing is not supported in this browser.");
      (err as Error & { name: string }).name = "NotSupportedError";
      throw err;
    }

    screenLog("Started by local user", { polite: this.polite, role: this.polite ? "answerer" : "offerer" });

    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 30, max: 30 },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        } as MediaTrackConstraints,
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

    screenLog("Track created", {
      kind: track.kind,
      id: track.id,
      readyState: track.readyState,
      enabled: track.enabled,
      muted: track.muted,
    });

    if (track.readyState !== "live") {
      try { track.stop(); } catch { /* */ }
      throw new Error("Screen track is not live");
    }

    track.enabled = true;
    try {
      track.contentHint = "detail";
    } catch { /* */ }
    try {
      await track.applyConstraints({ frameRate: 30 });
    } catch { /* optional */ }

    if (this.screenTrack) {
      try {
        this.screenTrack.onended = null;
        this.screenTrack.stop();
      } catch { /* */ }
    }

    const sender = this.findVideoSender();
    const beforeId = sender.track?.id ?? null;
    webrtcLog("Before replaceTrack:", beforeId);

    this.screenTrack = track;
    this.sendingScreen = true;

    try {
      await sender.replaceTrack(track);
    } catch (e) {
      this.sendingScreen = false;
      this.screenTrack = null;
      try { track.stop(); } catch { /* */ }
      webrtcLog("replaceTrack failed", {
        error: e,
        connectionState: this.pc.connectionState,
        signalingState: this.pc.signalingState,
        senderTrack: sender.track?.id,
      });
      throw new Error("Could not switch to screen share.");
    }

    const afterId = this.findVideoSender().track?.id ?? null;
    webrtcLog("After replaceTrack:", afterId);
    if (afterId !== track.id) {
      webrtcLog("ERROR: sender.track was not updated to screen track");
      this.sendingScreen = false;
      this.screenTrack = null;
      try { track.stop(); } catch { /* */ }
      throw new Error("Screen track was not attached to the video sender.");
    }

    // Critical: force SDP renegotiation so remote actually receives screen RTP.
    await this.renegotiate("screen-share-start");

    track.onended = () => {
      screenLog("Track ended (browser UI stop)");
      void this.stopScreenShare();
    };

    this.startStatsWatch();
    window.setTimeout(() => void this.logVideoStats("post-share"), 800);

    screenLog("Active — sender verified", {
      senderTrack: afterId?.slice(0, 12),
      currentDirection: this.videoTransceiver.currentDirection,
      connectionState: this.pc.connectionState,
    });
    return track;
  }

  async stopScreenShare(): Promise<void> {
    screenLog("Stopped");
    this.stopStatsWatch();
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
        const sender = this.findVideoSender();
        webrtcLog("Before restore replaceTrack:", sender.track?.id);
        await sender.replaceTrack(restore);
        webrtcLog("After restore replaceTrack:", sender.track?.id);
        await this.renegotiate("screen-share-stop");
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
    if (!this.sendingScreen || !this.screenTrack || this.screenTrack.readyState === "ended") {
      return null;
    }
    const audio = this.localStream?.getAudioTracks() || [];
    return new MediaStream([this.screenTrack, ...audio]);
  }

  /** Remote camera/screen share the same receiver track after replaceTrack. */
  buildRemoteViewStream(_prefer?: "auto" | "camera" | "screen"): MediaStream | null {
    this.syncReceivers();
    const audio = this.remoteAudio && this.remoteAudio.readyState !== "ended" ? [this.remoteAudio] : [];
    if (this.remoteVideo && this.remoteVideo.readyState !== "ended") {
      return new MediaStream([...audio, this.remoteVideo]);
    }
    if (audio.length) return new MediaStream(audio);
    return null;
  }

  /** Force a fresh MediaStream wrapper (for video element rebind). */
  cloneRemoteViewStream(): MediaStream | null {
    return this.buildRemoteViewStream("auto");
  }

  getRemoteVideoTrackId(): string | null {
    this.syncReceivers();
    return this.remoteVideo?.id ?? null;
  }

  close() {
    this.closed = true;
    this.stopStatsWatch();
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
      this.pc.close();
    } catch { /* */ }
  }
}
