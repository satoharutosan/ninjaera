import { qGet, qAll, qRun, qTransaction } from "../db/query.js";

const now = () => new Date().toISOString();

/** Latest message timestamp in a conversation, or null if empty. */
async function latestMessageAt(conversationId: number): Promise<string | null> {
  const row = await qGet<{ created_at: string }>(`
    SELECT created_at FROM messages
    WHERE conversation_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `, conversationId);
  return row?.created_at ?? null;
}

/**
 * Mark channel history as read for participations that have never been initialized.
 * Existing last_read_at values are preserved. Runs once per user.
 */
export async function initializeChannelReadsForUser(userId: number): Promise<boolean> {
  const row = await qGet<{ channel_reads_initialized: number | null }>(`
    SELECT channel_reads_initialized FROM users WHERE id = ?
  `, userId);
  if (!row || row.channel_reads_initialized === 1) return false;

  const ts = now();
  const channels = await qAll<{ id: number }>(`
    SELECT cp.conversation_id as id
    FROM conversation_participants cp
    JOIN conversations c ON c.id = cp.conversation_id
    WHERE cp.user_id = ? AND c.type = 'channel' AND cp.last_read_at IS NULL
  `, userId);

  await qTransaction(async () => {
    for (const ch of channels) {
      const readAt = (await latestMessageAt(ch.id)) ?? ts;
      await qRun(`
        UPDATE conversation_participants
        SET last_read_at = ?
        WHERE conversation_id = ? AND user_id = ? AND last_read_at IS NULL
      `, readAt, ch.id, userId);
    }
    await qRun(`
      UPDATE users SET channel_reads_initialized = 1 WHERE id = ?
    `, userId);
  });
  return true;
}

/**
 * When adding a user to a channel, treat existing history as already read
 * so they open at the bottom without a historical unread streak.
 */
async function insertChannelParticipant(conversationId: number, userId: number, joinedAt: string) {
  const readAt = (await latestMessageAt(conversationId)) ?? joinedAt;
  await qRun(`
    INSERT OR IGNORE INTO conversation_participants (conversation_id, user_id, joined_at, last_read_at)
    VALUES (?, ?, ?, ?)
  `, conversationId, userId, joinedAt, readAt);
}

/** Add user to all public, non-archived channels they are not already in. */
export async function syncPublicChannels(userId: number) {
  const ts = now();
  const publicChannels = await qAll<{ id: number }>(`
    SELECT id FROM conversations
    WHERE type = 'channel' AND (archived IS NULL OR archived = 0)
    AND (visibility IS NULL OR visibility = 'public')
  `);

  for (const ch of publicChannels) {
    await insertChannelParticipant(ch.id, userId, ts);
  }
}

/** Add team members and admins to a private channel. */
export async function syncPrivateChannelParticipants(channelId: number) {
  const ts = now();
  const eligible = await qAll<{ id: number }>(`
    SELECT id FROM users
    WHERE is_npc = 0 AND is_deleted = 0 AND is_disabled = 0
    AND (is_team_member = 1 OR is_admin = 1)
  `);

  for (const u of eligible) {
    await insertChannelParticipant(channelId, u.id, ts);
  }
}

/**
 * After public→private (or team demotion), remove participants who are no longer eligible.
 * Returns the revoked user ids so callers can force socket leave.
 */
export async function pruneIneligiblePrivateParticipants(channelId: number): Promise<number[]> {
  const conv = await qGet<{ type: string; visibility: string | null }>(
    "SELECT type, visibility FROM conversations WHERE id = ?",
    channelId,
  );
  if (!conv || conv.type !== "channel" || (conv.visibility || "public") !== "private") {
    return [];
  }

  const stale = await qAll<{ user_id: number }>(`
    SELECT cp.user_id
    FROM conversation_participants cp
    JOIN users u ON u.id = cp.user_id
    WHERE cp.conversation_id = ?
      AND NOT (u.is_admin = 1 OR u.is_team_member = 1)
  `, channelId);

  const revoked = stale.map((r) => r.user_id);
  for (const userId of revoked) {
    await qRun(
      "DELETE FROM conversation_participants WHERE conversation_id = ? AND user_id = ?",
      channelId,
      userId,
    );
  }
  return revoked;
}

/** Add a single user to all private channels (e.g. after team promotion). */
export async function syncPrivateChannelsForUser(userId: number) {
  const ts = now();
  const privateChannels = await qAll<{ id: number }>(`
    SELECT id FROM conversations
    WHERE type = 'channel' AND visibility = 'private' AND (archived IS NULL OR archived = 0)
  `);

  for (const ch of privateChannels) {
    await insertChannelParticipant(ch.id, userId, ts);
  }
}

export async function userCanAccessChannel(userId: number, channelId: number): Promise<boolean> {
  const conv = await qGet<{ type: string; visibility: string | null }>(
    "SELECT type, visibility FROM conversations WHERE id = ?", channelId,
  );
  if (!conv || conv.type !== "channel") return true;

  const visibility = conv.visibility || "public";
  if (visibility === "public") {
    return !!(await qGet("SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?", channelId, userId));
  }

  const user = await qGet<{ is_admin: number; is_team_member: number }>(
    "SELECT is_admin, is_team_member FROM users WHERE id = ?", userId,
  );
  if (!user) return false;
  if (user.is_admin === 1 || user.is_team_member === 1) {
    return !!(await qGet("SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?", channelId, userId));
  }
  return false;
}
