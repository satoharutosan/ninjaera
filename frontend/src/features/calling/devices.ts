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
          width: { ideal: 640 },
          height: { ideal: 360 },
          frameRate: { ideal: 24 },
          ...(prefs?.cameraId && prefs.cameraId !== "default"
            ? { deviceId: { ideal: prefs.cameraId } }
            : {}),
        }
      : false;
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

    return { ok: true, stream };
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return {
        ok: false,
        code: "denied",
        error: needVideo
          ? "Microphone and camera permission denied. Allow access in your browser settings."
          : "Microphone permission denied. Allow access in your browser settings.",
      };
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return {
        ok: false,
        code: needVideo ? "no-cam" : "no-mic",
        error: needVideo
          ? "Required camera or microphone was not found."
          : "No microphone was found.",
      };
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return {
        ok: false,
        code: "unavailable",
        error: "A required device is in use by another application. Close it and try again.",
      };
    }
    return {
      ok: false,
      code: "unavailable",
      error: e instanceof Error ? e.message : "Could not access media devices.",
    };
  }
}
