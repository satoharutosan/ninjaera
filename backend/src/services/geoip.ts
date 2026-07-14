import type { Request } from "express";

export type GeoResult = {
  ip: string;
  countryCode: string | null;
  countryName: string | null;
  isVpn: boolean;
  vpnIp: string | null;
  vpnCountryCode: string | null;
  vpnCountryName: string | null;
  originIp: string | null;
  originCountryCode: string | null;
  originCountryName: string | null;
};

function clientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "127.0.0.1";
}

function isPrivateIp(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1" || ip.startsWith("192.168.") || ip.startsWith("10.");
}

export async function lookupGeo(req: Request): Promise<GeoResult> {
  const ip = clientIp(req);
  const empty: GeoResult = {
    ip,
    countryCode: null,
    countryName: null,
    isVpn: false,
    vpnIp: null,
    vpnCountryCode: null,
    vpnCountryName: null,
    originIp: null,
    originCountryCode: null,
    originCountryName: null,
  };

  if (isPrivateIp(ip)) {
    return { ...empty, countryCode: "JP", countryName: "Japan" };
  }

  try {
    const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
      headers: { "User-Agent": "NinjaEra/1.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return empty;
    const data = await res.json() as {
      ip?: string;
      country_code?: string;
      country_name?: string;
      security?: { vpn?: boolean; proxy?: boolean; tor?: boolean };
    };

    const isVpn = !!(data.security?.vpn || data.security?.proxy || data.security?.tor);
    const countryCode = data.country_code || null;
    const countryName = data.country_name || null;

    if (isVpn) {
      return {
        ip,
        countryCode,
        countryName,
        isVpn: true,
        vpnIp: data.ip || ip,
        vpnCountryCode: countryCode,
        vpnCountryName: countryName,
        originIp: null,
        originCountryCode: null,
        originCountryName: null,
      };
    }

    return {
      ip: data.ip || ip,
      countryCode,
      countryName,
      isVpn: false,
      vpnIp: null,
      vpnCountryCode: null,
      vpnCountryName: null,
      originIp: data.ip || ip,
      originCountryCode: countryCode,
      originCountryName: countryName,
    };
  } catch {
    return empty;
  }
}

import { db } from "../db/index.js";

export function saveUserLocation(userId: number, geo: GeoResult) {
  const ts = new Date().toISOString();
  db.prepare(`
    INSERT INTO user_locations (user_id, ip_address, country_code, country_name, is_vpn, vpn_ip, vpn_country_code, vpn_country_name, origin_ip, origin_country_code, origin_country_name, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      ip_address = excluded.ip_address,
      country_code = excluded.country_code,
      country_name = excluded.country_name,
      is_vpn = excluded.is_vpn,
      vpn_ip = excluded.vpn_ip,
      vpn_country_code = excluded.vpn_country_code,
      vpn_country_name = excluded.vpn_country_name,
      origin_ip = excluded.origin_ip,
      origin_country_code = excluded.origin_country_code,
      origin_country_name = excluded.origin_country_name,
      updated_at = excluded.updated_at
  `).run(
    userId,
    geo.ip,
    geo.countryCode,
    geo.countryName,
    geo.isVpn ? 1 : 0,
    geo.vpnIp,
    geo.vpnCountryCode,
    geo.vpnCountryName,
    geo.originIp,
    geo.originCountryCode,
    geo.originCountryName,
    ts,
  );
}
