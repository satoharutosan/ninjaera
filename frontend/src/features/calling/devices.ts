/** Pre-call media device validation. */
import { getNinja } from "@/shared/electronBridge";

export type MediaValidationResult =
  | { ok: true; stream: MediaStream }
  | { ok: false; error: string; code: "no-mic" | "no-cam" | "denied" | "unavailable" | "unsupported" };

type DesktopCallPrefs = {
  cameraId: string;
  microphoneId: string;
  speakerId: string;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
};

const isDev = typeof import.meta !== "undefined" && !!(import.meta as { env?: { DEV?: boolean } }).env?.DEV;

function camLog(...args: unknown[]) {
  if (isDev) console.info("[CAMERA]", ...args);
}

/**
 * Reads the user's saved Calls preferences from the Electron desktop settings.
 * Returns null on the web (or if unavailable), preserving default browser behavior.
 */
async function desktopCallPrefs(): Promise<DesktopCallPrefs | null> {
  const ninja = getNinja();
  if (!ninja) return null;
  try {
    const s = (await ninja.settings.getAll()) as { calls?: Partial<DesktopCallPrefs> };
    if (!s?.calls) return null;
    return {
      cameraId: s.calls.cameraId ?? "default",
      microphoneId: s.calls.microphoneId ?? "default",
      speakerId: s.calls.speakerId ?? "default",
      echoCancellation: s.calls.echoCancellation ?? true,
      noiseSuppression: s.calls.noiseSuppression ?? true,
      autoGainControl: s.calls.autoGainControl ?? true,
    };
  } catch {
    return null;
  }
}

function isSecureContextOk() {
  return typeof navigator !== "undefined"
    && !!navigator.mediaDevices
    && typeof navigator.mediaDevices.getUserMedia === "function";
}

async function hasInput(kind: "audioinput" | "videoinput") {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some(d => d.kind === kind);
  } catch {
    return true; // proceed; getUserMedia will surface the real error
  }
}

/** Wait briefly for a local capture track to leave the initial muted state. */
async function waitTrackUnmute(track: MediaStreamTrack, timeoutMs = 2000): Promise<void> {
  if (!track.muted) return;
  await new Promise<void>((resolve) => {
    const done = () => {
      track.removeEventListener("unmute", done);
      resolve();
    };
    track.addEventListener("unmute", done);
    window.setTimeout(done, timeoutMs);
  });
}

function describeTrack(track: MediaStreamTrack) {
  return {
    id: track.id.slice(0, 12),
    kind: track.kind,
    label: track.label,
    readyState: track.readyState,
    enabled: track.enabled,
    muted: track.muted,
    settings: typeof track.getSettings === "function" ? track.getSettings() : null,
  };
}

/**
 * Validate and open required devices before starting or accepting a call.
 * On success returns a live MediaStream the caller should use (do not stop it).
 */
export async function validateAndGetMedia(needVideo: boolean): Promise<MediaValidationResult> {
  if (!isSecureContextOk()) {
    return {
      ok: false,
      code: "unsupported",
      error: "Calling requires a modern browser with media device support (HTTPS or localhost).",
    };
  }

  const hasMic = await hasInput("audioinput");
  if (!hasMic) {
    return {
      ok: false,
      code: "no-mic",
      error: "No microphone was found. Connect a microphone to place or accept a call.",
    };
  }

  if (needVideo) {
    const hasCam = await hasInput("videoinput");
    if (!hasCam) {
      return {
        ok: false,
        code: "no-cam",
        error: "No camera was found. Use a voice call, or connect a camera for video.",
      };
    }
  }

  try {
    // Apply saved desktop Calls preferences (device + audio processing). `ideal`
    // deviceId is used so a missing/unplugged device never over-constrains the request.
    const prefs = await desktopCallPrefs();
    const audio: MediaTrackConstraints = {
      echoCancellation: prefs?.echoCancellation ?? true,
      noiseSuppression: prefs?.noiseSuppression ?? true,
      autoGainControl: prefs?.autoGainControl ?? true,
    };
    if (prefs?.microphoneId && prefs.microphoneId !== "default") {
      audio.deviceId = { ideal: prefs.microphoneId };
    }
    const video: MediaTrackConstraints | false = needVideo
      ? {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
          ...(prefs?.cameraId && prefs.cameraId !== "default"
            ? { deviceId: { ideal: prefs.cameraId } }
            : {}),
        }
      : false;

    camLog("getUserMedia request", {
      needVideo,
      audio,
      video,
      electron: !!getNinja(),
      secure: window.isSecureContext,
    });

    const stream = await navigator.mediaDevices.getUserMedia({ audio, video });

    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) {
      stream.getTracks().forEach(t => t.stop());
      return {
        ok: false,
        code: "no-mic",
        error: "Microphone could not be opened. Check system permissions and try again.",
      };
    }

    if (needVideo && !stream.getVideoTracks().length) {
      stream.getTracks().forEach(t => t.stop());
      return {
        ok: false,
        code: "no-cam",
        error: "Camera could not be opened. Check permissions, or switch to a voice call.",
      };
    }

    for (const t of audioTracks) {
      t.enabled = true;
      await waitTrackUnmute(t, 1500);
      camLog("audio track", describeTrack(t));
    }

    for (const t of stream.getVideoTracks()) {
      t.enabled = true;
      try {
        t.contentHint = "motion";
      } catch { /* optional */ }
      await waitTrackUnmute(t, 2500);
      camLog("video track", describeTrack(t));
      if (t.readyState !== "live") {
        stream.getTracks().forEach(tr => tr.stop());
        return {
          ok: false,
          code: "unavailable",
          error: "Camera opened but is not live. Close other apps using the camera and try again.",
        };
      }
    }

    camLog("acquisition ok", {
      audio: audioTracks.length,
      video: stream.getVideoTracks().length,
    });

    return { ok: true, stream };
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    camLog("getUserMedia failed", { name, error: e instanceof Error ? e.message : String(e) });
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return {
        ok: false,
        code: "denied",
        error: needVideo
          ? "Camera or microphone permission denied. Allow access in browser or system settings, then try again."
          : "Microphone permission denied. Allow access in browser or system settings.",
      };
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return {
        ok: false,
        code: needVideo ? "no-cam" : "no-mic",
        error: needVideo
          ? "No camera was detected. Connect a camera or start a voice call instead."
          : "No microphone was found.",
      };
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return {
        ok: false,
        code: "unavailable",
        error: "Camera or microphone is already in use by another application. Close it and try again.",
      };
    }
    if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
      return {
        ok: false,
        code: "unavailable",
        error: needVideo
          ? "Selected camera does not support the required settings. Try another camera in settings."
          : "Selected microphone is unavailable. Try another device in settings.",
      };
    }
    return {
      ok: false,
      code: "unavailable",
      error: e instanceof Error ? e.message : "Could not access media devices.",
    };
  }
}

/**
 * Open camera only (for enabling camera mid-call on a voice session).
 * Does not touch the existing microphone track.
 */
export async function acquireCameraTrack(deviceId?: string): Promise<
  | { ok: true; track: MediaStreamTrack; stream: MediaStream }
  | { ok: false; error: string; code: "no-cam" | "denied" | "unavailable" | "unsupported" }
> {
  if (!isSecureContextOk()) {
    return {
      ok: false,
      code: "unsupported",
      error: "Camera requires a secure context (HTTPS or localhost).",
    };
  }
  const hasCam = await hasInput("videoinput");
  if (!hasCam) {
    return {
      ok: false,
      code: "no-cam",
      error: "No camera was found.",
    };
  }
  try {
    const prefs = await desktopCallPrefs();
    const preferred = deviceId && deviceId !== "default"
      ? deviceId
      : (prefs?.cameraId && prefs.cameraId !== "default" ? prefs.cameraId : undefined);
    const video: MediaTrackConstraints = {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
      ...(preferred ? { deviceId: { ideal: preferred } } : {}),
    };
    camLog("acquireCameraTrack", { video });
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach(t => t.stop());
      return { ok: false, code: "no-cam", error: "Camera could not be opened." };
    }
    track.enabled = true;
    try { track.contentHint = "motion"; } catch { /* */ }
    await waitTrackUnmute(track, 2500);
    camLog("acquireCameraTrack ok", describeTrack(track));
    return { ok: true, track, stream };
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    camLog("acquireCameraTrack failed", { name, error: e instanceof Error ? e.message : String(e) });
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return { ok: false, code: "denied", error: "Camera permission denied." };
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return { ok: false, code: "no-cam", error: "No camera was detected." };
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return {
        ok: false,
        code: "unavailable",
        error: "Camera is already in use by another application.",
      };
    }
    return {
      ok: false,
      code: "unavailable",
      error: e instanceof Error ? e.message : "Could not open camera.",
    };
  }
}
