import fs from "fs";
import os from "os";
import path from "path";
import multer from "multer";
import { storeUploadedFile } from "./index.js";
import { resolveDataDirectory } from "../db/factory.js";

/** In-memory multer instance — the file buffer is handed straight to storage. */
export function createMemoryUploader(opts: { limits: { fileSize: number } }) {
  return multer({ storage: multer.memoryStorage(), limits: opts.limits });
}

/**
 * Prefer a persistent volume for large admin temps (Railway `/data`), not tiny `/tmp`.
 * Override with UPLOAD_TEMP_DIR.
 */
export function resolveTempUploadDir(): string {
  if (process.env.UPLOAD_TEMP_DIR) {
    return path.resolve(process.env.UPLOAD_TEMP_DIR);
  }
  if (process.env.UPLOAD_DIR) {
    return path.resolve(process.env.UPLOAD_DIR, ".tmp-uploads");
  }
  try {
    return path.resolve(resolveDataDirectory(), "tmp-uploads");
  } catch {
    return path.join(os.tmpdir(), "ninja-era-uploads");
  }
}

function ensureTempUploadDir(): string {
  const dir = resolveTempUploadDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Disk-backed multer for very large uploads (game builds, resource files) that
 * shouldn't be buffered fully in memory. Files land on disk and must be
 * persisted via `persistMulterFile` (which removes the temp file afterwards).
 */
export function createTempDiskUploader(opts: { limits: { fileSize: number }; prefix?: string }) {
  const dir = ensureTempUploadDir();
  const filePrefix = opts.prefix || "upload";
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        ensureTempUploadDir();
        cb(null, dir);
      } catch (e) {
        cb(e as Error, dir);
      }
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${filePrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  });
  return multer({ storage, limits: opts.limits });
}

/** Remove a temp-disk multer file without persisting it (e.g. on validation failure). */
export function cleanupTempFile(file?: Express.Multer.File | null) {
  if (file && !file.buffer && file.path) {
    try { fs.unlinkSync(file.path); } catch { /* ignore */ }
  }
}

/** Persist a multer file (memory buffer or temp disk path) through the storage layer. */
export async function persistMulterFile(
  file: Express.Multer.File,
  prefix: string,
  opts?: { contentType?: string },
) {
  const mimetype = opts?.contentType || file.mimetype;
  try {
    if (file.buffer) {
      return await storeUploadedFile({
        buffer: file.buffer,
        originalname: file.originalname,
        mimetype,
        prefix,
      });
    }
    return await storeUploadedFile({
      path: file.path,
      originalname: file.originalname,
      mimetype,
      prefix,
    });
  } finally {
    cleanupTempFile(file);
  }
}
