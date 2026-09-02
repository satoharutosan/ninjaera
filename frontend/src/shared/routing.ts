import type { Page } from "@/app/shared";

const VALID_PAGES: Page[] = [
  "home", "download", "about", "resources", "teamwork", "contact", "login", "signup", "oauth-callback",
  "verify-email", "forgot-password", "reset-password",
  "messages", "profile", "alarms", "admin", "terms", "privacy", "messenger",
  "help", "bugs", "status", "patches", "orion-quest",
];

/** Migrate legacy hash URLs (#/about) to crawlable path URLs (/about). */
export function migrateHashToPath() {
  const raw = window.location.hash.replace(/^#\/?/, "");
  if (!raw) return;

  const [pagePart, ...queryParts] = raw.split("?");
  const page = pagePart.toLowerCase();
  if (!page || !VALID_PAGES.includes(page as Page)) return;

  const qs = queryParts.length ? `?${queryParts.join("?")}` : "";
  const path = page === "home" ? "/" : `/${page}`;
  window.history.replaceState(null, "", `${path}${qs}`);
  window.location.hash = "";
}

export function pageFromLocation(): Page {
  const path = window.location.pathname.replace(/^\//, "").toLowerCase();
  if (!path || path === "index.html") return "home";
  if (VALID_PAGES.includes(path as Page)) return path as Page;

  const hash = window.location.hash.replace(/^#\/?/, "").split("?")[0].toLowerCase();
  if (hash && VALID_PAGES.includes(hash as Page)) return hash as Page;

  return "home";
}

export function hashQueryParams(): URLSearchParams {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const q = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  const search = window.location.search.replace(/^\?/, "");
  return new URLSearchParams(q || search);
}

function pathForPage(page: Page): string {
  return page === "home" ? "/" : `/${page}`;
}

export function setPageInLocation(page: Page) {
  const next = pathForPage(page);
  const currentPath = window.location.pathname.replace(/\/$/, "") || "/";
  const normalizedNext = next.replace(/\/$/, "") || "/";
  if (currentPath !== normalizedNext) {
    window.history.pushState(null, "", next);
  }
  if (window.location.hash) {
    window.history.replaceState(null, "", next);
  }
}

export function setPageInLocationWithQuery(page: Page, query: Record<string, string>) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();
  const base = pathForPage(page);
  const next = qs ? `${base}?${qs}` : base;
  window.history.pushState(null, "", next);
  if (window.location.hash) {
    window.history.replaceState(null, "", next);
  }
}

export function isValidPage(p: string): p is Page {
  return VALID_PAGES.includes(p as Page);
}
