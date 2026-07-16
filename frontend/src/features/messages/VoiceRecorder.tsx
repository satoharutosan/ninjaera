import { useCallback, useEffect, useRef, useState } from "react";
import MicIcon from "@mui/icons-material/Mic";
import StopIcon from "@mui/icons-material/Stop";
import SendIcon from "@mui/icons-material/Send";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { useC } from "@/app/shared";
import { toast } from "sonner";
import { analyzeVoiceBlob, formatVoiceDuration, type VoiceUploadMeta } from "./voiceAudio";
import { VoiceMessagePlayer } from "./VoiceMessagePlayer";

type Props = {
  disabled?: boolean;
  onSend: (file: File, meta: VoiceUploadMeta) => Promise<void> | void;
  /** Fired when recording/preview occupies the composer (hide text field). */
  onBusyChange?: (busy: boolean) => void;
};

function pickMime(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
}

export function VoiceRecorderButton({ disabled, onSend, onBusyChange }: Props) {
  const C = useC();
  const [recording, setRecording] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [meta, setMeta] = useState<VoiceUploadMeta | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [uploading, setUploading] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);
  const mimeRef = useRef("");
  /** Keep latest object URL for cleanup without stale closures. */
  const previewUrlRef = useRef<string | null>(null);

  const busy = recording || !!previewBlob;
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  const cleanupStream = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  };

  const revokePreviewUrl = () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  };

  const cancelPreview = useCallback(() => {
    revokePreviewUrl();
    setPreviewUrl(null);
    setPreviewBlob(null);
    setMeta(null);
    setElapsedMs(0);
    setAnalyzing(false);
  }, []);

  useEffect(() => () => {
    cleanupStream();
    revokePreviewUrl();
  }, []);

  const stopRecording = () => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    setRecording(false);
  };

  const startRecording = async () => {
    if (disabled || recording || previewBlob) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      const mime = pickMime();
      mimeRef.current = mime;
      const rec = mime
        ? new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 48_000 })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      /**
       * Root cause of lost preview (2026 voice-meta refactor): the native
       * `<audio controls>` preview was replaced with a static waveform, so users
       * could no longer play the local recording before sending. Restored by
       * mounting VoiceMessagePlayer against the Blob object URL (no upload).
       */
      rec.onstop = () => {
        cleanupStream();
        const wallMs = Math.max(1, Date.now() - startedAt.current);
        const blob = new Blob(chunksRef.current, { type: mimeRef.current || "audio/webm" });
        revokePreviewUrl();
        const url = URL.createObjectURL(blob);
        previewUrlRef.current = url;
        setPreviewBlob(blob);
        setPreviewUrl(url);
        setElapsedMs(wallMs);
        setAnalyzing(true);
        void analyzeVoiceBlob(blob, wallMs).then(m => {
          setMeta(m);
          setElapsedMs(m.durationMs);
          setAnalyzing(false);
        }).catch(() => {
          setMeta({
            durationMs: wallMs,
            mimeType: blob.type || "audio/webm",
            waveform: Array.from({ length: 64 }, (_, i) => 20 + Math.round(40 * Math.abs(Math.sin(i / 4)))),
          });
          setAnalyzing(false);
        });
      };
      recorderRef.current = rec;
      startedAt.current = Date.now();
      setElapsedMs(0);
      setRecording(true);
      rec.start(250);
      tickRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startedAt.current);
      }, 200);
    } catch {
      toast.error("Microphone permission is required to record voice messages.");
    }
  };

  const send = async () => {
    if (!previewBlob || uploading || analyzing) return;
    setUploading(true);
    try {
      const voiceMeta = meta || await analyzeVoiceBlob(previewBlob, elapsedMs);
      const ext = (mimeRef.current.includes("ogg") && "ogg")
        || (mimeRef.current.includes("mp4") && "m4a")
        || "webm";
      const file = new File([previewBlob], `voice-${Date.now()}.${ext}`, {
        type: previewBlob.type || "audio/webm",
      });
      await onSend(file, voiceMeta);
      cancelPreview();
    } catch {
      toast.error("Failed to send voice message");
    } finally {
      setUploading(false);
    }
  };

  if (previewUrl && previewBlob) {
    return (
      <div
        className="flex flex-col sm:flex-row sm:items-center gap-2 min-w-0 flex-1 w-full"
        role="group"
        aria-label="Voice message preview"
      >
        <div className="min-w-0 flex-1 w-full">
          <VoiceMessagePlayer
            src={previewUrl}
            durationMs={meta?.durationMs || elapsedMs}
            waveform={meta?.waveform}
            mimeType={meta?.mimeType || previewBlob.type}
            showDownload={false}
            compact
          />
        </div>
        <div className="flex items-center justify-end gap-2 shrink-0">
          {analyzing && (
            <span className="text-[10px]" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>Preparing…</span>
          )}
          <button type="button" aria-label="Discard recording" disabled={uploading} onClick={cancelPreview}
            className="w-10 h-10 sm:w-8 sm:h-8 rounded-full flex items-center justify-center shrink-0" style={{ color: C.error }}>
            <DeleteOutlineIcon style={{ fontSize: 18 }} />
          </button>
          <button type="button" aria-label="Send voice message" disabled={uploading || analyzing} onClick={() => void send()}
            className="w-10 h-10 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-white shrink-0" style={{ background: C.primary, opacity: (uploading || analyzing) ? 0.6 : 1 }}>
            <SendIcon style={{ fontSize: 16 }} />
          </button>
        </div>
      </div>
    );
  }

  if (recording) {
    return (
      <div className="flex items-center gap-2 flex-1 min-w-0" role="status" aria-live="polite">
        <span className="w-2.5 h-2.5 rounded-full animate-pulse shrink-0" style={{ background: C.error }} />
        <span className="text-sm tabular-nums truncate" style={{ color: C.error, fontFamily: "Roboto Mono, monospace" }}>
          Recording {formatVoiceDuration(elapsedMs)}
        </span>
        <div className="flex-1" />
        <button type="button" aria-label="Cancel recording" onClick={() => {
          const rec = recorderRef.current;
          // Discard without creating a preview blob (avoid onstop → preview race).
          if (rec) {
            rec.ondataavailable = null;
            rec.onstop = () => cleanupStream();
            if (rec.state !== "inactive") rec.stop();
          }
          chunksRef.current = [];
          cleanupStream();
          setRecording(false);
          cancelPreview();
        }}
          className="w-10 h-10 sm:w-8 sm:h-8 rounded-full flex items-center justify-center" style={{ color: C.onSurfaceVar }}>
          <CloseIcon style={{ fontSize: 18 }} />
        </button>
        <button type="button" aria-label="Stop recording" onClick={stopRecording}
          className="w-10 h-10 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-white" style={{ background: C.error }}>
          <StopIcon style={{ fontSize: 18 }} />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label="Record voice message"
      title="Voice message"
      onClick={() => void startRecording()}
      className="shrink-0 self-center"
      style={{ color: C.onSurfaceVar, opacity: disabled ? 0.4 : 1 }}
    >
      <MicIcon style={{ fontSize: 20 }} />
    </button>
  );
}
