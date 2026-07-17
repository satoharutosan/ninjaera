import fs from "fs";
import path from "path";
import type { Request } from "express";
import { qGet, qRun } from "../db/query.js";
import { getStorage } from "../storage/index.js";
import { getRequestClientMeta } from "./activityLog.js";

export const LINK_FILE_ALIAS_RE = /^[a-zA-Z0-9_-]+$/;

export type LinkFileRow = {
  id: number;
  alias: string;
  alias_display: string;
  original_filename: string;
  file_url: string;
  mime_type: string;
  file_size: number;
  active: number;
  access_count: number;
  last_accessed_at: string | null;
  last_visitor_user_id: number | null;
  last_visitor_label: string | null;
  uploader_id: number | null;
  created_at: string;
  updated_at: string;
};

export function normalizeAlias(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateAlias(raw: string): { ok: true; alias: string; display: string } | { ok: false; error: string } {
  const display = raw.trim();
  if (!display) return { ok: false, error: "Public path (alias) is required" };
  if (display.length > 128) return { ok: false, error: "Public path must be 128 characters or fewer" };
  if (/\s/.test(display)) return { ok: false, error: "Public path cannot contain spaces" };
  if (!LINK_FILE_ALIAS_RE.test(display)) {
    return { ok: false, error: "Public path may only contain letters, numbers, hyphens, and underscores" };
  }
  return { ok: true, alias: normalizeAlias(display), display };
}

export async function findLinkFileByAlias(aliasRaw: string): Promise<LinkFileRow | null> {
  const alias = normalizeAlias(aliasRaw);
  if (!alias || !LINK_FILE_ALIAS_RE.test(alias)) return null;
  return (await qGet<LinkFileRow>("SELECT * FROM link_files WHERE alias = ?", alias)) ?? null;
}

export async function aliasTaken(alias: string, excludeId?: number): Promise<boolean> {
  if (excludeId != null) {
    const row = await qGet<{ id: number }>("SELECT id FROM link_files WHERE alias = ? AND id != ?", alias, excludeId);
    return !!row;
  }
  const row = await qGet<{ id: number }>("SELECT id FROM link_files WHERE alias = ?", alias);
  return !!row;
}

/** Resolve a stored file_url to a local absolute path inside the storage root, or null. */
export function resolveLocalFilePath(fileUrl: string): string | null {
  const storage = getStorage();
  if (storage.provider !== "local" || !storage.localRoot) return null;
  const key = fileUrl.replace(/^\/uploads\//, "").replace(/^[/\\]+/, "").replace(/\.\./g, "");
  if (!key) return null;
  const filePath = path.resolve(storage.localRoot, key);
  const relative = path.relative(storage.localRoot, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  if (!fs.existsSync(filePath)) return null;
  return filePath;
}

export async function recordLinkFileAccess(opts: {
  req: Request;
  file: LinkFileRow;
}) {
  const { req, file } = opts;
  const meta = getRequestClientMeta(req);
  const userId = req.user?.id ?? null;
  const visitorLabel = req.user?.username?.trim() || "Guest";
  const ts = new Date().toISOString();

  await qRun(`
    INSERT INTO link_file_access_logs (
      link_file_id, alias, original_filename, user_id, visitor_label,
      ip_address, user_agent, browser, platform, referrer, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    file.id,
    file.alias_display || file.alias,
    file.original_filename,
    userId,
    visitorLabel,
    meta.ip,
    meta.userAgent,
    meta.browser,
    meta.platform,
    meta.referrer,
    ts,
  );

  await qRun(`
    UPDATE link_files SET
      access_count = access_count + 1,
      last_accessed_at = ?,
      last_visitor_user_id = ?,
      last_visitor_label = ?,
      updated_at = ?
    WHERE id = ?
  `, ts, userId, visitorLabel, ts, file.id);
}

export function contentDispositionInline(filename: string): string {
  const safe = filename.replace(/["\r\n\\]/g, "_") || "file";
  const encoded = encodeURIComponent(safe);
  return `inline; filename="${safe}"; filename*=UTF-8''${encoded}`;
}
