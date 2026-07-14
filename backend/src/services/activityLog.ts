import type { Request } from "express";
import { db } from "../db/index.js";
import { lookupGeo, saveUserLocation } from "./geoip.js";
import { emitToAdmins } from "./realtime.js";

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
};

function parseUserAgent(ua: string) {
  const lower = ua.toLowerCase();
  let browser = "Other";
  if (lower.includes("edg/")) browser = "Edge";
  else if (lower.includes("chrome") && !lower.includes("edg")) browser = "Chrome";
  else if (lower.includes("firefox")) browser = "Firefox";
  else if (lower.includes("safari") && !lower.includes("chrome")) browser = "Safari";

  let os = "Other";
  if (lower.includes("windows")) os = "Windows";
  else if (lower.includes("mac os") || lower.includes("macintosh")) os = "macOS";
  else if (lower.includes("android")) os = "Android";
  else if (lower.includes("iphone") || lower.includes("ipad") || lower.includes("ios")) os = "iOS";
  else if (lower.includes("linux")) os = "Linux";

  let deviceType = "desktop";
  if (lower.includes("mobile") || lower.includes("android") || lower.includes("iphone")) deviceType = "mobile";
  else if (lower.includes("ipad") || lower.includes("tablet")) deviceType = "tablet";

  return { browser, os, deviceType };
}

function clientIp(req: Request): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || null;
}

function resolveUserRole(userId: number | null | undefined): string {
  if (!userId) return "guest";
  const user = db.prepare("SELECT is_admin, is_team_member FROM users WHERE id = ?").get(userId) as { is_admin: number; is_team_member: number } | undefined;
  if (!user) return "guest";
  if (user.is_admin === 1) return "administrator";
  if (user.is_team_member === 1) return "team_member";
  return "registered_user";
}

export async function logActivity(input: ActivityInput) {
  const ts = new Date().toISOString();
  const req = input.req;
  const ua = (req?.headers["user-agent"] as string) || "";
  const { browser, os, deviceType } = parseUserAgent(ua);
  const ip = req ? clientIp(req) : null;
  const userId = input.userId ?? req?.user?.id ?? null;
  const username = input.username ?? req?.user?.username ?? (userId ? null : "Guest");
  const displayName = input.displayName ?? username;
  const userRole = input.userRole ?? resolveUserRole(userId);
  const sessionId = req?.cookies?.token || (req?.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7, 27) : null);

  let country: string | null = null;
  let countryCode: string | null = null;
  let isVpn: number | null = null;

  if (req && userId) {
    try {
      const geo = await lookupGeo(req);
      country = geo.countryName;
      countryCode = geo.countryCode;
      isVpn = geo.isVpn ? 1 : 0;
      saveUserLocation(userId, geo);
    } catch { /* ignore */ }
  } else if (userId) {
    const loc = db.prepare("SELECT country_name, country_code, is_vpn FROM user_locations WHERE user_id = ?").get(userId) as { country_name: string; country_code: string; is_vpn: number } | undefined;
    if (loc) {
      country = loc.country_name;
      countryCode = loc.country_code;
      isVpn = loc.is_vpn;
    }
  }

  const result = db.prepare(`
    INSERT INTO activity_logs (
      timestamp, user_id, username, display_name, user_role, event_type, event_category,
      description, affected_object, request_path, http_method, user_agent, browser, os, device_type,
      session_id, ip_address, country, country_code, is_vpn, result, metadata, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
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
  emitToAdmins("admin:stats", {});
}

export function logActivitySync(input: ActivityInput) {
  void logActivity(input);
}
