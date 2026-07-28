import { Router } from "express";
import path from "path";
import fs from "fs";
import { qGet } from "../db/query.js";
import { optionalAuth } from "../middleware/auth.js";
import { logActivitySync } from "../services/activityLog.js";
import { getStorage } from "../storage/index.js";
import { validateExternalDownloadUrl } from "../services/externalDownloadUrl.js";
import {
  contentDispositionAttachment,
  resolveResourceDownloadFilename,
} from "../services/downloadFilename.js";
import { normalizeResourcePublicSlug, RESOURCE_PUBLIC_SLUG_RE } from "../services/resourcePublicSlug.js";

const router = Router();

function isPublicVisibility(raw: unknown): boolean {
  return String(raw ?? "PUBLIC").trim().toUpperCase() !== "PRIVATE";
}

/**
 * Direct public download: GET /resources/public/:slug
 * PUBLIC + enabled resources only. Streams or 302-redirects — no SPA/JSON hop.
 */
router.get("/:slug", optionalAuth, async (req, res) => {
  const raw = String(req.params.slug || "");
  const slug = normalizeResourcePublicSlug(raw);
  if (!slug || !RESOURCE_PUBLIC_SLUG_RE.test(slug)) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }

  const resource = await qGet<{
    id: number;
    title: string;
    category: string;
    version: string | null;
    visibility: string | null;
    enabled: number;
    content_url: string | null;
    external_url: string | null;
    original_filename: string | null;
  }>(
    `SELECT id, title, category, version, visibility, enabled, content_url, external_url, original_filename
     FROM resources WHERE public_slug = ?`,
    slug,
  );

  const visibilityOk = isPublicVisibility(resource?.visibility);
  const hasExternal = !!(resource?.external_url && String(resource.external_url).trim());
  const hasStored = !!(resource?.content_url && String(resource.content_url).trim());

  // Hide private/disabled/missing as 404 so existence is not leaked.
  if (!resource || resource.enabled !== 1 || !visibilityOk || (!hasExternal && !hasStored)) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }

  if (hasExternal) {
    const checked = validateExternalDownloadUrl(resource.external_url);
    if (!checked.ok) {
      res.status(500).type("text/plain").send("Invalid download URL");
      return;
    }
    logActivitySync({
      req,
      userId: req.user?.id ?? null,
      username: req.user?.username ?? "Guest",
      eventType: "resource_download",
      eventCategory: "downloads",
      description: `Downloaded resource (public link): ${resource.title}${resource.version ? ` v${resource.version}` : ""} (${resource.category})`,
      affectedObject: `resource:${resource.id}`,
      result: "success",
      metadata: { source: "public_link", category: resource.category, version: resource.version },
    });
    res.redirect(302, checked.url);
    return;
  }

  const downloadName = resolveResourceDownloadFilename({
    id: resource.id,
    title: resource.title,
    original_filename: resource.original_filename,
    content_url: resource.content_url,
  });

  const storage = getStorage();
  if (storage.provider === "local") {
    const key = resource.content_url!.replace(/^\/uploads\//, "").replace(/^[/\\]+/, "").replace(/\.\./g, "");
    const filePath = path.resolve(storage.localRoot!, key);
    const relative = path.relative(storage.localRoot!, filePath);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(filePath)) {
      res.status(404).type("text/plain").send("Not found");
      return;
    }
    logActivitySync({
      req,
      userId: req.user?.id ?? null,
      username: req.user?.username ?? "Guest",
      eventType: "resource_download",
      eventCategory: "downloads",
      description: `Downloaded resource (public link): ${resource.title}`,
      affectedObject: `resource:${resource.id}`,
      result: "success",
      metadata: { source: "public_link" },
    });
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", contentDispositionAttachment(downloadName));
    res.sendFile(filePath, (err) => {
      if (err && !res.headersSent) {
        res.status(500).type("text/plain").send("Unable to send file");
      }
    });
    return;
  }

  if (!storage.getSignedDownloadUrl) {
    res.status(503).type("text/plain").send("Downloads unavailable");
    return;
  }

  try {
    const downloadUrl = await storage.getSignedDownloadUrl(resource.content_url!, 120);
    logActivitySync({
      req,
      userId: req.user?.id ?? null,
      username: req.user?.username ?? "Guest",
      eventType: "resource_download",
      eventCategory: "downloads",
      description: `Downloaded resource (public link): ${resource.title}`,
      affectedObject: `resource:${resource.id}`,
      result: "success",
      metadata: { source: "public_link" },
    });
    res.redirect(302, downloadUrl);
  } catch {
    res.status(404).type("text/plain").send("Not found");
  }
});

export default router;
