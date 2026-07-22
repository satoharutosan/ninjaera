import type { Request } from "express";
import { qAll, qGet, qRun } from "../db/query.js";
import { getRequestClientMeta } from "./activityLog.js";
import { lookupGeo } from "./geoip.js";
import { normalizeAppId, resolveAppName } from "./appRegistry.js";

export type AppInstallationRow = {
  id: number;
  app_id: string;
  app_name: string | null;
  app_version: string | null;
  build_version: string | null;
  release_channel: string | null;
  installation_id: string;
  user_id: number | null;
  username: string | null;
  user_role: string | null;
  is_anonymous: number;
  ip_address: string | null;
  country: string | null;
  country_code: string | null;
  operating_system: string | null;
  platform: string | null;
  status: string;
  user_agent: string | null;
  created_at: string;
  updated_at: string | null;
};

export type RegisterInstallInput = {
  appId: string;
  appName?: string | null;
  appVersion?: string | null;
  buildVersion?: string | null;
  releaseChannel?: string | null;
  installationId: string;
  platform?: string | null;
  operatingSystem?: string | null;
};

function clip(s: unknown, max: number): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!t) return null;
  return t.slice(0, max);
}

function normalizeInstallationId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  if (!id || id.length < 8 || id.length > 128) return null;
  if (!/^[A-Za-z0-9._:-]+$/.test(id)) return null;
  return id;
}

function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  return t || null;
}

async function resolveUserRole(userId: number | null | undefined): Promise<string> {
  if (!userId) return "guest";
  const user = await qGet<{ is_admin: number; is_team_member: number }>(
    "SELECT is_admin, is_team_member FROM users WHERE id = ?",
    userId,
  );
  if (!user) return "guest";
  if (user.is_admin === 1) return "administrator";
  if (user.is_team_member === 1) return "team_member";
  return "registered_user";
}

export function mapInstallation(r: AppInstallationRow) {
  return {
    id: r.id,
    appId: r.app_id,
    appName: r.app_name,
    appVersion: r.app_version,
    buildVersion: r.build_version,
    releaseChannel: r.release_channel,
    installationId: r.installation_id,
    userId: r.user_id,
    username: r.username,
    userRole: r.user_role,
    isAnonymous: r.is_anonymous === 1,
    ipAddress: r.ip_address,
    country: r.country,
    countryCode: r.country_code,
    operatingSystem: r.operating_system,
    platform: r.platform,
    status: r.status,
    userAgent: r.user_agent,
    createdAt: r.created_at,
    updatedAt: r.updated_at || r.created_at,
  };
}

/**
 * Register / refresh a desktop app installation.
 * Deduped by (app_id, ip_address) when IP is known; otherwise by (app_id, installation_id).
 * Existing rows are UPDATED (timestamp, version, user) — never duplicated for the same IP.
 */
export async function registerAppInstallation(
  req: Request,
  input: RegisterInstallInput,
): Promise<{ ok: true; duplicate: boolean; id?: number }> {
  const appId = normalizeAppId(input.appId);
  const installationId = normalizeInstallationId(input.installationId);
  if (!appId || !installationId) {
    throw Object.assign(new Error("Invalid appId or installationId"), { status: 400 });
  }

  const meta = getRequestClientMeta(req);
  const ip = normalizeIp(meta.ip);

  let country: string | null = null;
  let countryCode: string | null = null;
  try {
    const geo = await lookupGeo(req);
    country = geo.countryName;
    countryCode = geo.countryCode;
  } catch {
    /* ignore geo failures */
  }

  const userId = req.user?.id ?? null;
  const username = req.user?.username?.trim() || (userId ? null : "Guest");
  const userRole = await resolveUserRole(userId);
  const isAnonymous = userId ? 0 : 1;
  const appName = resolveAppName(appId, input.appName);
  const appVersion = clip(input.appVersion, 64);
  const buildVersion = clip(input.buildVersion, 64);
  const releaseChannel = clip(input.releaseChannel, 32);
  const platform = clip(input.platform, 64) || meta.platform || null;
  const operatingSystem = clip(input.operatingSystem, 64) || meta.os || null;
  const now = new Date().toISOString();

  // Prefer IP-based match (one row per app + IP).
  let existing: { id: number } | undefined;
  if (ip) {
    existing = await qGet<{ id: number }>(
      "SELECT id FROM app_installations WHERE app_id = ? AND ip_address = ?",
      appId,
      ip,
    );
  } else {
    existing = await qGet<{ id: number }>(
      "SELECT id FROM app_installations WHERE app_id = ? AND installation_id = ?",
      appId,
      installationId,
    );
  }

  if (existing) {
    await qRun(
      `UPDATE app_installations SET
        installation_id = ?,
        app_name = COALESCE(?, app_name),
        app_version = COALESCE(?, app_version),
        build_version = COALESCE(?, build_version),
        release_channel = COALESCE(?, release_channel),
        user_id = ?,
        username = ?,
        user_role = ?,
        is_anonymous = ?,
        country = COALESCE(?, country),
        country_code = COALESCE(?, country_code),
        operating_system = COALESCE(?, operating_system),
        platform = COALESCE(?, platform),
        user_agent = COALESCE(?, user_agent),
        status = 'active',
        updated_at = ?
      WHERE id = ?`,
      installationId,
      appName,
      appVersion,
      buildVersion,
      releaseChannel,
      userId,
      username,
      userRole,
      isAnonymous,
      country,
      countryCode,
      operatingSystem,
      platform,
      meta.userAgent,
      now,
      existing.id,
    );
    return { ok: true, duplicate: true, id: existing.id };
  }

  try {
    const result = await qRun(
      `INSERT INTO app_installations (
        app_id, app_name, app_version, build_version, release_channel, installation_id,
        user_id, username, user_role, is_anonymous,
        ip_address, country, country_code, operating_system, platform, status, user_agent,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      appId,
      appName,
      appVersion,
      buildVersion,
      releaseChannel,
      installationId,
      userId,
      username,
      userRole,
      isAnonymous,
      ip,
      country,
      countryCode,
      operatingSystem,
      platform,
      meta.userAgent,
      now,
      now,
    );
    return { ok: true, duplicate: false, id: Number(result.lastInsertRowid) || undefined };
  } catch (err) {
    // Race on unique (app_id, ip) — retry as update
    if (ip) {
      const again = await qGet<{ id: number }>(
        "SELECT id FROM app_installations WHERE app_id = ? AND ip_address = ?",
        appId,
        ip,
      );
      if (again) {
        await qRun(
          `UPDATE app_installations SET
            installation_id = ?, app_version = COALESCE(?, app_version),
            user_id = ?, username = ?, user_role = ?, is_anonymous = ?,
            updated_at = ?
          WHERE id = ?`,
          installationId,
          appVersion,
          userId,
          username,
          userRole,
          isAnonymous,
          now,
          again.id,
        );
        return { ok: true, duplicate: true, id: again.id };
      }
    }
    throw err;
  }
}

export async function listDistinctAppIds(): Promise<string[]> {
  const rows = await qAll<{ app_id: string }>(
    "SELECT DISTINCT app_id FROM app_installations ORDER BY app_id ASC",
  );
  return rows.map((r) => r.app_id);
}
