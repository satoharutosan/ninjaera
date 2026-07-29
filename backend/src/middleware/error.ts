import type { Request, Response, NextFunction } from "express";
import multer from "multer";

/** Map storage/provider failures to accurate client messages (no secrets). */
export function mapClientUploadError(err: unknown): { status: number; error: string } | null {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes("storage_provider=cloudinary requires") || lower.includes("storage_provider=s3")) {
    return { status: 503, error: "Upload failed: storage is not configured correctly." };
  }
  if (
    lower.includes("invalid api key")
    || lower.includes("invalid signature")
    || (lower.includes("unauthorized") && lower.includes("cloudinary"))
  ) {
    return { status: 503, error: "Upload failed: Cloudinary authentication failed." };
  }
  if (lower.includes("cloudinary") && (lower.includes("auth") || lower.includes("api_key") || lower.includes("401") || lower.includes("403"))) {
    return { status: 503, error: "Upload failed: Cloudinary authentication failed." };
  }
  if (lower.includes("file size too large") || (lower.includes("maximum is") && lower.includes("cloudinary"))) {
    return {
      status: 413,
      error: "Upload failed: file exceeds Cloudinary’s plan size limit. Use S3/R2 storage for large game builds, or upgrade the Cloudinary plan.",
    };
  }
  if (lower.includes("enospc")) {
    return { status: 503, error: "Upload failed: server disk is full. Free space or attach a larger volume." };
  }
  if (lower.includes("eacces") || (lower.includes("permission denied") && lower.includes("upload"))) {
    return { status: 503, error: "Upload failed: storage write permission error." };
  }
  if (
    lower.includes("etimedout")
    || lower.includes("timeout")
    || lower.includes("econnreset")
    || lower.includes("socket hang up")
    || lower.includes("aborted")
  ) {
    return {
      status: 504,
      error: "Upload failed: connection interrupted during file transfer. Please retry. For multi‑GB files, use a stable connection and S3/R2 storage when possible.",
    };
  }
  if (lower.includes("temp file missing") || lower.includes("enoent")) {
    return { status: 500, error: "Upload failed: temporary upload file was lost before storage completed. Please retry." };
  }
  if (lower.includes("storeuploadedfile") || lower.includes("cloudinary upload") || lower.includes("putobject") || lower.includes("upload_large")) {
    return { status: 500, error: "Upload failed because the storage write operation was unsuccessful." };
  }
  if (
    lower.includes("public_slug")
    && (lower.includes("no such column") || lower.includes("does not exist"))
  ) {
    return {
      status: 503,
      error: "Upload failed: database schema is out of date. Restart the server to apply pending migrations.",
    };
  }
  if (
    lower.includes("unique constraint")
    || lower.includes("not null")
    || lower.includes("foreign key")
    || lower.includes("duplicate key")
    || lower.includes("violates")
    || lower.includes("insert into")
  ) {
    return { status: 500, error: "Upload failed because the database record could not be created." };
  }
  return null;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: "Upload failed: file is too large for this upload endpoint.",
        code: "FILE_TOO_LARGE",
      });
      return;
    }
    res.status(400).json({ error: err.message || "Upload failed" });
    return;
  }
  console.error(err);
  if (err instanceof Error && err.message.includes("UNIQUE constraint")) {
    res.status(409).json({ error: "Resource already exists" });
    return;
  }
  const mapped = mapClientUploadError(err);
  if (mapped) {
    res.status(mapped.status).json({ error: mapped.error });
    return;
  }
  res.status(500).json({ error: "Internal server error" });
}

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: "Not found" });
}
