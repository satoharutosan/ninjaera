import { Router, type Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import { db, dbAsync, dbPath, dataDirectory, type UserRow } from "../db/index.js";
import { qGet, qAll, qRun, qTransaction } from "../db/query.js";
import { exportPortableBackup, currentSchemaVersion } from "../db/backup/portable.js";
import { validatePortableBackup, restorePortableBackup } from "../db/backup/restore.js";
import { createNativeBackup } from "../db/backup/native.js";
import { requireAuth, publicUser, timeAgo, formatTime, bumpTokenVersion } from "../middleware/auth.js";
import { requireAdmin, requireSuperAdmin } from "../middleware/admin.js";
import { clientIp } from "../middleware/rateLimit.js";
import { canManageTargetUser, canSelectTargetUser, isSuperAdmin, resolveSuperAdminEmail } from "../services/adminPermissions.js";
import { normalizeEmail } from "../services/emailVerification.js";
import { assertTrustedRegistrationEmail } from "../config/trustedEmailProviders.js";
import {
  isUsernameConstraintError,
  validateUsernameForWrite,
  USERNAME_TAKEN_ERROR,
} from "../services/username.js";
import { normalizeResourceCategory, RESOURCE_CATEGORY_ERROR } from "../services/resourceCategories.js";
import { validateExternalDownloadUrl, allowsExternalDownload } from "../services/externalDownloadUrl.js";
import {
  generateResourcePublicSlug,
  resolveResourcePublicSlug,
  resourcePublicPath,
} from "../services/resourcePublicSlug.js";
import { parseGameFileSize, gameFileSizeApiFields } from "../services/gameFileSize.js";
import {
  logActivitySync,
  formatPlatformLabel,
  isVersionBackupActivityEvent,
  activityLogVisibilityFor,
} from "../services/activityLog.js";
import { emitToAdmins, emitToUser, broadcast, scheduleAdminStatsRefresh, emitConversationUpdate } from "../services/realtime.js";
import { getAdminStatsCache, setAdminStatsCache, invalidateAdminStatsCache } from "../services/adminStatsCache.js";
import {
  PENDING_JOB_APPLICATIONS_SQL,
  PENDING_DM_REQUESTS_SQL,
  TEAMWORK_APPLICATIONS_LIST_SQL,
  UNREAD_CONTACTS_SQL,
  TOTAL_USERS_SQL,
  TOTAL_NOTIFICATIONS_SQL,
  TOTAL_DOWNLOADS_SQL,
  TOTAL_MESSAGES_SQL,
  isAdminStatsDiagnosticsEnabled,
} from "../services/adminDashboardMetrics.js";
import { emitProfileUpdated, syncTeamMemberDisplayName } from "../services/profileBroadcast.js";
import { isUserOnline, countOnlineUsers } from "../services/presence.js";
import { syncPrivateChannelParticipants, syncPublicChannels, syncPrivateChannelsForUser, pruneIneligiblePrivateParticipants } from "../services/channels.js";
import { forceLeaveConversationMany } from "../services/realtime.js";
import { hardDeleteMessage } from "../services/messageModeration.js";
import { formatDurationLabel, parseMediaMeta } from "../services/mediaMeta.js";
import {
  deleteTableRows,
  getTableColumns,
  insertTableRow,
  listManageableTables,
  listTableRows,
  updateTableRow,
} from "../services/adminDatabaseConsole.js";
import { tombstoneSenderFields, DELETED_USER_DISPLAY_NAME } from "../services/deletedUser.js";
import type { PutObjectResult } from "../storage/types.js";
import { deleteStoredUrl, getStorage } from "../storage/index.js";
import { createMemoryUploader, createTempDiskUploader, cleanupTempFile, persistMulterFile } from "../storage/multerUpload.js";
import { validateUpload } from "../services/uploadValidation.js";
import {
  ADMIN_RESOURCE_MAX_BYTES,
  formatBytesLimit,
} from "../config/uploadLimits.js";
import adminLinkFileRoutes from "./adminLinkFiles.js";
import adminAppInstallationRoutes from "./adminAppInstallations.js";
import adminDesktopReleaseRoutes from "./adminDesktopReleases.js";
import adminDevManagerRoutes from "./adminDevManager.js";
import adminVersionBackupRoutes from "./adminVersionBackups.js";

const router = Router();
const now = () => new Date().toISOString();

async function getSuperAdminUserId(): Promise<number | null> {
  const row = await qGet<{ id: number }>(
    "SELECT id FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1",
    resolveSuperAdminEmail(),
  );
  return row?.id ?? null;
}


function logAdminUpload(event: {
  ok: boolean;
  uploadType: "resource" | "game";
  adminId: number;
  username?: string | null;
  filename?: string | null;
  fileSize?: number | null;
  durationMs: number;
  reason?: string;
  resourceId?: number | null;
  ipAddress?: string | null;
}) {
  const completedAt = now();
  const startedAt = new Date(Date.now() - Math.max(0, event.durationMs)).toISOString();
  try {
    const provider = getStorage().provider;
    console.info("[admin-upload]", JSON.stringify({
      ...event,
      storageProvider: provider,
      startedAt,
      completedAt,
      status: event.ok ? "success" : "failure",
    }));
  } catch {
    console.info("[admin-upload]", JSON.stringify({
      ...event,
      startedAt,
      completedAt,
      status: event.ok ? "success" : "failure",
    }));
  }
}

async function rollbackStoredFile(stored: PutObjectResult | null | undefined): Promise<void> {
  if (stored?.url) await deleteStoredUrl(stored.url);
}

// Resources / game builds: disk-backed multer + streamed storage (no full-file RAM buffer).
const upload = createTempDiskUploader({ limits: { fileSize: ADMIN_RESOURCE_MAX_BYTES }, prefix: "resource" });

const CHANNEL_AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const CHANNEL_AVATAR_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);
const channelAvatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CHANNEL_AVATAR_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const okMime = CHANNEL_AVATAR_MIMES.has(file.mimetype);
    const okExt = /\.(png|jpe?g|webp)$/i.test(file.originalname);
    // Require BOTH MIME and extension (closes extension-only bypass).
    if (okMime && okExt) {
      cb(null, true);
      return;
    }
    cb(new Error("Only PNG, JPG, and WEBP images are allowed for channel avatars"));
  },
});

async function unlinkLocalUpload(url: string | null | undefined) {
  await deleteStoredUrl(url);
}

function channelAvatarMiddleware(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) {
  channelAvatarUpload.single("avatar")(req, res, async (err: unknown) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "Channel avatar must be 5MB or smaller" });
      return;
    }
    if (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid avatar upload" });
      return;
    }
    if (req.file) {
      const validated = validateUpload({
        kind: "channelAvatar",
        originalName: req.file.originalname,
        declaredMime: req.file.mimetype,
        buffer: req.file.buffer,
        size: req.file.size,
      });
      if (!validated.ok) {
        res.status(400).json({ error: validated.error });
        return;
      }
      (req.file as Express.Multer.File & { validatedContentType?: string }).validatedContentType = validated.contentType;
    }
    next();
  });
}

/** Disable Node socket idle timeouts for long-running large-file transfers. */
function extendUploadSocketTimeouts(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
) {
  req.setTimeout(0);
  res.setTimeout(0);
  next();
}

function multerSizeLimitMiddleware(
  uploader: ReturnType<typeof createTempDiskUploader>,
  field: string,
  maxBytes: number,
  label: string,
) {
  return (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    uploader.single(field)(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({
          error: `${label} exceeds the maximum size of ${formatBytesLimit(maxBytes)}.`,
          code: "FILE_TOO_LARGE",
          maxBytes,
        });
        return;
      }
      if (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "Invalid upload" });
        return;
      }
      next();
    });
  };
}

const resourceFileUpload = multerSizeLimitMiddleware(upload, "file", ADMIN_RESOURCE_MAX_BYTES, "Resource file");

router.use(requireAuth, requireAdmin);
router.use(adminLinkFileRoutes);
router.use(adminAppInstallationRoutes);
router.use(adminDesktopReleaseRoutes);
router.use(adminVersionBackupRoutes);
router.use(adminDevManagerRoutes);

// ?? Dashboard ????????????????????????????????????????????????????????????????

/** Coerce COUNT/SUM results from SQLite (number) or Postgres (string bigint) to a finite integer. */
function asInt(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return fallback;
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function dayKeysLastN(days: number): string[] {
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    keys.push(d.toISOString().slice(0, 10));
  }
  return keys;
}

async function safeCount(label: string, sql: string, ...params: unknown[]): Promise<number> {
  try {
    const row = await qGet<{ c: unknown }>(sql, ...params);
    return asInt(row?.c, 0);
  } catch (err) {
    console.warn(`[Admin Stats] count failed (${label}):`, err instanceof Error ? err.message : err);
    return 0;
  }
}

async function safeQueryAll<T>(label: string, sql: string, ...params: unknown[]): Promise<T[]> {
  try {
    return await qAll<T>(sql, ...params);
  } catch (err) {
    console.warn(`[Admin Stats] query failed (${label}):`, err instanceof Error ? err.message : err);
    return [];
  }
}

async function safeQueryOne<T>(label: string, sql: string, ...params: unknown[]): Promise<T | undefined> {
  try {
    return await qGet<T>(sql, ...params);
  } catch (err) {
    console.warn(`[Admin Stats] query failed (${label}):`, err instanceof Error ? err.message : err);
    return undefined;
  }
}

function logAdminStatsError(req: import("express").Request, err: unknown, context?: { sql?: string; params?: unknown[] }) {
  const e = err as { message?: string; stack?: string; code?: string };
  console.error("[Admin Stats] ============================================");
  console.error(`[Admin Stats] Provider: ${dbAsync.provider}`);
  console.error(`[Admin Stats] Route: ${req.originalUrl || req.path}`);
  console.error(`[Admin Stats] User: ${(req.user as { email?: string } | undefined)?.email || "unknown"}`);
  console.error(`[Admin Stats] Error: ${e?.message || String(err)}`);
  if (e?.code) console.error(`[Admin Stats] Code: ${e.code}`);
  if (context?.sql) console.error(`[Admin Stats] SQL: ${context.sql.replace(/\s+/g, " ").trim().slice(0, 400)}`);
  if (context?.params) console.error(`[Admin Stats] Params: ${JSON.stringify(context.params).slice(0, 200)}`);
  if (e?.stack) console.error(`[Admin Stats] Stack:\n${e.stack}`);
  console.error("[Admin Stats] ============================================");
}

router.get("/stats", async (req, res) => {
  try {
    const cached = getAdminStatsCache();
    if (cached) {
      // Always recompute unique online users ? presence changes faster than the general stats cache.
      const onlineUsers = asInt(countOnlineUsers(), 0);
      const body: Record<string, unknown> = { ...cached.body, onlineUsers };
      if (!isSuperAdmin(req.user!) && Array.isArray(body.recentActivity)) {
        const saId = await getSuperAdminUserId();
        body.recentActivity = (body.recentActivity as { eventType?: string; userId?: number | null }[]).filter(
          (a) => !isVersionBackupActivityEvent(a.eventType)
            && (saId == null || a.userId !== saId),
        );
      }
      res.json(body);
      return;
    }

    // Portable cutoff: never use SQLite-only date('now', '-13 days') ? it fails on PostgreSQL.
    const sinceIso = daysAgoIso(13);
    const dayKeys = dayKeysLastN(14);

    const [
      totalUsers,
      roleCounts,
      pendingJobApplications,
      pendingDmRequests,
      notifications,
      unreadContacts,
      totalMessages,
      totalDownloads,
      registrationRows,
      messageDayRows,
      loginDayRows,
      downloadDayRows,
      mostDownloadedResource,
      recentUsers,
      recentApplications,
      recentContacts,
      recentActivity,
    ] = await Promise.all([
      safeCount("totalUsers", TOTAL_USERS_SQL),
      safeQueryOne<{ admin_count: unknown; member_count: unknown }>(
        "roleCounts",
        // Snake_case aliases only ? Postgres lowercases unquoted camelCase (adminCount ? admincount).
        `SELECT
          COALESCE(SUM(CASE WHEN is_admin = 1 THEN 1 ELSE 0 END), 0) as admin_count,
          COALESCE(SUM(CASE WHEN is_admin = 0 OR is_admin IS NULL THEN 1 ELSE 0 END), 0) as member_count
         FROM users WHERE is_npc = 0 AND is_deleted = 0`,
      ),
      // Same filter as Teamwork Applications management (pending status only).
      safeCount("pendingJobApplications", PENDING_JOB_APPLICATIONS_SQL),
      // Tracked separately ? never mixed into pendingApplications (DM ? teamwork).
      safeCount("pendingDmRequests", PENDING_DM_REQUESTS_SQL),
      // Same universe as Notifications management list (all rows).
      safeCount("notifications", TOTAL_NOTIFICATIONS_SQL),
      safeCount("unreadContacts", UNREAD_CONTACTS_SQL),
      // Hard-deleted messages are removed from the table; exclude call_event system chips.
      safeCount("totalMessages", TOTAL_MESSAGES_SQL),
      safeCount("totalDownloads", TOTAL_DOWNLOADS_SQL),
      safeQueryAll<{ d: string; c: unknown }>(
        "registrationsByDay",
        `SELECT substr(created_at, 1, 10) as d, COUNT(*) as c
         FROM users
         WHERE is_npc = 0 AND is_deleted = 0 AND created_at >= ?
         GROUP BY substr(created_at, 1, 10)`,
        sinceIso,
      ),
      safeQueryAll<{ d: string; c: unknown }>(
        "messagesByDay",
        `SELECT substr(created_at, 1, 10) as d, COUNT(*) as c
         FROM messages
         WHERE created_at >= ?
           AND (media_type IS NULL OR media_type != 'call_event')
         GROUP BY substr(created_at, 1, 10)`,
        sinceIso,
      ),
      safeQueryAll<{ d: string; c: unknown }>(
        "loginsByDay",
        `SELECT substr(timestamp, 1, 10) as d, COUNT(*) as c
         FROM activity_logs
         WHERE event_type IN ('login', 'register') AND timestamp >= ?
         GROUP BY substr(timestamp, 1, 10)`,
        sinceIso,
      ),
      safeQueryAll<{ d: string; c: unknown }>(
        "downloadsByDay",
        `SELECT substr(timestamp, 1, 10) as d, COUNT(*) as c
         FROM activity_logs
         WHERE event_category = 'downloads' AND result = 'success' AND timestamp >= ?
         GROUP BY substr(timestamp, 1, 10)`,
        sinceIso,
      ),
      safeQueryOne<{ title: string; downloads: unknown }>(
        "mostDownloadedResource",
        `SELECT r.title as title, COUNT(*) as downloads
         FROM activity_logs al
         JOIN resources r ON al.affected_object = 'resource:' || CAST(r.id AS TEXT)
         WHERE al.event_type = 'resource_download' AND al.result = 'success'
         GROUP BY r.id, r.title
         ORDER BY downloads DESC
         LIMIT 1`,
      ),
      safeQueryAll<{
        id: number; username: string; avatar_url: string | null; created_at: string;
        is_online: number; last_seen_at: string | null;
      }>(
        "recentUsers",
        `SELECT id, username, avatar_url, created_at,
                is_online, last_seen_at
         FROM users WHERE is_npc = 0 AND is_deleted = 0
         ORDER BY created_at DESC LIMIT 5`,
      ),
      safeQueryAll<{
        id: number; status: string; created_at: string; username: string | null; position: string | null;
      }>(
        "recentApplications",
        `SELECT ja.id, ja.status, ja.created_at, u.username, jp.title as position
         FROM job_applications ja
         LEFT JOIN users u ON u.id = ja.user_id
         LEFT JOIN job_postings jp ON jp.id = ja.job_id
         ORDER BY ja.created_at DESC LIMIT 5`,
      ),
      safeQueryAll<{
        id: number; name: string; subject: string; is_read: number; reply_status: string; created_at: string;
      }>(
        "recentContacts",
        `SELECT id, name, subject, is_read, reply_status, created_at
         FROM contact_tickets
         ORDER BY created_at DESC LIMIT 5`,
      ),
      safeQueryAll<{
        id: number; timestamp: string; user_id: number | null; username: string | null; event_type: string;
        event_category: string; description: string; user_role: string | null; result: string;
      }>(
        "recentActivity",
        `SELECT id, timestamp, user_id, username, event_type, event_category,
                description, user_role, result
         FROM activity_logs
         ORDER BY timestamp DESC LIMIT 8`,
      ),
    ]);

    const onlineUsers = asInt(countOnlineUsers(), 0);
    const adminCount = asInt(roleCounts?.admin_count, 0);
    // Members = non-admin active users (excludes deleted/NPC via WHERE).
    const memberCount = asInt(roleCounts?.member_count, Math.max(0, totalUsers - adminCount));
    // Overview "Pending Applications" MUST equal pending teamwork apps only
    // (same as Teamwork Applications management). DM requests are separate.
    const pendingApplications = pendingJobApplications;

    if (isAdminStatsDiagnosticsEnabled()) {
      console.info("[Admin Stats Diagnostics]", {
        provider: dbAsync.provider,
        pendingJobApplications,
        pendingDmRequests,
        pendingApplicationsCard: pendingApplications,
        unreadContacts,
        notifications,
        totalUsers,
        totalDownloads,
        totalMessages,
        note: "pendingApplications === pendingJobApplications; DM requests are not included",
      });
    }

    const registrationsByDay = Object.fromEntries(registrationRows.map((r) => [r.d, asInt(r.c)]));
    const messagesByDay = Object.fromEntries(messageDayRows.map((r) => [r.d, asInt(r.c)]));
    const loginsByDay = Object.fromEntries(loginDayRows.map((r) => [r.d, asInt(r.c)]));
    const downloadsByDay = Object.fromEntries(downloadDayRows.map((r) => [r.d, asInt(r.c)]));

    const userGrowth = dayKeys.map((date) => ({
      date,
      label: date.slice(5),
      count: registrationsByDay[date] || 0,
    }));

    const activityTimeline = dayKeys.map((date) => ({
      date,
      label: date.slice(5),
      messages: messagesByDay[date] || 0,
      downloads: downloadsByDay[date] || 0,
      logins: loginsByDay[date] || 0,
    }));

    const downloadsByPlatform = await Promise.all(
      (["windows", "android", "ios"] as const).map(async (platform) => {
        const count = await safeCount(
          `downloadsByPlatform:${platform}`,
          `SELECT COUNT(*) as c FROM activity_logs
           WHERE event_type = 'game_download' AND result = 'success'
             AND (description LIKE ? OR affected_object LIKE ?)`,
          `%${platform}%`,
          `%${platform}%`,
        );
        return {
          platform,
          label: platform === "ios" ? "iOS" : platform.charAt(0).toUpperCase() + platform.slice(1),
          count,
        };
      }),
    );

    const body = {
      totalUsers,
      onlineUsers,
      pendingApplications,
      pendingJobApplications,
      pendingDmRequests,
      unreadContacts,
      notifications,
      totalDownloads,
      totalMessages,
      userDistribution: [
        { name: "Administrators", value: adminCount },
        { name: "Members", value: memberCount },
      ],
      userGrowth,
      activityTimeline,
      downloadsByPlatform,
      mostDownloadedResource: mostDownloadedResource
        ? {
            title: mostDownloadedResource.title,
            downloads: asInt(mostDownloadedResource.downloads, 0),
          }
        : null,
      recentUsers: recentUsers.map((u) => ({
        id: u.id,
        username: u.username,
        avatarUrl: u.avatar_url,
        createdAt: u.created_at,
        isOnline: isUserOnline({ is_online: u.is_online, last_seen_at: u.last_seen_at }),
        time: timeAgo(u.created_at),
      })),
      recentApplications: recentApplications.map((a) => ({
        id: a.id,
        status: a.status,
        createdAt: a.created_at,
        username: a.username,
        position: a.position,
        time: timeAgo(a.created_at),
      })),
      recentContacts: recentContacts.map((c) => ({
        id: c.id,
        name: c.name,
        subject: c.subject,
        isRead: Number(c.is_read) === 1,
        replyStatus: c.reply_status,
        createdAt: c.created_at,
        time: timeAgo(c.created_at),
      })),
      recentActivity: recentActivity.map((a) => ({
        id: a.id,
        timestamp: a.timestamp,
        userId: a.user_id,
        username: a.username,
        eventType: a.event_type,
        eventCategory: a.event_category,
        description: a.description,
        userRole: a.user_role,
        result: a.result,
        time: timeAgo(a.timestamp),
      })),
    };

    setAdminStatsCache(body);
    if (!isSuperAdmin(req.user!)) {
      const saId = await getSuperAdminUserId();
      body.recentActivity = body.recentActivity.filter(
        (a) => !isVersionBackupActivityEvent(a.eventType)
          && (saId == null || a.userId !== saId),
      );
    }
    res.json(body);
  } catch (err) {
    logAdminStatsError(req, err);
    // Last-resort empty dashboard ? never leave the admin UI on a hard 500 for stats.
    invalidateAdminStatsCache();
    res.status(200).json({
      totalUsers: 0,
      onlineUsers: asInt(countOnlineUsers(), 0),
      pendingApplications: 0,
      pendingJobApplications: 0,
      pendingDmRequests: 0,
      unreadContacts: 0,
      notifications: 0,
      totalDownloads: 0,
      totalMessages: 0,
      userDistribution: [
        { name: "Administrators", value: 0 },
        { name: "Members", value: 0 },
      ],
      userGrowth: [],
      activityTimeline: [],
      downloadsByPlatform: [
        { platform: "windows", label: "Windows", count: 0 },
        { platform: "android", label: "Android", count: 0 },
        { platform: "ios", label: "iOS", count: 0 },
      ],
      mostDownloadedResource: null,
      recentUsers: [],
      recentApplications: [],
      recentContacts: [],
      recentActivity: [],
      degraded: true,
      error: "Some dashboard statistics could not be loaded. See server logs for details.",
    });
  }
});

// ?? Users ??????????????????????????????????????????????????????????????????????
async function formatAdminUser(row: Record<string, unknown>) {
  const loc = await qGet<{
    ip_address: string | null; country_code: string | null; country_name: string | null;
    is_vpn: number; vpn_ip: string | null; vpn_country_code: string | null; vpn_country_name: string | null;
    origin_ip: string | null; origin_country_code: string | null; origin_country_name: string | null;
  }>("SELECT * FROM user_locations WHERE user_id = ?", row.id as number);

  const activities = await qAll<{ description: string; created_at: string }>(
    "SELECT description, created_at FROM activity_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 10",
    row.id,
  );
  const recentLogins = await qAll<{ timestamp: string; description: string }>(`
    SELECT timestamp, description FROM activity_logs
    WHERE user_id = ? AND event_type IN ('login', 'register')
    ORDER BY timestamp DESC LIMIT 5
  `, row.id);

  const stats = await qGet<Record<string, unknown>>("SELECT * FROM game_stats WHERE user_id = ?", row.id as number);
  const achievements = await qAll<{ title: string; description: string; icon: string; earned_at: string }>(
    "SELECT title, description, icon, earned_at FROM achievements WHERE user_id = ? ORDER BY earned_at DESC",
    row.id,
  );
  const inventory = await qAll("SELECT name, rarity, quantity, icon FROM inventory_items WHERE user_id = ?", row.id);

  const online = isUserOnline({
    is_online: row.is_online as number | undefined,
    last_seen_at: row.last_seen_at as string | null,
  });

  const registrationNumber = (await qGet<{ c: number }>(`
    SELECT COUNT(*) as c FROM users
    WHERE is_npc = 0 AND (created_at < ? OR (created_at = ? AND id <= ?))
  `, row.created_at, row.created_at, row.id))!.c;

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
    registrationNumber,
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
    activities: activities.map((a) => ({ description: a.description, createdAt: a.created_at })),
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
    achievements: achievements.map((a) => ({
      title: a.title,
      description: a.description,
      icon: a.icon,
      earnedAt: a.earned_at,
    })),
    inventory,
  };
}

router.get("/users", async (req, res) => {
  const { search, filter } = req.query as { search?: string; filter?: string };
  let sql = "SELECT * FROM users WHERE is_npc = 0";
  const params: unknown[] = [];

  if (filter === "disabled") sql += " AND is_disabled = 1";
  else if (filter === "admin") sql += " AND is_admin = 1";
  else if (filter === "team") sql += " AND is_team_member = 1";
  else if (filter === "active") sql += " AND is_disabled = 0 AND is_deleted = 0";
  else sql += " AND is_deleted = 0";

  if (search) {
    sql += " AND (LOWER(username) LIKE LOWER(?) OR LOWER(email) LIKE LOWER(?))";
    const q = `%${search}%`;
    params.push(q, q);
  }
  sql += " ORDER BY created_at DESC";

  const users = await qAll<Record<string, unknown>>(sql, ...params);
  res.json({ users: await Promise.all(users.map(formatAdminUser)) });
});

async function getManageableUser(id: number): Promise<Record<string, unknown> | undefined> {
  return qGet<Record<string, unknown>>("SELECT id, email, is_admin FROM users WHERE id = ? AND is_npc = 0 AND is_deleted = 0", id);
}

function denyUserManagement(res: Response, actor: UserRow, target: Record<string, unknown>): boolean {
  if (!canManageTargetUser(actor, { email: target.email as string, is_admin: target.is_admin as number })) {
    res.status(403).json({ error: "You do not have permission to manage this account" });
    return true;
  }
  return false;
}

router.get("/users/:id", async (req, res) => {
  const user = await qGet<Record<string, unknown>>("SELECT * FROM users WHERE id = ? AND is_npc = 0", Number(req.params.id));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json({ user: await formatAdminUser(user) });
});

router.patch("/users/:id", async (req, res) => {
  const id = Number(req.params.id);
  const target = await getManageableUser(id);
  if (!target) { res.status(404).json({ error: "User not found" }); return; }
  if (denyUserManagement(res, req.user!, target)) return;

  const { username, email, gender, country, city, status, bio, village, clan, level, rank, isAdmin, isTeamMember } = req.body;
  const fields: string[] = [];
  const vals: unknown[] = [];

  if (username !== undefined) {
    const check = await validateUsernameForWrite(username, id);
    if (!check.ok) {
      res.status(check.status).json({ error: check.error });
      return;
    }
    fields.push("username = ?");
    vals.push(check.username);
  }

  if (email !== undefined) {
    if (!isSuperAdmin(req.user!)) {
      res.status(403).json({ error: "Only the Super Administrator may change account email addresses" });
      return;
    }
    const nextEmail = normalizeEmail(String(email));
    if (!nextEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      res.status(400).json({ error: "Enter a valid email address" });
      return;
    }
    const trust = assertTrustedRegistrationEmail(nextEmail);
    if (!trust.ok) {
      res.status(400).json({ error: trust.error, code: trust.code });
      return;
    }
    const taken = await qGet("SELECT id FROM users WHERE email = ? AND id != ? AND is_npc = 0", nextEmail, id);
    if (taken) {
      res.status(409).json({ error: "Another account already uses this email" });
      return;
    }
    fields.push("email = ?");
    vals.push(nextEmail);
    // Force re-verification after admin email rewrite
    fields.push("email_verified = ?");
    vals.push(1);
  }

  const map: [string, unknown][] = [
    ["gender", gender], ["country", country],
    ["city", city], ["status", status], ["bio", bio], ["village", village],
    ["clan", clan], ["level", level], ["rank", rank],
  ];
  for (const [col, val] of map) {
    if (val !== undefined) { fields.push(`${col} = ?`); vals.push(val); }
  }
  if (isAdmin !== undefined) {
    if (!isSuperAdmin(req.user!)) {
      res.status(403).json({ error: "Only the Super Administrator may change administrator status" });
      return;
    }
    fields.push("is_admin = ?"); vals.push(isAdmin ? 1 : 0);
  }
  if (isTeamMember !== undefined) {
    if (!isSuperAdmin(req.user!)) {
      res.status(403).json({ error: "Only the Super Administrator may change team membership" });
      return;
    }
    fields.push("is_team_member = ?"); vals.push(isTeamMember ? 1 : 0);
  }
  if (isTeamMember === true) {
    syncPrivateChannelsForUser(id);
    const u = (await qGet<{
      username: string; email: string; country: string; city: string | null;
    }>("SELECT username, email, country, city FROM users WHERE id = ?", id))!;
    const existing = await qGet<{ id: number }>("SELECT id FROM team_members WHERE user_id = ?", id);
    if (!existing) {
      const maxOrder = (await qGet<{ m: number | null }>("SELECT MAX(sort_order) as m FROM team_members"))!.m || 0;
      const department = isSuperAdmin({ email: u.email }) ? "Leader" : "General";
      await qRun(`
        INSERT INTO team_members (name, role, department, country, city, status_label, status_color, sort_order, user_id)
        VALUES (?, 'Team Member', ?, ?, ?, 'Active', '#386A20', ?, ?)
      `, u.username, department, u.country || "Unknown", u.city || "?", maxOrder + 1, id);
    }
    broadcast("team:updated", {});
  } else if (isTeamMember === false) {
    await qRun("DELETE FROM team_members WHERE user_id = ?", id);
    broadcast("team:updated", {});
  }

  if (!fields.length) { res.status(400).json({ error: "No fields to update" }); return; }
  fields.push("updated_at = ?");
  vals.push(now(), id);
  try {
    await qRun(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`, ...vals);
  } catch (err) {
    if (isUsernameConstraintError(err)) {
      res.status(409).json({ error: USERNAME_TAKEN_ERROR });
      return;
    }
    throw err;
  }

  const updated = (await qGet<Record<string, unknown>>("SELECT * FROM users WHERE id = ?", id))!;
  if (username !== undefined && updated.username) {
    await syncTeamMemberDisplayName(id, String(updated.username));
  }
  await emitProfileUpdated(id);
  res.json({ user: await formatAdminUser(updated) });
});

router.post("/users/:id/disable", async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user!.id) { res.status(400).json({ error: "Cannot disable your own account" }); return; }
  const target = await getManageableUser(id);
  if (!target) { res.status(404).json({ error: "User not found" }); return; }
  if (denyUserManagement(res, req.user!, target)) return;
  await qRun("UPDATE users SET is_disabled = 1, updated_at = ? WHERE id = ?", now(), id);
  await bumpTokenVersion(id);
  res.json({ ok: true });
});

router.post("/users/:id/enable", async (req, res) => {
  const id = Number(req.params.id);
  const target = await getManageableUser(id);
  if (!target) { res.status(404).json({ error: "User not found" }); return; }
  if (denyUserManagement(res, req.user!, target)) return;
  await qRun("UPDATE users SET is_disabled = 0, updated_at = ? WHERE id = ?", now(), id);
  res.json({ ok: true });
});

router.delete("/users/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user!.id) { res.status(400).json({ error: "Cannot delete your own account" }); return; }
  const target = await getManageableUser(id);
  if (!target) { res.status(404).json({ error: "User not found" }); return; }
  if (denyUserManagement(res, req.user!, target)) return;
  const user = await qGet<{ username: string }>("SELECT username FROM users WHERE id = ? AND is_deleted = 0", id);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  await qRun("UPDATE users SET is_deleted = 1, is_disabled = 1, is_team_member = 0, updated_at = ? WHERE id = ?", now(), id);
  await qRun("DELETE FROM team_members WHERE user_id = ?", id);
  // Drop pending DM requests involving this user so accept/reject never hits a deleted account
  await qRun("UPDATE dm_requests SET status = 'rejected', updated_at = ? WHERE status = 'pending' AND (requester_id = ? OR recipient_id = ?)", now(), id, id);
  await bumpTokenVersion(id);
  logActivitySync({
    req, userId: req.user!.id,
    eventType: "user_delete", eventCategory: "administration",
    description: `Deleted user @${user.username}`,
    affectedObject: `user:${id}`,
    metadata: { userId: id, username: user.username },
  });
  emitToAdmins("admin:stats", {});
  emitToAdmins("team:updated", {});
  broadcast("team:updated", {});
  scheduleAdminStatsRefresh();
  res.json({ ok: true });
});

router.post("/users/bulk-delete", async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
  if (!ids.length) { res.status(400).json({ error: "ids array is required" }); return; }
  const unique = [...new Set(ids)].filter((id) => id !== req.user!.id);
  if (!unique.length) { res.status(400).json({ error: "No deletable users selected" }); return; }

  const placeholders = unique.map(() => "?").join(",");
  const rows = await qAll<{
    id: number; username: string; email: string; is_admin: number;
  }>(`SELECT id, username, email, is_admin FROM users WHERE id IN (${placeholders}) AND is_deleted = 0`, ...unique);
  const deletable = rows.filter((u) => canSelectTargetUser(req.user!, { email: u.email, is_admin: u.is_admin }));
  if (!deletable.length) { res.status(403).json({ error: "No deletable users in selection" }); return; }
  const ts = now();
  await qTransaction(async () => {
    for (const u of deletable) {
      await qRun("UPDATE users SET is_deleted = 1, is_disabled = 1, is_team_member = 0, updated_at = ? WHERE id = ?", ts, u.id);
      await qRun("DELETE FROM team_members WHERE user_id = ?", u.id);
      await qRun("UPDATE dm_requests SET status = 'rejected', updated_at = ? WHERE status = 'pending' AND (requester_id = ? OR recipient_id = ?)", ts, u.id, u.id);
      await bumpTokenVersion(u.id);
    }
  });

  logActivitySync({
    req, userId: req.user!.id,
    eventType: "user_bulk_delete", eventCategory: "administration",
    description: `Bulk deleted ${deletable.length} user(s)`,
    affectedObject: `users:${deletable.map((r) => r.id).join(",")}`,
    metadata: { count: deletable.length, usernames: deletable.map((r) => r.username) },
  });
  emitToAdmins("admin:stats", {});
  emitToAdmins("team:updated", {});
  broadcast("team:updated", {});
  scheduleAdminStatsRefresh();
  res.json({ ok: true, deleted: deletable.length });
});

// ?? Notifications ????????????????????????????????????????????????????????????
router.get("/notifications", async (_req, res) => {
  const rows = await qAll<Record<string, unknown>>("SELECT * FROM notifications ORDER BY pinned DESC, created_at DESC");
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

router.post("/notifications", async (req, res) => {
  const { title, body, source, page, recipientType, recipientIds, pinned } = req.body;
  if (!title || !body) { res.status(400).json({ error: "Title and body are required" }); return; }
  const ts = now();
  const result = await qRun(`
    INSERT INTO notifications (title, body, source, page, recipient_type, recipient_ids, pinned, notif_type, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'announcement', ?, ?)
  `, title, body, source || "Operations", page || "alarms", recipientType || "everyone", JSON.stringify(recipientIds || []), pinned ? 1 : 0, req.user!.id, ts);
  emitToAdmins("admin:notifications", {});
  scheduleAdminStatsRefresh();
  broadcast("notification:new", {});
  broadcast("counts:update", {});
  res.status(201).json({ id: result.lastInsertRowid });
});

router.patch("/notifications/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existing = await qGet("SELECT id FROM notifications WHERE id = ?", id);
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
  await qRun(`UPDATE notifications SET ${fields.join(", ")} WHERE id = ?`, ...vals);
  res.json({ ok: true });
});

router.delete("/notifications/:id", async (req, res) => {
  await qRun("DELETE FROM notifications WHERE id = ?", Number(req.params.id));
  emitToAdmins("admin:notifications", {});
  scheduleAdminStatsRefresh();
  broadcast("counts:update", {});
  res.json({ ok: true });
});

router.post("/notifications/:id/pin", async (req, res) => {
  await qRun("UPDATE notifications SET pinned = 1 WHERE id = ?", Number(req.params.id));
  emitToAdmins("admin:notifications", {});
  res.json({ ok: true });
});

router.post("/notifications/:id/unpin", async (req, res) => {
  await qRun("UPDATE notifications SET pinned = 0 WHERE id = ?", Number(req.params.id));
  emitToAdmins("admin:notifications", {});
  res.json({ ok: true });
});

// ?? Site content (About ? Our Story) ??????????????????????????????????????????
const storyImageUpload = createMemoryUploader({ limits: { fileSize: 5 * 1024 * 1024 } });
function storyImageMiddleware(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) {
  storyImageUpload.single("image")(req, res, (err: unknown) => {
    if (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid image upload" });
      return;
    }
    if (req.file) {
      const validated = validateUpload({
        kind: "storyImage",
        originalName: req.file.originalname,
        declaredMime: req.file.mimetype,
        buffer: req.file.buffer,
        size: req.file.size,
      });
      if (!validated.ok) {
        res.status(400).json({ error: validated.error });
        return;
      }
      (req.file as Express.Multer.File & { validatedContentType?: string }).validatedContentType = validated.contentType;
    }
    next();
  });
}

router.get("/content/about-our-story", async (req, res) => {
  const { getSiteContent, formatSiteContent, OUR_STORY_SLUG, upsertSiteContent } = await import("../services/siteContent.js");
  let row = await getSiteContent(OUR_STORY_SLUG);
  if (!row) {
    row = await upsertSiteContent(OUR_STORY_SLUG, {
      title: "Our Story",
      subtitle: "Building the next generation anime RPG.",
      body: "Plantend began as a passionate indie group pursuing a shinobi MMORPG.",
      quote: "Every legend begins with a single step.",
      status: "published",
    }, req.user!.id);
  }
  res.json({ content: formatSiteContent(row) });
});

router.put("/content/about-our-story", storyImageMiddleware, async (req, res) => {
  const {
    getSiteContent, upsertSiteContent, formatSiteContent, OUR_STORY_SLUG,
  } = await import("../services/siteContent.js");
  const existing = await getSiteContent(OUR_STORY_SLUG);
  let imageUrl: string | null | undefined = undefined;
  let removeImage = req.body?.removeImage === true || req.body?.removeImage === "true" || req.body?.removeImage === "1";
  try {
    if (req.file) {
      const stored = await persistMulterFile(req.file, "our-story", {
        contentType: (req.file as Express.Multer.File & { validatedContentType?: string }).validatedContentType,
      });
      imageUrl = stored.url;
      removeImage = false;
    }
    const statusRaw = req.body?.status;
    const status = statusRaw === "draft" || statusRaw === "published" ? statusRaw : undefined;
    const row = await upsertSiteContent(OUR_STORY_SLUG, {
      title: req.body?.title,
      subtitle: req.body?.subtitle,
      body: req.body?.body,
      quote: req.body?.quote,
      imageUrl,
      removeImage,
      status,
    }, req.user!.id, req);

    if ((imageUrl || removeImage) && existing?.image_url && existing.image_url !== row.image_url) {
      await deleteStoredUrl(existing.image_url);
      logActivitySync({
        req,
        userId: req.user!.id,
        eventType: "site_content_image",
        eventCategory: "administration",
        description: removeImage && !imageUrl
          ? "Removed Our Story image"
          : "Changed Our Story image",
        affectedObject: `site_content:${OUR_STORY_SLUG}`,
      });
    }

    res.json({ content: formatSiteContent(row) });
  } catch (e) {
    if (imageUrl) await deleteStoredUrl(imageUrl);
    res.status(400).json({ error: e instanceof Error ? e.message : "Failed to save content" });
  }
});

// ?? Channels ?????????????????????????????????????????????????????????????????
router.get("/channels", async (_req, res) => {
  const channels = await qAll<Record<string, unknown>>(`
    SELECT c.*, (SELECT COUNT(*) FROM conversation_participants cp WHERE cp.conversation_id = c.id) as member_count
    FROM conversations c
    WHERE c.type = 'channel'
    ORDER BY c.archived, COALESCE(c.sort_order, c.id), c.id
  `);
  res.json({
    channels: channels.map(c => ({
      id: c.id,
      name: c.name,
      bio: c.bio,
      archived: c.archived === 1,
      visibility: c.visibility || "public",
      moderatorIds: JSON.parse((c.moderator_ids as string) || "[]"),
      memberCount: c.member_count,
      avatarUrl: (c.avatar_url as string | null) || null,
      sortOrder: Number(c.sort_order ?? c.id),
      createdAt: c.created_at,
    })),
  });
});

/** Persist admin-defined channel order for all clients. */
router.put("/channels/reorder", async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0) : [];
  if (!ids.length) {
    res.status(400).json({ error: "ids array is required" });
    return;
  }
  const existing = await qAll<{ id: number }>(
    `SELECT id FROM conversations WHERE type = 'channel' AND id IN (${ids.map(() => "?").join(",")})`,
    ...ids,
  );
  if (existing.length !== ids.length) {
    res.status(400).json({ error: "One or more channel ids are invalid" });
    return;
  }
  for (let i = 0; i < ids.length; i++) {
    await qRun("UPDATE conversations SET sort_order = ? WHERE id = ? AND type = 'channel'", i + 1, ids[i]);
  }
  broadcast("channels:reorder", { ids });
  res.json({ ok: true, ids });
});

router.post("/channels", channelAvatarMiddleware, async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const bio = String(req.body?.bio || "");
  const visibility = req.body?.visibility === "private" ? "private" : "public";
  if (!name) {
    res.status(400).json({ error: "Name is required" });
    return;
  }
  const ts = now();
  const avatarUrl = req.file
    ? (await persistMulterFile(req.file, "channel-avatar", {
      contentType: (req.file as Express.Multer.File & { validatedContentType?: string }).validatedContentType,
    })).url
    : null;
  try {
    const maxOrder = await qGet<{ m: number | null }>(
      "SELECT MAX(sort_order) as m FROM conversations WHERE type = 'channel'",
    );
    const sortOrder = (Number(maxOrder?.m) || 0) + 1;
    const result = await qRun(`
      INSERT INTO conversations (type, name, bio, visibility, avatar_url, sort_order, created_at)
      VALUES ('channel', ?, ?, ?, ?, ?, ?)
    `, name, bio, visibility, avatarUrl, sortOrder, ts);
    const convId = result.lastInsertRowid as number;
    await qRun("INSERT INTO conversation_participants (conversation_id, user_id, joined_at, last_read_at) VALUES (?, ?, ?, ?)", convId, req.user!.id, ts, ts);
    if (visibility === "public") {
      const users = await qAll<{ id: number }>("SELECT id FROM users WHERE is_npc = 0 AND is_deleted = 0 AND is_disabled = 0");
      for (const u of users) {
        await qRun("INSERT OR IGNORE INTO conversation_participants (conversation_id, user_id, joined_at, last_read_at) VALUES (?, ?, ?, ?)", convId, u.id, ts, ts);
      }
    } else {
      syncPrivateChannelParticipants(convId);
    }
    // Notify all participants so Messages list picks up the new channel + avatar
    const participants = await qAll<{ user_id: number }>("SELECT user_id FROM conversation_participants WHERE conversation_id = ?", convId);
    for (const p of participants) {
      emitToUser(p.user_id, "conversation:new", { conversationId: convId });
    }
    scheduleAdminStatsRefresh();
    res.status(201).json({ id: convId, avatarUrl });
  } catch (e) {
    if (avatarUrl) await unlinkLocalUpload(avatarUrl);
    throw e;
  }
});

router.patch("/channels/:id", channelAvatarMiddleware, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await qGet<
    { id: number; name: string; bio: string; visibility: string; archived: number; moderator_ids: string; avatar_url: string | null }
  >("SELECT * FROM conversations WHERE id = ? AND type = 'channel'", id);
  if (!existing) {
    res.status(404).json({ error: "Channel not found" });
    return;
  }

  const fields: string[] = [];
  const vals: unknown[] = [];
  if (req.body?.name !== undefined) { fields.push("name = ?"); vals.push(String(req.body.name).trim() || existing.name); }
  if (req.body?.bio !== undefined) { fields.push("bio = ?"); vals.push(String(req.body.bio)); }
  const visibilityRaw = req.body?.visibility;
  if (visibilityRaw !== undefined) {
    fields.push("visibility = ?");
    vals.push(visibilityRaw === "private" ? "private" : "public");
  }
  if (req.body?.moderatorIds !== undefined) {
    let mods = req.body.moderatorIds;
    if (typeof mods === "string") {
      try { mods = JSON.parse(mods); } catch { mods = []; }
    }
    fields.push("moderator_ids = ?");
    vals.push(JSON.stringify(Array.isArray(mods) ? mods : []));
  }
  if (req.body?.archived !== undefined) {
    const archived = req.body.archived === true || req.body.archived === "true" || req.body.archived === "1" || req.body.archived === 1;
    fields.push("archived = ?");
    vals.push(archived ? 1 : 0);
  }

  const removeAvatar = req.body?.removeAvatar === true || req.body?.removeAvatar === "true" || req.body?.removeAvatar === "1";
  let nextAvatar = existing.avatar_url;
  let replacedFile: string | null = null;

  if (req.file) {
    nextAvatar = (await persistMulterFile(req.file, "channel-avatar", {
      contentType: (req.file as Express.Multer.File & { validatedContentType?: string }).validatedContentType,
    })).url;
    fields.push("avatar_url = ?");
    vals.push(nextAvatar);
    replacedFile = existing.avatar_url;
  } else if (removeAvatar) {
    nextAvatar = null;
    fields.push("avatar_url = ?");
    vals.push(null);
    replacedFile = existing.avatar_url;
  }

  if (!fields.length) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  try {
    vals.push(id);
    await qRun(`UPDATE conversations SET ${fields.join(", ")} WHERE id = ? AND type = 'channel'`, ...vals);
    if (visibilityRaw === "private") {
      await syncPrivateChannelParticipants(id);
      const revoked = await pruneIneligiblePrivateParticipants(id);
      if (revoked.length) forceLeaveConversationMany(revoked, id);
    }
    if (visibilityRaw === "public") {
      const users = await qAll<{ id: number }>("SELECT id FROM users WHERE is_npc = 0 AND is_deleted = 0 AND is_disabled = 0");
      const ts = now();
      for (const u of users) {
        await qRun("INSERT OR IGNORE INTO conversation_participants (conversation_id, user_id, joined_at, last_read_at) VALUES (?, ?, ?, ?)", id, u.id, ts, ts);
      }
    }
    if (replacedFile && replacedFile !== nextAvatar) await unlinkLocalUpload(replacedFile);
    emitConversationUpdate(id);
    scheduleAdminStatsRefresh();
    res.json({ ok: true, avatarUrl: nextAvatar });
  } catch (e) {
    if (nextAvatar && nextAvatar !== existing.avatar_url) await unlinkLocalUpload(nextAvatar);
    throw e;
  }
});

router.delete("/channels/:id", async (req, res) => {
  const id = Number(req.params.id);
  const row = await qGet<{ avatar_url: string | null }>("SELECT avatar_url FROM conversations WHERE id = ? AND type = 'channel'", id);
  const participantIds = (await qAll<{ user_id: number }>("SELECT user_id FROM conversation_participants WHERE conversation_id = ?", id))
    .map((p) => p.user_id);
  const mediaRows = await qAll<{ media_url: string | null }>(
    "SELECT media_url FROM messages WHERE conversation_id = ? AND media_url IS NOT NULL",
    id,
  );
  for (const m of mediaRows) {
    await unlinkLocalUpload(m.media_url);
  }
  await qRun("DELETE FROM messages WHERE conversation_id = ?", id);
  await qRun("DELETE FROM conversation_participants WHERE conversation_id = ?", id);
  await qRun("DELETE FROM conversations WHERE id = ? AND type = 'channel'", id);
  if (row?.avatar_url) await unlinkLocalUpload(row.avatar_url);
  for (const pid of participantIds) {
    emitToUser(pid, "conversation:update", { conversationId: id });
  }
  scheduleAdminStatsRefresh();
  res.json({ ok: true });
});

// ?? Contact Management ???????????????????????????????????????????????????????
async function formatContactTicket(row: Record<string, unknown>) {
  const replies = await qAll<Record<string, unknown>>(`
    SELECT cr.id, cr.body, cr.created_at, u.username as admin_username
    FROM contact_replies cr
    LEFT JOIN users u ON u.id = cr.admin_id
    WHERE cr.ticket_id = ?
    ORDER BY cr.created_at ASC
  `, row.id);

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
    replies: replies.map(r => ({
      id: r.id,
      body: r.body,
      createdAt: r.created_at,
      adminUsername: r.admin_username,
    })),
  };
}

router.get("/contacts", async (_req, res) => {
  const rows = await qAll<Record<string, unknown>>("SELECT * FROM contact_tickets ORDER BY created_at DESC");
  res.json({ contacts: await Promise.all(rows.map(formatContactTicket)) });
});

router.get("/contacts/:id", async (req, res) => {
  const row = await qGet<Record<string, unknown>>("SELECT * FROM contact_tickets WHERE id = ?", Number(req.params.id));
  if (!row) { res.status(404).json({ error: "Contact not found" }); return; }
  if (row.is_read !== 1) {
    await qRun("UPDATE contact_tickets SET is_read = 1, updated_at = ? WHERE id = ?", now(), row.id);
    row.is_read = 1;
    emitToAdmins("admin:contact", { contactId: row.id });
    scheduleAdminStatsRefresh();
  }
  res.json({ contact: await formatContactTicket(row) });
});

router.patch("/contacts/:id/read", async (req, res) => {
  const id = Number(req.params.id);
  const ts = now();
  await qRun("UPDATE contact_tickets SET is_read = 1, updated_at = ? WHERE id = ?", ts, id);
  emitToAdmins("admin:contact", { contactId: id });
  scheduleAdminStatsRefresh();
  res.json({ ok: true });
});

router.post("/contacts/:id/reply", async (req, res) => {
  const id = Number(req.params.id);
  const { body } = req.body;
  if (!body?.trim()) { res.status(400).json({ error: "Reply body is required" }); return; }

  const ticket = await qGet<{
    id: number; user_id: number | null; email: string; name: string; subject: string;
  }>("SELECT * FROM contact_tickets WHERE id = ?", id);
  if (!ticket) { res.status(404).json({ error: "Contact not found" }); return; }

  const ts = now();
  await qRun("INSERT INTO contact_replies (ticket_id, admin_id, body, created_at) VALUES (?, ?, ?, ?)", id, req.user!.id, body.trim(), ts);
  await qRun("UPDATE contact_tickets SET reply_status = 'replied', is_read = 1, updated_at = ? WHERE id = ?", ts, id);

  if (ticket.user_id) {
    await qRun(`
      INSERT INTO notifications (title, body, source, page, user_id, notif_type, created_at)
      VALUES (?, ?, 'Support', 'alarms', ?, 'contact_reply', ?)
    `,
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

  const updated = (await qGet<Record<string, unknown>>("SELECT * FROM contact_tickets WHERE id = ?", id))!;
  emitToAdmins("admin:contact", { contactId: id });
  scheduleAdminStatsRefresh();
  res.status(201).json({ contact: await formatContactTicket(updated) });
});

router.delete("/contacts/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existing = await qGet<{ id: number; subject: string; name: string }>(
    "SELECT id, subject, name FROM contact_tickets WHERE id = ?", id,
  );
  if (!existing) { res.status(404).json({ error: "Contact not found" }); return; }
  await qRun("DELETE FROM contact_tickets WHERE id = ?", id);
  logActivitySync({
    req, userId: req.user!.id,
    eventType: "contact_delete", eventCategory: "administration",
    description: `Deleted contact ticket #${id}: ${existing.subject}`,
    affectedObject: `contact:${id}`,
    metadata: { contactId: id, name: existing.name },
  });
  emitToAdmins("admin:contact", { contactId: id, deleted: true });
  scheduleAdminStatsRefresh();
  res.json({ ok: true });
});

// ?? Teamwork Applications ????????????????????????????????????????????????????
router.get("/applications", async (_req, res) => {
  const apps = await qAll<Record<string, unknown>>(TEAMWORK_APPLICATIONS_LIST_SQL);
  res.json({
    applications: apps.map(a => ({
      id: a.id,
      applicant: {
        id: a.user_id,
        username: a.username,
        email: a.email,
        avatarUrl: a.avatar_url,
      },
      fullName: a.full_name,
      gender: a.gender,
      dateOfBirth: a.date_of_birth,
      country: a.country,
      city: a.city,
      photoUrl: a.photo_url,
      cvUrl: a.cv_url,
      portfolioUrl: a.portfolio_url,
      message: a.message,
      jobTitle: a.job_title,
      status: a.status,
      createdAt: a.created_at,
      time: timeAgo(a.created_at as string),
    })),
  });
});

router.post("/applications/:id/approve", async (req, res) => {
  const id = Number(req.params.id);
  const app = await qGet<{
    user_id: number;
    full_name: string;
    status: string;
    job_id: number;
    country: string | null;
    city: string | null;
  }>("SELECT * FROM job_applications WHERE id = ?", id);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  if (app.status !== "pending") { res.status(400).json({ error: "Application already processed" }); return; }

  const job = await qGet<{ title: string; department: string }>(
    "SELECT title, department FROM job_postings WHERE id = ?",
    app.job_id,
  );
  const ts = now();
  await qRun("UPDATE job_applications SET status = 'approved' WHERE id = ?", id);
  await qRun("UPDATE users SET is_team_member = 1, updated_at = ? WHERE id = ?", ts, app.user_id);
  syncPrivateChannelsForUser(app.user_id);

  const user = (await qGet<{ username: string; country: string; city: string | null }>("SELECT username, country, city FROM users WHERE id = ?", app.user_id))!;
  const existing = await qGet<{ id: number }>("SELECT id FROM team_members WHERE user_id = ? OR name = ?", app.user_id, app.full_name);
  const roleTitle = job?.title || "Team Member";
  const department = job?.department || "General";
  const country = app.country || user.country || "Unknown";
  const city = app.city || user.city || "?";
  if (!existing) {
    const maxOrder = (await qGet<{ m: number | null }>("SELECT MAX(sort_order) as m FROM team_members"))!.m || 0;
    await qRun(`
      INSERT INTO team_members (name, role, department, country, city, status_label, status_color, sort_order, user_id)
      VALUES (?, ?, ?, ?, ?, 'New', '#006688', ?, ?)
    `, app.full_name || user.username, roleTitle, department, country, city, maxOrder + 1, app.user_id);
  } else {
    await qRun(
      "UPDATE team_members SET user_id = ?, role = ?, department = ?, country = ?, city = ? WHERE id = ?",
      app.user_id,
      roleTitle,
      department,
      country,
      city,
      existing.id,
    );
  }

  await qRun(`
    INSERT INTO notifications (title, body, source, page, user_id, notif_type, created_at)
    VALUES ('Application Approved', ?, 'Teamwork', 'teamwork', ?, 'announcement', ?)
  `, `Your teamwork application has been approved. Welcome to the team!`, app.user_id, ts);

  logActivitySync({
    req,
    userId: req.user!.id,
    eventType: "application_approve",
    eventCategory: "teamwork",
    description: `Approved teamwork application #${id} from @${user.username} for ${roleTitle}`,
    affectedObject: `job_application:${id}`,
    metadata: { applicationId: id, userId: app.user_id, jobTitle: roleTitle },
  });

  emitToUser(app.user_id, "notification:new", {});
  emitToAdmins("admin:applications", {});
  scheduleAdminStatsRefresh();
  emitToAdmins("team:updated", {});
  broadcast("team:updated", {});

  res.json({ ok: true });
});

router.post("/applications/:id/reject", async (req, res) => {
  const id = Number(req.params.id);
  const app = await qGet<{ user_id: number; status: string; full_name: string }>("SELECT * FROM job_applications WHERE id = ?", id);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  if (app.status !== "pending") { res.status(400).json({ error: "Application already processed" }); return; }

  const ts = now();
  await qRun("UPDATE job_applications SET status = 'rejected' WHERE id = ?", id);
  await qRun(`
    INSERT INTO notifications (title, body, source, page, user_id, notif_type, created_at)
    VALUES ('Application Update', ?, 'Teamwork', 'teamwork', ?, 'announcement', ?)
  `, `Your teamwork application was not approved at this time.`, app.user_id, ts);

  logActivitySync({
    req,
    userId: req.user!.id,
    eventType: "application_reject",
    eventCategory: "teamwork",
    description: `Rejected teamwork application #${id} from ${app.full_name}`,
    affectedObject: `job_application:${id}`,
    metadata: { applicationId: id, userId: app.user_id },
  });

  emitToUser(app.user_id, "notification:new", {});
  emitToAdmins("admin:applications", {});
  scheduleAdminStatsRefresh();

  res.json({ ok: true });
});

router.delete("/applications/:id", async (req, res) => {
  const id = Number(req.params.id);
  const app = await qGet<{
    id: number;
    full_name: string;
    status: string;
    username: string;
    photo_url: string | null;
    cv_url: string | null;
  }>(`
    SELECT ja.id, ja.full_name, ja.status, ja.photo_url, ja.cv_url, u.username
    FROM job_applications ja JOIN users u ON u.id = ja.user_id
    WHERE ja.id = ?
  `, id);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  await unlinkLocalUpload(app.photo_url);
  await unlinkLocalUpload(app.cv_url);
  await qRun("DELETE FROM job_applications WHERE id = ?", id);
  logActivitySync({
    req, userId: req.user!.id,
    eventType: "application_delete", eventCategory: "teamwork",
    description: `Deleted teamwork application #${id} from @${app.username}`,
    affectedObject: `job_application:${id}`,
    metadata: { applicationId: id, username: app.username, status: app.status },
  });
  emitToAdmins("admin:applications", {});
  scheduleAdminStatsRefresh();
  res.json({ ok: true });
});

// ?? Resources ????????????????????????????????????????????????????????????????
router.get("/resources", async (_req, res) => {
  const rows = await qAll<Record<string, unknown>>(`
    SELECT r.*, u.username as uploader_name
    FROM resources r LEFT JOIN users u ON u.id = r.uploader_id
    ORDER BY r.sort_order, r.published_at DESC
  `);
  res.json({
    resources: rows.map(r => ({
      id: r.id,
      title: r.title,
      category: r.category,
      description: r.description,
      contentUrl: r.content_url,
      externalUrl: r.external_url || null,
      publishedAt: r.published_at,
      enabled: r.enabled !== 0,
      uploaderId: r.uploader_id,
      uploaderName: r.uploader_name,
      fileSize: r.file_size,
      version: r.version,
      sortOrder: r.sort_order,
      originalFilename: r.original_filename || null,
      publicSlug: r.public_slug_display || r.public_slug || String(r.id),
      publicPath: resourcePublicPath(String(r.public_slug_display || r.public_slug || r.id)),
      visibility: String(r.visibility || "PUBLIC").toUpperCase() === "PRIVATE" ? "PRIVATE" : "PUBLIC",
    })),
  });
});

router.put("/resources/reorder", async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0) : [];
  if (!ids.length) {
    res.status(400).json({ error: "ids array is required" });
    return;
  }
  const existing = await qAll<{ id: number }>(
    `SELECT id FROM resources WHERE id IN (${ids.map(() => "?").join(",")})`,
    ...ids,
  );
  if (existing.length !== ids.length) {
    res.status(400).json({ error: "One or more resource ids are invalid" });
    return;
  }
  for (let i = 0; i < ids.length; i++) {
    await qRun("UPDATE resources SET sort_order = ? WHERE id = ?", i + 1, ids[i]);
  }
  res.json({ ok: true, ids });
});

router.post("/resources", extendUploadSocketTimeouts, resourceFileUpload, async (req, res) => {
  const started = Date.now();
  const { title, category, description, version, sortOrder, enabled, visibility, externalUrl, publicSlug } = req.body;
  if (!title || !category) {
    cleanupTempFile(req.file);
    res.status(400).json({ error: "Title and category are required" });
    return;
  }
  const normalizedCategory = normalizeResourceCategory(category);
  if (!normalizedCategory) {
    cleanupTempFile(req.file);
    res.status(400).json({ error: RESOURCE_CATEGORY_ERROR });
    return;
  }

  const allowsExternal = allowsExternalDownload(normalizedCategory);
  const hasExternalUrl = externalUrl != null && String(externalUrl).trim() !== "";
  const hasFile = !!req.file;

  let isExternal = false;
  let external: string | null = null;

  if (allowsExternal) {
    if (hasExternalUrl && hasFile) {
      cleanupTempFile(req.file);
      res.status(400).json({ error: "Choose either a file upload or an external URL, not both" });
      return;
    }
    if (hasExternalUrl) {
      cleanupTempFile(req.file);
      const checked = validateExternalDownloadUrl(externalUrl);
      if (!checked.ok) {
        res.status(400).json({ error: checked.error });
        return;
      }
      external = checked.url;
      isExternal = true;
    } else if (!hasFile) {
      res.status(400).json({ error: "Provide a file upload or an external download URL for App resources" });
      return;
    }
  } else if (hasExternalUrl) {
    // Non-App categories are file-only — ignore stray external URLs.
  }

  if (!isExternal && !hasFile) {
    res.status(400).json({ error: "File upload is required" });
    return;
  }

  let stored: PutObjectResult | null = null;
  try {
    const ts = now();
    if (!isExternal && req.file) stored = await persistMulterFile(req.file, "resource");
    const fileUrl = isExternal ? null : (stored?.url ?? null);
    const fileSize = isExternal ? null : (stored?.size ?? null);
    const originalFilename = isExternal ? null : (req.file?.originalname?.trim() || null);
    const vis = String(visibility || "PUBLIC").toUpperCase() === "PRIVATE" ? "PRIVATE" : "PUBLIC";
    let order = Number(sortOrder);
    if (!Number.isFinite(order)) {
      const maxRow = await qGet<{ m: number | null }>("SELECT COALESCE(MAX(sort_order), 0) as m FROM resources");
      order = Number(maxRow?.m ?? 0) + 1;
    }

    // Resolve / allocate public_slug before INSERT so create does not depend on a
    // follow-up UPDATE (and fails clearly if migration 023 is missing).
    const hasCustomSlug = publicSlug != null && String(publicSlug).trim() !== "";
    let finalSlug: { slug: string; display: string };
    if (hasCustomSlug) {
      const custom = await resolveResourcePublicSlug({ raw: publicSlug });
      if (!custom.ok) {
        cleanupTempFile(req.file);
        await rollbackStoredFile(stored);
        res.status(400).json({ error: custom.error });
        return;
      }
      finalSlug = custom;
    } else {
      const provisional = generateResourcePublicSlug();
      finalSlug = { slug: provisional, display: provisional };
    }

    const result = await qRun(`
      INSERT INTO resources (title, category, description, content_url, external_url, published_at, enabled, uploader_id, file_size, version, sort_order, visibility, original_filename, public_slug, public_slug_display)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, title, normalizedCategory, description || "", fileUrl, external, ts, enabled === "false" ? 0 : 1, req.user!.id, fileSize, version || null, order, vis, originalFilename, finalSlug.slug, finalSlug.display);
    const newId = Number(result.lastInsertRowid);

    // Prefer the numeric id as the public download ID when the admin did not set one.
    if (!hasCustomSlug) {
      const preferred = await resolveResourcePublicSlug({
        raw: undefined,
        defaultId: newId,
        excludeId: newId,
      });
      if (preferred.ok) {
        await qRun(
          "UPDATE resources SET public_slug = ?, public_slug_display = ? WHERE id = ?",
          preferred.slug,
          preferred.display,
          newId,
        );
        finalSlug = preferred;
      }
    }
    if (!isExternal) {
      logAdminUpload({
        ok: true,
        uploadType: "resource",
        adminId: req.user!.id,
        username: req.user!.username,
        filename: req.file?.originalname ?? null,
        fileSize,
        durationMs: Date.now() - started,
        resourceId: newId,
        ipAddress: clientIp(req),
      });
    }
    logActivitySync({
      req,
      userId: req.user!.id,
      eventType: isExternal ? "resource_external_url" : "resource_upload",
      eventCategory: "resources",
      description: isExternal
        ? `Registered external download for resource "${title}"`
        : `Uploaded resource "${title}"`,
      affectedObject: `resource:${newId}`,
    });
    scheduleAdminStatsRefresh();
    res.status(201).json({ id: newId, publicSlug: finalSlug.display, publicPath: resourcePublicPath(finalSlug.display) });
  } catch (err) {
    cleanupTempFile(req.file);
    await rollbackStoredFile(stored);
    if (!isExternal) {
      logAdminUpload({
        ok: false,
        uploadType: "resource",
        adminId: req.user!.id,
        username: req.user!.username,
        filename: req.file?.originalname ?? null,
        fileSize: req.file?.size ?? null,
        durationMs: Date.now() - started,
        reason: err instanceof Error ? err.message : String(err),
        ipAddress: clientIp(req),
      });
    }
    throw err;
  }
});

router.patch("/resources/:id", extendUploadSocketTimeouts, resourceFileUpload, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await qGet<{
    content_url: string | null;
    external_url: string | null;
    category: string;
  }>("SELECT * FROM resources WHERE id = ?", id);
  if (!existing) {
    cleanupTempFile(req.file);
    res.status(404).json({ error: "Resource not found" });
    return;
  }

  const { title, category, description, version, sortOrder, enabled, visibility, externalUrl, publicSlug } = req.body;
  const fields: string[] = [];
  const vals: unknown[] = [];
  if (title !== undefined) { fields.push("title = ?"); vals.push(title); }

  let nextCategory = existing.category;
  if (category !== undefined) {
    const normalizedCategory = normalizeResourceCategory(category);
    if (!normalizedCategory) {
      cleanupTempFile(req.file);
      res.status(400).json({ error: RESOURCE_CATEGORY_ERROR });
      return;
    }
    fields.push("category = ?"); vals.push(normalizedCategory);
    nextCategory = normalizedCategory;
  }
  if (description !== undefined) { fields.push("description = ?"); vals.push(description); }
  if (version !== undefined) { fields.push("version = ?"); vals.push(version); }
  if (sortOrder !== undefined && String(sortOrder).trim() !== "") {
    const n = Number(sortOrder);
    if (!Number.isFinite(n)) {
      cleanupTempFile(req.file);
      res.status(400).json({ error: "Invalid display order" });
      return;
    }
    fields.push("sort_order = ?"); vals.push(n);
  }
  if (enabled !== undefined) { fields.push("enabled = ?"); vals.push(enabled === "false" || enabled === false ? 0 : 1); }
  if (visibility !== undefined) {
    fields.push("visibility = ?");
    vals.push(String(visibility).toUpperCase() === "PRIVATE" ? "PRIVATE" : "PUBLIC");
  }
  if (publicSlug !== undefined) {
    const slugResolved = await resolveResourcePublicSlug({
      raw: publicSlug,
      defaultId: id,
      excludeId: id,
    });
    if (!slugResolved.ok) {
      cleanupTempFile(req.file);
      res.status(400).json({ error: slugResolved.error });
      return;
    }
    fields.push("public_slug = ?"); vals.push(slugResolved.slug);
    fields.push("public_slug_display = ?"); vals.push(slugResolved.display);
  }

  const allowsExternal = allowsExternalDownload(nextCategory);
  const hasExternalUrl = externalUrl !== undefined && String(externalUrl).trim() !== "";
  const hasFile = !!req.file;
  const started = Date.now();
  let stored: PutObjectResult | null = null;
  let replacedFile: string | null = null;
  let isExternal = false;

  try {
    if (allowsExternal && hasExternalUrl && hasFile) {
      cleanupTempFile(req.file);
      res.status(400).json({ error: "Choose either a file upload or an external URL, not both" });
      return;
    }

    if (allowsExternal && hasExternalUrl) {
      cleanupTempFile(req.file);
      const checked = validateExternalDownloadUrl(externalUrl);
      if (!checked.ok) {
        res.status(400).json({ error: checked.error });
        return;
      }
      isExternal = true;
      fields.push("external_url = ?"); vals.push(checked.url);
      fields.push("content_url = ?"); vals.push(null);
      fields.push("file_size = ?"); vals.push(null);
      fields.push("original_filename = ?"); vals.push(null);
      replacedFile = existing.content_url;
    } else if (req.file) {
      stored = await persistMulterFile(req.file, "resource");
      fields.push("content_url = ?"); vals.push(stored.url);
      fields.push("file_size = ?"); vals.push(stored.size);
      fields.push("external_url = ?"); vals.push(null);
      fields.push("original_filename = ?"); vals.push(req.file.originalname?.trim() || null);
      replacedFile = existing.content_url;
    } else if (allowsExternal) {
      // Keep existing source; require at least one.
      if (!existing.external_url && !existing.content_url) {
        res.status(400).json({ error: "Provide a file upload or an external download URL for App resources" });
        return;
      }
      isExternal = !!existing.external_url;
    } else {
      // Leaving App / non-App update: drop any external URL.
      if (existing.external_url) {
        fields.push("external_url = ?"); vals.push(null);
      }
    }

    if (!fields.length) { res.status(400).json({ error: "No fields to update" }); return; }
    vals.push(id);
    await qRun(`UPDATE resources SET ${fields.join(", ")} WHERE id = ?`, ...vals);
    if (replacedFile) await deleteStoredUrl(replacedFile);
    if (req.file && !isExternal) {
      logAdminUpload({
        ok: true,
        uploadType: "resource",
        adminId: req.user!.id,
        username: req.user!.username,
        filename: req.file.originalname,
        fileSize: req.file.size,
        durationMs: Date.now() - started,
        resourceId: id,
        ipAddress: clientIp(req),
      });
    }
    scheduleAdminStatsRefresh();
    res.json({ ok: true });
  } catch (err) {
    cleanupTempFile(req.file);
    await rollbackStoredFile(stored);
    if (req.file && !isExternal) {
      logAdminUpload({
        ok: false,
        uploadType: "resource",
        adminId: req.user!.id,
        username: req.user!.username,
        filename: req.file.originalname,
        fileSize: req.file.size,
        durationMs: Date.now() - started,
        reason: err instanceof Error ? err.message : String(err),
        resourceId: id,
        ipAddress: clientIp(req),
      });
    }
    throw err;
  }
});

router.delete("/resources/:id", async (req, res) => {
  const id = Number(req.params.id);
  const row = await qGet<{ content_url: string | null }>("SELECT content_url FROM resources WHERE id = ?", id);
  if (row?.content_url) await deleteStoredUrl(row.content_url);
  await qRun("DELETE FROM resources WHERE id = ?", id);
  scheduleAdminStatsRefresh();
  res.json({ ok: true });
});

// ?? Game Downloads ?????????????????????????????????????????????????????????????
router.get("/game-downloads", async (_req, res) => {
  const rows = await qAll<Record<string, unknown>>(`
    SELECT g.*, u.username as uploader_name
    FROM game_downloads g LEFT JOIN users u ON u.id = g.uploader_id
    ORDER BY g.platform, g.published_at DESC
  `);
  res.json({
    downloads: rows.map(r => {
      const size = gameFileSizeApiFields({
        file_size_value: r.file_size_value as number | null,
        file_size_unit: r.file_size_unit as string | null,
        file_size: r.file_size as number | null,
      });
      return {
        id: r.id,
        platform: r.platform,
        version: r.version,
        releaseNotes: r.release_notes,
        fileUrl: r.file_url,
        externalUrl: r.external_url || null,
        fileSize: size.fileSize,
        fileSizeUnit: size.fileSizeUnit,
        published: r.published === 1,
        publishedAt: r.published_at,
        uploaderName: r.uploader_name,
      };
    }),
  });
});

/** Games use external download URLs only (no backend file upload). */
router.post("/game-downloads", async (req, res) => {
  const { platform, version, releaseNotes, published, externalUrl, fileSize, fileSizeUnit } = req.body;
  if (!platform || !version) {
    res.status(400).json({ error: "Platform and version are required" });
    return;
  }
  const checked = validateExternalDownloadUrl(externalUrl);
  if (!checked.ok) {
    res.status(400).json({ error: checked.error });
    return;
  }
  const size = parseGameFileSize(fileSize, fileSizeUnit ?? "MB");
  if (!size.ok) {
    res.status(400).json({ error: size.error });
    return;
  }
  const ts = now();
  const isPub = published === "true" || published === true;
  const result = await qRun(`
    INSERT INTO game_downloads (
      platform, version, release_notes, file_url, file_size, file_size_value, file_size_unit,
      external_url, published, published_at, uploader_id, created_at, updated_at
    )
    VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, platform, version, releaseNotes || "", size.bytes, size.value, size.unit, checked.url, isPub ? 1 : 0, isPub ? ts : null, req.user!.id, ts, ts);
  logActivitySync({
    req,
    userId: req.user!.id,
    eventType: "game_build_external_url",
    eventCategory: "downloads",
    description: `Registered external download for ${platform} build v${version}`,
    affectedObject: `game_download:${result.lastInsertRowid}`,
  });
  res.status(201).json({ id: result.lastInsertRowid });
});

router.patch("/game-downloads/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existing = await qGet<{ file_url: string | null; external_url: string | null }>(
    "SELECT file_url, external_url FROM game_downloads WHERE id = ?",
    id,
  );
  if (!existing) {
    res.status(404).json({ error: "Game build not found" });
    return;
  }
  const { version, releaseNotes, published, externalUrl, fileSize, fileSizeUnit } = req.body;
  const fields: string[] = ["updated_at = ?"];
  const vals: unknown[] = [now()];
  if (version !== undefined) { fields.push("version = ?"); vals.push(version); }
  if (releaseNotes !== undefined) { fields.push("release_notes = ?"); vals.push(releaseNotes); }
  if (published !== undefined) {
    const isPub = published === "true" || published === true;
    fields.push("published = ?"); vals.push(isPub ? 1 : 0);
    fields.push("published_at = ?"); vals.push(isPub ? now() : null);
  }

  if (fileSize !== undefined || fileSizeUnit !== undefined) {
    const size = parseGameFileSize(
      fileSize,
      fileSizeUnit !== undefined ? fileSizeUnit : "MB",
    );
    if (!size.ok) {
      res.status(400).json({ error: size.error });
      return;
    }
    fields.push("file_size = ?"); vals.push(size.bytes);
    fields.push("file_size_value = ?"); vals.push(size.value);
    fields.push("file_size_unit = ?"); vals.push(size.unit);
  }

  let replacedFile: string | null = null;
  if (externalUrl !== undefined) {
    const checked = validateExternalDownloadUrl(externalUrl);
    if (!checked.ok) {
      res.status(400).json({ error: checked.error });
      return;
    }
    fields.push("external_url = ?"); vals.push(checked.url);
    fields.push("file_url = ?"); vals.push(null);
    replacedFile = existing.file_url;
  } else if (!existing.external_url && !existing.file_url) {
    res.status(400).json({ error: "External download URL is required" });
    return;
  } else if (!existing.external_url && existing.file_url) {
    res.status(400).json({ error: "External download URL is required for game builds" });
    return;
  }

  vals.push(id);
  await qRun(`UPDATE game_downloads SET ${fields.join(", ")} WHERE id = ?`, ...vals);
  if (replacedFile) await deleteStoredUrl(replacedFile);
  logActivitySync({
    req,
    userId: req.user!.id,
    eventType: "game_build_update",
    eventCategory: "downloads",
    description: `Updated game build #${id}`,
    affectedObject: `game_download:${id}`,
  });
  res.json({ ok: true });
});

router.delete("/game-downloads/:id", async (req, res) => {
  const id = Number(req.params.id);
  const row = await qGet<{ file_url: string | null }>("SELECT file_url FROM game_downloads WHERE id = ?", id);
  if (row?.file_url) await deleteStoredUrl(row.file_url);
  await qRun("DELETE FROM game_downloads WHERE id = ?", id);
  logActivitySync({ req, userId: req.user!.id, eventType: "game_build_delete", eventCategory: "downloads", description: `Deleted game build #${id}`, affectedObject: `game_download:${id}` });
  res.json({ ok: true });
});

// ?? Activity Logs ??????????????????????????????????????????????????????????????
router.get("/activity-logs/meta", async (req, res) => {
  // LOWER(...) is portable ? COLLATE NOCASE is SQLite-only and fails on PostgreSQL.
  const visibility = activityLogVisibilityFor(req.user!);
  const eventTypes = (await qAll<{ v: string }>(`
    SELECT DISTINCT event_type as v FROM activity_logs
    WHERE event_type IS NOT NULL AND event_type != ''${visibility.sql}
    ORDER BY LOWER(event_type)
  `, ...visibility.params)).map((r) => r.v);
  const eventCategories = (await qAll<{ v: string }>(`
    SELECT DISTINCT event_category as v FROM activity_logs
    WHERE event_category IS NOT NULL AND event_category != ''
    ORDER BY LOWER(event_category)
  `)).map((r) => r.v);
  res.json({ eventTypes, eventCategories });
});

router.get("/activity-logs", async (req, res) => {
  const {
    search, timeRange, userRole, eventCategory, result, country, isVpn,
    deviceType, browser, os, page = "1", limit = "50",
    dateFrom, dateTo, userId, username,
  } = req.query as Record<string, string>;

  let sql = "SELECT * FROM activity_logs WHERE 1=1";
  const params: unknown[] = [];

  const visibility = activityLogVisibilityFor(req.user!);
  if (visibility.sql) {
    sql += visibility.sql;
    params.push(...visibility.params);
  }

  const nowMs = Date.now();
  if (timeRange === "today") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    sql += " AND timestamp >= ?";
    params.push(start.toISOString());
  } else if (timeRange === "yesterday") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const yStart = new Date(start);
    yStart.setDate(yStart.getDate() - 1);
    sql += " AND timestamp >= ? AND timestamp < ?";
    params.push(yStart.toISOString(), start.toISOString());
  } else if (timeRange === "7d") {
    sql += " AND timestamp >= ?";
    params.push(new Date(nowMs - 7 * 86400000).toISOString());
  } else if (timeRange === "30d") {
    sql += " AND timestamp >= ?";
    params.push(new Date(nowMs - 30 * 86400000).toISOString());
  }
  if (dateFrom) { sql += " AND timestamp >= ?"; params.push(dateFrom); }
  if (dateTo) { sql += " AND timestamp <= ?"; params.push(dateTo); }
  if (userRole) { sql += " AND user_role = ?"; params.push(userRole); }
  if (eventCategory) { sql += " AND event_category = ?"; params.push(eventCategory); }
  if (req.query.eventType) { sql += " AND event_type = ?"; params.push(String(req.query.eventType)); }
  if (result) { sql += " AND result = ?"; params.push(result); }
  if (country) { sql += " AND LOWER(country) LIKE LOWER(?)"; params.push(`%${country}%`); }
  if (isVpn === "1") sql += " AND is_vpn = 1";
  if (isVpn === "0") sql += " AND (is_vpn = 0 OR is_vpn IS NULL)";
  if (deviceType) { sql += " AND LOWER(device_type) = ?"; params.push(String(deviceType).toLowerCase()); }
  if (browser) { sql += " AND LOWER(browser) LIKE LOWER(?)"; params.push(`%${browser}%`); }
  if (os) { sql += " AND LOWER(os) LIKE LOWER(?)"; params.push(`%${os}%`); }
  if (userId) { sql += " AND user_id = ?"; params.push(Number(userId)); }
  if (username) {
    sql += " AND (LOWER(username) LIKE LOWER(?) OR LOWER(display_name) LIKE LOWER(?))";
    params.push(`%${username}%`, `%${username}%`);
  }
  if (search) {
    sql += ` AND (
      LOWER(username) LIKE LOWER(?) OR LOWER(display_name) LIKE LOWER(?) OR LOWER(ip_address) LIKE LOWER(?) OR LOWER(description) LIKE LOWER(?)
      OR LOWER(event_category) LIKE LOWER(?) OR LOWER(event_type) LIKE LOWER(?) OR LOWER(affected_object) LIKE LOWER(?)
      OR LOWER(browser) LIKE LOWER(?) OR LOWER(os) LIKE LOWER(?) OR LOWER(device_type) LIKE LOWER(?) OR LOWER(request_path) LIKE LOWER(?)
    )`;
    const q = `%${search}%`;
    params.push(q, q, q, q, q, q, q, q, q, q, q);
  }

  const countRow = (await qGet<{ c: number }>(sql.replace("SELECT *", "SELECT COUNT(*) as c"), ...params))!;
  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.min(200, Math.max(1, Number(limit)));
  const offset = (pageNum - 1) * limitNum;

  const sortBy = String(req.query.sortBy || "timestamp");
  const sortDir = String(req.query.sortDir || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
  const sortCol =
    sortBy === "platform" ? "os"
    : sortBy === "os" ? "os"
    : sortBy === "browser" ? "browser"
    : sortBy === "deviceType" ? "device_type"
    : sortBy === "user" ? "username"
    : sortBy === "event" ? "event_type"
    : "timestamp";

  sql += ` ORDER BY ${sortCol} ${sortDir}, timestamp DESC LIMIT ? OFFSET ?`;
  params.push(limitNum, offset);

  const logs = await qAll<Record<string, unknown>>(sql, ...params);
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
      platform: formatPlatformLabel(l.os as string | null, l.browser as string | null),
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

router.get("/activity-logs/export", async (req, res) => {
  const visibility = activityLogVisibilityFor(req.user!);
  const whereSql = visibility.sql ? ` WHERE 1=1${visibility.sql}` : "";
  const logs = await qAll<Record<string, unknown>>(
    `SELECT * FROM activity_logs${whereSql} ORDER BY timestamp DESC LIMIT 10000`,
    ...visibility.params,
  );
  const header = "id,timestamp,username,user_role,event_type,event_category,description,platform,device_type,country,ip_address,result\n";
  const rows = logs.map(l => [
    l.id, l.timestamp, JSON.stringify(l.username), l.user_role, l.event_type, l.event_category,
    JSON.stringify(l.description),
    JSON.stringify(formatPlatformLabel(l.os as string | null, l.browser as string | null)),
    l.device_type,
    JSON.stringify(l.country), l.ip_address, l.result,
  ].join(",")).join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=activity-logs.csv");
  res.send(header + rows);
});

router.post("/activity-logs/bulk-delete", async (req, res) => {
  const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const ids = [...new Set(rawIds.map((n: unknown) => Number(n)).filter((n: number) => Number.isInteger(n) && n > 0))];
  if (!ids.length) {
    res.status(400).json({ error: "ids array is required" });
    return;
  }
  if (ids.length > 500) {
    res.status(400).json({ error: "Cannot delete more than 500 logs at once" });
    return;
  }

  const placeholders = ids.map(() => "?").join(",");
  const visibility = activityLogVisibilityFor(req.user!);
  const result = await qRun(
    `DELETE FROM activity_logs WHERE id IN (${placeholders})${visibility.sql}`,
    ...ids,
    ...visibility.params,
  );
  const method = ids.length === 1 ? "single" : "bulk";
  const ts = now();
  await qRun(`
    INSERT INTO admin_action_audits (timestamp, admin_user_id, admin_username, action, method, item_count, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
    ts,
    req.user!.id,
    req.user!.username,
    "activity_logs_delete",
    method,
    result.changes,
    JSON.stringify({ ids: ids.slice(0, 100), requested: ids.length }),
    ts,
  );
  logActivitySync({
    req,
    userId: req.user!.id,
    eventType: "activity_logs_delete",
    eventCategory: "administration",
    description: `Deleted ${result.changes} activity log(s) (${method})`,
    affectedObject: `activity_logs:${result.changes}`,
  });
  scheduleAdminStatsRefresh();
  res.json({ ok: true, deleted: result.changes, method });
});

router.delete("/activity-logs", async (req, res) => {
  const { before } = req.body;
  if (!before) { res.status(400).json({ error: "before date is required" }); return; }
  const visibility = activityLogVisibilityFor(req.user!);
  const result = await qRun(
    `DELETE FROM activity_logs WHERE timestamp < ?${visibility.sql}`,
    before,
    ...visibility.params,
  );
  const ts = now();
  await qRun(`
    INSERT INTO admin_action_audits (timestamp, admin_user_id, admin_username, action, method, item_count, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, ts, req.user!.id, req.user!.username, "activity_logs_archive", "archive", result.changes, JSON.stringify({ before }), ts);
  logActivitySync({ req, userId: req.user!.id, eventType: "logs_archive", eventCategory: "administration", description: `Archived ${result.changes} activity logs before ${before}` });
  res.json({ ok: true, deleted: result.changes });
});

// ?? Database Management ???????????????????????????????????????????????????????
const backupMetaPath = path.join(dataDirectory, "backups", "meta.json");
const backupDir = path.join(dataDirectory, "backups");

function readBackupMeta(): { lastBackupAt: string | null; lastBackupFile: string | null } {
  try {
    if (!fs.existsSync(backupMetaPath)) return { lastBackupAt: null, lastBackupFile: null };
    return JSON.parse(fs.readFileSync(backupMetaPath, "utf8"));
  } catch {
    return { lastBackupAt: null, lastBackupFile: null };
  }
}

function writeBackupMeta(meta: { lastBackupAt: string; lastBackupFile: string }) {
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(backupMetaPath, JSON.stringify(meta, null, 2));
}

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}

async function countRows(table: string, where = ""): Promise<number> {
  const row = await dbAsync.get<{ c: number }>(`SELECT COUNT(*) as c FROM ${table} ${where}`);
  return Number(row?.c ?? 0);
}

router.get("/database/info", requireSuperAdmin, async (_req, res) => {
  try {
    const meta = readBackupMeta();
    const [sizeBytes, version, totalUsers, totalMessages, totalChannels, totalResources, totalNotifications, totalLogs] = await Promise.all([
      dbAsync.getSizeBytes(),
      dbAsync.getVersion(),
      countRows("users", "WHERE is_npc = 0 AND is_deleted = 0"),
      countRows("messages"),
      countRows("conversations", "WHERE type = 'channel'"),
      countRows("resources"),
      countRows("notifications"),
      countRows("activity_logs"),
    ]);

    res.json({
      provider: dbAsync.provider,
      type: dbAsync.engineLabel,
      version,
      schemaVersion: currentSchemaVersion(),
      path: dbAsync.provider === "sqlite" ? path.basename(dbPath) : "",
      sizeBytes,
      sizeLabel: fmtBytes(sizeBytes),
      totalUsers,
      totalMessages,
      totalChannels,
      totalResources,
      totalNotifications,
      totalLogs,
      lastBackupAt: meta.lastBackupAt,
      lastBackupFile: meta.lastBackupFile,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to load database info" });
  }
});

router.post("/database/backup", requireSuperAdmin, async (req, res) => {
  const format = (req.query.format === "native" || req.body?.format === "native") ? "native" : "portable";
  try {
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");

    let filename: string;
    let dest: string;
    if (format === "native") {
      const ext = dbAsync.provider === "sqlite" ? "db" : "sql";
      filename = `ninja-era-backup-${stamp}.${ext}`;
      dest = path.join(backupDir, filename);
      await createNativeBackup(dbAsync, dest);
    } else {
      filename = `ninja-era-backup-${stamp}.json.gz`;
      dest = path.join(backupDir, filename);
      const buf = await exportPortableBackup(dbAsync);
      fs.writeFileSync(dest, buf);
    }

    writeBackupMeta({ lastBackupAt: new Date().toISOString(), lastBackupFile: filename });
    logActivitySync({
      req, userId: req.user!.id, eventType: "database_backup", eventCategory: "administration",
      description: `Created ${format} database backup ${filename}`, affectedObject: `backup:${filename}`,
    });
    res.download(dest, filename);
  } catch (e) {
    logActivitySync({
      req, userId: req.user!.id, eventType: "database_backup", eventCategory: "administration",
      description: `Database backup failed: ${e instanceof Error ? e.message : "unknown error"}`,
      result: "failure",
    });
    res.status(500).json({ error: e instanceof Error ? e.message : "Backup failed" });
  }
});

const restoreUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      cb(null, backupDir);
    },
    filename: (_req, _file, cb) => cb(null, `restore-upload-${Date.now()}.tmp`),
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
});

type RestoreFormat = "portable" | "native-sqlite";

function readFileHead(filePath: string, n: number): Buffer {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(n);
    const bytesRead = fs.readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

function detectRestoreFormat(filePath: string): RestoreFormat | null {
  const head = readFileHead(filePath, 32);
  if (head.length >= 15 && head.toString("latin1", 0, 15) === "SQLite format 3") return "native-sqlite";
  if (head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b) return "portable"; // gzip-compressed JSON
  if (head.toString("utf8").trimStart().startsWith("{")) {
    try {
      validatePortableBackup(fs.readFileSync(filePath));
      return "portable"; // uncompressed JSON
    } catch { /* fall through */ }
  }
  // Reject arbitrary SQL dumps ? never pipe untrusted files into psql.
  return null;
}

/** Legacy SQLite-only ATTACH-based restore (used only when both source and target are SQLite). */
async function restoreSqliteNativeFile(uploadedPath: string): Promise<void> {
  const probe = new Database(uploadedPath, { readonly: true, fileMustExist: true });
  try {
    const tables = (probe.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name);
    const required = ["users", "messages", "conversations"];
    const missing = required.filter((t) => !tables.includes(t));
    if (missing.length) throw new Error(`Invalid backup: missing tables ${missing.join(", ")}`);
  } finally {
    probe.close();
  }

  const escaped = uploadedPath.replace(/'/g, "''");
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.exec(`ATTACH DATABASE '${escaped}' AS bak`);
    try {
      db.exec("BEGIN IMMEDIATE");
      try {
        const bakTables = db.prepare("SELECT name FROM bak.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
        for (const { name } of bakTables) {
          const exists = db.prepare("SELECT 1 FROM main.sqlite_master WHERE type='table' AND name = ?").get(name);
          if (!exists) continue;
          db.exec(`DELETE FROM main."${name.replace(/"/g, '""')}"`);
          db.exec(`INSERT INTO main."${name.replace(/"/g, '""')}" SELECT * FROM bak."${name.replace(/"/g, '""')}"`);
        }
        db.exec("COMMIT");
      } catch (e) {
        try { db.exec("ROLLBACK"); } catch { /* */ }
        throw e;
      }
    } finally {
      try { db.exec("DETACH DATABASE bak"); } catch { /* */ }
    }
  } finally {
    try { db.exec("PRAGMA foreign_keys = ON"); } catch { /* */ }
  }
}

router.post("/database/restore", requireSuperAdmin, restoreUpload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) { res.status(400).json({ error: "Backup file is required" }); return; }
  const uploaded = file.path;

  try {
    const format = detectRestoreFormat(uploaded);
    if (!format) {
      throw new Error(
        "Unrecognized backup format. Upload a portable Ninja Era backup (.json / .json.gz) or a native SQLite database file. Arbitrary SQL dumps are not accepted.",
      );
    }

    if (format === "native-sqlite" && dbAsync.provider !== "sqlite") {
      throw new Error("This is a native SQLite backup, but the server is running PostgreSQL. Use a portable (.json.gz) backup instead.");
    }

    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    let safetyFile: string;
    try {
      const ext = dbAsync.provider === "sqlite" ? "db" : "sql";
      safetyFile = `pre-restore-${Date.now()}.${ext}`;
      await createNativeBackup(dbAsync, path.join(backupDir, safetyFile));
    } catch {
      // Native tooling unavailable (e.g. pg_dump missing) ? fall back to a portable safety snapshot.
      safetyFile = `pre-restore-${Date.now()}.json.gz`;
      const buf = await exportPortableBackup(dbAsync);
      fs.writeFileSync(path.join(backupDir, safetyFile), buf);
    }

    if (format === "portable") {
      const backup = validatePortableBackup(fs.readFileSync(uploaded));
      await restorePortableBackup(dbAsync, backup, { clearExisting: true });
    } else if (format === "native-sqlite") {
      await restoreSqliteNativeFile(uploaded);
    } else {
      throw new Error("Unsupported restore format");
    }

    try { fs.unlinkSync(uploaded); } catch { /* */ }
    logActivitySync({
      req, userId: req.user!.id, eventType: "database_restore", eventCategory: "administration",
      description: `Restored database from uploaded ${format} backup (safety copy: ${safetyFile})`,
      affectedObject: `backup:${safetyFile}`,
    });
    scheduleAdminStatsRefresh();
    res.json({ ok: true, safetyBackup: safetyFile });
  } catch (e) {
    try { fs.unlinkSync(uploaded); } catch { /* */ }
    logActivitySync({
      req, userId: req.user!.id, eventType: "database_restore", eventCategory: "administration",
      description: `Database restore failed: ${e instanceof Error ? e.message : "unknown error"}`,
      result: "failure",
    });
    res.status(500).json({ error: e instanceof Error ? e.message : "Restore failed. Existing database was preserved." });
  }
});

// ?? Database Console (table explorer + CRUD) ??????????????????????????????????
router.get("/database/tables", requireSuperAdmin, async (_req, res) => {
  try {
    res.json({ tables: await listManageableTables() });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to list tables" });
  }
});

router.get("/database/tables/:table/schema", requireSuperAdmin, async (req, res) => {
  try {
    const table = String(req.params.table);
    const columns = await getTableColumns(table);
    res.json({
      table,
      columns,
      columnCount: columns.length,
      primaryKey: columns.filter((c) => c.pk).map((c) => c.name),
    });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Invalid table" });
  }
});

router.get("/database/tables/:table/rows", requireSuperAdmin, async (req, res) => {
  try {
    const table = String(req.params.table);
    let columnFilters: Record<string, string> | undefined;
    if (typeof req.query.filters === "string" && req.query.filters) {
      try {
        columnFilters = JSON.parse(req.query.filters) as Record<string, string>;
      } catch {
        res.status(400).json({ error: "Invalid filters JSON" });
        return;
      }
    }
    const result = await listTableRows({
      table,
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 50,
      sortBy: typeof req.query.sortBy === "string" ? req.query.sortBy : undefined,
      sortDir: req.query.sortDir === "asc" ? "asc" : "desc",
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      columnFilters,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Query failed" });
  }
});

router.post("/database/tables/:table/rows", requireSuperAdmin, async (req, res) => {
  try {
    const table = String(req.params.table);
    const data = (req.body?.data ?? req.body) as Record<string, unknown>;
    const result = await insertTableRow(table, data || {});
    logActivitySync({
      req,
      userId: req.user!.id,
      eventType: "database_row_create",
      eventCategory: "administration",
      description: `Created row in ${table} (id ${result.id})`,
      affectedObject: `db:${table}:${result.id}`,
    });
    scheduleAdminStatsRefresh();
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Insert failed" });
  }
});

router.patch("/database/tables/:table/rows", requireSuperAdmin, async (req, res) => {
  try {
    const table = String(req.params.table);
    const pk = (req.body?.pk ?? {}) as Record<string, unknown>;
    const data = (req.body?.data ?? {}) as Record<string, unknown>;
    const result = await updateTableRow(table, pk, data);
    const pkLabel = Object.entries(pk).map(([k, v]) => `${k}=${v}`).join(",");
    logActivitySync({
      req,
      userId: req.user!.id,
      eventType: "database_row_update",
      eventCategory: "administration",
      description: `Updated row in ${table} (${pkLabel})`,
      affectedObject: `db:${table}:${pkLabel}`,
    });
    scheduleAdminStatsRefresh();
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Update failed" });
  }
});

router.delete("/database/tables/:table/rows", requireSuperAdmin, async (req, res) => {
  try {
    const table = String(req.params.table);
    const keys = (req.body?.keys ?? []) as Record<string, unknown>[];
    const result = await deleteTableRows(table, keys);
    logActivitySync({
      req,
      userId: req.user!.id,
      eventType: "database_row_delete",
      eventCategory: "administration",
      description: `Deleted ${result.changes} row(s) from ${table}`,
      affectedObject: `db:${table}`,
    });
    scheduleAdminStatsRefresh();
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Delete failed" });
  }
});

// ?? Messaging History (moderation) ????????????????????????????????????????????

async function adminFormatMessages(rows: Record<string, unknown>[], viewerId: number) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id as number);
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
    rows.map((r) => r.reply_to_id as number | null | undefined).filter((id): id is number => id != null),
  )];
  const parentsById = new Map<number, { id: number; username: string; content: string }>();
  if (replyIds.length) {
    const rp = replyIds.map(() => "?").join(",");
    const parents = await qAll<{ id: number; username: string | null; is_deleted: number | null; content: string }>(`
      SELECT m.id, u.username, u.is_deleted, m.content FROM messages m
      LEFT JOIN users u ON u.id = m.user_id WHERE m.id IN (${rp})
    `, ...replyIds);
    for (const p of parents) {
      const sender = tombstoneSenderFields(p);
      parentsById.set(p.id, { id: p.id, username: sender.username, content: p.content || "" });
    }
  }

  return rows.map((msg) => {
    const reactionMap = reactionsByMsg.get(msg.id as number);
    let replyTo: { id: number; user: string; preview: string } | undefined;
    const replyId = msg.reply_to_id as number | null | undefined;
    if (replyId != null) {
      const parent = parentsById.get(replyId);
      if (parent) replyTo = { id: parent.id, user: parent.username, preview: (parent.content || "").slice(0, 80) };
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
      createdAt: msg.created_at as string,
      self: msg.user_id === viewerId,
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

router.get("/conversations", requireSuperAdmin, async (req, res) => {
  const adminId = req.user!.id;
  const search = String(req.query.search || "").trim().toLowerCase();
  const userA = String(req.query.userA || "").trim().toLowerCase();
  const userB = String(req.query.userB || "").trim().toLowerCase();
  const dateFrom = String(req.query.dateFrom || "").trim();
  const dateTo = String(req.query.dateTo || "").trim();
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 80));

  // DMs only ? exclude conversations the viewing administrator participates in.
  let sql = `
    SELECT c.id, c.type, c.name, c.bio, c.last_message_at, c.last_message_preview, c.visibility, c.created_at,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as message_count
    FROM conversations c
    WHERE c.type = 'dm'
      AND NOT EXISTS (
        SELECT 1 FROM conversation_participants cp
        WHERE cp.conversation_id = c.id AND cp.user_id = ?
      )
  `;
  const params: unknown[] = [adminId];
  if (dateFrom) { sql += " AND COALESCE(c.last_message_at, c.created_at) >= ?"; params.push(dateFrom); }
  if (dateTo) { sql += " AND COALESCE(c.last_message_at, c.created_at) <= ?"; params.push(dateTo); }
  sql += " ORDER BY COALESCE(c.last_message_at, c.created_at) DESC LIMIT ?";
  params.push(Math.min(500, limit * 3));

  const rows = await qAll<{
    id: number; type: string; name: string; bio: string | null;
    last_message_at: string | null; last_message_preview: string | null; visibility: string | null;
    created_at: string; message_count: number;
  }>(sql, ...params);

  const conversations = (await Promise.all(rows.map(async (c) => {
    const participants = await qAll<{
      id: number | null; username: string | null; avatar_url: string | null;
      is_team_member: number; is_admin: number; is_deleted: number | null;
    }>(`
      SELECT u.id, u.username, u.avatar_url, u.is_team_member, u.is_admin, u.is_deleted
      FROM conversation_participants cp
      LEFT JOIN users u ON u.id = cp.user_id
      WHERE cp.conversation_id = ?
      ORDER BY u.id ASC
    `, c.id);
    const displayParts = participants.map((p) => {
      const d = tombstoneSenderFields({
        username: p.username,
        avatar_url: p.avatar_url,
        is_deleted: p.is_deleted,
      });
      return {
        id: p.id || 0,
        username: d.username,
        avatarUrl: d.avatar_url,
        isTeamMember: !d.isDeleted && p.is_team_member === 1,
        isAdmin: !d.isDeleted && p.is_admin === 1,
        isDeleted: d.isDeleted,
      };
    });
    const name = displayParts.length >= 2
      ? `${displayParts[0]!.username} ? ${displayParts[1]!.username}`
      : (displayParts[0]?.username || c.name || DELETED_USER_DISPLAY_NAME);
    return {
      id: c.id,
      type: "dm" as const,
      name,
      bio: c.bio || "",
      avatarUrl: displayParts.find((p) => !p.isDeleted)?.avatarUrl
        ?? displayParts[0]?.avatarUrl
        ?? null,
      otherUserId: displayParts[0]?.id ?? null,
      participants: displayParts,
      preview: c.last_message_preview || "No messages yet",
      time: c.last_message_at ? timeAgo(c.last_message_at) : "?",
      lastMessageAt: c.last_message_at,
      messageCount: c.message_count,
      visibility: c.visibility,
    };
  }))).filter((c) => {
    if (search) {
      const hay = `${c.name} ${c.preview} ${c.id}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    const names = (c.participants || []).map((p) => p.username.toLowerCase());
    if (userA && !names.some((n) => n.includes(userA))) return false;
    if (userB && !names.some((n) => n.includes(userB))) return false;
    return true;
  }).slice(0, limit);

  res.json({ conversations });
});

router.get("/conversations/:id/messages", requireSuperAdmin, async (req, res) => {
  const adminId = req.user!.id;
  const convId = Number(req.params.id);
  const conv = await qGet<{ id: number; type: string; name: string }>(
    "SELECT id, type, name FROM conversations WHERE id = ?", convId,
  );
  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }
  if (conv.type !== "dm") {
    res.status(403).json({ error: "Only DM conversations are available in Messaging History" });
    return;
  }
  const adminInConv = await qGet(
    "SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?", convId, adminId,
  );
  if (adminInConv) {
    res.status(403).json({ error: "Your own conversations are not shown in Messaging History" });
    return;
  }

  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const before = req.query.before ? Number(req.query.before) : null;
  const q = String(req.query.q || "").trim();
  const mediaType = String(req.query.mediaType || "").trim();
  const senderId = req.query.senderId ? Number(req.query.senderId) : null;
  const editedOnly = req.query.edited === "1";
  const systemOnly = req.query.system === "1";
  const callsOnly = req.query.calls === "1";
  const dateFrom = String(req.query.dateFrom || "").trim();
  const dateTo = String(req.query.dateTo || "").trim();

  let where = "m.conversation_id = ?";
  const params: unknown[] = [convId];
  if (before != null && Number.isFinite(before)) {
    const anchor = await qGet<{ created_at: string; id: number }>("SELECT created_at, id FROM messages WHERE id = ?", before);
    if (anchor) {
      where += " AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))";
      params.push(anchor.created_at, anchor.created_at, anchor.id);
    }
  }
  if (q) {
    where += " AND (LOWER(m.content) LIKE LOWER(?) OR LOWER(m.file_name) LIKE LOWER(?) OR LOWER(u.username) LIKE LOWER(?))";
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  if (mediaType === "none") where += " AND (m.media_type IS NULL OR m.media_type = '')";
  else if (mediaType && mediaType !== "all") { where += " AND m.media_type = ?"; params.push(mediaType); }
  if (senderId != null && Number.isFinite(senderId)) { where += " AND m.user_id = ?"; params.push(senderId); }
  if (editedOnly) where += " AND m.edited_at IS NOT NULL";
  if (systemOnly || callsOnly) where += " AND m.media_type = 'call_event'";
  if (dateFrom) { where += " AND m.created_at >= ?"; params.push(dateFrom); }
  if (dateTo) { where += " AND m.created_at <= ?"; params.push(dateTo); }

  const rows = await qAll<Record<string, unknown>>(`
    SELECT m.*, u.username, u.avatar_url, u.is_deleted
    FROM messages m LEFT JOIN users u ON u.id = m.user_id
    WHERE ${where}
    ORDER BY m.created_at DESC, m.id DESC LIMIT ?
  `, ...params, limit + 1);
  const hasMore = rows.length > limit;
  const page = (hasMore ? rows.slice(0, limit) : rows).reverse();
  res.json({
    conversation: { id: conv.id, type: conv.type, name: conv.name },
    messages: await adminFormatMessages(page, req.user!.id),
    hasMore,
  });
});

router.delete("/messages/:id", requireSuperAdmin, async (req, res) => {
  const msgId = Number(req.params.id);
  const existing = await qGet<{
    id: number; conversation_id: number; user_id: number; conversation_type: string;
  }>(`
    SELECT m.id, m.conversation_id, m.user_id, c.type as conversation_type
    FROM messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id = ?
  `, msgId);

  if (!existing) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  const deleted = await hardDeleteMessage(msgId);
  if (!deleted) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  logActivitySync({
    req,
    userId: req.user!.id,
    eventType: "message_delete",
    eventCategory: "administration",
    description: `Moderated message #${msgId} in ${existing.conversation_type} #${existing.conversation_id}`,
    affectedObject: `message:${msgId}`,
    metadata: {
      conversationId: existing.conversation_id,
      messageId: msgId,
      authorId: existing.user_id,
      conversationType: existing.conversation_type,
      reason: "messaging_history",
    },
  });

  res.json({ ok: true });
});

// Admin check endpoint
router.get("/check", async (req, res) => {
  res.json({
    isAdmin: true,
    isSuperAdmin: isSuperAdmin(req.user!),
    user: await publicUser(req.user!, req.user!.id),
  });
});

export default router;
