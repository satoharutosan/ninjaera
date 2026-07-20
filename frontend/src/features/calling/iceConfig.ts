import { ICE_SERVERS } from "./types";

let cachedIceServers: RTCIceServer[] | null = null;
let iceFetchPromise: Promise<RTCIceServer[]> | null = null;
/** Only cache successful server responses — never permanently cache STUN fallback. */
let cachedFromServer = false;
let lastTurnConfigured = false;

export function getLastTurnConfigured(): boolean {
  return lastTurnConfigured;
}

/** Resolve ICE servers (STUN + TURN when configured on the backend). */
export async function resolveIceServers(): Promise<RTCIceServer[]> {
  if (cachedFromServer && cachedIceServers?.length) return cachedIceServers;
  if (iceFetchPromise) return iceFetchPromise;
  iceFetchPromise = (async () => {
    try {
      const { api } = await import("@/app/api");
      const r = await api.webrtc.iceServers();
      if (r.iceServers?.length) {
        cachedIceServers = r.iceServers;
        cachedFromServer = true;
        lastTurnConfigured = !!r.turnConfigured;
        if (import.meta.env.DEV) {
          console.info("[ICE] servers loaded", {
            count: r.iceServers.length,
            turnConfigured: r.turnConfigured,
          });
        }
        if (import.meta.env.PROD && !r.turnConfigured) {
          console.warn("[ICE] TURN is not configured on the server — calls may fail across NATs");
        }
        return cachedIceServers;
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn("[ICE] fetch failed — using STUN fallback (not cached)", err);
      }
    }
    // Do NOT cache fallback — retry on next call so transient auth/network blips recover.
    return ICE_SERVERS;
  })();
  try {
    return await iceFetchPromise;
  } finally {
    iceFetchPromise = null;
  }
}

export function clearIceServerCache() {
  cachedIceServers = null;
  cachedFromServer = false;
  iceFetchPromise = null;
}
