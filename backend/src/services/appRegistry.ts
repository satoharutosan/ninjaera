/**
 * Application registry — known desktop apps for display labels.
 * Unknown app_id values remain fully supported (stored & filterable as-is).
 */
export type AppRegistryEntry = {
  id: string;
  name: string;
};

/** Canonical known applications (extensible without schema changes). */
export const APP_REGISTRY: readonly AppRegistryEntry[] = [
  { id: "messenger", name: "Ninja Era Messenger" },
  { id: "launcher", name: "Ninja Era Launcher" },
  { id: "editor", name: "Ninja Era Editor" },
  { id: "patcher", name: "Ninja Era Patcher" },
  { id: "studio", name: "Ninja Era Studio" },
  { id: "marketplace", name: "Ninja Era Marketplace" },
  { id: "orion-quest", name: "Orion Quest" },
] as const;

const byId = new Map(APP_REGISTRY.map((e) => [e.id, e]));

export function normalizeAppId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (!id || id.length > 64) return null;
  return id;
}

export function resolveAppName(appId: string, providedName?: string | null): string {
  const trimmed = (providedName || "").trim();
  if (trimmed) return trimmed.slice(0, 120);
  return byId.get(appId)?.name ?? appId;
}

export function knownAppIds(): string[] {
  return APP_REGISTRY.map((e) => e.id);
}
