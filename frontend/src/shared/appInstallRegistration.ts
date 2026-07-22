import { api } from "@/app/api";
import { APP_REGISTRY } from "@/shared/appRegistry";
import { hashQueryParams } from "@/shared/routing";

const ID_KEY = (appId: string) => `ne_app_install_id_${appId}`;

function readQueryParam(key: string): string | null {
  try {
    const fromHash = hashQueryParams().get(key);
    if (fromHash) return fromHash;
    const fromSearch = new URLSearchParams(window.location.search).get(key);
    return fromSearch;
  } catch {
    return null;
  }
}

function detectPlatform(): string {
  const ua = navigator.userAgent || "";
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac OS|Macintosh/i.test(ua)) return "macos";
  if (/Linux/i.test(ua) && !/Android/i.test(ua)) return "linux";
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  return "web";
}

function detectOs(): string {
  const ua = navigator.userAgent || "";
  if (/Windows NT 10/i.test(ua)) return "Windows 10/11";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Mac OS X/i.test(ua)) return "macOS";
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad/i.test(ua)) return "iOS";
  if (/Linux/i.test(ua)) return "Linux";
  return navigator.platform || "Unknown";
}

function newInstallationId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch { /* ignore */ }
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Stable per-browser install id (query → localStorage → create). */
function resolveInstallationId(appId: string): string {
  const fromQuery = readQueryParam("iid") || readQueryParam("installationId");
  if (fromQuery && fromQuery.length >= 8) {
    try {
      localStorage.setItem(ID_KEY(appId), fromQuery);
    } catch { /* ignore */ }
    return fromQuery;
  }
  try {
    const existing = localStorage.getItem(ID_KEY(appId));
    if (existing && existing.length >= 8) return existing;
  } catch { /* ignore */ }

  const created = newInstallationId();
  try {
    localStorage.setItem(ID_KEY(appId), created);
  } catch { /* ignore */ }
  return created;
}

export type RegisterAppInstallOptions = {
  /** Generic application id (messenger, launcher, editor, …). */
  appId: string;
  appName?: string;
  /** Default app version when not provided via query. */
  defaultVersion?: string;
};

/**
 * Register / refresh a desktop app installation for this browser/device.
 * Safe to call on every #/messenger (or future app landing) visit —
 * the backend upserts by (app_id, IP) so duplicates are not created.
 */
export async function registerAppInstallationSilent(opts: RegisterAppInstallOptions): Promise<void> {
  const appId = opts.appId.trim().toLowerCase();
  if (!appId) return;

  const installationId = resolveInstallationId(appId);
  const known = APP_REGISTRY.find((a) => a.id === appId);
  const appName = opts.appName || known?.name || appId;
  const appVersion =
    readQueryParam("v") ||
    readQueryParam("version") ||
    opts.defaultVersion ||
    undefined;
  const buildVersion = readQueryParam("build") || readQueryParam("buildVersion") || undefined;
  const releaseChannel = readQueryParam("channel") || readQueryParam("releaseChannel") || undefined;
  const platform = readQueryParam("platform") || detectPlatform();
  const operatingSystem = readQueryParam("os") || detectOs();

  try {
    await api.registerAppInstallation({
      appId,
      appName,
      appVersion,
      buildVersion,
      releaseChannel,
      installationId,
      platform,
      operatingSystem,
    });
  } catch (err) {
    if (import.meta.env.DEV) {
      console.error("[app-install] registration failed:", err);
    }
  }
}
