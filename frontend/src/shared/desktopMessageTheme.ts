/**
 * Desktop-only message chrome helpers.
 * Returns null on the web so shared message components keep default styling.
 */
import { getNinja } from "./electronBridge";
import type { ColorTheme } from "@/app/shared";

/** Soft light-white sent bubble used in Electron Dark Mode only. */
export const DESKTOP_DARK_SELF_BUBBLE_BG = "#F2F0F4";
export const DESKTOP_DARK_SELF_BUBBLE_FG = "#1C1B1F";

export function desktopDarkSelfBubble(C: ColorTheme): { bg: string; fg: string } | null {
  if (!getNinja()) return null;
  if (C.bg !== "#141218") return null;
  return { bg: DESKTOP_DARK_SELF_BUBBLE_BG, fg: DESKTOP_DARK_SELF_BUBBLE_FG };
}
