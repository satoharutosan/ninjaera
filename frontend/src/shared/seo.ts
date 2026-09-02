import { useEffect } from "react";
import type { Page } from "@/app/shared";

export const SITE_URL = "https://ninjaera.up.railway.app";
export const SITE_NAME = "Ninja Era";
export const OG_IMAGE =
  "https://res.cloudinary.com/nitb8mqu/image/upload/v1784241402/splash_pvsv2b.png";

/** Primary meta keywords — brand + intent terms (not single-word generics). */
export const SEO_KEYWORDS = [
  "Ninja Era",
  "NinjaEra",
  "ninja era game",
  "ninjaera game",
  "ninja era rpg",
  "ninja era mmo",
  "ninja era mmorpg",
  "ninja era mmo rpg",
  "ninja game",
  "ninja mmo",
  "ninja mmorpg",
  "ninja era official",
  "ninja era official website",
  "ninja era download",
  "ninjaera download",
  "ninja era download windows",
  "ninja era download android",
  "ninja era download ios",
  "ninjaera railway",
  "open world mmorpg",
  "anime mmorpg",
  "free mmorpg",
  "free mmo rpg",
  "japan fantasy game",
].join(", ");

export const DEFAULT_TITLE =
  "Ninja Era Game Download — Official Ninja MMORPG & MMO RPG";

export const DEFAULT_DESCRIPTION =
  "Download Ninja Era (NinjaEra) — the official free ninja game, MMORPG, and open-world MMO RPG. Get Ninja Era for Windows, Android, and iOS from ninjaera.up.railway.app.";

export type PageSeo = {
  title: string;
  description: string;
  path: string;
};

function pagePath(page: Page): string {
  return page === "home" ? "/" : `/${page}`;
}

export const PAGE_SEO: Partial<Record<Page, PageSeo>> = {
  home: {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    path: "/",
  },
  download: {
    title: "Download Ninja Era — Official Game for Windows, Android & iOS",
    description:
      "Official Ninja Era download (NinjaEra): free ninja MMORPG and MMO RPG for Windows PC, Android, and iOS. Get the game from the Ninja Era official website.",
    path: "/download",
  },
  about: {
    title: "About Ninja Era Game — Anime Open-World MMORPG | Plantend",
    description:
      "Ninja Era is a free open-world ninja MMORPG and RPG from Plantend in Osaka. Learn about the anime-style Japan fantasy MMO behind NinjaEra.",
    path: "/about",
  },
  contact: {
    title: "Contact Ninja Era — Support & Partnerships",
    description:
      "Contact the Ninja Era team for support, bug reports, press, and partnerships on the official anime MMORPG website.",
    path: "/contact",
  },
  help: {
    title: "Ninja Era Help Center — MMORPG Guides & FAQ",
    description:
      "Help center for Ninja Era MMORPG players — account help, gameplay guides, and answers for the official ninja MMO RPG.",
    path: "/help",
  },
  bugs: {
    title: "Ninja Era Bug Reports — Official MMORPG Feedback",
    description:
      "Report bugs and issues for Ninja Era on the official website. Help improve the anime-style MMORPG during open beta.",
    path: "/bugs",
  },
  status: {
    title: "Ninja Era Server Status — Live MMORPG Uptime",
    description:
      "Live server status for Ninja Era MMORPG login, matchmaking, and game services on the official Ninja Era website.",
    path: "/status",
  },
  patches: {
    title: "Ninja Era Patch Notes — MMORPG Updates",
    description:
      "Read Ninja Era patch notes, balance changes, and MMORPG update history on the official Ninja Era website.",
    path: "/patches",
  },
  "orion-quest": {
    title: "Orion Quest — Ninja Era Companion App",
    description:
      "Orion Quest is the companion app for Ninja Era MMORPG — quests, rewards, and community features on the official site.",
    path: "/orion-quest",
  },
  signup: {
    title: "Play Ninja Era — Sign Up for the Free Ninja MMORPG",
    description:
      "Create your Ninja Era account and join the open beta for this free open-world ninja MMO RPG and MMORPG.",
    path: "/signup",
  },
  terms: {
    title: "Ninja Era Terms of Service",
    description: "Terms of service for Ninja Era MMORPG and the official Ninja Era website.",
    path: "/terms",
  },
  privacy: {
    title: "Ninja Era Privacy Policy",
    description: "Privacy policy for Ninja Era MMORPG players and the official Ninja Era website.",
    path: "/privacy",
  },
  messenger: {
    title: "Ninja Era Messenger Terms",
    description: "Terms for Ninja Era in-game and community messenger features.",
    path: "/messenger",
  },
};

function setMeta(
  attr: "name" | "property",
  key: string,
  content: string,
) {
  const selector = `meta[${attr}="${key}"]`;
  let el = document.querySelector(selector) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}

function setCanonical(href: string) {
  let el = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement("link");
    el.rel = "canonical";
    document.head.appendChild(el);
  }
  el.href = href;
}

export function applyPageSeo(seo: PageSeo) {
  const url = `${SITE_URL}${seo.path === "/" ? "/" : seo.path}`;

  document.title = seo.title;
  setMeta("name", "description", seo.description);
  setMeta("property", "og:title", seo.title);
  setMeta("property", "og:description", seo.description);
  setMeta("property", "og:url", url);
  setMeta("name", "twitter:title", seo.title);
  setMeta("name", "twitter:description", seo.description);
  setCanonical(url);
}

export function seoForPage(page: Page): PageSeo {
  return (
    PAGE_SEO[page] ?? {
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
      path: pagePath(page),
    }
  );
}

export function usePageSeo(page: Page) {
  useEffect(() => {
    applyPageSeo(seoForPage(page));
  }, [page]);
}

export const HOME_FAQ_SCHEMA = [
  {
    q: "What is Ninja Era game?",
    a: "Ninja Era (NinjaEra) is a free open-world ninja MMORPG and MMO RPG — an anime-style Japan fantasy game with five villages, clans, PvP, and raids. Download from the official website.",
  },
  {
    q: "Where can I download Ninja Era?",
    a: "Download Ninja Era for Windows, Android, and iOS from the official site at ninjaera.up.railway.app/download or the home page download section.",
  },
  {
    q: "Is NinjaEra the same as Ninja Era?",
    a: "Yes. NinjaEra and Ninja Era refer to the same official ninja game, MMORPG, and website.",
  },
  {
    q: "What is the Ninja Era official website?",
    a: "The Ninja Era official website is https://ninjaera.up.railway.app — also found by searching ninjaera railway or ninja era official.",
  },
  {
    q: "Is Ninja Era an MMORPG or RPG?",
    a: "Ninja Era is both: a ninja MMORPG (massively multiplayer online) and an open-world MMO RPG with solo and group content.",
  },
  {
    q: "Can I download Ninja Era for Windows, Android, and iOS?",
    a: "Yes. Official Ninja Era download builds are published for Windows PC, Android, and iOS when available in open beta.",
  },
  {
    q: "Is Ninja Era a ninja MMO?",
    a: "Yes. Ninja Era is a ninja-themed MMO and MMORPG with open-world exploration, missions, guild wars, and cross-platform play.",
  },
  {
    q: "Is Ninja Era free to play?",
    a: "Yes. Ninja Era is free to download and play. Optional cosmetics never affect competitive balance.",
  },
];

export function buildFaqJsonLd(
  items: Array<{ q: string; a: string }>,
): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  });
}

export const VIDEO_GAME_JSON_LD_ALTERNATE_NAMES = [
  "NinjaEra",
  "Ninja Era Game",
  "NinjaEra Game",
  "Ninja Era RPG",
  "Ninja Era MMO",
  "Ninja Era MMORPG",
  "Ninja MMO",
  "Ninja MMORPG",
  "Ninja Game",
];
