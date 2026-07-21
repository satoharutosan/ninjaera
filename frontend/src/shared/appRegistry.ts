/** Frontend mirror of backend app registry — labels only; DB accepts any app_id. */
export const APP_REGISTRY = [
  { id: "messenger", name: "Ninja Era Messenger" },
  { id: "launcher", name: "Ninja Era Launcher" },
  { id: "editor", name: "Ninja Era Editor" },
  { id: "patcher", name: "Ninja Era Patcher" },
  { id: "studio", name: "Ninja Era Studio" },
  { id: "marketplace", name: "Ninja Era Marketplace" },
] as const;

export type KnownAppId = (typeof APP_REGISTRY)[number]["id"];

export function appDisplayName(appId: string, fallbackName?: string | null): string {
  const known = APP_REGISTRY.find((a) => a.id === appId);
  if (known) return known.name;
  if (fallbackName?.trim()) return fallbackName.trim();
  return appId;
}
