import { Router } from "express";
import { optionalAuth } from "../middleware/auth.js";
import { rateLimit, clientIp } from "../middleware/rateLimit.js";
import { storeUploadedFile } from "../storage/index.js";
import { logActivitySync } from "../services/activityLog.js";
import {
  createDailyReport,
  findReportIdForAttachment,
  addReportAttachment,
  getBuildStatus,
  getDevStatus,
  getLatestRelease,
  getSprintInfo,
  isValidTaskStatus,
  listGoals,
  listInstructions,
  listTasks,
  markInstructionRead,
  normalizeMemberKey,
  resolveProjectId,
  updateTaskStatus,
} from "../services/devManager.js";

const router = Router();

function projectIdFrom(req: import("express").Request): string {
  return resolveProjectId(
    (req.headers["x-project-id"] as string) ||
      (typeof req.query.projectId === "string" ? req.query.projectId : null),
  );
}

function teamMemberNameFrom(req: import("express").Request): string {
  const header = String(req.headers["x-team-member"] || "").trim();
  if (header) return header.slice(0, 120);
  return String(req.user?.username || "").slice(0, 120);
}

function memberKeyFrom(req: import("express").Request): string {
  return normalizeMemberKey(teamMemberNameFrom(req));
}

function readContext(req: import("express").Request) {
  return req.user?.id
    ? { userId: req.user.id, memberKey: memberKeyFrom(req) }
    : { userId: null, memberKey: memberKeyFrom(req) };
}

/** Extension APIs are public; optionalAuth attaches a user when a token is sent. */
router.use(optionalAuth);

router.get("/instructions", async (req, res) => {
  const projectId = projectIdFrom(req);
  const ctx = readContext(req);
  const instructions = await listInstructions(projectId, ctx);
  res.json(instructions);
});

router.post("/instructions/:id/read", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Invalid instruction id" });
    return;
  }
  await markInstructionRead(id, readContext(req));
  res.json({ ok: true });
});

router.get("/goals", async (req, res) => {
  const goals = await listGoals(projectIdFrom(req));
  res.json(goals);
});

router.get("/tasks", async (req, res) => {
  const tasks = await listTasks(projectIdFrom(req));
  res.json(tasks);
});

router.patch("/tasks/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Invalid task id" });
    return;
  }
  const status = req.body?.status;
  if (!isValidTaskStatus(status)) {
    res.status(400).json({ error: "Invalid status. Use todo, in_progress, review, done, or blocked." });
    return;
  }
  const task = await updateTaskStatus(projectIdFrom(req), id, status);
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json(task);
});

router.get("/dev-status", async (req, res) => {
  const status = await getDevStatus(projectIdFrom(req));
  res.json(status);
});

router.get("/releases/latest", async (req, res) => {
  const release = await getLatestRelease(projectIdFrom(req));
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.json(release);
});

router.get("/sprint", async (req, res) => {
  res.json(await getSprintInfo(projectIdFrom(req)));
});

router.get("/build-status", async (req, res) => {
  res.json(await getBuildStatus(projectIdFrom(req)));
});

router.post(
  "/daily-reports",
  rateLimit({
    keyFn: (req) => `dev-report:${clientIp(req)}:${memberKeyFrom(req)}`,
    max: 30,
    windowMs: 60 * 60 * 1000,
  }),
  async (req, res) => {
    const body = req.body || {};
    const summary = String(body.summary || "").trim();
    const nextSteps = String(body.nextSteps || body.next_steps || "").trim();
    if (!summary) {
      res.status(400).json({ error: "summary is required" });
      return;
    }
    if (!nextSteps) {
      res.status(400).json({ error: "nextSteps is required" });
      return;
    }

    const dateRaw = String(body.date || "").trim();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw)
      ? dateRaw
      : new Date().toISOString().slice(0, 10);

    const hoursWorked = Math.max(0, Math.min(24, Number(body.hoursWorked ?? body.hours_worked) || 0));
    const projectId = projectIdFrom(req);
    const teamMemberName = teamMemberNameFrom(req);

    const report = await createDailyReport({
      projectId,
      userId: req.user?.id ?? null,
      teamMemberName,
      date,
      summary: summary.slice(0, 4000),
      completed: String(body.completed || "").trim().slice(0, 8000),
      blockers: String(body.blockers || "").trim().slice(0, 4000),
      nextSteps: nextSteps.slice(0, 4000),
      hoursWorked,
      status: body.status,
    });

    logActivitySync({
      eventCategory: "dev_manager",
      eventType: "daily_report_submitted",
      userId: req.user?.id ?? null,
      username: req.user?.username ?? teamMemberName,
      description: `${teamMemberName}: ${summary.slice(0, 80)}`,
      affectedObject: `dev_daily_report:${report.id}`,
    });

    res.status(201).json(report);
  },
);

router.post(
  "/daily-reports/upload",
  rateLimit({
    keyFn: (req) => `dev-report-upload:${clientIp(req)}:${memberKeyFrom(req)}`,
    max: 20,
    windowMs: 60 * 60 * 1000,
  }),
  async (req, res) => {
    const body = req.body || {};
    const fileName = String(body.fileName || body.file_name || "").trim().slice(0, 255);
    const fileContent = String(body.fileContent || body.file_content || "");
    const reportIdRaw = String(body.reportId || body.report_id || "").trim();

    if (!fileName || !fileContent) {
      res.status(400).json({ error: "fileName and fileContent are required" });
      return;
    }

    const allowed = /\.(txt|md|pdf|doc|docx|zip)$/i.test(fileName);
    if (!allowed) {
      res.status(400).json({ error: "Unsupported file type. Allowed: txt, md, pdf, doc, docx, zip" });
      return;
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(fileContent, "base64");
    } catch {
      res.status(400).json({ error: "Invalid base64 fileContent" });
      return;
    }
    if (!buffer.length) {
      res.status(400).json({ error: "Empty file" });
      return;
    }
    if (buffer.length > 10 * 1024 * 1024) {
      res.status(413).json({ error: "File too large (max 10MB)", code: "FILE_TOO_LARGE" });
      return;
    }

    const projectId = projectIdFrom(req);
    const teamMemberName = teamMemberNameFrom(req);
    const reportId = await findReportIdForAttachment({
      reportIdRaw,
      userId: req.user?.id ?? null,
      teamMemberName,
      projectId,
    });
    if (!reportId) {
      res.status(404).json({ error: "Report not found for attachment" });
      return;
    }

    const stored = await storeUploadedFile({
      buffer,
      originalname: fileName,
      mimetype: "application/octet-stream",
      prefix: "dev-reports",
    });

    await addReportAttachment(reportId, fileName, stored.url, stored.size);

    logActivitySync({
      eventCategory: "dev_manager",
      eventType: "daily_report_attachment",
      userId: req.user?.id ?? null,
      username: req.user?.username ?? teamMemberName,
      description: fileName,
      affectedObject: `dev_daily_report:${reportId}`,
    });

    res.json({ ok: true, fileUrl: stored.url });
  },
);

export default router;
