import { Router } from "express";
import fs from "fs";
import { requireSuperAdmin } from "../middleware/admin.js";
import { qAll, qGet, qRun } from "../db/query.js";
import { logActivitySync } from "../services/activityLog.js";
import { validateUpload } from "../services/uploadValidation.js";
import { deleteStoredUrl } from "../storage/index.js";
import { cleanupTempFile, createTempDiskUploader, persistMulterFile } from "../storage/multerUpload.js";
import {
  aliasTaken,
  normalizeAlias,
  validateAlias,
  type LinkFileRow,
} from "../services/linkFiles.js";
import { ADMIN_LINK_FILE_MAX_BYTES } from "../config/uploadLimits.js";

const router = Router();
const now = () => new Date().toISOString();

const linkUpload = createTempDiskUploader({
  limits: { fileSize: ADMIN_LINK_FILE_MAX_BYTES },
  prefix: "external",
});

async function readFileHead(filePath: string, n = 64 * 1024): Promise<Buffer> {
  const fh = await fs.promises.open(filePath, "r");
  try {
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

async function validateLinkMulterFile(file: Express.Multer.File) {
  let buffer: Buffer | null = file.buffer || null;
  if (!buffer && file.path) {
    buffer = await readFileHead(file.path);
  }
  return validateUpload({
    kind: "linkFile",
    originalName: file.originalname,
    declaredMime: file.mimetype,
    buffer,
    size: file.size,
  });
}

function mapLinkFile(r: LinkFileRow & { uploaderName?: string | null }) {
  return {
    id: r.id,
    alias: r.alias_display || r.alias,
    originalFilename: r.original_filename,
    fileUrl: r.file_url,
    mimeType: r.mime_type,
    fileSize: Number(r.file_size) || 0,
    active: r.active === 1,
    accessCount: Number(r.access_count) || 0,
    lastAccessedAt: r.last_accessed_at,
    lastVisitor: r.last_visitor_label,
    lastVisitorUserId: r.last_visitor_user_id,
    uploaderId: r.uploader_id,
    uploaderName: r.uploaderName ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    publicPath: `/externals/${r.alias_display || r.alias}`,
  };
}

router.get("/link-files", requireSuperAdmin, async (_req, res) => {
  const rows = await qAll<LinkFileRow & { uploaderName: string | null }>(`
    SELECT lf.*, u.username as uploaderName
    FROM link_files lf
    LEFT JOIN users u ON u.id = lf.uploader_id
    ORDER BY lf.created_at DESC, lf.id DESC
  `);
  res.json({ files: rows.map(mapLinkFile) });
});

// Static paths before /link-files/:id
router.get("/link-files/alias-available", requireSuperAdmin, async (req, res) => {
  const aliasCheck = validateAlias(String(req.query.alias || ""));
  if (!aliasCheck.ok) {
    res.json({ available: false, error: aliasCheck.error });
    return;
  }
  const excludeId = req.query.excludeId ? Number(req.query.excludeId) : undefined;
  const taken = await aliasTaken(aliasCheck.alias, Number.isFinite(excludeId) ? excludeId : undefined);
  res.json({ available: !taken, alias: normalizeAlias(aliasCheck.display) });
});

router.get("/link-files/logs", requireSuperAdmin, async (req, res) => {
  const {
    search = "",
    alias = "",
    page = "1",
    limit = "50",
    sortBy = "created_at",
    sortDir = "desc",
    dateFrom = "",
    dateTo = "",
  } = req.query as Record<string, string>;

  const pageN = Math.max(1, Number(page) || 1);
  const limitN = Math.min(200, Math.max(1, Number(limit) || 50));
  const offset = (pageN - 1) * limitN;

  const allowedSort = new Set(["created_at", "alias", "visitor_label", "ip_address", "browser", "platform"]);
  const col = allowedSort.has(sortBy) ? sortBy : "created_at";
  const dir = sortDir.toLowerCase() === "asc" ? "ASC" : "DESC";

  const where: string[] = [];
  const params: unknown[] = [];

  if (search.trim()) {
    const q = `%${search.trim()}%`;
    where.push("(alias LIKE ? OR original_filename LIKE ? OR visitor_label LIKE ? OR ip_address LIKE ? OR browser LIKE ? OR platform LIKE ? OR country LIKE ? OR country_code LIKE ?)");
    params.push(q, q, q, q, q, q, q, q);
  }
  if (alias.trim()) {
    where.push("alias = ?");
    params.push(alias.trim());
  }
  if (dateFrom) {
    where.push("created_at >= ?");
    params.push(dateFrom);
  }
  if (dateTo) {
    where.push("created_at <= ?");
    params.push(dateTo);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const totalRow = await qGet<{ c: number }>(`SELECT COUNT(*) as c FROM link_file_access_logs ${whereSql}`, ...params);
  const rows = await qAll<{
    id: number;
    link_file_id: number;
    alias: string;
    original_filename: string;
    user_id: number | null;
    visitor_label: string;
    ip_address: string | null;
    user_agent: string | null;
    browser: string | null;
    platform: string | null;
    country: string | null;
    country_code: string | null;
    created_at: string;
  }>(`
    SELECT id, link_file_id, alias, original_filename, user_id, visitor_label,
           ip_address, user_agent, browser, platform, country, country_code, created_at
    FROM link_file_access_logs
    ${whereSql}
    ORDER BY ${col} ${dir}, id ${dir}
    LIMIT ? OFFSET ?
  `, ...params, limitN, offset);

  res.json({
    total: Number(totalRow?.c) || 0,
    page: pageN,
    limit: limitN,
    logs: rows.map((r) => ({
      id: r.id,
      linkFileId: r.link_file_id,
      alias: r.alias,
      originalFilename: r.original_filename,
      userId: r.user_id,
      visitor: r.visitor_label,
      ipAddress: r.ip_address,
      userAgent: r.user_agent,
      browser: r.browser,
      platform: r.platform,
      country: r.country,
      countryCode: r.country_code,
      createdAt: r.created_at,
    })),
  });
});

router.post("/link-files/logs/bulk-delete", requireSuperAdmin, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0) : [];
  if (!ids.length) {
    res.status(400).json({ error: "No log ids provided" });
    return;
  }
  const placeholders = ids.map(() => "?").join(",");
  const result = await qRun(`DELETE FROM link_file_access_logs WHERE id IN (${placeholders})`, ...ids);

  logActivitySync({
    req,
    userId: req.user!.id,
    eventType: "link_file_logs_delete",
    eventCategory: "administration",
    description: `Deleted ${result.changes} link file access log(s)`,
    affectedObject: "link_file_access_logs",
  });

  res.json({ ok: true, deleted: result.changes });
});

router.post("/link-files", requireSuperAdmin, (req, res) => {
  linkUpload.single("file")(req, res, async (err) => {
    if (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Upload failed" });
      return;
    }
    try {
      if (!req.file) {
        res.status(400).json({ error: "File is required" });
        return;
      }
      const aliasCheck = validateAlias(String(req.body.alias || ""));
      if (!aliasCheck.ok) {
        cleanupTempFile(req.file);
        res.status(400).json({ error: aliasCheck.error });
        return;
      }
      if (await aliasTaken(aliasCheck.alias)) {
        cleanupTempFile(req.file);
        res.status(409).json({ error: "This public path is already in use" });
        return;
      }

      const validated = await validateLinkMulterFile(req.file);
      if (!validated.ok) {
        cleanupTempFile(req.file);
        res.status(400).json({ error: validated.error });
        return;
      }

      const stored = await persistMulterFile(req.file, "external", { contentType: validated.contentType });
      const ts = now();
      const active = req.body.active === "false" || req.body.active === false ? 0 : 1;
      const result = await qRun(`
        INSERT INTO link_files (
          alias, alias_display, original_filename, file_url, mime_type, file_size,
          active, access_count, uploader_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
      `,
        aliasCheck.alias,
        aliasCheck.display,
        req.file.originalname,
        stored.url,
        validated.contentType,
        stored.size,
        active,
        req.user!.id,
        ts,
        ts,
      );

      logActivitySync({
        req,
        userId: req.user!.id,
        eventType: "link_file_upload",
        eventCategory: "administration",
        description: `Uploaded link file alias ${aliasCheck.display}`,
        affectedObject: `link_file:${result.lastInsertRowid}`,
      });

      res.status(201).json({ id: result.lastInsertRowid });
    } catch (e) {
      cleanupTempFile(req.file);
      res.status(500).json({ error: e instanceof Error ? e.message : "Upload failed" });
    }
  });
});

router.patch("/link-files/:id", requireSuperAdmin, (req, res) => {
  linkUpload.single("file")(req, res, async (err) => {
    if (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Upload failed" });
      return;
    }
    try {
      const id = Number(req.params.id);
      const existing = await qGet<LinkFileRow>("SELECT * FROM link_files WHERE id = ?", id);
      if (!existing) {
        cleanupTempFile(req.file);
        res.status(404).json({ error: "Link file not found" });
        return;
      }

      const fields: string[] = ["updated_at = ?"];
      const vals: unknown[] = [now()];
      let replacedUrl: string | null = null;

      if (req.body.alias !== undefined) {
        const aliasCheck = validateAlias(String(req.body.alias));
        if (!aliasCheck.ok) {
          cleanupTempFile(req.file);
          res.status(400).json({ error: aliasCheck.error });
          return;
        }
        if (await aliasTaken(aliasCheck.alias, id)) {
          cleanupTempFile(req.file);
          res.status(409).json({ error: "This public path is already in use" });
          return;
        }
        fields.push("alias = ?", "alias_display = ?");
        vals.push(aliasCheck.alias, aliasCheck.display);
      }

      if (req.body.active !== undefined) {
        const isActive = !(req.body.active === "false" || req.body.active === false || req.body.active === "0" || req.body.active === 0);
        fields.push("active = ?");
        vals.push(isActive ? 1 : 0);
      }

      if (req.file) {
        const validated = await validateLinkMulterFile(req.file);
        if (!validated.ok) {
          cleanupTempFile(req.file);
          res.status(400).json({ error: validated.error });
          return;
        }
        const stored = await persistMulterFile(req.file, "external", { contentType: validated.contentType });
        fields.push("file_url = ?", "mime_type = ?", "file_size = ?", "original_filename = ?");
        vals.push(stored.url, validated.contentType, stored.size, req.file.originalname);
        replacedUrl = existing.file_url;
      }

      vals.push(id);
      await qRun(`UPDATE link_files SET ${fields.join(", ")} WHERE id = ?`, ...vals);
      if (replacedUrl) await deleteStoredUrl(replacedUrl);

      logActivitySync({
        req,
        userId: req.user!.id,
        eventType: "link_file_update",
        eventCategory: "administration",
        description: `Updated link file #${id}`,
        affectedObject: `link_file:${id}`,
      });

      res.json({ ok: true });
    } catch (e) {
      cleanupTempFile(req.file);
      res.status(500).json({ error: e instanceof Error ? e.message : "Update failed" });
    }
  });
});

router.delete("/link-files/:id", requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const row = await qGet<LinkFileRow>("SELECT * FROM link_files WHERE id = ?", id);
  if (!row) {
    res.status(404).json({ error: "Link file not found" });
    return;
  }
  // Cascades access logs via FK; remove storage object after DB row.
  await qRun("DELETE FROM link_files WHERE id = ?", id);
  if (row.file_url) await deleteStoredUrl(row.file_url);

  logActivitySync({
    req,
    userId: req.user!.id,
    eventType: "link_file_delete",
    eventCategory: "administration",
    description: `Deleted link file alias ${row.alias_display || row.alias}`,
    affectedObject: `link_file:${id}`,
  });

  res.json({ ok: true });
});

export default router;
