import { Router } from "express";
import { db } from "../db/index.js";
import { requireAuth, timeAgo } from "../middleware/auth.js";
import { isUserActive } from "../middleware/admin.js";
import { logActivitySync } from "../services/activityLog.js";
import { emitToUser, getConversationParticipantIds } from "../services/realtime.js";

const router = Router();
const now = () => new Date().toISOString();

function findDmConversation(userId1: number, userId2: number): number | null {
  const row = db.prepare(`
    SELECT c.id FROM conversations c
    JOIN conversation_participants cp1 ON cp1.conversation_id = c.id AND cp1.user_id = ?
    JOIN conversation_participants cp2 ON cp2.conversation_id = c.id AND cp2.user_id = ?
    WHERE c.type = 'dm'
    LIMIT 1
  `).get(userId1, userId2) as { id: number } | undefined;
  return row?.id ?? null;
}

function addContact(userId: number, contactUserId: number) {
  const ts = now();
  db.prepare("INSERT OR IGNORE INTO dm_contacts (user_id, contact_user_id, created_at) VALUES (?, ?, ?)").run(userId, contactUserId, ts);
  db.prepare("INSERT OR IGNORE INTO dm_contacts (user_id, contact_user_id, created_at) VALUES (?, ?, ?)").run(contactUserId, userId, ts);
}

function createDmConversation(userId1: number, userId2: number): number {
  const existing = findDmConversation(userId1, userId2);
  if (existing) return existing;

  const ts = now();
  const requester = db.prepare("SELECT username, bio FROM users WHERE id = ?").get(userId1) as { username: string; bio: string };
  const result = db.prepare("INSERT INTO conversations (type, name, bio, created_at) VALUES ('dm', ?, ?, ?)").run(requester.username, requester.bio || "", ts);
  const convId = result.lastInsertRowid as number;
  db.prepare("INSERT INTO conversation_participants (conversation_id, user_id, joined_at) VALUES (?, ?, ?)").run(convId, userId1, ts);
  db.prepare("INSERT INTO conversation_participants (conversation_id, user_id, joined_at) VALUES (?, ?, ?)").run(convId, userId2, ts);
  addContact(userId1, userId2);
  return convId;
}

// Search users by exact username (case-insensitive)
router.get("/user-search", requireAuth, (req, res) => {
  const username = (req.query.username as string || "").trim();
  if (!username) {
    res.status(400).json({ error: "Username is required" });
    return;
  }

  const user = db.prepare(`
    SELECT id, username, avatar_url as avatarUrl, status, bio, country, city
    FROM users
    WHERE LOWER(username) = LOWER(?) AND is_npc = 0 AND is_deleted = 0 AND is_disabled = 0
  `).get(username) as { id: number; username: string; avatarUrl: string | null; status: string; bio: string } | undefined;

  if (!user) {
    res.status(404).json({ error: "No user found with that username" });
    return;
  }
  if (user.id === req.user!.id) {
    res.status(400).json({ error: "You cannot message yourself" });
    return;
  }

  res.json({ user });
});

// Create DM request
router.post("/dm-requests", requireAuth, (req, res) => {
  if (!isUserActive(req.user!)) {
    res.status(403).json({ error: "Account is disabled" });
    return;
  }

  const { username } = req.body;
  if (!username) {
    res.status(400).json({ error: "Username is required" });
    return;
  }

  const recipient = db.prepare(`
    SELECT id, username FROM users
    WHERE LOWER(username) = LOWER(?) AND is_npc = 0 AND is_deleted = 0 AND is_disabled = 0
  `).get(username.trim()) as { id: number; username: string } | undefined;

  if (!recipient) {
    res.status(404).json({ error: "No user found with that username" });
    return;
  }
  if (recipient.id === req.user!.id) {
    res.status(400).json({ error: "You cannot message yourself" });
    return;
  }

  const existingConv = findDmConversation(req.user!.id, recipient.id);
  if (existingConv) {
    res.status(400).json({ error: "You already have a conversation with this user", conversationId: existingConv });
    return;
  }

  const existingContact = db.prepare(`
    SELECT 1 FROM dm_contacts WHERE user_id = ? AND contact_user_id = ?
  `).get(req.user!.id, recipient.id);
  if (existingContact) {
    const convId = createDmConversation(req.user!.id, recipient.id);
    res.json({ ok: true, conversationId: convId, existing: true });
    return;
  }

  const pending = db.prepare(`
    SELECT id, status FROM dm_requests
    WHERE requester_id = ? AND recipient_id = ? AND status = 'pending'
  `).get(req.user!.id, recipient.id) as { id: number } | undefined;
  if (pending) {
    res.status(400).json({ error: "A pending request already exists" });
    return;
  }

  const ts = now();
  const result = db.prepare(`
    INSERT INTO dm_requests (requester_id, recipient_id, status, created_at, updated_at)
    VALUES (?, ?, 'pending', ?, ?)
  `).run(req.user!.id, recipient.id, ts, ts);
  const requestId = result.lastInsertRowid as number;

  const requesterName = req.user!.username;
  db.prepare(`
    INSERT INTO notifications (title, body, source, page, user_id, notif_type, metadata, created_at)
    VALUES (?, ?, 'Messages', 'messages', ?, 'dm_request', ?, ?)
  `).run(
    "Direct Message Request",
    `${requesterName} wants to start a direct message with you.`,
    recipient.id,
    JSON.stringify({ requestId, requesterId: req.user!.id, requesterName }),
    ts,
  );

  res.status(201).json({ ok: true, requestId });
  logActivitySync({ req, userId: req.user!.id, eventType: "dm_request", eventCategory: "messaging", description: `Sent DM request to ${recipient.username}`, affectedObject: `dm_request:${requestId}` });
  emitToUser(recipient.id, "dm_request:new", { requestId });
  emitToUser(recipient.id, "notification:new", {});
  emitToUser(recipient.id, "counts:update", {});
});

// List pending requests (incoming for current user)
router.get("/dm-requests", requireAuth, (req, res) => {
  const incoming = db.prepare(`
    SELECT dr.*, u.username as requesterName, u.avatar_url as requesterAvatar, u.bio as requesterBio
    FROM dm_requests dr
    JOIN users u ON u.id = dr.requester_id
    WHERE dr.recipient_id = ? AND dr.status = 'pending'
    ORDER BY dr.created_at DESC
  `).all(req.user!.id) as Record<string, unknown>[];

  const outgoing = db.prepare(`
    SELECT dr.*, u.username as recipientName
    FROM dm_requests dr
    JOIN users u ON u.id = dr.recipient_id
    WHERE dr.requester_id = ? AND dr.status = 'pending'
    ORDER BY dr.created_at DESC
  `).all(req.user!.id) as Record<string, unknown>[];

  res.json({
    incoming: incoming.map(r => ({
      id: r.id,
      requesterId: r.requester_id,
      requesterName: r.requesterName,
      requesterAvatar: r.requesterAvatar,
      requesterDisplayName: r.requesterBio ? String(r.requesterName) : r.requesterName,
      status: r.status,
      createdAt: r.created_at,
      time: timeAgo(r.created_at as string),
    })),
    outgoing: outgoing.map(r => ({
      id: r.id,
      recipientId: r.recipient_id,
      recipientName: r.recipientName,
      status: r.status,
      createdAt: r.created_at,
      time: timeAgo(r.created_at as string),
    })),
  });
});

// Accept DM request
router.post("/dm-requests/:id/accept", requireAuth, (req, res) => {
  const requestId = Number(req.params.id);
  const request = db.prepare(`
    SELECT * FROM dm_requests WHERE id = ? AND recipient_id = ? AND status = 'pending'
  `).get(requestId, req.user!.id) as { id: number; requester_id: number; recipient_id: number } | undefined;

  if (!request) {
    res.status(404).json({ error: "Request not found" });
    return;
  }

  const convId = createDmConversation(request.requester_id, request.recipient_id);
  const ts = now();

  db.prepare("UPDATE dm_requests SET status = 'accepted', conversation_id = ?, updated_at = ? WHERE id = ?").run(convId, ts, requestId);

  db.prepare(`
    UPDATE notifications SET metadata = json_set(COALESCE(metadata, '{}'), '$.processed', true)
    WHERE notif_type = 'dm_request' AND json_extract(metadata, '$.requestId') = ?
  `).run(requestId);

  db.prepare(`
    INSERT INTO notifications (title, body, source, page, user_id, notif_type, created_at)
    VALUES ('Request Accepted', ?, 'Messages', 'messages', ?, 'announcement', ?)
  `).run(`${req.user!.username} accepted your direct message request.`, request.requester_id, ts);

  for (const pid of getConversationParticipantIds(convId)) {
    emitToUser(pid, "conversation:new", { conversationId: convId });
    emitToUser(pid, "conversation:update", { conversationId: convId });
  }
  emitToUser(request.requester_id, "notification:new", {});
  emitToUser(request.requester_id, "counts:update", {});
  emitToUser(req.user!.id, "dm_request:resolved", { requestId });
  emitToUser(req.user!.id, "counts:update", {});

  res.json({ ok: true, conversationId: convId });
});

// Reject DM request
router.post("/dm-requests/:id/reject", requireAuth, (req, res) => {
  const requestId = Number(req.params.id);
  const request = db.prepare(`
    SELECT * FROM dm_requests WHERE id = ? AND recipient_id = ? AND status = 'pending'
  `).get(requestId, req.user!.id) as { id: number; requester_id: number } | undefined;

  if (!request) {
    res.status(404).json({ error: "Request not found" });
    return;
  }

  const ts = now();
  db.prepare("UPDATE dm_requests SET status = 'rejected', updated_at = ? WHERE id = ?").run(ts, requestId);

  db.prepare(`
    UPDATE notifications SET metadata = json_set(COALESCE(metadata, '{}'), '$.processed', true)
    WHERE notif_type = 'dm_request' AND json_extract(metadata, '$.requestId') = ?
  `).run(requestId);

  db.prepare(`
    INSERT INTO notifications (title, body, source, page, user_id, notif_type, created_at)
    VALUES ('Request Declined', ?, 'Messages', 'messages', ?, 'announcement', ?)
  `).run(`${req.user!.username} declined your direct message request.`, request.requester_id, ts);

  emitToUser(request.requester_id, "notification:new", {});
  emitToUser(request.requester_id, "counts:update", {});
  emitToUser(req.user!.id, "dm_request:resolved", { requestId });
  emitToUser(req.user!.id, "counts:update", {});

  res.json({ ok: true });
});

// DM contacts list
router.get("/dm-contacts", requireAuth, (req, res) => {
  const contacts = db.prepare(`
    SELECT u.id, u.username, u.avatar_url as avatarUrl, u.status, u.bio, u.country, u.city, dc.created_at as addedAt
    FROM dm_contacts dc
    JOIN users u ON u.id = dc.contact_user_id
    WHERE dc.user_id = ? AND u.is_deleted = 0
    ORDER BY dc.created_at DESC
  `).all(req.user!.id);

  res.json({ contacts });
});

// Get or create conversation with contact
router.post("/dm-conversations", requireAuth, (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    res.status(400).json({ error: "userId is required" });
    return;
  }

  const other = db.prepare("SELECT id, username FROM users WHERE id = ? AND is_deleted = 0 AND is_disabled = 0").get(userId) as { id: number; username: string } | undefined;
  if (!other) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const convId = createDmConversation(req.user!.id, other.id);
  res.json({ conversationId: convId });
});

export default router;
