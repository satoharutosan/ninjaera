import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db } from "../db/index.js";
import { requireAuth, timeAgo, formatTime } from "../middleware/auth.js";
import { isUserOnline } from "../services/presence.js";
import { userCanAccessChannel } from "../services/channels.js";
import {
  emitMessageToParticipants, emitConversationUpdate, emitToUser,
} from "../services/realtime.js";

const router = Router();
const now = () => new Date().toISOString();

const uploadDir = process.env.UPLOAD_DIR || "./uploads";
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

function getLastMessage(convId: number) {
  return db.prepare(`
    SELECT m.*, u.username
    FROM messages m JOIN users u ON u.id = m.user_id
    WHERE m.conversation_id = ?
    ORDER BY m.created_at DESC LIMIT 1
  `).get(convId) as { content: string; created_at: string; media_type?: string | null; file_name?: string | null } | undefined;
}

function unreadCount(convId: number, userId: number) {
  const part = db.prepare(`
    SELECT last_read_at FROM conversation_participants
    WHERE conversation_id = ? AND user_id = ?
  `).get(convId, userId) as { last_read_at: string | null } | undefined;

  if (part?.last_read_at) {
    const row = db.prepare(`
      SELECT COUNT(*) as c FROM messages
      WHERE conversation_id = ? AND user_id != ? AND created_at > ?
    `).get(convId, userId, part.last_read_at) as { c: number };
    return row.c;
  }

  const row = db.prepare(`
    SELECT COUNT(*) as c FROM messages
    WHERE conversation_id = ? AND user_id != ?
  `).get(convId, userId) as { c: number };
  return row.c;
}

function markConversationRead(convId: number, userId: number) {
  const ts = now();
  db.prepare(`
    UPDATE conversation_participants SET last_read_at = ?
    WHERE conversation_id = ? AND user_id = ?
  `).run(ts, convId, userId);
}

function previewText(last: { content: string; media_type?: string | null; file_name?: string | null } | undefined) {
  if (!last) return "No messages yet";
  if (last.content) return last.content;
  switch (last.media_type) {
    case "image": return "📷 Image";
    case "gif": return "GIF";
    case "video": return "🎬 Video";
    case "audio": return "🎤 Voice message";
    case "file": return last.file_name ? `📎 ${last.file_name}` : "📎 File";
    default: return "No messages yet";
  }
}

function formatConversation(conv: { id: number; type: string; name: string; bio: string }, userId: number) {
  const last = getLastMessage(conv.id) as { content: string; created_at: string; media_type?: string | null; file_name?: string | null } | undefined;
  const other = db.prepare(`
    SELECT u.id, u.is_online, u.last_seen_at, u.status, u.username, u.avatar_url as avatarUrl, u.bio,
           u.village, u.clan, u.level, u.rank, u.member_since as memberSince, u.is_team_member as isTeamMember,
           u.country, u.city
    FROM users u
    JOIN conversation_participants cp ON cp.user_id = u.id
    WHERE cp.conversation_id = ? AND u.id != ? LIMIT 1
  `).get(conv.id, userId) as {
    id: number; is_online: number; last_seen_at: string | null; status: string; username: string;
    avatarUrl: string | null; bio: string; village: string; clan: string; level: number; rank: string;
    memberSince: string; isTeamMember: number; country: string; city: string | null;
  } | undefined;

  const selfPart = db.prepare(`
    SELECT muted FROM conversation_participants WHERE conversation_id = ? AND user_id = ?
  `).get(conv.id, userId) as { muted: number } | undefined;

  const isDm = conv.type === "dm";
  const otherOnline = other ? isUserOnline(other) : false;
  const presenceStatus = !other ? "Offline"
    : (!otherOnline || other.status === "Offline") ? "Offline"
    : (other.status || "Online");

  return {
    id: conv.id,
    name: isDm ? (other?.username || conv.name) : conv.name,
    msg: previewText(last),
    time: last ? timeAgo(last.created_at) : "now",
    unread: isDm ? unreadCount(conv.id, userId) : 0,
    online: otherOnline && presenceStatus !== "Offline",
    status: isDm ? presenceStatus : undefined,
    muted: selfPart?.muted === 1,
    bio: isDm ? (other?.bio || "") : conv.bio,
    type: conv.type,
    avatarUrl: isDm ? (other?.avatarUrl || undefined) : undefined,
    otherUserId: isDm ? other?.id : undefined,
    village: isDm ? other?.village : undefined,
    clan: isDm ? other?.clan : undefined,
    level: isDm ? other?.level : undefined,
    rank: isDm ? other?.rank : undefined,
    memberSince: isDm ? other?.memberSince : undefined,
    isTeamMember: isDm ? other?.isTeamMember === 1 : undefined,
    country: isDm ? other?.country : undefined,
    city: isDm ? other?.city : undefined,
  };
}

function formatMessage(msg: Record<string, unknown>, currentUserId: number) {
  const reactions = db.prepare(`
    SELECT emoji, user_id FROM message_reactions WHERE message_id = ?
  `).all(msg.id as number) as { emoji: string; user_id: number }[];

  const reactionMap: Record<string, string[]> = {};
  for (const r of reactions) {
    if (!reactionMap[r.emoji]) reactionMap[r.emoji] = [];
    reactionMap[r.emoji].push(String(r.user_id));
  }

  let replyTo: { id: number; user: string; preview: string } | undefined;
  if (msg.reply_to_id) {
    const parent = db.prepare(`
      SELECT m.id, u.username, m.content FROM messages m
      JOIN users u ON u.id = m.user_id WHERE m.id = ?
    `).get(msg.reply_to_id) as { id: number; username: string; content: string } | undefined;
    if (parent) {
      replyTo = { id: parent.id, user: parent.username, preview: parent.content.slice(0, 80) };
    }
  }

  return {
    id: msg.id,
    userId: msg.user_id as number,
    user: msg.username,
    msg: msg.content,
    time: formatTime(msg.created_at as string),
    self: msg.user_id === currentUserId,
    avatarUrl: (msg.avatar_url as string | null) || undefined,
    mediaUrl: msg.media_url || undefined,
    mediaType: msg.media_type || undefined,
    fileName: msg.file_name || undefined,
    fileSize: msg.file_size || undefined,
    replyTo,
    edited: !!msg.edited_at,
    reactions: Object.keys(reactionMap).length ? reactionMap : undefined,
  };
}

router.get("/conversations", requireAuth, (req, res) => {
  const userId = req.user!.id;
  const convs = db.prepare(`
    SELECT c.* FROM conversations c
    JOIN conversation_participants cp ON cp.conversation_id = c.id
    LEFT JOIN (
      SELECT conversation_id, MAX(created_at) as last_at FROM messages GROUP BY conversation_id
    ) lm ON lm.conversation_id = c.id
    WHERE cp.user_id = ? AND (c.archived IS NULL OR c.archived = 0)
    ORDER BY c.type DESC, COALESCE(lm.last_at, c.created_at) DESC
  `).all(userId) as { id: number; type: string; name: string; bio: string; visibility?: string }[];

  const filtered = convs.filter(c => c.type !== "channel" || userCanAccessChannel(userId, c.id));
  res.json({ conversations: filtered.map(c => formatConversation(c, userId)) });
});

router.get("/conversations/:id", requireAuth, (req, res) => {
  const convId = Number(req.params.id);
  if (!userCanAccessChannel(req.user!.id, convId)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  const participant = db.prepare(`
    SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?
  `).get(convId, req.user!.id);
  if (!participant) {
    res.status(403).json({ error: "Not a participant" });
    return;
  }
  const conv = db.prepare("SELECT * FROM conversations WHERE id = ?").get(convId) as { id: number; type: string; name: string; bio: string };
  res.json({ conversation: formatConversation(conv, req.user!.id) });
});

router.get("/conversations/:id/messages", requireAuth, (req, res) => {
  const convId = Number(req.params.id);
  if (!userCanAccessChannel(req.user!.id, convId)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  const participant = db.prepare(`
    SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?
  `).get(convId, req.user!.id);
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
  const fetchLimit = limit + 1;

  let rows: unknown[];
  if (beforeId != null && Number.isFinite(beforeId)) {
    const anchor = db.prepare(`
      SELECT id, created_at FROM messages WHERE id = ? AND conversation_id = ?
    `).get(beforeId, convId) as { id: number; created_at: string } | undefined;

    if (!anchor) {
      res.json({ messages: [], hasMore: false });
      return;
    }

    // Older messages relative to the anchor (scroll-up pagination)
    rows = db.prepare(`
      SELECT m.*, u.username, u.avatar_url FROM messages m
      JOIN users u ON u.id = m.user_id
      WHERE m.conversation_id = ?
        AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ?
    `).all(convId, anchor.created_at, anchor.created_at, anchor.id, fetchLimit);
  } else {
    // Initial load: newest page
    rows = db.prepare(`
      SELECT m.*, u.username, u.avatar_url FROM messages m
      JOIN users u ON u.id = m.user_id
      WHERE m.conversation_id = ?
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ?
    `).all(convId, fetchLimit);
  }

  const hasMore = rows.length > limit;
  const page = (hasMore ? rows.slice(0, limit) : rows).reverse();

  // Only mark read on the initial (newest) page so history loads do not affect unread
  if (beforeId == null) {
    markConversationRead(convId, req.user!.id);
    emitToUser(req.user!.id, "conversation:update", { conversationId: convId });
  }

  res.json({
    messages: page.map(m => formatMessage(m as Record<string, unknown>, req.user!.id)),
    hasMore,
  });
});

router.post("/conversations/:id/read", requireAuth, (req, res) => {
  const convId = Number(req.params.id);
  const participant = db.prepare(`
    SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?
  `).get(convId, req.user!.id);
  if (!participant) {
    res.status(403).json({ error: "Not a participant" });
    return;
  }
  markConversationRead(convId, req.user!.id);
  emitToUser(req.user!.id, "conversation:update", { conversationId: convId });
  res.json({ ok: true });
});

router.post("/messages", requireAuth, (req, res) => {
  const { conversationId, msg, replyTo } = req.body;
  if (!conversationId || !msg) {
    res.status(400).json({ error: "conversationId and msg are required" });
    return;
  }

  const participant = db.prepare(`
    SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?
  `).get(conversationId, req.user!.id);
  if (!participant) {
    res.status(403).json({ error: "Not a participant" });
    return;
  }

  const result = db.prepare(`
    INSERT INTO messages (conversation_id, user_id, content, reply_to_id, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(conversationId, req.user!.id, msg, replyTo || null, now());

  const inserted = db.prepare(`
    SELECT m.*, u.username, u.avatar_url FROM messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?
  `).get(result.lastInsertRowid);

  const raw = inserted as Record<string, unknown>;
  const formatted = formatMessage(raw, req.user!.id);
  emitMessageToParticipants(conversationId, "message:new", (viewerId) => ({
    conversationId,
    message: formatMessage(raw, viewerId),
  }));
  emitConversationUpdate(conversationId);

  res.status(201).json({ message: formatted });
});

router.post("/messages/media", requireAuth, upload.single("file"), (req, res) => {
  const conversationId = Number(req.body.conversationId);
  const replyTo = req.body.replyTo ? Number(req.body.replyTo) : null;
  if (!conversationId || !req.file) {
    res.status(400).json({ error: "conversationId and file are required" });
    return;
  }

  const participant = db.prepare(`
    SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?
  `).get(conversationId, req.user!.id);
  if (!participant) {
    res.status(403).json({ error: "Not a participant" });
    return;
  }

  const mime = req.file.mimetype;
  let mediaType = "file";
  if (mime.startsWith("image/")) mediaType = mime.includes("gif") ? "gif" : "image";
  else if (mime.startsWith("video/")) mediaType = "video";
  else if (mime.startsWith("audio/")) mediaType = "audio";

  const url = `/uploads/${req.file.filename}`;
  const result = db.prepare(`
    INSERT INTO messages (conversation_id, user_id, content, media_url, media_type, file_name, file_size, reply_to_id, created_at)
    VALUES (?, ?, '', ?, ?, ?, ?, ?, ?)
  `).run(conversationId, req.user!.id, url, mediaType, req.file.originalname, req.file.size, replyTo, now());

  const inserted = db.prepare(`
    SELECT m.*, u.username, u.avatar_url FROM messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?
  `).get(result.lastInsertRowid);

  const raw = inserted as Record<string, unknown>;
  const formatted = formatMessage(raw, req.user!.id);
  emitMessageToParticipants(conversationId, "message:new", (viewerId) => ({
    conversationId,
    message: formatMessage(raw, viewerId),
  }));
  emitConversationUpdate(conversationId);

  res.status(201).json({ message: formatted });
});

router.patch("/messages/:id", requireAuth, (req, res) => {
  const msgId = Number(req.params.id);
  const { msg } = req.body;
  const existing = db.prepare("SELECT * FROM messages WHERE id = ? AND user_id = ?").get(msgId, req.user!.id);
  if (!existing) {
    res.status(404).json({ error: "Message not found" });
    return;
  }
  db.prepare("UPDATE messages SET content = ?, edited_at = ? WHERE id = ?").run(msg, now(), msgId);
  const updated = db.prepare("SELECT m.*, u.username, u.avatar_url FROM messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?").get(msgId);
  const raw = updated as Record<string, unknown>;
  const formatted = formatMessage(raw, req.user!.id);
  const convId = (existing as { conversation_id: number }).conversation_id;
  emitMessageToParticipants(convId, "message:updated", (viewerId) => ({
    conversationId: convId,
    message: formatMessage(raw, viewerId),
  }));
  res.json({ message: formatted });
});

router.delete("/messages/:id", requireAuth, (req, res) => {
  const msgId = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM messages WHERE id = ? AND user_id = ?").get(msgId, req.user!.id);
  if (!existing) {
    res.status(404).json({ error: "Message not found" });
    return;
  }
  const convId = (existing as { conversation_id: number }).conversation_id;
  db.prepare("DELETE FROM messages WHERE id = ?").run(msgId);
  emitMessageToParticipants(convId, "message:deleted", () => ({ conversationId: convId, messageId: msgId }));
  emitConversationUpdate(convId);
  res.json({ ok: true });
});

router.post("/messages/:id/reactions", requireAuth, (req, res) => {
  const msgId = Number(req.params.id);
  const { emoji } = req.body;
  if (!emoji) {
    res.status(400).json({ error: "emoji is required" });
    return;
  }

  const existing = db.prepare(`
    SELECT 1 FROM message_reactions WHERE message_id = ? AND emoji = ? AND user_id = ?
  `).get(msgId, emoji, req.user!.id);

  if (existing) {
    db.prepare("DELETE FROM message_reactions WHERE message_id = ? AND emoji = ? AND user_id = ?").run(msgId, emoji, req.user!.id);
  } else {
    db.prepare("INSERT INTO message_reactions (message_id, emoji, user_id, created_at) VALUES (?, ?, ?, ?)").run(msgId, emoji, req.user!.id, now());
  }

  const reactions = db.prepare("SELECT emoji, user_id FROM message_reactions WHERE message_id = ?").all(msgId) as { emoji: string; user_id: number }[];
  const reactionMap: Record<string, string[]> = {};
  for (const r of reactions) {
    if (!reactionMap[r.emoji]) reactionMap[r.emoji] = [];
    reactionMap[r.emoji].push(String(r.user_id));
  }

  const msg = db.prepare("SELECT conversation_id FROM messages WHERE id = ?").get(msgId) as { conversation_id: number } | undefined;
  if (msg) {
    emitMessageToParticipants(msg.conversation_id, "message:reaction", () => ({
      conversationId: msg.conversation_id, messageId: msgId, reactions: reactionMap,
    }));
  }
  res.json({ reactions: reactionMap });
});

router.put("/conversations/:id/mute", requireAuth, (req, res) => {
  const convId = Number(req.params.id);
  const row = db.prepare("SELECT muted FROM conversation_participants WHERE conversation_id = ? AND user_id = ?").get(convId, req.user!.id) as { muted: number } | undefined;
  if (!row) {
    res.status(403).json({ error: "Not a participant" });
    return;
  }
  const muted = row.muted === 1 ? 0 : 1;
  db.prepare("UPDATE conversation_participants SET muted = ? WHERE conversation_id = ? AND user_id = ?").run(muted, convId, req.user!.id);
  res.json({ muted: muted === 1 });
});

router.delete("/contacts/:contactId", requireAuth, (req, res) => {
  const convId = Number(req.params.contactId);
  db.prepare("DELETE FROM conversation_participants WHERE conversation_id = ? AND user_id = ?").run(convId, req.user!.id);
  res.json({ ok: true });
});

router.post("/conversations", requireAuth, (req, res) => {
  const { name, bio } = req.body;
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const npc = db.prepare("SELECT id, username, bio FROM users WHERE username = ? AND is_npc = 1 AND is_deleted = 0").get(name) as { id: number; username: string; bio: string } | undefined;
  const realUser = db.prepare("SELECT id, username, bio FROM users WHERE LOWER(username) = LOWER(?) AND is_npc = 0 AND is_deleted = 0 AND is_disabled = 0").get(name) as { id: number; username: string; bio: string } | undefined;
  const target = realUser || npc;

  if (target) {
    const existingDm = db.prepare(`
      SELECT c.id FROM conversations c
      JOIN conversation_participants cp1 ON cp1.conversation_id = c.id AND cp1.user_id = ?
      JOIN conversation_participants cp2 ON cp2.conversation_id = c.id AND cp2.user_id = ?
      WHERE c.type = 'dm'
      LIMIT 1
    `).get(req.user!.id, target.id) as { id: number } | undefined;

    if (existingDm) {
      const conv = db.prepare("SELECT * FROM conversations WHERE id = ?").get(existingDm.id) as { id: number; type: string; name: string; bio: string };
      res.json({ conversation: formatConversation(conv, req.user!.id) });
      return;
    }
  }

  const existing = db.prepare(`
    SELECT c.id FROM conversations c
    JOIN conversation_participants cp ON cp.conversation_id = c.id
    WHERE c.type = 'dm' AND c.name = ? AND cp.user_id = ?
  `).get(name, req.user!.id) as { id: number } | undefined;

  if (existing) {
    const conv = db.prepare("SELECT * FROM conversations WHERE id = ?").get(existing.id) as { id: number; type: string; name: string; bio: string };
    res.json({ conversation: formatConversation(conv, req.user!.id) });
    return;
  }

  const ts = now();
  const displayName = target?.username || name;
  const displayBio = bio || target?.bio || "";
  const result = db.prepare("INSERT INTO conversations (type, name, bio, created_at) VALUES ('dm', ?, ?, ?)").run(displayName, displayBio, ts);
  const convId = result.lastInsertRowid as number;
  db.prepare("INSERT INTO conversation_participants (conversation_id, user_id, joined_at) VALUES (?, ?, ?)").run(convId, req.user!.id, ts);
  if (target) {
    db.prepare("INSERT INTO conversation_participants (conversation_id, user_id, joined_at) VALUES (?, ?, ?)").run(convId, target.id, ts);
    if (realUser) {
      db.prepare("INSERT OR IGNORE INTO dm_contacts (user_id, contact_user_id, created_at) VALUES (?, ?, ?)").run(req.user!.id, target.id, ts);
      db.prepare("INSERT OR IGNORE INTO dm_contacts (user_id, contact_user_id, created_at) VALUES (?, ?, ?)").run(target.id, req.user!.id, ts);
    }
  }

  const conv = db.prepare("SELECT * FROM conversations WHERE id = ?").get(convId) as { id: number; type: string; name: string; bio: string };
  res.status(201).json({ conversation: formatConversation(conv, req.user!.id) });
});

router.post("/reports", requireAuth, (req, res) => {
  const { userId, messageId, reason } = req.body;
  db.prepare(`
    INSERT INTO reports (reporter_id, reported_user_id, message_id, reason, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.user!.id, userId || null, messageId || null, reason || "", now());
  res.status(201).json({ ok: true });
});

export default router;
