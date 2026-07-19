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

async function backfillChannelOrder(db: DatabaseAdapter): Promise<void> {
  // Stable default: existing id order for channels; DMs keep 0.
  await db.exec(`
    UPDATE conversations
    SET sort_order = id
    WHERE type = 'channel' AND (sort_order IS NULL OR sort_order = 0)
  `);
}

export const migration009: Migration = {
  id: "009_channel_sort_order",
  async upSqlite(db) {
    await addColumn(db, "conversations", "sort_order", "INTEGER NOT NULL DEFAULT 0");
    await backfillChannelOrder(db);
  },
  async upPostgres(db) {
    await addColumn(db, "conversations", "sort_order", "BIGINT NOT NULL DEFAULT 0");
    await backfillChannelOrder(db);
  },
};
