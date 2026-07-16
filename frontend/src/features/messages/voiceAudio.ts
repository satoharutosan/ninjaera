/** Client-side voice analysis — runs once at upload, never during playback. */

export type VoiceUploadMeta = {
  durationMs: number;
  mimeType: string;
  codec?: string;
  sampleRate?: number;
  channels?: number;
  /** Peaks 0–100, ~64 samples. */
  waveform: number[];
};

const WAVEFORM_BARS = 64;

function inferCodec(mime: string): string | undefined {
  const m = mime.toLowerCase();
  if (m.includes("opus")) return "opus";
  if (m.includes("vorbis")) return "vorbis";
  if (m.includes("mp4") || m.includes("aac") || m.includes("m4a")) return "aac";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav") || m.includes("pcm")) return "pcm";
  if (m.includes("webm")) return "opus";
  if (m.includes("ogg")) return "opus";
  return undefined;
}

function peaksFromChannel(data: Float32Array, bars: number): number[] {
  const block = Math.max(1, Math.floor(data.length / bars));
  const peaks: number[] = [];
  for (let i = 0; i < bars; i++) {
    const start = i * block;
    const end = Math.min(data.length, start + block);
    let peak = 0;
    for (let j = start; j < end; j++) {
      const v = Math.abs(data[j]!);
      if (v > peak) peak = v;
    }
    peaks.push(peak);
  }
  const max = Math.max(...peaks, 0.001);
  return peaks.map(p => Math.max(4, Math.round((p / max) * 100)));
}

/**
 * Decode once via Web Audio API to get exact duration + compact waveform.
 * Falls back to wall-clock durationMs if decode fails (common for some WebM variants).
 */
export async function analyzeVoiceBlob(
  blob: Blob,
  fallbackDurationMs: number,
): Promise<VoiceUploadMeta> {
  const mimeType = blob.type || "audio/webm";
  const base: VoiceUploadMeta = {
    durationMs: Math.max(1, Math.round(fallbackDurationMs)),
    mimeType,
    codec: inferCodec(mimeType),
    waveform: Array.from({ length: WAVEFORM_BARS }, (_, i) => {
      // Gentle placeholder sine if decode fails
      return Math.round(30 + 40 * Math.abs(Math.sin(i / 5)));
    }),
  };

  if (typeof AudioContext === "undefined" && typeof (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext === "undefined") {
    return base;
  }

  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const buf = await blob.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(buf.slice(0));
    const durationMs = Math.max(1, Math.round(audioBuffer.duration * 1000));
    const channel = audioBuffer.getChannelData(0);
    return {
      durationMs,
      mimeType,
      codec: inferCodec(mimeType),
      sampleRate: Math.round(audioBuffer.sampleRate),
      channels: audioBuffer.numberOfChannels,
      waveform: peaksFromChannel(channel, WAVEFORM_BARS),
    };
  } catch {
    // Also try HTMLAudioElement duration as secondary fallback
    try {
      const url = URL.createObjectURL(blob);
      const dur = await new Promise<number>((resolve) => {
        const a = new Audio();
        a.preload = "metadata";
        a.onloadedmetadata = () => {
          const d = a.duration;
          URL.revokeObjectURL(url);
          resolve(Number.isFinite(d) && d > 0 ? d * 1000 : fallbackDurationMs);
        };
        a.onerror = () => {
          URL.revokeObjectURL(url);
          resolve(fallbackDurationMs);
        };
        a.src = url;
      });
      return { ...base, durationMs: Math.max(1, Math.round(dur)) };
    } catch {
      return base;
    }
  } finally {
    try { await ctx.close(); } catch { /* */ }
  }
}

export function formatVoiceDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
