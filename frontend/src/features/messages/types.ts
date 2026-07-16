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
