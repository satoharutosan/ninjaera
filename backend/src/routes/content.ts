import { Router } from "express";
import path from "path";
import fs from "fs";
import { qGet, qAll } from "../db/query.js";
import { optionalAuth } from "../middleware/auth.js";
import { isAdmin, isTeamMember } from "../middleware/admin.js";
import { logActivitySync } from "../services/activityLog.js";
import { getStorage } from "../storage/index.js";

const router = Router();

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
  const members = await qAll(`
    SELECT tm.name, tm.role, tm.department, tm.country, tm.city,
           tm.status_label as statusLabel, tm.status_color as statusColor,
           tm.user_id as userId, u.username, u.avatar_url as avatarUrl
    FROM team_members tm
    INNER JOIN users u ON u.id = tm.user_id AND u.is_team_member = 1 AND u.is_deleted = 0
    ORDER BY tm.sort_order
  `);
  res.json({ team: members });
});

router.get("/resources", optionalAuth, async (req, res) => {
  const category = req.query.category as string | undefined;
  let rows;
  if (category) {
    rows = await qAll(`
      SELECT id, title, category, description, published_at as publishedAt,
             file_size as fileSize, version, enabled, visibility
      FROM resources WHERE category = ? AND enabled = 1 ORDER BY sort_order, published_at DESC
    `, category);
  } else {
    rows = await qAll(`
      SELECT id, title, category, description, published_at as publishedAt,
             file_size as fileSize, version, enabled, visibility
      FROM resources WHERE enabled = 1 ORDER BY sort_order, published_at DESC
    `);
  }
  // Never expose contentUrl on the public list — downloads must go through the gated endpoint.
  res.json({
    resources: (rows as Record<string, unknown>[]).map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      description: r.description,
      publishedAt: r.publishedAt,
      fileSize: r.fileSize,
      version: r.version,
      enabled: r.enabled,
      visibility: normalizeResourceVisibility(r.visibility),
      contentUrl: null,
    })),
  });
});

router.get("/resources/:id/download", optionalAuth, async (req, res) => {
  const id = Number(req.params.id);
  const resource = await qGet<{
    content_url: string | null;
    title: string;
    visibility?: string | null;
  }>("SELECT * FROM resources WHERE id = ? AND enabled = 1", id);

  if (!resource || !resource.content_url) {
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

  const visibility = normalizeResourceVisibility(resource.visibility);
  if (!canDownloadResource(visibility, req.user)) {
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

  const storage = getStorage();

  if (storage.provider === "local") {
    const key = resource.content_url.replace(/^\/uploads\//, "").replace(/^[/\\]+/, "").replace(/\.\./g, "");
    const filePath = path.resolve(storage.localRoot!, key);
    const relative = path.relative(storage.localRoot!, filePath);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(filePath)) {
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

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.download(filePath, path.basename(filePath));
    return;
  }

  // Cloud storage: always prefer short-lived signed URLs for gated downloads.
  // Never fall back to a permanent public CDN URL for PRIVATE resources.
  if (!storage.getSignedDownloadUrl) {
    res.status(503).json({ error: "Signed downloads are not configured for this storage provider" });
    return;
  }

  let downloadUrl: string;
  try {
    downloadUrl = await storage.getSignedDownloadUrl(resource.content_url, 120);
  } catch {
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

  res.redirect(downloadUrl);
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

router.post("/legal/terms-viewed", optionalAuth, (req, res) => {
  const user = req.user;
  logActivitySync({
    req,
    userId: user?.id ?? null,
    username: user?.username ?? "Guest",
    eventType: "view_terms_of_service",
    eventCategory: "legal",
    description: user
      ? `${user.username} viewed the Terms of Service`
      : "Guest viewed the Terms of Service",
    affectedObject: "legal:terms",
    result: "success",
  });
  res.json({ ok: true });
});

export default router;
