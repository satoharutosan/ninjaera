/** Structured patch-note entries. Admins can append new versions here (or later via API). */

export type PatchNoteSection = {
  added?: string[];
  improved?: string[];
  fixed?: string[];
};

export type PatchNote = {
  version: string;
  releaseDate: string;
  title?: string;
  sections: PatchNoteSection;
};

export const PATCH_NOTES: PatchNote[] = [
  {
    version: "1.2.0",
    releaseDate: "2026-07-15",
    title: "Plantend Messaging & Performance",
    sections: {
      added: [
        "High-performance conversation cache and bi-directional message paging",
        "Help Center, Bug Reports, Server Status, and Patch Notes pages",
      ],
      improved: [
        "Administrator sidebar stays fixed while browsing large datasets",
        "First-time channel visits open at the newest messages",
        "Landing page navigation scrolls directly to Download",
      ],
      fixed: [
        "Profile header no longer shows placeholder village and clan lore",
      ],
    },
  },
  {
    version: "1.1.0",
    releaseDate: "2026-06-01",
    title: "Team Platform Foundations",
    sections: {
      added: [
        "Team applications and resource library",
        "Direct messages and public channels",
      ],
      improved: [
        "Dark mode consistency across auth and profile surfaces",
      ],
      fixed: [
        "Session restore reliability after OAuth login",
      ],
    },
  },
  {
    version: "1.0.0",
    releaseDate: "2026-04-01",
    title: "Initial Public Release",
    sections: {
      added: [
        "Landing page, account system, and core team portal",
      ],
    },
  },
];
