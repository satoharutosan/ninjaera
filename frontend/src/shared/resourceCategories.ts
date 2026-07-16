/** Shared resource categories — keep frontend Resources + Admin Resource Management in sync. */
export const RESOURCE_CATEGORIES = ["App", "Guide", "Design", "Character Art", "Source"] as const;

export type ResourceCategory = (typeof RESOURCE_CATEGORIES)[number];

/**
 * Legacy → current category mapping (safe migrations / API alias acceptance).
 * Only used when the raw value is not already a current category.
 */
export const RESOURCE_CATEGORY_ALIASES: Record<string, ResourceCategory> = {
  Guides: "App",
  App: "App",
  Wiki: "Guide",
  Downloads: "Design",
  "Patch Notes": "Character Art",
  Media: "Source",
};

export function normalizeResourceCategory(raw: string | null | undefined): ResourceCategory | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if ((RESOURCE_CATEGORIES as readonly string[]).includes(trimmed)) {
    return trimmed as ResourceCategory;
  }
  return RESOURCE_CATEGORY_ALIASES[trimmed] ?? null;
}

export function isValidResourceCategory(raw: string | null | undefined): boolean {
  return normalizeResourceCategory(raw) != null;
}

export const RESOURCE_CATEGORY_ERROR =
  "Invalid resource category. Use App, Guide, Design, Character Art, or Source.";
