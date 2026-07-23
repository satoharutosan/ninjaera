/**
 * Cloudinary storage provider.
 *
 * Uploads go: Browser → Backend → Cloudinary → secure HTTPS URL stored in DB.
 * Large admin files use upload_large / streamed upload_stream — never Buffer the whole file.
 *
 * Folders (via makeObjectKey / prefix mapping):
 *   avatars/  channels/  team/  messages/{images,voice,video,files}/
 *   resources/  contacts/  screenshots/  temp/
 */
import fs from "fs";
import type { Readable } from "stream";
import { v2 as cloudinary } from "cloudinary";
import type { UploadApiResponse, UploadApiOptions } from "cloudinary";
import type { PutObjectInput, PutObjectResult, StorageProvider } from "./types.js";
import { resolvePutBody } from "./putBody.js";

export type CloudinaryStorageOptions = {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  /** Optional folder root prefix (default: ninja-era). */
  rootFolder?: string;
};

/** Chunked uploads for files above this size (Cloudinary recommendation ~20MB). */
const LARGE_UPLOAD_BYTES = 20 * 1024 * 1024;
const CHUNK_SIZE = 6_000_000;

function sanitizeKey(raw: string): string {
  return raw.replace(/^[/\\]+/, "").replace(/\.\./g, "").replace(/\\/g, "/");
}

/** Infer Cloudinary resource_type from Content-Type. */
export function cloudinaryResourceType(contentType?: string): "image" | "video" | "raw" {
  const mime = (contentType || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/") || mime.startsWith("audio/")) return "video";
  return "raw";
}

/**
 * Extract public_id (and optional resource_type) from a Cloudinary delivery URL
 * or from a bare public_id / /uploads/{public_id} façade.
 */
export function parseCloudinaryRef(
  urlOrKey: string,
  cloudName: string,
): { publicId: string; resourceType: "image" | "video" | "raw" } | null {
  if (!urlOrKey) return null;

  if (!urlOrKey.includes("://") && !urlOrKey.startsWith("/")) {
    return { publicId: sanitizeKey(urlOrKey).replace(/\.[a-z0-9]+$/i, ""), resourceType: "image" };
  }

  if (urlOrKey.startsWith("/uploads/")) {
    const key = sanitizeKey(urlOrKey.slice("/uploads/".length));
    return { publicId: key.replace(/\.[a-z0-9]+$/i, ""), resourceType: "image" };
  }

  try {
    const u = new URL(urlOrKey);
    if (!u.hostname.includes("res.cloudinary.com") && !u.hostname.includes("cloudinary.com")) {
      return null;
    }
    const parts = u.pathname.replace(/^\//, "").split("/");
    const cloudIdx = parts[0] === cloudName ? 0 : parts.findIndex((p) => p === cloudName);
    if (cloudIdx < 0) return null;
    const resourceType = (parts[cloudIdx + 1] || "image") as "image" | "video" | "raw";
    const uploadIdx = parts.indexOf("upload", cloudIdx);
    if (uploadIdx < 0) return null;
    let rest = parts.slice(uploadIdx + 1);
    if (rest[0] && /^v\d+$/.test(rest[0])) rest = rest.slice(1);
    while (rest.length > 1 && (rest[0]!.includes(",") || /_(w|h|c|g|q|f)_/.test(rest[0]!))) {
      rest = rest.slice(1);
    }
    if (!rest.length) return null;
    const joined = rest.join("/");
    const publicId = joined.replace(/\.[a-z0-9]+$/i, "");
    if (!publicId) return null;
    return {
      publicId,
      resourceType: resourceType === "video" || resourceType === "raw" ? resourceType : "image",
    };
  } catch {
    return null;
  }
}

function uploadBuffer(
  body: Buffer,
  options: UploadApiOptions,
): Promise<UploadApiResponse> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err || !result) {
        reject(err || new Error("Cloudinary upload returned no result"));
        return;
      }
      resolve(result);
    });
    stream.end(body);
  });
}

function uploadReadable(
  readable: Readable,
  options: UploadApiOptions,
): Promise<UploadApiResponse> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err || !result) {
        reject(err || new Error("Cloudinary upload returned no result"));
        return;
      }
      resolve(result);
    });
    readable.on("error", reject);
    readable.pipe(stream);
  });
}

/** Chunked upload from a disk path — required for multi‑hundred‑MB / GB files. */
function uploadLargePath(
  filePath: string,
  options: UploadApiOptions,
): Promise<UploadApiResponse> {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_large(
      filePath,
      { ...options, chunk_size: CHUNK_SIZE },
      (err, result) => {
        if (err || !result) {
          reject(err || new Error("Cloudinary upload_large returned no result"));
          return;
        }
        resolve(result);
      },
    );
  });
}

export function createCloudinaryStorage(opts: CloudinaryStorageOptions): StorageProvider {
  cloudinary.config({
    cloud_name: opts.cloudName,
    api_key: opts.apiKey,
    api_secret: opts.apiSecret,
    secure: true,
  });

  const cloudName = opts.cloudName;
  const root = (opts.rootFolder || "ninja-era").replace(/^\/+|\/+$/g, "");

  return {
    provider: "cloudinary",
    localRoot: null,

    async putObject(input: PutObjectInput): Promise<PutObjectResult> {
      const key = sanitizeKey(input.key);
      const resourceType = cloudinaryResourceType(input.contentType);

      const lastSlash = key.lastIndexOf("/");
      const folderPart = lastSlash >= 0 ? key.slice(0, lastSlash) : "";
      const filePart = lastSlash >= 0 ? key.slice(lastSlash + 1) : key;
      const publicIdBase = filePart.replace(/\.[a-z0-9]+$/i, "");
      const folder = [root, folderPart].filter(Boolean).join("/");

      const uploadOpts: UploadApiOptions = {
        folder: folder || undefined,
        public_id: publicIdBase,
        resource_type: resourceType,
        overwrite: false,
        unique_filename: false,
        use_filename: false,
        type: "upload",
      };

      let result: UploadApiResponse;
      const sizeHint = input.contentLength
        ?? (input.filePath && fs.existsSync(input.filePath) ? fs.statSync(input.filePath).size : 0);

      if (input.filePath && fs.existsSync(input.filePath)) {
        if (sizeHint >= LARGE_UPLOAD_BYTES) {
          result = await uploadLargePath(input.filePath, uploadOpts);
        } else {
          result = await uploadReadable(fs.createReadStream(input.filePath), uploadOpts);
        }
      } else {
        const resolved = resolvePutBody(input);
        if (Buffer.isBuffer(resolved.body) || resolved.body instanceof Uint8Array) {
          const buf = Buffer.isBuffer(resolved.body) ? resolved.body : Buffer.from(resolved.body);
          result = await uploadBuffer(buf, uploadOpts);
        } else {
          result = await uploadReadable(resolved.body as Readable, uploadOpts);
        }
      }

      const publicId = result.public_id;
      const secureUrl = result.secure_url;
      const inferredMime = input.contentType
        || (result.format
          ? `${resourceType === "raw" ? "application" : resourceType}/${result.format}`
          : undefined);
      return {
        url: secureUrl,
        key: publicId,
        size: result.bytes || sizeHint || 0,
        publicId,
        resourceType,
        originalName: input.originalName,
        contentType: inferredMime,
      };
    },

    async deleteObject(urlOrKey: string) {
      const ref = parseCloudinaryRef(urlOrKey, cloudName);
      if (!ref) return;
      try {
        const types: Array<"image" | "video" | "raw"> = [ref.resourceType, "image", "video", "raw"];
        const tried = new Set<string>();
        for (const rt of types) {
          if (tried.has(rt)) continue;
          tried.add(rt);
          const res = await cloudinary.uploader.destroy(ref.publicId, {
            resource_type: rt,
            invalidate: true,
          });
          if (res.result === "ok" || res.result === "not found") return;
        }
      } catch (e) {
        console.warn("[storage:cloudinary] delete failed:", e instanceof Error ? e.message : e);
      }
    },

    async getPublicUrl(urlOrKey: string) {
      if (urlOrKey.startsWith("https://") || urlOrKey.startsWith("http://")) return urlOrKey;
      const ref = parseCloudinaryRef(urlOrKey, cloudName);
      if (!ref) return urlOrKey;
      return cloudinary.url(ref.publicId, {
        secure: true,
        resource_type: ref.resourceType,
      });
    },

    async getSignedDownloadUrl(
      urlOrKey: string,
      expiresInSeconds = 300,
      _signedOpts?: { downloadFilename?: string },
    ) {
      const ref = parseCloudinaryRef(urlOrKey, cloudName);
      if (!ref) throw new Error("Invalid Cloudinary object reference");
      const expiresAt = Math.floor(Date.now() / 1000) + Math.max(30, expiresInSeconds);
      // Avoid fl_attachment on signed URLs — it can break delivery / auth.
      // The API returns the display filename to the client separately.
      return cloudinary.url(ref.publicId, {
        secure: true,
        resource_type: ref.resourceType,
        sign_url: true,
        type: "upload",
        expires_at: expiresAt,
      });
    },

    isManagedUrl(url: string) {
      if (!url) return false;
      if (url.startsWith("/uploads/")) return true;
      try {
        const u = new URL(url);
        return (
          (u.hostname.includes("res.cloudinary.com") || u.hostname.includes("cloudinary.com"))
          && u.pathname.includes(`/${cloudName}/`)
        );
      } catch {
        return false;
      }
    },
  };
}
