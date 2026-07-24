import type { DatabaseAdapter } from "../adapter.js";
import type { Migration } from "./runner.js";

async function columnExists(db: DatabaseAdapter, table: string, column: string): Promise<boolean> {
  const cols = await db.getColumns(table);
  return cols.some((c) => c.name === column);
}

async function addColumn(db: DatabaseAdapter, table: string, column: string, definition: string): Promise<void> {
  if (!(await db.tableExists(table))) return;
  if (await columnExists(db, table, column)) return;
  await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/** Country geo for Telegram backup uploads (filter + flag display). */
export const migration022: Migration = {
  id: "022_version_backups_country",
  async upSqlite(db) {
    await addColumn(db, "version_backups", "country", "TEXT");
    await addColumn(db, "version_backups", "country_code", "TEXT");
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_version_backups_country ON version_backups(country_code)`);
  },
  async upPostgres(db) {
    await addColumn(db, "version_backups", "country", "TEXT");
    await addColumn(db, "version_backups", "country_code", "TEXT");
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_version_backups_country ON version_backups(country_code)`);
  },
};
