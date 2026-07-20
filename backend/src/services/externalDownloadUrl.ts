/**
 * Validate administrator-supplied external download URLs (e.g. GitHub Release assets).
 * Only http/https are allowed — never javascript:, data:, file:, etc.
 */

export type ExternalUrlResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

const BLOCKED_PROTOCOLS = new Set([
  "javascript:",
  "data:",
  "file:",
  "vbscript:",
  "blob:",
  "about:",
]);

export function validateExternalDownloadUrl(raw: unknown): ExternalUrlResult {
  if (raw == null || typeof raw !== "string") {
    return { ok: false, error: "External download URL is required" };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: "External download URL is required" };
  }
  if (/\s/.test(trimmed)) {
    return { ok: false, error: "URL must not contain whitespace" };
  }

  const lower = trimmed.toLowerCase();
  for (const proto of BLOCKED_PROTOCOLS) {
    if (lower.startsWith(proto)) {
      return { ok: false, error: "Only HTTP and HTTPS URLs are allowed" };
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "Please enter a valid URL (for example https://github.com/...)" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Only HTTP and HTTPS URLs are allowed" };
  }

  if (!parsed.hostname) {
    return { ok: false, error: "URL must include a hostname" };
  }

  // Normalize: drop hash (not needed for downloads), keep query (GitHub asset tokens).
  parsed.hash = "";
  return { ok: true, url: parsed.toString() };
}

/** True when this resource category uses an external download URL instead of file upload. */
export function usesExternalDownload(category: string | null | undefined): boolean {
  return String(category || "").trim().toLowerCase() === "app";
}
