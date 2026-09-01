import { qAll, qGet, qRun } from "../db/query.js";

export const DEFAULT_DEV_PROJECT_ID = "ninja-era";

export const TASK_STATUSES = ["todo", "in_progress", "review", "done", "blocked"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const INSTRUCTION_PRIORITIES = ["normal", "urgent"] as const;
export type InstructionPriority = (typeof INSTRUCTION_PRIORITIES)[number];

const now = () => new Date().toISOString();

function parseJsonArray(raw: string | null | undefined, fallback: number[] = []): number[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((n) => Number(n) || 0) : fallback;
  } catch {
    return fallback;
  }
}

function clampProgress(n: unknown): number {
  const v = Math.round(Number(n) || 0);
  return Math.max(0, Math.min(100, v));
}

export function resolveProjectId(headerOrQuery?: string | null): string {
  const id = String(headerOrQuery || "").trim();
  return id || DEFAULT_DEV_PROJECT_ID;
}

export function isValidTaskStatus(status: unknown): status is TaskStatus {
  return typeof status === "string" && (TASK_STATUSES as readonly string[]).includes(status);
}

/** Ensure the default project exists with sample board data when empty. */
export async function ensureDevProjectSeeded(projectId = DEFAULT_DEV_PROJECT_ID): Promise<void> {
  const existing = await qGet<{ id: string }>("SELECT id FROM dev_projects WHERE id = ?", projectId);
  const ts = now();

  if (!existing) {
    await qRun(
      "INSERT INTO dev_projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
      projectId,
      "Ninja Era",
      ts,
      ts,
    );
  }

  const taskCount = await qGet<{ c: number | string }>(
    "SELECT COUNT(*) as c FROM dev_tasks WHERE project_id = ?",
    projectId,
  );
  if (Number(taskCount?.c || 0) > 0) return;

  const instructions = [
    {
      title: "Complete combat system balance pass",
      body: "Review damage values for all jutsu types. Target 2-second TTK for standard enemies. Document changes in the balance spreadsheet.",
      priority: "urgent",
      hoursAgo: 1,
    },
    {
      title: "Submit weekly build for QA",
      body: "Please submit a staging build by Friday EOD. Include release notes for all features merged this sprint.",
      priority: "normal",
      hoursAgo: 24,
    },
  ];
  for (const inst of instructions) {
    const created = new Date(Date.now() - inst.hoursAgo * 3600000).toISOString();
    await qRun(
      `INSERT INTO dev_instructions (project_id, title, body, from_name, priority, created_at, updated_at)
       VALUES (?, ?, ?, 'Project Manager', ?, ?, ?)`,
      projectId,
      inst.title,
      inst.body,
      inst.priority,
      created,
      created,
    );
  }

  const goals = [
    {
      title: "Ship v0.3.0 — Multiplayer Beta",
      description: "Complete netcode integration and lobby system",
      days: 14,
      progress: 62,
    },
    {
      title: "Performance: 60fps on mid-range hardware",
      description: "Optimize draw calls and particle systems",
      days: 21,
      progress: 45,
    },
    {
      title: "Localization — JP/EN/KR",
      description: "Complete string extraction and translation review",
      days: 30,
      progress: 30,
    },
  ];
  for (let i = 0; i < goals.length; i++) {
    const g = goals[i];
    const due = new Date(Date.now() + g.days * 86400000).toISOString();
    await qRun(
      `INSERT INTO dev_goals (project_id, title, description, due_date, progress, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      projectId,
      g.title,
      g.description,
      due,
      g.progress,
      i,
      ts,
      ts,
    );
  }

  const tasks: Array<{
    title: string;
    status: TaskStatus;
    assignee: string;
    priority: number;
    milestone: string;
  }> = [
    { title: "Implement shadow clone jutsu VFX", status: "in_progress", assignee: "Alex", priority: 1, milestone: "v0.3.0" },
    { title: "Fix hitbox desync in PvP", status: "blocked", assignee: "Jordan", priority: 1, milestone: "v0.3.0" },
    { title: "Design new Hidden Leaf map", status: "review", assignee: "Sam", priority: 2, milestone: "v0.3.0" },
    { title: "Write unit tests for inventory system", status: "todo", assignee: "Alex", priority: 3, milestone: "v0.3.0" },
    { title: "Optimize texture atlas packing", status: "done", assignee: "Taylor", priority: 2, milestone: "v0.2.5" },
    { title: "Integrate Steam achievements", status: "in_progress", assignee: "Jordan", priority: 2, milestone: "v0.3.0" },
  ];
  for (const t of tasks) {
    await qRun(
      `INSERT INTO dev_tasks (project_id, title, status, assignee, priority, milestone, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      projectId,
      t.title,
      t.status,
      t.assignee,
      t.priority,
      t.milestone,
      ts,
      ts,
    );
  }

  await qRun(
    `INSERT INTO dev_sprints (project_id, name, day, total_days, progress, remaining_points, burndown_json, is_current, created_at, updated_at)
     VALUES (?, ?, 8, 14, 62, 23, ?, 1, ?, ?)`,
    projectId,
    "Sprint 12 — Multiplayer Beta",
    JSON.stringify([40, 38, 36, 33, 30, 28, 25, 23]),
    ts,
    ts,
  );

  const milestones = [
    { name: "Alpha Release", status: "done", progress: 100, due: "2026-06-01" },
    { name: "Multiplayer Beta", status: "active", progress: 62, due: "2026-09-15" },
    { name: "Public Launch", status: "pending", progress: 15, due: "2026-12-01" },
  ];
  for (let i = 0; i < milestones.length; i++) {
    const m = milestones[i];
    await qRun(
      `INSERT INTO dev_milestones (project_id, name, status, progress, due_date, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      projectId,
      m.name,
      m.status,
      m.progress,
      m.due,
      i,
      ts,
      ts,
    );
  }

  const envs = [
    { name: "Development", status: "up" },
    { name: "Staging", status: "up" },
    { name: "Production", status: "up" },
  ];
  for (let i = 0; i < envs.length; i++) {
    await qRun(
      `INSERT INTO dev_environments (project_id, name, status, sort_order, updated_at) VALUES (?, ?, ?, ?, ?)`,
      projectId,
      envs[i].name,
      envs[i].status,
      i,
      ts,
    );
  }

  await qRun(
    `INSERT INTO dev_risks (project_id, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    projectId,
    "Netcode latency on cross-region",
    "Players in EU reporting 200ms+ latency in PvP matches",
    ts,
    ts,
  );

  await qRun(
    `INSERT INTO dev_build_status (project_id, status, pipeline, duration, last_build, updated_at)
     VALUES (?, 'Passing', 'main', '4m 32s', ?, ?)`,
    projectId,
    ts,
    ts,
  );

  await qRun(
    `INSERT INTO dev_velocity (project_id, points_json, updated_at) VALUES (?, ?, ?)`,
    projectId,
    JSON.stringify([5, 7, 6, 8, 7, 9, 8]),
    ts,
  );

  const notes =
    "v0.3.0-beta.2\n\n- Multiplayer lobby system\n- Shadow clone jutsu prototype\n- Performance improvements\n- Bug fixes for inventory desync";
  await qRun(
    `INSERT INTO dev_releases (project_id, version, download_url, release_notes, checksum, published, published_at, created_at, updated_at)
     VALUES (?, '0.3.0-beta.2', '', ?, '', 1, ?, ?, ?)`,
    projectId,
    notes,
    ts,
    ts,
    ts,
  );
}

type InstructionRow = {
  id: number;
  title: string;
  body: string;
  from_name: string;
  created_at: string;
  priority: string;
  read_at: string | null;
};

export function mapInstruction(row: InstructionRow) {
  return {
    id: String(row.id),
    title: row.title,
    body: row.body,
    from: row.from_name,
    receivedAt: row.created_at,
    read: !!row.read_at,
    priority: row.priority === "urgent" ? "urgent" : "normal",
  };
}

export async function listInstructions(projectId: string, userId: number) {
  await ensureDevProjectSeeded(projectId);
  const rows = await qAll<InstructionRow>(
    `SELECT i.id, i.title, i.body, i.from_name, i.created_at, i.priority, r.read_at
     FROM dev_instructions i
     LEFT JOIN dev_instruction_reads r ON r.instruction_id = i.id AND r.user_id = ?
     WHERE i.project_id = ?
     ORDER BY i.created_at DESC, i.id DESC`,
    userId,
    projectId,
  );
  return rows.map(mapInstruction);
}

export async function markInstructionRead(instructionId: number, userId: number) {
  const ts = now();
  const existing = await qGet<{ instruction_id: number }>(
    "SELECT instruction_id FROM dev_instruction_reads WHERE instruction_id = ? AND user_id = ?",
    instructionId,
    userId,
  );
  if (existing) {
    await qRun(
      "UPDATE dev_instruction_reads SET read_at = ? WHERE instruction_id = ? AND user_id = ?",
      ts,
      instructionId,
      userId,
    );
  } else {
    await qRun(
      "INSERT INTO dev_instruction_reads (instruction_id, user_id, read_at) VALUES (?, ?, ?)",
      instructionId,
      userId,
      ts,
    );
  }
}

type GoalRow = {
  id: number;
  title: string;
  description: string;
  due_date: string | null;
  progress: number;
};

export function mapGoal(row: GoalRow) {
  return {
    id: String(row.id),
    title: row.title,
    description: row.description || "",
    dueDate: row.due_date || null,
    progress: clampProgress(row.progress),
  };
}

export async function listGoals(projectId: string) {
  await ensureDevProjectSeeded(projectId);
  const rows = await qAll<GoalRow>(
    `SELECT id, title, description, due_date, progress
     FROM dev_goals WHERE project_id = ?
     ORDER BY sort_order ASC, id ASC`,
    projectId,
  );
  return rows.map(mapGoal);
}

type TaskRow = {
  id: number;
  title: string;
  status: string;
  assignee: string;
  priority: number;
  milestone: string | null;
  updated_at: string;
};

export function mapTask(row: TaskRow) {
  return {
    id: String(row.id),
    title: row.title,
    status: isValidTaskStatus(row.status) ? row.status : "todo",
    assignee: row.assignee || "",
    priority: Number(row.priority) || 3,
    milestone: row.milestone || undefined,
    updatedAt: row.updated_at,
  };
}

export async function listTasks(projectId: string) {
  await ensureDevProjectSeeded(projectId);
  const rows = await qAll<TaskRow>(
    `SELECT id, title, status, assignee, priority, milestone, updated_at
     FROM dev_tasks WHERE project_id = ?
     ORDER BY priority ASC, updated_at DESC, id DESC`,
    projectId,
  );
  return rows.map(mapTask);
}

export async function updateTaskStatus(projectId: string, taskId: number, status: TaskStatus) {
  const ts = now();
  const result = await qRun(
    "UPDATE dev_tasks SET status = ?, updated_at = ? WHERE id = ? AND project_id = ?",
    status,
    ts,
    taskId,
    projectId,
  );
  if (!result.changes) return null;
  const row = await qGet<TaskRow>(
    "SELECT id, title, status, assignee, priority, milestone, updated_at FROM dev_tasks WHERE id = ?",
    taskId,
  );
  return row ? mapTask(row) : null;
}

export async function getLatestRelease(projectId: string) {
  await ensureDevProjectSeeded(projectId);
  const row = await qGet<{
    version: string;
    download_url: string;
    release_notes: string;
    checksum: string;
    published_at: string | null;
  }>(
    `SELECT version, download_url, release_notes, checksum, published_at
     FROM dev_releases
     WHERE project_id = ? AND published = 1
     ORDER BY published_at DESC, id DESC
     LIMIT 1`,
    projectId,
  );
  if (!row) {
    return {
      version: "0.0.0",
      downloadUrl: "",
      releaseNotes: "",
      publishedAt: now(),
      checksum: "",
    };
  }
  return {
    version: row.version,
    downloadUrl: row.download_url || "",
    releaseNotes: row.release_notes || "",
    publishedAt: row.published_at || now(),
    checksum: row.checksum || "",
  };
}

export async function getDevStatus(projectId: string) {
  await ensureDevProjectSeeded(projectId);

  const sprint = await qGet<{
    name: string;
    day: number;
    progress: number;
    remaining_points: number;
    burndown_json: string;
  }>(
    `SELECT name, day, progress, remaining_points, burndown_json
     FROM dev_sprints WHERE project_id = ? AND is_current = 1
     ORDER BY id DESC LIMIT 1`,
    projectId,
  );

  const build = await qGet<{ status: string; last_build: string | null }>(
    "SELECT status, last_build FROM dev_build_status WHERE project_id = ?",
    projectId,
  );

  const milestones = await qAll<{
    name: string;
    status: string;
    progress: number;
    due_date: string | null;
  }>(
    `SELECT name, status, progress, due_date FROM dev_milestones
     WHERE project_id = ? ORDER BY sort_order ASC, id ASC`,
    projectId,
  );

  const velocityRow = await qGet<{ points_json: string }>(
    "SELECT points_json FROM dev_velocity WHERE project_id = ?",
    projectId,
  );

  const environments = await qAll<{ name: string; status: string }>(
    `SELECT name, status FROM dev_environments
     WHERE project_id = ? ORDER BY sort_order ASC, id ASC`,
    projectId,
  );

  const risks = await qAll<{ title: string; description: string }>(
    `SELECT title, description FROM dev_risks WHERE project_id = ? ORDER BY id DESC`,
    projectId,
  );

  const release = await getLatestRelease(projectId);

  return {
    sprint: {
      name: sprint?.name || "No active sprint",
      day: Number(sprint?.day) || 0,
      progress: clampProgress(sprint?.progress),
      remainingPoints: Number(sprint?.remaining_points) || 0,
      burndown: parseJsonArray(sprint?.burndown_json),
    },
    build: {
      status: build?.status || "Unknown",
      lastBuild: build?.last_build || null,
    },
    milestones: milestones.map((m) => ({
      name: m.name,
      status: m.status,
      progress: clampProgress(m.progress),
      dueDate: m.due_date || null,
    })),
    velocity: parseJsonArray(velocityRow?.points_json),
    environments: environments.map((e) => ({
      name: e.name,
      status: e.status,
    })),
    risks: risks.map((r) => ({
      title: r.title,
      description: r.description || "",
    })),
    releaseNotes: release.releaseNotes,
  };
}

export async function getSprintInfo(projectId: string) {
  await ensureDevProjectSeeded(projectId);
  const sprint = await qGet<{
    name: string;
    day: number;
    total_days: number;
    progress: number;
  }>(
    `SELECT name, day, total_days, progress FROM dev_sprints
     WHERE project_id = ? AND is_current = 1 ORDER BY id DESC LIMIT 1`,
    projectId,
  );
  return {
    name: sprint?.name || "No active sprint",
    day: Number(sprint?.day) || 0,
    totalDays: Number(sprint?.total_days) || 14,
    progress: clampProgress(sprint?.progress),
  };
}

export async function getBuildStatus(projectId: string) {
  await ensureDevProjectSeeded(projectId);
  const build = await qGet<{
    status: string;
    pipeline: string;
    duration: string;
    last_build: string | null;
  }>("SELECT status, pipeline, duration, last_build FROM dev_build_status WHERE project_id = ?", projectId);
  return {
    status: build?.status || "Unknown",
    pipeline: build?.pipeline || "main",
    duration: build?.duration || "",
    lastBuild: build?.last_build || null,
  };
}

export async function createDailyReport(input: {
  projectId: string;
  userId: number | null;
  teamMemberName: string;
  date: string;
  summary: string;
  completed: string;
  blockers: string;
  nextSteps: string;
  hoursWorked: number;
  status?: string;
}) {
  const submittedAt = now();
  const result = await qRun(
    `INSERT INTO dev_daily_reports (
      project_id, user_id, team_member_name, report_date, summary, completed,
      blockers, next_steps, hours_worked, status, submitted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.projectId,
    input.userId,
    input.teamMemberName,
    input.date,
    input.summary,
    input.completed,
    input.blockers,
    input.nextSteps,
    input.hoursWorked,
    input.status === "draft" ? "draft" : "sent",
    submittedAt,
  );
  const id = Number(result.lastInsertRowid);
  return {
    id: `report-${id}`,
    date: input.date,
    summary: input.summary,
    completed: input.completed,
    blockers: input.blockers,
    nextSteps: input.nextSteps,
    hoursWorked: input.hoursWorked,
    status: input.status === "draft" ? "draft" : "sent",
    submittedAt,
  };
}

export async function findReportIdForAttachment(opts: {
  reportIdRaw: string;
  userId: number;
  projectId: string;
}): Promise<number | null> {
  const raw = String(opts.reportIdRaw || "").trim();
  if (!raw) return null;

  // Prefer explicit report-{numericId} or bare numeric id
  const numericMatch = raw.match(/^(?:report-)?(\d+)$/);
  if (numericMatch) {
    const id = Number(numericMatch[1]);
    const row = await qGet<{ id: number }>(
      "SELECT id FROM dev_daily_reports WHERE id = ? AND project_id = ?",
      id,
      opts.projectId,
    );
    return row?.id ?? null;
  }

  // Extension historically sent YYYY-MM-DD — attach to latest report that day by this user
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const row = await qGet<{ id: number }>(
      `SELECT id FROM dev_daily_reports
       WHERE project_id = ? AND report_date = ? AND user_id = ?
       ORDER BY id DESC LIMIT 1`,
      opts.projectId,
      raw,
      opts.userId,
    );
    return row?.id ?? null;
  }

  return null;
}

export async function addReportAttachment(reportId: number, fileName: string, fileUrl: string, fileSize: number) {
  const ts = now();
  const result = await qRun(
    `INSERT INTO dev_report_attachments (report_id, file_name, file_url, file_size, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    reportId,
    fileName,
    fileUrl,
    fileSize,
    ts,
  );
  return Number(result.lastInsertRowid);
}
