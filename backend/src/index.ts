import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import fs from "fs";
import http from "http";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

import { initSchema } from "./db/index.js";
import { runMigrations } from "./db/migrations.js";
import { seedDatabase } from "./db/seed.js";
import { errorHandler, notFound } from "./middleware/error.js";

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

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = process.env.UPLOAD_DIR || path.resolve(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

initSchema();
runMigrations();
seedDatabase();

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";

app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(cookieParser());
app.use(express.json());
app.use("/uploads", express.static(uploadDir));

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

app.use(notFound);
app.use(errorHandler);

const httpServer = http.createServer(app);
initRealtime(httpServer, CORS_ORIGIN);

httpServer.listen(PORT, () => {
  console.log(`Ninja Era API running on http://localhost:${PORT}`);
});
