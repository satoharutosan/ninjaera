import { qGet } from "../db/query.js";
import { userCanAccessChannel } from "./channels.js";

export type AccessDenial = { ok: false; status: 403 | 404; error: string };
export type AccessOk = { ok: true };
export type AccessResult = AccessOk | AccessDenial;

/**
 * Central conversation ACL used by send/edit/react/read/mute/call/typing.
 * Requires participant membership AND channel visibility rules.
 */
export async function assertCanAccessConversation(
  userId: number,
  conversationId: number,
): Promise<AccessResult> {
  const convId = Number(conversationId);
  if (!Number.isFinite(convId) || convId <= 0) {
    return { ok: false, status: 404, error: "Conversation not found" };
  }

  const conv = await qGet<{ id: number; type: string }>(
    "SELECT id, type FROM conversations WHERE id = ?",
    convId,
  );
  if (!conv) {
    return { ok: false, status: 404, error: "Conversation not found" };
  }

  const participant = await qGet(
    "SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?",
    convId,
    userId,
  );
  if (!participant) {
    return { ok: false, status: 403, error: "Not a participant of this conversation" };
  }

  if (!(await userCanAccessChannel(userId, convId))) {
    return { ok: false, status: 403, error: "You do not have access to this channel" };
  }

  return { ok: true };
}

/** True when either user has blocked the other. */
export async function usersAreBlocked(a: number, b: number): Promise<boolean> {
  const row = await qGet(
    `SELECT 1 FROM blocks
     WHERE (blocker_id = ? AND blocked_id = ?)
        OR (blocker_id = ? AND blocked_id = ?)
     LIMIT 1`,
    a, b, b, a,
  );
  return Boolean(row);
}

/**
 * For DM conversations, ensure the viewer is not blocked relative to the other participant.
 * Channels always pass (blocks do not apply to public/team channels).
 */
export async function assertNotBlockedInConversation(
  userId: number,
  conversationId: number,
): Promise<AccessResult> {
  const conv = await qGet<{ type: string }>(
    "SELECT type FROM conversations WHERE id = ?",
    conversationId,
  );
  if (!conv || conv.type !== "dm") return { ok: true };

  const other = await qGet<{ user_id: number }>(`
    SELECT user_id FROM conversation_participants
    WHERE conversation_id = ? AND user_id != ?
    LIMIT 1
  `, conversationId, userId);
  if (!other) return { ok: true };

  if (await usersAreBlocked(userId, other.user_id)) {
    return { ok: false, status: 403, error: "You cannot interact with this user" };
  }
  return { ok: true };
}

/**
 * Validate reply-to parent is in the same conversation (closes replyTo IDOR).
 * Returns the sanitized id or null when invalid / missing.
 */
export async function sanitizeReplyToId(
  conversationId: number,
  replyTo: unknown,
): Promise<number | null> {
  if (replyTo == null || replyTo === "") return null;
  const id = Number(replyTo);
  if (!Number.isFinite(id) || id <= 0) return null;

  const parent = await qGet<{ id: number }>(
    "SELECT id FROM messages WHERE id = ? AND conversation_id = ?",
    id,
    conversationId,
  );
  return parent ? parent.id : null;
}

/** True when an accepted DM contact or existing DM conversation already exists. */
export async function canOpenDmWithoutRequest(userId: number, otherUserId: number): Promise<boolean> {
  const contact = await qGet(
    `SELECT 1 FROM dm_contacts
     WHERE (user_id = ? AND contact_user_id = ?) OR (user_id = ? AND contact_user_id = ?)
     LIMIT 1`,
    userId, otherUserId, otherUserId, userId,
  );
  if (contact) return true;

  const accepted = await qGet(
    `SELECT 1 FROM dm_requests
     WHERE status = 'accepted'
       AND ((requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?))
     LIMIT 1`,
    userId, otherUserId, otherUserId, userId,
  );
  return Boolean(accepted);
}
