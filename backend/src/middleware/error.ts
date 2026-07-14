import type { Request, Response, NextFunction } from "express";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
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
