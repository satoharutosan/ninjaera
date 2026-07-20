/** Manual game download size: admin-entered value + MB/GB unit. */

export type GameFileSizeUnit = "MB" | "GB";

const UNITS = new Set<GameFileSizeUnit>(["MB", "GB"]);
const MB_BYTES = 1024 * 1024;
const GB_BYTES = 1024 * 1024 * 1024;

export function isGameFileSizeUnit(v: unknown): v is GameFileSizeUnit {
  return typeof v === "string" && UNITS.has(v as GameFileSizeUnit);
}

export function bytesFromGameFileSize(value: number, unit: GameFileSizeUnit): number {
  const mult = unit === "GB" ? GB_BYTES : MB_BYTES;
  return Math.round(value * mult);
}

/**
 * Parse admin-submitted size. Rejects non-numeric, ≤0, and unknown units.
 */
export function parseGameFileSize(
  rawValue: unknown,
  rawUnit: unknown,
): { ok: true; value: number; unit: GameFileSizeUnit; bytes: number } | { ok: false; error: string } {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return { ok: false, error: "File size is required" };
  }
  const value = typeof rawValue === "number" ? rawValue : Number(String(rawValue).trim());
  if (!Number.isFinite(value)) {
    return { ok: false, error: "File size must be a valid number" };
  }
  if (value <= 0) {
    return { ok: false, error: "File size must be greater than zero" };
  }
  if (!isGameFileSizeUnit(rawUnit)) {
    return { ok: false, error: "File size unit must be MB or GB" };
  }
  return { ok: true, value, unit: rawUnit, bytes: bytesFromGameFileSize(value, rawUnit) };
}

/** Format for UI: prefer admin value+unit; fall back to legacy byte formatting. */
export function formatGameFileSize(
  value: number | null | undefined,
  unit: string | null | undefined,
  bytesFallback?: number | null,
): string {
  if (value != null && Number.isFinite(value) && value > 0 && isGameFileSizeUnit(unit)) {
    return `${formatSizeNumber(value)} ${unit}`;
  }
  const bytes = bytesFallback ?? null;
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB_BYTES) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < GB_BYTES) return `${(bytes / MB_BYTES).toFixed(1)} MB`;
  return `${(bytes / GB_BYTES).toFixed(1)} GB`;
}

function formatSizeNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  // Trim floating noise: 1.50 → 1.5
  return String(Number(n.toFixed(3)));
}

/**
 * Map a DB row to API fields. Prefer stored value+unit; for legacy byte-only
 * rows, expose bytes as fileSize with a null unit so clients can format them.
 */
export function gameFileSizeApiFields(row: {
  file_size_value?: number | null;
  file_size_unit?: string | null;
  file_size?: number | null;
}): { fileSize: number | null; fileSizeUnit: GameFileSizeUnit | null } {
  const value = row.file_size_value != null ? Number(row.file_size_value) : null;
  const unit = row.file_size_unit;
  if (value != null && Number.isFinite(value) && value > 0 && isGameFileSizeUnit(unit)) {
    return { fileSize: value, fileSizeUnit: unit };
  }
  const bytes = row.file_size != null ? Number(row.file_size) : null;
  if (bytes != null && Number.isFinite(bytes) && bytes > 0) {
    return { fileSize: bytes, fileSizeUnit: null };
  }
  return { fileSize: null, fileSizeUnit: null };
}
