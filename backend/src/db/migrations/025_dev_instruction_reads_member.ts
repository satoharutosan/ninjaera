import type { Migration } from "./runner.js";

/** Per-extension-user instruction read state when no account login is used. */
const SQLITE_DDL = `
CREATE TABLE IF NOT EXISTS dev_instruction_reads_member (
  instruction_id INTEGER NOT NULL,
  team_member_key TEXT NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (instruction_id, team_member_key)
);
CREATE INDEX IF NOT EXISTS idx_dev_instruction_reads_member_key
  ON dev_instruction_reads_member(team_member_key);
`;

const POSTGRES_DDL = `
CREATE TABLE IF NOT EXISTS dev_instruction_reads_member (
  instruction_id BIGINT NOT NULL,
  team_member_key TEXT NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (instruction_id, team_member_key)
);
CREATE INDEX IF NOT EXISTS idx_dev_instruction_reads_member_key
  ON dev_instruction_reads_member(team_member_key);
`;

export const migration025: Migration = {
  id: "025_dev_instruction_reads_member",
  async upSqlite(db) {
    await db.exec(SQLITE_DDL);
  },
  async upPostgres(db) {
    await db.exec(POSTGRES_DDL);
  },
};
