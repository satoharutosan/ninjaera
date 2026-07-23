import { Router } from "express";
import multer from "multer";
import { requireSuperAdmin } from "../middleware/admin.js";
import { logActivitySync } from "../services/activityLog.js";
import {
  cleanupTempFile,
  createTempDiskUploader,
  persistMulterFile,
} from "../storage/multerUpload.js";
import { deleteStoredUrl } from "../storage/index.js";
import {
  VERSION_BACKUP_MAX_BYTES,
  formatBytesLimit,
} from "../config/uploadLimits.js";
import {
  buildStoredFilename,
  createVersionBackupRecord,
  getVersionBackup,
  isAllowedBackupExtension,
  listVersionBackups,
  mapVersionBackup,
  sanitizeOriginalFilename,
  setVersionBackupStatus,
  softDeleteVersionBackup,
  VERSION_BACKUP_ALLOWED_EXTS,
} from "../services/versionBackups.js";

const router = Router();

const upload = createTempDiskUploader({
  limits: { fileSize: VERSION_BACKUP_MAX_BYTES },
  prefix: "versionbackup",
});

function uploadMiddleware(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
) {
  upload.single("file")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: `File exceeds the maximum size of ${formatBytesLimit(VERSION_BACKUP_MAX_BYTES)}.`,
        code: "FILE_TOO_LARGE",
        maxBytes: VERSION_BACKUP_MAX_BYTES,
      });
      return;
    }
    if (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid upload" });
      return;
    }
    next();
  });
}

router.get("/version-backups", requireSuperAdmin, async (_req, res) => {
  const includeDeleted = String(_req.query.includeDeleted || "") === "1";
  const files = await listVersionBackups({ includeDeleted });
  res.json({ files, allowedExtensions: VERSION_BACKUP_ALLOWED_EXTS, maxBytes: VERSION_BACKUP_MAX_BYTES });
});

router.get("/version-backups/:id", requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const row = await getVersionBackup(id);
  if (!row || row.status === "deleted") {
    res.status(404).json({ error: "Backup not found" });
    return;
  }
  res.json({ file: mapVersionBackup(row) });
});

router.post("/version-backups", requireSuperAdmin, uploadMiddleware, async (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  const originalName = sanitizeOriginalFilename(file.originalname || "backup.zip");
  if (!isAllowedBackupExtension(originalName)) {
    cleanupTempFile(file);
    res.status(400).json({
      error: `Invalid file type. Allowed: ${VERSION_BACKUP_ALLOWED_EXTS.join(", ")}`,
      code: "INVALID_FILE_TYPE",
    });
    return;
  }

  let stored: Awaited<ReturnType<typeof persistMulterFile>> | null = null;
  try {
    const storedFilename = buildStoredFilename(originalName);
    stored = await persistMulterFile(
      { ...file, originalname: storedFilename },
      "versionbackup",
    );
    const { id } = await createVersionBackupRecord({
      originalFilename: originalName,
      storedFilename,
      stored,
      req,
      uploaderId: req.user!.id,
    });
    logActivitySync({
      req,
      userId: req.user!.id,
      eventType: "version_backup_upload",
      eventCategory: "administration",
      description: `Admin uploaded Telegram backup "${originalName}"`,
      affectedObject: `version_backup:${id}`,
      result: "success",
      metadata: { size: stored.size, storedFilename, source: "admin" },
    });
    const row = await getVersionBackup(id);
    res.status(201).json({ id, file: row ? mapVersionBackup(row) : null });
  } catch (err) {
    cleanupTempFile(file);
    if (stored?.url) {
      try { await deleteStoredUrl(stored.url); } catch { /* ignore */ }
    }
    console.error("[admin version-backups] upload failed:", err);
    res.status(500).json({ error: "Unable to store backup file" });
  }
});

router.patch("/version-backups/:id", requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const existing = await getVersionBackup(id);
  if (!existing || existing.status === "deleted") {
    res.status(404).json({ error: "Backup not found" });
    return;
  }

  const raw = String(req.body?.status || "").toLowerCase();
  if (raw !== "active" && raw !== "disabled") {
    res.status(400).json({ error: "status must be active or disabled" });
    return;
  }

  const updated = await setVersionBackupStatus(id, raw);
  logActivitySync({
    req,
    userId: req.user!.id,
    eventType: "version_backup_status",
    eventCategory: "administration",
    description: `Set Telegram backup #${id} status to ${raw}`,
    affectedObject: `version_backup:${id}`,
    result: "success",
  });
  res.json({ ok: true, file: updated ? mapVersionBackup(updated) : null });
});

router.delete("/version-backups/:id", requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const existing = await getVersionBackup(id);
  if (!existing || existing.status === "deleted") {
    res.status(404).json({ error: "Backup not found" });
    return;
  }
  await softDeleteVersionBackup(id);
  logActivitySync({
    req,
    userId: req.user!.id,
    eventType: "version_backup_delete",
    eventCategory: "administration",
    description: `Deleted Telegram backup "${existing.original_filename}"`,
    affectedObject: `version_backup:${id}`,
    result: "success",
  });
  res.json({ ok: true });
});

export default router;
