import { qGet, qRun } from "../db/query.js";
import type { ActiveCall, CallType } from "./calls.js";

export type CallTimelineEvent = "started" | "ended" | "rejected" | "cancelled" | "missed";

export function callEventLabel(type: CallType, event: CallTimelineEvent): string {
  const kind = type === "video" ? "Video" : "Voice";
  switch (event) {
    case "started":
      return `${kind} call started`;
    case "ended":
      return `${kind} call ended`;
    case "rejected":
      return `${kind} call rejected`;
    case "cancelled":
      return `${kind} call cancelled`;
    case "missed":
      return `Missed ${type === "video" ? "video" : "voice"} call`;
    default:
      return `${kind} call`;
  }
}

/** Map hangup/timeout/decline reasons to persisted timeline events. Busy is not persisted. */
export function reasonToTimelineEvent(
  reason: string,
  wasActive: boolean,
): CallTimelineEvent | null {
  if (reason === "busy") return null;
  if (reason === "timeout") return "missed";
  if (reason === "declined") return "rejected";
  if (reason === "cancelled") return "cancelled";
  if (reason === "hangup" || reason === "disconnect") {
    return wasActive ? "ended" : "cancelled";
  }
  return wasActive ? "ended" : "cancelled";
}

/**
 * Persist a completed call lifecycle event as a conversation message.
 * media_type = 'call_event', file_name = event code, content = display label.
 */
export async function insertCallTimelineMessage(
  call: ActiveCall,
  event: CallTimelineEvent,
): Promise<{ id: number; createdAt: string; content: string } | null> {
  const content = callEventLabel(call.type, event);
  const createdAt = new Date().toISOString();
  try {
    const result = await qRun(`
      INSERT INTO messages (conversation_id, user_id, content, media_type, file_name, created_at)
      VALUES (?, ?, ?, 'call_event', ?, ?)
    `, call.conversationId, call.callerId, content, event, createdAt);

    await qRun(`
      UPDATE conversations SET last_message_at = ?, last_message_preview = ? WHERE id = ?
    `, createdAt, content.slice(0, 200), call.conversationId);

    return { id: Number(result.lastInsertRowid), createdAt, content };
  } catch {
    return null;
  }
}

export async function loadMessageRow(messageId: number) {
  return qGet<Record<string, unknown>>(`
    SELECT m.*, u.username, u.avatar_url, u.is_deleted
    FROM messages m LEFT JOIN users u ON u.id = m.user_id
    WHERE m.id = ?
  `, messageId);
}
