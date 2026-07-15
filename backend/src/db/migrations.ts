import { db } from "./index.js";

function columnExists(table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some(c => c.name === column);
}

function addColumn(table: string, column: string, definition: string) {
  if (!columnExists(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function runMigrations() {
  addColumn("users", "is_admin", "INTEGER DEFAULT 0");
  addColumn("users", "is_disabled", "INTEGER DEFAULT 0");
  addColumn("users", "is_deleted", "INTEGER DEFAULT 0");
  addColumn("users", "is_team_member", "INTEGER DEFAULT 0");

  addColumn("conversations", "archived", "INTEGER DEFAULT 0");
  addColumn("conversations", "visibility", "TEXT DEFAULT 'public'");
  addColumn("conversations", "moderator_ids", "TEXT DEFAULT '[]'");

  addColumn("notifications", "recipient_type", "TEXT DEFAULT 'everyone'");
  addColumn("notifications", "recipient_ids", "TEXT DEFAULT '[]'");
  addColumn("notifications", "pinned", "INTEGER DEFAULT 0");
  addColumn("notifications", "notif_type", "TEXT DEFAULT 'announcement'");
  addColumn("notifications", "metadata", "TEXT DEFAULT '{}'");
  addColumn("notifications", "created_by", "INTEGER REFERENCES users(id) ON DELETE SET NULL");
  addColumn("notifications", "user_id", "INTEGER REFERENCES users(id) ON DELETE CASCADE");

  addColumn("resources", "enabled", "INTEGER DEFAULT 1");
  addColumn("resources", "uploader_id", "INTEGER REFERENCES users(id) ON DELETE SET NULL");
  addColumn("resources", "file_size", "INTEGER");
  addColumn("resources", "version", "TEXT");
  addColumn("resources", "sort_order", "INTEGER DEFAULT 0");

  addColumn("users", "is_online", "INTEGER DEFAULT 0");
  addColumn("users", "last_seen_at", "TEXT");
  addColumn("users", "last_login_at", "TEXT");

  addColumn("conversation_participants", "last_read_at", "TEXT");
  /** One-time: user has baselined channel last-read to newest historical messages. */
  addColumn("users", "channel_reads_initialized", "INTEGER DEFAULT 0");
  addColumn("game_stats", "global_rank", "INTEGER DEFAULT 0");
  addColumn("team_members", "user_id", "INTEGER REFERENCES users(id) ON DELETE CASCADE");

  addColumn("contact_tickets", "user_id", "INTEGER REFERENCES users(id) ON DELETE SET NULL");
  addColumn("contact_tickets", "guest_identifier", "TEXT");
  addColumn("contact_tickets", "ip_address", "TEXT");
  addColumn("contact_tickets", "country", "TEXT");
  addColumn("contact_tickets", "country_code", "TEXT");
  addColumn("contact_tickets", "is_read", "INTEGER DEFAULT 0");
  addColumn("contact_tickets", "reply_status", "TEXT DEFAULT 'pending'");
  addColumn("contact_tickets", "updated_at", "TEXT");

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_locations (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      ip_address TEXT,
      country_code TEXT,
      country_name TEXT,
      is_vpn INTEGER DEFAULT 0,
      vpn_ip TEXT,
      vpn_country_code TEXT,
      vpn_country_name TEXT,
      origin_ip TEXT,
      origin_country_code TEXT,
      origin_country_name TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dm_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected')),
      conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(requester_id, recipient_id)
    );

    CREATE TABLE IF NOT EXISTS dm_contacts (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      contact_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, contact_user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_dm_requests_recipient ON dm_requests(recipient_id, status);
    CREATE INDEX IF NOT EXISTS idx_dm_requests_requester ON dm_requests(requester_id, status);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_users_admin ON users(is_admin);
    CREATE INDEX IF NOT EXISTS idx_job_applications_status ON job_applications(status);

    CREATE TABLE IF NOT EXISTS game_downloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL CHECK(platform IN ('windows', 'android', 'ios')),
      version TEXT NOT NULL,
      release_notes TEXT DEFAULT '',
      file_url TEXT,
      file_size INTEGER,
      published INTEGER DEFAULT 0,
      published_at TEXT,
      uploader_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      username TEXT,
      display_name TEXT,
      user_role TEXT DEFAULT 'guest',
      event_type TEXT NOT NULL,
      event_category TEXT NOT NULL,
      description TEXT NOT NULL,
      affected_object TEXT,
      request_path TEXT,
      http_method TEXT,
      user_agent TEXT,
      browser TEXT,
      os TEXT,
      device_type TEXT,
      session_id TEXT,
      ip_address TEXT,
      country TEXT,
      country_code TEXT,
      is_vpn INTEGER,
      result TEXT DEFAULT 'success',
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_activity_logs_timestamp ON activity_logs(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON activity_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_activity_logs_category ON activity_logs(event_category);
    CREATE INDEX IF NOT EXISTS idx_activity_logs_event ON activity_logs(event_type);
    CREATE INDEX IF NOT EXISTS idx_game_downloads_platform ON game_downloads(platform, published);

    CREATE TABLE IF NOT EXISTS contact_replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES contact_tickets(id) ON DELETE CASCADE,
      admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_contact_tickets_read ON contact_tickets(is_read);
    CREATE INDEX IF NOT EXISTS idx_contact_tickets_reply ON contact_tickets(reply_status);

    CREATE TABLE IF NOT EXISTS user_oauth_providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL CHECK(provider IN ('google', 'microsoft', 'discord')),
      provider_user_id TEXT NOT NULL,
      linked_at TEXT NOT NULL,
      UNIQUE(provider, provider_user_id),
      UNIQUE(user_id, provider)
    );

    CREATE INDEX IF NOT EXISTS idx_oauth_providers_user ON user_oauth_providers(user_id);
    CREATE INDEX IF NOT EXISTS idx_oauth_providers_lookup ON user_oauth_providers(provider, provider_user_id);

    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_conversation_participants_user
      ON conversation_participants(user_id);
    CREATE INDEX IF NOT EXISTS idx_notification_reads_notif
      ON notification_reads(notification_id);
    CREATE INDEX IF NOT EXISTS idx_contact_replies_ticket
      ON contact_replies(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_resources_enabled_sort
      ON resources(enabled, sort_order, published_at);
    CREATE INDEX IF NOT EXISTS idx_conversations_type_archived
      ON conversations(type, archived);
    CREATE INDEX IF NOT EXISTS idx_users_npc_deleted
      ON users(is_npc, is_deleted);
  `);

  addColumn("conversations", "last_message_at", "TEXT");
  addColumn("conversations", "last_message_preview", "TEXT");

  // Backfill denormalized last-message fields once (only where still null)
  const needsBackfill = db.prepare(`
    SELECT id FROM conversations WHERE last_message_at IS NULL LIMIT 1
  `).get();
  if (needsBackfill) {
    const convs = db.prepare("SELECT id FROM conversations").all() as { id: number }[];
    const lastMsg = db.prepare(`
      SELECT content, media_type, file_name, created_at
      FROM messages WHERE conversation_id = ?
      ORDER BY created_at DESC, id DESC LIMIT 1
    `);
    const updateConv = db.prepare(`
      UPDATE conversations SET last_message_at = ?, last_message_preview = ? WHERE id = ?
    `);
    const tx = db.transaction(() => {
      for (const { id } of convs) {
        const last = lastMsg.get(id) as {
          content: string; media_type: string | null; file_name: string | null; created_at: string;
        } | undefined;
        if (!last) continue;
        let preview = last.content || "";
        if (!preview) {
          switch (last.media_type) {
            case "image": preview = "📷 Image"; break;
            case "gif": preview = "GIF"; break;
            case "video": preview = "🎬 Video"; break;
            case "audio": preview = "🎤 Voice message"; break;
            case "file": preview = last.file_name ? `📎 ${last.file_name}` : "📎 File"; break;
            default: preview = "No messages yet";
          }
        }
        updateConv.run(last.created_at, preview.slice(0, 200), id);
      }
    });
    tx();
  }

  // Ensure demo admin account
  db.prepare("UPDATE users SET is_admin = 1 WHERE email = ?").run("ninja@example.com");

  // Remove seeded placeholder team members (not linked to real users)
  db.prepare("DELETE FROM team_members WHERE user_id IS NULL").run();

  // Ensure approved team users appear in Meet the Team
  const teamUsers = db.prepare(`
    SELECT id, username, country, city FROM users
    WHERE is_team_member = 1 AND is_deleted = 0 AND is_npc = 0
  `).all() as { id: number; username: string; country: string; city: string | null }[];
  for (const u of teamUsers) {
    const exists = db.prepare("SELECT id FROM team_members WHERE user_id = ?").get(u.id);
    if (!exists) {
      const maxOrder = (db.prepare("SELECT MAX(sort_order) as m FROM team_members").get() as { m: number | null }).m || 0;
      db.prepare(`
        INSERT INTO team_members (name, role, department, country, city, status_label, status_color, sort_order, user_id)
        VALUES (?, 'Team Member', 'General', ?, ?, 'Active', '#386A20', ?, ?)
      `).run(u.username, u.country || "Japan", u.city || "Tokyo", maxOrder + 1, u.id);
    }
  }

  // Backfill global_rank for users missing it (1200 + registration order)
  const missingRank = db.prepare(`
    SELECT u.id FROM users u
    LEFT JOIN game_stats g ON g.user_id = u.id
    WHERE u.is_npc = 0 AND (g.global_rank IS NULL OR g.global_rank = 0)
  `).all() as { id: number }[];
  for (const { id } of missingRank) {
    const order = (db.prepare(`
      SELECT COUNT(*) as c FROM users
      WHERE is_npc = 0 AND id <= ?
    `).get(id) as { c: number }).c;
    db.prepare(`
      INSERT INTO game_stats (user_id, global_rank) VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET global_rank = excluded.global_rank
    `).run(id, 1200 + order);
  }
}
