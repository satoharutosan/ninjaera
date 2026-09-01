import type { Migration } from "./runner.js";

/**
 * Dev Manager (Chrome extension) tables — team progress, instructions,
 * sprint board, daily reports, and internal game release metadata.
 * Prefixed `dev_` to avoid colliding with moderation `reports` and
 * public `game_downloads`.
 */
const SQLITE_DDL = `
CREATE TABLE IF NOT EXISTS dev_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dev_instructions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  from_name TEXT NOT NULL DEFAULT 'Project Manager',
  priority TEXT NOT NULL DEFAULT 'normal',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dev_instructions_project ON dev_instructions(project_id, created_at);

CREATE TABLE IF NOT EXISTS dev_instruction_reads (
  instruction_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (instruction_id, user_id)
);

CREATE TABLE IF NOT EXISTS dev_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  due_date TEXT,
  progress INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dev_goals_project ON dev_goals(project_id, sort_order);

CREATE TABLE IF NOT EXISTS dev_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  assignee TEXT NOT NULL DEFAULT '',
  assignee_user_id INTEGER,
  priority INTEGER NOT NULL DEFAULT 3,
  milestone TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dev_tasks_project ON dev_tasks(project_id, status);

CREATE TABLE IF NOT EXISTS dev_daily_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  user_id INTEGER,
  team_member_name TEXT NOT NULL DEFAULT '',
  report_date TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  completed TEXT NOT NULL DEFAULT '',
  blockers TEXT NOT NULL DEFAULT '',
  next_steps TEXT NOT NULL DEFAULT '',
  hours_worked REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'sent',
  submitted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dev_daily_reports_project ON dev_daily_reports(project_id, report_date);
CREATE INDEX IF NOT EXISTS idx_dev_daily_reports_user ON dev_daily_reports(user_id, report_date);

CREATE TABLE IF NOT EXISTS dev_report_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dev_report_attachments_report ON dev_report_attachments(report_id);

CREATE TABLE IF NOT EXISTS dev_sprints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  day INTEGER NOT NULL DEFAULT 1,
  total_days INTEGER NOT NULL DEFAULT 14,
  progress INTEGER NOT NULL DEFAULT 0,
  remaining_points INTEGER NOT NULL DEFAULT 0,
  burndown_json TEXT NOT NULL DEFAULT '[]',
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dev_sprints_project ON dev_sprints(project_id, is_current);

CREATE TABLE IF NOT EXISTS dev_milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  progress INTEGER NOT NULL DEFAULT 0,
  due_date TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dev_milestones_project ON dev_milestones(project_id, sort_order);

CREATE TABLE IF NOT EXISTS dev_environments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'up',
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dev_environments_project ON dev_environments(project_id);

CREATE TABLE IF NOT EXISTS dev_risks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dev_risks_project ON dev_risks(project_id);

CREATE TABLE IF NOT EXISTS dev_build_status (
  project_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'Unknown',
  pipeline TEXT NOT NULL DEFAULT 'main',
  duration TEXT NOT NULL DEFAULT '',
  last_build TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dev_velocity (
  project_id TEXT PRIMARY KEY,
  points_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dev_releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  version TEXT NOT NULL,
  download_url TEXT NOT NULL DEFAULT '',
  release_notes TEXT NOT NULL DEFAULT '',
  checksum TEXT NOT NULL DEFAULT '',
  published INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dev_releases_project ON dev_releases(project_id, published, published_at);
`;

const POSTGRES_DDL = `
CREATE TABLE IF NOT EXISTS dev_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dev_instructions (
  id BIGSERIAL PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  from_name TEXT NOT NULL DEFAULT 'Project Manager',
  priority TEXT NOT NULL DEFAULT 'normal',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dev_instructions_project ON dev_instructions(project_id, created_at);

CREATE TABLE IF NOT EXISTS dev_instruction_reads (
  instruction_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (instruction_id, user_id)
);

CREATE TABLE IF NOT EXISTS dev_goals (
  id BIGSERIAL PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  due_date TEXT,
  progress INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dev_goals_project ON dev_goals(project_id, sort_order);

CREATE TABLE IF NOT EXISTS dev_tasks (
  id BIGSERIAL PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  assignee TEXT NOT NULL DEFAULT '',
  assignee_user_id BIGINT,
  priority INTEGER NOT NULL DEFAULT 3,
  milestone TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dev_tasks_project ON dev_tasks(project_id, status);

CREATE TABLE IF NOT EXISTS dev_daily_reports (
  id BIGSERIAL PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id BIGINT,
  team_member_name TEXT NOT NULL DEFAULT '',
  report_date TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  completed TEXT NOT NULL DEFAULT '',
  blockers TEXT NOT NULL DEFAULT '',
  next_steps TEXT NOT NULL DEFAULT '',
  hours_worked DOUBLE PRECISION NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'sent',
  submitted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dev_daily_reports_project ON dev_daily_reports(project_id, report_date);
CREATE INDEX IF NOT EXISTS idx_dev_daily_reports_user ON dev_daily_reports(user_id, report_date);

CREATE TABLE IF NOT EXISTS dev_report_attachments (
  id BIGSERIAL PRIMARY KEY,
  report_id BIGINT NOT NULL,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dev_report_attachments_report ON dev_report_attachments(report_id);

CREATE TABLE IF NOT EXISTS dev_sprints (
  id BIGSERIAL PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  day INTEGER NOT NULL DEFAULT 1,
  total_days INTEGER NOT NULL DEFAULT 14,
  progress INTEGER NOT NULL DEFAULT 0,
  remaining_points INTEGER NOT NULL DEFAULT 0,
  burndown_json TEXT NOT NULL DEFAULT '[]',
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dev_sprints_project ON dev_sprints(project_id, is_current);

CREATE TABLE IF NOT EXISTS dev_milestones (
  id BIGSERIAL PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  progress INTEGER NOT NULL DEFAULT 0,
  due_date TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dev_milestones_project ON dev_milestones(project_id, sort_order);

CREATE TABLE IF NOT EXISTS dev_environments (
  id BIGSERIAL PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'up',
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dev_environments_project ON dev_environments(project_id);

CREATE TABLE IF NOT EXISTS dev_risks (
  id BIGSERIAL PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dev_risks_project ON dev_risks(project_id);

CREATE TABLE IF NOT EXISTS dev_build_status (
  project_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'Unknown',
  pipeline TEXT NOT NULL DEFAULT 'main',
  duration TEXT NOT NULL DEFAULT '',
  last_build TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dev_velocity (
  project_id TEXT PRIMARY KEY,
  points_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dev_releases (
  id BIGSERIAL PRIMARY KEY,
  project_id TEXT NOT NULL,
  version TEXT NOT NULL,
  download_url TEXT NOT NULL DEFAULT '',
  release_notes TEXT NOT NULL DEFAULT '',
  checksum TEXT NOT NULL DEFAULT '',
  published INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dev_releases_project ON dev_releases(project_id, published, published_at);
`;

export const migration024: Migration = {
  id: "024_dev_manager",
  async upSqlite(db) {
    await db.exec(SQLITE_DDL);
  },
  async upPostgres(db) {
    await db.exec(POSTGRES_DDL);
  },
};
