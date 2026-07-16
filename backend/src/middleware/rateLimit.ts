/**
 * In-memory sliding-window rate limiter for auth, messaging, and uploads.
 * Suitable for single-instance deploys; multi-instance should swap to Redis later.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Periodically prune expired buckets to avoid unbounded growth. */
setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}, 60_000).unref?.();

export function allowRateLimit(
  key: string,
  max: number,
  windowMs: number,
): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (existing.count >= max) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
  }
  existing.count += 1;
  return { ok: true };
}

/** Express middleware factory. Key is derived from req via `keyFn`. */
export function rateLimit(opts: {
  keyFn: (req: import("express").Request) => string;
  max: number;
  windowMs: number;
  message?: string;
}) {
  return (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    const key = opts.keyFn(req);
    const result = allowRateLimit(key, opts.max, opts.windowMs);
    if (!result.ok) {
      res.setHeader("Retry-After", String(result.retryAfterSec));
      res.status(429).json({
        error: opts.message || "Too many requests. Please try again later.",
        code: "RATE_LIMITED",
        retryAfter: result.retryAfterSec,
      });
      return;
    }
    next();
  };
}

export function clientIp(req: import("express").Request): string {
  return (req.ip || req.socket.remoteAddress || "unknown").toString();
}

/** Socket.IO per-user rate check (returns false when limited). */
export function allowSocketRate(userId: number, action: string, max: number, windowMs: number): boolean {
  return allowRateLimit(`socket:${action}:${userId}`, max, windowMs).ok;
}
