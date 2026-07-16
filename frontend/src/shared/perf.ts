/**
 * Dev-only performance diagnostics.
 * Enable with DEV builds automatically, or set localStorage.ninja-era-perf=1 in production builds for debugging.
 */
type TimerKey = string;

const timers = new Map<TimerKey, number>();
const counters: Record<string, number> = {};

function enabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (import.meta.env.DEV) return true;
    return localStorage.getItem("ninja-era-perf") === "1";
  } catch {
    return false;
  }
}

export const appPerf = {
  mark(label: string) {
    if (!enabled()) return;
    timers.set(label, performance.now());
  },

  measure(label: string, extra?: Record<string, unknown>) {
    if (!enabled()) return;
    const start = timers.get(label);
    if (start == null) return;
    timers.delete(label);
    console.debug(`[appPerf] ${label}=${Math.round(performance.now() - start)}ms`, extra ?? "");
  },

  count(key: string, delta = 1) {
    if (!enabled()) return;
    counters[key] = (counters[key] || 0) + delta;
  },

  snapshot() {
    return { ...counters };
  },

  logSnapshot() {
    if (!enabled()) return;
    console.debug("[appPerf] snapshot", this.snapshot());
  },
};
