import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { logActivitySync } from "../services/activityLog.js";

const router = Router();
const now = () => new Date().toISOString();

const uploadDir = process.env.UPLOAD_DIR || "./uploads";
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `job-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

router.get("/", (_req, res) => {
  const jobs = db.prepare("SELECT id, title, department, employment_type as type, description FROM job_postings WHERE active = 1").all();
  res.json({ jobs });
});

router.post("/:id/apply", requireAuth, upload.fields([
  { name: "photo", maxCount: 1 },
  { name: "cv", maxCount: 1 },
]), (req, res) => {
  const jobId = Number(req.params.id);
  const job = db.prepare("SELECT id FROM job_postings WHERE id = ? AND active = 1").get(jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const { fullName, gender, dateOfBirth, country, city, portfolioUrl, message } = req.body;
  if (!fullName) {
    res.status(400).json({ error: "Full name is required" });
    return;
  }

  const files = req.files as { photo?: Express.Multer.File[]; cv?: Express.Multer.File[] };
  const photoUrl = files.photo?.[0] ? `/uploads/${files.photo[0].filename}` : null;
  const cvUrl = files.cv?.[0] ? `/uploads/${files.cv[0].filename}` : null;

  db.prepare(`
    INSERT INTO job_applications (job_id, user_id, full_name, gender, date_of_birth, country, city, photo_url, cv_url, portfolio_url, message, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(jobId, req.user!.id, fullName, gender || null, dateOfBirth || null, country || null, city || null, photoUrl, cvUrl, portfolioUrl || null, message || null, now());

  logActivitySync({ req, userId: req.user!.id, eventType: "application_submitted", eventCategory: "teamwork", description: `Submitted teamwork application for job #${jobId}`, affectedObject: `job_application:${jobId}` });

  res.status(201).json({ ok: true, message: "Application submitted" });
});

export default router;
