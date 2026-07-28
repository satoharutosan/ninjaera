import crypto from "crypto";
import { qGet } from "../db/query.js";

export const RESOURCE_PUBLIC_SLUG_RE = /^[a-zA-Z0-9_-]+$/;

export function normalizeResourcePublicSlug(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateResourcePublicSlug(
  raw: unknown,
): { ok: true; slug: string; display: string } | { ok: false; error: string } {
  if (raw == null || typeof raw !== "string") {
    return { ok: false, error: "Public download ID is required" };
  }
  const display = raw.trim();
  if (!display) return { ok: false, error: "Public download ID is required" };
  if (display.length > 128) return { ok: false, error: "Public download ID must be 128 characters or fewer" };
  if (/\s/.test(display)) return { ok: false, error: "Public download ID cannot contain spaces" };
  if (!RESOURCE_PUBLIC_SLUG_RE.test(display)) {
    return { ok: false, error: "Public download ID may only contain letters, numbers, hyphens, and underscores" };
  }
  return { ok: true, slug: normalizeResourcePublicSlug(display), display };
}

export function generateResourcePublicSlug(): string {
  return crypto.randomBytes(6).toString("hex");
}

export async function resourcePublicSlugTaken(slug: string, excludeId?: number): Promise<boolean> {
  const normalized = normalizeResourcePublicSlug(slug);
  if (!normalized) return false;
  if (excludeId != null) {
    const row = await qGet<{ id: number }>(
      "SELECT id FROM resources WHERE public_slug = ? AND id != ?",
      normalized,
      excludeId,
    );
    return !!row;
  }
  const row = await qGet<{ id: number }>("SELECT id FROM resources WHERE public_slug = ?", normalized);
  return !!row;
}

/** Resolve a unique slug for create/update. Empty input → defaultId or random. */
export async function resolveResourcePublicSlug(opts: {
  raw?: unknown;
  defaultId?: number;
  excludeId?: number;
}): Promise<{ ok: true; slug: string; display: string } | { ok: false; error: string }> {
  const rawStr = opts.raw == null ? "" : String(opts.raw).trim();
  if (!rawStr) {
    const preferred = opts.defaultId != null ? String(opts.defaultId) : generateResourcePublicSlug();
    let candidate = preferred;
    let display = preferred;
    let attempts = 0;
    while (await resourcePublicSlugTaken(candidate, opts.excludeId)) {
      attempts += 1;
      candidate = generateResourcePublicSlug();
      display = candidate;
      if (attempts > 12) {
        return { ok: false, error: "Could not allocate a unique public download ID" };
      }
    }
    return { ok: true, slug: normalizeResourcePublicSlug(candidate), display };
  }

  const validated = validateResourcePublicSlug(rawStr);
  if (!validated.ok) return validated;
  if (await resourcePublicSlugTaken(validated.slug, opts.excludeId)) {
    return { ok: false, error: "That public download ID is already in use" };
  }
  return validated;
}

export function resourcePublicPath(slugDisplay: string): string {
  return `/resources/public/${encodeURIComponent(slugDisplay)}`;
}
