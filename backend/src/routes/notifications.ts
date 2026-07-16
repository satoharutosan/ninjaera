import { Router } from "express";
import { qGet, qAll, qRun } from "../db/query.js";
import { requireAuth, optionalAuth, timeAgo } from "../middleware/auth.js";
import { isAdmin, isTeamMember } from "../middleware/admin.js";
import { emitToUser, getConversationParticipantIds } from "../services/realtime.js";

const router = Router();
const now = () => new Date().toISOString();

async function userMatchesRecipient(userId: number, recipientType: string, recipientIds: number[]): Promise<boolean> {
  const user = await qGet<{ is_admin: number; is_team_member: number }>("SELECT is_admin, is_team_member FROM users WHERE id = ?", userId);
  if (!user) return false;

  switch (recipientType) {
    case "everyone": return true;
    case "users": return recipientIds.includes(userId);
    case "team": return user.is_team_member === 1;
    case "admins": return user.is_admin === 1;
    default: return true;
  }
}

router.get("/", optionalAuth, async (req, res) => {
  const userId = req.user?.id;

  const globalNotifs = await qAll<Record<string, unknown>>(`
    SELECT * FROM notifications WHERE user_id IS NULL ORDER BY pinned DESC, created_at DESC LIMIT 200
  `);

  let personalNotifs: Record<string, unknown>[] = [];
  if (userId) {
    personalNotifs = await qAll<Record<string, unknown>>(`
      SELECT * FROM notifications WHERE user_id = ? ORDER BY pinned DESC, created_at DESC LIMIT 200
    `, userId);
  }

  // Cache auth fields once for recipient matching instead of per-notification user lookup.
  const authUser = userId
    ? await qGet<{ is_admin: number; is_team_member: number }>("SELECT is_admin, is_team_member FROM users WHERE id = ?", userId)
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
    const rows = await qAll<{ notification_id: number }>(`
      SELECT notification_id FROM notification_reads
      WHERE user_id = ? AND notification_id IN (${ph})
    `, userId, ...ids);
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

router.patch("/:id/read", requireAuth, async (req, res) => {
  const notifId = Number(req.params.id);
  await qRun(`
    INSERT OR IGNORE INTO notification_reads (user_id, notification_id, read_at) VALUES (?, ?, ?)
  `, req.user!.id, notifId, now());
  res.json({ ok: true });
});

router.patch("/read-all", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const globalNotifs = await qAll<{ id: number; recipient_type: string; recipient_ids: string }>(
    "SELECT id, recipient_type, recipient_ids FROM notifications WHERE user_id IS NULL",
  );
  const personalNotifs = await qAll<{ id: number }>("SELECT id FROM notifications WHERE user_id = ?", userId);

  const ts = now();

  for (const n of personalNotifs) {
    await qRun("INSERT OR IGNORE INTO notification_reads (user_id, notification_id, read_at) VALUES (?, ?, ?)", userId, n.id, ts);
  }
  for (const n of globalNotifs) {
    const recipientIds = JSON.parse(n.recipient_ids || "[]") as number[];
    if (await userMatchesRecipient(userId, n.recipient_type || "everyone", recipientIds)) {
      await qRun("INSERT OR IGNORE INTO notification_reads (user_id, notification_id, read_at) VALUES (?, ?, ?)", userId, n.id, ts);
    }
  }
  res.json({ ok: true });
});

// DM request actions via notification
router.post("/:id/dm-accept", requireAuth, async (req, res) => {
  const notifId = Number(req.params.id);
  const notif = await qGet<{ notif_type: string; metadata: string }>("SELECT * FROM notifications WHERE id = ? AND user_id = ?", notifId, req.user!.id);
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
  const request = await qGet<{ id: number; requester_id: number; recipient_id: number }>(`
    SELECT * FROM dm_requests WHERE id = ? AND recipient_id = ? AND status = 'pending'
  `, requestId, req.user!.id);

  if (!request) {
    res.status(404).json({ error: "Request not found" });
    return;
  }

  const requester = await qGet<{ id: number; username: string; bio: string; is_deleted: number }>(
    "SELECT id, username, bio, is_deleted FROM users WHERE id = ?", request.requester_id,
  );
  if (!requester || requester.is_deleted === 1) {
    const tsGone = now();
    await qRun("UPDATE dm_requests SET status = 'rejected', updated_at = ? WHERE id = ?", tsGone, requestId);
    await qRun("UPDATE notifications SET metadata = ? WHERE id = ?", JSON.stringify({ ...metadata, processed: true }), notifId);
    res.status(410).json({ error: "This user no longer exists" });
    return;
  }

  const findDm = async (u1: number, u2: number) => {
    const row = await qGet<{ id: number }>(`
      SELECT c.id FROM conversations c
      JOIN conversation_participants cp1 ON cp1.conversation_id = c.id AND cp1.user_id = ?
      JOIN conversation_participants cp2 ON cp2.conversation_id = c.id AND cp2.user_id = ?
      WHERE c.type = 'dm' LIMIT 1
    `, u1, u2);
    return row?.id ?? null;
  };

  let convId = await findDm(request.requester_id, request.recipient_id);
  const ts = now();
  if (!convId) {
    const result = await qRun("INSERT INTO conversations (type, name, bio, created_at) VALUES ('dm', ?, ?, ?)", requester.username, requester.bio || "", ts);
    convId = result.lastInsertRowid as number;
    await qRun("INSERT INTO conversation_participants (conversation_id, user_id, joined_at) VALUES (?, ?, ?)", convId, request.requester_id, ts);
    await qRun("INSERT INTO conversation_participants (conversation_id, user_id, joined_at) VALUES (?, ?, ?)", convId, request.recipient_id, ts);
    await qRun("INSERT OR IGNORE INTO dm_contacts (user_id, contact_user_id, created_at) VALUES (?, ?, ?)", request.requester_id, request.recipient_id, ts);
    await qRun("INSERT OR IGNORE INTO dm_contacts (user_id, contact_user_id, created_at) VALUES (?, ?, ?)", request.recipient_id, request.requester_id, ts);
  }

  await qRun("UPDATE dm_requests SET status = 'accepted', conversation_id = ?, updated_at = ? WHERE id = ?", convId, ts, requestId);
  await qRun("UPDATE notifications SET metadata = ? WHERE id = ?", JSON.stringify({ ...metadata, processed: true }), notifId);
  await qRun(`
    INSERT INTO notifications (title, body, source, page, user_id, notif_type, created_at)
    VALUES ('Request Accepted', ?, 'Messages', 'messages', ?, 'announcement', ?)
  `, `${req.user!.username} accepted your direct message request.`, request.requester_id, ts);

  for (const pid of await getConversationParticipantIds(convId)) {
    emitToUser(pid, "conversation:new", { conversationId: convId });
    emitToUser(pid, "conversation:update", { conversationId: convId });
  }
  emitToUser(request.requester_id, "notification:new", {});
  emitToUser(request.requester_id, "counts:update", {});
  emitToUser(req.user!.id, "dm_request:resolved", { requestId });
  emitToUser(req.user!.id, "counts:update", {});

  res.json({ ok: true, conversationId: convId });
});

router.post("/:id/dm-reject", requireAuth, async (req, res) => {
  const notifId = Number(req.params.id);
  const notif = await qGet<{ notif_type: string; metadata: string }>("SELECT * FROM notifications WHERE id = ? AND user_id = ?", notifId, req.user!.id);
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
  await qRun("UPDATE dm_requests SET status = 'rejected', updated_at = ? WHERE id = ? AND recipient_id = ?", ts, requestId, req.user!.id);
  await qRun("UPDATE notifications SET metadata = ? WHERE id = ?", JSON.stringify({ ...metadata, processed: true }), notifId);

  const request = await qGet<{ requester_id: number }>("SELECT requester_id FROM dm_requests WHERE id = ?", requestId);
  if (request) {
    await qRun(`
      INSERT INTO notifications (title, body, source, page, user_id, notif_type, created_at)
      VALUES ('Request Declined', ?, 'Messages', 'messages', ?, 'announcement', ?)
    `, `${req.user!.username} declined your direct message request.`, request.requester_id, ts);
    emitToUser(request.requester_id, "notification:new", {});
    emitToUser(request.requester_id, "counts:update", {});
  }

  emitToUser(req.user!.id, "dm_request:resolved", { requestId });
  emitToUser(req.user!.id, "counts:update", {});

  res.json({ ok: true });
});

export default router;
