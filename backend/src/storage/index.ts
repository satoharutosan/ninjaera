import path from "path";
import { fileURLToPath } from "url";
import type { StorageProvider, PutObjectResult } from "./types.js";
import { resolveStorageProviderName } from "./types.js";
import { createLocalStorage } from "./local.js";
import { createS3Storage } from "./s3.js";
import { createCloudinaryStorage } from "./cloudinary.js";
import { resolveDataDirectory } from "../db/factory.js";

export type { StorageProvider, PutObjectResult, PutObjectInput } from "./types.js";
export { makeObjectKey, resolveStorageProviderName, folderForUploadPrefix } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let storage: StorageProvider | null = null;

function resolveLocalUploadDir(): string {
  if (process.env.UPLOAD_DIR) return path.resolve(process.env.UPLOAD_DIR);
  return path.resolve(resolveDataDirectory(), "uploads");
}

export function createStorageProvider(): StorageProvider {
  const name = resolveStorageProviderName();

  if (name === "cloudinary") {
    const cloudName = (process.env.CLOUDINARY_CLOUD_NAME || "").trim();
    const apiKey = (process.env.CLOUDINARY_API_KEY || "").trim();
    const apiSecret = (process.env.CLOUDINARY_API_SECRET || "").trim();
    if (!cloudName || !apiKey || !apiSecret) {
      throw new Error(
        "STORAGE_PROVIDER=cloudinary requires CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.",
      );
    }
    return createCloudinaryStorage({
      cloudName,
      apiKey,
      apiSecret,
      rootFolder: (process.env.CLOUDINARY_FOLDER || "ninja-era").trim() || "ninja-era",
    });
  }

  if (name === "s3") {
    const bucket = process.env.S3_BUCKET || process.env.R2_BUCKET;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY;
    const region = process.env.S3_REGION || process.env.AWS_REGION || "auto";
    const endpoint = process.env.S3_ENDPOINT || process.env.R2_ENDPOINT;
    const publicBaseUrl = process.env.S3_PUBLIC_BASE_URL || process.env.R2_PUBLIC_BASE_URL;
    if (!bucket || !accessKeyId || !secretAccessKey) {
      throw new Error(
        "STORAGE_PROVIDER=s3/r2 requires S3_BUCKET (or R2_BUCKET), S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY.",
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
  console.info(`[storage] provider=${storage.provider}`);
  return storage;
}

export function getStorage(): StorageProvider {
  if (!storage) {
    storage = createStorageProvider();
  }
  return storage;
}

/** Persist upload metadata so public_id can be recovered even if the URL format changes. */
async function registerUploadedAsset(result: PutObjectResult) {
  if (!result.publicId && !result.key) return;
  try {
    const { qRun } = await import("../db/query.js");
    const ts = new Date().toISOString();
    const publicId = result.publicId || result.key;
    const folder = publicId.includes("/")
      ? publicId.split("/").slice(0, -1).join("/")
      : null;
    await qRun("DELETE FROM uploaded_assets WHERE url = ?", result.url);
    await qRun(`
      INSERT INTO uploaded_assets (
        url, public_id, resource_type, original_filename, mime_type, file_size, folder, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
      result.url,
      publicId,
      result.resourceType || "image",
      result.originalName || null,
      result.contentType || null,
      result.size,
      folder,
      ts,
    );
  } catch (e) {
    // Registry is best-effort — never fail the upload because metadata write lagged behind migrations.
    console.warn("[storage] uploaded_assets registry write skipped:", e instanceof Error ? e.message : e);
  }
}

async function unregisterUploadedAsset(url: string) {
  try {
    const { qRun } = await import("../db/query.js");
    await qRun("DELETE FROM uploaded_assets WHERE url = ?", url);
  } catch {
    /* ignore */
  }
}

/** Convenience: upload a multer-style file buffer/path through storage. */
export async function storeUploadedFile(opts: {
  buffer?: Buffer;
  path?: string;
  originalname: string;
  mimetype?: string;
  prefix?: string;
}): Promise<PutObjectResult> {
  const { makeObjectKey } = await import("./types.js");
  const fs = await import("fs");
  const s = getStorage();
  const key = makeObjectKey(opts.prefix || "file", opts.originalname, opts.mimetype);

  // Large admin uploads arrive as a temp disk path — stream it; never readFileSync into RAM.
  let result: PutObjectResult;
  if (opts.path) {
    const size = fs.statSync(opts.path).size;
    result = await s.putObject({
      key,
      filePath: opts.path,
      contentLength: size,
      contentType: opts.mimetype,
      originalName: opts.originalname,
    });
  } else if (opts.buffer) {
    result = await s.putObject({
      key,
      body: opts.buffer,
      contentLength: opts.buffer.length,
      contentType: opts.mimetype,
      originalName: opts.originalname,
    });
  } else {
    throw new Error("storeUploadedFile requires buffer or path");
  }

  await registerUploadedAsset({
    ...result,
    originalName: result.originalName || opts.originalname,
    contentType: result.contentType || opts.mimetype,
  });

  return result;
}

/** Delete a stored object if the URL belongs to our storage. */
export async function deleteStoredUrl(url: string | null | undefined) {
  if (!url) return;
  // Never delete the default / branded Cloudinary logo used in emails or other shared assets.
  const protectedUrls = [
    process.env.EMAIL_BRAND_LOGO_URL,
    "https://res.cloudinary.com/nitb8mqu/image/upload/v1784207614/logo_tgwmkv.png",
  ].filter(Boolean) as string[];
  if (protectedUrls.some((p) => url === p || url.startsWith(p))) return;

  const s = getStorage();
  if (!s.isManagedUrl(url) && !url.startsWith("/uploads/")) return;

  // Prefer registry public_id when available (survives URL transform changes).
  try {
    const { qGet } = await import("../db/query.js");
    const row = await qGet<{ public_id: string; resource_type: string }>(
      "SELECT public_id, resource_type FROM uploaded_assets WHERE url = ?",
      url,
    );
    if (row?.public_id) {
      await s.deleteObject(row.public_id);
      await unregisterUploadedAsset(url);
      return;
    }
  } catch {
    /* fall through to URL-based delete */
  }

  await s.deleteObject(url);
  await unregisterUploadedAsset(url);
}

void __dirname;
