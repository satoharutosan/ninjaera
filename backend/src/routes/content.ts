import { Router } from "express";
import path from "path";
import fs from "fs";
import { qGet, qAll } from "../db/query.js";
import { optionalAuth } from "../middleware/auth.js";
import { isAdmin, isTeamMember } from "../middleware/admin.js";
import { logActivitySync } from "../services/activityLog.js";
import { getStorage } from "../storage/index.js";
import { validateExternalDownloadUrl } from "../services/externalDownloadUrl.js";
import {
  contentDispositionAttachment,
  resolveResourceDownloadFilename,
} from "../services/downloadFilename.js";

const router = Router();

function downloadLog(stage: string, detail?: string) {
  if (process.env.NODE_ENV === "production" && process.env.RESOURCE_DOWNLOAD_DEBUG !== "1") return;
  console.log(`[RESOURCE DOWNLOAD] ${stage}${detail ? `: ${detail}` : ""}`);
}

export type ResourceVisibility = "PUBLIC" | "PRIVATE";

export function normalizeResourceVisibility(raw: unknown): ResourceVisibility {
  const v = String(raw ?? "PUBLIC").trim().toUpperCase();
  return v === "PRIVATE" ? "PRIVATE" : "PUBLIC";
}

/** Private resources: team members and administrators only. */
export function canDownloadResource(
  visibility: ResourceVisibility,
  user: Express.Request["user"] | undefined,
): boolean {
  if (visibility === "PUBLIC") return true;
  if (!user) return false;
  return isTeamMember(user) || isAdmin(user);
}

router.get("/team", async (_req, res) => {
  // Snake_case column names only — Postgres lowercases unquoted camelCase aliases,
  // which previously dropped avatarUrl/userId on Railway and broke Meet the Team avatars.
  const rows = await qAll<{
    name: string;
    role: string;
    department: string;
    country: string;
    city: string;
    status_label: string | null;
    status_color: string | null;
    user_id: number | null;
    username: string | null;
    avatar_url: string | null;
  }>(`
    SELECT tm.name, tm.role, tm.department, tm.country, tm.city,
           tm.status_label, tm.status_color,
           tm.user_id, u.username, u.avatar_url
    FROM team_members tm
    INNER JOIN users u ON u.id = tm.user_id AND u.is_team_member = 1 AND u.is_deleted = 0
    ORDER BY tm.sort_order
  `);

  res.json({
    team: rows.map((m) => {
      const rawAvatar = m.avatar_url?.trim() || null;
      // Never prefix absolute CDN URLs with a local /uploads/ base.
      const avatarUrl = rawAvatar && (/^https?:\/\//i.test(rawAvatar) || rawAvatar.startsWith("/"))
        ? rawAvatar
        : rawAvatar
          ? `/uploads/${rawAvatar.replace(/^\/+/, "")}`
          : null;
      return {
        // Prefer live users.username — team_members.name can lag after profile renames.
        name: m.username || m.name,
        role: m.role,
        department: m.department,
        country: m.country,
        city: m.city,
        statusLabel: m.status_label || undefined,
        statusColor: m.status_color || undefined,
        userId: m.user_id ?? undefined,
        username: m.username || undefined,
        avatarUrl,
      };
    }),
  });
});

router.get("/resources", optionalAuth, async (req, res) => {
  const category = req.query.category as string | undefined;
  let rows;
  if (category) {
    rows = await qAll(`
      SELECT id, title, category, description, published_at,
             file_size, version, enabled, visibility
      FROM resources WHERE category = ? AND enabled = 1 ORDER BY sort_order, published_at DESC
    `, category);
  } else {
    rows = await qAll(`
      SELECT id, title, category, description, published_at,
             file_size, version, enabled, visibility
      FROM resources WHERE enabled = 1 ORDER BY sort_order, published_at DESC
    `);
  }
  // Never expose contentUrl or public download IDs on the public list —
  // downloads go through the gated endpoint; public links are admin-managed only.
  res.json({
    resources: (rows as Record<string, unknown>[]).map((r) => {
      const visibility = normalizeResourceVisibility(r.visibility);
      return {
        id: r.id,
        title: r.title,
        category: r.category,
        description: r.description,
        publishedAt: r.published_at,
        fileSize: r.file_size,
        version: r.version,
        enabled: r.enabled,
        visibility,
        contentUrl: null,
      };
    }),
  });
});

router.get("/resources/:id/download", optionalAuth, async (req, res) => {
  const id = Number(req.params.id);
  downloadLog("Request received", `id=${req.params.id}`);

  if (!Number.isFinite(id) || id <= 0) {
    downloadLog("Validation failed", "Invalid resource id");
    res.status(400).json({ error: "Invalid resource id" });
    return;
  }

  let resource: {
    id: number;
    content_url: string | null;
    external_url: string | null;
    title: string;
    category: string;
    version: string | null;
    visibility?: string | null;
    original_filename?: string | null;
  } | undefined;

  try {
    resource = await qGet<{
      id: number;
      content_url: string | null;
      external_url: string | null;
      title: string;
      category: string;
      version: string | null;
      visibility?: string | null;
      original_filename?: string | null;
    }>("SELECT * FROM resources WHERE id = ? AND enabled = 1", id);
  } catch (err) {
    downloadLog("Database lookup failed", err instanceof Error ? err.message : String(err));
    console.error("[RESOURCE DOWNLOAD] database error:", err);
    res.status(500).json({ error: "Unable to load resource" });
    return;
  }

  const hasExternal = !!(resource?.external_url && String(resource.external_url).trim());
  const hasStored = !!(resource?.content_url && String(resource.content_url).trim());

  if (!resource || (!hasExternal && !hasStored)) {
    downloadLog("Database lookup failed", `Resource not found id=${id}`);
    logActivitySync({
      req,
      userId: req.user?.id ?? null,
      username: req.user?.username ?? "Guest",
      eventType: "resource_download",
      eventCategory: "downloads",
      description: `Failed resource download #${id}: not found`,
      affectedObject: `resource:${id}`,
      result: "failure",
    });
    res.status(404).json({ error: "Resource not found" });
    return;
  }

  downloadLog("Resource found", `${resource.title} (${resource.category})`);

  const visibility = normalizeResourceVisibility(resource.visibility);
  if (!canDownloadResource(visibility, req.user)) {
    downloadLog("Permission denied", visibility);
    logActivitySync({
      req,
      userId: req.user?.id ?? null,
      username: req.user?.username ?? "Guest",
      eventType: "resource_download",
      eventCategory: "downloads",
      description: `Denied resource download: ${resource.title} (${visibility})`,
      affectedObject: `resource:${id}`,
      result: "failure",
    });
    res.status(403).json({
      error: visibility === "PRIVATE"
        ? "This resource is available only to Team Members and Administrators."
        : "You do not have permission to download this resource.",
    });
    return;
  }

  downloadLog("Permission granted", visibility);

  // External URL (Games-style App resources / GitHub): auth + log, then hand URL to the client.
  // Client navigates directly so the browser download history shows GitHub — never proxy the file.
  if (hasExternal) {
    const checked = validateExternalDownloadUrl(resource.external_url);
    if (!checked.ok) {
      downloadLog("External URL invalid", checked.error);
      res.status(500).json({ error: "This resource has an invalid download URL. Please contact an administrator." });
      return;
    }
    logActivitySync({
      req,
      userId: req.user?.id ?? null,
      username: req.user?.username ?? "Guest",
      eventType: "resource_download",
      eventCategory: "downloads",
      description: `Downloaded resource: ${resource.title}${resource.version ? ` v${resource.version}` : ""} (${resource.category})`,
      affectedObject: `resource:${id}`,
      result: "success",
      metadata: { source: "external", category: resource.category, version: resource.version },
    });
    downloadLog("External download started", checked.url);
    res.json({ externalUrl: checked.url });
    return;
  }

  const storage = getStorage();
  downloadLog("Storage provider resolved", storage.provider);

  const downloadName = resolveResourceDownloadFilename({
    id,
    title: resource.title,
    original_filename: resource.original_filename,
    content_url: resource.content_url,
  });

  if (storage.provider === "local") {
    const key = resource.content_url!.replace(/^\/uploads\//, "").replace(/^[/\\]+/, "").replace(/\.\./g, "");
    const filePath = path.resolve(storage.localRoot!, key);
    const relative = path.relative(storage.localRoot!, filePath);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(filePath)) {
      downloadLog("Storage provider returned 404", filePath);
      logActivitySync({
        req,
        userId: req.user?.id ?? null,
        username: req.user?.username ?? "Guest",
        eventType: "resource_download",
        eventCategory: "downloads",
        description: `Failed resource download: ${resource.title} (file missing)`,
        affectedObject: `resource:${id}`,
        result: "failure",
      });
      res.status(404).json({ error: "File not found" });
      return;
    }

    logActivitySync({
      req,
      userId: req.user?.id ?? null,
      username: req.user?.username ?? "Guest",
      eventType: "resource_download",
      eventCategory: "downloads",
      description: `Downloaded resource: ${resource.title}`,
      affectedObject: `resource:${id}`,
      result: "success",
    });

    downloadLog("Download started", `local file as ${downloadName}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", contentDispositionAttachment(downloadName));
    // sendFile avoids Express download()'s disposition quirks with odd original names.
    res.sendFile(filePath, (err) => {
      if (err && !res.headersSent) {
        downloadLog("Local sendFile failed", err.message);
        res.status(500).json({ error: "Unable to send file" });
      }
    });
    return;
  }

  // Cloud storage: always prefer short-lived signed URLs for gated downloads.
  // Never fall back to a permanent public CDN URL for PRIVATE resources.
  if (!storage.getSignedDownloadUrl) {
    downloadLog("Signed downloads not configured", storage.provider);
    res.status(503).json({ error: "Signed downloads are not configured for this storage provider" });
    return;
  }

  let downloadUrl: string;
  try {
    downloadUrl = await storage.getSignedDownloadUrl(resource.content_url!, 120);
  } catch (err) {
    downloadLog("Storage provider returned 404", err instanceof Error ? err.message : String(err));
    res.status(404).json({ error: "File not found" });
    return;
  }

  logActivitySync({
    req,
    userId: req.user?.id ?? null,
    username: req.user?.username ?? "Guest",
    eventType: "resource_download",
    eventCategory: "downloads",
    description: `Downloaded resource: ${resource.title}`,
    affectedObject: `resource:${id}`,
    result: "success",
  });

  downloadLog("Download started", `signed URL as ${downloadName}`);
  // Return signed URL + display name so the client can set the download filename
  // without baking Content-Disposition into the signed URL (S3/R2 400 risk).
  res.json({ downloadUrl, filename: downloadName });
});

router.get("/characters", async (_req, res) => {
  const chars = await qAll<{
    id: number; name: string; village: string; role: string; rarity: string;
    clan: string; color: string; img: string | null; bio: string;
    stats_atk: number; stats_def: number; stats_spd: number; stats_mgk: number;
    abilities: string;
  }>(`
    SELECT id, name, village, role, rarity, clan, color, image_url as img, bio,
           stats_atk, stats_def, stats_spd, stats_mgk, abilities
    FROM characters ORDER BY sort_order
  `);

  res.json({
    characters: chars.map(c => ({
      id: c.id,
      name: c.name,
      village: c.village,
      role: c.role,
      rarity: c.rarity,
      clan: c.clan,
      color: c.color,
      img: c.img,
      bio: c.bio,
      stats: { atk: c.stats_atk, def: c.stats_def, spd: c.stats_spd, mgk: c.stats_mgk },
      abilities: JSON.parse(c.abilities || "[]"),
    })),
  });
});

router.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "ninja-era-api" });
});

router.get("/content/about-our-story", async (_req, res) => {
  const {
    getPublishedSiteContent, toPublicContent, OUR_STORY_SLUG,
  } = await import("../services/siteContent.js");
  const published = await getPublishedSiteContent(OUR_STORY_SLUG);
  if (!published) {
    res.json({
      content: {
        slug: OUR_STORY_SLUG,
        title: "Our Story",
        subtitle: "Building the next generation anime RPG.",
        body: "Plantend began as a passionate indie group pursuing a shinobi MMORPG.\n\nFrom closed tests to a living community platform, every chapter has been shaped with players and creators.",
        quote: "Every legend begins with a single step.",
        imageUrl: null,
        updatedAt: new Date().toISOString(),
        publishedAt: null,
      },
    });
    return;
  }
  res.json({ content: toPublicContent(published) });
});

export default router;
