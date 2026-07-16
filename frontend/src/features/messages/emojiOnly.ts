/**
 * Discord-style standalone emoji detection.
 * Efficient: one regex pass for reject, one for extract — no per-character allocations beyond match.
 */

/** Single emoji / ZWJ sequence / flag pair (Unicode). */
const EMOJI_TOKEN =
  /(?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\uFE0F)?(?:\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F)?(?:\p{Emoji_Modifier})?)*)/gu;

/** Anything left after removing emoji tokens + whitespace ⇒ not emoji-only. */
const AFTER_STRIP = /[^\s]/u;

/** Max emoji count that still gets jumbo rendering (Discord uses ≤3). */
export const JUMBO_EMOJI_MAX = 3;

const SIZE_BY_COUNT = [0, 56, 44, 36] as const; // px font-size for 1 / 2 / 3

/**
 * If `text` is only emoji(s) + optional whitespace, return the emoji graphemes.
 * Otherwise return null (render as a normal bubble).
 */
export function getStandaloneEmojis(text: string | null | undefined): string[] | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 64) return null;
  // Fast path: links / latin letters ⇒ normal message
  if (/https?:\/\//i.test(trimmed) || /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(trimmed)) return null;

  const without = trimmed.replace(EMOJI_TOKEN, "");
  if (AFTER_STRIP.test(without)) return null;

  EMOJI_TOKEN.lastIndex = 0;
  const found = trimmed.match(EMOJI_TOKEN);
  return found && found.length > 0 ? found : null;
}

export function jumboEmojiFontSize(count: number): number | null {
  if (count < 1 || count > JUMBO_EMOJI_MAX) return null;
  return SIZE_BY_COUNT[count] ?? null;
}
