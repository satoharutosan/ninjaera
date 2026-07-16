/**
 * Emojis hidden from the picker (browse, search, recent, frequent).
 * Existing chat messages that already contain these glyphs still render normally.
 *
 * Add glyphs here to extend the denylist without regenerating emoji data.
 */
export const EXCLUDED_PICKER_EMOJIS = new Set<string>([
  "🥲", // smiling face with tear
  "🪫", // low battery
]);

export function isPickerEmojiAllowed(emoji: string): boolean {
  return !EXCLUDED_PICKER_EMOJIS.has(emoji);
}

export function filterPickerEmojis(emojis: readonly string[]): string[] {
  return emojis.filter(isPickerEmojiAllowed);
}
