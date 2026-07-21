import type { Migration } from "./runner.js";

const SQLITE_DDL = `
CREATE TABLE IF NOT EXISTS desktop_releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT NOT NULL,
  version TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'stable',
  release_notes TEXT,
  min_supported_version TEXT,
  package_filename TEXT NOT NULL,
  package_url TEXT NOT NULL,
  package_size INTEGER NOT NULL DEFAULT 0,
  sha1 TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_at TEXT NOT NULL,
  created_by INTEGER,
  UNIQUE(app_id, channel, version)
);
CREATE INDEX IF NOT EXISTS idx_desktop_releases_app_channel ON desktop_releases(app_id, channel);
CREATE INDEX IF NOT EXISTS idx_desktop_releases_published ON desktop_releases(published);
`;

const POSTGRES_DDL = `
CREATE TABLE IF NOT EXISTS desktop_releases (
  id BIGSERIAL PRIMARY KEY,
  app_id TEXT NOT NULL,
  version TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'stable',
  release_notes TEXT,
  min_supported_version TEXT,
  package_filename TEXT NOT NULL,
  package_url TEXT NOT NULL,
  package_size BIGINT NOT NULL DEFAULT 0,
  sha1 TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_by BIGINT,
  created_at TEXT NOT NULL,
  UNIQUE(app_id, channel, version)
);
CREATE INDEX IF NOT EXISTS idx_desktop_releases_app_channel ON desktop_releases(app_id, channel);
CREATE INDEX IF NOT EXISTS idx_desktop_releases_published ON desktop_releases(published);
`;

export const migration015: Migration = {
  id: "015_desktop_releases",
  async upSqlite(db) {
    await db.exec(SQLITE_DDL);
  },
  async upPostgres(db) {
    await db.exec(POSTGRES_DDL);
  },
};
