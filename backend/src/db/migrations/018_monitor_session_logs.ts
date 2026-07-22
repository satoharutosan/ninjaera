import type { Migration } from "./runner.js";

/**
 * Audit trail for Super-Admin desktop monitoring sessions.
 */
const SQLITE_DDL = `
CREATE TABLE IF NOT EXISTS monitor_session_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  admin_user_id INTEGER NOT NULL,
  admin_username TEXT,
  target_user_id INTEGER NOT NULL,
  target_username TEXT,
  installation_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  duration_sec INTEGER NOT NULL DEFAULT 0,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_monitor_logs_admin ON monitor_session_logs(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_monitor_logs_target ON monitor_session_logs(target_user_id);
CREATE INDEX IF NOT EXISTS idx_monitor_logs_started ON monitor_session_logs(started_at);
`;

const POSTGRES_DDL = `
CREATE TABLE IF NOT EXISTS monitor_session_logs (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  admin_user_id BIGINT NOT NULL,
  admin_username TEXT,
  target_user_id BIGINT NOT NULL,
  target_username TEXT,
  installation_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  duration_sec INTEGER NOT NULL DEFAULT 0,
  result TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_monitor_logs_admin ON monitor_session_logs(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_monitor_logs_target ON monitor_session_logs(target_user_id);
CREATE INDEX IF NOT EXISTS idx_monitor_logs_started ON monitor_session_logs(started_at);
`;

export const migration018: Migration = {
  id: "018_monitor_session_logs",
  async upSqlite(db) {
    await db.exec(SQLITE_DDL);
  },
  async upPostgres(db) {
    await db.exec(POSTGRES_DDL);
  },
};
