import type { Migration } from "./runner.js";

const SQLITE_DDL = `
CREATE TABLE IF NOT EXISTS site_content (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT '',
  subtitle TEXT DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  quote TEXT DEFAULT '',
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('draft', 'published')),
  updated_at TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_site_content_slug ON site_content(slug);
`;

const POSTGRES_DDL = `
CREATE TABLE IF NOT EXISTS site_content (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT '',
  subtitle TEXT DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  quote TEXT DEFAULT '',
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('draft', 'published')),
  updated_at TEXT NOT NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_site_content_slug ON site_content(slug);
`;

const DEFAULT_BODY = `Plantend began as a passionate indie group pursuing a shinobi MMORPG.

From closed tests of combat and villages to a living community platform with messaging, resources, and teamwork applications, every chapter has been shaped with players and creators.

Today Ninja Era continues to grow — with calls, moderation tools, and an open road ahead built together with the community.`;

async function seedOurStory(db: Parameters<Migration["upSqlite"]>[0]) {
  const existing = await db.get<{ id: number }>("SELECT id FROM site_content WHERE slug = ?", "about-our-story");
  if (existing) return;
  const ts = new Date().toISOString();
  await db.run(
    `INSERT INTO site_content (slug, title, subtitle, body, quote, image_url, status, updated_at, published_at)
     VALUES (?, ?, ?, ?, ?, ?, 'published', ?, ?)`,
    "about-our-story",
    "Our Story",
    "Building the next generation anime RPG.",
    DEFAULT_BODY,
    "Every legend begins with a single step.",
    null,
    ts,
    ts,
  );
}

export const migration003: Migration = {
  id: "003_site_content",
  async upSqlite(db) {
    await db.exec(SQLITE_DDL);
    await seedOurStory(db);
  },
  async upPostgres(db) {
    await db.exec(POSTGRES_DDL);
    await seedOurStory(db);
  },
};
