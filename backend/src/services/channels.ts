import { db } from "../db/index.js";

const now = () => new Date().toISOString();

/** Latest message timestamp in a conversation, or null if empty. */
function latestMessageAt(conversationId: number): string | null {
  const row = db.prepare(`
    SELECT created_at FROM messages
    WHERE conversation_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get(conversationId) as { created_at: string } | undefined;
  return row?.created_at ?? null;
}

/**
 * Mark channel history as read for participations that have never been initialized.
 * Existing last_read_at values are preserved. Runs once per user.
 */
export function initializeChannelReadsForUser(userId: number): boolean {
  const row = db.prepare(`
    SELECT channel_reads_initialized FROM users WHERE id = ?
  `).get(userId) as { channel_reads_initialized: number | null } | undefined;
  if (!row || row.channel_reads_initialized === 1) return false;

  const ts = now();
  const channels = db.prepare(`
    SELECT cp.conversation_id as id
    FROM conversation_participants cp
    JOIN conversations c ON c.id = cp.conversation_id
    WHERE cp.user_id = ? AND c.type = 'channel' AND cp.last_read_at IS NULL
  `).all(userId) as { id: number }[];

  const update = db.prepare(`
    UPDATE conversation_participants
    SET last_read_at = ?
    WHERE conversation_id = ? AND user_id = ? AND last_read_at IS NULL
  `);

  const tx = db.transaction(() => {
    for (const ch of channels) {
      update.run(latestMessageAt(ch.id) ?? ts, ch.id, userId);
    }
    db.prepare(`
      UPDATE users SET channel_reads_initialized = 1 WHERE id = ?
    `).run(userId);
  });
  tx();
  return true;
}

/**
 * When adding a user to a channel, treat existing history as already read
 * so they open at the bottom without a historical unread streak.
 */
function insertChannelParticipant(conversationId: number, userId: number, joinedAt: string) {
  const readAt = latestMessageAt(conversationId) ?? joinedAt;
  db.prepare(`
    INSERT OR IGNORE INTO conversation_participants (conversation_id, user_id, joined_at, last_read_at)
    VALUES (?, ?, ?, ?)
  `).run(conversationId, userId, joinedAt, readAt);
}

/** Add user to all public, non-archived channels they are not already in. */
export function syncPublicChannels(userId: number) {
  const ts = now();
  const publicChannels = db.prepare(`
    SELECT id FROM conversations
    WHERE type = 'channel' AND (archived IS NULL OR archived = 0)
    AND (visibility IS NULL OR visibility = 'public')
  `).all() as { id: number }[];

  for (const ch of publicChannels) {
    insertChannelParticipant(ch.id, userId, ts);
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

  for (const u of eligible) {
    insertChannelParticipant(channelId, u.id, ts);
  }
}

/** Add a single user to all private channels (e.g. after team promotion). */
export function syncPrivateChannelsForUser(userId: number) {
  const ts = now();
  const privateChannels = db.prepare(`
    SELECT id FROM conversations
    WHERE type = 'channel' AND visibility = 'private' AND (archived IS NULL OR archived = 0)
  `).all() as { id: number }[];

  for (const ch of privateChannels) {
    insertChannelParticipant(ch.id, userId, ts);
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
