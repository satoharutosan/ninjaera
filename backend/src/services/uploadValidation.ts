import path from "path";
import {
  ADMIN_GAME_MAX_BYTES,
  ADMIN_LINK_FILE_MAX_BYTES,
  ADMIN_RESOURCE_MAX_BYTES,
} from "../config/uploadLimits.js";

export type UploadKind =
  | "avatar"
  | "channelAvatar"
  | "storyImage"
  | "image"
  | "messageMedia"
  | "jobPhoto"
  | "jobCv"
  | "resourceFile"
  | "gameFile"
  | "linkFile";

export type ValidatedUpload = {
  ok: true;
  mime: string;
  ext: string;
  /** Safe Content-Type to store/serve (never trust client alone). */
  contentType: string;
};

export type UploadRejection = {
  ok: false;
  error: string;
};

type Rule = {
  mimes: Set<string>;
  exts: Set<string>;
  /** Magic-byte checkers — at least one must match when present. */
  magic?: Array<(buf: Buffer) => boolean>;
  maxBytes?: number;
};

const IMAGE_MAGIC: Array<(buf: Buffer) => boolean> = [
  (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, // JPEG
  (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47, // PNG
  (b) => b.length >= 12
    && b.toString("ascii", 0, 4) === "RIFF"
    && b.toString("ascii", 8, 12) === "WEBP",
  (b) => b.length >= 6 && (b.toString("ascii", 0, 6) === "GIF87a" || b.toString("ascii", 0, 6) === "GIF89a"),
];

const PDF_MAGIC = (b: Buffer) => b.length >= 5 && b.toString("ascii", 0, 5) === "%PDF-";

/** ISO BMFF / MP4 family — `ftyp` box at offset 4. */
const MP4_MAGIC = (b: Buffer) => b.length >= 12 && b.toString("ascii", 4, 8) === "ftyp";

const ZIP_MAGIC = (b: Buffer) =>
  b.length >= 4
  && ((b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07) && (b[3] === 0x04 || b[3] === 0x06 || b[3] === 0x08))
    || (b[0] === 0x1f && b[1] === 0x8b)); // gzip / some archives

const RULES: Record<UploadKind, Rule> = {
  avatar: {
    mimes: new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]),
    exts: new Set([".png", ".jpg", ".jpeg", ".webp"]),
    magic: IMAGE_MAGIC.filter((_, i) => i < 3), // no GIF for avatars
    maxBytes: 5 * 1024 * 1024,
  },
  channelAvatar: {
    mimes: new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]),
    exts: new Set([".png", ".jpg", ".jpeg", ".webp"]),
    magic: IMAGE_MAGIC.filter((_, i) => i < 3),
    maxBytes: 5 * 1024 * 1024,
  },
  storyImage: {
    mimes: new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]),
    exts: new Set([".png", ".jpg", ".jpeg", ".webp"]),
    magic: IMAGE_MAGIC.filter((_, i) => i < 3),
    maxBytes: 8 * 1024 * 1024,
  },
  image: {
    mimes: new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]),
    exts: new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]),
    magic: IMAGE_MAGIC,
    maxBytes: 15 * 1024 * 1024,
  },
  messageMedia: {
    mimes: new Set([
      "image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif",
      "video/mp4", "video/webm", "video/quicktime",
      "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/ogg", "audio/webm", "audio/mp4",
      "application/pdf",
      "application/zip", "application/x-zip-compressed",
      "text/plain",
    ]),
    exts: new Set([
      ".png", ".jpg", ".jpeg", ".webp", ".gif",
      ".mp4", ".webm", ".mov",
      ".mp3", ".wav", ".ogg", ".m4a",
      ".pdf", ".zip", ".txt",
    ]),
    maxBytes: 50 * 1024 * 1024,
  },
  jobPhoto: {
    mimes: new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]),
    exts: new Set([".png", ".jpg", ".jpeg", ".webp"]),
    magic: IMAGE_MAGIC.filter((_, i) => i < 3),
    maxBytes: 5 * 1024 * 1024,
  },
  jobCv: {
    mimes: new Set([
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]),
    exts: new Set([".pdf", ".doc", ".docx"]),
    magic: [PDF_MAGIC, ZIP_MAGIC], // docx is a zip
    maxBytes: 10 * 1024 * 1024,
  },
  resourceFile: {
    mimes: new Set([
      "application/pdf",
      "application/zip", "application/x-zip-compressed",
      "application/x-rar-compressed", "application/vnd.rar",
      "application/octet-stream",
      "image/png", "image/jpeg", "image/webp",
      "text/plain",
      "application/json",
    ]),
    exts: new Set([
      ".pdf", ".zip", ".rar", ".7z",
      ".png", ".jpg", ".jpeg", ".webp",
      ".txt", ".json", ".unitypackage", ".assetbundle",
    ]),
    maxBytes: ADMIN_RESOURCE_MAX_BYTES,
  },
  gameFile: {
    mimes: new Set([
      "application/zip", "application/x-zip-compressed",
      "application/octet-stream",
      "application/x-msdownload",
      "application/vnd.android.package-archive",
    ]),
    exts: new Set([".zip", ".exe", ".apk", ".dmg", ".pkg", ".msi", ".7z"]),
    maxBytes: ADMIN_GAME_MAX_BYTES,
  },
  linkFile: {
    mimes: new Set([
      "image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif",
      "video/mp4",
      "application/pdf",
    ]),
    exts: new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".pdf"]),
    magic: [...IMAGE_MAGIC, PDF_MAGIC, MP4_MAGIC],
    maxBytes: ADMIN_LINK_FILE_MAX_BYTES,
  },
};

/** MIME types that must never be served inline (XSS / scriptable docs). */
const FORCE_ATTACHMENT = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "text/xml",
  "application/xml",
  "application/javascript",
  "text/javascript",
]);

const PREVIEWABLE = new Set([
  "image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif",
  "video/mp4", "video/webm",
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/ogg", "audio/webm",
  "application/pdf",
]);

function normalizeMime(raw: string | undefined | null): string {
  return (raw || "").split(";")[0].trim().toLowerCase();
}

function extOf(filename: string): string {
  const e = path.extname(filename || "").toLowerCase();
  return e;
}

function sniffMimeFromMagic(buf: Buffer): string | null {
  if (IMAGE_MAGIC[0](buf)) return "image/jpeg";
  if (IMAGE_MAGIC[1](buf)) return "image/png";
  if (IMAGE_MAGIC[2](buf)) return "image/webp";
  if (IMAGE_MAGIC[3](buf)) return "image/gif";
  if (PDF_MAGIC(buf)) return "application/pdf";
  if (MP4_MAGIC(buf)) return "video/mp4";
  if (ZIP_MAGIC(buf)) return "application/zip";
  return null;
}

/**
 * Validate an uploaded file: MIME ∧ extension ∧ (magic when available).
 * Never trust client MIME alone for the stored Content-Type.
 */
export function validateUpload(opts: {
  kind: UploadKind;
  originalName: string;
  declaredMime?: string | null;
  buffer?: Buffer | null;
  size?: number;
}): ValidatedUpload | UploadRejection {
  const rule = RULES[opts.kind];
  const ext = extOf(opts.originalName);
  const declared = normalizeMime(opts.declaredMime);
  const size = opts.size ?? opts.buffer?.length ?? 0;

  if (rule.maxBytes && size > rule.maxBytes) {
    return { ok: false, error: `File exceeds maximum size of ${Math.round(rule.maxBytes / (1024 * 1024))}MB` };
  }

  if (!ext || !rule.exts.has(ext)) {
    return { ok: false, error: `File extension not allowed (got ${ext || "none"})` };
  }

  if (!declared || !rule.mimes.has(declared)) {
    return { ok: false, error: `File type not allowed (got ${declared || "unknown"})` };
  }

  // Block HTML/SVG even if somehow declared under a loose rule
  if (FORCE_ATTACHMENT.has(declared) || ext === ".html" || ext === ".htm" || ext === ".svg" || ext === ".js") {
    return { ok: false, error: "Executable or scriptable file types are not allowed" };
  }

  let contentType = declared === "image/jpg" ? "image/jpeg" : declared;

  if (opts.buffer && opts.buffer.length > 0) {
    if (rule.magic && rule.magic.length) {
      const matched = rule.magic.some((fn) => fn(opts.buffer!));
      // For job CV: PDF must match PDF magic; Office docs match ZIP
      if (opts.kind === "jobCv") {
        if (ext === ".pdf" && !PDF_MAGIC(opts.buffer)) {
          return { ok: false, error: "File content does not match PDF type" };
        }
        if ((ext === ".docx") && !ZIP_MAGIC(opts.buffer)) {
          return { ok: false, error: "File content does not match DOCX type" };
        }
        // .doc is legacy OLE — skip strict magic
      } else if (!matched && ["avatar", "channelAvatar", "storyImage", "image", "jobPhoto"].includes(opts.kind)) {
        return { ok: false, error: "File content does not match declared image type" };
      } else if (!matched && opts.kind === "messageMedia" && declared.startsWith("image/")) {
        return { ok: false, error: "File content does not match declared image type" };
      } else if (!matched && opts.kind === "linkFile") {
        return { ok: false, error: "File content does not match the declared type" };
      }
    }

    const sniffed = sniffMimeFromMagic(opts.buffer);
    if (sniffed && sniffed.startsWith("image/")) {
      contentType = sniffed;
    } else if (sniffed === "application/pdf" && declared.includes("pdf")) {
      contentType = "application/pdf";
    } else if (sniffed === "video/mp4" && (declared.includes("mp4") || ext === ".mp4")) {
      contentType = "video/mp4";
    }
  }

  return { ok: true, mime: contentType, ext, contentType };
}

export function shouldForceAttachment(contentType: string): boolean {
  const mime = normalizeMime(contentType);
  if (FORCE_ATTACHMENT.has(mime)) return true;
  if (!PREVIEWABLE.has(mime) && !mime.startsWith("image/") && !mime.startsWith("video/") && !mime.startsWith("audio/")) {
    return true;
  }
  return false;
}

export function isPreviewableMime(contentType: string): boolean {
  return PREVIEWABLE.has(normalizeMime(contentType));
}
