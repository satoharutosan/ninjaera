import type { DatabaseAdapter } from "../adapter.js";
import type { Migration } from "./runner.js";

/**
 * Backward-compatibility pass for SQLite databases that were created before
 * this versioned migration system existed (i.e. ones that only ever went
 * through the ad-hoc `initSchema()` + `runMigrations()` in ../migrations.ts).
 *
 * `001_initial_schema` already creates every table with every column for a
 * brand-new database, so on a fresh install everything below is a no-op.
 * On an old database, the tables already exist (so `CREATE TABLE IF NOT
 * EXISTS` in 001 did nothing) and this migration adds whatever columns,
 * indexes, and data backfills they're still missing.
 *
 * PostgreSQL is never "legacy" for this app (it's only reachable through
 * this new dual-database system), so `upPostgres` is a no-op.
 */

const LEGACY_COLUMNS: Array<{ table: string; column: string; definition: string }> = [
  { table: "users", column: "is_admin", definition: "INTEGER DEFAULT 0" },
  { table: "users", column: "is_disabled", definition: "INTEGER DEFAULT 0" },
  { table: "users", column: "is_deleted", definition: "INTEGER DEFAULT 0" },
  { table: "users", column: "is_team_member", definition: "INTEGER DEFAULT 0" },
  { table: "users", column: "is_online", definition: "INTEGER DEFAULT 0" },
  { table: "users", column: "last_seen_at", definition: "TEXT" },
  { table: "users", column: "last_login_at", definition: "TEXT" },
  { table: "users", column: "channel_reads_initialized", definition: "INTEGER DEFAULT 0" },
  { table: "users", column: "email_verified", definition: "INTEGER DEFAULT 1" },
  { table: "users", column: "email_verified_at", definition: "TEXT" },
  { table: "users", column: "token_version", definition: "INTEGER DEFAULT 0" },

  { table: "conversations", column: "archived", definition: "INTEGER DEFAULT 0" },
  { table: "conversations", column: "visibility", definition: "TEXT DEFAULT 'public'" },
  { table: "conversations", column: "moderator_ids", definition: "TEXT DEFAULT '[]'" },
  { table: "conversations", column: "avatar_url", definition: "TEXT" },
  { table: "conversations", column: "last_message_at", definition: "TEXT" },
  { table: "conversations", column: "last_message_preview", definition: "TEXT" },

  { table: "notifications", column: "recipient_type", definition: "TEXT DEFAULT 'everyone'" },
  { table: "notifications", column: "recipient_ids", definition: "TEXT DEFAULT '[]'" },
  { table: "notifications", column: "pinned", definition: "INTEGER DEFAULT 0" },
  { table: "notifications", column: "notif_type", definition: "TEXT DEFAULT 'announcement'" },
  { table: "notifications", column: "metadata", definition: "TEXT DEFAULT '{}'" },
  { table: "notifications", column: "created_by", definition: "INTEGER REFERENCES users(id) ON DELETE SET NULL" },
  { table: "notifications", column: "user_id", definition: "INTEGER REFERENCES users(id) ON DELETE CASCADE" },

  { table: "resources", column: "enabled", definition: "INTEGER DEFAULT 1" },
  { table: "resources", column: "uploader_id", definition: "INTEGER REFERENCES users(id) ON DELETE SET NULL" },
  { table: "resources", column: "file_size", definition: "INTEGER" },
  { table: "resources", column: "version", definition: "TEXT" },
  { table: "resources", column: "sort_order", definition: "INTEGER DEFAULT 0" },
  { table: "resources", column: "visibility", definition: "TEXT DEFAULT 'PUBLIC'" },

  { table: "conversation_participants", column: "last_read_at", definition: "TEXT" },
  { table: "game_stats", column: "global_rank", definition: "INTEGER DEFAULT 0" },
  { table: "team_members", column: "user_id", definition: "INTEGER REFERENCES users(id) ON DELETE CASCADE" },

  { table: "messages", column: "duration_ms", definition: "INTEGER" },
  { table: "messages", column: "media_meta", definition: "TEXT" },

  { table: "contact_tickets", column: "user_id", definition: "INTEGER REFERENCES users(id) ON DELETE SET NULL" },
  { table: "contact_tickets", column: "guest_identifier", definition: "TEXT" },
  { table: "contact_tickets", column: "ip_address", definition: "TEXT" },
  { table: "contact_tickets", column: "country", definition: "TEXT" },
  { table: "contact_tickets", column: "country_code", definition: "TEXT" },
  { table: "contact_tickets", column: "is_read", definition: "INTEGER DEFAULT 0" },
  { table: "contact_tickets", column: "reply_status", definition: "TEXT DEFAULT 'pending'" },
  { table: "contact_tickets", column: "updated_at", definition: "TEXT" },
];

async function columnExists(db: DatabaseAdapter, table: string, column: string): Promise<boolean> {
  const cols = await db.getColumns(table);
  return cols.some((c) => c.name === column);
}

async function addColumn(db: DatabaseAdapter, table: string, column: string, definition: string): Promise<void> {
  if (await columnExists(db, table, column)) return;
  await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

async function addAllLegacyColumns(db: DatabaseAdapter): Promise<void> {
  for (const { table, column, definition } of LEGACY_COLUMNS) {
    await addColumn(db, table, column, definition);
  }
}

/** Store only SHA-256 hashes of reset tokens; rebuild the legacy plaintext-token table if found. */
async function migratePasswordResetTokensToHashed(db: DatabaseAdapter): Promise<void> {
  const cols = await db.getColumns("password_reset_tokens");
  if (cols.length === 0) return;
  const hasTokenHash = cols.some((c) => c.name === "token_hash");
  if (hasTokenHash) {
    await addColumn(db, "password_reset_tokens", "created_at", "TEXT");
    await addColumn(db, "password_reset_tokens", "used_at", "TEXT");
    return;
  }
  // Legacy plaintext `token` primary key — drop outstanding tokens and rebuild securely.
  await db.exec(`
    DROP TABLE IF EXISTS password_reset_tokens;
    CREATE TABLE password_reset_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      used_at TEXT
    );
  `);
  console.log("[migration] Rebuilt password_reset_tokens for hashed single-use tokens");
}

/** Replace the legacy Microsoft OAuth provider with GitHub; unlink any leftover microsoft rows. */
async function migrateOAuthProvidersMicrosoftToGitHub(db: DatabaseAdapter): Promise<void> {
  const table = await db.get<{ sql: string }>(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'user_oauth_providers'`,
  );
  if (!table?.sql) return;

  const needsRebuild = table.sql.includes("'microsoft'") || !table.sql.includes("'github'");
  if (!needsRebuild) {
    const del = await db.run(`DELETE FROM user_oauth_providers WHERE provider = 'microsoft'`);
    if (del.changes > 0) {
      console.log(
        `[migration] Removed ${del.changes} legacy microsoft OAuth link(s); users can re-link via GitHub + matching email`,
      );
    }
    return;
  }

  console.log("[migration] Rebuilding user_oauth_providers for GitHub (replacing Microsoft)");
  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_oauth_providers_github (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL CHECK(provider IN ('google', 'github', 'discord')),
      provider_user_id TEXT NOT NULL,
      linked_at TEXT NOT NULL,
      UNIQUE(provider, provider_user_id),
      UNIQUE(user_id, provider)
    );
  `);

  const rows = await db.all<{ user_id: number; provider: string; provider_user_id: string; linked_at: string }>(
    `SELECT user_id, provider, provider_user_id, linked_at
     FROM user_oauth_providers
     WHERE provider IN ('google', 'github', 'discord')`,
  );

  await db.transaction(async () => {
    for (const r of rows) {
      await db.run(
        `INSERT OR IGNORE INTO user_oauth_providers_github (user_id, provider, provider_user_id, linked_at)
         VALUES (?, ?, ?, ?)`,
        r.user_id,
        r.provider,
        r.provider_user_id,
        r.linked_at,
      );
    }
  });

  const removed = await db.get<{ c: number }>(
    `SELECT COUNT(*) as c FROM user_oauth_providers WHERE provider = 'microsoft'`,
  );
  await db.exec(`
    DROP TABLE user_oauth_providers;
    ALTER TABLE user_oauth_providers_github RENAME TO user_oauth_providers;
    CREATE INDEX IF NOT EXISTS idx_oauth_providers_user ON user_oauth_providers(user_id);
    CREATE INDEX IF NOT EXISTS idx_oauth_providers_lookup ON user_oauth_providers(provider, provider_user_id);
  `);
  await db.run(`DELETE FROM oauth_states WHERE provider = 'microsoft'`);

  if (removed && removed.c > 0) {
    console.log(
      `[migration] Dropped ${removed.c} microsoft OAuth link(s); user accounts preserved (re-auth via GitHub with same email)`,
    );
  }
}

/** Resolve any case-insensitive username collisions before the unique LOWER(username) index is created. */
async function ensureCaseInsensitiveUsernameUniqueness(db: DatabaseAdapter): Promise<void> {
  const duplicateKeys = await db.all<{ lu: string; c: number }>(`
    SELECT LOWER(username) AS lu, COUNT(*) AS c
    FROM users
    GROUP BY LOWER(username)
    HAVING c > 1
  `);
  if (duplicateKeys.length === 0) return;

  console.warn(
    `[migration] Found ${duplicateKeys.length} case-insensitive username conflict group(s). Resolving by renaming later accounts (keeping lowest id).`,
  );
  const ts = new Date().toISOString();

  for (const group of duplicateKeys) {
    const rows = await db.all<{ id: number; username: string }>(
      `SELECT id, username FROM users WHERE LOWER(username) = ? ORDER BY id ASC`,
      group.lu,
    );
    const keeper = rows[0];
    if (!keeper) continue;
    console.warn(
      `[migration] Conflict LOWER="${group.lu}": keeping id=${keeper.id} (${keeper.username}), renaming ${rows.length - 1} other(s)`,
    );
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]!;
      let candidate = `${row.username.replace(/[^A-Za-z0-9_]/g, "_")}_${row.id}`
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "");
      if (!candidate || !/^[A-Za-z0-9_]+$/.test(candidate)) candidate = `user_${row.id}`;
      candidate = candidate.slice(0, 32);
      let n = 0;
      while (await db.get(`SELECT 1 FROM users WHERE LOWER(username) = LOWER(?) AND id != ?`, candidate, row.id)) {
        n += 1;
        candidate = `user_${row.id}_${n}`.slice(0, 32);
      }
      await db.run(`UPDATE users SET username = ?, updated_at = ? WHERE id = ?`, candidate, ts, row.id);
      console.warn(
        `[migration] Renamed user id=${row.id} username "${row.username}" -> "${candidate}" (duplicate of "${keeper.username}")`,
      );
    }
  }
}

/** Backfill denormalized conversations.last_message_at / last_message_preview once, where still null. */
async function backfillConversationLastMessage(db: DatabaseAdapter): Promise<void> {
  const needsBackfill = await db.get(`SELECT id FROM conversations WHERE last_message_at IS NULL LIMIT 1`);
  if (!needsBackfill) return;

  const convs = await db.all<{ id: number }>(`SELECT id FROM conversations`);
  await db.transaction(async () => {
    for (const { id } of convs) {
      const last = await db.get<{
        content: string;
        media_type: string | null;
        file_name: string | null;
        created_at: string;
      }>(
        `SELECT content, media_type, file_name, created_at
         FROM messages WHERE conversation_id = ?
         ORDER BY created_at DESC, id DESC LIMIT 1`,
        id,
      );
      if (!last) continue;
      let preview = last.content || "";
      if (!preview) {
        switch (last.media_type) {
          case "image": preview = "Image"; break;
          case "gif": preview = "GIF"; break;
          case "video": preview = "Video"; break;
          case "audio": preview = "Voice message"; break;
          case "file": preview = last.file_name ? last.file_name : "File"; break;
          default: preview = "No messages yet";
        }
      }
      await db.run(
        `UPDATE conversations SET last_message_at = ?, last_message_preview = ? WHERE id = ?`,
        last.created_at,
        preview.slice(0, 200),
        id,
      );
    }
  });
}

/** Backfill global_rank for users missing it (1200 + registration order). */
async function backfillGlobalRank(db: DatabaseAdapter): Promise<void> {
  const missingRank = await db.all<{ id: number }>(`
    SELECT u.id FROM users u
    LEFT JOIN game_stats g ON g.user_id = u.id
    WHERE u.is_npc = 0 AND (g.global_rank IS NULL OR g.global_rank = 0)
  `);
  for (const { id } of missingRank) {
    const order = await db.get<{ c: number }>(`SELECT COUNT(*) as c FROM users WHERE is_npc = 0 AND id <= ?`, id);
    await db.run(
      `INSERT INTO game_stats (user_id, global_rank) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET global_rank = excluded.global_rank`,
      id,
      1200 + (order?.c ?? 0),
    );
  }
}

/** Migrate resource categories to App / Guide / Design / Character Art / Source. */
async function migrateResourceCategories(db: DatabaseAdapter): Promise<void> {
  const categoryMigrations: [string, string][] = [
    ["Guides", "App"],
    ["Wiki", "Guide"],
    ["Downloads", "Design"],
    ["Patch Notes", "Character Art"],
    ["Media", "Source"],
  ];
  for (const [from, to] of categoryMigrations) {
    const result = await db.run(`UPDATE resources SET category = ? WHERE category = ?`, to, from);
    if (result.changes > 0) {
      console.log(`[migration] Migrated ${result.changes} resource(s) from category "${from}" -> "${to}"`);
    }
  }
}

/** Existing accounts created before email verification shipped are treated as verified. */
async function backfillEmailVerification(db: DatabaseAdapter): Promise<void> {
  await db.run(`
    UPDATE users SET email_verified_at = COALESCE(email_verified_at, created_at)
    WHERE email_verified = 1 AND email_verified_at IS NULL
  `);
  await db.run(`DELETE FROM pending_registrations WHERE expires_at < ?`, new Date().toISOString());
}

/**
 * OAuth registrations used to store a random unusable bcrypt hash. Clear it
 * (password_hash = '') for accounts that registered via a provider and never
 * set/changed/reset a password, so the Profile page can offer first-time
 * password creation.
 */
async function clearPlaceholderPasswordsForOAuthUsers(db: DatabaseAdapter): Promise<void> {
  const hasActivityLogs = await db.tableExists("activity_logs");
  if (!hasActivityLogs) return;

  const result = await db.run(`
    UPDATE users SET password_hash = ''
    WHERE password_hash != ''
      AND id IN (SELECT user_id FROM user_oauth_providers)
      AND id IN (
        SELECT user_id FROM activity_logs
        WHERE event_type = 'register' AND description LIKE 'User registered via %'
      )
      AND id NOT IN (
        SELECT user_id FROM activity_logs
        WHERE event_type IN ('password_changed', 'password_created', 'password_reset_completed')
          AND user_id IS NOT NULL
      )
  `);
  if (result.changes > 0) {
    console.log(`[migration] Cleared placeholder password hashes for ${result.changes} OAuth-registered account(s)`);
  }
}

export const migration002: Migration = {
  id: "002_legacy_columns",

  async upSqlite(db) {
    await addAllLegacyColumns(db);

    await migratePasswordResetTokensToHashed(db);
    await migrateOAuthProvidersMicrosoftToGitHub(db);

    // These indexes cover columns that are additive on tables that may already
    // have existed before 001 ran; now that addAllLegacyColumns() guarantees
    // the columns exist, it's safe to create them.
    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
      CREATE INDEX IF NOT EXISTS idx_users_admin ON users(is_admin);
      CREATE INDEX IF NOT EXISTS idx_users_npc_deleted ON users(is_npc, is_deleted);
      CREATE INDEX IF NOT EXISTS idx_contact_tickets_read ON contact_tickets(is_read);
      CREATE INDEX IF NOT EXISTS idx_contact_tickets_reply ON contact_tickets(reply_status);
      CREATE INDEX IF NOT EXISTS idx_resources_enabled_sort ON resources(enabled, sort_order, published_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_type_archived ON conversations(type, archived);
    `);

    await ensureCaseInsensitiveUsernameUniqueness(db);
    await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users(LOWER(username))`);

    await backfillConversationLastMessage(db);
    await backfillGlobalRank(db);
    await migrateResourceCategories(db);
    await backfillEmailVerification(db);
    await clearPlaceholderPasswordsForOAuthUsers(db);
  },

  async upPostgres(_db) {
    // 001_initial_schema already creates the complete final schema (all
    // columns, all indexes) for PostgreSQL. There is no pre-existing legacy
    // PostgreSQL data for this app, so there is nothing to backfill here.
  },
};
