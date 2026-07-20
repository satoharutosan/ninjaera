/** Short-lived admin dashboard stats cache — invalidated on any mutating admin event. */

const STATS_CACHE_TTL_MS = 5000;

let statsCache: { at: number; body: Record<string, unknown> } | null = null;

export function getAdminStatsCache(): { at: number; body: Record<string, unknown> } | null {
  if (!statsCache) return null;
  if (Date.now() - statsCache.at >= STATS_CACHE_TTL_MS) {
    statsCache = null;
    return null;
  }
  return statsCache;
}

export function setAdminStatsCache(body: Record<string, unknown>) {
  statsCache = { at: Date.now(), body };
}

export function invalidateAdminStatsCache() {
  statsCache = null;
}
