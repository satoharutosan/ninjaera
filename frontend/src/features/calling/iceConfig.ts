import { ICE_SERVERS } from "./types";

let cachedIceServers: RTCIceServer[] | null = null;
let iceFetchPromise: Promise<RTCIceServer[]> | null = null;

/** Resolve ICE servers (STUN + TURN when configured on the backend). */
export async function resolveIceServers(): Promise<RTCIceServer[]> {
  if (cachedIceServers?.length) return cachedIceServers;
  if (iceFetchPromise) return iceFetchPromise;
  iceFetchPromise = (async () => {
    try {
      const { api } = await import("@/app/api");
      const r = await api.webrtc.iceServers();
      if (r.iceServers?.length) {
        cachedIceServers = r.iceServers;
        if (import.meta.env.DEV) {
          console.info("[WebRTC] ICE servers loaded", {
            count: r.iceServers.length,
            turnConfigured: r.turnConfigured,
          });
        }
        return cachedIceServers;
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn("[WebRTC] ICE fetch failed — using STUN fallback", err);
      }
    }
    cachedIceServers = ICE_SERVERS;
    return cachedIceServers;
  })();
  try {
    return await iceFetchPromise;
  } finally {
    iceFetchPromise = null;
  }
}

export function clearIceServerCache() {
  cachedIceServers = null;
}
