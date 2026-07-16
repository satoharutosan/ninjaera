import { Router } from "express";
import { qGet, qAll, qRun } from "../db/query.js";
import { requireAuth, optionalAuth, timeAgo } from "../middleware/auth.js";
import { isAdmin, isTeamMember } from "../middleware/admin.js";
import { emitToUser } from "../services/realtime.js";
import { acceptDmRequest, rejectDmRequest } from "../services/dmRequests.js";

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
  const notif = await qGet<{ notif_type: string; metadata: string }>(
    "SELECT * FROM notifications WHERE id = ? AND user_id = ?",
    notifId,
    req.user!.id,
  );
  if (!notif || notif.notif_type !== "dm_request") {
    res.status(404).json({ success: false, error: "Notification not found" });
    return;
  }
  let metadata: { requestId?: number; processed?: boolean } = {};
  try {
    metadata = JSON.parse(notif.metadata || "{}");
  } catch {
    metadata = {};
  }
  const requestId = Number(metadata.requestId);
  if (!requestId) {
    res.status(400).json({ success: false, error: "Invalid notification" });
    return;
  }

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

router.post("/:id/dm-reject", requireAuth, async (req, res) => {
  const notifId = Number(req.params.id);
  const notif = await qGet<{ notif_type: string; metadata: string }>(
    "SELECT * FROM notifications WHERE id = ? AND user_id = ?",
    notifId,
    req.user!.id,
  );
  if (!notif || notif.notif_type !== "dm_request") {
    res.status(404).json({ success: false, error: "Notification not found" });
    return;
  }
  let metadata: { requestId?: number } = {};
  try {
    metadata = JSON.parse(notif.metadata || "{}");
  } catch {
    metadata = {};
  }
  const requestId = Number(metadata.requestId);
  if (!requestId) {
    res.status(400).json({ success: false, error: "Invalid notification" });
    return;
  }

  const result = await rejectDmRequest(requestId, req.user!.id, req.user!.username);
  if (!result.success) {
    res.status(result.status).json({ success: false, error: result.error });
    return;
  }
  res.json({ success: true, ok: true, message: result.message, requestId: result.requestId });
});

export default router;
