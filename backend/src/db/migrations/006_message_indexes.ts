import type { Migration } from "./runner.js";

/**
 * Extra indexes for message send / read / DM peer lookup paths.
 * Core conversation cursor indexes already exist from 001.
 */
const DDL = `
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_conv ON conversation_participants(conversation_id);
CREATE INDEX IF NOT EXISTS idx_users_is_deleted ON users(is_deleted);
`;

export const migration006: Migration = {
  id: "006_message_indexes",
  async upSqlite(db) {
    await db.exec(DDL);
  },
  async upPostgres(db) {
    await db.exec(DDL);
  },
};
