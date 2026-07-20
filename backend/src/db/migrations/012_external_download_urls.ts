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
 * External download URLs for Games and App-category Resources.
 * When set, users download directly from the URL (e.g. GitHub Releases);
 * content_url / file_url remain for uploaded storage-backed files.
 */
export const migration012: Migration = {
  id: "012_external_download_urls",
  async upSqlite(db) {
    await addColumn(db, "resources", "external_url", "TEXT");
    await addColumn(db, "game_downloads", "external_url", "TEXT");
  },
  async upPostgres(db) {
    await addColumn(db, "resources", "external_url", "TEXT");
    await addColumn(db, "game_downloads", "external_url", "TEXT");
  },
};
