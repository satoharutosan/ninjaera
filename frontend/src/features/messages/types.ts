import type { ApiMessage } from "@/app/api";
import { DELETED_USER_DISPLAY_NAME, displayUserName } from "@/shared/deletedUser";

export type ChatMsg = {
  id: number;
  userId?: number;
  user: string;
  msg: string;
  time: string;
  self: boolean;
  avatarUrl?: string | null;
  isDeleted?: boolean;
  /** Optimistic local send — negative temp id until server confirms. */
  pending?: boolean;
  failed?: boolean;
  mediaUrl?: string;
  mediaType?: "image" | "video" | "audio" | "gif" | "file" | "call_event";
  fileName?: string;
  fileSize?: number;
  replyTo?: { id: number; user: string; preview: string };
  edited?: boolean;
  reactions?: Record<string, string[]>;
  durationMs?: number;
  duration?: string;
  mimeType?: string;
  codec?: string;
  sampleRate?: number;
  channels?: number;
  waveform?: number[];
};

/** Stable descending temp ids (negative) so they never collide with DB ids. */
let _tempMsgSeq = 0;
export function nextTempMessageId(): number {
  _tempMsgSeq += 1;
  return -_tempMsgSeq;
}

/** Keep real messages ordered by id; pending (temp) rows always at the live edge. */
export function sortChatMessages(msgs: ChatMsg[]): ChatMsg[] {
  const real = msgs.filter(m => m.id > 0).sort((a, b) => a.id - b.id);
  const pending = msgs.filter(m => m.id <= 0);
  return [...real, ...pending];
}

export function toChatMsg(m: ApiMessage, viewerId: number): ChatMsg {
  const isSelf = m.userId === viewerId;
  const isDeleted = !!m.isDeleted;
  return {
    id: m.id,
    userId: m.userId,
    user: isSelf ? "You" : displayUserName(m.user, isDeleted),
    msg: m.msg,
    time: m.time,
    self: isSelf,
    avatarUrl: isDeleted ? null : m.avatarUrl,
    isDeleted,
    mediaUrl: m.mediaUrl,
    mediaType: m.mediaType as ChatMsg["mediaType"],
    fileName: m.fileName,
    fileSize: m.fileSize,
    replyTo: m.replyTo
      ? { ...m.replyTo, user: displayUserName(m.replyTo.user) }
      : undefined,
    edited: m.edited,
    reactions: m.reactions,
    durationMs: m.durationMs,
    duration: m.duration,
    mimeType: m.mimeType,
    codec: m.codec,
    sampleRate: m.sampleRate,
    channels: m.channels,
    waveform: m.waveform,
  };
}

export { DELETED_USER_DISPLAY_NAME };

export type MessagePageResult = {
  messages: ChatMsg[];
  hasMoreOlder: boolean;
  hasMoreNewer: boolean;
};
