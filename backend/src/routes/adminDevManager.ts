import { Router } from "express";
import { qAll, qGet, qRun } from "../db/query.js";
import { logActivitySync } from "../services/activityLog.js";
import {
  DEFAULT_DEV_PROJECT_ID,
  ensureDevProjectSeeded,
  isValidTaskStatus,
  mapGoal,
  mapInstruction,
  mapTask,
  resolveProjectId,
  type InstructionPriority,
} from "../services/devManager.js";

const router = Router();
const now = () => new Date().toISOString();

function projectIdFromQuery(req: { query: Record<string, unknown>; body?: Record<string, unknown> }): string {
  const fromQuery = typeof req.query.projectId === "string" ? req.query.projectId : null;
  const fromBody = typeof req.body?.projectId === "string" ? req.body.projectId : null;
  return resolveProjectId(fromQuery || fromBody);
}

router.get("/dev-manager/overview", async (req, res) => {
  const projectId = projectIdFromQuery(req);
  await ensureDevProjectSeeded(projectId);

  const [instructions, goals, tasks, reports, release] = await Promise.all([
    qGet<{ c: number | string }>("SELECT COUNT(*) as c FROM dev_instructions WHERE project_id = ?", projectId),
    qGet<{ c: number | string }>("SELECT COUNT(*) as c FROM dev_goals WHERE project_id = ?", projectId),
    qGet<{ c: number | string }>("SELECT COUNT(*) as c FROM dev_tasks WHERE project_id = ?", projectId),
    qGet<{ c: number | string }>("SELECT COUNT(*) as c FROM dev_daily_reports WHERE project_id = ?", projectId),
    qGet<{ version: string; published_at: string | null }>(
      `SELECT version, published_at FROM dev_releases
       WHERE project_id = ? AND published = 1 ORDER BY published_at DESC, id DESC LIMIT 1`,
      projectId,
    ),
  ]);

  res.json({
    projectId,
    counts: {
      instructions: Number(instructions?.c || 0),
      goals: Number(goals?.c || 0),
      tasks: Number(tasks?.c || 0),
      reports: Number(reports?.c || 0),
    },
    latestRelease: release
      ? { version: release.version, publishedAt: release.published_at }
      : null,
  });
});

// —— Instructions ————————————————————————————————————————————————

router.get("/dev-manager/instructions", async (req, res) => {
  const projectId = projectIdFromQuery(req);
  await ensureDevProjectSeeded(projectId);
  const rows = await qAll<{
    id: number;
    title: string;
    body: string;
    from_name: string;
    created_at: string;
    priority: string;
  }>(
    `SELECT id, title, body, from_name, created_at, priority
     FROM dev_instructions WHERE project_id = ?
     ORDER BY created_at DESC, id DESC`,
    projectId,
  );
  res.json({
    instructions: rows.map((r) =>
      mapInstruction({ ...r, read_at: null }),
    ),
  });
});

router.post("/dev-manager/instructions", async (req, res) => {
  const projectId = projectIdFromQuery(req);
  await ensureDevProjectSeeded(projectId);
  const title = String(req.body?.title || "").trim();
  const body = String(req.body?.body || "").trim();
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  const priority: InstructionPriority =
    req.body?.priority === "urgent" ? "urgent" : "normal";
  const fromName = String(req.body?.from || req.body?.fromName || "Project Manager").trim().slice(0, 120);
  const ts = now();
  const result = await qRun(
    `INSERT INTO dev_instructions (project_id, title, body, from_name, priority, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    projectId,
    title.slice(0, 300),
    body.slice(0, 8000),
    fromName || "Project Manager",
    priority,
    ts,
    ts,
  );
  const id = Number(result.lastInsertRowid);
  logActivitySync({
    eventCategory: "dev_manager",
    eventType: "instruction_created",
    userId: req.user!.id,
    username: req.user!.username,
    description: title.slice(0, 80),
    affectedObject: `dev_instruction:${id}`,
  });
  res.status(201).json({
    instruction: mapInstruction({
      id,
      title,
      body,
      from_name: fromName || "Project Manager",
      created_at: ts,
      priority,
      read_at: null,
    }),
  });
});

router.delete("/dev-manager/instructions/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await qRun("DELETE FROM dev_instruction_reads WHERE instruction_id = ?", id);
  const result = await qRun("DELETE FROM dev_instructions WHERE id = ?", id);
  if (!result.changes) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ ok: true });
});

// —— Goals ——————————————————————————————————————————————————————

router.get("/dev-manager/goals", async (req, res) => {
  const projectId = projectIdFromQuery(req);
  await ensureDevProjectSeeded(projectId);
  const rows = await qAll<{
    id: number;
    title: string;
    description: string;
    due_date: string | null;
    progress: number;
  }>(
    `SELECT id, title, description, due_date, progress FROM dev_goals
     WHERE project_id = ? ORDER BY sort_order ASC, id ASC`,
    projectId,
  );
  res.json({ goals: rows.map(mapGoal) });
});

router.post("/dev-manager/goals", async (req, res) => {
  const projectId = projectIdFromQuery(req);
  await ensureDevProjectSeeded(projectId);
  const title = String(req.body?.title || "").trim();
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  const ts = now();
  const result = await qRun(
    `INSERT INTO dev_goals (project_id, title, description, due_date, progress, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    projectId,
    title.slice(0, 300),
    String(req.body?.description || "").trim().slice(0, 2000),
    req.body?.dueDate || req.body?.due_date || null,
    Math.max(0, Math.min(100, Number(req.body?.progress) || 0)),
    Number(req.body?.sortOrder) || 0,
    ts,
    ts,
  );
  const id = Number(result.lastInsertRowid);
  const row = await qGet<{
    id: number;
    title: string;
    description: string;
    due_date: string | null;
    progress: number;
  }>("SELECT id, title, description, due_date, progress FROM dev_goals WHERE id = ?", id);
  res.status(201).json({ goal: row ? mapGoal(row) : { id: String(id) } });
});

router.patch("/dev-manager/goals/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const existing = await qGet<{ id: number }>("SELECT id FROM dev_goals WHERE id = ?", id);
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const fields: string[] = [];
  const vals: unknown[] = [];
  if (req.body?.title != null) {
    fields.push("title = ?");
    vals.push(String(req.body.title).trim().slice(0, 300));
  }
  if (req.body?.description != null) {
    fields.push("description = ?");
    vals.push(String(req.body.description).trim().slice(0, 2000));
  }
  if (req.body?.dueDate != null || req.body?.due_date != null) {
    fields.push("due_date = ?");
    vals.push(req.body.dueDate ?? req.body.due_date);
  }
  if (req.body?.progress != null) {
    fields.push("progress = ?");
    vals.push(Math.max(0, Math.min(100, Number(req.body.progress) || 0)));
  }
  if (!fields.length) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  fields.push("updated_at = ?");
  vals.push(now());
  vals.push(id);
  await qRun(`UPDATE dev_goals SET ${fields.join(", ")} WHERE id = ?`, ...vals);
  res.json({ ok: true });
});

// —— Tasks ——————————————————————————————————————————————————————

router.get("/dev-manager/tasks", async (req, res) => {
  const projectId = projectIdFromQuery(req);
  await ensureDevProjectSeeded(projectId);
  const rows = await qAll<{
    id: number;
    title: string;
    status: string;
    assignee: string;
    priority: number;
    milestone: string | null;
    updated_at: string;
  }>(
    `SELECT id, title, status, assignee, priority, milestone, updated_at
     FROM dev_tasks WHERE project_id = ? ORDER BY priority ASC, id DESC`,
    projectId,
  );
  res.json({ tasks: rows.map(mapTask) });
});

router.post("/dev-manager/tasks", async (req, res) => {
  const projectId = projectIdFromQuery(req);
  await ensureDevProjectSeeded(projectId);
  const title = String(req.body?.title || "").trim();
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  const status = isValidTaskStatus(req.body?.status) ? req.body.status : "todo";
  const ts = now();
  const result = await qRun(
    `INSERT INTO dev_tasks (project_id, title, status, assignee, priority, milestone, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    projectId,
    title.slice(0, 300),
    status,
    String(req.body?.assignee || "").trim().slice(0, 120),
    Math.max(1, Math.min(5, Number(req.body?.priority) || 3)),
    req.body?.milestone ? String(req.body.milestone).trim().slice(0, 80) : null,
    ts,
    ts,
  );
  const id = Number(result.lastInsertRowid);
  const row = await qGet<{
    id: number;
    title: string;
    status: string;
    assignee: string;
    priority: number;
    milestone: string | null;
    updated_at: string;
  }>("SELECT id, title, status, assignee, priority, milestone, updated_at FROM dev_tasks WHERE id = ?", id);
  res.status(201).json({ task: row ? mapTask(row) : { id: String(id) } });
});

router.patch("/dev-manager/tasks/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const existing = await qGet<{ id: number }>("SELECT id FROM dev_tasks WHERE id = ?", id);
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const fields: string[] = [];
  const vals: unknown[] = [];
  if (req.body?.title != null) {
    fields.push("title = ?");
    vals.push(String(req.body.title).trim().slice(0, 300));
  }
  if (req.body?.status != null) {
    if (!isValidTaskStatus(req.body.status)) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }
    fields.push("status = ?");
    vals.push(req.body.status);
  }
  if (req.body?.assignee != null) {
    fields.push("assignee = ?");
    vals.push(String(req.body.assignee).trim().slice(0, 120));
  }
  if (req.body?.priority != null) {
    fields.push("priority = ?");
    vals.push(Math.max(1, Math.min(5, Number(req.body.priority) || 3)));
  }
  if (req.body?.milestone !== undefined) {
    fields.push("milestone = ?");
    vals.push(req.body.milestone ? String(req.body.milestone).trim().slice(0, 80) : null);
  }
  if (!fields.length) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  fields.push("updated_at = ?");
  vals.push(now());
  vals.push(id);
  await qRun(`UPDATE dev_tasks SET ${fields.join(", ")} WHERE id = ?`, ...vals);
  res.json({ ok: true });
});

router.delete("/dev-manager/tasks/:id", async (req, res) => {
  const id = Number(req.params.id);
  const result = await qRun("DELETE FROM dev_tasks WHERE id = ?", id);
  if (!result.changes) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ ok: true });
});

// —— Daily reports ——————————————————————————————————————————————

router.get("/dev-manager/reports", async (req, res) => {
  const projectId = projectIdFromQuery(req);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const rows = await qAll<{
    id: number;
    team_member_name: string;
    report_date: string;
    summary: string;
    completed: string;
    blockers: string;
    next_steps: string;
    hours_worked: number;
    status: string;
    submitted_at: string;
    user_id: number | null;
  }>(
    `SELECT id, team_member_name, report_date, summary, completed, blockers, next_steps,
            hours_worked, status, submitted_at, user_id
     FROM dev_daily_reports WHERE project_id = ?
     ORDER BY submitted_at DESC, id DESC
     LIMIT ?`,
    projectId,
    limit,
  );
  res.json({
    reports: rows.map((r) => ({
      id: `report-${r.id}`,
      date: r.report_date,
      summary: r.summary,
      completed: r.completed,
      blockers: r.blockers,
      nextSteps: r.next_steps,
      hoursWorked: Number(r.hours_worked) || 0,
      status: r.status,
      submittedAt: r.submitted_at,
      teamMemberName: r.team_member_name,
      userId: r.user_id,
    })),
  });
});

// —— Releases ———————————————————————————————————————————————————

router.get("/dev-manager/releases", async (req, res) => {
  const projectId = projectIdFromQuery(req);
  await ensureDevProjectSeeded(projectId);
  const rows = await qAll<{
    id: number;
    version: string;
    download_url: string;
    release_notes: string;
    checksum: string;
    published: number;
    published_at: string | null;
    created_at: string;
  }>(
    `SELECT id, version, download_url, release_notes, checksum, published, published_at, created_at
     FROM dev_releases WHERE project_id = ?
     ORDER BY published_at DESC, id DESC`,
    projectId,
  );
  res.json({
    releases: rows.map((r) => ({
      id: r.id,
      version: r.version,
      downloadUrl: r.download_url,
      releaseNotes: r.release_notes,
      checksum: r.checksum,
      published: r.published === 1,
      publishedAt: r.published_at,
      createdAt: r.created_at,
    })),
  });
});

router.post("/dev-manager/releases", async (req, res) => {
  const projectId = projectIdFromQuery(req);
  await ensureDevProjectSeeded(projectId);
  const version = String(req.body?.version || "").trim().replace(/^v/i, "");
  if (!version) {
    res.status(400).json({ error: "version is required" });
    return;
  }
  const ts = now();
  const publish =
    req.body?.published === true ||
    req.body?.published === 1 ||
    String(req.body?.published || "").toLowerCase() === "true";
  const result = await qRun(
    `INSERT INTO dev_releases (
      project_id, version, download_url, release_notes, checksum, published, published_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    projectId,
    version.slice(0, 64),
    String(req.body?.downloadUrl || req.body?.download_url || "").trim().slice(0, 2000),
    String(req.body?.releaseNotes || req.body?.release_notes || "").trim().slice(0, 8000),
    String(req.body?.checksum || "").trim().slice(0, 128),
    publish ? 1 : 0,
    publish ? (req.body?.publishedAt || ts) : null,
    ts,
    ts,
  );
  res.status(201).json({ id: Number(result.lastInsertRowid), ok: true });
});

router.patch("/dev-manager/releases/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const existing = await qGet<{ id: number }>("SELECT id FROM dev_releases WHERE id = ?", id);
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const fields: string[] = [];
  const vals: unknown[] = [];
  if (req.body?.version != null) {
    fields.push("version = ?");
    vals.push(String(req.body.version).trim().replace(/^v/i, "").slice(0, 64));
  }
  if (req.body?.downloadUrl != null || req.body?.download_url != null) {
    fields.push("download_url = ?");
    vals.push(String(req.body.downloadUrl ?? req.body.download_url).trim().slice(0, 2000));
  }
  if (req.body?.releaseNotes != null || req.body?.release_notes != null) {
    fields.push("release_notes = ?");
    vals.push(String(req.body.releaseNotes ?? req.body.release_notes).trim().slice(0, 8000));
  }
  if (req.body?.checksum != null) {
    fields.push("checksum = ?");
    vals.push(String(req.body.checksum).trim().slice(0, 128));
  }
  if (req.body?.published != null) {
    const publish =
      req.body.published === true ||
      req.body.published === 1 ||
      String(req.body.published).toLowerCase() === "true";
    fields.push("published = ?");
    vals.push(publish ? 1 : 0);
    if (publish) {
      fields.push("published_at = ?");
      vals.push(req.body.publishedAt || now());
    }
  }
  if (!fields.length) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  fields.push("updated_at = ?");
  vals.push(now());
  vals.push(id);
  await qRun(`UPDATE dev_releases SET ${fields.join(", ")} WHERE id = ?`, ...vals);
  res.json({ ok: true });
});

// —— Sprint / build / risks (status board) ——————————————————————

router.patch("/dev-manager/sprint", async (req, res) => {
  const projectId = projectIdFromQuery(req);
  await ensureDevProjectSeeded(projectId);
  const sprint = await qGet<{ id: number }>(
    "SELECT id FROM dev_sprints WHERE project_id = ? AND is_current = 1 ORDER BY id DESC LIMIT 1",
    projectId,
  );
  if (!sprint) {
    res.status(404).json({ error: "No current sprint" });
    return;
  }
  const fields: string[] = [];
  const vals: unknown[] = [];
  if (req.body?.name != null) {
    fields.push("name = ?");
    vals.push(String(req.body.name).trim().slice(0, 200));
  }
  if (req.body?.day != null) {
    fields.push("day = ?");
    vals.push(Math.max(0, Number(req.body.day) || 0));
  }
  if (req.body?.totalDays != null || req.body?.total_days != null) {
    fields.push("total_days = ?");
    vals.push(Math.max(1, Number(req.body.totalDays ?? req.body.total_days) || 14));
  }
  if (req.body?.progress != null) {
    fields.push("progress = ?");
    vals.push(Math.max(0, Math.min(100, Number(req.body.progress) || 0)));
  }
  if (req.body?.remainingPoints != null || req.body?.remaining_points != null) {
    fields.push("remaining_points = ?");
    vals.push(Math.max(0, Number(req.body.remainingPoints ?? req.body.remaining_points) || 0));
  }
  if (Array.isArray(req.body?.burndown)) {
    fields.push("burndown_json = ?");
    vals.push(JSON.stringify(req.body.burndown.map((n: unknown) => Number(n) || 0)));
  }
  if (!fields.length) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  fields.push("updated_at = ?");
  vals.push(now());
  vals.push(sprint.id);
  await qRun(`UPDATE dev_sprints SET ${fields.join(", ")} WHERE id = ?`, ...vals);
  res.json({ ok: true });
});

router.patch("/dev-manager/build-status", async (req, res) => {
  const projectId = projectIdFromQuery(req);
  await ensureDevProjectSeeded(projectId);
  const ts = now();
  const existing = await qGet<{ project_id: string }>(
    "SELECT project_id FROM dev_build_status WHERE project_id = ?",
    projectId,
  );
  const status = String(req.body?.status || "Unknown").trim().slice(0, 80);
  const pipeline = String(req.body?.pipeline || "main").trim().slice(0, 80);
  const duration = String(req.body?.duration || "").trim().slice(0, 40);
  const lastBuild = req.body?.lastBuild || req.body?.last_build || ts;
  if (existing) {
    await qRun(
      `UPDATE dev_build_status SET status = ?, pipeline = ?, duration = ?, last_build = ?, updated_at = ?
       WHERE project_id = ?`,
      status,
      pipeline,
      duration,
      lastBuild,
      ts,
      projectId,
    );
  } else {
    await qRun(
      `INSERT INTO dev_build_status (project_id, status, pipeline, duration, last_build, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      projectId,
      status,
      pipeline,
      duration,
      lastBuild,
      ts,
    );
  }
  res.json({ ok: true });
});

router.get("/dev-manager/meta", async (_req, res) => {
  res.json({
    defaultProjectId: DEFAULT_DEV_PROJECT_ID,
    taskStatuses: ["todo", "in_progress", "review", "done", "blocked"],
    instructionPriorities: ["normal", "urgent"],
  });
});

export default router;
