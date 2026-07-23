import path from "path";

/** Sanitize a filename for Content-Disposition / browser save-as. */
export function sanitizeDownloadFilename(filename: string): string {
  // Never allow path segments — disposition filenames must be a single leaf name.
  const base = path.basename(String(filename || "").replace(/\\/g, "/").trim()) || "file";
  const cleaned = base
    .replace(/["\r\n\\]/g, "_")
    .replace(/[<>:|?*\x00-\x1f/]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "file";
}

/**
 * ASCII-only quoted filename for S3/R2 ResponseContentDisposition compatibility.
 * Prefer filename* (RFC 5987) for the real name when serving from our own API.
 */
export function contentDispositionAttachment(filename: string): string {
  const safe = sanitizeDownloadFilename(filename);
  const ascii = safe.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_") || "file";
  const encoded = encodeURIComponent(safe);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * Prefer stored original upload name; fall back to title+ext or storage basename
 * so legacy rows without original_filename still download cleanly.
 */
export function resolveResourceDownloadFilename(resource: {
  id: number;
  title?: string | null;
  original_filename?: string | null;
  content_url?: string | null;
}): string {
  const original = resource.original_filename?.trim();
  if (original) return sanitizeDownloadFilename(original);

  const storageBase = resource.content_url
    ? path.basename(String(resource.content_url).split("?")[0].replace(/\\/g, "/"))
    : "";
  const ext = path.extname(storageBase);
  const title = (resource.title || "").trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
  if (title) {
    const hasExt = path.extname(title).length > 0;
    return sanitizeDownloadFilename(hasExt ? title : `${title}${ext}`);
  }
  if (storageBase) return sanitizeDownloadFilename(storageBase);
  return `resource-${resource.id}${ext}`;
}
