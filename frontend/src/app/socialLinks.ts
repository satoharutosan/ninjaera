/**
 * Centralized social media link configuration.
 * Update URLs here — Footer and other UI read from this source.
 * Leave a URL empty or undefined to disable that icon gracefully.
 */
export type SocialPlatform = "facebook" | "x" | "youtube" | "whatsapp";

export interface SocialLinkConfig {
  id: SocialPlatform;
  label: string;
  /** Official profile / channel / contact URL. Empty = icon disabled. */
  url: string;
}

export const SOCIAL_LINKS: SocialLinkConfig[] = [
  {
    id: "facebook",
    label: "Facebook",
    // Set the official Facebook page URL when available.
    url: "",
  },
  {
    id: "x",
    label: "X",
    // Set the official X (Twitter) profile URL when available.
    url: "",
  },
  {
    id: "youtube",
    label: "YouTube",
    // Set the official YouTube channel URL when available.
    url: "",
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    url: "https://wa.me/818014887319",
  },
];

export function isSocialUrlConfigured(url: string | undefined | null): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  return trimmed.length > 0 && trimmed !== "#";
}
