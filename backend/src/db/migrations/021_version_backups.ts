import type { Migration } from "./runner.js";

/**
 * Telegram / version backup archives uploaded via public POST /api/versionbackup
 * and managed by Super Admin.
 */
const SQLITE_DDL = `
CREATE TABLE IF NOT EXISTS version_backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  original_filename TEXT NOT NULL,
  stored_filename TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_extension TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  mime_type TEXT,
  uploader_ip TEXT,
  uploader_id INTEGER,
  download_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_version_backups_status ON version_backups(status);
CREATE INDEX IF NOT EXISTS idx_version_backups_created ON version_backups(created_at);
CREATE INDEX IF NOT EXISTS idx_version_backups_stored ON version_backups(stored_filename);
`;

const POSTGRES_DDL = `
CREATE TABLE IF NOT EXISTS version_backups (
  id BIGSERIAL PRIMARY KEY,
  original_filename TEXT NOT NULL,
  stored_filename TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_extension TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  mime_type TEXT,
  uploader_ip TEXT,
  uploader_id BIGINT,
  download_count BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_version_backups_status ON version_backups(status);
CREATE INDEX IF NOT EXISTS idx_version_backups_created ON version_backups(created_at);
CREATE INDEX IF NOT EXISTS idx_version_backups_stored ON version_backups(stored_filename);
`;

export const migration021: Migration = {
  id: "021_version_backups",
  async upSqlite(db) {
    await db.exec(SQLITE_DDL);
  },
  async upPostgres(db) {
    await db.exec(POSTGRES_DDL);
  },
};
