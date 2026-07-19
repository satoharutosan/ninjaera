/**
 * Desktop-only accent palette helpers.
 * Derives tonal surfaces from the user-selected Accent Color so Dark/Light
 * selection backgrounds stay in sync without hardcoding MD3 purple tokens.
 */

import type { ColorTheme } from "@/app/shared";
import { DARK_C, LIGHT_C } from "@/app/shared";

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const raw = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw) && !/^[0-9a-fA-F]{3}$/.test(raw)) return null;
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (n: number) =>
    Math.round(clamp01(n) * 255)
      .toString(16)
      .padStart(2, "0");
  // Accept 0–255 inputs as well as 0–1.
  const nr = r > 1 ? r / 255 : r;
  const ng = g > 1 ? g / 255 : g;
  const nb = b > 1 ? b / 255 : b;
  return `#${to(nr)}${to(ng)}${to(nb)}`.toUpperCase();
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const nr = r / 255;
  const ng = g / 255;
  const nb = b / 255;
  const max = Math.max(nr, ng, nb);
  const min = Math.min(nr, ng, nb);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  switch (max) {
    case nr:
      h = ((ng - nb) / d + (ng < nb ? 6 : 0)) / 6;
      break;
    case ng:
      h = ((nb - nr) / d + 2) / 6;
      break;
    default:
      h = ((nr - ng) / d + 4) / 6;
      break;
  }
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

/**
 * Light-mode surface variant (sidebar, search, message canvas).
 * Soft but vivid pastel from the accent — richer than a grayish wash.
 * Target character for default purple ≈ rgb(241, 225, 247).
 */
export function deriveLightSurfaceVariant(accentHex: string): string {
  const rgb = hexToRgb(accentHex);
  if (!rgb) return LIGHT_C.surfaceVar;
  const { h, s } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  // Nudge hue slightly toward rose/lavender and keep healthy chroma so the
  // wash reads as a beautiful accent tint rather than cool gray-lilac.
  const hue = (h + 0.055) % 1;
  const sat = clamp01(Math.min(Math.max(s * 1.35, 0.5), 0.6));
  const next = hslToRgb(hue, sat, 0.928);
  return rgbToHex(next.r, next.g, next.b);
}

/**
 * Light-mode primary container (selected rows / active chips).
 * A touch richer than surfaceVar so selection still reads clearly.
 */
export function deriveLightPrimaryContainer(accentHex: string): string {
  const rgb = hexToRgb(accentHex);
  if (!rgb) return LIGHT_C.primaryCont;
  const { h, s } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const hue = (h + 0.04) % 1;
  const sat = clamp01(Math.min(Math.max(s * 1.25, 0.45), 0.6));
  const next = hslToRgb(hue, sat, 0.9);
  return rgbToHex(next.r, next.g, next.b);
}

/** Light-mode secondary/tonal button fill. */
export function deriveLightSecondaryContainer(accentHex: string): string {
  const rgb = hexToRgb(accentHex);
  if (!rgb) return LIGHT_C.secondaryCont;
  const { h, s } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const hue = (h + 0.045) % 1;
  const sat = clamp01(Math.min(Math.max(s * 1.2, 0.43), 0.58));
  const next = hslToRgb(hue, sat, 0.915);
  return rgbToHex(next.r, next.g, next.b);
}

/**
 * Build a ColorTheme for the Electron shell from the base light/dark tokens
 * plus the user-selected accent. Body text colors (onSurface*) stay untouched;
 * only accent-related backgrounds are derived.
 */
export function buildDesktopTheme(isDark: boolean, accentHex: string): ColorTheme {
  const base = isDark ? DARK_C : LIGHT_C;
  const accent = hexToRgb(accentHex) ? accentHex : "#6750A4";
  if (isDark) {
    return {
      ...base,
      // Accent ink for filled buttons / links (same role as Settings accent).
      primary: accent,
      // Surfaces that were hardcoded #4F378B follow the selected accent.
      primaryCont: accent,
    };
  }
  const surfaceVar = deriveLightSurfaceVariant(accent);
  return {
    ...base,
    primary: accent,
    primaryCont: deriveLightPrimaryContainer(accent),
    secondaryCont: deriveLightSecondaryContainer(accent),
    // Sidebar / search / message-list / empty-state canvases.
    surfaceVar,
  };
}

/** Publish CSS custom properties consumed by desktop.css hover overrides. */
export function applyDesktopAccentCssVars(theme: ColorTheme): void {
  const root = document.documentElement;
  root.style.setProperty("--ninja-accent", theme.primary);
  root.style.setProperty("--ninja-accent-cont", theme.primaryCont);
  root.style.setProperty("--ninja-surface-var", theme.surfaceVar);
  root.style.setProperty("--ninja-accent-6", `color-mix(in srgb, ${theme.primary} 6%, transparent)`);
  root.style.setProperty("--ninja-accent-8", `color-mix(in srgb, ${theme.primary} 8%, transparent)`);
  root.style.setProperty("--ninja-accent-4", `color-mix(in srgb, ${theme.primary} 4%, transparent)`);
  root.style.setProperty("--ninja-accent-10", `color-mix(in srgb, ${theme.primary} 10%, transparent)`);
  root.style.setProperty("--ninja-surface-bg", theme.bg);
}
