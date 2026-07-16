import "./loadEnv.js";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import compression from "compression";
import helmet from "helmet";
import path from "path";
import fs from "fs";
import http from "http";
import { fileURLToPath } from "url";

import { dbAsync, dataDirectory } from "./db/index.js";
import { qGet } from "./db/query.js";
import { runAllMigrations } from "./db/migrate.js";
import { seedDatabase } from "./db/seed.js";
import { errorHandler, notFound } from "./middleware/error.js";
import { initStorage, getStorage } from "./storage/index.js";

import authRoutes from "./routes/auth.js";
import oauthRoutes from "./routes/oauth.js";
import userRoutes from "./routes/users.js";
import messageRoutes from "./routes/messages.js";
import notificationRoutes from "./routes/notifications.js";
import contactRoutes from "./routes/contact.js";
import newsletterRoutes from "./routes/newsletter.js";
import jobRoutes from "./routes/jobs.js";
import adminRoutes from "./routes/admin.js";
import dmRoutes from "./routes/dm.js";
import gameDownloadRoutes from "./routes/gameDownloads.js";
import contentRoutes from "./routes/content.js";
import { initRealtime } from "./services/realtime.js";
import { verifyMailOnStartup } from "./services/mail.js";
import { optionalAuth } from "./middleware/auth.js";
import { canDownloadResource, normalizeResourceVisibility } from "./routes/content.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  await initStorage();
  await runAllMigrations();
  await seedDatabase();

  const storage = getStorage();
  const uploadDir = storage.localRoot
    || process.env.UPLOAD_DIR
    || path.resolve(dataDirectory, "uploads");
  if (storage.provider === "local" && !fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const app = express();
  const PORT = Number(process.env.PORT) || 3001;
  const FRONTEND_URL = (process.env.FRONTEND_URL || "").trim().replace(/\/$/, "");
  const CORS_ORIGIN = process.env.CORS_ORIGIN
    || FRONTEND_URL
    || "http://localhost:5173";
  const isProd = (process.env.NODE_ENV || "").toLowerCase() === "production";
  const trustProxyEnv = (process.env.TRUST_PROXY || "").trim().toLowerCase();
  if (trustProxyEnv === "1" || trustProxyEnv === "true" || (isProd && trustProxyEnv !== "0" && trustProxyEnv !== "false")) {
    app.set("trust proxy", 1);
  }

  app.use(helmet({
    contentSecurityPolicy: isProd ? {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        mediaSrc: ["'self'", "blob:", "https:"],
        connectSrc: ["'self'", "wss:", "ws:", "https:"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    } : false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    hsts: isProd ? { maxAge: 15552000, includeSubDomains: true } : false,
  }));
  app.use((_req, res, next) => {
    res.setHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(), payment=()");
    next();
  });

  app.use(compression());

  // Explicit CORS allowlist (comma-separated). Always include FRONTEND_URL when set.
  const corsOrigins = [...new Set(
    `${CORS_ORIGIN}${FRONTEND_URL ? `,${FRONTEND_URL}` : ""}`
      .split(",")
      .map((s) => s.trim().replace(/\/$/, ""))
      .filter(Boolean),
  )];
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // same-origin / curl / Railway health
      if (corsOrigins.includes(origin) || corsOrigins.includes("*")) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
  }));
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));
  app.use((_req, res, next) => {
    res.setHeader(
      "Accept-CH",
      "Sec-CH-UA, Sec-CH-UA-Mobile, Sec-CH-UA-Platform, Sec-CH-UA-Platform-Version, Sec-CH-UA-Model",
    );
    next();
  });

  /**
   * Gate direct /uploads access for PRIVATE resource files and apply safe headers.
   * Local storage serves from disk; cloud storage uses signed URLs for gated assets.
   */
  app.use("/uploads", optionalAuth, async (req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");

    const relKey = req.path.replace(/^[/\\]+/, "").replace(/\.\./g, "");
    const filename = path.basename(relKey);
    if (!filename || filename === "." || filename === "..") {
      next();
      return;
    }
    try {
      const resource = await qGet<{ visibility?: string; content_url?: string }>(`
        SELECT visibility, content_url FROM resources
        WHERE content_url = ? OR content_url LIKE ?
        LIMIT 1
      `, `/uploads/${relKey}`, `%/${filename}`);

      if (resource) {
        const visibility = normalizeResourceVisibility(resource.visibility);
        if (!canDownloadResource(visibility, req.user)) {
          res.status(403).json({
            error: "This resource is available only to Team Members and Administrators.",
          });
          return;
        }
        // Private resources: force attachment disposition even when served statically
        if (visibility === "PRIVATE") {
          res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/"/g, "")}"`);
        }
      }

      // Job application files are never world-readable via /uploads
      const jobFile = await qGet(`
        SELECT 1 FROM job_applications
        WHERE photo_url = ? OR photo_url LIKE ? OR cv_url = ? OR cv_url LIKE ?
        LIMIT 1
      `, `/uploads/${relKey}`, `%/${filename}`, `/uploads/${relKey}`, `%/${filename}`);
      if (jobFile) {
        const u = req.user as { is_admin?: number; id?: number } | undefined;
        if (!u || u.is_admin !== 1) {
          res.status(403).json({ error: "Not authorized to access this file" });
          return;
        }
        res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/"/g, "")}"`);
      }
    } catch {
      /* fall through to static/cloud */
    }
    next();
  });

  if (storage.provider === "local") {
    app.use("/uploads", express.static(uploadDir, {
      maxAge: "7d",
      etag: true,
      lastModified: true,
      immutable: true,
      setHeaders(res, filePath) {
        res.setHeader("X-Content-Type-Options", "nosniff");
        const ext = path.extname(filePath).toLowerCase();
        if ([".html", ".htm", ".svg", ".xml", ".js"].includes(ext)) {
          res.setHeader("Content-Disposition", "attachment");
          res.setHeader("Content-Type", "application/octet-stream");
        }
      },
    }));
  } else {
    // Cloud: prefer short-lived signed URLs; never redirect private objects to permanent CDN.
    app.use("/uploads", async (req, res, next) => {
      try {
        const key = req.path.replace(/^\//, "").replace(/\.\./g, "");
        if (!key) { next(); return; }
        if (storage.getSignedDownloadUrl) {
          const url = await storage.getSignedDownloadUrl(key, 120);
          res.redirect(302, url);
          return;
        }
        next();
      } catch {
        next();
      }
    });
  }

  app.use("/api/auth", authRoutes);
  app.use("/api/auth", oauthRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api", messageRoutes);
  app.use("/api/notifications", notificationRoutes);
  app.use("/api/contact", contactRoutes);
  app.use("/api/newsletter", newsletterRoutes);
  app.use("/api/jobs", jobRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api", dmRoutes);
  app.use("/api", gameDownloadRoutes);
  app.use("/api", contentRoutes);

  app.get("/api/health", async (_req, res) => {
    res.json({
      ok: true,
      ts: Date.now(),
      database: dbAsync.provider,
      storage: storage.provider,
    });
  });

  const spaDir = process.env.SPA_DIR ? path.resolve(process.env.SPA_DIR) : null;
  if (spaDir && fs.existsSync(spaDir)) {
    app.use(express.static(spaDir, {
      maxAge: "1h",
      etag: true,
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }));
    app.get(/.*/, (req, res, next) => {
      if (
        req.path.startsWith("/api")
        || req.path.startsWith("/uploads")
        || req.path.startsWith("/socket.io")
      ) {
        next();
        return;
      }
      res.sendFile(path.join(spaDir, "index.html"));
    });
  }

  app.use(notFound);
  app.use(errorHandler);

  const httpServer = http.createServer(app);
  initRealtime(httpServer, corsOrigins.join(","));

  // Bind all interfaces so Railway/proxy health checks can reach the process.
  const host = process.env.HOST || "0.0.0.0";
  httpServer.listen(PORT, host, () => {
    console.log(`Ninja Era API listening on http://${host}:${PORT}`);
    console.log(`  database: ${dbAsync.provider}`);
    console.log(`  storage:  ${storage.provider}`);
    void verifyMailOnStartup();
  });

  const shutdown = (signal: string) => {
    console.log(`[shutdown] ${signal} received — closing server`);
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
