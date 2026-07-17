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

export const migration008: Migration = {
  id: "008_link_file_access_geo",
  async upSqlite(db) {
    await addColumn(db, "link_file_access_logs", "country", "TEXT");
    await addColumn(db, "link_file_access_logs", "country_code", "TEXT");
  },
  async upPostgres(db) {
    await addColumn(db, "link_file_access_logs", "country", "TEXT");
    await addColumn(db, "link_file_access_logs", "country_code", "TEXT");
  },
};
