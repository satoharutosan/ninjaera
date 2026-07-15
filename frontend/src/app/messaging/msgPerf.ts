type MetricKey =
  | "openLatencyMs"
  | "fetchLatencyMs"
  | "wsApplyLatencyMs"
  | "cacheHit"
  | "cacheMiss"
  | "renderedRows";

type Counters = {
  cacheHits: number;
  cacheMisses: number;
};

const counters: Counters = { cacheHits: 0, cacheMisses: 0 };
const openStarts = new Map<number, number>();

function enabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (import.meta.env.DEV) return true;
    return localStorage.getItem("ninja-era-msg-perf") === "1";
  } catch {
    return false;
  }
}

function log(key: MetricKey, value: number | string, extra?: Record<string, unknown>) {
  if (!enabled()) return;
  // Compact single-line telemetry for console filtering
  console.debug(`[msgPerf] ${key}=${value}`, extra ?? "");
}

export const msgPerf = {
  markOpenStart(conversationId: number) {
    if (!enabled()) return;
    openStarts.set(conversationId, performance.now());
  },

  markOpenReady(conversationId: number, source: "cache" | "network") {
    if (!enabled()) return;
    const start = openStarts.get(conversationId);
    openStarts.delete(conversationId);
    if (start == null) return;
    log("openLatencyMs", Math.round(performance.now() - start), { conversationId, source });
  },

  markFetch(ms: number, opts?: Record<string, unknown>) {
    log("fetchLatencyMs", Math.round(ms), opts);
  },

  markWsApply(ms: number, event: string) {
    log("wsApplyLatencyMs", Math.round(ms), { event });
  },

  cacheHit(conversationId: number) {
    counters.cacheHits += 1;
    log("cacheHit", counters.cacheHits, { conversationId, miss: counters.cacheMisses });
  },

  cacheMiss(conversationId: number) {
    counters.cacheMisses += 1;
    log("cacheMiss", counters.cacheMisses, { conversationId, hit: counters.cacheHits });
  },

  renderedRows(count: number) {
    log("renderedRows", count);
  },

  snapshot() {
    return { ...counters };
  },
};
