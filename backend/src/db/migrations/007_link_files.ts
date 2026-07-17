import type { Migration } from "./runner.js";

const SQLITE_DDL = `
CREATE TABLE IF NOT EXISTS link_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alias TEXT NOT NULL,
  alias_display TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_url TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TEXT,
  last_visitor_user_id INTEGER,
  last_visitor_label TEXT,
  uploader_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_link_files_alias ON link_files(alias);

CREATE TABLE IF NOT EXISTS link_file_access_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_file_id INTEGER NOT NULL,
  alias TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  user_id INTEGER,
  visitor_label TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  browser TEXT,
  platform TEXT,
  referrer TEXT,
  country TEXT,
  country_code TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (link_file_id) REFERENCES link_files(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_link_file_access_logs_file ON link_file_access_logs(link_file_id);
CREATE INDEX IF NOT EXISTS idx_link_file_access_logs_created ON link_file_access_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_link_file_access_logs_alias ON link_file_access_logs(alias);
`;

const POSTGRES_DDL = `
CREATE TABLE IF NOT EXISTS link_files (
  id BIGSERIAL PRIMARY KEY,
  alias TEXT NOT NULL,
  alias_display TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_url TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  access_count BIGINT NOT NULL DEFAULT 0,
  last_accessed_at TEXT,
  last_visitor_user_id BIGINT,
  last_visitor_label TEXT,
  uploader_id BIGINT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_link_files_alias ON link_files(alias);

CREATE TABLE IF NOT EXISTS link_file_access_logs (
  id BIGSERIAL PRIMARY KEY,
  link_file_id BIGINT NOT NULL REFERENCES link_files(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  user_id BIGINT,
  visitor_label TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  browser TEXT,
  platform TEXT,
  referrer TEXT,
  country TEXT,
  country_code TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_link_file_access_logs_file ON link_file_access_logs(link_file_id);
CREATE INDEX IF NOT EXISTS idx_link_file_access_logs_created ON link_file_access_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_link_file_access_logs_alias ON link_file_access_logs(alias);
`;

export const migration007: Migration = {
  id: "007_link_files",
  async upSqlite(db) {
    await db.exec(SQLITE_DDL);
  },
  async upPostgres(db) {
    await db.exec(POSTGRES_DDL);
  },
};
