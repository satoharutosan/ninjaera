import { Router } from "express";
import { db } from "../db/index.js";
import { requireAuth, optionalAuth, timeAgo } from "../middleware/auth.js";
import { isAdmin, isTeamMember } from "../middleware/admin.js";
import { emitToUser, getConversationParticipantIds } from "../services/realtime.js";

const router = Router();
const now = () => new Date().toISOString();

function userMatchesRecipient(userId: number, recipientType: string, recipientIds: number[]): boolean {
  const user = db.prepare("SELECT is_admin, is_team_member FROM users WHERE id = ?").get(userId) as { is_admin: number; is_team_member: number } | undefined;
  if (!user) return false;

  switch (recipientType) {
    case "everyone": return true;
    case "users": return recipientIds.includes(userId);
    case "team": return user.is_team_member === 1;
    case "admins": return user.is_admin === 1;
    default: return true;
  }
}

router.get("/", optionalAuth, (req, res) => {
  const userId = req.user?.id;

  const globalNotifs = db.prepare(`
    SELECT * FROM notifications WHERE user_id IS NULL ORDER BY pinned DESC, created_at DESC LIMIT 200
  `).all() as Record<string, unknown>[];

  let personalNotifs: Record<string, unknown>[] = [];
  if (userId) {
    personalNotifs = db.prepare(`
      SELECT * FROM notifications WHERE user_id = ? ORDER BY pinned DESC, created_at DESC LIMIT 200
    `).all(userId) as Record<string, unknown>[];
  }

  // Cache auth fields once for recipient matching instead of per-notification user lookup.
  const authUser = userId
    ? db.prepare("SELECT is_admin, is_team_member FROM users WHERE id = ?").get(userId) as { is_admin: number; is_team_member: number } | undefined
    : undefined;

  const matchesRecipient = (recipientType: string, recipientIds: number[]) => {
    if (!userId) return recipientType === "everyone";
    if (!authUser) return false;
    switch (recipientType) {
      case "everyone": return true;
      case "users": return recipientIds.includes(userId);
      case "team": return authUser.is_team_member === 1;
      case "admins": return authUser.is_admin === 1;
      default: return true;
    }
  };

  const allNotifs = [...personalNotifs, ...globalNotifs.filter(n => {
    const recipientType = (n.recipient_type as string) || "everyone";
    const recipientIds = JSON.parse((n.recipient_ids as string) || "[]") as number[];
    return matchesRecipient(recipientType, recipientIds);
  })];

  const seen = new Set<number>();
  const unique = allNotifs.filter(n => {
    const id = n.id as number;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const readIds = new Set<number>();
  if (userId && unique.length) {
    const ids = unique.map(n => n.id as number);
    const ph = ids.map(() => "?").join(",");
    const rows = db.prepare(`
      SELECT notification_id FROM notification_reads
      WHERE user_id = ? AND notification_id IN (${ph})
    `).all(userId, ...ids) as { notification_id: number }[];
    for (const r of rows) readIds.add(r.notification_id);
  }

  const result = unique.map(n => {
    const metadata = JSON.parse((n.metadata as string) || "{}");
    return {
      id: n.id,
      title: n.title,
      body: n.body,
      time: timeAgo(n.created_at as string),
      read: userId ? readIds.has(n.id as number) : false,
      page: n.page,
      source: n.source,
      pinned: n.pinned === 1,
      notifType: n.notif_type || "announcement",
      metadata,
    };
  });

  res.json({ notifications: result });
});

router.patch("/:id/read", requireAuth, (req, res) => {
  const notifId = Number(req.params.id);
  db.prepare(`
    INSERT OR IGNORE INTO notification_reads (user_id, notification_id, read_at) VALUES (?, ?, ?)
  `).run(req.user!.id, notifId, now());
  res.json({ ok: true });
});

router.patch("/read-all", requireAuth, (req, res) => {
  const userId = req.user!.id;
  const globalNotifs = db.prepare("SELECT id, recipient_type, recipient_ids FROM notifications WHERE user_id IS NULL").all() as { id: number; recipient_type: string; recipient_ids: string }[];
  const personalNotifs = db.prepare("SELECT id FROM notifications WHERE user_id = ?").all(userId) as { id: number }[];

  const insert = db.prepare("INSERT OR IGNORE INTO notification_reads (user_id, notification_id, read_at) VALUES (?, ?, ?)");
  const ts = now();

  for (const n of personalNotifs) insert.run(userId, n.id, ts);
  for (const n of globalNotifs) {
    const recipientIds = JSON.parse(n.recipient_ids || "[]") as number[];
    if (userMatchesRecipient(userId, n.recipient_type || "everyone", recipientIds)) {
      insert.run(userId, n.id, ts);
    }
  }
  res.json({ ok: true });
});

// DM request actions via notification
router.post("/:id/dm-accept", requireAuth, (req, res) => {
  const notifId = Number(req.params.id);
  const notif = db.prepare("SELECT * FROM notifications WHERE id = ? AND user_id = ?").get(notifId, req.user!.id) as { notif_type: string; metadata: string } | undefined;
  if (!notif || notif.notif_type !== "dm_request") {
    res.status(404).json({ error: "Notification not found" });
    return;
  }
  const metadata = JSON.parse(notif.metadata || "{}");
  if (metadata.processed) {
    res.status(400).json({ error: "Request already processed" });
    return;
  }
  const requestId = metadata.requestId;
  if (!requestId) {
    res.status(400).json({ error: "Invalid notification" });
    return;
  }

  // Accept DM request via notification action
  const request = db.prepare(`
    SELECT * FROM dm_requests WHERE id = ? AND recipient_id = ? AND status = 'pending'
  `).get(requestId, req.user!.id) as { id: number; requester_id: number; recipient_id: number } | undefined;

  if (!request) {
    res.status(404).json({ error: "Request not found" });
    return;
  }

  const findDm = (u1: number, u2: number) => {
    const row = db.prepare(`
      SELECT c.id FROM conversations c
      JOIN conversation_participants cp1 ON cp1.conversation_id = c.id AND cp1.user_id = ?
      JOIN conversation_participants cp2 ON cp2.conversation_id = c.id AND cp2.user_id = ?
      WHERE c.type = 'dm' LIMIT 1
    `).get(u1, u2) as { id: number } | undefined;
    return row?.id ?? null;
  };

  let convId = findDm(request.requester_id, request.recipient_id);
  const ts = now();
  if (!convId) {
    const other = db.prepare("SELECT username, bio FROM users WHERE id = ?").get(request.requester_id) as { username: string; bio: string };
    const result = db.prepare("INSERT INTO conversations (type, name, bio, created_at) VALUES ('dm', ?, ?, ?)").run(other.username, other.bio || "", ts);
    convId = result.lastInsertRowid as number;
    db.prepare("INSERT INTO conversation_participants (conversation_id, user_id, joined_at) VALUES (?, ?, ?)").run(convId, request.requester_id, ts);
    db.prepare("INSERT INTO conversation_participants (conversation_id, user_id, joined_at) VALUES (?, ?, ?)").run(convId, request.recipient_id, ts);
    db.prepare("INSERT OR IGNORE INTO dm_contacts (user_id, contact_user_id, created_at) VALUES (?, ?, ?)").run(request.requester_id, request.recipient_id, ts);
    db.prepare("INSERT OR IGNORE INTO dm_contacts (user_id, contact_user_id, created_at) VALUES (?, ?, ?)").run(request.recipient_id, request.requester_id, ts);
  }

  db.prepare("UPDATE dm_requests SET status = 'accepted', conversation_id = ?, updated_at = ? WHERE id = ?").run(convId, ts, requestId);
  db.prepare("UPDATE notifications SET metadata = ? WHERE id = ?").run(JSON.stringify({ ...metadata, processed: true }), notifId);
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

router.post("/:id/dm-reject", requireAuth, (req, res) => {
  const notifId = Number(req.params.id);
  const notif = db.prepare("SELECT * FROM notifications WHERE id = ? AND user_id = ?").get(notifId, req.user!.id) as { notif_type: string; metadata: string } | undefined;
  if (!notif || notif.notif_type !== "dm_request") {
    res.status(404).json({ error: "Notification not found" });
    return;
  }
  const metadata = JSON.parse(notif.metadata || "{}");
  if (metadata.processed) {
    res.status(400).json({ error: "Request already processed" });
    return;
  }
  const requestId = metadata.requestId;
  const ts = now();
  db.prepare("UPDATE dm_requests SET status = 'rejected', updated_at = ? WHERE id = ? AND recipient_id = ?").run(ts, requestId, req.user!.id);
  db.prepare("UPDATE notifications SET metadata = ? WHERE id = ?").run(JSON.stringify({ ...metadata, processed: true }), notifId);

  const request = db.prepare("SELECT requester_id FROM dm_requests WHERE id = ?").get(requestId) as { requester_id: number } | undefined;
  if (request) {
    db.prepare(`
      INSERT INTO notifications (title, body, source, page, user_id, notif_type, created_at)
      VALUES ('Request Declined', ?, 'Messages', 'messages', ?, 'announcement', ?)
    `).run(`${req.user!.username} declined your direct message request.`, request.requester_id, ts);
    emitToUser(request.requester_id, "notification:new", {});
    emitToUser(request.requester_id, "counts:update", {});
  }

  emitToUser(req.user!.id, "dm_request:resolved", { requestId });
  emitToUser(req.user!.id, "counts:update", {});

  res.json({ ok: true });
});

export default router;
