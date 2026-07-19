import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import DownloadIcon from "@mui/icons-material/Download";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import { useC, SH1 } from "@/app/shared";
import { desktopDarkSelfBubble } from "@/shared/desktopMessageTheme";
import { formatVoiceDuration } from "./voiceAudio";

type Props = {
  src: string;
  self?: boolean;
  fileName?: string;
  durationMs?: number;
  waveform?: number[];
  mimeType?: string;
  showDownload?: boolean;
  compact?: boolean;
};

/**
 * Discord-style voice player.
 * Duration / waveform come from stored metadata — audio file loads only on Play (or after seek needs it).
 */
export function VoiceMessagePlayer({
  src,
  self,
  fileName,
  durationMs = 0,
  waveform,
  showDownload = true,
  compact = false,
}: Props) {
  const C = useC();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const draggingRef = useRef(false);

  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [srcAttached, setSrcAttached] = useState(false);
  /** Fallback duration from element when DB metadata is missing (legacy messages). */
  const [legacyDurationMs, setLegacyDurationMs] = useState(0);

  const totalMs = durationMs > 0 ? durationMs : legacyDurationMs;
  const totalSec = totalMs / 1000;
  const desktopSelf = self ? desktopDarkSelfBubble(C) : null;
  const bubbleBg = self ? (desktopSelf?.bg ?? C.primary) : C.surface;
  const fg = self ? (desktopSelf?.fg ?? "#fff") : C.onSurface;
  const fill = self ? (desktopSelf ? C.primary : "#fff") : C.primary;
  const waveIdle = self
    ? (desktopSelf ? "rgba(28,27,31,0.22)" : "rgba(255,255,255,0.35)")
    : C.outlineVar;
  const waveActive = self ? (desktopSelf ? C.primary : "#fff") : C.primary;

  const stopRaf = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const tick = useCallback(() => {
    const a = audioRef.current;
    if (a && !draggingRef.current) {
      setCurrentMs(Math.round(a.currentTime * 1000));
    }
    if (a && !a.paused && !a.ended) {
      rafRef.current = requestAnimationFrame(tick);
    } else {
      rafRef.current = null;
    }
  }, []);

  const ensureAudio = useCallback(() => {
    if (!audioRef.current) {
      const a = new Audio();
      a.preload = "none";
      a.addEventListener("ended", () => {
        setPlaying(false);
        stopRaf();
        const endMs = durationMs > 0
          ? durationMs
          : Math.round((Number.isFinite(a.duration) ? a.duration : 0) * 1000);
        setCurrentMs(endMs);
      });
      a.addEventListener("error", () => {
        setError("Unable to play this voice message");
        setPlaying(false);
        stopRaf();
      });
      a.addEventListener("loadedmetadata", () => {
        if (durationMs <= 0 && Number.isFinite(a.duration) && a.duration > 0 && a.duration !== Infinity) {
          setLegacyDurationMs(Math.round(a.duration * 1000));
        }
      });
      a.addEventListener("durationchange", () => {
        if (durationMs <= 0 && Number.isFinite(a.duration) && a.duration > 0 && a.duration !== Infinity) {
          setLegacyDurationMs(Math.round(a.duration * 1000));
        }
      });
      audioRef.current = a;
    }
    return audioRef.current;
  }, [durationMs]);

  const attachSrc = useCallback(() => {
    const a = ensureAudio();
    if (!srcAttached) {
      a.src = src;
      setSrcAttached(true);
    }
    return a;
  }, [ensureAudio, src, srcAttached]);

  useEffect(() => () => {
    stopRaf();
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.removeAttribute("src");
      a.load();
    }
    audioRef.current = null;
  }, []);

  const seekToMs = (ms: number) => {
    const clamped = Math.max(0, Math.min(totalMs || Infinity, ms));
    setCurrentMs(clamped);
    const a = audioRef.current;
    if (a && srcAttached && Number.isFinite(a.duration) && a.duration > 0) {
      a.currentTime = clamped / 1000;
    } else if (a && srcAttached) {
      // Duration unknown on element — seek by ratio of stored metadata once playable
      const onReady = () => {
        a.currentTime = clamped / 1000;
        a.removeEventListener("loadedmetadata", onReady);
      };
      if (a.readyState >= 1) a.currentTime = clamped / 1000;
      else a.addEventListener("loadedmetadata", onReady);
    }
  };

  const toggle = async () => {
    setError(null);
    const a = attachSrc();
    try {
      if (a.paused) {
        // If we sought before load, apply after load
        if (currentMs > 0 && a.readyState < 1) {
          const target = currentMs / 1000;
          const apply = () => {
            a.currentTime = target;
            a.removeEventListener("canplay", apply);
          };
          a.addEventListener("canplay", apply);
        }
        await a.play();
        setPlaying(true);
        stopRaf();
        rafRef.current = requestAnimationFrame(tick);
      } else {
        a.pause();
        setPlaying(false);
        stopRaf();
        setCurrentMs(Math.round(a.currentTime * 1000));
      }
    } catch {
      setError("Playback failed");
      setPlaying(false);
    }
  };

  const ratioFromEvent = (clientX: number) => {
    const el = trackRef.current;
    if (!el || totalMs <= 0) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (totalMs <= 0) return;
    e.preventDefault();
    draggingRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    attachSrc(); // ensure we can seek once playing
    seekToMs(ratioFromEvent(e.clientX) * totalMs);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!draggingRef.current || totalMs <= 0) return;
    seekToMs(ratioFromEvent(e.clientX) * totalMs);
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* */ }
    seekToMs(ratioFromEvent(e.clientX) * totalMs);
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      void toggle();
      return;
    }
    if (totalMs <= 0) return;
    const step = e.shiftKey ? 5000 : 1000;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      attachSrc();
      seekToMs(currentMs + step);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      attachSrc();
      seekToMs(currentMs - step);
    } else if (e.key === "Home") {
      e.preventDefault();
      attachSrc();
      seekToMs(0);
    } else if (e.key === "End") {
      e.preventDefault();
      attachSrc();
      seekToMs(totalMs);
    }
  };

  const progress = totalMs > 0 ? Math.min(1, currentMs / totalMs) : 0;
  const peaks = waveform && waveform.length >= 8
    ? waveform
    : Array.from({ length: 48 }, (_, i) => 20 + Math.round(30 * Math.abs(Math.sin(i / 3))));

  if (error) {
    return (
      <div
        className="flex items-center gap-2 px-3 py-2.5 rounded-2xl min-w-[200px]"
        style={{ background: bubbleBg, color: fg, boxShadow: SH1 }}
        role="alert"
      >
        <ErrorOutlineIcon style={{ fontSize: 18 }} />
        <span className="text-xs" style={{ fontFamily: "Roboto" }}>{error}</span>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-2 rounded-2xl max-w-[min(320px,100%)] ${compact ? "px-2.5 py-1.5 min-w-0 w-full" : "px-3 py-2.5 min-w-[240px]"}`}
      style={{ background: bubbleBg, color: fg, boxShadow: SH1 }}
      role="group"
      aria-label={`Voice message, ${formatVoiceDuration(totalMs)}`}
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        aria-label={playing ? "Pause" : "Play"}
        onClick={() => void toggle()}
        className={`${compact ? "w-8 h-8" : "w-9 h-9"} rounded-full flex items-center justify-center shrink-0 focus-visible:outline-none focus-visible:ring-2`}
        style={{
          background: self
            ? (desktopSelf ? "rgba(28,27,31,0.08)" : "rgba(255,255,255,0.2)")
            : C.primaryCont,
          color: self ? (desktopSelf ? C.primary : "#fff") : C.primary,
        }}
      >
        {playing ? <PauseIcon style={{ fontSize: compact ? 18 : 20 }} /> : <PlayArrowIcon style={{ fontSize: compact ? 18 : 20 }} />}
      </button>

      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(totalSec)}
          aria-valuenow={Math.round(currentMs / 1000)}
          aria-valuetext={`${formatVoiceDuration(currentMs)} of ${formatVoiceDuration(totalMs)}`}
          className="relative w-full h-8 flex items-end gap-px cursor-pointer touch-none select-none rounded-md focus-visible:outline-none focus-visible:ring-2"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {peaks.map((h, i) => {
            const active = i / peaks.length <= progress;
            return (
              <div
                key={i}
                className="flex-1 rounded-full min-w-[2px] pointer-events-none"
                style={{
                  height: `${Math.max(12, h)}%`,
                  background: active ? waveActive : waveIdle,
                  opacity: active ? 1 : 0.55,
                }}
              />
            );
          })}
          {/* Scrub thumb */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full pointer-events-none shadow"
            style={{
              left: `calc(${progress * 100}% - 6px)`,
              background: fill,
              border: `2px solid ${self ? (desktopSelf?.bg ?? C.primary) : C.surface}`,
            }}
          />
        </div>
        <div className="flex justify-between text-[10px] tabular-nums opacity-85" style={{ fontFamily: "Roboto Mono, monospace" }}>
          <span>{formatVoiceDuration(currentMs)}</span>
          <span>{totalMs > 0 ? formatVoiceDuration(totalMs) : "—:——"}</span>
        </div>
      </div>

      {showDownload && (
      <a
        href={src}
        download={fileName || "voice-message"}
        aria-label="Download voice message"
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 opacity-80 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2"
        style={{ color: fg }}
        onClick={() => attachSrc()}
      >
        <DownloadIcon style={{ fontSize: 18 }} />
      </a>
      )}
    </div>
  );
}
