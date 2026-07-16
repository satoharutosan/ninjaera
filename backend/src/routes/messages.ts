import { Router } from "express";
import multer from "multer";
import { qGet, qAll, qRun } from "../db/query.js";
import { requireAuth, timeAgo, formatTime } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { isAdmin } from "../middleware/admin.js";
import { isUserOnline } from "../services/presence.js";
import { initializeChannelReadsForUser, userCanAccessChannel } from "../services/channels.js";
import {
  emitMessageToParticipants, emitConversationUpdate, emitToUser, scheduleAdminStatsRefresh,
} from "../services/realtime.js";
import { formatDurationLabel, parseMediaMeta, sanitizeVoiceMeta } from "../services/mediaMeta.js";
import { hardDeleteMessage } from "../services/messageModeration.js";
import { logActivitySync } from "../services/activityLog.js";
import { createAdminSystemNotification } from "../services/adminNotifications.js";
import { MESSAGE_MAX_FILE_BYTES, MESSAGE_MAX_FILE_ERROR } from "../services/messageUpload.js";
import { tombstoneSenderFields, DELETED_USER_DISPLAY_NAME, isDeletedUser } from "../services/deletedUser.js";
import { createMemoryUploader, persistMulterFile } from "../storage/multerUpload.js";
import {
  assertCanAccessConversation,
  assertNotBlockedInConversation,
  canOpenDmWithoutRequest,
  sanitizeReplyToId,
  usersAreBlocked,
} from "../services/conversationAccess.js";
import { validateUpload } from "../services/uploadValidation.js";

const router = Router();
const now = () => new Date().toISOString();

async function requireConversationAccess(
  req: import("express").Request,
  res: import("express").Response,
  conversationId: number,
): Promise<boolean> {
  const access = await assertCanAccessConversation(req.user!.id, conversationId);
  if (!access.ok) {
    res.status(access.status).json({ error: access.error });
    return false;
  }
  const blocked = await assertNotBlockedInConversation(req.user!.id, conversationId);
  if (!blocked.ok) {
    res.status(blocked.status).json({ error: blocked.error });
    return false;
  }
  return true;
}

const upload = createMemoryUploader({ limits: { fileSize: MESSAGE_MAX_FILE_BYTES } });

/** Multer wrapper with a clear 50MB rejection message for Messages uploads. */
function uploadMessageFile(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) {
  upload.single("file")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: MESSAGE_MAX_FILE_ERROR });
      return;
    }
    if (err) {
      next(err);
      return;
    }
    if (req.file && req.file.size > MESSAGE_MAX_FILE_BYTES) {
      res.status(413).json({ error: MESSAGE_MAX_FILE_ERROR });
      return;
    }
    next();
  });
}

async function getLastMessage(convId: number) {
  return qGet<{ content: string; created_at: string; media_type?: string | null; file_name?: string | null }>(`
    SELECT m.*, u.username
    FROM messages m LEFT JOIN users u ON u.id = m.user_id
    WHERE m.conversation_id = ?
    ORDER BY m.created_at DESC, m.id DESC LIMIT 1
  `, convId);
}

function previewFromMessage(last: { content: string; media_type?: string | null; file_name?: string | null } | undefined) {
  if (!last) return "No messages yet";
  if (last.media_type === "call_event") return last.content || "Call";
  if (last.content && !last.media_type) return last.content.slice(0, 200);
  if (last.content && last.media_type !== "file") return last.content.slice(0, 200);
  switch (last.media_type) {
    case "image": return "Image";
    case "gif": return "GIF";
    case "video": return "Video";
    case "audio": return "Voice message";
    case "file": return last.file_name ? last.file_name.slice(0, 200) : "File";
    default: return last.content ? last.content.slice(0, 200) : "No messages yet";
  }
}

function previewKindFromMessage(last: { media_type?: string | null; content?: string | null } | undefined): string | null {
  if (!last) return null;
  if (last.media_type === "call_event") return "call";
  if (last.media_type) return last.media_type;
  if (last.content) return "text";
  return null;
}

async function touchConversationLastMessage(
  convId: number,
  createdAt: string,
  preview: string,
) {
  const conv = await qGet<{ type: string }>("SELECT type FROM conversations WHERE id = ?", convId);
  // Channels: update ordering timestamp only — skip preview text to reduce write + client churn.
  if (conv?.type === "channel") {
    await qRun(`
      UPDATE conversations SET last_message_at = ?, last_message_preview = NULL WHERE id = ?
    `, createdAt, convId);
    return;
  }
  await qRun(`
    UPDATE conversations SET last_message_at = ?, last_message_preview = ? WHERE id = ?
  `, createdAt, preview.slice(0, 200), convId);
}

async function refreshConversationLastMessage(convId: number) {
  const last = await getLastMessage(convId);
  if (!last) {
    await qRun(`
      UPDATE conversations SET last_message_at = NULL, last_message_preview = NULL WHERE id = ?
    `, convId);
    return;
  }
  await touchConversationLastMessage(convId, last.created_at, previewFromMessage(last));
}

async function unreadCount(convId: number, userId: number) {
  const part = await qGet<{ last_read_at: string | null }>(`
    SELECT last_read_at FROM conversation_participants
    WHERE conversation_id = ? AND user_id = ?
  `, convId, userId);

  if (part?.last_read_at) {
    const row = await qGet<{ c: number }>(`
      SELECT COUNT(*) as c FROM messages
      WHERE conversation_id = ? AND user_id != ? AND created_at > ?
    `, convId, userId, part.last_read_at);
    return row?.c ?? 0;
  }

  const row = await qGet<{ c: number }>(`
    SELECT COUNT(*) as c FROM messages
    WHERE conversation_id = ? AND user_id != ?
  `, convId, userId);
  return row?.c ?? 0;
}

async function markConversationRead(convId: number, userId: number) {
  const ts = now();
  await qRun(`
    UPDATE conversation_participants SET last_read_at = ?
    WHERE conversation_id = ? AND user_id = ?
  `, ts, convId, userId);
}

type FormattedMessage = {
  id: number;
  userId: number;
  user: string;
  msg: string;
  time: string;
  self: boolean;
  avatarUrl?: string | null;
  isDeleted?: boolean;
  mediaUrl?: string;
  mediaType?: string;
  fileName?: string;
  fileSize?: number;
  replyTo?: { id: number; user: string; preview: string };
  edited: boolean;
  reactions?: Record<string, string[]>;
  /** Voice / media duration in milliseconds (set at upload). */
  durationMs?: number;
  /** Preformatted mm:ss for UI. */
  duration?: string;
  mimeType?: string;
  codec?: string;
  sampleRate?: number;
  channels?: number;
  waveform?: number[];
};

async function formatMessages(rows: Record<string, unknown>[], currentUserId: number): Promise<FormattedMessage[]> {
  if (!rows.length) return [];

  const ids = rows.map(r => r.id as number);
  const placeholders = ids.map(() => "?").join(",");

  const reactionRows = await qAll<{ message_id: number; emoji: string; user_id: number }>(`
    SELECT message_id, emoji, user_id FROM message_reactions
    WHERE message_id IN (${placeholders})
  `, ...ids);

  const reactionsByMsg = new Map<number, Record<string, string[]>>();
  for (const r of reactionRows) {
    let map = reactionsByMsg.get(r.message_id);
    if (!map) {
      map = {};
      reactionsByMsg.set(r.message_id, map);
    }
    if (!map[r.emoji]) map[r.emoji] = [];
    map[r.emoji].push(String(r.user_id));
  }

  const replyIds = [...new Set(
    rows.map(r => r.reply_to_id as number | null | undefined).filter((id): id is number => id != null),
  )];
  const parentsById = new Map<number, { id: number; username: string; content: string; conversation_id: number }>();
  if (replyIds.length) {
    const rp = replyIds.map(() => "?").join(",");
    const parents = await qAll<{ id: number; username: string | null; is_deleted: number | null; content: string; conversation_id: number }>(`
      SELECT m.id, m.conversation_id, u.username, u.is_deleted, m.content FROM messages m
      LEFT JOIN users u ON u.id = m.user_id WHERE m.id IN (${rp})
    `, ...replyIds);
    for (const p of parents) {
      const sender = tombstoneSenderFields(p);
      parentsById.set(p.id, {
        id: p.id,
        username: sender.username,
        content: p.content || "",
        conversation_id: p.conversation_id,
      });
    }
  }

  return rows.map(msg => {
    const reactionMap = reactionsByMsg.get(msg.id as number);
    let replyTo: FormattedMessage["replyTo"];
    const replyId = msg.reply_to_id as number | null | undefined;
    if (replyId != null) {
      const parent = parentsById.get(replyId);
      // Only expose reply previews from the same conversation (closes cross-thread IDOR in UI).
      if (parent && parent.conversation_id === (msg.conversation_id as number)) {
        replyTo = { id: parent.id, user: parent.username, preview: (parent.content || "").slice(0, 80) };
      }
    }
    const durationMs = typeof msg.duration_ms === "number" && msg.duration_ms > 0
      ? (msg.duration_ms as number)
      : undefined;
    const meta = parseMediaMeta(msg.media_meta);
    const sender = tombstoneSenderFields({
      username: msg.username as string | null,
      avatar_url: msg.avatar_url as string | null,
      is_deleted: msg.is_deleted as number | null,
    });
    return {
      id: msg.id as number,
      userId: msg.user_id as number,
      user: sender.username,
      msg: msg.content as string,
      time: formatTime(msg.created_at as string),
      self: msg.user_id === currentUserId,
      avatarUrl: sender.avatar_url,
      isDeleted: sender.isDeleted,
      mediaUrl: (msg.media_url as string | null) || undefined,
      mediaType: (msg.media_type as string | null) || undefined,
      fileName: (msg.file_name as string | null) || undefined,
      fileSize: (msg.file_size as number | null) || undefined,
      replyTo,
      edited: !!msg.edited_at,
      reactions: reactionMap && Object.keys(reactionMap).length ? reactionMap : undefined,
      durationMs,
      duration: durationMs != null ? formatDurationLabel(durationMs) : undefined,
      mimeType: meta?.mimeType,
      codec: meta?.codec,
      sampleRate: meta?.sampleRate,
      channels: meta?.channels,
      waveform: meta?.waveform,
    };
  });
}

async function formatMessage(msg: Record<string, unknown>, currentUserId: number): Promise<FormattedMessage> {
  return (await formatMessages([msg], currentUserId))[0];
}

/** Format once, then flip `self` per viewer for realtime fan-out. */
async function formatMessageForViewers(msg: Record<string, unknown>, authorId: number) {
  const base = await formatMessage(msg, authorId);
  return (viewerId: number) => ({
    ...base,
    self: authorId === viewerId,
  });
}

async function formatConversations(
  convs: {
    id: number; type: string; name: string; bio: string;
    avatar_url?: string | null; created_at?: string | null;
    last_message_at?: string | null; last_message_preview?: string | null;
  }[],
  userId: number,
) {
  if (!convs.length) return [];

  const ids = convs.map(c => c.id);
  const placeholders = ids.map(() => "?").join(",");

  const selfParts = await qAll<{ conversation_id: number; muted: number; last_read_at: string | null }>(`
    SELECT conversation_id, muted, last_read_at
    FROM conversation_participants
    WHERE user_id = ? AND conversation_id IN (${placeholders})
  `, userId, ...ids);
  const selfByConv = new Map(selfParts.map(r => [r.conversation_id, r]));

  // Use snake_case aliases only — Postgres lowercases unquoted camelCase aliases
  // (conversationId → conversationid), which breaks Map lookups and marks every DM peer deleted.
  const others = await qAll<{
    conversation_id: number; id: number | null; is_online: number; last_seen_at: string | null; status: string;
    username: string | null; avatar_url: string | null; bio: string; village: string; clan: string;
    level: number; rank: string; member_since: string; is_team_member: number; is_admin: number; country: string; city: string | null;
    is_deleted: number | null;
  }>(`
    SELECT cp.conversation_id, u.id, u.is_online, u.last_seen_at, u.status, u.username,
           u.avatar_url, u.bio, u.village, u.clan, u.level, u.rank,
           u.member_since, u.is_team_member, u.is_admin, u.country, u.city,
           u.is_deleted
    FROM conversation_participants cp
    LEFT JOIN users u ON u.id = cp.user_id
    WHERE cp.conversation_id IN (${placeholders}) AND cp.user_id != ?
  `, ...ids, userId);
  const otherByConv = new Map<number, typeof others[0]>();
  for (const o of others) {
    if (!otherByConv.has(o.conversation_id)) otherByConv.set(o.conversation_id, o);
  }

  const unreadRows = await qAll<{ conversation_id: number; c: number }>(`
    SELECT m.conversation_id, COUNT(*) as c
    FROM messages m
    JOIN conversation_participants cp
      ON cp.conversation_id = m.conversation_id AND cp.user_id = ?
    WHERE m.conversation_id IN (${placeholders})
      AND m.user_id != ?
      AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
    GROUP BY m.conversation_id
  `, userId, ...ids, userId);
  const unreadByConv = new Map(unreadRows.map(r => [r.conversation_id, Number(r.c) || 0]));

  return Promise.all(convs.map(async conv => {
    const other = otherByConv.get(conv.id);
    const selfPart = selfByConv.get(conv.id);
    const isDm = conv.type === "dm";
    const peerDeleted = isDm && (
      !other?.id
      || isDeletedUser(other)
      || !other.username
    );
    const otherOnline = other && !peerDeleted ? isUserOnline(other as { is_online: number; last_seen_at: string | null; status: string }) : false;
    const presenceStatus = peerDeleted || !other ? "Offline"
      : (!otherOnline || other.status === "Offline") ? "Offline"
      : (other.status || "Online");

    // Channels intentionally omit last-message previews (high traffic); DMs keep them.
    let msgPreview = "";
    let msgTime = conv.last_message_at ? timeAgo(conv.last_message_at) : "now";
    let previewKind: string | null = null;
    let previewFileName: string | null = null;
    if (isDm) {
      msgPreview = conv.last_message_preview || "No messages yet";
      if (!conv.last_message_at && !conv.last_message_preview) {
        const last = await getLastMessage(conv.id);
        msgPreview = previewFromMessage(last);
        msgTime = last ? timeAgo(last.created_at) : "now";
        previewKind = previewKindFromMessage(last);
        previewFileName = last?.file_name || null;
      } else {
        const inferred = previewKindFromMessage({
          media_type: null,
          content: msgPreview,
        });
        if (/^Image$/i.test(msgPreview) || msgPreview.includes("📷")) previewKind = "image";
        else if (/^Video$/i.test(msgPreview) || msgPreview.includes("🎬")) previewKind = "video";
        else if (/^Voice message$/i.test(msgPreview) || msgPreview.includes("🎤")) previewKind = "audio";
        else if (/^GIF$/i.test(msgPreview)) previewKind = "gif";
        else if (msgPreview.includes("📎") || /\.(zip|rar|pdf|docx?|xlsx?|pptx?|txt|csv|json)$/i.test(msgPreview)) {
          previewKind = "file";
          previewFileName = msgPreview.replace(/^📎\s*/, "");
        } else if (inferred) previewKind = inferred;
      }
    }

    const peerId = other?.id ?? undefined;

    return {
      id: conv.id,
      name: isDm
        ? (peerDeleted ? DELETED_USER_DISPLAY_NAME : (other?.username || DELETED_USER_DISPLAY_NAME))
        : conv.name,
      msg: msgPreview,
      previewKind,
      previewFileName,
      time: msgTime,
      lastActivityAt: conv.last_message_at || conv.created_at || null,
      unread: isDm ? (unreadByConv.get(conv.id) || 0) : 0,
      online: otherOnline && presenceStatus !== "Offline",
      status: isDm ? presenceStatus : undefined,
      muted: selfPart?.muted === 1,
      bio: isDm ? (peerDeleted ? "" : (other?.bio || "")) : conv.bio,
      type: conv.type,
      avatarUrl: isDm
        ? (peerDeleted ? null : (other?.avatar_url || undefined))
        : (conv.avatar_url || undefined),
      otherUserId: isDm ? peerId : undefined,
      isDeleted: isDm ? peerDeleted : undefined,
      village: isDm && !peerDeleted ? other?.village : undefined,
      clan: isDm && !peerDeleted ? other?.clan : undefined,
      level: isDm && !peerDeleted ? other?.level : undefined,
      rank: isDm && !peerDeleted ? other?.rank : undefined,
      memberSince: isDm && !peerDeleted ? other?.member_since : undefined,
      isTeamMember: isDm && !peerDeleted ? Number(other?.is_team_member) === 1 : undefined,
      isAdmin: isDm && !peerDeleted ? Number(other?.is_admin) === 1 : undefined,
      country: isDm && !peerDeleted ? other?.country : undefined,
      city: isDm && !peerDeleted ? other?.city : undefined,
    };
  }));
}

async function formatConversation(conv: {
  id: number; type: string; name: string; bio: string;
  avatar_url?: string | null; created_at?: string | null;
  last_message_at?: string | null; last_message_preview?: string | null;
}, userId: number) {
  return (await formatConversations([conv], userId))[0];
}

router.get("/conversations", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  // First Messages visit: treat all existing channel history as already read (once per user).
  await initializeChannelReadsForUser(userId);

  const convs = await qAll<{
    id: number; type: string; name: string; bio: string; visibility?: string;
    created_at?: string | null;
    last_message_at?: string | null; last_message_preview?: string | null;
  }>(`
    SELECT c.* FROM conversations c
    JOIN conversation_participants cp ON cp.conversation_id = c.id
    WHERE cp.user_id = ? AND (c.archived IS NULL OR c.archived = 0)
    ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
  `, userId);

  const accessFlags = await Promise.all(convs.map(c => c.type !== "channel" ? Promise.resolve(true) : userCanAccessChannel(userId, c.id)));
  const filtered = convs.filter((_, i) => accessFlags[i]);
  const formatted = await formatConversations(filtered, userId);
  // Hide DMs with soft-deleted peers from the active inbox (history remains in DB).
  res.json({
    conversations: formatted.filter(c => !(c.type === "dm" && c.isDeleted)),
  });
});

router.get("/conversations/:id", requireAuth, async (req, res) => {
  const convId = Number(req.params.id);
  if (!(await userCanAccessChannel(req.user!.id, convId))) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  const participant = await qGet(`
    SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?
  `, convId, req.user!.id);
  if (!participant) {
    res.status(403).json({ error: "Not a participant" });
    return;
  }
  const conv = await qGet<{
    id: number; type: string; name: string; bio: string;
    last_message_at?: string | null; last_message_preview?: string | null;
  }>("SELECT * FROM conversations WHERE id = ?", convId);
  res.json({ conversation: await formatConversation(conv!, req.user!.id) });
});

type MsgRow = Record<string, unknown>;

async function fetchOlderThan(convId: number, anchor: { id: number; created_at: string }, fetchLimit: number) {
  return qAll<MsgRow>(`
    SELECT m.*, u.username, u.avatar_url, u.is_deleted FROM messages m
    LEFT JOIN users u ON u.id = m.user_id
    WHERE m.conversation_id = ?
      AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT ?
  `, convId, anchor.created_at, anchor.created_at, anchor.id, fetchLimit);
}

async function fetchNewerThan(convId: number, anchor: { id: number; created_at: string }, fetchLimit: number) {
  return qAll<MsgRow>(`
    SELECT m.*, u.username, u.avatar_url, u.is_deleted FROM messages m
    LEFT JOIN users u ON u.id = m.user_id
    WHERE m.conversation_id = ?
      AND (m.created_at > ? OR (m.created_at = ? AND m.id > ?))
    ORDER BY m.created_at ASC, m.id ASC
    LIMIT ?
  `, convId, anchor.created_at, anchor.created_at, anchor.id, fetchLimit);
}

async function fetchNewest(convId: number, fetchLimit: number) {
  return qAll<MsgRow>(`
    SELECT m.*, u.username, u.avatar_url, u.is_deleted FROM messages m
    LEFT JOIN users u ON u.id = m.user_id
    WHERE m.conversation_id = ?
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT ?
  `, convId, fetchLimit);
}

async function resolveAnchor(convId: number, messageId: number) {
  return qGet<{ id: number; created_at: string }>(`
    SELECT id, created_at FROM messages WHERE id = ? AND conversation_id = ?
  `, messageId, convId);
}

router.get("/conversations/:id/messages", requireAuth, async (req, res) => {
  const convId = Number(req.params.id);
  if (!(await userCanAccessChannel(req.user!.id, convId))) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  const participant = await qGet(`
    SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?
  `, convId, req.user!.id);
  if (!participant) {
    res.status(403).json({ error: "Not a participant" });
    return;
  }

  const DEFAULT_LIMIT = 50;
  const MAX_LIMIT = 100;
  const rawLimit = Number(req.query.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
    : DEFAULT_LIMIT;
  const beforeId = req.query.before != null ? Number(req.query.before) : null;
  const afterId = req.query.after != null ? Number(req.query.after) : null;
  const aroundId = req.query.around != null ? Number(req.query.around) : null;
  const fetchLimit = limit + 1;

  let page: MsgRow[] = [];
  let hasMoreOlder = false;
  let hasMoreNewer = false;

  if (aroundId != null && Number.isFinite(aroundId)) {
    const anchor = await resolveAnchor(convId, aroundId);
    if (!anchor) {
      res.json({ messages: [], hasMore: false, hasMoreOlder: false, hasMoreNewer: false });
      return;
    }
    const olderHalf = Math.max(1, Math.floor(limit / 2));
    const newerHalf = Math.max(1, limit - olderHalf - 1);
    const olderRows = await fetchOlderThan(convId, anchor, olderHalf + 1);
    hasMoreOlder = olderRows.length > olderHalf;
    const older = (hasMoreOlder ? olderRows.slice(0, olderHalf) : olderRows).reverse();

    const center = await qGet<MsgRow>(`
      SELECT m.*, u.username, u.avatar_url, u.is_deleted FROM messages m
      LEFT JOIN users u ON u.id = m.user_id
      WHERE m.id = ? AND m.conversation_id = ?
    `, aroundId, convId);

    const newerRows = await fetchNewerThan(convId, anchor, newerHalf + 1);
    hasMoreNewer = newerRows.length > newerHalf;
    const newer = hasMoreNewer ? newerRows.slice(0, newerHalf) : newerRows;

    page = center ? [...older, center, ...newer] : [...older, ...newer];
  } else if (afterId != null && Number.isFinite(afterId)) {
    const anchor = await resolveAnchor(convId, afterId);
    if (!anchor) {
      res.json({ messages: [], hasMore: false, hasMoreOlder: true, hasMoreNewer: false });
      return;
    }
    const newerRows = await fetchNewerThan(convId, anchor, fetchLimit);
    hasMoreNewer = newerRows.length > limit;
    page = hasMoreNewer ? newerRows.slice(0, limit) : newerRows;
    hasMoreOlder = true; // there is always content at/before the after cursor when scrolling down from history
  } else if (beforeId != null && Number.isFinite(beforeId)) {
    const anchor = await resolveAnchor(convId, beforeId);
    if (!anchor) {
      res.json({ messages: [], hasMore: false, hasMoreOlder: false, hasMoreNewer: true });
      return;
    }
    const olderRows = await fetchOlderThan(convId, anchor, fetchLimit);
    hasMoreOlder = olderRows.length > limit;
    page = (hasMoreOlder ? olderRows.slice(0, limit) : olderRows).reverse();
    hasMoreNewer = true;
  } else {
    // Initial load: newest page
    const rows = await fetchNewest(convId, fetchLimit);
    hasMoreOlder = rows.length > limit;
    page = (hasMoreOlder ? rows.slice(0, limit) : rows).reverse();
    hasMoreNewer = false;
    await markConversationRead(convId, req.user!.id);
    emitToUser(req.user!.id, "conversation:update", { conversationId: convId });
  }

  res.json({
    messages: await formatMessages(page, req.user!.id),
    hasMore: hasMoreOlder,
    hasMoreOlder,
    hasMoreNewer,
  });
});

router.post("/conversations/:id/read", requireAuth, async (req, res) => {
  const convId = Number(req.params.id);
  if (!(await requireConversationAccess(req, res, convId))) return;
  await markConversationRead(convId, req.user!.id);
  emitToUser(req.user!.id, "conversation:update", { conversationId: convId });
  res.json({ ok: true });
});

router.post("/messages", requireAuth, rateLimit({
  keyFn: (req) => `msg:text:${req.user!.id}`,
  max: 60,
  windowMs: 60_000,
  message: "You are sending messages too quickly. Please slow down.",
}), async (req, res) => {
  const { conversationId, msg, replyTo } = req.body;
  if (!conversationId || !msg) {
    res.status(400).json({ error: "conversationId and msg are required" });
    return;
  }

  if (!(await requireConversationAccess(req, res, Number(conversationId)))) return;
  const safeReplyTo = await sanitizeReplyToId(Number(conversationId), replyTo);

  const result = await qRun(`
    INSERT INTO messages (conversation_id, user_id, content, reply_to_id, created_at)
    VALUES (?, ?, ?, ?, ?)
  `, conversationId, req.user!.id, msg, safeReplyTo, now());

  const inserted = await qGet(`
    SELECT m.*, u.username, u.avatar_url, u.is_deleted FROM messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.id = ?
  `, result.lastInsertRowid);

  const raw = inserted as Record<string, unknown>;
  const forViewer = await formatMessageForViewers(raw, req.user!.id);
  const formatted = forViewer(req.user!.id);
  const ts = raw.created_at as string;
  await touchConversationLastMessage(conversationId, ts, previewFromMessage({
    content: msg,
    media_type: null,
    file_name: null,
  }));
  await emitMessageToParticipants(conversationId, "message:new", (viewerId) => ({
    conversationId,
    message: forViewer(viewerId),
  }));
  await emitConversationUpdate(conversationId);
  scheduleAdminStatsRefresh();

  res.status(201).json({ message: formatted });
});

const GIF_HOST_ALLOW = /^(?:[\w-]+\.)*tenor\.com$|^(?:[\w-]+\.)*giphy\.com$|^(?:[\w-]+\.)*media\.giphy\.com$/i;

/** Persist a remote GIF URL (Tenor/GIPHY) without downloading — avoids browser CORS on fetch+reupload. */
router.post("/messages/gif", requireAuth, rateLimit({
  keyFn: (req) => `msg:gif:${req.user!.id}`,
  max: 30,
  windowMs: 60_000,
}), async (req, res) => {
  const conversationId = Number(req.body.conversationId);
  const rawUrl = typeof req.body.url === "string" ? req.body.url.trim() : "";
  const label = typeof req.body.label === "string" ? req.body.label.slice(0, 120) : "GIF";
  if (!conversationId || !rawUrl) {
    res.status(400).json({ error: "conversationId and url are required" });
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    res.status(400).json({ error: "Invalid GIF url" });
    return;
  }
  if (parsed.protocol !== "https:" || !GIF_HOST_ALLOW.test(parsed.hostname)) {
    res.status(400).json({ error: "GIF host not allowed" });
    return;
  }

  if (!(await requireConversationAccess(req, res, conversationId))) return;
  const safeReplyTo = await sanitizeReplyToId(conversationId, req.body.replyTo);

  const result = await qRun(`
    INSERT INTO messages (
      conversation_id, user_id, content, media_url, media_type, file_name, file_size,
      reply_to_id, created_at
    )
    VALUES (?, ?, '', ?, 'gif', ?, NULL, ?, ?)
  `,
    conversationId,
    req.user!.id,
    parsed.toString(),
    `${label}.gif`,
    safeReplyTo,
    now(),
  );

  const inserted = await qGet(`
    SELECT m.*, u.username, u.avatar_url, u.is_deleted FROM messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.id = ?
  `, result.lastInsertRowid);

  const raw = inserted as Record<string, unknown>;
  const forViewer = await formatMessageForViewers(raw, req.user!.id);
  const formatted = forViewer(req.user!.id);
  await touchConversationLastMessage(conversationId, raw.created_at as string, previewFromMessage({
    content: "",
    media_type: "gif",
    file_name: `${label}.gif`,
  }));
  await emitMessageToParticipants(conversationId, "message:new", (viewerId) => ({
    conversationId,
    message: forViewer(viewerId),
  }));
  await emitConversationUpdate(conversationId);
  scheduleAdminStatsRefresh();

  res.status(201).json({ message: formatted });
});

router.post("/messages/media", requireAuth, rateLimit({
  keyFn: (req) => `msg:media:${req.user!.id}`,
  max: 20,
  windowMs: 60_000,
}), uploadMessageFile, async (req, res) => {
  const conversationId = Number(req.body.conversationId);
  if (!conversationId || !req.file) {
    res.status(400).json({ error: "conversationId and file are required" });
    return;
  }

  if (!(await requireConversationAccess(req, res, conversationId))) return;
  const safeReplyTo = await sanitizeReplyToId(conversationId, req.body.replyTo);

  const validated = validateUpload({
    kind: "messageMedia",
    originalName: req.file.originalname,
    declaredMime: req.file.mimetype,
    buffer: req.file.buffer,
    size: req.file.size,
  });
  if (!validated.ok) {
    res.status(400).json({ error: validated.error });
    return;
  }

  const mime = validated.contentType;
  let mediaType = "file";
  if (mime.startsWith("image/")) mediaType = mime.includes("gif") ? "gif" : "image";
  else if (mime.startsWith("video/")) mediaType = "video";
  else if (mime.startsWith("audio/")) mediaType = "audio";

  let durationMs: number | null = null;
  let mediaMetaJson: string | null = null;
  if (mediaType === "audio") {
    const sanitized = sanitizeVoiceMeta({
      durationMs: req.body.durationMs,
      mimeType: mime,
      codec: req.body.codec,
      sampleRate: req.body.sampleRate,
      channels: req.body.channels,
      waveform: req.body.waveform,
    });
    durationMs = sanitized.durationMs;
    if (!durationMs) {
      durationMs = null;
    }
    if (sanitized.mediaMeta) {
      if (!sanitized.mediaMeta.mimeType) sanitized.mediaMeta.mimeType = mime;
      mediaMetaJson = JSON.stringify(sanitized.mediaMeta);
    } else {
      mediaMetaJson = JSON.stringify({ mimeType: mime });
    }
  }

  const stored = await persistMulterFile(req.file, "message", { contentType: mime });
  const result = await qRun(`
    INSERT INTO messages (
      conversation_id, user_id, content, media_url, media_type, file_name, file_size,
      reply_to_id, created_at, duration_ms, media_meta
    )
    VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    conversationId,
    req.user!.id,
    stored.url,
    mediaType,
    req.file.originalname,
    req.file.size,
    safeReplyTo,
    now(),
    durationMs,
    mediaMetaJson,
  );

  const inserted = await qGet(`
    SELECT m.*, u.username, u.avatar_url, u.is_deleted FROM messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.id = ?
  `, result.lastInsertRowid);

  const raw = inserted as Record<string, unknown>;
  const forViewer = await formatMessageForViewers(raw, req.user!.id);
  const formatted = forViewer(req.user!.id);
  await touchConversationLastMessage(conversationId, raw.created_at as string, previewFromMessage({
    content: "",
    media_type: mediaType,
    file_name: req.file.originalname,
  }));
  await emitMessageToParticipants(conversationId, "message:new", (viewerId) => ({
    conversationId,
    message: forViewer(viewerId),
  }));
  await emitConversationUpdate(conversationId);
  scheduleAdminStatsRefresh();

  res.status(201).json({ message: formatted });
});

router.patch("/messages/:id", requireAuth, async (req, res) => {
  const msgId = Number(req.params.id);
  const { msg } = req.body;
  const existing = await qGet("SELECT * FROM messages WHERE id = ? AND user_id = ?", msgId, req.user!.id);
  if (!existing) {
    res.status(404).json({ error: "Message not found" });
    return;
  }
  await qRun("UPDATE messages SET content = ?, edited_at = ? WHERE id = ?", msg, now(), msgId);
  const updated = await qGet("SELECT m.*, u.username, u.avatar_url, u.is_deleted FROM messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.id = ?", msgId);
  const raw = updated as Record<string, unknown>;
  const forViewer = await formatMessageForViewers(raw, req.user!.id);
  const formatted = forViewer(req.user!.id);
  const convId = (existing as { conversation_id: number }).conversation_id;
  await refreshConversationLastMessage(convId);
  await emitMessageToParticipants(convId, "message:updated", (viewerId) => ({
    conversationId: convId,
    message: forViewer(viewerId),
  }));
  res.json({ message: formatted });
});

router.delete("/messages/:id", requireAuth, async (req, res) => {
  const msgId = Number(req.params.id);
  const existing = await qGet<{
    id: number; conversation_id: number; user_id: number; content: string;
    media_url: string | null; conversation_type: string;
  }>(`
    SELECT m.*, c.type as conversation_type
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id = ?
  `, msgId);

  if (!existing) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  const isAuthor = existing.user_id === req.user!.id;
  const admin = isAdmin(req.user!);
  const isChannel = existing.conversation_type === "channel";
  // Authors may delete own messages anywhere. Admins may moderate any channel message.
  if (!isAuthor && !(admin && isChannel)) {
    res.status(403).json({ error: "Not allowed to delete this message" });
    return;
  }

  const deleted = await hardDeleteMessage(msgId);
  if (!deleted) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  if (admin && !isAuthor) {
    logActivitySync({
      req,
      userId: req.user!.id,
      eventType: "message_delete",
      eventCategory: "administration",
      description: `Deleted message #${msgId} in conversation #${existing.conversation_id}`,
      affectedObject: `message:${msgId}`,
      metadata: {
        conversationId: existing.conversation_id,
        messageId: msgId,
        authorId: existing.user_id,
        conversationType: existing.conversation_type,
        reason: "channel_moderation",
      },
    });
  }

  res.json({ ok: true });
});

router.post("/messages/:id/reactions", requireAuth, rateLimit({
  keyFn: (req) => `msg:react:${req.user!.id}`,
  max: 60,
  windowMs: 60_000,
}), async (req, res) => {
  const msgId = Number(req.params.id);
  const { emoji } = req.body;
  if (!emoji) {
    res.status(400).json({ error: "emoji is required" });
    return;
  }

  const msg = await qGet<{ conversation_id: number }>("SELECT conversation_id FROM messages WHERE id = ?", msgId);
  if (!msg) {
    res.status(404).json({ error: "Message not found" });
    return;
  }
  if (!(await requireConversationAccess(req, res, msg.conversation_id))) return;

  const existing = await qGet(`
    SELECT 1 FROM message_reactions WHERE message_id = ? AND emoji = ? AND user_id = ?
  `, msgId, emoji, req.user!.id);

  if (existing) {
    await qRun("DELETE FROM message_reactions WHERE message_id = ? AND emoji = ? AND user_id = ?", msgId, emoji, req.user!.id);
  } else {
    await qRun("INSERT INTO message_reactions (message_id, emoji, user_id, created_at) VALUES (?, ?, ?, ?)", msgId, emoji, req.user!.id, now());
  }

  const reactions = await qAll<{ emoji: string; user_id: number }>("SELECT emoji, user_id FROM message_reactions WHERE message_id = ?", msgId);
  const reactionMap: Record<string, string[]> = {};
  for (const r of reactions) {
    if (!reactionMap[r.emoji]) reactionMap[r.emoji] = [];
    reactionMap[r.emoji].push(String(r.user_id));
  }

  await emitMessageToParticipants(msg.conversation_id, "message:reaction", () => ({
    conversationId: msg.conversation_id, messageId: msgId, reactions: reactionMap,
  }));
  res.json({ reactions: reactionMap });
});

router.put("/conversations/:id/mute", requireAuth, async (req, res) => {
  const convId = Number(req.params.id);
  if (!(await requireConversationAccess(req, res, convId))) return;
  const row = await qGet<{ muted: number }>("SELECT muted FROM conversation_participants WHERE conversation_id = ? AND user_id = ?", convId, req.user!.id);
  if (!row) {
    res.status(403).json({ error: "Not a participant" });
    return;
  }
  const muted = row.muted === 1 ? 0 : 1;
  await qRun("UPDATE conversation_participants SET muted = ? WHERE conversation_id = ? AND user_id = ?", muted, convId, req.user!.id);
  res.json({ muted: muted === 1 });
});

router.delete("/contacts/:contactId", requireAuth, async (req, res) => {
  const convId = Number(req.params.contactId);
  await qRun("DELETE FROM conversation_participants WHERE conversation_id = ? AND user_id = ?", convId, req.user!.id);
  res.json({ ok: true });
});

router.post("/conversations", requireAuth, rateLimit({
  keyFn: (req) => `dm:create:${req.user!.id}`,
  max: 20,
  windowMs: 60 * 60 * 1000,
}), async (req, res) => {
  const { name, bio } = req.body;
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const npc = await qGet<{ id: number; username: string; bio: string }>("SELECT id, username, bio FROM users WHERE username = ? AND is_npc = 1 AND is_deleted = 0", name);
  const realUser = await qGet<{ id: number; username: string; bio: string }>("SELECT id, username, bio FROM users WHERE LOWER(username) = LOWER(?) AND is_npc = 0 AND is_deleted = 0 AND is_disabled = 0", name);
  const target = realUser || npc;

  if (target) {
    if (realUser && await usersAreBlocked(req.user!.id, realUser.id)) {
      res.status(403).json({ error: "You cannot message this user" });
      return;
    }

    const existingDm = await qGet<{ id: number }>(`
      SELECT c.id FROM conversations c
      JOIN conversation_participants cp1 ON cp1.conversation_id = c.id AND cp1.user_id = ?
      JOIN conversation_participants cp2 ON cp2.conversation_id = c.id AND cp2.user_id = ?
      WHERE c.type = 'dm'
      LIMIT 1
    `, req.user!.id, target.id);

    if (existingDm) {
      const conv = await qGet<{ id: number; type: string; name: string; bio: string }>("SELECT * FROM conversations WHERE id = ?", existingDm.id);
      res.json({ conversation: await formatConversation(conv!, req.user!.id) });
      return;
    }

    // Real users require prior consent (contact or accepted request). NPCs are exempt.
    if (realUser && !(await canOpenDmWithoutRequest(req.user!.id, realUser.id))) {
      res.status(403).json({
        error: "Send a message request first. Direct conversations require the other user to accept.",
        code: "DM_CONSENT_REQUIRED",
      });
      return;
    }
  }

  const existing = await qGet<{ id: number }>(`
    SELECT c.id FROM conversations c
    JOIN conversation_participants cp ON cp.conversation_id = c.id
    WHERE c.type = 'dm' AND c.name = ? AND cp.user_id = ?
  `, name, req.user!.id);

  if (existing) {
    const conv = await qGet<{ id: number; type: string; name: string; bio: string }>("SELECT * FROM conversations WHERE id = ?", existing.id);
    res.json({ conversation: await formatConversation(conv!, req.user!.id) });
    return;
  }

  // Creating a DM with no resolvable target is not allowed (would be a ghost thread).
  if (!target) {
    res.status(404).json({ error: "No user found with that username" });
    return;
  }

  const ts = now();
  const displayName = target.username || name;
  const displayBio = bio || target.bio || "";
  const result = await qRun("INSERT INTO conversations (type, name, bio, created_at) VALUES ('dm', ?, ?, ?)", displayName, displayBio, ts);
  const convId = result.lastInsertRowid as number;
  await qRun("INSERT INTO conversation_participants (conversation_id, user_id, joined_at) VALUES (?, ?, ?)", convId, req.user!.id, ts);
  await qRun("INSERT INTO conversation_participants (conversation_id, user_id, joined_at) VALUES (?, ?, ?)", convId, target.id, ts);
  if (realUser) {
    await qRun("INSERT OR IGNORE INTO dm_contacts (user_id, contact_user_id, created_at) VALUES (?, ?, ?)", req.user!.id, target.id, ts);
    await qRun("INSERT OR IGNORE INTO dm_contacts (user_id, contact_user_id, created_at) VALUES (?, ?, ?)", target.id, req.user!.id, ts);
  }

  const conv = await qGet<{ id: number; type: string; name: string; bio: string }>("SELECT * FROM conversations WHERE id = ?", convId);
  res.status(201).json({ conversation: await formatConversation(conv!, req.user!.id) });
});

router.post("/reports", requireAuth, rateLimit({
  keyFn: (req) => `report:${req.user!.id}`,
  max: 10,
  windowMs: 60 * 60 * 1000,
}), async (req, res) => {
  const { userId, messageId, reason } = req.body;
  const reporterId = req.user!.id;
  const reporterName = req.user!.username;
  const ts = now();

  let resolvedUserId: number | null = userId != null ? Number(userId) : null;
  let messagePreview = "";
  let contextLabel = "Messaging";
  let conversationId: number | null = null;
  let conversationType: string | null = null;
  let reportedUsername: string | null = null;

  if (messageId != null) {
    const msg = await qGet<{
      id: number; user_id: number; content: string; media_type: string | null; file_name: string | null;
      conversation_id: number; conversation_type: string; conversation_name: string;
      author_username: string | null; author_deleted: number | null;
    }>(`
      SELECT m.id, m.user_id, m.content, m.media_type, m.file_name, m.conversation_id,
             c.type as conversation_type, c.name as conversation_name,
             u.username as author_username, u.is_deleted as author_deleted
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      LEFT JOIN users u ON u.id = m.user_id
      WHERE m.id = ?
    `, Number(messageId));

    if (msg) {
      if (resolvedUserId == null) resolvedUserId = msg.user_id;
      reportedUsername = tombstoneSenderFields({
        username: msg.author_username,
        is_deleted: msg.author_deleted,
      }).username;
      conversationId = msg.conversation_id;
      conversationType = msg.conversation_type;
      if (msg.conversation_type === "channel") {
        contextLabel = msg.conversation_name || "Channel";
      } else {
        contextLabel = `DM (${msg.conversation_name || "Direct Message"})`;
      }
      if (msg.content?.trim()) {
        messagePreview = msg.content.trim().slice(0, 160);
      } else if (msg.media_type === "image") messagePreview = "[Image]";
      else if (msg.media_type === "video") messagePreview = "[Video]";
      else if (msg.media_type === "audio") messagePreview = "[Audio]";
      else if (msg.media_type === "gif") messagePreview = "[GIF]";
      else if (msg.file_name) messagePreview = `[File: ${msg.file_name}]`;
      else messagePreview = "[Attachment]";
    }
  }

  if (!reportedUsername && resolvedUserId != null) {
    const u = await qGet<{ username: string }>("SELECT username FROM users WHERE id = ?", resolvedUserId);
    reportedUsername = u?.username || null;
  }

  const result = await qRun(`
    INSERT INTO reports (reporter_id, reported_user_id, message_id, reason, created_at)
    VALUES (?, ?, ?, ?, ?)
  `, reporterId, resolvedUserId, messageId != null ? Number(messageId) : null, reason || "", ts);

  const reportId = Number(result.lastInsertRowid);
  const reasonText = (reason || "No reason provided").trim();

  let title: string;
  let body: string;
  if (messageId != null) {
    title = "Message Report";
    body = `${reporterName} reported a message from ${reportedUsername || "unknown"} in ${contextLabel}.`
      + (messagePreview ? `\nPreview: ${messagePreview}` : "")
      + `\nReason: ${reasonText}`
      + `\nMessage ID: ${Number(messageId)}`
      + (resolvedUserId != null ? `\nReported user ID: ${resolvedUserId}` : "");
  } else {
    title = "User Report";
    body = `${reporterName} reported user ${reportedUsername || resolvedUserId || "unknown"}.`
      + `\nReason: ${reasonText}`;
  }

  await createAdminSystemNotification({
    title,
    body,
    source: "Messaging",
    page: "alarms",
    notifType: messageId != null ? "message_report" : "user_report",
    metadata: {
      reportId,
      reporterId,
      reporterUsername: reporterName,
      reportedUserId: resolvedUserId,
      reportedUsername,
      messageId: messageId != null ? Number(messageId) : null,
      conversationId,
      conversationType,
      context: contextLabel,
      reason: reasonText,
      messagePreview,
      timestamp: ts,
    },
  });

  logActivitySync({
    req,
    userId: reporterId,
    eventType: messageId != null ? "message_report" : "user_report",
    eventCategory: "messaging",
    description: body.split("\n")[0] || title,
    affectedObject: messageId != null ? `message:${Number(messageId)}` : (resolvedUserId != null ? `user:${resolvedUserId}` : `report:${reportId}`),
    metadata: { reportId, messageId, reportedUserId: resolvedUserId },
  });

  res.status(201).json({ ok: true, reportId });
});

export default router;
