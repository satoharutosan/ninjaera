import { Router } from "express";
import fs from "fs";
import { optionalAuth } from "../middleware/auth.js";
import { getStorage } from "../storage/index.js";
import {
  contentDispositionInline,
  findLinkFileByAlias,
  recordLinkFileAccess,
  resolveLocalFilePath,
} from "../services/linkFiles.js";

const router = Router();

/** Avoid counting every video Range chunk as a separate visit. */
function shouldRecordAccess(req: import("express").Request): boolean {
  const range = req.headers.range;
  if (!range || typeof range !== "string") return true;
  return /^bytes\s*=\s*0-/i.test(range.trim());
}

/**
 * Public alias access: GET /externals/:alias
 * Serves the file inline with the stored MIME type. Logs successful visits.
 */
router.get("/:alias", optionalAuth, async (req, res) => {
  const aliasParam = String(req.params.alias || "");
  const file = await findLinkFileByAlias(aliasParam);
  if (!file || file.active !== 1) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const storage = getStorage();
  const mime = file.mime_type || "application/octet-stream";

  try {
    if (storage.provider === "local") {
      const filePath = resolveLocalFilePath(file.file_url);
      if (!filePath) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      if (shouldRecordAccess(req)) {
        await recordLinkFileAccess({ req, file });
      }

      const stat = fs.statSync(filePath);
      res.setHeader("Content-Type", mime);
      res.setHeader("Content-Disposition", contentDispositionInline(file.original_filename));
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Last-Modified", stat.mtime.toUTCString());
      // ETag from size + mtime — supports conditional GET without loading the body.
      const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
      res.setHeader("ETag", etag);
      if (req.headers["if-none-match"] === etag) {
        res.status(304).end();
        return;
      }
      const ifMod = req.headers["if-modified-since"];
      if (typeof ifMod === "string" && new Date(ifMod).getTime() >= stat.mtime.getTime()) {
        res.status(304).end();
        return;
      }

      res.sendFile(filePath, { acceptRanges: true, lastModified: false, etag: false }, (err) => {
        if (err && !res.headersSent) {
          res.status(404).json({ error: "Not found" });
        }
      });
      return;
    }

    if (!storage.getSignedDownloadUrl) {
      res.status(503).json({ error: "File storage is not available" });
      return;
    }

    const downloadUrl = await storage.getSignedDownloadUrl(file.file_url, 300);
    if (shouldRecordAccess(req)) {
      await recordLinkFileAccess({ req, file });
    }
    res.setHeader("Cache-Control", "private, max-age=60");
    res.redirect(302, downloadUrl);
  } catch {
    if (!res.headersSent) {
      res.status(404).json({ error: "Not found" });
    }
  }
});

export default router;
