import { db } from "../db/index.js";

const now = () => new Date().toISOString();

/** Add user to all public, non-archived channels they are not already in. */
export function syncPublicChannels(userId: number) {
  const ts = now();
  const publicChannels = db.prepare(`
    SELECT id FROM conversations
    WHERE type = 'channel' AND (archived IS NULL OR archived = 0)
    AND (visibility IS NULL OR visibility = 'public')
  `).all() as { id: number }[];

  const insert = db.prepare(`
    INSERT OR IGNORE INTO conversation_participants (conversation_id, user_id, joined_at)
    VALUES (?, ?, ?)
  `);
  for (const ch of publicChannels) {
    insert.run(ch.id, userId, ts);
  }
}

/** Add team members and admins to a private channel. */
export function syncPrivateChannelParticipants(channelId: number) {
  const ts = now();
  const eligible = db.prepare(`
    SELECT id FROM users
    WHERE is_npc = 0 AND is_deleted = 0 AND is_disabled = 0
    AND (is_team_member = 1 OR is_admin = 1)
  `).all() as { id: number }[];

  const insert = db.prepare(`
    INSERT OR IGNORE INTO conversation_participants (conversation_id, user_id, joined_at)
    VALUES (?, ?, ?)
  `);
  for (const u of eligible) {
    insert.run(channelId, u.id, ts);
  }
}

/** Add a single user to all private channels (e.g. after team promotion). */
export function syncPrivateChannelsForUser(userId: number) {
  const ts = now();
  const privateChannels = db.prepare(`
    SELECT id FROM conversations
    WHERE type = 'channel' AND visibility = 'private' AND (archived IS NULL OR archived = 0)
  `).all() as { id: number }[];

  const insert = db.prepare(`
    INSERT OR IGNORE INTO conversation_participants (conversation_id, user_id, joined_at)
    VALUES (?, ?, ?)
  `);
  for (const ch of privateChannels) {
    insert.run(ch.id, userId, ts);
  }
}

export function userCanAccessChannel(userId: number, channelId: number): boolean {
  const conv = db.prepare("SELECT type, visibility FROM conversations WHERE id = ?").get(channelId) as {
    type: string; visibility: string | null;
  } | undefined;
  if (!conv || conv.type !== "channel") return true;

  const visibility = conv.visibility || "public";
  if (visibility === "public") {
    return !!db.prepare("SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?").get(channelId, userId);
  }

  const user = db.prepare("SELECT is_admin, is_team_member FROM users WHERE id = ?").get(userId) as {
    is_admin: number; is_team_member: number;
  } | undefined;
  if (!user) return false;
  if (user.is_admin === 1 || user.is_team_member === 1) {
    return !!db.prepare("SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?").get(channelId, userId);
  }
  return false;
}
