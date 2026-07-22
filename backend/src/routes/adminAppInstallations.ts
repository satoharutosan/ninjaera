import { Router } from "express";
import { requireSuperAdmin } from "../middleware/admin.js";
import { qAll, qGet, qRun } from "../db/query.js";
import { logActivitySync } from "../services/activityLog.js";
import { APP_REGISTRY } from "../services/appRegistry.js";
import {
  listDistinctAppIds,
  mapInstallation,
  type AppInstallationRow,
} from "../services/appInstallations.js";
import { getOnlineInstallationIds, isInstallationOnline } from "../services/desktopEndpoints.js";

const router = Router();

const SORT_MAP: Record<string, string> = {
  created_at: "created_at",
  updated_at: "updated_at",
  app_id: "app_id",
  app_name: "app_name",
  app_version: "app_version",
  username: "username",
  user_role: "user_role",
  ip_address: "ip_address",
  country: "country",
  platform: "platform",
  operating_system: "operating_system",
  status: "status",
};

router.get("/app-installations/meta", requireSuperAdmin, async (_req, res) => {
  const fromDb = await listDistinctAppIds();
  const known = APP_REGISTRY.map((e) => e.id);
  const appIds = Array.from(new Set([...known, ...fromDb])).sort();
  res.json({
    appIds,
    apps: APP_REGISTRY.map((e) => ({ id: e.id, name: e.name })),
  });
});

router.get("/app-installations", requireSuperAdmin, async (req, res) => {
  const {
    search = "",
    appId = "",
    status = "",
    page = "1",
    limit = "50",
    sortBy = "updated_at",
    sortDir = "desc",
  } = req.query as Record<string, string>;

  const pageN = Math.max(1, Number(page) || 1);
  const limitN = Math.min(200, Math.max(1, Number(limit) || 50));
  const offset = (pageN - 1) * limitN;
  const col = SORT_MAP[sortBy] || "updated_at";
  const dir = sortDir.toLowerCase() === "asc" ? "ASC" : "DESC";
  const orderExpr =
    col === "updated_at" ? "COALESCE(updated_at, created_at)" : col;

  const where: string[] = [];
  const params: unknown[] = [];

  if (search.trim()) {
    const q = `%${search.trim()}%`;
    where.push(`(
      LOWER(app_id) LIKE LOWER(?) OR LOWER(COALESCE(app_name,'')) LIKE LOWER(?)
      OR LOWER(COALESCE(app_version,'')) LIKE LOWER(?) OR LOWER(COALESCE(username,'')) LIKE LOWER(?)
      OR LOWER(COALESCE(user_role,'')) LIKE LOWER(?) OR LOWER(COALESCE(ip_address,'')) LIKE LOWER(?)
      OR LOWER(COALESCE(country,'')) LIKE LOWER(?) OR LOWER(COALESCE(country_code,'')) LIKE LOWER(?)
      OR LOWER(COALESCE(platform,'')) LIKE LOWER(?) OR LOWER(COALESCE(operating_system,'')) LIKE LOWER(?)
      OR LOWER(COALESCE(installation_id,'')) LIKE LOWER(?)
    )`);
    params.push(q, q, q, q, q, q, q, q, q, q, q);
  }
  if (appId.trim() && appId.trim().toLowerCase() !== "all") {
    where.push("app_id = ?");
    params.push(appId.trim().toLowerCase());
  }

  // Realtime desktop presence filter (not the DB "active" registration flag).
  const statusNorm = status.trim().toLowerCase();
  const onlineIds = getOnlineInstallationIds();
  if (statusNorm === "online" || statusNorm === "active" || statusNorm === "running") {
    if (onlineIds.length === 0) {
      res.json({ total: 0, page: pageN, limit: limitN, installations: [] });
      return;
    }
    where.push(`installation_id IN (${onlineIds.map(() => "?").join(",")})`);
    params.push(...onlineIds);
  } else if (statusNorm === "offline" || statusNorm === "disconnected") {
    if (onlineIds.length > 0) {
      where.push(`installation_id NOT IN (${onlineIds.map(() => "?").join(",")})`);
      params.push(...onlineIds);
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const totalRow = await qGet<{ c: number }>(
    `SELECT COUNT(*) as c FROM app_installations ${whereSql}`,
    ...params,
  );
  const rows = await qAll<AppInstallationRow>(
    `SELECT * FROM app_installations ${whereSql}
     ORDER BY ${orderExpr} ${dir}, id ${dir}
     LIMIT ? OFFSET ?`,
    ...params,
    limitN,
    offset,
  );

  res.json({
    total: Number(totalRow?.c) || 0,
    page: pageN,
    limit: limitN,
    installations: rows.map((r) => ({
      ...mapInstallation(r),
      online: isInstallationOnline(r.installation_id),
    })),
  });
});

router.get("/app-installations/export", requireSuperAdmin, async (req, res) => {
  const { search = "", appId = "", status = "" } = req.query as Record<string, string>;
  const where: string[] = [];
  const params: unknown[] = [];

  if (search.trim()) {
    const q = `%${search.trim()}%`;
    where.push(`(
      LOWER(app_id) LIKE LOWER(?) OR LOWER(COALESCE(app_name,'')) LIKE LOWER(?)
      OR LOWER(COALESCE(username,'')) LIKE LOWER(?) OR LOWER(COALESCE(ip_address,'')) LIKE LOWER(?)
    )`);
    params.push(q, q, q, q);
  }
  if (appId.trim() && appId.trim().toLowerCase() !== "all") {
    where.push("app_id = ?");
    params.push(appId.trim().toLowerCase());
  }
  if (status.trim() && status.trim().toLowerCase() !== "all") {
    where.push("status = ?");
    params.push(status.trim().toLowerCase());
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await qAll<AppInstallationRow>(
    `SELECT * FROM app_installations ${whereSql} ORDER BY COALESCE(updated_at, created_at) DESC, id DESC LIMIT 10000`,
    ...params,
  );

  const header = [
    "id",
    "app_id",
    "app_name",
    "app_version",
    "build_version",
    "release_channel",
    "installation_id",
    "user_id",
    "username",
    "user_role",
    "is_anonymous",
    "ip_address",
    "country",
    "country_code",
    "operating_system",
    "platform",
    "status",
    "created_at",
    "updated_at",
  ];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.app_id,
        r.app_name,
        r.app_version,
        r.build_version,
        r.release_channel,
        r.installation_id,
        r.user_id,
        r.username,
        r.user_role,
        r.is_anonymous,
        r.ip_address,
        r.country,
        r.country_code,
        r.operating_system,
        r.platform,
        r.status,
        r.created_at,
        r.updated_at || r.created_at,
      ]
        .map(esc)
        .join(","),
    );
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="app-installations.csv"');
  res.send(lines.join("\n"));
});

router.post("/app-installations/bulk-delete", requireSuperAdmin, async (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0)
    : [];
  if (!ids.length) {
    res.status(400).json({ error: "No installation ids provided" });
    return;
  }
  const placeholders = ids.map(() => "?").join(",");
  const result = await qRun(
    `DELETE FROM app_installations WHERE id IN (${placeholders})`,
    ...ids,
  );

  logActivitySync({
    req,
    userId: req.user!.id,
    username: req.user!.username,
    eventType: "app_installations_bulk_delete",
    eventCategory: "admin",
    description: `Deleted ${ids.length} app installation record(s)`,
    affectedObject: `app_installations:${ids.slice(0, 20).join(",")}`,
    result: "success",
  });

  res.json({ ok: true, deleted: Number(result.changes) || ids.length });
});

router.delete("/app-installations/:id", requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const result = await qRun("DELETE FROM app_installations WHERE id = ?", id);
  if (!result.changes) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  logActivitySync({
    req,
    userId: req.user!.id,
    username: req.user!.username,
    eventType: "app_installation_delete",
    eventCategory: "admin",
    description: `Deleted app installation #${id}`,
    affectedObject: `app_installation:${id}`,
    result: "success",
  });
  res.json({ ok: true });
});

export default router;
