import { api } from "@/app/api";
import { APP_REGISTRY } from "@/shared/appRegistry";
import { hashQueryParams } from "@/shared/routing";

const ID_KEY = (appId: string) => `ne_app_install_id_${appId}`;
const OK_KEY = (appId: string) => `ne_app_install_ok_${appId}`;

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

function resolveInstallationId(appId: string): string | null {
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
  // No desktop install context — do not invent an id for casual website visits.
  return null;
}

export type RegisterAppInstallOptions = {
  appId: string;
  appName?: string;
  /** Default app version when not provided via query. */
  defaultVersion?: string;
};

/**
 * Silently register a desktop app installation once per installationId.
 * Safe to call on every page load — skips after successful registration;
 * retries later if the previous attempt failed.
 * Only runs when an installation id is present (Electron first-run query or prior attempt).
 */
export async function registerAppInstallationSilent(opts: RegisterAppInstallOptions): Promise<void> {
  const appId = opts.appId.trim().toLowerCase();
  if (!appId) return;

  try {
    if (localStorage.getItem(OK_KEY(appId)) === "1") return;
  } catch { /* proceed */ }

  const installationId = resolveInstallationId(appId);
  if (!installationId) return;

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
    try {
      localStorage.setItem(OK_KEY(appId), "1");
    } catch { /* ignore */ }
  } catch (err) {
    if (import.meta.env.DEV) {
      console.error("[app-install] registration failed:", err);
    }
  }
}
