import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db } from "../db/index.js";
import { requireAuth, publicUser, timeAgo } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/admin.js";
import { logActivitySync } from "../services/activityLog.js";
import { emitToAdmins, emitToUser, broadcast } from "../services/realtime.js";
import { isUserOnline } from "../services/presence.js";
import { syncPrivateChannelParticipants, syncPublicChannels, syncPrivateChannelsForUser } from "../services/channels.js";

const router = Router();
const now = () => new Date().toISOString();

const uploadDir = process.env.UPLOAD_DIR || "./uploads";
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `resource-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

const gameStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `game-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const gameUpload = multer({ storage: gameStorage, limits: { fileSize: 500 * 1024 * 1024 } });

router.use(requireAuth, requireAdmin);

// ── Dashboard ────────────────────────────────────────────────────────────────
router.get("/stats", (_req, res) => {
  const totalUsers = (db.prepare("SELECT COUNT(*) as c FROM users WHERE is_npc = 0 AND is_deleted = 0").get() as { c: number }).c;
  const allUsers = db.prepare("SELECT is_online, last_seen_at, is_admin, is_team_member FROM users WHERE is_npc = 0 AND is_deleted = 0").all() as {
    is_online: number; last_seen_at: string | null; is_admin: number; is_team_member: number;
  }[];
  const onlineUsers = allUsers.filter(u => isUserOnline(u)).length;
  const totalChannels = (db.prepare("SELECT COUNT(*) as c FROM conversations WHERE type = 'channel' AND archived = 0").get() as { c: number }).c;
  const totalDms = (db.prepare("SELECT COUNT(*) as c FROM conversations WHERE type = 'dm'").get() as { c: number }).c;
  const pendingApplications = (db.prepare("SELECT COUNT(*) as c FROM job_applications WHERE status = 'pending'").get() as { c: number }).c;
  const approvedApplications = (db.prepare("SELECT COUNT(*) as c FROM job_applications WHERE status = 'approved'").get() as { c: number }).c;
  const rejectedApplications = (db.prepare("SELECT COUNT(*) as c FROM job_applications WHERE status = 'rejected'").get() as { c: number }).c;
  const teamMembers = (db.prepare("SELECT COUNT(*) as c FROM users WHERE is_team_member = 1 AND is_deleted = 0").get() as { c: number }).c;
  const unreadNotifications = (db.prepare(`
    SELECT COUNT(*) as c FROM notifications n
    WHERE n.user_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM notification_reads nr WHERE nr.notification_id = n.id)
  `).get() as { c: number }).c;
  const unreadContacts = (db.prepare("SELECT COUNT(*) as c FROM contact_tickets WHERE is_read = 0").get() as { c: number }).c;
  const totalContacts = (db.prepare("SELECT COUNT(*) as c FROM contact_tickets").get() as { c: number }).c;
  const repliedContacts = (db.prepare("SELECT COUNT(*) as c FROM contact_tickets WHERE reply_status = 'replied'").get() as { c: number }).c;
  const pendingContactReplies = (db.prepare("SELECT COUNT(*) as c FROM contact_tickets WHERE reply_status = 'pending'").get() as { c: number }).c;

  const totalMessages = (db.prepare("SELECT COUNT(*) as c FROM messages").get() as { c: number }).c;
  const pendingDmRequests = (db.prepare("SELECT COUNT(*) as c FROM dm_requests WHERE status = 'pending'").get() as { c: number }).c;
  const totalResources = (db.prepare("SELECT COUNT(*) as c FROM resources").get() as { c: number }).c;
  const totalDownloads = (db.prepare(`
    SELECT COUNT(*) as c FROM activity_logs
    WHERE event_category = 'downloads' AND result = 'success'
  `).get() as { c: number }).c;
  const adminCount = allUsers.filter(u => u.is_admin === 1).length;
  const teamCount = allUsers.filter(u => u.is_team_member === 1 && u.is_admin !== 1).length;
  const registeredCount = Math.max(0, totalUsers - adminCount - teamCount);

  const dayKeys: string[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    dayKeys.push(d.toISOString().slice(0, 10));
  }

  const registrationsByDay = Object.fromEntries(
    (db.prepare(`
      SELECT substr(created_at, 1, 10) as d, COUNT(*) as c
      FROM users
      WHERE is_npc = 0 AND is_deleted = 0 AND created_at >= date('now', '-13 days')
      GROUP BY substr(created_at, 1, 10)
    `).all() as { d: string; c: number }[]).map(r => [r.d, r.c])
  );

  const messagesByDay = Object.fromEntries(
    (db.prepare(`
      SELECT substr(created_at, 1, 10) as d, COUNT(*) as c
      FROM messages
      WHERE created_at >= date('now', '-13 days')
      GROUP BY substr(created_at, 1, 10)
    `).all() as { d: string; c: number }[]).map(r => [r.d, r.c])
  );

  const loginsByDay = Object.fromEntries(
    (db.prepare(`
      SELECT substr(timestamp, 1, 10) as d, COUNT(*) as c
      FROM activity_logs
      WHERE event_type IN ('login', 'register') AND timestamp >= date('now', '-13 days')
      GROUP BY substr(timestamp, 1, 10)
    `).all() as { d: string; c: number }[]).map(r => [r.d, r.c])
  );

  const downloadsByDay = Object.fromEntries(
    (db.prepare(`
      SELECT substr(timestamp, 1, 10) as d, COUNT(*) as c
      FROM activity_logs
      WHERE event_category = 'downloads' AND result = 'success' AND timestamp >= date('now', '-13 days')
      GROUP BY substr(timestamp, 1, 10)
    `).all() as { d: string; c: number }[]).map(r => [r.d, r.c])
  );

  const userGrowth = dayKeys.map(date => ({
    date,
    label: date.slice(5),
    count: registrationsByDay[date] || 0,
  }));

  const activityTimeline = dayKeys.map(date => ({
    date,
    label: date.slice(5),
    messages: messagesByDay[date] || 0,
    downloads: downloadsByDay[date] || 0,
    logins: loginsByDay[date] || 0,
  }));

  const downloadsByPlatform = (["windows", "android", "ios"] as const).map(platform => {
    const count = (db.prepare(`
      SELECT COUNT(*) as c FROM activity_logs
      WHERE event_type = 'game_download' AND result = 'success'
        AND (description LIKE ? OR affected_object LIKE ?)
    `).get(`%${platform}%`, `%${platform}%`) as { c: number }).c;
    return { platform, label: platform.charAt(0).toUpperCase() + platform.slice(1), count };
  });

  const mostDownloadedResource = db.prepare(`
    SELECT r.title as title, COUNT(*) as downloads
    FROM activity_logs al
    JOIN resources r ON al.affected_object = 'resource:' || r.id
    WHERE al.event_type = 'resource_download' AND al.result = 'success'
    GROUP BY r.id
    ORDER BY downloads DESC
    LIMIT 1
  `).get() as { title: string; downloads: number } | undefined;

  const recentUsers = db.prepare(`
    SELECT id, username, avatar_url as avatarUrl, created_at as createdAt, is_online as isOnline, last_seen_at as lastSeenAt
    FROM users WHERE is_npc = 0 AND is_deleted = 0
    ORDER BY created_at DESC LIMIT 5
  `).all() as { id: number; username: string; avatarUrl: string | null; createdAt: string; isOnline: number; lastSeenAt: string | null }[];

  const recentApplications = db.prepare(`
    SELECT ja.id, ja.status, ja.created_at as createdAt, u.username, jp.title as position
    FROM job_applications ja
    LEFT JOIN users u ON u.id = ja.user_id
    LEFT JOIN job_postings jp ON jp.id = ja.job_id
    ORDER BY ja.created_at DESC LIMIT 5
  `).all() as { id: number; status: string; createdAt: string; username: string | null; position: string | null }[];

  const recentContacts = db.prepare(`
    SELECT id, name, subject, is_read as isRead, reply_status as replyStatus, created_at as createdAt
    FROM contact_tickets
    ORDER BY created_at DESC LIMIT 5
  `).all() as { id: number; name: string; subject: string; isRead: number; replyStatus: string; createdAt: string }[];

  const recentActivity = db.prepare(`
    SELECT id, timestamp, username, event_type as eventType, event_category as eventCategory,
           description, user_role as userRole, result
    FROM activity_logs
    ORDER BY timestamp DESC LIMIT 8
  `).all() as {
    id: number; timestamp: string; username: string | null; eventType: string;
    eventCategory: string; description: string; userRole: string | null; result: string;
  }[];

  res.json({
    totalUsers, onlineUsers, totalChannels, totalDms, pendingApplications, teamMembers, unreadNotifications,
    unreadContacts, totalContacts, repliedContacts, pendingContactReplies,
    totalMessages, pendingDmRequests, totalResources, totalDownloads,
    approvedApplications, rejectedApplications,
    userDistribution: [
      { name: "Administrators", value: adminCount },
      { name: "Team Members", value: teamCount },
      { name: "Registered Users", value: registeredCount },
    ],
    userGrowth,
    activityTimeline,
    downloadsByPlatform,
    mostDownloadedResource: mostDownloadedResource || null,
    recentUsers: recentUsers.map(u => ({
      ...u,
      isOnline: isUserOnline({ is_online: u.isOnline, last_seen_at: u.lastSeenAt }),
      time: timeAgo(u.createdAt),
    })),
    recentApplications: recentApplications.map(a => ({ ...a, time: timeAgo(a.createdAt) })),
    recentContacts: recentContacts.map(c => ({
      ...c,
      isRead: c.isRead === 1,
      time: timeAgo(c.createdAt),
    })),
    recentActivity: recentActivity.map(a => ({ ...a, time: timeAgo(a.timestamp) })),
  });
});

// ── Users ──────────────────────────────────────────────────────────────────────
function formatAdminUser(row: Record<string, unknown>) {
  const loc = db.prepare("SELECT * FROM user_locations WHERE user_id = ?").get(row.id as number) as {
    ip_address: string | null; country_code: string | null; country_name: string | null;
    is_vpn: number; vpn_ip: string | null; vpn_country_code: string | null; vpn_country_name: string | null;
    origin_ip: string | null; origin_country_code: string | null; origin_country_name: string | null;
  } | undefined;

  const activities = db.prepare("SELECT description, created_at as createdAt FROM activity_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 10").all(row.id);
  const recentLogins = db.prepare(`
    SELECT timestamp, description FROM activity_logs
    WHERE user_id = ? AND event_type IN ('login', 'register')
    ORDER BY timestamp DESC LIMIT 5
  `).all(row.id) as { timestamp: string; description: string }[];

  const stats = db.prepare("SELECT * FROM game_stats WHERE user_id = ?").get(row.id as number) as Record<string, unknown> | undefined;
  const achievements = db.prepare("SELECT title, description, icon, earned_at as earnedAt FROM achievements WHERE user_id = ? ORDER BY earned_at DESC").all(row.id);
  const inventory = db.prepare("SELECT name, rarity, quantity, icon FROM inventory_items WHERE user_id = ?").all(row.id);

  const online = isUserOnline({
    is_online: row.is_online as number | undefined,
    last_seen_at: row.last_seen_at as string | null,
  });

  return {
    id: row.id,
    email: row.email,
    username: row.username,
    avatarUrl: row.avatar_url,
    gender: row.gender,
    dateOfBirth: row.date_of_birth,
    country: row.country,
    city: row.city,
    status: (row.status as string) || (online ? "Online" : "Offline"),
    isOnline: online,
    bio: row.bio,
    memberSince: row.member_since,
    village: row.village,
    clan: row.clan,
    level: row.level,
    rank: row.rank,
    isAdmin: row.is_admin === 1,
    isDisabled: row.is_disabled === 1,
    isDeleted: row.is_deleted === 1,
    isTeamMember: row.is_team_member === 1,
    createdAt: row.created_at,
    registrationNumber: (db.prepare(`
      SELECT COUNT(*) as c FROM users
      WHERE is_npc = 0 AND (created_at < ? OR (created_at = ? AND id <= ?))
    `).get(row.created_at, row.created_at, row.id) as { c: number }).c,
    lastLoginAt: row.last_login_at || recentLogins[0]?.timestamp || null,
    location: loc ? {
      ip: loc.ip_address,
      countryCode: loc.country_code,
      countryName: loc.country_name,
      isVpn: loc.is_vpn === 1,
      vpnIp: loc.vpn_ip,
      vpnCountryCode: loc.vpn_country_code,
      vpnCountryName: loc.vpn_country_name,
      originIp: loc.origin_ip,
      originCountryCode: loc.origin_country_code,
      originCountryName: loc.origin_country_name,
    } : null,
    activities,
    recentLogins,
    gameStats: stats ? {
      missionsComplete: stats.missions_complete,
      pvpWins: stats.pvp_wins,
      playtimeHours: stats.playtime_hours,
      legendaryItems: stats.legendary_items,
      globalRank: stats.global_rank,
      ninjutsu: stats.ninjutsu,
      taijutsu: stats.taijutsu,
      genjutsu: stats.genjutsu,
      senjutsu: stats.senjutsu,
      kenjutsu: stats.kenjutsu,
    } : null,
    achievements,
    inventory,
  };
}

router.get("/users", (req, res) => {
  const { search, filter } = req.query as { search?: string; filter?: string };
  let sql = "SELECT * FROM users WHERE is_npc = 0";
  const params: unknown[] = [];

  if (filter === "disabled") sql += " AND is_disabled = 1";
  else if (filter === "admin") sql += " AND is_admin = 1";
  else if (filter === "team") sql += " AND is_team_member = 1";
  else if (filter === "active") sql += " AND is_disabled = 0 AND is_deleted = 0";
  else sql += " AND is_deleted = 0";

  if (search) {
    sql += " AND (username LIKE ? OR email LIKE ?)";
    const q = `%${search}%`;
    params.push(q, q);
  }
  sql += " ORDER BY created_at DESC";

  const users = db.prepare(sql).all(...params) as Record<string, unknown>[];
  res.json({ users: users.map(formatAdminUser) });
});

router.get("/users/:id", (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND is_npc = 0").get(Number(req.params.id)) as Record<string, unknown> | undefined;
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json({ user: formatAdminUser(user) });
});

router.patch("/users/:id", (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare("SELECT id FROM users WHERE id = ? AND is_npc = 0").get(id);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const { username, email, gender, country, city, status, bio, village, clan, level, rank, isAdmin, isTeamMember } = req.body;
  const fields: string[] = [];
  const vals: unknown[] = [];

  const map: [string, unknown][] = [
    ["username", username], ["email", email], ["gender", gender], ["country", country],
    ["city", city], ["status", status], ["bio", bio], ["village", village],
    ["clan", clan], ["level", level], ["rank", rank],
  ];
  for (const [col, val] of map) {
    if (val !== undefined) { fields.push(`${col} = ?`); vals.push(val); }
  }
  if (isAdmin !== undefined) { fields.push("is_admin = ?"); vals.push(isAdmin ? 1 : 0); }
  if (isTeamMember !== undefined) { fields.push("is_team_member = ?"); vals.push(isTeamMember ? 1 : 0); }
  if (isTeamMember === true) {
    syncPrivateChannelsForUser(id);
    const u = db.prepare("SELECT username, country, city FROM users WHERE id = ?").get(id) as { username: string; country: string; city: string | null };
    const existing = db.prepare("SELECT id FROM team_members WHERE user_id = ?").get(id) as { id: number } | undefined;
    if (!existing) {
      const maxOrder = (db.prepare("SELECT MAX(sort_order) as m FROM team_members").get() as { m: number | null }).m || 0;
      db.prepare(`
        INSERT INTO team_members (name, role, department, country, city, status_label, status_color, sort_order, user_id)
        VALUES (?, 'Team Member', 'General', ?, ?, 'Active', '#386A20', ?, ?)
      `).run(u.username, u.country || "Japan", u.city || "Tokyo", maxOrder + 1, id);
    }
    broadcast("team:updated", {});
  } else if (isTeamMember === false) {
    db.prepare("DELETE FROM team_members WHERE user_id = ?").run(id);
    broadcast("team:updated", {});
  }

  if (!fields.length) { res.status(400).json({ error: "No fields to update" }); return; }
  fields.push("updated_at = ?");
  vals.push(now(), id);
  db.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).run(...vals);

  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Record<string, unknown>;
  res.json({ user: formatAdminUser(updated) });
});

router.post("/users/:id/disable", (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user!.id) { res.status(400).json({ error: "Cannot disable your own account" }); return; }
  db.prepare("UPDATE users SET is_disabled = 1, updated_at = ? WHERE id = ?").run(now(), id);
  res.json({ ok: true });
});

router.post("/users/:id/enable", (req, res) => {
  db.prepare("UPDATE users SET is_disabled = 0, updated_at = ? WHERE id = ?").run(now(), Number(req.params.id));
  res.json({ ok: true });
});

router.delete("/users/:id", (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user!.id) { res.status(400).json({ error: "Cannot delete your own account" }); return; }
  db.prepare("UPDATE users SET is_deleted = 1, is_disabled = 1, updated_at = ? WHERE id = ?").run(now(), id);
  res.json({ ok: true });
});

// ── Notifications ────────────────────────────────────────────────────────────
router.get("/notifications", (_req, res) => {
  const rows = db.prepare("SELECT * FROM notifications ORDER BY pinned DESC, created_at DESC").all() as Record<string, unknown>[];
  res.json({
    notifications: rows.map(n => ({
      id: n.id,
      title: n.title,
      body: n.body,
      source: n.source,
      page: n.page,
      recipientType: n.recipient_type || "everyone",
      recipientIds: JSON.parse((n.recipient_ids as string) || "[]"),
      pinned: n.pinned === 1,
      notifType: n.notif_type || "announcement",
      createdAt: n.created_at,
      time: timeAgo(n.created_at as string),
    })),
  });
});

router.post("/notifications", (req, res) => {
  const { title, body, source, page, recipientType, recipientIds, pinned } = req.body;
  if (!title || !body) { res.status(400).json({ error: "Title and body are required" }); return; }
  const ts = now();
  const result = db.prepare(`
    INSERT INTO notifications (title, body, source, page, recipient_type, recipient_ids, pinned, notif_type, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'announcement', ?, ?)
  `).run(title, body, source || "Operations", page || "alarms", recipientType || "everyone", JSON.stringify(recipientIds || []), pinned ? 1 : 0, req.user!.id, ts);
  emitToAdmins("admin:notifications", {});
  emitToAdmins("admin:stats", {});
  broadcast("notification:new", {});
  broadcast("counts:update", {});
  res.status(201).json({ id: result.lastInsertRowid });
});

router.patch("/notifications/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT id FROM notifications WHERE id = ?").get(id);
  if (!existing) { res.status(404).json({ error: "Notification not found" }); return; }
  const { title, body, source, page, recipientType, recipientIds, pinned } = req.body;
  const fields: string[] = [];
  const vals: unknown[] = [];
  if (title !== undefined) { fields.push("title = ?"); vals.push(title); }
  if (body !== undefined) { fields.push("body = ?"); vals.push(body); }
  if (source !== undefined) { fields.push("source = ?"); vals.push(source); }
  if (page !== undefined) { fields.push("page = ?"); vals.push(page); }
  if (recipientType !== undefined) { fields.push("recipient_type = ?"); vals.push(recipientType); }
  if (recipientIds !== undefined) { fields.push("recipient_ids = ?"); vals.push(JSON.stringify(recipientIds)); }
  if (pinned !== undefined) { fields.push("pinned = ?"); vals.push(pinned ? 1 : 0); }
  if (!fields.length) { res.status(400).json({ error: "No fields to update" }); return; }
  vals.push(id);
  db.prepare(`UPDATE notifications SET ${fields.join(", ")} WHERE id = ?`).run(...vals);
  res.json({ ok: true });
});

router.delete("/notifications/:id", (req, res) => {
  db.prepare("DELETE FROM notifications WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

router.post("/notifications/:id/pin", (req, res) => {
  db.prepare("UPDATE notifications SET pinned = 1 WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

router.post("/notifications/:id/unpin", (req, res) => {
  db.prepare("UPDATE notifications SET pinned = 0 WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

// ── Channels ─────────────────────────────────────────────────────────────────
router.get("/channels", (_req, res) => {
  const channels = db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM conversation_participants cp WHERE cp.conversation_id = c.id) as memberCount
    FROM conversations c WHERE c.type = 'channel' ORDER BY c.archived, c.id
  `).all() as Record<string, unknown>[];
  res.json({
    channels: channels.map(c => ({
      id: c.id,
      name: c.name,
      bio: c.bio,
      archived: c.archived === 1,
      visibility: c.visibility || "public",
      moderatorIds: JSON.parse((c.moderator_ids as string) || "[]"),
      memberCount: c.memberCount,
      createdAt: c.created_at,
    })),
  });
});

router.post("/channels", (req, res) => {
  const { name, bio, visibility } = req.body;
  if (!name) { res.status(400).json({ error: "Name is required" }); return; }
  const vis = visibility === "private" ? "private" : "public";
  const ts = now();
  const result = db.prepare("INSERT INTO conversations (type, name, bio, visibility, created_at) VALUES ('channel', ?, ?, ?, ?)").run(name, bio || "", vis, ts);
  const convId = result.lastInsertRowid as number;
  db.prepare("INSERT INTO conversation_participants (conversation_id, user_id, joined_at) VALUES (?, ?, ?)").run(convId, req.user!.id, ts);
  if (vis === "public") {
    const users = db.prepare("SELECT id FROM users WHERE is_npc = 0 AND is_deleted = 0 AND is_disabled = 0").all() as { id: number }[];
    const insert = db.prepare("INSERT OR IGNORE INTO conversation_participants (conversation_id, user_id, joined_at) VALUES (?, ?, ?)");
    for (const u of users) insert.run(convId, u.id, ts);
  } else {
    syncPrivateChannelParticipants(convId);
  }
  res.status(201).json({ id: convId });
});

router.patch("/channels/:id", (req, res) => {
  const id = Number(req.params.id);
  const { name, bio, visibility, moderatorIds, archived } = req.body;
  const fields: string[] = [];
  const vals: unknown[] = [];
  if (name !== undefined) { fields.push("name = ?"); vals.push(name); }
  if (bio !== undefined) { fields.push("bio = ?"); vals.push(bio); }
  if (visibility !== undefined) { fields.push("visibility = ?"); vals.push(visibility === "private" ? "private" : "public"); }
  if (moderatorIds !== undefined) { fields.push("moderator_ids = ?"); vals.push(JSON.stringify(moderatorIds)); }
  if (archived !== undefined) { fields.push("archived = ?"); vals.push(archived ? 1 : 0); }
  if (!fields.length) { res.status(400).json({ error: "No fields to update" }); return; }
  vals.push(id);
  db.prepare(`UPDATE conversations SET ${fields.join(", ")} WHERE id = ? AND type = 'channel'`).run(...vals);
  if (visibility === "private") syncPrivateChannelParticipants(id);
  if (visibility === "public") {
    const users = db.prepare("SELECT id FROM users WHERE is_npc = 0 AND is_deleted = 0 AND is_disabled = 0").all() as { id: number }[];
    const ts = now();
    const insert = db.prepare("INSERT OR IGNORE INTO conversation_participants (conversation_id, user_id, joined_at) VALUES (?, ?, ?)");
    for (const u of users) insert.run(id, u.id, ts);
  }
  res.json({ ok: true });
});

router.delete("/channels/:id", (req, res) => {
  const id = Number(req.params.id);
  db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
  db.prepare("DELETE FROM conversation_participants WHERE conversation_id = ?").run(id);
  db.prepare("DELETE FROM conversations WHERE id = ? AND type = 'channel'").run(id);
  res.json({ ok: true });
});

// ── Contact Management ───────────────────────────────────────────────────────
function formatContactTicket(row: Record<string, unknown>) {
  const replies = db.prepare(`
    SELECT cr.id, cr.body, cr.created_at as createdAt, u.username as adminUsername
    FROM contact_replies cr
    LEFT JOIN users u ON u.id = cr.admin_id
    WHERE cr.ticket_id = ?
    ORDER BY cr.created_at ASC
  `).all(row.id) as { id: number; body: string; createdAt: string; adminUsername: string }[];

  return {
    id: row.id,
    userId: row.user_id,
    guestIdentifier: row.guest_identifier,
    name: row.name,
    email: row.email,
    subject: row.subject,
    category: row.category,
    message: row.message,
    status: row.status,
    isRead: row.is_read === 1,
    replyStatus: row.reply_status || "pending",
    ipAddress: row.ip_address,
    country: row.country,
    countryCode: row.country_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
    time: timeAgo(row.created_at as string),
    replies,
  };
}

router.get("/contacts", (_req, res) => {
  const rows = db.prepare("SELECT * FROM contact_tickets ORDER BY created_at DESC").all() as Record<string, unknown>[];
  res.json({ contacts: rows.map(formatContactTicket) });
});

router.get("/contacts/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM contact_tickets WHERE id = ?").get(Number(req.params.id)) as Record<string, unknown> | undefined;
  if (!row) { res.status(404).json({ error: "Contact not found" }); return; }
  if (row.is_read !== 1) {
    db.prepare("UPDATE contact_tickets SET is_read = 1, updated_at = ? WHERE id = ?").run(now(), row.id);
    row.is_read = 1;
  }
  res.json({ contact: formatContactTicket(row) });
});

router.patch("/contacts/:id/read", (req, res) => {
  const id = Number(req.params.id);
  const ts = now();
  db.prepare("UPDATE contact_tickets SET is_read = 1, updated_at = ? WHERE id = ?").run(ts, id);
  res.json({ ok: true });
});

router.post("/contacts/:id/reply", (req, res) => {
  const id = Number(req.params.id);
  const { body } = req.body;
  if (!body?.trim()) { res.status(400).json({ error: "Reply body is required" }); return; }

  const ticket = db.prepare("SELECT * FROM contact_tickets WHERE id = ?").get(id) as {
    id: number; user_id: number | null; email: string; name: string; subject: string;
  } | undefined;
  if (!ticket) { res.status(404).json({ error: "Contact not found" }); return; }

  const ts = now();
  db.prepare("INSERT INTO contact_replies (ticket_id, admin_id, body, created_at) VALUES (?, ?, ?, ?)").run(id, req.user!.id, body.trim(), ts);
  db.prepare("UPDATE contact_tickets SET reply_status = 'replied', is_read = 1, updated_at = ? WHERE id = ?").run(ts, id);

  if (ticket.user_id) {
    db.prepare(`
      INSERT INTO notifications (title, body, source, page, user_id, notif_type, created_at)
      VALUES (?, ?, 'Support', 'alarms', ?, 'contact_reply', ?)
    `).run(
      `Reply: ${ticket.subject}`,
      body.trim().slice(0, 200),
      ticket.user_id,
      ts,
    );
    emitToUser(ticket.user_id, "notification:new", {});
    emitToUser(ticket.user_id, "counts:update", {});
  } else {
    console.log(`[contact-reply] Guest reply for ticket #${id} (${ticket.email}): ${body.trim()}`);
  }

  logActivitySync({
    req, userId: req.user!.id, eventType: "contact_reply", eventCategory: "administration",
    description: `Replied to contact ticket #${id}`, affectedObject: `contact:${id}`,
  });

  const updated = db.prepare("SELECT * FROM contact_tickets WHERE id = ?").get(id) as Record<string, unknown>;
  emitToAdmins("admin:contact", { contactId: id });
  emitToAdmins("admin:stats", {});
  res.status(201).json({ contact: formatContactTicket(updated) });
});

// ── Teamwork Applications ────────────────────────────────────────────────────
router.get("/applications", (_req, res) => {
  const apps = db.prepare(`
    SELECT ja.*, u.username, u.email, u.avatar_url as avatarUrl, jp.title as jobTitle
    FROM job_applications ja
    JOIN users u ON u.id = ja.user_id
    JOIN job_postings jp ON jp.id = ja.job_id
    ORDER BY ja.created_at DESC
  `).all() as Record<string, unknown>[];
  res.json({
    applications: apps.map(a => ({
      id: a.id,
      applicant: { id: a.user_id, username: a.username, email: a.email, avatarUrl: a.avatarUrl },
      fullName: a.full_name,
      gender: a.gender,
      dateOfBirth: a.date_of_birth,
      country: a.country,
      city: a.city,
      photoUrl: a.photo_url,
      cvUrl: a.cv_url,
      portfolioUrl: a.portfolio_url,
      message: a.message,
      jobTitle: a.jobTitle,
      status: a.status,
      createdAt: a.created_at,
      time: timeAgo(a.created_at as string),
    })),
  });
});

router.post("/applications/:id/approve", (req, res) => {
  const id = Number(req.params.id);
  const app = db.prepare("SELECT * FROM job_applications WHERE id = ?").get(id) as { user_id: number; full_name: string; status: string } | undefined;
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  if (app.status !== "pending") { res.status(400).json({ error: "Application already processed" }); return; }

  const ts = now();
  db.prepare("UPDATE job_applications SET status = 'approved' WHERE id = ?").run(id);
  db.prepare("UPDATE users SET is_team_member = 1, updated_at = ? WHERE id = ?").run(ts, app.user_id);
  syncPrivateChannelsForUser(app.user_id);

  const user = db.prepare("SELECT username, country, city FROM users WHERE id = ?").get(app.user_id) as { username: string; country: string; city: string | null };
  const existing = db.prepare("SELECT id FROM team_members WHERE user_id = ? OR name = ?").get(app.user_id, app.full_name) as { id: number } | undefined;
  if (!existing) {
    const maxOrder = (db.prepare("SELECT MAX(sort_order) as m FROM team_members").get() as { m: number | null }).m || 0;
    db.prepare(`
      INSERT INTO team_members (name, role, department, country, city, status_label, status_color, sort_order, user_id)
      VALUES (?, 'Team Member', 'General', ?, ?, 'New', '#006688', ?, ?)
    `).run(app.full_name || user.username, user.country || "Japan", user.city || "Tokyo", maxOrder + 1, app.user_id);
  } else {
    db.prepare("UPDATE team_members SET user_id = ? WHERE id = ?").run(app.user_id, existing.id);
  }

  db.prepare(`
    INSERT INTO notifications (title, body, source, page, user_id, notif_type, created_at)
    VALUES ('Application Approved', ?, 'Teamwork', 'teamwork', ?, 'announcement', ?)
  `).run(`Your teamwork application has been approved. Welcome to the team!`, app.user_id, ts);

  emitToUser(app.user_id, "notification:new", {});
  emitToAdmins("admin:applications", {});
  emitToAdmins("admin:stats", {});
  emitToAdmins("team:updated", {});
  broadcast("team:updated", {});

  res.json({ ok: true });
});

router.post("/applications/:id/reject", (req, res) => {
  const id = Number(req.params.id);
  const app = db.prepare("SELECT * FROM job_applications WHERE id = ?").get(id) as { user_id: number; status: string } | undefined;
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  if (app.status !== "pending") { res.status(400).json({ error: "Application already processed" }); return; }

  const ts = now();
  db.prepare("UPDATE job_applications SET status = 'rejected' WHERE id = ?").run(id);
  db.prepare(`
    INSERT INTO notifications (title, body, source, page, user_id, notif_type, created_at)
    VALUES ('Application Update', ?, 'Teamwork', 'teamwork', ?, 'announcement', ?)
  `).run(`Your teamwork application was not approved at this time.`, app.user_id, ts);

  emitToUser(app.user_id, "notification:new", {});
  emitToAdmins("admin:applications", {});
  emitToAdmins("admin:stats", {});

  res.json({ ok: true });
});

// ── Resources ────────────────────────────────────────────────────────────────
router.get("/resources", (_req, res) => {
  const rows = db.prepare(`
    SELECT r.*, u.username as uploaderName
    FROM resources r LEFT JOIN users u ON u.id = r.uploader_id
    ORDER BY r.sort_order, r.published_at DESC
  `).all() as Record<string, unknown>[];
  res.json({
    resources: rows.map(r => ({
      id: r.id,
      title: r.title,
      category: r.category,
      description: r.description,
      contentUrl: r.content_url,
      publishedAt: r.published_at,
      enabled: r.enabled !== 0,
      uploaderId: r.uploader_id,
      uploaderName: r.uploaderName,
      fileSize: r.file_size,
      version: r.version,
      sortOrder: r.sort_order,
    })),
  });
});

router.post("/resources", upload.single("file"), (req, res) => {
  const { title, category, description, version, sortOrder, enabled } = req.body;
  if (!title || !category) { res.status(400).json({ error: "Title and category are required" }); return; }
  const ts = now();
  const fileUrl = req.file ? `/uploads/${req.file.filename}` : null;
  const fileSize = req.file?.size || null;
  const result = db.prepare(`
    INSERT INTO resources (title, category, description, content_url, published_at, enabled, uploader_id, file_size, version, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title, category, description || "", fileUrl, ts, enabled === "false" ? 0 : 1, req.user!.id, fileSize, version || null, Number(sortOrder) || 0);
  res.status(201).json({ id: result.lastInsertRowid });
});

router.patch("/resources/:id", upload.single("file"), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM resources WHERE id = ?").get(id) as { content_url: string | null } | undefined;
  if (!existing) { res.status(404).json({ error: "Resource not found" }); return; }

  const { title, category, description, version, sortOrder, enabled } = req.body;
  const fields: string[] = [];
  const vals: unknown[] = [];
  if (title !== undefined) { fields.push("title = ?"); vals.push(title); }
  if (category !== undefined) { fields.push("category = ?"); vals.push(category); }
  if (description !== undefined) { fields.push("description = ?"); vals.push(description); }
  if (version !== undefined) { fields.push("version = ?"); vals.push(version); }
  if (sortOrder !== undefined) { fields.push("sort_order = ?"); vals.push(Number(sortOrder)); }
  if (enabled !== undefined) { fields.push("enabled = ?"); vals.push(enabled === "false" || enabled === false ? 0 : 1); }
  if (req.file) {
    fields.push("content_url = ?"); vals.push(`/uploads/${req.file.filename}`);
    fields.push("file_size = ?"); vals.push(req.file.size);
  }
  if (!fields.length) { res.status(400).json({ error: "No fields to update" }); return; }
  vals.push(id);
  db.prepare(`UPDATE resources SET ${fields.join(", ")} WHERE id = ?`).run(...vals);
  res.json({ ok: true });
});

router.delete("/resources/:id", (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT content_url FROM resources WHERE id = ?").get(id) as { content_url: string | null } | undefined;
  if (row?.content_url?.startsWith("/uploads/")) {
    const filePath = path.join(uploadDir, path.basename(row.content_url));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  db.prepare("DELETE FROM resources WHERE id = ?").run(id);
  res.json({ ok: true });
});

// ── Game Downloads ─────────────────────────────────────────────────────────────
router.get("/game-downloads", (_req, res) => {
  const rows = db.prepare(`
    SELECT g.*, u.username as uploaderName
    FROM game_downloads g LEFT JOIN users u ON u.id = g.uploader_id
    ORDER BY g.platform, g.published_at DESC
  `).all() as Record<string, unknown>[];
  res.json({
    downloads: rows.map(r => ({
      id: r.id,
      platform: r.platform,
      version: r.version,
      releaseNotes: r.release_notes,
      fileUrl: r.file_url,
      fileSize: r.file_size,
      published: r.published === 1,
      publishedAt: r.published_at,
      uploaderName: r.uploaderName,
    })),
  });
});

router.post("/game-downloads", gameUpload.single("file"), (req, res) => {
  const { platform, version, releaseNotes, published } = req.body;
  if (!platform || !version) { res.status(400).json({ error: "Platform and version are required" }); return; }
  const ts = now();
  const fileUrl = req.file ? `/uploads/${req.file.filename}` : null;
  const result = db.prepare(`
    INSERT INTO game_downloads (platform, version, release_notes, file_url, file_size, published, published_at, uploader_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(platform, version, releaseNotes || "", fileUrl, req.file?.size || null, published === "true" || published === true ? 1 : 0, published === "true" || published === true ? ts : null, req.user!.id, ts, ts);
  logActivitySync({ req, userId: req.user!.id, eventType: "game_build_upload", eventCategory: "downloads", description: `Uploaded ${platform} build v${version}`, affectedObject: `game_download:${result.lastInsertRowid}` });
  res.status(201).json({ id: result.lastInsertRowid });
});

router.patch("/game-downloads/:id", gameUpload.single("file"), (req, res) => {
  const id = Number(req.params.id);
  const { version, releaseNotes, published } = req.body;
  const fields: string[] = ["updated_at = ?"];
  const vals: unknown[] = [now()];
  if (version !== undefined) { fields.push("version = ?"); vals.push(version); }
  if (releaseNotes !== undefined) { fields.push("release_notes = ?"); vals.push(releaseNotes); }
  if (published !== undefined) {
    const isPub = published === "true" || published === true;
    fields.push("published = ?"); vals.push(isPub ? 1 : 0);
    fields.push("published_at = ?"); vals.push(isPub ? now() : null);
  }
  if (req.file) {
    fields.push("file_url = ?"); vals.push(`/uploads/${req.file.filename}`);
    fields.push("file_size = ?"); vals.push(req.file.size);
  }
  vals.push(id);
  db.prepare(`UPDATE game_downloads SET ${fields.join(", ")} WHERE id = ?`).run(...vals);
  logActivitySync({ req, userId: req.user!.id, eventType: "game_build_update", eventCategory: "downloads", description: `Updated game build #${id}`, affectedObject: `game_download:${id}` });
  res.json({ ok: true });
});

router.delete("/game-downloads/:id", (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT file_url FROM game_downloads WHERE id = ?").get(id) as { file_url: string | null } | undefined;
  if (row?.file_url?.startsWith("/uploads/")) {
    const filePath = path.join(uploadDir, path.basename(row.file_url));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  db.prepare("DELETE FROM game_downloads WHERE id = ?").run(id);
  logActivitySync({ req, userId: req.user!.id, eventType: "game_build_delete", eventCategory: "downloads", description: `Deleted game build #${id}`, affectedObject: `game_download:${id}` });
  res.json({ ok: true });
});

// ── Activity Logs ──────────────────────────────────────────────────────────────
router.get("/activity-logs", (req, res) => {
  const {
    search, timeRange, userRole, eventCategory, result, country, isVpn,
    deviceType, browser, os, page = "1", limit = "50",
    dateFrom, dateTo, userId,
  } = req.query as Record<string, string>;

  let sql = "SELECT * FROM activity_logs WHERE 1=1";
  const params: unknown[] = [];

  const nowMs = Date.now();
  if (timeRange === "today") { sql += " AND timestamp >= ?"; params.push(new Date(nowMs - 86400000).toISOString()); }
  else if (timeRange === "yesterday") { sql += " AND timestamp >= ? AND timestamp < ?"; params.push(new Date(nowMs - 172800000).toISOString(), new Date(nowMs - 86400000).toISOString()); }
  else if (timeRange === "7d") { sql += " AND timestamp >= ?"; params.push(new Date(nowMs - 7 * 86400000).toISOString()); }
  else if (timeRange === "30d") { sql += " AND timestamp >= ?"; params.push(new Date(nowMs - 30 * 86400000).toISOString()); }
  if (dateFrom) { sql += " AND timestamp >= ?"; params.push(dateFrom); }
  if (dateTo) { sql += " AND timestamp <= ?"; params.push(dateTo); }
  if (userRole) { sql += " AND user_role = ?"; params.push(userRole); }
  if (eventCategory) { sql += " AND event_category = ?"; params.push(eventCategory); }
  if (result) { sql += " AND result = ?"; params.push(result); }
  if (country) { sql += " AND country LIKE ?"; params.push(`%${country}%`); }
  if (isVpn === "1") sql += " AND is_vpn = 1";
  if (isVpn === "0") sql += " AND (is_vpn = 0 OR is_vpn IS NULL)";
  if (deviceType) { sql += " AND device_type = ?"; params.push(deviceType); }
  if (browser) { sql += " AND browser = ?"; params.push(browser); }
  if (os) { sql += " AND os = ?"; params.push(os); }
  if (userId) { sql += " AND user_id = ?"; params.push(Number(userId)); }
  if (search) {
    sql += " AND (username LIKE ? OR display_name LIKE ? OR ip_address LIKE ? OR description LIKE ? OR event_category LIKE ? OR affected_object LIKE ?)";
    const q = `%${search}%`;
    params.push(q, q, q, q, q, q);
  }

  const countRow = db.prepare(sql.replace("SELECT *", "SELECT COUNT(*) as c")).get(...params) as { c: number };
  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.min(200, Math.max(1, Number(limit)));
  const offset = (pageNum - 1) * limitNum;

  sql += " ORDER BY timestamp DESC LIMIT ? OFFSET ?";
  params.push(limitNum, offset);

  const logs = db.prepare(sql).all(...params) as Record<string, unknown>[];
  res.json({
    logs: logs.map(l => ({
      id: l.id,
      timestamp: l.timestamp,
      time: timeAgo(l.timestamp as string),
      userId: l.user_id,
      username: l.username,
      displayName: l.display_name,
      userRole: l.user_role,
      eventType: l.event_type,
      eventCategory: l.event_category,
      description: l.description,
      affectedObject: l.affected_object,
      requestPath: l.request_path,
      httpMethod: l.http_method,
      browser: l.browser,
      os: l.os,
      deviceType: l.device_type,
      ipAddress: l.ip_address,
      country: l.country,
      countryCode: l.country_code,
      isVpn: l.is_vpn === 1,
      result: l.result,
      metadata: JSON.parse((l.metadata as string) || "{}"),
    })),
    total: countRow.c,
    page: pageNum,
    limit: limitNum,
  });
});

router.get("/activity-logs/export", (req, res) => {
  const logs = db.prepare("SELECT * FROM activity_logs ORDER BY timestamp DESC LIMIT 10000").all() as Record<string, unknown>[];
  const header = "id,timestamp,username,user_role,event_type,event_category,description,country,ip_address,result\n";
  const rows = logs.map(l => [
    l.id, l.timestamp, JSON.stringify(l.username), l.user_role, l.event_type, l.event_category,
    JSON.stringify(l.description), JSON.stringify(l.country), l.ip_address, l.result,
  ].join(",")).join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=activity-logs.csv");
  res.send(header + rows);
});

router.delete("/activity-logs", (req, res) => {
  const { before } = req.body;
  if (!before) { res.status(400).json({ error: "before date is required" }); return; }
  const result = db.prepare("DELETE FROM activity_logs WHERE timestamp < ?").run(before);
  logActivitySync({ req, userId: req.user!.id, eventType: "logs_archive", eventCategory: "administration", description: `Archived ${result.changes} activity logs before ${before}` });
  res.json({ ok: true, deleted: result.changes });
});

// Admin check endpoint
router.get("/check", (req, res) => {
  res.json({ isAdmin: true, user: publicUser(req.user!, req.user!.id) });
});

export default router;
