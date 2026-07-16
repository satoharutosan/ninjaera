import { qGet, qRun } from "../db/query.js";
import { emitMessageToParticipants, emitConversationUpdate, scheduleAdminStatsRefresh } from "./realtime.js";
import { deleteStoredUrl } from "../storage/index.js";

async function refreshConversationLastMessage(convId: number) {
  const last = await qGet<{ content: string; media_type: string | null; file_name: string | null; created_at: string }>(`
    SELECT content, media_type, file_name, created_at
    FROM messages WHERE conversation_id = ?
    ORDER BY created_at DESC, id DESC LIMIT 1
  `, convId);

  let preview = "No messages yet";
  if (last) {
    if (last.media_type === "call_event") preview = last.content || "Call";
    else if (last.content && !last.media_type) preview = last.content.slice(0, 200);
    else if (last.content && last.media_type !== "file") preview = last.content.slice(0, 200);
    else {
      switch (last.media_type) {
        case "image": preview = "Image"; break;
        case "gif": preview = "GIF"; break;
        case "video": preview = "Video"; break;
        case "audio": preview = "Voice message"; break;
        case "file": preview = last.file_name ? last.file_name.slice(0, 200) : "File"; break;
        default: preview = last.content ? last.content.slice(0, 200) : "No messages yet";
      }
    }
  }
  await qRun(`
    UPDATE conversations SET last_message_at = ?, last_message_preview = ? WHERE id = ?
  `, last?.created_at ?? null, preview, convId);
}

/** Delete message media from storage (local disk or cloud) if it belongs to us. */
export async function unlinkMessageMedia(mediaUrl: string | null | undefined) {
  await deleteStoredUrl(mediaUrl);
}

export type MessageRow = {
  id: number;
  conversation_id: number;
  user_id: number;
  content: string;
  media_url: string | null;
  media_type: string | null;
  file_name: string | null;
};

/**
 * Hard-delete a message, cleanup attachment file, notify participants.
 * Caller is responsible for authorization.
 */
export async function hardDeleteMessage(msgId: number): Promise<MessageRow | null> {
  const existing = await qGet<MessageRow>("SELECT * FROM messages WHERE id = ?", msgId);
  if (!existing) return null;

  await unlinkMessageMedia(existing.media_url);
  await qRun("DELETE FROM messages WHERE id = ?", msgId);
  await refreshConversationLastMessage(existing.conversation_id);
  await emitMessageToParticipants(existing.conversation_id, "message:deleted", () => ({
    conversationId: existing.conversation_id,
    messageId: msgId,
  }));
  await emitConversationUpdate(existing.conversation_id);
  scheduleAdminStatsRefresh();
  return existing;
}
