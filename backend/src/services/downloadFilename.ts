import path from "path";

/** Sanitize a filename for Content-Disposition (ASCII-safe quoted form). */
export function sanitizeDownloadFilename(filename: string): string {
  const cleaned = filename
    .replace(/["\r\n\\]/g, "_")
    .replace(/[<>:|?*\x00-\x1f]/g, "_")
    .trim();
  return cleaned || "file";
}

export function contentDispositionAttachment(filename: string): string {
  const safe = sanitizeDownloadFilename(filename);
  const encoded = encodeURIComponent(safe);
  return `attachment; filename="${safe}"; filename*=UTF-8''${encoded}`;
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
