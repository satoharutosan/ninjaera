import { Router } from "express";
import { qGet, qAll, qRun } from "../db/query.js";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { logActivitySync } from "../services/activityLog.js";
import { createMemoryUploader, persistMulterFile } from "../storage/multerUpload.js";
import { validateUpload } from "../services/uploadValidation.js";

const router = Router();
const now = () => new Date().toISOString();

const upload = createMemoryUploader({ limits: { fileSize: 10 * 1024 * 1024 } });

router.get("/", async (_req, res) => {
  const jobs = await qAll("SELECT id, title, department, employment_type as type, description FROM job_postings WHERE active = 1");
  res.json({ jobs });
});

router.post("/:id/apply", requireAuth, rateLimit({
  keyFn: (req) => `job:apply:${req.user!.id}`,
  max: 10,
  windowMs: 60 * 60 * 1000,
}), upload.fields([
  { name: "photo", maxCount: 1 },
  { name: "cv", maxCount: 1 },
]), async (req, res) => {
  const jobId = Number(req.params.id);
  const job = await qGet("SELECT id FROM job_postings WHERE id = ? AND active = 1", jobId);
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

  let photoUrl: string | null = null;
  let cvUrl: string | null = null;

  if (files.photo?.[0]) {
    const photo = files.photo[0];
    const validated = validateUpload({
      kind: "jobPhoto",
      originalName: photo.originalname,
      declaredMime: photo.mimetype,
      buffer: photo.buffer,
      size: photo.size,
    });
    if (!validated.ok) {
      res.status(400).json({ error: validated.error });
      return;
    }
    photoUrl = (await persistMulterFile(photo, "job-photo", { contentType: validated.contentType })).url;
  }

  if (files.cv?.[0]) {
    const cv = files.cv[0];
    const validated = validateUpload({
      kind: "jobCv",
      originalName: cv.originalname,
      declaredMime: cv.mimetype,
      buffer: cv.buffer,
      size: cv.size,
    });
    if (!validated.ok) {
      res.status(400).json({ error: validated.error });
      return;
    }
    cvUrl = (await persistMulterFile(cv, "job-cv", { contentType: validated.contentType })).url;
  }

  await qRun(`
    INSERT INTO job_applications (job_id, user_id, full_name, gender, date_of_birth, country, city, photo_url, cv_url, portfolio_url, message, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, jobId, req.user!.id, fullName, gender || null, dateOfBirth || null, country || null, city || null, photoUrl, cvUrl, portfolioUrl || null, message || null, now());

  logActivitySync({ req, userId: req.user!.id, eventType: "application_submitted", eventCategory: "teamwork", description: `Submitted teamwork application for job #${jobId}`, affectedObject: `job_application:${jobId}` });

  res.status(201).json({ ok: true, message: "Application submitted" });
});

export default router;
