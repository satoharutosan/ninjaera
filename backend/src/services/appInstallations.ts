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
  };
}

/**
 * Register a desktop app installation once.
 * Duplicate (app_id, installation_id) → { ok: true, duplicate: true } (no new row).
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

  const existing = await qGet<{ id: number }>(
    "SELECT id FROM app_installations WHERE app_id = ? AND installation_id = ?",
    appId,
    installationId,
  );
  if (existing) {
    return { ok: true, duplicate: true, id: existing.id };
  }

  const meta = getRequestClientMeta(req);
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
  const createdAt = new Date().toISOString();

  try {
    const result = await qRun(
      `INSERT INTO app_installations (
        app_id, app_name, app_version, build_version, release_channel, installation_id,
        user_id, username, user_role, is_anonymous,
        ip_address, country, country_code, operating_system, platform, status, user_agent, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
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
      meta.ip,
      country,
      countryCode,
      operatingSystem,
      platform,
      meta.userAgent,
      createdAt,
    );
    return { ok: true, duplicate: false, id: Number(result.lastInsertRowid) || undefined };
  } catch (err) {
    // Race: unique constraint — treat as duplicate
    const again = await qGet<{ id: number }>(
      "SELECT id FROM app_installations WHERE app_id = ? AND installation_id = ?",
      appId,
      installationId,
    );
    if (again) return { ok: true, duplicate: true, id: again.id };
    throw err;
  }
}

export async function listDistinctAppIds(): Promise<string[]> {
  const rows = await qAll<{ app_id: string }>(
    "SELECT DISTINCT app_id FROM app_installations ORDER BY app_id ASC",
  );
  return rows.map((r) => r.app_id);
}
