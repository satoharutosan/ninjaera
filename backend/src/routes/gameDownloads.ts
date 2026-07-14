import { Router } from "express";
import path from "path";
import fs from "fs";
import { db } from "../db/index.js";
import { optionalAuth } from "../middleware/auth.js";
import { logActivitySync } from "../services/activityLog.js";

const router = Router();

const PLATFORMS = ["windows", "android", "ios"] as const;

router.get("/game-downloads", (_req, res) => {
  const downloads = PLATFORMS.map(platform => {
    const row = db.prepare(`
      SELECT id, platform, version, release_notes as releaseNotes, file_size as fileSize, published_at as publishedAt
      FROM game_downloads
      WHERE platform = ? AND published = 1
      ORDER BY published_at DESC, id DESC
      LIMIT 1
    `).get(platform) as {
      id: number; platform: string; version: string; releaseNotes: string;
      fileSize: number | null; publishedAt: string;
    } | undefined;

    return {
      platform,
      available: !!row?.id,
      id: row?.id ?? null,
      version: row?.version ?? null,
      releaseNotes: row?.releaseNotes ?? null,
      fileSize: row?.fileSize ?? null,
      publishedAt: row?.publishedAt ?? null,
    };
  });
  res.json({ downloads });
});

router.get("/game-downloads/:platform/download", optionalAuth, (req, res) => {
  const platform = String(req.params.platform).toLowerCase();
  if (!PLATFORMS.includes(platform as typeof PLATFORMS[number])) {
    res.status(400).json({ error: "Invalid platform" });
    return;
  }

  const build = db.prepare(`
    SELECT * FROM game_downloads WHERE platform = ? AND published = 1
    ORDER BY published_at DESC, id DESC LIMIT 1
  `).get(platform) as { id: number; file_url: string | null; version: string; platform: string } | undefined;

  if (!build?.file_url) {
    res.status(404).json({ error: "No published build available for this platform" });
    return;
  }

  const uploadDir = process.env.UPLOAD_DIR || "./uploads";
  const filePath = path.join(uploadDir, path.basename(build.file_url));
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  logActivitySync({
    req,
    userId: req.user?.id ?? null,
    username: req.user?.username ?? "Guest",
    eventType: "game_download",
    eventCategory: "downloads",
    description: `Downloaded ${platform} build v${build.version}`,
    affectedObject: `game_download:${build.id}`,
    result: "success",
  });

  res.download(filePath, path.basename(filePath));
});

export default router;
