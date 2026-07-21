import { Router } from "express";
import { requireSuperAdmin } from "../middleware/admin.js";
import { qGet, qRun } from "../db/query.js";
import { logActivitySync } from "../services/activityLog.js";
import { APP_REGISTRY } from "../services/appRegistry.js";
import {
  DESKTOP_CHANNELS,
  deleteRelease,
  listDesktopReleases,
  mapDesktopRelease,
  normalizeChecksum,
  parsePublishDate,
  publishRelease,
  unpublishRelease,
  validateGithubReleaseUrl,
  validateReleaseMeta,
  type DesktopReleaseRow,
} from "../services/desktopReleases.js";

const router = Router();
const now = () => new Date().toISOString();

router.get("/desktop-releases/meta", requireSuperAdmin, async (_req, res) => {
  res.json({
    apps: APP_REGISTRY.map((a) => ({ id: a.id, name: a.name })),
    channels: [...DESKTOP_CHANNELS],
  });
});

router.get("/desktop-releases", requireSuperAdmin, async (req, res) => {
  const appId = String(req.query.appId || "").trim().toLowerCase() || undefined;
  const channel = String(req.query.channel || "").trim().toLowerCase() || undefined;
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 50;
  const { rows, total } = await listDesktopReleases({ appId, channel, page, limit });
  res.json({
    total,
    page,
    limit,
    releases: rows.map(mapDesktopRelease),
  });
});

router.post("/desktop-releases", requireSuperAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const meta = validateReleaseMeta({
      appId: body.appId,
      version: body.version,
      channel: body.channel,
    });
    const githubReleaseUrl = validateGithubReleaseUrl(body.githubReleaseUrl);
    const releaseNotes = String(body.releaseNotes || "").trim().slice(0, 8000) || null;
    const minSupported =
      String(body.minSupportedVersion || "").trim().replace(/^v/i, "") || null;
    const checksum = normalizeChecksum(body.checksum);
    const publishDate = parsePublishDate(body.publishDate) || now();
    const autoPublish =
      String(body.publish || "").toLowerCase() === "true" ||
      body.publish === true ||
      body.publish === "1";

    const existing = await qGet<{ id: number }>(
      "SELECT id FROM desktop_releases WHERE app_id = ? AND channel = ? AND version = ?",
      meta.appId,
      meta.channel,
      meta.version,
    );
    if (existing) {
      res.status(409).json({ error: "This app/channel/version already exists" });
      return;
    }

    const ts = now();
    const result = await qRun(
      `INSERT INTO desktop_releases (
        app_id, version, channel, release_notes, min_supported_version,
        github_release_url, package_filename, package_url, package_size, sha1, sha256,
        published, published_at, created_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, '', '', 0, '', ?, 0, ?, ?, ?)`,
      meta.appId,
      meta.version,
      meta.channel,
      releaseNotes,
      minSupported,
      githubReleaseUrl,
      checksum || "",
      publishDate,
      ts,
      req.user!.id,
    );

    let row = await qGet<DesktopReleaseRow>(
      "SELECT * FROM desktop_releases WHERE id = ?",
      result.lastInsertRowid,
    );
    if (autoPublish && row) {
      row = await publishRelease(row.id);
    }

    logActivitySync({
      req,
      userId: req.user!.id,
      username: req.user!.username,
      eventType: "desktop_release_create",
      eventCategory: "admin",
      description: `Created desktop release ${meta.appId} ${meta.version} (${meta.channel})`,
      affectedObject: `desktop_release:${result.lastInsertRowid}`,
      result: "success",
      metadata: { githubReleaseUrl, published: autoPublish },
    });

    res.status(201).json({ release: row ? mapDesktopRelease(row) : { id: result.lastInsertRowid } });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : "Create failed";
    if (status >= 400 && status < 500) {
      res.status(status).json({ error: message });
      return;
    }
    console.error("[desktop-releases] create failed:", err);
    res.status(500).json({ error: "Unable to create release" });
  }
});

router.patch("/desktop-releases/:id", requireSuperAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = await qGet<DesktopReleaseRow>("SELECT * FROM desktop_releases WHERE id = ?", id);
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const body = req.body || {};
    const fields: string[] = [];
    const vals: unknown[] = [];

    if (body.githubReleaseUrl !== undefined) {
      fields.push("github_release_url = ?");
      vals.push(validateGithubReleaseUrl(body.githubReleaseUrl));
    }
    if (body.releaseNotes !== undefined) {
      fields.push("release_notes = ?");
      vals.push(String(body.releaseNotes || "").trim().slice(0, 8000) || null);
    }
    if (body.minSupportedVersion !== undefined) {
      const v = String(body.minSupportedVersion || "").trim().replace(/^v/i, "");
      fields.push("min_supported_version = ?");
      vals.push(v || null);
    }
    if (body.checksum !== undefined) {
      fields.push("sha256 = ?");
      vals.push(normalizeChecksum(body.checksum));
    }
    if (body.publishDate !== undefined) {
      fields.push("published_at = ?");
      vals.push(parsePublishDate(body.publishDate) || row.published_at);
    }
    if (body.channel !== undefined) {
      const meta = validateReleaseMeta({
        appId: row.app_id,
        version: row.version,
        channel: body.channel,
      });
      fields.push("channel = ?");
      vals.push(meta.channel);
    }

    if (!fields.length) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    vals.push(id);
    await qRun(`UPDATE desktop_releases SET ${fields.join(", ")} WHERE id = ?`, ...vals);
    const updated = await qGet<DesktopReleaseRow>("SELECT * FROM desktop_releases WHERE id = ?", id);

    logActivitySync({
      req,
      userId: req.user!.id,
      username: req.user!.username,
      eventType: "desktop_release_update",
      eventCategory: "admin",
      description: `Updated desktop release #${id}`,
      affectedObject: `desktop_release:${id}`,
      result: "success",
    });

    res.json({ release: updated ? mapDesktopRelease(updated) : null });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : "Update failed";
    res.status(status).json({ error: message });
  }
});

router.post("/desktop-releases/:id/publish", requireSuperAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = await publishRelease(id);
    logActivitySync({
      req,
      userId: req.user!.id,
      username: req.user!.username,
      eventType: "desktop_release_publish",
      eventCategory: "admin",
      description: `Published desktop release ${row.app_id} ${row.version} (${row.channel})`,
      affectedObject: `desktop_release:${id}`,
      result: "success",
    });
    res.json({ release: mapDesktopRelease(row) });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : "Publish failed";
    res.status(status).json({ error: message });
  }
});

router.post("/desktop-releases/:id/unpublish", requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  await unpublishRelease(id);
  logActivitySync({
    req,
    userId: req.user!.id,
    username: req.user!.username,
    eventType: "desktop_release_unpublish",
    eventCategory: "admin",
    description: `Unpublished desktop release #${id}`,
    affectedObject: `desktop_release:${id}`,
    result: "success",
  });
  res.json({ ok: true });
});

router.delete("/desktop-releases/:id", requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const deleted = await deleteRelease(id);
  if (!deleted) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  logActivitySync({
    req,
    userId: req.user!.id,
    username: req.user!.username,
    eventType: "desktop_release_delete",
    eventCategory: "admin",
    description: `Deleted desktop release ${deleted.app_id} ${deleted.version}`,
    affectedObject: `desktop_release:${id}`,
    result: "success",
  });
  res.json({ ok: true });
});

export default router;
