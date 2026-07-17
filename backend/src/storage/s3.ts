import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { PutObjectInput, PutObjectResult, StorageProvider } from "./types.js";

export type S3StorageOptions = {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Public base URL for objects (CDN / R2 public bucket URL). */
  publicBaseUrl?: string;
  forcePathStyle?: boolean;
};

export function createS3Storage(opts: S3StorageOptions): StorageProvider {
  const client = new S3Client({
    region: opts.region,
    endpoint: opts.endpoint || undefined,
    forcePathStyle: opts.forcePathStyle ?? !!opts.endpoint,
    credentials: {
      accessKeyId: opts.accessKeyId,
      secretAccessKey: opts.secretAccessKey,
    },
  });

  const publicBase = (opts.publicBaseUrl || "").replace(/\/$/, "");

  function keyFromUrl(urlOrKey: string): string | null {
    if (!urlOrKey) return null;
    if (!urlOrKey.includes("://") && !urlOrKey.startsWith("/")) return urlOrKey;
    if (urlOrKey.startsWith("/uploads/")) return urlOrKey.slice("/uploads/".length);
    try {
      const u = new URL(urlOrKey);
      if (publicBase && urlOrKey.startsWith(publicBase + "/")) {
        return urlOrKey.slice(publicBase.length + 1);
      }
      // path-style: /bucket/key
      const parts = u.pathname.replace(/^\//, "").split("/");
      if (parts[0] === opts.bucket) return parts.slice(1).join("/");
      return parts.join("/");
    } catch {
      return null;
    }
  }

  return {
    provider: "s3",
    localRoot: null,

    async putObject(input: PutObjectInput): Promise<PutObjectResult> {
      const key = input.key.replace(/^[/\\]+/, "").replace(/\.\./g, "");
      const buf = Buffer.isBuffer(input.body) ? input.body : Buffer.from(input.body);
      // Prefer validated Content-Type from the upload pipeline; never trust HTML/SVG as images.
      const contentType = input.contentType || "application/octet-stream";
      await client.send(new PutObjectCommand({
        Bucket: opts.bucket,
        Key: key,
        Body: buf,
        ContentType: contentType,
        ContentDisposition: contentType.startsWith("image/")
          || contentType.startsWith("video/")
          || contentType.startsWith("audio/")
          || contentType === "application/pdf"
          ? "inline"
          : "attachment",
      }));
      // Keep app-relative URLs so private objects are not permanently public via CDN.
      // Signed URLs are minted at download time.
      const url = `/uploads/${key}`;
      return { url, key, size: buf.length };
    },

    async deleteObject(urlOrKey: string) {
      const key = keyFromUrl(urlOrKey);
      if (!key || key.includes("..")) return;
      try {
        await client.send(new DeleteObjectCommand({ Bucket: opts.bucket, Key: key }));
      } catch (e) {
        console.warn("[storage] delete failed:", e instanceof Error ? e.message : e);
      }
    },

    async getPublicUrl(urlOrKey: string) {
      const key = keyFromUrl(urlOrKey) || urlOrKey.replace(/^[/\\]+/, "").replace(/\.\./g, "");
      // Prefer app-relative path; signed URLs should be used for private downloads.
      if (publicBase) return `${publicBase}/${key}`;
      return `/uploads/${key}`;
    },

    async getSignedDownloadUrl(urlOrKey: string, expiresInSeconds = 300) {
      const key = keyFromUrl(urlOrKey) || urlOrKey.replace(/^[/\\]+/, "").replace(/\.\./g, "");
      if (!key || key.includes("..")) throw new Error("Invalid object key");
      return getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: opts.bucket, Key: key }),
        { expiresIn: expiresInSeconds },
      );
    },

    isManagedUrl(url: string) {
      if (url.startsWith("/uploads/")) return true;
      if (publicBase && url.startsWith(publicBase)) return true;
      return false;
    },
  };
}
