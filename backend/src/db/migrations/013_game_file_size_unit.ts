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

/**
 * Manual game file size as entered by admins (value + MB/GB).
 * `file_size` remains the byte equivalent for legacy readers.
 */
export const migration013: Migration = {
  id: "013_game_file_size_unit",
  async upSqlite(db) {
    await addColumn(db, "game_downloads", "file_size_value", "REAL");
    await addColumn(db, "game_downloads", "file_size_unit", "TEXT");
  },
  async upPostgres(db) {
    await addColumn(db, "game_downloads", "file_size_value", "DOUBLE PRECISION");
    await addColumn(db, "game_downloads", "file_size_unit", "TEXT");
  },
};
