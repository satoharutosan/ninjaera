import { Router } from "express";
import path from "path";
import fs from "fs";
import { qGet } from "../db/query.js";
import { optionalAuth } from "../middleware/auth.js";
import { logActivitySync } from "../services/activityLog.js";
import { getStorage } from "../storage/index.js";

const router = Router();

const PLATFORMS = ["windows", "android", "ios"] as const;

router.get("/game-downloads", async (_req, res) => {
  const downloads = await Promise.all(PLATFORMS.map(async platform => {
    const row = await qGet<{
      id: number; platform: string; version: string; releaseNotes: string;
      fileSize: number | null; publishedAt: string;
    }>(`
      SELECT id, platform, version, release_notes as releaseNotes, file_size as fileSize, published_at as publishedAt
      FROM game_downloads
      WHERE platform = ? AND published = 1
      ORDER BY published_at DESC, id DESC
      LIMIT 1
    `, platform);

    return {
      platform,
      available: !!row?.id,
      id: row?.id ?? null,
      version: row?.version ?? null,
      releaseNotes: row?.releaseNotes ?? null,
      fileSize: row?.fileSize ?? null,
      publishedAt: row?.publishedAt ?? null,
    };
  }));
  res.json({ downloads });
});

router.get("/game-downloads/:platform/download", optionalAuth, async (req, res) => {
  const platform = String(req.params.platform).toLowerCase();
  if (!PLATFORMS.includes(platform as typeof PLATFORMS[number])) {
    res.status(400).json({ error: "Invalid platform" });
    return;
  }

  const build = await qGet<{ id: number; file_url: string | null; version: string; platform: string }>(`
    SELECT * FROM game_downloads WHERE platform = ? AND published = 1
    ORDER BY published_at DESC, id DESC LIMIT 1
  `, platform);

  if (!build?.file_url) {
    res.status(404).json({ error: "No published build available for this platform" });
    return;
  }

  const storage = getStorage();

  if (storage.provider === "local") {
    const filePath = path.join(storage.localRoot!, path.basename(build.file_url));
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
    return;
  }

  // Cloud storage: short-lived signed URL only (no permanent public CDN fallback).
  if (!storage.getSignedDownloadUrl) {
    res.status(503).json({ error: "Signed downloads are not configured for this storage provider" });
    return;
  }
  const downloadUrl = await storage.getSignedDownloadUrl(build.file_url, 120);

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

  res.redirect(downloadUrl);
});

export default router;
