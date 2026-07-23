import { Router } from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { optionalAuth, requireAuth } from "../middleware/auth.js";
import { requireSuperAdmin } from "../middleware/admin.js";
import { rateLimit, clientIp } from "../middleware/rateLimit.js";
import { logActivitySync } from "../services/activityLog.js";
import { getStorage, deleteStoredUrl } from "../storage/index.js";
import {
  cleanupTempFile,
  createTempDiskUploader,
  persistMulterFile,
} from "../storage/multerUpload.js";
import {
  VERSION_BACKUP_MAX_BYTES,
  formatBytesLimit,
} from "../config/uploadLimits.js";
import { contentDispositionAttachment } from "../services/downloadFilename.js";
import {
  buildStoredFilename,
  createVersionBackupRecord,
  getVersionBackup,
  incrementVersionBackupDownloads,
  isAllowedBackupExtension,
  mapVersionBackup,
  sanitizeOriginalFilename,
  VERSION_BACKUP_ALLOWED_EXTS,
} from "../services/versionBackups.js";

const router = Router();

const upload = createTempDiskUploader({
  limits: { fileSize: VERSION_BACKUP_MAX_BYTES },
  prefix: "versionbackup",
});

const publicUploadLimit = rateLimit({
  keyFn: (req) => `versionbackup:upload:${clientIp(req)}`,
  max: 20,
  windowMs: 60 * 60 * 1000,
  message: "Too many backup uploads from this IP. Please try again later.",
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

/**
 * Public unauthenticated upload — multipart field name: `file`
 * POST /api/versionbackup
 *
 * curl -X POST -F "file=@backup.zip" https://host/api/versionbackup
 */
router.post(
  "/versionbackup",
  optionalAuth,
  publicUploadLimit,
  uploadMiddleware,
  async (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file uploaded. Use multipart field name \"file\"." });
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
        uploaderId: req.user?.id ?? null,
      });

      logActivitySync({
        req,
        userId: req.user?.id ?? null,
        username: req.user?.username ?? "Guest",
        eventType: "version_backup_upload",
        eventCategory: "administration",
        description: `Uploaded Telegram backup "${originalName}"`,
        affectedObject: `version_backup:${id}`,
        result: "success",
        metadata: { size: stored.size, storedFilename, source: "public" },
      });

      res.status(201).json({
        ok: true,
        id,
        originalName,
        storedName: storedFilename,
        size: stored.size,
        status: "active",
      });
    } catch (err) {
      cleanupTempFile(file);
      if (stored?.url) {
        try { await deleteStoredUrl(stored.url); } catch { /* ignore */ }
      }
      console.error("[versionbackup] upload failed:", err);
      logActivitySync({
        req,
        userId: req.user?.id ?? null,
        username: req.user?.username ?? "Guest",
        eventType: "version_backup_upload",
        eventCategory: "administration",
        description: `Failed Telegram backup upload: ${originalName}`,
        affectedObject: "version_backup",
        result: "failure",
      });
      res.status(500).json({ error: "Unable to store backup file" });
    }
  },
);

/**
 * Protected download — Super Administrator only; active files only.
 * GET /api/versionbackup/:id/download
 */
router.get(
  "/versionbackup/:id/download",
  requireAuth,
  requireSuperAdmin,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "Invalid backup id" });
      return;
    }

    const row = await getVersionBackup(id);
    if (!row || row.status === "deleted") {
      res.status(404).json({ error: "Backup file not found" });
      return;
    }
    if (row.status !== "active") {
      res.status(403).json({ error: "This backup file is disabled" });
      return;
    }

    const downloadName = sanitizeOriginalFilename(row.original_filename);
    const storage = getStorage();

    if (storage.provider === "local") {
      const key = row.file_url.replace(/^\/uploads\//, "").replace(/^[/\\]+/, "").replace(/\.\./g, "");
      const filePath = path.resolve(storage.localRoot!, key);
      const relative = path.relative(storage.localRoot!, filePath);
      if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(filePath)) {
        logActivitySync({
          req,
          userId: req.user?.id ?? null,
          eventType: "version_backup_download",
          eventCategory: "downloads",
          description: `Failed backup download #${id}: file missing`,
          affectedObject: `version_backup:${id}`,
          result: "failure",
        });
        res.status(404).json({ error: "File not found" });
        return;
      }

      await incrementVersionBackupDownloads(id);
      logActivitySync({
        req,
        userId: req.user!.id,
        eventType: "version_backup_download",
        eventCategory: "downloads",
        description: `Downloaded Telegram backup "${downloadName}"`,
        affectedObject: `version_backup:${id}`,
        result: "success",
      });

      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", contentDispositionAttachment(downloadName));
      res.sendFile(filePath, (err) => {
        if (err && !res.headersSent) {
          res.status(500).json({ error: "Unable to send file" });
        }
      });
      return;
    }

    if (!storage.getSignedDownloadUrl) {
      res.status(503).json({ error: "Signed downloads are not configured" });
      return;
    }

    let downloadUrl: string;
    try {
      downloadUrl = await storage.getSignedDownloadUrl(row.file_url, 120);
    } catch {
      res.status(404).json({ error: "File not found" });
      return;
    }

    await incrementVersionBackupDownloads(id);
    logActivitySync({
      req,
      userId: req.user!.id,
      eventType: "version_backup_download",
      eventCategory: "downloads",
      description: `Downloaded Telegram backup "${downloadName}"`,
      affectedObject: `version_backup:${id}`,
      result: "success",
    });

    res.json({ downloadUrl, filename: downloadName, backup: mapVersionBackup(row) });
  },
);

export default router;
