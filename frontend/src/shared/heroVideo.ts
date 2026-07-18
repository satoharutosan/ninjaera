/**
 * Landing hero character loop — place encoded files under `frontend/public/videos/`.
 *
 * Production notes for a seamless loop:
 * - First and last frames must be visually identical (matched poses / wind phase).
 * - Prefer ~6–12s loops; keep camera locked; only subtle hair/cloth/blink/breath.
 * - Export WebM (VP9) + H.264 MP4; match the poster still composition.
 */
export const HERO_CHARACTER_VIDEO = {
  webm: "/videos/hero-characters.webm",
  mp4: "/videos/hero-characters.mp4",
} as const;
