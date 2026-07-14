import { Router } from "express";
import path from "path";
import fs from "fs";
import { db } from "../db/index.js";
import { optionalAuth } from "../middleware/auth.js";
import { isTeamMember } from "../middleware/admin.js";
import { logActivitySync } from "../services/activityLog.js";

const router = Router();

router.get("/team", (_req, res) => {
  const members = db.prepare(`
    SELECT tm.name, tm.role, tm.department, tm.country, tm.city,
           tm.status_label as statusLabel, tm.status_color as statusColor,
           tm.user_id as userId, u.username, u.avatar_url as avatarUrl
    FROM team_members tm
    INNER JOIN users u ON u.id = tm.user_id AND u.is_team_member = 1 AND u.is_deleted = 0
    ORDER BY tm.sort_order
  `).all();
  res.json({ team: members });
});

router.get("/resources", optionalAuth, (req, res) => {
  const category = req.query.category as string | undefined;
  let rows;
  if (category) {
    rows = db.prepare(`
      SELECT id, title, category, description, content_url as contentUrl, published_at as publishedAt,
             file_size as fileSize, version, enabled
      FROM resources WHERE category = ? AND enabled = 1 ORDER BY sort_order, published_at DESC
    `).all(category);
  } else {
    rows = db.prepare(`
      SELECT id, title, category, description, content_url as contentUrl, published_at as publishedAt,
             file_size as fileSize, version, enabled
      FROM resources WHERE enabled = 1 ORDER BY sort_order, published_at DESC
    `).all();
  }
  res.json({ resources: rows });
});

router.get("/resources/:id/download", optionalAuth, (req, res) => {
  const id = Number(req.params.id);
  const resource = db.prepare("SELECT * FROM resources WHERE id = ? AND enabled = 1").get(id) as {
    content_url: string | null; title: string;
  } | undefined;

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

  if (!req.user || !isTeamMember(req.user)) {
    logActivitySync({
      req,
      userId: req.user?.id ?? null,
      username: req.user?.username ?? "Guest",
      eventType: "resource_download",
      eventCategory: "downloads",
      description: `Denied resource download: ${resource.title}`,
      affectedObject: `resource:${id}`,
      result: "failure",
    });
    res.status(403).json({ error: "Only approved Team Members may download this resource." });
    return;
  }

  const uploadDir = process.env.UPLOAD_DIR || "./uploads";
  const filePath = path.join(uploadDir, path.basename(resource.content_url));
  if (!fs.existsSync(filePath)) {
    logActivitySync({
      req,
      userId: req.user.id,
      username: req.user.username,
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
    userId: req.user.id,
    username: req.user.username,
    eventType: "resource_download",
    eventCategory: "downloads",
    description: `Downloaded resource: ${resource.title}`,
    affectedObject: `resource:${id}`,
    result: "success",
  });

  res.download(filePath, path.basename(resource.content_url));
});

router.get("/characters", (_req, res) => {
  const chars = db.prepare(`
    SELECT id, name, village, role, rarity, clan, color, image_url as img, bio,
           stats_atk, stats_def, stats_spd, stats_mgk, abilities
    FROM characters ORDER BY sort_order
  `).all() as {
    id: number; name: string; village: string; role: string; rarity: string;
    clan: string; color: string; img: string | null; bio: string;
    stats_atk: number; stats_def: number; stats_spd: number; stats_mgk: number;
    abilities: string;
  }[];

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
