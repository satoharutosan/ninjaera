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
 * Preserve the administrator's original upload filename for Content-Disposition
 * on download. Storage keys remain unique (resource-{timestamp}-{random}.ext).
 */
export const migration019: Migration = {
  id: "019_resource_original_filename",
  async upSqlite(db) {
    await addColumn(db, "resources", "original_filename", "TEXT");
  },
  async upPostgres(db) {
    await addColumn(db, "resources", "original_filename", "TEXT");
  },
};
