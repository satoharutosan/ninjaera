import path from "path";
import { fileURLToPath } from "url";
import type { StorageProvider } from "./types.js";
import { resolveStorageProviderName } from "./types.js";
import { createLocalStorage } from "./local.js";
import { createS3Storage } from "./s3.js";
import { resolveDataDirectory } from "../db/factory.js";

export type { StorageProvider, PutObjectResult, PutObjectInput } from "./types.js";
export { makeObjectKey, resolveStorageProviderName } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let storage: StorageProvider | null = null;

function resolveLocalUploadDir(): string {
  if (process.env.UPLOAD_DIR) return path.resolve(process.env.UPLOAD_DIR);
  // Prefer persistent data directory over app source tree
  return path.resolve(resolveDataDirectory(), "uploads");
}

export function createStorageProvider(): StorageProvider {
  const name = resolveStorageProviderName();
  if (name === "s3") {
    const bucket = process.env.S3_BUCKET || process.env.R2_BUCKET;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY;
    const region = process.env.S3_REGION || process.env.AWS_REGION || "auto";
    const endpoint = process.env.S3_ENDPOINT || process.env.R2_ENDPOINT;
    const publicBaseUrl = process.env.S3_PUBLIC_BASE_URL || process.env.R2_PUBLIC_BASE_URL;
    if (!bucket || !accessKeyId || !secretAccessKey) {
      throw new Error(
        "STORAGE_PROVIDER=s3/cloud requires S3_BUCKET (or R2_BUCKET), S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY.",
      );
    }
    return createS3Storage({
      bucket,
      accessKeyId,
      secretAccessKey,
      region,
      endpoint,
      publicBaseUrl,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    });
  }
  return createLocalStorage({ rootDir: resolveLocalUploadDir() });
}

export async function initStorage(): Promise<StorageProvider> {
  storage = createStorageProvider();
  return storage;
}

export function getStorage(): StorageProvider {
  if (!storage) {
    storage = createStorageProvider();
  }
  return storage;
}

/** Convenience: upload a multer-style file buffer/path through storage. */
export async function storeUploadedFile(opts: {
  buffer?: Buffer;
  path?: string;
  originalname: string;
  mimetype?: string;
  prefix?: string;
}): Promise<{ url: string; key: string; size: number }> {
  const { makeObjectKey } = await import("./types.js");
  const fs = await import("fs");
  const s = getStorage();
  const key = makeObjectKey(opts.prefix || "file", opts.originalname);
  let body: Buffer;
  if (opts.buffer) body = opts.buffer;
  else if (opts.path) body = fs.readFileSync(opts.path);
  else throw new Error("storeUploadedFile requires buffer or path");
  return s.putObject({
    key,
    body,
    contentType: opts.mimetype,
    originalName: opts.originalname,
  });
}

/** Delete a stored object if the URL belongs to our storage. */
export async function deleteStoredUrl(url: string | null | undefined) {
  if (!url) return;
  const s = getStorage();
  if (!s.isManagedUrl(url) && !url.startsWith("/uploads/")) return;
  await s.deleteObject(url);
}

void __dirname;
