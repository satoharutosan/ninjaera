import type { ApiMessage } from "@/app/api";

export type ChatMsg = {
  id: number;
  userId?: number;
  user: string;
  msg: string;
  time: string;
  self: boolean;
  avatarUrl?: string | null;
  mediaUrl?: string;
  mediaType?: "image" | "video" | "audio" | "gif" | "file";
  fileName?: string;
  fileSize?: number;
  replyTo?: { id: number; user: string; preview: string };
  edited?: boolean;
  reactions?: Record<string, string[]>;
};

export function toChatMsg(m: ApiMessage, viewerId: number): ChatMsg {
  const isSelf = m.userId === viewerId;
  return {
    id: m.id,
    userId: m.userId,
    user: isSelf ? "You" : m.user,
    msg: m.msg,
    time: m.time,
    self: isSelf,
    avatarUrl: m.avatarUrl,
    mediaUrl: m.mediaUrl,
    mediaType: m.mediaType as ChatMsg["mediaType"],
    fileName: m.fileName,
    fileSize: m.fileSize,
    replyTo: m.replyTo,
    edited: m.edited,
    reactions: m.reactions,
  };
}

export type MessagePageResult = {
  messages: ChatMsg[];
  hasMoreOlder: boolean;
  hasMoreNewer: boolean;
};
