/** Compact audio metadata persisted with voice messages (upload-time only). */

export type MediaMeta = {
  mimeType?: string;
  codec?: string;
  sampleRate?: number;
  channels?: number;
  /** Normalized peaks 0–100, typically 48–96 samples. */
  waveform?: number[];
};

const MAX_DURATION_MS = 30 * 60 * 1000; // 30 min
const MAX_WAVEFORM_POINTS = 128;

export function formatDurationLabel(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function parseMediaMeta(raw: unknown): MediaMeta | null {
  if (raw == null || raw === "") return null;
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!obj || typeof obj !== "object") return null;
    return obj as MediaMeta;
  } catch {
    return null;
  }
}

/**
 * Validate client-supplied voice metadata. Returns sanitized fields or nulls.
 * Duration is required for voice; waveform is optional.
 */
export function sanitizeVoiceMeta(input: {
  durationMs?: unknown;
  mimeType?: unknown;
  codec?: unknown;
  sampleRate?: unknown;
  channels?: unknown;
  waveform?: unknown;
}): { durationMs: number | null; mediaMeta: MediaMeta | null } {
  let durationMs: number | null = null;
  const n = Number(input.durationMs);
  if (Number.isFinite(n) && n > 0 && n <= MAX_DURATION_MS) {
    durationMs = Math.round(n);
  }

  const meta: MediaMeta = {};
  if (typeof input.mimeType === "string" && input.mimeType.length < 128) {
    meta.mimeType = input.mimeType.slice(0, 128);
  }
  if (typeof input.codec === "string" && input.codec.length < 64) {
    meta.codec = input.codec.slice(0, 64);
  }
  const sr = Number(input.sampleRate);
  if (Number.isFinite(sr) && sr > 0 && sr <= 192_000) meta.sampleRate = Math.round(sr);
  const ch = Number(input.channels);
  if (Number.isFinite(ch) && ch >= 1 && ch <= 8) meta.channels = Math.round(ch);

  let waveformJson: unknown = input.waveform;
  if (typeof waveformJson === "string") {
    try { waveformJson = JSON.parse(waveformJson); } catch { waveformJson = null; }
  }
  if (Array.isArray(waveformJson)) {
    const peaks = waveformJson
      .slice(0, MAX_WAVEFORM_POINTS)
      .map(v => {
        const x = Number(v);
        if (!Number.isFinite(x)) return 0;
        return Math.max(0, Math.min(100, Math.round(x)));
      });
    if (peaks.length >= 8) meta.waveform = peaks;
  }

  const hasMeta = Object.keys(meta).length > 0;
  return { durationMs, mediaMeta: hasMeta ? meta : null };
}
