/** Configurable page size for message windows (capped client-side to match server max). */
const raw = Number(import.meta.env.VITE_MESSAGE_PAGE_SIZE);
export const MESSAGE_PAGE_SIZE =
  Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 100) : 50;

/** Virtuoso prepend base index (large enough to avoid going negative). */
export const VIRTUOSO_START_INDEX = 10_000_000;

/** Soft cap of cached messages per conversation. */
export const MAX_CACHED_MESSAGES_PER_CONV = 2000;

/** Max conversations retained in the in-memory LRU cache. */
export const MAX_CACHED_CONVERSATIONS = 30;
