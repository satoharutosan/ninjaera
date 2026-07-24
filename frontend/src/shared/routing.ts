import type { Page } from "@/app/shared";

const VALID_PAGES: Page[] = [
  "home", "about", "resources", "teamwork", "contact", "login", "signup", "oauth-callback",
  "verify-email", "forgot-password", "reset-password",
  "messages", "profile", "alarms", "admin", "terms", "privacy", "messenger",
  "help", "bugs", "status", "patches", "orion-quest",
];

export function pageFromLocation(): Page {
  const hash = window.location.hash.replace(/^#\/?/, "").split("?")[0].toLowerCase();
  if (hash && VALID_PAGES.includes(hash as Page)) return hash as Page;
  const path = window.location.pathname.replace(/^\//, "").toLowerCase();
  if (path && VALID_PAGES.includes(path as Page)) return path as Page;
  return "home";
}

export function hashQueryParams(): URLSearchParams {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const q = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  // Also support path-style /verify-email?token= for non-hash deploys
  const search = window.location.search.replace(/^\?/, "");
  return new URLSearchParams(q || search);
}

export function setPageInLocation(page: Page) {
  const next = `#/${page}`;
  if (window.location.hash !== next) {
    window.history.pushState(null, "", next);
  }
}

export function setPageInLocationWithQuery(page: Page, query: Record<string, string>) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();
  const next = qs ? `#/${page}?${qs}` : `#/${page}`;
  if (window.location.hash !== next) {
    window.history.pushState(null, "", next);
  }
}

export function isValidPage(p: string): p is Page {
  return VALID_PAGES.includes(p as Page);
}
