import type { Request } from "express";
import { qGet, qRun } from "../db/query.js";
import { lookupGeo, saveUserLocation, type GeoResult } from "./geoip.js";
import { emitToAdmins, scheduleAdminStatsRefresh } from "./realtime.js";

export type ActivityInput = {
  req?: Request;
  userId?: number | null;
  username?: string | null;
  displayName?: string | null;
  userRole?: string;
  eventType: string;
  eventCategory: string;
  description: string;
  affectedObject?: string | null;
  result?: "success" | "failure";
  metadata?: Record<string, unknown>;
  /** When provided, skips a second IP geo lookup (e.g. registration already looked up). */
  geo?: GeoResult;
};

export type ParsedPlatform = {
  browser: string;
  os: string;
  deviceType: "Desktop" | "Mobile" | "Tablet";
  /** e.g. "Windows 10 (Chrome 149)" */
  platform: string;
};

function headerStr(req: Request | undefined, name: string): string {
  const v = req?.headers[name];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v[0]) return v[0];
  return "";
}

/** Prefer Chromium Client Hints brands when present. */
function browserFromHints(req?: Request): string | null {
  const raw = headerStr(req, "sec-ch-ua");
  if (!raw) return null;
  // `"Chromium";v="149", "Google Chrome";v="149", "Not.A/Brand";v="99"`
  const brands = [...raw.matchAll(/"([^"]+)";v="(\d+)"/g)].map((m) => ({ name: m[1]!, ver: m[2]! }));
  const prefer = brands.find((b) => /chrome|edge|opera|brave|samsung/i.test(b.name) && !/chromium|not.?a.?brand/i.test(b.name))
    || brands.find((b) => /chromium/i.test(b.name));
  if (!prefer) return null;
  let name = prefer.name;
  if (/google chrome/i.test(name)) name = "Chrome";
  else if (/microsoft edge/i.test(name)) name = "Edge";
  else if (/opera/i.test(name)) name = "Opera";
  return `${name} ${prefer.ver}`;
}

function osFromHints(req?: Request): string | null {
  const platform = headerStr(req, "sec-ch-ua-platform").replace(/"/g, "");
  const verRaw = headerStr(req, "sec-ch-ua-platform-version").replace(/"/g, "");
  if (!platform) return null;
  const major = verRaw.match(/^(\d+)/)?.[1];
  if (/windows/i.test(platform)) {
    // Windows Client Hints: 15.0.0 ≈ Win11, 10.0.0 ≈ Win10 (approx)
    if (major === "15" || (verRaw && parseFloat(verRaw) >= 13)) return "Windows 11";
    if (major === "10" || verRaw) return "Windows 10";
    return "Windows";
  }
  if (/mac|macos/i.test(platform)) return major ? `macOS ${major}` : "macOS";
  if (/android/i.test(platform)) return major ? `Android ${major}` : "Android";
  if (/ios|iphone|ipad/i.test(platform)) return major ? `iOS ${major}` : "iOS";
  if (/linux/i.test(platform)) return "Linux";
  if (/chrome.?os/i.test(platform)) return "ChromeOS";
  return platform;
}

function deviceFromHints(req?: Request, uaLower = ""): ParsedPlatform["deviceType"] | null {
  const mobile = headerStr(req, "sec-ch-ua-mobile");
  if (mobile === "?1") {
    if (uaLower.includes("ipad") || uaLower.includes("tablet")) return "Tablet";
    return "Mobile";
  }
  if (mobile === "?0") {
    if (uaLower.includes("ipad") || uaLower.includes("tablet")) return "Tablet";
    return "Desktop";
  }
  return null;
}

function matchVersion(ua: string, re: RegExp): string | null {
  const m = ua.match(re);
  return m?.[1] || null;
}

function parseUserAgent(ua: string, req?: Request): ParsedPlatform {
  const lower = ua.toLowerCase();

  // —— Browser ——
  let browser = browserFromHints(req) || "Other";
  if (browser === "Other" && ua) {
    if (/edg(?:e|a|ios)?\/(\d+)/i.test(ua)) {
      browser = `Edge ${matchVersion(ua, /edg(?:e|a|ios)?\/(\d+)/i) || ""}`.trim();
    } else if (/opr\/(\d+)/i.test(ua) || /opera/i.test(lower)) {
      browser = `Opera ${matchVersion(ua, /(?:opr|opera)\/(\d+)/i) || ""}`.trim();
    } else if (/firefox\/(\d+)/i.test(ua)) {
      browser = `Firefox ${matchVersion(ua, /firefox\/(\d+)/i) || ""}`.trim();
    } else if (/chrome\/(\d+)/i.test(ua) && !/edg/i.test(ua)) {
      browser = `Chrome ${matchVersion(ua, /chrome\/(\d+)/i) || ""}`.trim();
    } else if (/version\/(\d+).*safari/i.test(ua) || (/safari/i.test(lower) && !/chrome/i.test(lower))) {
      browser = `Safari ${matchVersion(ua, /version\/(\d+)/i) || ""}`.trim();
    } else if (/samsungbrowser\/(\d+)/i.test(ua)) {
      browser = `Samsung Internet ${matchVersion(ua, /samsungbrowser\/(\d+)/i) || ""}`.trim();
    }
  }

  // —— OS ——
  let os = osFromHints(req) || "Other";
  if (os === "Other" && ua) {
    if (/windows nt 10\.0/i.test(ua)) {
      // Win11 often still reports NT 10.0; "Windows 11" in UA is rare — prefer "Windows 10"
      os = /windows nt 10\.0.*rv:11|windows 11/i.test(ua) ? "Windows 11" : "Windows 10";
    } else if (/windows nt 6\.3/i.test(ua)) os = "Windows 8.1";
    else if (/windows nt 6\.2/i.test(ua)) os = "Windows 8";
    else if (/windows nt 6\.1/i.test(ua)) os = "Windows 7";
    else if (/windows/i.test(lower)) os = "Windows";
    else if (/android\s+([\d.]+)/i.test(ua)) {
      const v = matchVersion(ua, /android\s+([\d.]+)/i);
      os = v ? `Android ${v.split(".")[0]}` : "Android";
    } else if (/iphone|ipad|ipod|cpu (?:iphone )?os/i.test(lower)) {
      const v = matchVersion(ua, /(?:cpu (?:iphone )?os |os )(\d+)[._]/i);
      os = v ? `iOS ${v}` : "iOS";
    } else if (/mac os x (\d+)[._](\d+)/i.test(ua) || /macintosh/i.test(lower)) {
      const maj = matchVersion(ua, /mac os x (\d+)[._]/i);
      // Darwin reports 10_15 etc.; newer macOS may report 14_0 / 15_0
      if (maj && Number(maj) >= 11) os = `macOS ${maj}`;
      else if (maj) os = `macOS ${maj}`;
      else os = "macOS";
    } else if (/cros/i.test(lower)) os = "ChromeOS";
    else if (/linux/i.test(lower)) os = "Linux";
  }

  // —— Device ——
  let deviceType = deviceFromHints(req, lower) || ("Desktop" as ParsedPlatform["deviceType"]);
  if (!deviceFromHints(req, lower)) {
    if (/ipad|tablet|kindle|silk/i.test(lower)) deviceType = "Tablet";
    else if (/mobile|iphone|ipod|android(?!.*tablet)/i.test(lower)) deviceType = "Mobile";
    else deviceType = "Desktop";
  }

  const platform = browser && browser !== "Other"
    ? `${os} (${browser})`
    : os;

  return { browser, os, deviceType, platform };
}

/** Format stored browser/os for Admin UI (handles legacy rows without versions). */
export function formatPlatformLabel(os?: string | null, browser?: string | null): string {
  const o = (os || "").trim() || "Unknown OS";
  const b = (browser || "").trim();
  if (!b || b === "Other") return o;
  return `${o} (${b})`;
}

function clientIp(req: Request): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || null;
}

/** Shared client metadata for access logging (link files, downloads, etc.). */
export function getRequestClientMeta(req: Request) {
  const userAgent = (req.headers["user-agent"] as string) || "";
  const { browser, os, deviceType, platform } = parseUserAgent(userAgent, req);
  const referrerHeader = req.headers.referer || req.headers.referrer;
  const referrer = typeof referrerHeader === "string"
    ? referrerHeader
    : Array.isArray(referrerHeader)
      ? referrerHeader[0] || null
      : null;
  return {
    ip: clientIp(req),
    userAgent: userAgent || null,
    browser,
    os,
    deviceType,
    platform,
    referrer,
  };
}

async function resolveUserRole(userId: number | null | undefined): Promise<string> {
  if (!userId) return "guest";
  const user = await qGet<{ is_admin: number; is_team_member: number }>("SELECT is_admin, is_team_member FROM users WHERE id = ?", userId);
  if (!user) return "guest";
  if (user.is_admin === 1) return "administrator";
  if (user.is_team_member === 1) return "team_member";
  return "registered_user";
}

export async function logActivity(input: ActivityInput) {
  const ts = new Date().toISOString();
  const req = input.req;
  const ua = (req?.headers["user-agent"] as string) || "";
  const { browser, os, deviceType } = parseUserAgent(ua, req);
  const ip = req ? clientIp(req) : null;
  const userId = input.userId ?? req?.user?.id ?? null;
  const username = input.username ?? req?.user?.username ?? (userId ? null : "Guest");
  const displayName = input.displayName ?? username;
  const userRole = input.userRole ?? (await resolveUserRole(userId));
  const sessionId = req?.cookies?.token || (req?.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7, 27) : null);

  let country: string | null = null;
  let countryCode: string | null = null;
  let isVpn: number | null = null;

  if (input.geo) {
    country = input.geo.countryName;
    countryCode = input.geo.countryCode;
    isVpn = input.geo.isVpn ? 1 : 0;
  } else if (req) {
    try {
      const geo = await lookupGeo(req);
      country = geo.countryName;
      countryCode = geo.countryCode;
      isVpn = geo.isVpn ? 1 : 0;
      if (userId) await saveUserLocation(userId, geo);
    } catch { /* ignore */ }
  } else if (userId) {
    const loc = await qGet<{ country_name: string; country_code: string; is_vpn: number }>("SELECT country_name, country_code, is_vpn FROM user_locations WHERE user_id = ?", userId);
    if (loc) {
      country = loc.country_name;
      countryCode = loc.country_code;
      isVpn = loc.is_vpn;
    }
  }

  const result = await qRun(`
    INSERT INTO activity_logs (
      timestamp, user_id, username, display_name, user_role, event_type, event_category,
      description, affected_object, request_path, http_method, user_agent, browser, os, device_type,
      session_id, ip_address, country, country_code, is_vpn, result, metadata, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    ts,
    userId,
    username,
    displayName,
    userRole,
    input.eventType,
    input.eventCategory,
    input.description,
    input.affectedObject ?? null,
    req?.path ?? null,
    req?.method ?? null,
    ua || null,
    browser,
    os,
    deviceType,
    sessionId,
    ip,
    country,
    countryCode,
    isVpn,
    input.result ?? "success",
    JSON.stringify(input.metadata ?? {}),
    ts,
  );

  emitToAdmins("admin:activity", { logId: result.lastInsertRowid });
  // Coalesce expensive /admin/stats fan-out instead of emitting on every log insert.
  scheduleAdminStatsRefresh(1000);
}

export function logActivitySync(input: ActivityInput) {
  void logActivity(input);
}
