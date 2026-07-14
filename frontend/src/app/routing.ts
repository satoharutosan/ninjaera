import type { Page } from "./shared";

const VALID_PAGES: Page[] = [
  "home", "about", "resources", "teamwork", "contact", "login", "signup", "oauth-callback",
  "messages", "profile", "alarms", "admin", "terms",
];

export function pageFromLocation(): Page {
  const hash = window.location.hash.replace(/^#\/?/, "").split("?")[0].toLowerCase();
  if (hash && VALID_PAGES.includes(hash as Page)) return hash as Page;
  const path = window.location.pathname.replace(/^\//, "").toLowerCase();
  if (path && VALID_PAGES.includes(path as Page)) return path as Page;
  return "home";
}

export function setPageInLocation(page: Page) {
  const next = `#/${page}`;
  if (window.location.hash !== next) {
    window.history.pushState(null, "", next);
  }
}

export function isValidPage(p: string): p is Page {
  return VALID_PAGES.includes(p as Page);
}
