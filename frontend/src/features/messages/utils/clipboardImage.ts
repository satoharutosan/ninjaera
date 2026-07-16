/** MIME types accepted from clipboard paste into the message composer. */
const CLIPBOARD_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/bmp",
]);

function extForMime(mime: string): string {
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  if (mime === "image/bmp") return "bmp";
  return "png";
}

function toNamedImageFile(blob: Blob, fallbackName?: string): File {
  const mime = blob.type && CLIPBOARD_IMAGE_TYPES.has(blob.type) ? blob.type : "image/png";
  const ext = extForMime(mime);
  const name =
    fallbackName && /\.(png|jpe?g|webp|gif|bmp)$/i.test(fallbackName)
      ? fallbackName
      : `screenshot-${Date.now()}.${ext}`;
  if (blob instanceof File && blob.name && blob.type) return blob;
  return new File([blob], name, { type: mime, lastModified: Date.now() });
}

/**
 * Extract an image File from a paste event, if present.
 * Returns null for text-only (or non-image) clipboard content.
 */
export function imageFileFromClipboard(
  clipboardData: DataTransfer | null | undefined,
): File | null {
  if (!clipboardData) return null;

  const items = clipboardData.items;
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind !== "file") continue;
      const type = (item.type || "").toLowerCase();
      if (!type.startsWith("image/") || !CLIPBOARD_IMAGE_TYPES.has(type)) continue;
      const blob = item.getAsFile();
      if (!blob || blob.size <= 0) continue;
      return toNamedImageFile(blob, blob.name);
    }
  }

  const files = clipboardData.files;
  if (files?.length) {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const type = (file.type || "").toLowerCase();
      if (!type.startsWith("image/") || !CLIPBOARD_IMAGE_TYPES.has(type)) continue;
      if (file.size <= 0) continue;
      return toNamedImageFile(file, file.name);
    }
  }

  return null;
}
