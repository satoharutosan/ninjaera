import { Router } from "express";
import { qGet, qAll, qRun } from "../db/query.js";
import { requireAuth, timeAgo } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { isUserActive } from "../middleware/admin.js";
import { logActivitySync } from "../services/activityLog.js";
import { emitToUser } from "../services/realtime.js";
import {
  canOpenDmWithoutRequest,
  usersAreBlocked,
} from "../services/conversationAccess.js";
import { acceptDmRequest, rejectDmRequest } from "../services/dmRequests.js";

const router = Router();
const now = () => new Date().toISOString();

async function findDmConversation(userId1: number, userId2: number): Promise<number | null> {
  const row = await qGet<{ id: number }>(`
    SELECT c.id FROM conversations c
    JOIN conversation_participants cp1 ON cp1.conversation_id = c.id AND cp1.user_id = ?
    JOIN conversation_participants cp2 ON cp2.conversation_id = c.id AND cp2.user_id = ?
    WHERE c.type = 'dm'
    LIMIT 1
  `, userId1, userId2);
  return row?.id ?? null;
}

async function addContact(userId: number, contactUserId: number) {
  const ts = now();
  await qRun("INSERT OR IGNORE INTO dm_contacts (user_id, contact_user_id, created_at) VALUES (?, ?, ?)", userId, contactUserId, ts);
  await qRun("INSERT OR IGNORE INTO dm_contacts (user_id, contact_user_id, created_at) VALUES (?, ?, ?)", contactUserId, userId, ts);
}

async function createDmConversation(userId1: number, userId2: number): Promise<number> {
  const existing = await findDmConversation(userId1, userId2);
  if (existing) return existing;

  const ts = now();
  const requester = await qGet<{ username: string; bio: string }>("SELECT username, bio FROM users WHERE id = ?", userId1);
  const result = await qRun("INSERT INTO conversations (type, name, bio, created_at) VALUES ('dm', ?, ?, ?)", requester!.username, requester!.bio || "", ts);
  const convId = Number(result.lastInsertRowid);
  await qRun("INSERT INTO conversation_participants (conversation_id, user_id, joined_at) VALUES (?, ?, ?)", convId, userId1, ts);
  await qRun("INSERT INTO conversation_participants (conversation_id, user_id, joined_at) VALUES (?, ?, ?)", convId, userId2, ts);
  await addContact(userId1, userId2);
  return convId;
}

// Search users by exact username (case-insensitive)
router.get("/user-search", requireAuth, async (req, res) => {
  const username = (req.query.username as string || "").trim();
  if (!username) {
    res.status(400).json({ error: "Username is required" });
    return;
  }

  const user = await qGet<{
    id: number; username: string; avatar_url: string | null; status: string; bio: string;
    country: string | null; city: string | null;
  }>(`
    SELECT id, username, avatar_url, status, bio, country, city
    FROM users
    WHERE LOWER(username) = LOWER(?) AND is_npc = 0 AND is_deleted = 0 AND is_disabled = 0
  `, username);

  if (!user) {
    res.status(404).json({ error: "No user found with that username" });
    return;
  }
  if (user.id === req.user!.id) {
    res.status(400).json({ error: "You cannot message yourself" });
    return;
  }

  if (await usersAreBlocked(req.user!.id, user.id)) {
    res.status(404).json({ error: "No user found with that username" });
    return;
  }

  res.json({
    user: {
      id: user.id,
      username: user.username,
      avatarUrl: user.avatar_url,
      status: user.status,
      bio: user.bio,
      country: user.country,
      city: user.city,
    },
  });
});

// Create DM request
router.post("/dm-requests", requireAuth, rateLimit({
  keyFn: (req) => `dm:request:${req.user!.id}`,
  max: 20,
  windowMs: 60 * 60 * 1000,
}), async (req, res) => {
  if (!isUserActive(req.user!)) {
    res.status(403).json({ error: "Account is disabled" });
    return;
  }

  const { username } = req.body;
  if (!username) {
    res.status(400).json({ error: "Username is required" });
    return;
  }

  const recipient = await qGet<{ id: number; username: string }>(`
    SELECT id, username FROM users
    WHERE LOWER(username) = LOWER(?) AND is_npc = 0 AND is_deleted = 0 AND is_disabled = 0
  `, username.trim());

  if (!recipient) {
    res.status(404).json({ error: "No user found with that username" });
    return;
  }
  if (recipient.id === req.user!.id) {
    res.status(400).json({ error: "You cannot message yourself" });
    return;
  }

  if (await usersAreBlocked(req.user!.id, recipient.id)) {
    res.status(403).json({ error: "You cannot message this user" });
    return;
  }

  const existingConv = await findDmConversation(req.user!.id, recipient.id);
  if (existingConv) {
    res.status(400).json({ error: "You already have a conversation with this user", conversationId: existingConv });
    return;
  }

  const existingContact = await qGet(`
    SELECT 1 FROM dm_contacts WHERE user_id = ? AND contact_user_id = ?
  `, req.user!.id, recipient.id);
  if (existingContact) {
    const convId = await createDmConversation(req.user!.id, recipient.id);
    res.json({ ok: true, conversationId: convId, existing: true });
    return;
  }

  const pending = await qGet<{ id: number }>(`
    SELECT id, status FROM dm_requests
    WHERE requester_id = ? AND recipient_id = ? AND status = 'pending'
  `, req.user!.id, recipient.id);
  if (pending) {
    res.status(400).json({ error: "A pending request already exists" });
    return;
  }

  // UNIQUE(requester_id, recipient_id) — reopen a prior rejected/accepted row as pending when no DM exists.
  const prior = await qGet<{ id: number; status: string }>(`
    SELECT id, status FROM dm_requests WHERE requester_id = ? AND recipient_id = ?
  `, req.user!.id, recipient.id);

  const ts = now();
  let requestId: number;
  if (prior) {
    await qRun(`
      UPDATE dm_requests SET status = 'pending', conversation_id = NULL, updated_at = ?, created_at = ?
      WHERE id = ?
    `, ts, ts, prior.id);
    requestId = prior.id;
  } else {
    const result = await qRun(`
      INSERT INTO dm_requests (requester_id, recipient_id, status, created_at, updated_at)
      VALUES (?, ?, 'pending', ?, ?)
    `, req.user!.id, recipient.id, ts, ts);
    requestId = Number(result.lastInsertRowid);
  }

  const requesterName = req.user!.username;
  await qRun(`
    INSERT INTO notifications (title, body, source, page, user_id, notif_type, metadata, created_at)
    VALUES (?, ?, 'Messages', 'messages', ?, 'dm_request', ?, ?)
  `,
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
// Snake_case aliases only — Postgres lowercases unquoted camelCase aliases.
router.get("/dm-requests", requireAuth, async (req, res) => {
  const incoming = await qAll<Record<string, unknown>>(`
    SELECT dr.id, dr.requester_id, dr.recipient_id, dr.status, dr.created_at, dr.updated_at,
           u.username AS requester_name,
           u.avatar_url AS requester_avatar,
           u.bio AS requester_bio,
           u.is_deleted AS requester_deleted
    FROM dm_requests dr
    LEFT JOIN users u ON u.id = dr.requester_id
    WHERE dr.recipient_id = ? AND dr.status = 'pending'
      AND (u.id IS NULL OR COALESCE(u.is_deleted, 0) = 0)
    ORDER BY dr.created_at DESC
  `, req.user!.id);

  const outgoing = await qAll<Record<string, unknown>>(`
    SELECT dr.id, dr.requester_id, dr.recipient_id, dr.status, dr.created_at, dr.updated_at,
           u.username AS recipient_name,
           u.avatar_url AS recipient_avatar,
           u.is_deleted AS recipient_deleted
    FROM dm_requests dr
    LEFT JOIN users u ON u.id = dr.recipient_id
    WHERE dr.requester_id = ? AND dr.status = 'pending'
      AND (u.id IS NULL OR COALESCE(u.is_deleted, 0) = 0)
    ORDER BY dr.created_at DESC
  `, req.user!.id);

  res.json({
    incoming: incoming.map(r => {
      const name = String(r.requester_name || "");
      return {
        id: r.id,
        requesterId: r.requester_id,
        requesterName: name,
        requesterAvatar: (r.requester_avatar as string | null) || null,
        requesterDisplayName: name,
        status: r.status,
        createdAt: r.created_at,
        time: timeAgo(r.created_at as string),
      };
    }),
    outgoing: outgoing.map(r => ({
      id: r.id,
      recipientId: r.recipient_id,
      recipientName: r.recipient_name,
      recipientAvatar: (r.recipient_avatar as string | null) || null,
      status: r.status,
      createdAt: r.created_at,
      time: timeAgo(r.created_at as string),
    })),
  });
});

// Accept DM request
router.post("/dm-requests/:id/accept", requireAuth, async (req, res) => {
  const requestId = Number(req.params.id);
  const result = await acceptDmRequest(requestId, req.user!.id, req.user!.username);
  if (!result.success) {
    res.status(result.status).json({ success: false, error: result.error });
    return;
  }
  res.json({
    success: true,
    ok: true,
    message: result.message,
    alreadyExists: result.alreadyExists ?? false,
    conversationId: result.conversationId,
    requestId: result.requestId,
    dm: result.dm,
  });
});

// Reject DM request
router.post("/dm-requests/:id/reject", requireAuth, async (req, res) => {
  const requestId = Number(req.params.id);
  const result = await rejectDmRequest(requestId, req.user!.id, req.user!.username);
  if (!result.success) {
    res.status(result.status).json({ success: false, error: result.error });
    return;
  }
  res.json({ success: true, ok: true, message: result.message, requestId: result.requestId });
});

// DM contacts list
router.get("/dm-contacts", requireAuth, async (req, res) => {
  const contacts = await qAll<{
    id: number; username: string; avatar_url: string | null; status: string; bio: string;
    country: string | null; city: string | null; added_at: string;
  }>(`
    SELECT u.id, u.username, u.avatar_url, u.status, u.bio, u.country, u.city, dc.created_at AS added_at
    FROM dm_contacts dc
    JOIN users u ON u.id = dc.contact_user_id
    WHERE dc.user_id = ? AND COALESCE(u.is_deleted, 0) = 0
    ORDER BY dc.created_at DESC
  `, req.user!.id);

  res.json({
    contacts: contacts.map(c => ({
      id: c.id,
      username: c.username,
      avatarUrl: c.avatar_url,
      status: c.status,
      bio: c.bio,
      country: c.country,
      city: c.city,
      addedAt: c.added_at,
    })),
  });
});

// Get or create conversation with contact (requires existing contact / accepted request)
router.post("/dm-conversations", requireAuth, rateLimit({
  keyFn: (req) => `dm:open:${req.user!.id}`,
  max: 40,
  windowMs: 60 * 60 * 1000,
}), async (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    res.status(400).json({ error: "userId is required" });
    return;
  }

  const other = await qGet<{ id: number; username: string }>("SELECT id, username FROM users WHERE id = ? AND is_deleted = 0 AND is_disabled = 0", userId);
  if (!other) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (await usersAreBlocked(req.user!.id, other.id)) {
    res.status(403).json({ error: "You cannot message this user" });
    return;
  }

  const existing = await findDmConversation(req.user!.id, other.id);
  if (existing) {
    res.json({ conversationId: existing });
    return;
  }

  if (!(await canOpenDmWithoutRequest(req.user!.id, other.id))) {
    res.status(403).json({
      error: "Send a message request first. Direct conversations require the other user to accept.",
      code: "DM_CONSENT_REQUIRED",
    });
    return;
  }

  const convId = await createDmConversation(req.user!.id, other.id);
  res.json({ conversationId: convId });
});

export default router;
