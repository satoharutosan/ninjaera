import type { Migration } from "./runner.js";

/**
 * Registry of uploaded media metadata (Cloudinary public_id + secure URL).
 * Display URLs remain on domain tables (users.avatar_url, messages.media_url, …);
 * this table stores the durable Cloudinary identity for deletion/replacement.
 */
const SQLITE_DDL = `
CREATE TABLE IF NOT EXISTS uploaded_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,
  public_id TEXT NOT NULL,
  resource_type TEXT NOT NULL DEFAULT 'image',
  original_filename TEXT,
  mime_type TEXT,
  file_size INTEGER,
  folder TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_uploaded_assets_public_id ON uploaded_assets(public_id);
`;

const POSTGRES_DDL = `
CREATE TABLE IF NOT EXISTS uploaded_assets (
  id BIGSERIAL PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  public_id TEXT NOT NULL,
  resource_type TEXT NOT NULL DEFAULT 'image',
  original_filename TEXT,
  mime_type TEXT,
  file_size BIGINT,
  folder TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_uploaded_assets_public_id ON uploaded_assets(public_id);
`;

export const migration005: Migration = {
  id: "005_uploaded_assets",
  async upSqlite(db) {
    await db.exec(SQLITE_DDL);
  },
  async upPostgres(db) {
    await db.exec(POSTGRES_DDL);
  },
};
