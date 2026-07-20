/** Storage provider abstraction for user-uploaded files. */

import type { Readable } from "stream";

export type StorageProviderName = "local" | "s3" | "cloudinary";

export type PutObjectInput = {
  /** Destination key / relative path, e.g. `avatars/avatar-….webp` */
  key: string;
  /**
   * Small uploads may pass a Buffer. Prefer `filePath` / `stream` for large
   * admin game/resource files so the process never holds the whole file in RAM.
   */
  body?: Buffer | Uint8Array;
  /** Absolute path on disk (multer temp) — streamed by providers. */
  filePath?: string;
  stream?: Readable;
  /** Known byte length (from multer / fs.stat). Required for accurate progress & S3. */
  contentLength?: number;
  contentType?: string;
  originalName?: string;
};

export type PutObjectResult = {
  /** Public or app-relative URL stored in the database (Cloudinary: secure HTTPS URL). */
  url: string;
  /** Storage key / Cloudinary public_id. */
  key: string;
  size: number;
  /** Cloudinary public_id when provider is cloudinary. */
  publicId?: string;
  /** Cloudinary resource_type when known. */
  resourceType?: "image" | "video" | "raw";
  originalName?: string;
  contentType?: string;
};

export interface StorageProvider {
  readonly provider: StorageProviderName;
  /** Absolute local root when provider is local; otherwise null. */
  readonly localRoot: string | null;

  putObject(input: PutObjectInput): Promise<PutObjectResult>;
  deleteObject(urlOrKey: string): Promise<void>;
  /** Resolve a stored URL/key to a publicly fetchable URL. */
  getPublicUrl(urlOrKey: string): Promise<string>;
  /** Optional short-lived signed URL for private downloads. */
  getSignedDownloadUrl?(urlOrKey: string, expiresInSeconds?: number): Promise<string>;
  /** Whether this URL/key is managed by this storage layer. */
  isManagedUrl(url: string): boolean;
}

export function resolveStorageProviderName(): StorageProviderName {
  const raw = (process.env.STORAGE_PROVIDER || "local").trim().toLowerCase();
  if (raw === "cloudinary" || raw === "cloudinary-cloud") return "cloudinary";
  // Legacy alias: "cloud" historically meant S3/R2. Prefer STORAGE_PROVIDER=cloudinary for Cloudinary.
  if (raw === "s3" || raw === "r2" || raw === "cloud" || raw === "minio") return "s3";
  return "local";
}

/**
 * Map upload prefixes used by routes to Cloudinary / object-storage folders.
 * Keeps filenames unique while organizing assets for operators.
 */
export function folderForUploadPrefix(prefix: string, contentType?: string): string {
  const p = prefix.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase();
  const mime = (contentType || "").toLowerCase();

  if (p === "avatar" || p === "avatars") return "avatars";
  if (p === "channelavatar" || p === "channel-avatar" || p === "channels") return "channels";
  if (p === "team" || p === "team-avatar" || p === "teamavatar") return "team";
  if (p === "our-story" || p === "ourstory" || p === "story") return "team";
  if (p === "screenshot" || p === "screenshots" || p === "clipboard") return "screenshots";
  if (p === "resource" || p === "resources") return "resources";
  if (p === "job-photo" || p === "jobphoto" || p === "job-cv" || p === "jobcv" || p === "contact" || p === "contacts") {
    return "contacts";
  }
  if (p === "game" || p === "games") return "resources";
  if (p === "external" || p === "externals" || p === "linkfile" || p === "link-file") return "externals";
  if (p === "temp" || p === "tmp") return "temp";

  if (p === "message" || p === "messages" || p === "media") {
    if (mime.startsWith("audio/")) return "messages/voice";
    if (mime.startsWith("video/")) return "messages/video";
    if (mime.startsWith("image/")) return "messages/images";
    return "messages/files";
  }

  return "temp";
}

/** Build a unique object key with folder + collision-safe filename. */
export function makeObjectKey(prefix: string, originalName: string, contentType?: string): string {
  const ext = (originalName.match(/\.[a-zA-Z0-9]+$/) || [""])[0].toLowerCase();
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, "") || "file";
  const folder = folderForUploadPrefix(prefix, contentType);
  const unique = `${safePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
  return `${folder}/${unique}`;
}
