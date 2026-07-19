import { qAll, qGet, qRun } from "../db/query.js";
import { usersAreBlocked } from "./conversationAccess.js";
import { emitToUser } from "./realtime.js";

const now = () => new Date().toISOString();

/** Soft-hide a DM from the user's inbox (Delete Contact). History is preserved. */
export async function hideConversationForUser(conversationId: number, userId: number): Promise<void> {
  await qRun(
    `UPDATE conversation_participants
     SET hidden_at = ?
     WHERE conversation_id = ? AND user_id = ?`,
    now(),
    conversationId,
    userId,
  );
}

/** Clear soft-hide for a user on a conversation (e.g. they reopen the DM). */
export async function unhideConversationForUser(conversationId: number, userId: number): Promise<boolean> {
  const before = await qGet(
    `SELECT 1 FROM conversation_participants
     WHERE conversation_id = ? AND user_id = ? AND hidden_at IS NOT NULL`,
    conversationId,
    userId,
  );
  if (!before) return false;
  await qRun(
    `UPDATE conversation_participants
     SET hidden_at = NULL
     WHERE conversation_id = ? AND user_id = ? AND hidden_at IS NOT NULL`,
    conversationId,
    userId,
  );
  return true;
}

/**
 * After a DM message is sent: restore any soft-hidden peers so the conversation
 * reappears in their inbox with full history. Blocking always wins — do not restore.
 * Returns user ids that were restored.
 */
export async function restoreHiddenPeersOnDmMessage(
  conversationId: number,
  senderId: number,
): Promise<number[]> {
  const conv = await qGet<{ type: string }>(
    "SELECT type FROM conversations WHERE id = ?",
    conversationId,
  );
  if (!conv || conv.type !== "dm") return [];

  const hidden = await qAll<{ user_id: number }>(
    `SELECT user_id FROM conversation_participants
     WHERE conversation_id = ? AND hidden_at IS NOT NULL AND user_id != ?`,
    conversationId,
    senderId,
  );

  const restored: number[] = [];
  for (const row of hidden) {
    const peerId = Number(row.user_id);
    if (!Number.isFinite(peerId)) continue;
    if (await usersAreBlocked(senderId, peerId)) continue;
    await qRun(
      `UPDATE conversation_participants
       SET hidden_at = NULL
       WHERE conversation_id = ? AND user_id = ? AND hidden_at IS NOT NULL`,
      conversationId,
      peerId,
    );
    restored.push(peerId);
    emitToUser(peerId, "conversation:restored", { conversationId });
    emitToUser(peerId, "conversation:new", { conversationId });
  }
  return restored;
}
