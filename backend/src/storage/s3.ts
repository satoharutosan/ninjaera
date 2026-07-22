import fs from "fs";
import {
  S3Client,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { PutObjectInput, PutObjectResult, StorageProvider } from "./types.js";
import { resolvePutBody } from "./putBody.js";
import { contentDispositionAttachment } from "../services/downloadFilename.js";

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

  function contentDisposition(contentType: string): string {
    return contentType.startsWith("image/")
      || contentType.startsWith("video/")
      || contentType.startsWith("audio/")
      || contentType === "application/pdf"
      ? "inline"
      : "attachment";
  }

  return {
    provider: "s3",
    localRoot: null,

    async putObject(input: PutObjectInput): Promise<PutObjectResult> {
      const key = input.key.replace(/^[/\\]+/, "").replace(/\.\./g, "");
      const contentType = input.contentType || "application/octet-stream";
      const resolved = resolvePutBody(input);
      const size = resolved.size
        || (input.filePath && fs.existsSync(input.filePath) ? fs.statSync(input.filePath).size : 0);

      const isBuffer = Buffer.isBuffer(resolved.body) || resolved.body instanceof Uint8Array;
      // Multipart Upload streams from disk/path without buffering the whole object.
      const upload = new Upload({
        client,
        params: {
          Bucket: opts.bucket,
          Key: key,
          Body: resolved.body as never,
          ContentType: contentType,
          ContentDisposition: contentDisposition(contentType),
          // Only set ContentLength for in-memory bodies; streams are sized by multipart parts.
          ...(isBuffer && size > 0 ? { ContentLength: size } : {}),
        },
        queueSize: 4,
        partSize: 8 * 1024 * 1024,
        leavePartsOnError: false,
      });

      await upload.done();

      // Keep app-relative URLs so private objects are not permanently public via CDN.
      const url = `/uploads/${key}`;
      return { url, key, size: size || 0 };
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
      if (publicBase) return `${publicBase}/${key}`;
      return `/uploads/${key}`;
    },

    async getSignedDownloadUrl(
      urlOrKey: string,
      expiresInSeconds = 300,
      signedOpts?: { downloadFilename?: string },
    ) {
      const key = keyFromUrl(urlOrKey) || urlOrKey.replace(/^[/\\]+/, "").replace(/\.\./g, "");
      if (!key || key.includes("..")) throw new Error("Invalid object key");
      const filename = signedOpts?.downloadFilename?.trim();
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: opts.bucket,
          Key: key,
          ...(filename ? { ResponseContentDisposition: contentDispositionAttachment(filename) } : {}),
        }),
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
