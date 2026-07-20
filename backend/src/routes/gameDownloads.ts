import { Router } from "express";
import path from "path";
import fs from "fs";
import { qGet } from "../db/query.js";
import { optionalAuth } from "../middleware/auth.js";
import { logActivitySync } from "../services/activityLog.js";
import { getStorage } from "../storage/index.js";
import { validateExternalDownloadUrl } from "../services/externalDownloadUrl.js";

const router = Router();

const PLATFORMS = ["windows", "android", "ios"] as const;

router.get("/game-downloads", async (_req, res) => {
  const downloads = await Promise.all(PLATFORMS.map(async platform => {
    const row = await qGet<{
      id: number; platform: string; version: string; release_notes: string;
      file_size: number | null; published_at: string;
      file_url: string | null; external_url: string | null;
    }>(`
      SELECT id, platform, version, release_notes, file_size, published_at, file_url, external_url
      FROM game_downloads
      WHERE platform = ? AND published = 1
      ORDER BY published_at DESC, id DESC
      LIMIT 1
    `, platform);

    const available = !!(row?.id && (row.external_url || row.file_url));
    return {
      platform,
      available,
      id: row?.id ?? null,
      version: row?.version ?? null,
      releaseNotes: row?.release_notes ?? null,
      fileSize: row?.file_size ?? null,
      publishedAt: row?.published_at ?? null,
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

  const build = await qGet<{
    id: number;
    file_url: string | null;
    external_url: string | null;
    version: string;
    platform: string;
  }>(`
    SELECT * FROM game_downloads WHERE platform = ? AND published = 1
    ORDER BY published_at DESC, id DESC LIMIT 1
  `, platform);

  const hasExternal = !!(build?.external_url && String(build.external_url).trim());
  const hasStored = !!(build?.file_url && String(build.file_url).trim());

  if (!build || (!hasExternal && !hasStored)) {
    res.status(404).json({ error: "No published build available for this platform" });
    return;
  }

  // Prefer external URL (GitHub, etc.) — never proxy; client opens the URL directly.
  if (hasExternal) {
    const checked = validateExternalDownloadUrl(build.external_url);
    if (!checked.ok) {
      res.status(500).json({ error: "This build has an invalid download URL. Please contact an administrator." });
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
      metadata: { source: "external", platform, version: build.version },
    });
    res.json({ externalUrl: checked.url });
    return;
  }

  const storage = getStorage();

  if (storage.provider === "local") {
    const filePath = path.join(storage.localRoot!, path.basename(build.file_url!));
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
  const downloadUrl = await storage.getSignedDownloadUrl(build.file_url!, 120);

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
