import { qAll, qGet, qRun } from "../db/query.js";
import { compareSemver, isValidSemver } from "./semver.js";
import { normalizeAppId, resolveAppName } from "./appRegistry.js";

export const DESKTOP_CHANNELS = ["stable", "beta", "development"] as const;
export type DesktopChannel = (typeof DESKTOP_CHANNELS)[number];

export type DesktopReleaseRow = {
  id: number;
  app_id: string;
  version: string;
  channel: string;
  release_notes: string | null;
  min_supported_version: string | null;
  github_release_url: string | null;
  /** Legacy upload fields — unused for new GitHub-hosted releases. */
  package_filename: string | null;
  package_url: string | null;
  package_size: number;
  sha1: string | null;
  sha256: string | null;
  published: number;
  published_at: string | null;
  created_at: string;
  created_by: number | null;
};

export function normalizeChannel(raw: unknown): DesktopChannel | null {
  if (typeof raw !== "string") return null;
  const c = raw.trim().toLowerCase();
  if ((DESKTOP_CHANNELS as readonly string[]).includes(c)) return c as DesktopChannel;
  return null;
}

/**
 * Validate a GitHub Releases asset download URL.
 * Does not download the file.
 */
export function validateGithubReleaseUrl(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw Object.assign(new Error("GitHub Release URL is required"), { status: 400 });
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw Object.assign(new Error("GitHub Release URL is not a valid URL"), { status: 400 });
  }
  if (url.protocol !== "https:") {
    throw Object.assign(new Error("GitHub Release URL must use HTTPS"), { status: 400 });
  }
  const host = url.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com" && host !== "objects.githubusercontent.com") {
    throw Object.assign(new Error("URL must point to GitHub (github.com)"), { status: 400 });
  }
  // Prefer /releases/download/… asset links; also allow githubusercontent object links.
  const path = url.pathname;
  const isReleaseAsset = /\/releases\/download\//i.test(path);
  const isGhObject = host === "objects.githubusercontent.com";
  if (!isReleaseAsset && !isGhObject) {
    throw Object.assign(
      new Error("URL must be a GitHub Releases download asset (/releases/download/...)"),
      { status: 400 },
    );
  }
  return url.toString();
}

export function normalizeChecksum(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase().replace(/^sha-?256:/i, "");
  if (!t) return null;
  if (!/^[a-f0-9]{64}$/.test(t)) {
    throw Object.assign(new Error("Checksum must be a 64-character SHA-256 hex digest"), { status: 400 });
  }
  return t;
}

export function mapDesktopRelease(r: DesktopReleaseRow) {
  return {
    id: r.id,
    appId: r.app_id,
    appName: resolveAppName(r.app_id),
    version: r.version,
    channel: r.channel,
    releaseNotes: r.release_notes,
    minSupportedVersion: r.min_supported_version,
    githubReleaseUrl: r.github_release_url,
    checksum: r.sha256 && String(r.sha256).trim() ? String(r.sha256).trim() : null,
    published: r.published === 1,
    publishedAt: r.published_at,
    createdAt: r.created_at,
    createdBy: r.created_by,
  };
}

/** Public client payload — metadata only (never package bytes). */
export function mapLatestRelease(r: DesktopReleaseRow) {
  return {
    appId: r.app_id,
    appName: resolveAppName(r.app_id),
    version: r.version,
    channel: r.channel,
    releaseNotes: r.release_notes,
    minSupportedVersion: r.min_supported_version,
    githubReleaseUrl: r.github_release_url,
    checksum: r.sha256 && String(r.sha256).trim() ? String(r.sha256).trim() : null,
    publishedAt: r.published_at,
  };
}

export async function getPublishedRelease(
  appId: string,
  channel: string,
): Promise<DesktopReleaseRow | undefined> {
  return qGet<DesktopReleaseRow>(
    `SELECT * FROM desktop_releases
     WHERE app_id = ? AND channel = ? AND published = 1
       AND github_release_url IS NOT NULL AND TRIM(github_release_url) != ''
     ORDER BY published_at DESC, id DESC
     LIMIT 1`,
    appId,
    channel,
  );
}

export async function listDesktopReleases(opts: {
  appId?: string;
  channel?: string;
  page?: number;
  limit?: number;
}): Promise<{ rows: DesktopReleaseRow[]; total: number }> {
  const page = Math.max(1, opts.page || 1);
  const limit = Math.min(100, Math.max(1, opts.limit || 50));
  const offset = (page - 1) * limit;
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.appId) {
    where.push("app_id = ?");
    params.push(opts.appId);
  }
  if (opts.channel) {
    where.push("channel = ?");
    params.push(opts.channel);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const totalRow = await qGet<{ c: number }>(
    `SELECT COUNT(*) as c FROM desktop_releases ${whereSql}`,
    ...params,
  );
  const rows = await qAll<DesktopReleaseRow>(
    `SELECT * FROM desktop_releases ${whereSql}
     ORDER BY created_at DESC, id DESC
     LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset,
  );
  return { rows, total: Number(totalRow?.c) || 0 };
}

export async function publishRelease(id: number): Promise<DesktopReleaseRow> {
  const row = await qGet<DesktopReleaseRow>("SELECT * FROM desktop_releases WHERE id = ?", id);
  if (!row) throw Object.assign(new Error("Release not found"), { status: 404 });
  if (!row.github_release_url) {
    throw Object.assign(new Error("Release is missing a GitHub Release URL"), { status: 400 });
  }

  const current = await getPublishedRelease(row.app_id, row.channel);
  if (current && current.id !== row.id) {
    const cmp = compareSemver(row.version, current.version);
    if (cmp !== null && cmp < 0) {
      throw Object.assign(
        new Error(`Cannot publish ${row.version}: older than current ${current.version}`),
        { status: 400 },
      );
    }
  }

  const ts = new Date().toISOString();
  await qRun(
    `UPDATE desktop_releases SET published = 0 WHERE app_id = ? AND channel = ? AND id != ?`,
    row.app_id,
    row.channel,
    id,
  );
  await qRun(
    `UPDATE desktop_releases SET published = 1, published_at = COALESCE(published_at, ?) WHERE id = ?`,
    ts,
    id,
  );
  const updated = await qGet<DesktopReleaseRow>("SELECT * FROM desktop_releases WHERE id = ?", id);
  if (!updated) throw Object.assign(new Error("Release not found after publish"), { status: 404 });
  return updated;
}

export async function unpublishRelease(id: number): Promise<void> {
  await qRun(`UPDATE desktop_releases SET published = 0 WHERE id = ?`, id);
}

export async function deleteRelease(id: number): Promise<DesktopReleaseRow | null> {
  const row = await qGet<DesktopReleaseRow>("SELECT * FROM desktop_releases WHERE id = ?", id);
  if (!row) return null;
  await qRun("DELETE FROM desktop_releases WHERE id = ?", id);
  return row;
}

export function validateReleaseMeta(input: {
  appId: unknown;
  version: unknown;
  channel: unknown;
}): { appId: string; version: string; channel: DesktopChannel } {
  const appId = normalizeAppId(input.appId);
  if (!appId) throw Object.assign(new Error("Invalid appId"), { status: 400 });
  const version = String(input.version || "").trim().replace(/^v/i, "");
  if (!isValidSemver(version)) {
    throw Object.assign(new Error("Invalid version (expected major.minor.patch)"), { status: 400 });
  }
  const channel = normalizeChannel(input.channel) || "stable";
  return { appId, version, channel };
}

export function parsePublishDate(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const d = new Date(raw.trim());
  if (Number.isNaN(d.getTime())) {
    throw Object.assign(new Error("Invalid publish date"), { status: 400 });
  }
  return d.toISOString();
}
