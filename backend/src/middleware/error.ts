import type { Request, Response, NextFunction } from "express";
import multer from "multer";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "File is too large for this upload." });
      return;
    }
    res.status(400).json({ error: err.message || "Upload failed" });
    return;
  }
  console.error(err);
  if (err instanceof Error && err.message.includes("UNIQUE constraint")) {
    res.status(409).json({ error: "Resource already exists" });
    return;
  }
  res.status(500).json({ error: "Internal server error" });
}

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: "Not found" });
}
