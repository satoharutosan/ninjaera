/**
 * Configurable admin upload ceilings (bytes).
 * Defaults intentionally support multi‑GB game/resource builds.
 * Override via env without redeploying code (Railway Variables).
 */
function envBytes(name: string, fallback: number): number {
  const raw = (process.env[name] || "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

/** Admin Resources — default 5 GiB */
export const ADMIN_RESOURCE_MAX_BYTES = envBytes(
  "ADMIN_RESOURCE_MAX_BYTES",
  5 * 1024 * 1024 * 1024,
);

/** Admin Game builds — default 20 GiB */
export const ADMIN_GAME_MAX_BYTES = envBytes(
  "ADMIN_GAME_MAX_BYTES",
  20 * 1024 * 1024 * 1024,
);

/** Admin Link Files — default 500 MiB */
export const ADMIN_LINK_FILE_MAX_BYTES = envBytes(
  "ADMIN_LINK_FILE_MAX_BYTES",
  500 * 1024 * 1024,
);

/** Admin desktop update packages (.nupkg) — default 2 GiB */
export const ADMIN_DESKTOP_UPDATE_MAX_BYTES = envBytes(
  "ADMIN_DESKTOP_UPDATE_MAX_BYTES",
  2 * 1024 * 1024 * 1024,
);

/** Telegram / version backup archives — default 5 GiB */
export const VERSION_BACKUP_MAX_BYTES = envBytes(
  "VERSION_BACKUP_MAX_BYTES",
  5 * 1024 * 1024 * 1024,
);

export function formatBytesLimit(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    const gb = bytes / (1024 * 1024 * 1024);
    return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024))} MB`;
  }
  return `${Math.round(bytes / 1024)} KB`;
}
