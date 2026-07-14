/**
 * Centralized social media link configuration.
 * Update URLs here or via Vite env (preferred for deploy-specific profiles):
 *   VITE_SOCIAL_FACEBOOK_URL
 *   VITE_SOCIAL_X_URL
 *   VITE_SOCIAL_YOUTUBE_URL
 *   VITE_SOCIAL_WHATSAPP_URL
 * Leave a URL empty to disable that icon gracefully.
 */
export type SocialPlatform = "facebook" | "x" | "youtube" | "whatsapp";

export interface SocialLinkConfig {
  id: SocialPlatform;
  label: string;
  /** Official profile / channel / contact URL. Empty = icon disabled. */
  url: string;
}

function fromEnv(key: string, fallback = ""): string {
  try {
    const v = (import.meta.env[key] as string | undefined)?.trim();
    return v && v.length ? v : fallback;
  } catch {
    return fallback;
  }
}

export const SOCIAL_LINKS: SocialLinkConfig[] = [
  {
    id: "facebook",
    label: "Facebook",
    url: fromEnv("VITE_SOCIAL_FACEBOOK_URL", ""),
  },
  {
    id: "x",
    label: "X",
    url: fromEnv("VITE_SOCIAL_X_URL", ""),
  },
  {
    id: "youtube",
    label: "YouTube",
    url: fromEnv("VITE_SOCIAL_YOUTUBE_URL", ""),
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    url: fromEnv("VITE_SOCIAL_WHATSAPP_URL", "https://wa.me/818014887319"),
  },
];

export function isSocialUrlConfigured(url: string | undefined | null): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed || trimmed === "#") return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
