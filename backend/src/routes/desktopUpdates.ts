import { Router } from "express";
import {
  getPublishedRelease,
  mapLatestRelease,
  normalizeChannel,
} from "../services/desktopReleases.js";
import { normalizeAppId } from "../services/appRegistry.js";

const router = Router();

/**
 * Public metadata-only endpoint for desktop clients.
 * Returns GitHub Release URL — never proxies or streams installer bytes.
 *
 * GET /api/desktop-releases/latest?appId=messenger&channel=stable
 */
router.get("/desktop-releases/latest", async (req, res) => {
  const appId = normalizeAppId(req.query.appId || "messenger");
  const channel = normalizeChannel(req.query.channel || "stable") || "stable";
  if (!appId) {
    res.status(400).json({ error: "Invalid appId" });
    return;
  }
  const published = await getPublishedRelease(appId, channel);
  if (!published || !published.github_release_url) {
    res.status(404).json({ error: "No published release" });
    return;
  }
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.json({ release: mapLatestRelease(published) });
});

export default router;
