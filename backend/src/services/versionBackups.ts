import path from "path";
import type { Request } from "express";
import { qAll, qGet, qRun } from "../db/query.js";
import { clientIp } from "../middleware/rateLimit.js";
import { lookupGeo } from "./geoip.js";
import { deleteStoredUrl } from "../storage/index.js";
import type { PutObjectResult } from "../storage/types.js";

export const VERSION_BACKUP_ALLOWED_EXTS = [
  ".zip",
  ".7z",
  ".rar",
  ".tar",
  ".gz",
  ".tgz",
  ".bz2",
  ".xz",
] as const;

export type VersionBackupStatus = "active" | "disabled" | "deleted";

export type VersionBackupRow = {
  id: number;
  original_filename: string;
  stored_filename: string;
  file_url: string;
  file_extension: string;
  file_size: number;
  mime_type: string | null;
  uploader_ip: string | null;
  uploader_id: number | null;
  country?: string | null;
  country_code?: string | null;
  download_count: number;
  status: string;
  created_at: string;
  updated_at: string;
};

export function sanitizeOriginalFilename(raw: string): string {
  const base = path.basename(String(raw || "").replace(/\\/g, "/").trim()) || "backup.zip";
  return base
    .replace(/[<>:"|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200) || "backup.zip";
}

export function extensionOf(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return ext || "";
}

export function isAllowedBackupExtension(filename: string): boolean {
  const ext = extensionOf(filename);
  return (VERSION_BACKUP_ALLOWED_EXTS as readonly string[]).includes(ext);
}

/**
 * Device id from Telegram backup filename prefix.
 * Example: `98eecbb4db5a_7.0.4.0_ET.zip` → `98eecbb4db5a`
 */
export function deviceIdFromFilename(filename: string): string {
  const safe = sanitizeOriginalFilename(filename);
  const stem = path.basename(safe, extensionOf(safe) || undefined);
  const prefix = stem.split("_")[0]?.trim() || "";
  return prefix || "unknown";
}

/** Human-friendly unique leaf name: OriginalBase_timestamp.ext */
export function buildStoredFilename(originalName: string): string {
  const safe = sanitizeOriginalFilename(originalName);
  const ext = extensionOf(safe) || ".zip";
  const stem = path.basename(safe, ext).replace(/[^\w.\-()+ ]+/g, "_").slice(0, 120) || "backup";
  return `${stem}_${Date.now()}${ext}`;
}

export function mapVersionBackup(r: VersionBackupRow) {
  return {
    id: r.id,
    originalName: r.original_filename,
    storedName: r.stored_filename,
    /** Storage URL/key — never expose absolute filesystem paths to clients. */
    path: r.file_url,
    size: Number(r.file_size) || 0,
    extension: r.file_extension,
    mimeType: r.mime_type,
    uploadedAt: r.created_at,
    updatedAt: r.updated_at,
    uploaderIp: r.uploader_ip,
    uploaderId: r.uploader_id,
    country: r.country || null,
    countryCode: r.country_code || null,
    deviceId: deviceIdFromFilename(r.original_filename),
    downloads: Number(r.download_count) || 0,
    status: (r.status === "disabled" || r.status === "deleted" ? r.status : "active") as VersionBackupStatus,
  };
}

export async function listVersionBackups(opts?: { includeDeleted?: boolean }) {
  const includeDeleted = !!opts?.includeDeleted;
  const rows = await qAll<VersionBackupRow>(
    includeDeleted
      ? `SELECT * FROM version_backups ORDER BY created_at DESC, id DESC`
      : `SELECT * FROM version_backups WHERE status != 'deleted' ORDER BY created_at DESC, id DESC`,
  );
  return rows.map(mapVersionBackup);
}

export async function getVersionBackup(id: number): Promise<VersionBackupRow | undefined> {
  return qGet<VersionBackupRow>("SELECT * FROM version_backups WHERE id = ?", id);
}

export async function createVersionBackupRecord(opts: {
  originalFilename: string;
  storedFilename: string;
  stored: PutObjectResult;
  req: Request;
  uploaderId?: number | null;
}): Promise<{ id: number }> {
  const now = new Date().toISOString();
  const original = sanitizeOriginalFilename(opts.originalFilename);
  const ext = extensionOf(original) || extensionOf(opts.storedFilename) || ".zip";

  let country: string | null = null;
  let countryCode: string | null = null;
  try {
    const geo = await lookupGeo(opts.req);
    country = geo.countryName;
    countryCode = geo.countryCode;
  } catch {
    /* geo is best-effort */
  }

  const result = await qRun(
    `INSERT INTO version_backups (
      original_filename, stored_filename, file_url, file_extension, file_size, mime_type,
      uploader_ip, uploader_id, country, country_code, download_count, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?)`,
    original,
    opts.storedFilename,
    opts.stored.url,
    ext,
    opts.stored.size || 0,
    opts.stored.contentType || null,
    clientIp(opts.req),
    opts.uploaderId ?? null,
    country,
    countryCode,
    now,
    now,
  );
  return { id: Number(result.lastInsertRowid) };
}

export async function setVersionBackupStatus(
  id: number,
  status: VersionBackupStatus,
): Promise<VersionBackupRow | undefined> {
  const now = new Date().toISOString();
  await qRun(
    `UPDATE version_backups SET status = ?, updated_at = ? WHERE id = ? AND status != 'deleted'`,
    status,
    now,
    id,
  );
  return getVersionBackup(id);
}

export async function softDeleteVersionBackup(id: number): Promise<VersionBackupRow | undefined> {
  const row = await getVersionBackup(id);
  if (!row || row.status === "deleted") return undefined;
  const now = new Date().toISOString();
  await qRun(
    `UPDATE version_backups SET status = 'deleted', updated_at = ? WHERE id = ?`,
    now,
    id,
  );
  try {
    await deleteStoredUrl(row.file_url);
  } catch {
    /* storage cleanup best-effort */
  }
  return getVersionBackup(id);
}

export async function incrementVersionBackupDownloads(id: number): Promise<void> {
  const now = new Date().toISOString();
  await qRun(
    `UPDATE version_backups SET download_count = download_count + 1, updated_at = ? WHERE id = ?`,
    now,
    id,
  );
}
