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
  if (isDev) console.log("[SCREEN_SHARE]", ...args);
}

function trackLog(...args: unknown[]) {
  if (isDev) console.log("[TRACK]", ...args);
}

function streamLog(...args: unknown[]) {
  if (isDev) console.log("[STREAM]", ...args);
}

function isElectronRuntime(): boolean {
  if (typeof navigator === "undefined") return false;
  if (/Electron/i.test(navigator.userAgent)) return true;
  try {
    return !!(window as unknown as { ninja?: unknown }).ninja;
  } catch {
    return false;
  }
}

/**
 * Live placeholder so voice calls still negotiate sendrecv video at a
 * screen-share-capable resolution. A 16×16 canvas caused Chromium/Electron
 * encoders to stick at tiny dimensions after replaceTrack(screen).
 */
function createPlaceholderVideoTrack(): { track: MediaStreamTrack; dispose: () => void } {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  const paint = () => {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };
  paint();
  const stream = canvas.captureStream(2);
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
 * Single audio + single video transceiver, both negotiated sendrecv at call
 * start. Screen share is a pure RTCRtpSender.replaceTrack() on the existing
 * video m-line — per spec this needs NO renegotiation when the replacement
 * track is the same kind (video). Camera/mic device switching already relies
 * on this and works both directions; screen share must follow the same
 * pattern instead of forcing an SDP offer/answer cycle.
 *
 * Renegotiating on every share start/stop was the actual regression: it made
 * the caller (impolite/offerer) and callee (polite/answerer) take asymmetric
 * codepaths through offer-collision handling, so only the direction whose
 * renegotiation offer didn't collide would ever show frames — and any timing
 * change could break that one working direction too.
 */
export class CallPeer {
  pc: RTCPeerConnection;
  localStream: MediaStream | null = null;
  cameraTrack: MediaStreamTrack | null = null;
  screenTrack: MediaStreamTrack | null = null;

  private makingOffer = false;
  private polite: boolean;
  private closed = false;

  // Assigned when the video/audio m-lines are established (caller: in
  // setLocalStream; callee: when the offer arrives, in ensureLocalAttached).
  private audioTransceiver!: RTCRtpTransceiver;
  private videoTransceiver!: RTCRtpTransceiver;
  private mediaReady = false;

  // Local tracks captured in setLocalStream; the callee attaches these onto the
  // transceivers created by the caller's offer (avoids duplicate m-lines/glare).
  private pendingAudioTrack: MediaStreamTrack | null = null;
  private pendingVideoTrack: MediaStreamTrack | null = null;

  private remoteAudio: MediaStreamTrack | null = null;
  private remoteVideo: MediaStreamTrack | null = null;

  // Stable stream wrappers — reused while the underlying track id is unchanged
  // so React/<video> never tear down and re-attach on every refresh (which
  // prevents the element from ever painting incoming RTP frames).
  private remoteVideoStream: MediaStream | null = null;
  private remoteAudioStream: MediaStream | null = null;

  private placeholder: { track: MediaStreamTrack; dispose: () => void } | null = null;
  private sendingScreen = false;
  private outboundBaseTrack: MediaStreamTrack | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private handlers: PeerHandlers,
    polite: boolean,
    iceServers: RTCIceServer[] = ICE_SERVERS,
  ) {
    this.polite = polite;
    this.pc = new RTCPeerConnection({
      iceServers,
      iceCandidatePoolSize: 4,
    });

    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        webrtcLog("local ICE candidate", e.candidate.type, e.candidate.protocol);
        this.handlers.onSignal({ kind: "ice", candidate: e.candidate.toJSON() });
      } else {
        webrtcLog("ICE gathering complete");
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      webrtcLog("iceConnectionState", this.pc.iceConnectionState);
    };

    this.pc.ontrack = (e) => {
      const track = e.track;
      webrtcLog("REMOTE TRACK", {
        kind: track.kind,
        id: track.id,
        readyState: track.readyState,
        muted: track.muted,
        mid: e.transceiver?.mid,
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

    // SINGLE-OFFERER negotiation: only the impolite peer (the caller) ever
    // creates offers. The callee attaches its tracks onto the transceivers the
    // offer creates and only answers. This deterministically avoids glare and
    // the duplicate video m-lines that produced a sendonly transceiver while
    // real frames arrived on a second, ignored m-line.
    this.pc.onnegotiationneeded = async () => {
      if (this.closed || this.polite) return;
      if (this.makingOffer || this.pc.signalingState !== "stable") return;
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        if (this.pc.localDescription) {
          webrtcLog("negotiationneeded → offer", {
            video: this.getVideoDirection(),
            signalingState: this.pc.signalingState,
          });
          this.handlers.onSignal({ kind: "offer", sdp: this.pc.localDescription });
        }
      } catch (err) {
        webrtcLog("negotiationneeded failed", err);
      } finally {
        this.makingOffer = false;
      }
    };
  }

  /** Resolve the live video RTCRtpSender — never assume getSenders()[0]. */
  private findVideoSender(): RTCRtpSender {
    if (!this.mediaReady) throw new Error("Video sender unavailable");
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

  /**
   * After replaceTrack (camera ↔ screen), reset encodings so Electron/Chromium
   * do not keep the previous tiny placeholder scale/bitrate.
   */
  private async tuneVideoSender(sender: RTCRtpSender, mode: "screen" | "camera") {
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      for (const enc of params.encodings) {
        enc.scaleResolutionDownBy = 1;
        if (mode === "screen") {
          enc.maxFramerate = 30;
          enc.maxBitrate = 3_000_000;
        } else {
          enc.maxFramerate = 30;
          enc.maxBitrate = 1_500_000;
        }
      }
      try {
        (params as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference =
          mode === "screen" ? "maintain-resolution" : "balanced";
      } catch { /* */ }
      await sender.setParameters(params);
      webrtcLog("[ICE] setParameters", mode, params.encodings);
    } catch (e) {
      webrtcLog("setParameters failed", e);
    }
    try {
      const keyed = sender as RTCRtpSender & { generateKeyFrame?: () => Promise<void> };
      if (typeof keyed.generateKeyFrame === "function") {
        await keyed.generateKeyFrame();
        trackLog("generateKeyFrame ok", mode);
      }
    } catch (e) {
      trackLog("generateKeyFrame skipped", e);
    }
  }

  private syncReceivers() {
    if (!this.mediaReady) return;
    try {
      const a = this.audioTransceiver.receiver.track;
      const v = this.videoTransceiver.receiver.track;
      if (a && a.readyState !== "ended") this.remoteAudio = a;
      if (v && v.readyState !== "ended") this.remoteVideo = v;
    } catch { /* */ }
  }

  private emitRemote() {
    this.syncReceivers();
    // Handlers refresh from buildRemoteVideoStream/buildRemoteAudioStream.
    // Pass a video-only stream so callers never bind audio into <video>.
    const video = this.buildRemoteVideoStream();
    streamLog("emitRemote", {
      hasVideo: !!video,
      videoTrack: this.remoteVideo?.id?.slice(0, 12),
      muted: this.remoteVideo?.muted,
      readyState: this.remoteVideo?.readyState,
    });
    this.handlers.onRemoteStream(video || new MediaStream());
  }

  private assertCanMutateMedia() {
    if (this.closed || this.pc.signalingState === "closed") {
      throw new Error("Call is not connected");
    }
    if (this.pc.connectionState === "closed" || this.pc.connectionState === "failed") {
      throw new Error("Call connection is not available");
    }
  }

  /** Verifies RTP is actually flowing on the video sender after replaceTrack. */
  private async verifySenderFrames(label: string, expectTrackId: string) {
    if (this.closed) return;
    try {
      await new Promise(r => window.setTimeout(r, 700));
      const stats = await this.pc.getStats();
      stats.forEach((r) => {
        if (r.type === "outbound-rtp" && (r as { kind?: string }).kind === "video") {
          const o = r as unknown as { framesSent?: number; bytesSent?: number };
          webrtcLog(`[frames sending] ${label}`, {
            trackId: expectTrackId.slice(0, 12),
            framesSent: o.framesSent,
            bytesSent: o.bytesSent,
          });
        }
      });
    } catch { /* */ }
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

    let outbound: MediaStreamTrack;
    if (video) {
      video.enabled = !!withVideo;
      outbound = video;
    } else {
      if (!this.placeholder) this.placeholder = createPlaceholderVideoTrack();
      outbound = this.placeholder.track;
    }
    this.outboundBaseTrack = outbound;
    this.pendingAudioTrack = audio;
    this.pendingVideoTrack = outbound;

    if (!this.polite) {
      // Caller = sole offerer. Create the transceivers (audio, then video) WITH
      // their tracks so the auto-fired offer is sendrecv with real media.
      this.audioTransceiver = this.pc.addTransceiver(audio ?? "audio", { direction: "sendrecv" });
      this.videoTransceiver = this.pc.addTransceiver(outbound, { direction: "sendrecv" });
      this.mediaReady = true;
      webrtcLog("Caller media ready (transceivers created)", {
        videoTrackId: outbound.id.slice(0, 12),
        hasAudio: !!audio,
        withVideo,
        video: this.getVideoDirection(),
      });
    } else {
      // Callee attaches these onto the offer's transceivers in ensureLocalAttached.
      webrtcLog("Callee local tracks captured (await offer)", {
        videoTrackId: outbound.id.slice(0, 12),
        hasAudio: !!audio,
        withVideo,
      });
    }
  }

  /**
   * Callee-only: attach the local tracks onto the transceivers created by the
   * caller's offer, and force them sendrecv. Runs after setRemoteDescription
   * (so the transceivers exist) and before createAnswer.
   */
  private async ensureLocalAttached() {
    if (this.mediaReady || !this.polite) return;
    const transceivers = this.pc.getTransceivers();
    const audioT = transceivers.find(t => t.receiver.track?.kind === "audio");
    const videoT = transceivers.find(t => t.receiver.track?.kind === "video");

    if (!audioT || !videoT) {
      webrtcLog("Callee offer missing audio/video m-lines", {
        count: transceivers.length,
        kinds: transceivers.map(t => t.receiver.track?.kind),
      });
      throw new Error("Call negotiation failed — missing media lines");
    }

    this.audioTransceiver = audioT;
    if (this.pendingAudioTrack) {
      try { await audioT.sender.replaceTrack(this.pendingAudioTrack); } catch { /* */ }
    }
    try { audioT.direction = "sendrecv"; } catch { /* */ }

    this.videoTransceiver = videoT;
    if (this.pendingVideoTrack) {
      try { await videoT.sender.replaceTrack(this.pendingVideoTrack); } catch { /* */ }
    }
    try { videoT.direction = "sendrecv"; } catch { /* */ }

    this.mediaReady = true;
    webrtcLog("Callee attached local tracks to offer transceivers", {
      video: this.getVideoDirection(),
    });
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
      // Callee: attach local tracks to the offer's transceivers so the answer
      // is sendrecv with real media (must be before createAnswer).
      await this.ensureLocalAttached();
      webrtcLog("Receiving offer → creating answer");
      await this.pc.setLocalDescription();
      if (this.pc.localDescription) {
        this.handlers.onSignal({ kind: "answer", sdp: this.pc.localDescription });
      }
    } else {
      webrtcLog("Receiving answer");
    }

    webrtcLog("Post-SDP directions", {
      video: this.getVideoDirection(),
      audio: this.mediaReady
        ? `${this.audioTransceiver.direction}/${this.audioTransceiver.currentDirection ?? "?"}`
        : "no-media",
      signalingState: this.pc.signalingState,
    });

    this.emitRemote();
    // After renegotiation answer, refresh remote binding for peers
    window.setTimeout(() => this.emitRemote(), 100);
  }

  setMicEnabled(on: boolean) {
    this.localStream?.getAudioTracks().forEach(t => { t.enabled = on; });
    if (!this.mediaReady) return;
    try {
      const t = this.audioTransceiver.sender.track;
      if (t) t.enabled = on;
    } catch { /* */ }
  }

  setCamEnabled(on: boolean) {
    if (this.cameraTrack) this.cameraTrack.enabled = on;
    if (!this.sendingScreen) {
      this.localStream?.getVideoTracks().forEach(t => { t.enabled = on; });
      if (!this.mediaReady) return;
      try {
        const t = this.findVideoSender().track;
        if (t && t === this.cameraTrack) t.enabled = on;
      } catch { /* */ }
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
    if (newTrack && this.mediaReady) {
      try { await this.audioTransceiver.sender.replaceTrack(newTrack); } catch { /* */ }
    }
    if (old) {
      this.localStream.removeTrack(old);
      old.stop();
    }
    if (newTrack) {
      this.localStream.addTrack(newTrack);
      this.pendingAudioTrack = newTrack;
    }
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
      this.pendingVideoTrack = newTrack;
      if (!this.sendingScreen && this.mediaReady) {
        try { await this.findVideoSender().replaceTrack(newTrack); } catch { /* */ }
      }
    }
    if (old && old !== this.screenTrack && old !== this.placeholder?.track) {
      this.localStream.removeTrack(old);
      old.stop();
    }
    if (newTrack) this.localStream.addTrack(newTrack);
    next.getAudioTracks().forEach(t => t.stop());
  }

  /** Attempt ICE restart after brief disconnects (caller only creates the new offer). */
  restartIce() {
    if (this.closed) return;
    try {
      webrtcLog("restartIce");
      this.pc.restartIce();
    } catch (err) {
      webrtcLog("restartIce failed", err);
    }
  }

  async startScreenShare(): Promise<MediaStreamTrack> {
    this.assertCanMutateMedia();

    if (typeof navigator.mediaDevices?.getDisplayMedia !== "function") {
      const err = new Error("Screen sharing is not supported in this browser.");
      (err as Error & { name: string }).name = "NotSupportedError";
      throw err;
    }

    const electron = isElectronRuntime();
    screenLog("Started by local user", {
      polite: this.polite,
      role: this.polite ? "answerer" : "offerer",
      electron,
      connectionState: this.pc.connectionState,
    });

    let display: MediaStream;
    try {
      // Electron's desktopCapturer path is more reliable with looser constraints;
      // strict ideal 1920×1080 has produced empty/muted tracks on some builds.
      display = await navigator.mediaDevices.getDisplayMedia({
        video: electron
          ? ({
              frameRate: { ideal: 30, max: 30 },
            } as MediaTrackConstraints)
          : ({
              frameRate: { ideal: 30, max: 30 },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            } as MediaTrackConstraints),
        audio: false,
      });
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      if (name === "NotAllowedError" || name === "AbortError") {
        const err = new Error("Screen sharing permission was denied.");
        (err as Error & { name: string }).name = "NotAllowedError";
        throw err;
      }
      throw e;
    }

    const track = display.getVideoTracks()[0];
    if (!track) throw new Error("No screen track");

    trackLog("Local screen track created", {
      kind: track.kind,
      id: track.id,
      readyState: track.readyState,
      enabled: track.enabled,
      muted: track.muted,
      settings: typeof track.getSettings === "function" ? track.getSettings() : null,
    });

    // Desktop capture can start muted until the first frame — wait briefly.
    if (track.muted) {
      await new Promise<void>((resolve) => {
        const done = () => {
          track.removeEventListener("unmute", done);
          resolve();
        };
        track.addEventListener("unmute", done);
        window.setTimeout(done, 1500);
      });
      trackLog("After unmute wait", { muted: track.muted, readyState: track.readyState });
    }

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
      throw new Error("Unable to establish screen sharing connection.");
    }

    const afterId = this.findVideoSender().track?.id ?? null;
    trackLog("Replacing camera/placeholder with screen", { beforeId, afterId, screenId: track.id });
    if (afterId !== track.id) {
      webrtcLog("ERROR: sender.track was not updated to screen track", {
        sender: afterId,
        connectionState: this.pc.connectionState,
        trackId: track.id,
      });
      this.sendingScreen = false;
      this.screenTrack = null;
      try { track.stop(); } catch { /* */ }
      throw new Error("Screen track was not attached to the video sender.");
    }
    await this.tuneVideoSender(sender, "screen");
    webrtcLog("SUCCESS — video sender now carries screen track");
    // No renegotiation: the video m-line is already sendrecv on both sides.
    void this.verifySenderFrames("post-screen-share-start", track.id);

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
        await this.tuneVideoSender(sender, "camera");
        webrtcLog("After restore replaceTrack:", sender.track?.id);
        void this.verifySenderFrames("post-screen-share-stop", restore.id);
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
      const v = this.localStream?.getVideoTracks().find(t => t.readyState === "live");
      return v ? new MediaStream([v]) : null;
    }
    return new MediaStream([this.cameraTrack]);
  }

  getLocalScreenStream(): MediaStream | null {
    if (!this.sendingScreen || !this.screenTrack || this.screenTrack.readyState === "ended") {
      return null;
    }
    return new MediaStream([this.screenTrack]);
  }

  /**
   * Video-only remote stream for the <video> element.
   * Returns a STABLE MediaStream: the same object is reused as long as the
   * underlying receiver video track is unchanged. In the single-transceiver
   * design the receiver track stays the same across camera↔screen switches
   * (only frames change), so the <video> should bind ONCE and keep playing —
   * repeatedly handing React a fresh wrapper caused constant teardown and a
   * permanently black remote tile.
   */
  buildRemoteVideoStream(): MediaStream | null {
    this.syncReceivers();
    const track = this.remoteVideo && this.remoteVideo.readyState !== "ended" ? this.remoteVideo : null;
    if (!track) {
      this.remoteVideoStream = null;
      return null;
    }
    const current = this.remoteVideoStream;
    if (current && current.getVideoTracks()[0] === track) {
      return current;
    }
    this.remoteVideoStream = new MediaStream([track]);
    return this.remoteVideoStream;
  }

  /** Audio-only remote stream for a dedicated <audio> element (also stable). */
  buildRemoteAudioStream(): MediaStream | null {
    this.syncReceivers();
    const track = this.remoteAudio && this.remoteAudio.readyState !== "ended" ? this.remoteAudio : null;
    if (!track) {
      this.remoteAudioStream = null;
      return null;
    }
    const current = this.remoteAudioStream;
    if (current && current.getAudioTracks()[0] === track) {
      return current;
    }
    this.remoteAudioStream = new MediaStream([track]);
    return this.remoteAudioStream;
  }

  /** @deprecated use buildRemoteVideoStream — kept for call sites during transition */
  buildRemoteViewStream(_prefer?: "auto" | "camera" | "screen"): MediaStream | null {
    return this.buildRemoteVideoStream();
  }

  cloneRemoteViewStream(): MediaStream | null {
    return this.buildRemoteVideoStream();
  }

  cloneRemoteAudioStream(): MediaStream | null {
    return this.buildRemoteAudioStream();
  }

  getRemoteVideoTrackId(): string | null {
    this.syncReceivers();
    return this.remoteVideo?.id ?? null;
  }

  /** "direction/currentDirection" of the video transceiver for diagnostics. */
  getVideoDirection(): string {
    if (!this.mediaReady) return "no-media";
    const dir = this.videoTransceiver.direction;
    const cur = this.videoTransceiver.currentDirection ?? "?";
    const senderTrack = this.videoTransceiver.sender.track;
    return `${dir}/${cur} send:${senderTrack ? senderTrack.kind : "none"}${senderTrack && !senderTrack.enabled ? "(off)" : ""}`;
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
