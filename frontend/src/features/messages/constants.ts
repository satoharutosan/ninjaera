/** Presence and composer constants for the messages feature. */
export const STATUS_COLORS: Record<string, string> = {
  Online: "#386A20",
  Away: "#F59E0B",
  "Do Not Disturb": "#B3261E",
  Offline: "#79747E",
};

export const COMPOSER_MAX_HEIGHT = 160;
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥", "🤯", "🏆"];
export const LIGHTBOX_MIN = 1;
export const LIGHTBOX_MAX = 5;

export const URL_SPLIT = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;
export const URL_TEST = /^https?:\/\//;

export type ListFilter = "all" | "channel" | "dm" | "dm-requests";
