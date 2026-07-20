/**
 * ICE server configuration for WebRTC (STUN + optional TURN).
 * Production behind NATs requires TURN — configure via Railway env vars.
 */

export type IceServerConfig = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

const DEFAULT_STUN: IceServerConfig[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

function splitUrls(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Build ICE servers from environment.
 *
 * TURN_URLS=turn:host:3478,turns:host:5349
 * TURN_USERNAME=...
 * TURN_CREDENTIAL=...
 * STUN_URLS=stun:... (optional; defaults to Google STUN)
 * ICE_SERVERS_JSON=[{"urls":"turn:...","username":"...","credential":"..."}] (optional full override)
 */
export function buildIceServers(): IceServerConfig[] {
  const jsonRaw = (process.env.ICE_SERVERS_JSON || "").trim();
  if (jsonRaw) {
    try {
      const parsed = JSON.parse(jsonRaw) as IceServerConfig[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch (err) {
      console.error("[webrtc] ICE_SERVERS_JSON parse failed:", err instanceof Error ? err.message : err);
    }
  }

  const stunUrls = splitUrls(process.env.STUN_URLS);
  const turnUrls = splitUrls(process.env.TURN_URLS);
  const username = (process.env.TURN_USERNAME || "").trim() || undefined;
  const credential = (process.env.TURN_CREDENTIAL || "").trim() || undefined;

  const servers: IceServerConfig[] = [];

  for (const url of stunUrls.length ? stunUrls : DEFAULT_STUN.map((s) => (typeof s.urls === "string" ? s.urls : s.urls[0]))) {
    servers.push({ urls: url });
  }

  if (turnUrls.length) {
    if (!username || !credential) {
      console.warn("[webrtc] TURN_URLS set but TURN_USERNAME / TURN_CREDENTIAL missing — TURN will be skipped");
    } else {
      servers.push({
        urls: turnUrls.length === 1 ? turnUrls[0]! : turnUrls,
        username,
        credential,
      });
    }
  }

  return servers.length ? servers : DEFAULT_STUN;
}

export function iceConfigSummary(servers: IceServerConfig[]): {
  stun: number;
  turn: number;
  hasCredentials: boolean;
} {
  let stun = 0;
  let turn = 0;
  let hasCredentials = false;
  for (const s of servers) {
    const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
    for (const u of urls) {
      if (/^turns?:/i.test(u)) turn += 1;
      else stun += 1;
    }
    if (s.username && s.credential) hasCredentials = true;
  }
  return { stun, turn, hasCredentials };
}
