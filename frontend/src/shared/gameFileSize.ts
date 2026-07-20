/** Display helpers for admin-entered game download sizes (MB/GB). */

export type GameFileSizeUnit = "MB" | "GB";

function formatSizeNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toFixed(3)));
}

function formatBytesFallback(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

/** Prefer admin value+unit; fall back to legacy byte formatting. */
export function formatGameFileSize(
  fileSize: number | null | undefined,
  fileSizeUnit: string | null | undefined,
): string {
  if (fileSize == null || !Number.isFinite(fileSize) || fileSize <= 0) return "—";
  if (fileSizeUnit === "MB" || fileSizeUnit === "GB") {
    return `${formatSizeNumber(fileSize)} ${fileSizeUnit}`;
  }
  return formatBytesFallback(fileSize);
}

/** Parse form input before submit. */
export function parseGameFileSizeInput(
  rawValue: string,
  rawUnit: string,
): { ok: true; value: number; unit: GameFileSizeUnit } | { ok: false; error: string } {
  const trimmed = rawValue.trim();
  if (!trimmed) return { ok: false, error: "File size is required" };
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return { ok: false, error: "File size must be a valid number" };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, error: "File size must be greater than zero" };
  }
  if (rawUnit !== "MB" && rawUnit !== "GB") {
    return { ok: false, error: "File size unit must be MB or GB" };
  }
  return { ok: true, value, unit: rawUnit };
}

/** Convert API/legacy size into form fields (default unit MB). */
export function gameSizeToFormFields(
  fileSize?: number | null,
  fileSizeUnit?: string | null,
): { fileSizeInput: string; fileSizeUnit: GameFileSizeUnit } {
  if (fileSize != null && Number.isFinite(fileSize) && fileSize > 0) {
    if (fileSizeUnit === "MB" || fileSizeUnit === "GB") {
      return { fileSizeInput: formatSizeNumber(fileSize), fileSizeUnit };
    }
    // Legacy bytes → prefer GB when ≥ 1 GiB, else MB.
    if (fileSize >= 1073741824) {
      return {
        fileSizeInput: formatSizeNumber(Number((fileSize / 1073741824).toFixed(3))),
        fileSizeUnit: "GB",
      };
    }
    return {
      fileSizeInput: formatSizeNumber(Number((fileSize / 1048576).toFixed(3))),
      fileSizeUnit: "MB",
    };
  }
  return { fileSizeInput: "", fileSizeUnit: "MB" };
}
