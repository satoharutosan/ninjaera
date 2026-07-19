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
 * Soft-hide for "Delete Contact": removes a DM from the user's list without
 * destroying conversation membership or message history. Cleared when the peer
 * messages again (unless a block is in effect).
 */
export const migration011: Migration = {
  id: "011_participant_hidden_at",
  async upSqlite(db) {
    await addColumn(db, "conversation_participants", "hidden_at", "TEXT");
  },
  async upPostgres(db) {
    await addColumn(db, "conversation_participants", "hidden_at", "TEXT");
  },
};
