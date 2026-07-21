import type { Migration } from "./runner.js";

/**
 * Dedicated application installation tracking (Messenger + future desktop apps).
 * Unique per (app_id, installation_id) — reloads must not create duplicates.
 */
const SQLITE_DDL = `
CREATE TABLE IF NOT EXISTS app_installations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT NOT NULL,
  app_name TEXT,
  app_version TEXT,
  build_version TEXT,
  release_channel TEXT,
  installation_id TEXT NOT NULL,
  user_id INTEGER,
  username TEXT,
  user_role TEXT,
  is_anonymous INTEGER NOT NULL DEFAULT 1,
  ip_address TEXT,
  country TEXT,
  country_code TEXT,
  operating_system TEXT,
  platform TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  user_agent TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(app_id, installation_id)
);
CREATE INDEX IF NOT EXISTS idx_app_installations_app ON app_installations(app_id);
CREATE INDEX IF NOT EXISTS idx_app_installations_created ON app_installations(created_at);
CREATE INDEX IF NOT EXISTS idx_app_installations_user ON app_installations(user_id);
CREATE INDEX IF NOT EXISTS idx_app_installations_status ON app_installations(status);
`;

const POSTGRES_DDL = `
CREATE TABLE IF NOT EXISTS app_installations (
  id BIGSERIAL PRIMARY KEY,
  app_id TEXT NOT NULL,
  app_name TEXT,
  app_version TEXT,
  build_version TEXT,
  release_channel TEXT,
  installation_id TEXT NOT NULL,
  user_id BIGINT,
  username TEXT,
  user_role TEXT,
  is_anonymous INTEGER NOT NULL DEFAULT 1,
  ip_address TEXT,
  country TEXT,
  country_code TEXT,
  operating_system TEXT,
  platform TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  user_agent TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(app_id, installation_id)
);
CREATE INDEX IF NOT EXISTS idx_app_installations_app ON app_installations(app_id);
CREATE INDEX IF NOT EXISTS idx_app_installations_created ON app_installations(created_at);
CREATE INDEX IF NOT EXISTS idx_app_installations_user ON app_installations(user_id);
CREATE INDEX IF NOT EXISTS idx_app_installations_status ON app_installations(status);
`;

export const migration014: Migration = {
  id: "014_app_installations",
  async upSqlite(db) {
    await db.exec(SQLITE_DDL);
  },
  async upPostgres(db) {
    await db.exec(POSTGRES_DDL);
  },
};
