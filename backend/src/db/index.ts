import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "../../data");
export const dbPath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(dataDir, "ninja-era.db");

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(dbPath);
export const dataDirectory = dataDir;

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      avatar_url TEXT,
      gender TEXT DEFAULT 'Prefer not to say',
      date_of_birth TEXT,
      country TEXT DEFAULT 'Japan',
      city TEXT,
      status TEXT DEFAULT 'Online',
      bio TEXT DEFAULT '',
      member_since TEXT NOT NULL,
      village TEXT DEFAULT 'Leaf Village',
      clan TEXT DEFAULT 'Dragon Clan',
      level INTEGER DEFAULT 1,
      rank TEXT DEFAULT 'Genin',
      is_npc INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      email_notif INTEGER DEFAULT 1,
      push_notif INTEGER DEFAULT 0,
      two_fa INTEGER DEFAULT 0,
      public_profile INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS game_stats (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      missions_complete INTEGER DEFAULT 0,
      pvp_wins INTEGER DEFAULT 0,
      playtime_hours INTEGER DEFAULT 0,
      legendary_items INTEGER DEFAULT 0,
      ninjutsu INTEGER DEFAULT 0,
      taijutsu INTEGER DEFAULT 0,
      genjutsu INTEGER DEFAULT 0,
      senjutsu INTEGER DEFAULT 0,
      kenjutsu INTEGER DEFAULT 0,
      global_rank INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS achievements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      icon TEXT DEFAULT 'star',
      earned_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      rarity TEXT DEFAULT 'common',
      quantity INTEGER DEFAULT 1,
      icon TEXT DEFAULT 'diamond'
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      source TEXT DEFAULT 'Operations',
      page TEXT DEFAULT 'alarms',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_reads (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
      read_at TEXT NOT NULL,
      PRIMARY KEY (user_id, notification_id)
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('channel', 'dm')),
      name TEXT NOT NULL,
      bio TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversation_participants (
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      muted INTEGER DEFAULT 0,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (conversation_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT DEFAULT '',
      media_url TEXT,
      media_type TEXT,
      file_name TEXT,
      file_size INTEGER,
      reply_to_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
      edited_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS message_reactions (
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (message_id, emoji, user_id)
    );

    CREATE TABLE IF NOT EXISTS blocks (
      blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (blocker_id, blocked_id)
    );

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reported_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
      reason TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contact_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      subject TEXT NOT NULL,
      category TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS newsletter_subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      subscribed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS job_postings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      department TEXT NOT NULL,
      employment_type TEXT NOT NULL,
      description TEXT DEFAULT '',
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS job_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      full_name TEXT NOT NULL,
      gender TEXT,
      date_of_birth TEXT,
      country TEXT,
      city TEXT,
      photo_url TEXT,
      cv_url TEXT,
      portfolio_url TEXT,
      message TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      department TEXT NOT NULL,
      country TEXT NOT NULL,
      city TEXT NOT NULL,
      status_label TEXT,
      status_color TEXT,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT DEFAULT '',
      content_url TEXT,
      published_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      village TEXT NOT NULL,
      role TEXT NOT NULL,
      rarity TEXT NOT NULL,
      clan TEXT NOT NULL,
      color TEXT NOT NULL,
      image_url TEXT,
      bio TEXT DEFAULT '',
      stats_atk INTEGER DEFAULT 0,
      stats_def INTEGER DEFAULT 0,
      stats_spd INTEGER DEFAULT 0,
      stats_mgk INTEGER DEFAULT 0,
      abilities TEXT DEFAULT '[]',
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_cursor ON messages(conversation_id, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
  `);
}

export type UserRow = {
  id: number;
  email: string;
  username: string;
  password_hash: string;
  avatar_url: string | null;
  gender: string;
  date_of_birth: string | null;
  country: string;
  city: string | null;
  status: string;
  bio: string;
  member_since: string;
  village: string;
  clan: string;
  level: number;
  rank: string;
  is_npc: number;
  created_at: string;
  updated_at: string;
};
