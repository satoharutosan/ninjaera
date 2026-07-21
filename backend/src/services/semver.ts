/**
 * Lightweight semver helpers for desktop release gating (no extra dependency).
 * Supports major.minor.patch with optional pre-release suffix ignored for compare.
 */

export function parseSemver(raw: string): { major: number; minor: number; patch: number } | null {
  const m = String(raw || "")
    .trim()
    .replace(/^v/i, "")
    .match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/** -1 if a < b, 0 if equal, 1 if a > b. Null if either invalid. */
export function compareSemver(a: string, b: string): number | null {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  return 0;
}

export function isValidSemver(raw: string): boolean {
  return !!parseSemver(raw);
}
