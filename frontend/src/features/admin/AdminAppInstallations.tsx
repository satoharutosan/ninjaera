import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import InstallDesktopIcon from "@mui/icons-material/InstallDesktop";
import DeleteIcon from "@mui/icons-material/Delete";
import RefreshIcon from "@mui/icons-material/Refresh";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import PublicIcon from "@mui/icons-material/Public";
import MonitorIcon from "@mui/icons-material/Monitor";
import { useC, SH1, FilledBtn, OutlinedBtn, Field, FlagImg } from "@/app/shared";
import { countryFlagEmoji } from "@/shared/countryIso";
import { appDisplayName } from "@/shared/appRegistry";
import { api, ApiError, type AppInstallationRecord } from "@/app/api";
import { onRealtimeEvent } from "@/app/realtime";
import { AdminMonitorModal } from "./AdminMonitorModal";

type ConfirmState = { title: string; body: string; onOk: () => void };

const PAGE_SIZES = [25, 50, 100];

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatRole(role: string | null | undefined) {
  if (!role) return "—";
  return role.replace(/_/g, " ");
}

function EndpointStatusDot({ online }: { online: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-2"
      title={online ? "Running" : "Offline"}
      aria-label={online ? "Running" : "Offline"}
    >
      <span
        className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
        style={{
          background: online ? "#2E7D32" : "#C62828",
          boxShadow: online ? "0 0 0 3px rgba(46,125,50,0.22)" : "0 0 0 3px rgba(198,40,40,0.18)",
        }}
        aria-hidden
      />
    </span>
  );
}

function IpWithFlag({
  ip,
  country,
  countryCode,
}: {
  ip: string | null;
  country: string | null;
  countryCode: string | null;
}) {
  const C = useC();
  const code = (countryCode || "").trim().toUpperCase();
  const hasGeo = !!(code.length === 2 || country);

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap" style={{ color: C.onSurfaceVar }}>
      {hasGeo ? (
        country ? (
          <FlagImg country={country} size={14} />
        ) : (
          <span className="text-sm leading-none" aria-hidden>{countryFlagEmoji(code)}</span>
        )
      ) : (
        <PublicIcon style={{ fontSize: 16, color: C.onSurfaceVar }} titleAccess="Unknown country" />
      )}
      <span style={{ fontFamily: "Roboto Mono, monospace" }}>{ip || "—"}</span>
    </span>
  );
}

export function AdminAppInstallations({
  onConfirm,
}: {
  onConfirm: (c: ConfirmState) => void;
}) {
  const C = useC();
  const [rows, setRows] = useState<AppInstallationRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [appFilter, setAppFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [appIds, setAppIds] = useState<string[]>([]);
  const [sort, setSort] = useState<{ sortBy: string; sortDir: "asc" | "desc" }>({
    sortBy: "updated_at",
    sortDir: "desc",
  });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [monitorTarget, setMonitorTarget] = useState<AppInstallationRecord | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const epochRef = useRef(0);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 350);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [search]);

  useEffect(() => {
    api.admin.appInstallationsMeta()
      .then((r) => setAppIds(r.appIds || []))
      .catch(() => setAppIds([]));
  }, []);

  const load = useCallback(async () => {
    const epoch = ++epochRef.current;
    setLoading(true);
    try {
      const params: Record<string, string> = {
        page: String(page),
        limit: String(limit),
        sortBy: sort.sortBy,
        sortDir: sort.sortDir,
      };
      if (debouncedSearch) params.search = debouncedSearch;
      if (appFilter && appFilter !== "all") params.appId = appFilter;
      if (statusFilter && statusFilter !== "all") params.status = statusFilter;
      const res = await api.admin.appInstallations(params);
      if (epoch !== epochRef.current) return;
      setRows(res.installations);
      setTotal(res.total);
      setSelected(new Set());
      setLoaded(true);
    } catch (e) {
      if (epoch !== epochRef.current) return;
      toast.error(e instanceof ApiError ? e.message : "Unable to load installations");
    } finally {
      if (epoch === epochRef.current) setLoading(false);
    }
  }, [page, limit, sort, debouncedSearch, appFilter, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live desktop presence — update dots / user binding without a full page reload.
  useEffect(() => {
    return onRealtimeEvent<{
      installationId: string;
      online: boolean;
      userId?: number;
      monitorCapable?: boolean;
    }>("installation:presence", (data) => {
      if (!data?.installationId) return;
      setRows((prev) =>
        prev.map((r) =>
          r.installationId === data.installationId
            ? {
                ...r,
                online: !!data.online,
                // Live socket user wins over stale guest/null DB userId.
                userId: data.userId ?? r.userId,
                monitorCapable: data.monitorCapable ?? (data.online ? true : r.monitorCapable),
              }
            : r,
        ),
      );
      // If filtering by online/offline, refresh list so rows enter/leave correctly.
      if (statusFilter === "online" || statusFilter === "offline") {
        void load();
      }
    });
  }, [load, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(total / limit));
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const appFilterOptions = useMemo(() => {
    const ids = Array.from(new Set(appIds)).sort();
    return ids;
  }, [appIds]);

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  };

  const deleteSelected = () => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    onConfirm({
      title: "Delete installation records",
      body: `Permanently delete ${ids.length} installation record(s)? This cannot be undone.`,
      onOk: async () => {
        try {
          await api.admin.deleteAppInstallations(ids);
          toast.success(`Deleted ${ids.length} record(s)`);
          await load();
        } catch (e) {
          toast.error(e instanceof ApiError ? e.message : "Delete failed");
        }
      },
    });
  };

  const deleteOne = (row: AppInstallationRecord) => {
    onConfirm({
      title: "Delete installation",
      body: `Delete installation for ${appDisplayName(row.appId, row.appName)} (${row.installationId})?`,
      onOk: async () => {
        try {
          await api.admin.deleteAppInstallation(row.id);
          toast.success("Deleted");
          await load();
        } catch (e) {
          toast.error(e instanceof ApiError ? e.message : "Delete failed");
        }
      },
    });
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const params: Record<string, string> = {};
      if (debouncedSearch) params.search = debouncedSearch;
      if (appFilter && appFilter !== "all") params.appId = appFilter;
      if (statusFilter && statusFilter !== "all") params.status = statusFilter;
      await api.admin.exportAppInstallations(params);
      toast.success("Export started");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-medium flex items-center gap-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
            <InstallDesktopIcon style={{ color: C.primary }} />
            Application Installations
          </h2>
          <p className="text-sm mt-1" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
            Latest access per application and IP (Messenger and future apps). Reopens update the same record.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <OutlinedBtn onClick={() => void load()} cls="inline-flex items-center gap-1">
            <RefreshIcon style={{ fontSize: 18 }} /> Refresh
          </OutlinedBtn>
          <OutlinedBtn onClick={() => void handleExport()} disabled={exporting} cls="inline-flex items-center gap-1">
            <FileDownloadIcon style={{ fontSize: 18 }} /> Export CSV
          </OutlinedBtn>
          <FilledBtn onClick={deleteSelected} disabled={!selected.size} cls="inline-flex items-center gap-1">
            <DeleteIcon style={{ fontSize: 18 }} /> Delete selected
          </FilledBtn>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[180px]">
          <Field label="Search" value={search} onChange={setSearch} placeholder="App, user, IP, country, install id…" />
        </div>
        <label className="text-xs flex flex-col gap-1" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
          Application
          <select
            value={appFilter}
            onChange={(e) => { setAppFilter(e.target.value); setPage(1); }}
            className="rounded-xl px-3 py-2 text-sm min-w-[160px]"
            style={{ background: C.surfaceVar, color: C.onSurface, border: `1px solid ${C.outlineVar}` }}
          >
            <option value="all">All Applications</option>
            {appFilterOptions.map((id) => (
              <option key={id} value={id}>{appDisplayName(id)}</option>
            ))}
          </select>
        </label>
        <label className="text-xs flex flex-col gap-1" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
          Status
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="rounded-xl px-3 py-2 text-sm"
            style={{ background: C.surfaceVar, color: C.onSurface, border: `1px solid ${C.outlineVar}` }}
          >
            <option value="all">All</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
          </select>
        </label>
        <label className="text-xs flex flex-col gap-1" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
          Sort
          <select
            value={`${sort.sortBy}:${sort.sortDir}`}
            onChange={(e) => {
              const [sortBy, sortDir] = e.target.value.split(":") as [string, "asc" | "desc"];
              setSort({ sortBy, sortDir });
            }}
            className="rounded-xl px-3 py-2 text-sm"
            style={{ background: C.surfaceVar, color: C.onSurface, border: `1px solid ${C.outlineVar}` }}
          >
            <option value="updated_at:desc">Last opened</option>
            <option value="updated_at:asc">Oldest opened</option>
            <option value="created_at:desc">First seen</option>
            <option value="created_at:asc">Oldest first seen</option>
            <option value="app_id:asc">App A–Z</option>
            <option value="app_id:desc">App Z–A</option>
            <option value="username:asc">User A–Z</option>
            <option value="app_version:desc">Version</option>
            <option value="country:asc">Country</option>
            <option value="platform:asc">Platform</option>
          </select>
        </label>
        <label className="text-xs flex flex-col gap-1" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
          Page size
          <select
            value={limit}
            onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}
            className="rounded-xl px-3 py-2 text-sm"
            style={{ background: C.surfaceVar, color: C.onSurface, border: `1px solid ${C.outlineVar}` }}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background: C.surface, boxShadow: SH1 }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ fontFamily: "Roboto" }}>
            <thead>
              <tr style={{ background: C.surfaceVar, color: C.onSurfaceVar }}>
                <th className="p-3 w-10">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
                </th>
                <th className="text-left p-3 font-medium">Application</th>
                <th className="text-left p-3 font-medium">Version</th>
                <th className="text-left p-3 font-medium">User</th>
                <th className="text-left p-3 font-medium">Role</th>
                <th className="text-left p-3 font-medium">IP Address</th>
                <th className="text-left p-3 font-medium">Country</th>
                <th className="text-left p-3 font-medium">OS</th>
                <th className="text-left p-3 font-medium">Last opened</th>
                <th className="text-left p-3 font-medium">First seen</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-left p-3 font-medium w-24" />
              </tr>
            </thead>
            <tbody>
              {loading && !loaded && (
                <tr>
                  <td colSpan={12} className="p-8 text-center" style={{ color: C.onSurfaceVar }}>Loading…</td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={12} className="p-8 text-center" style={{ color: C.onSurfaceVar }}>No installation records</td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: `1px solid ${C.outlineVar}` }}>
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggleSelect(r.id)}
                      aria-label={`Select installation ${r.id}`}
                    />
                  </td>
                  <td className="p-3">
                    <div style={{ color: C.onSurface }}>{appDisplayName(r.appId, r.appName)}</div>
                    <div className="text-xs" style={{ color: C.onSurfaceVar }}>{r.appId}</div>
                  </td>
                  <td className="p-3 whitespace-nowrap" style={{ color: C.onSurfaceVar }}>
                    {r.appVersion || "—"}
                    {r.buildVersion ? <span className="text-xs block">build {r.buildVersion}</span> : null}
                    {r.releaseChannel ? <span className="text-xs block">{r.releaseChannel}</span> : null}
                  </td>
                  <td className="p-3" style={{ color: C.onSurface }}>
                    {r.username || (r.isAnonymous ? "Guest" : "—")}
                  </td>
                  <td className="p-3 capitalize" style={{ color: C.onSurfaceVar }}>{formatRole(r.userRole)}</td>
                  <td className="p-3">
                    <IpWithFlag ip={r.ipAddress} country={r.country} countryCode={r.countryCode} />
                  </td>
                  <td className="p-3 whitespace-nowrap" style={{ color: C.onSurfaceVar }}>
                    {r.country || r.countryCode || "—"}
                  </td>
                  <td className="p-3" style={{ color: C.onSurfaceVar }}>{r.operatingSystem || r.platform || "—"}</td>
                  <td className="p-3 whitespace-nowrap" style={{ color: C.onSurfaceVar }}>{formatWhen(r.updatedAt || r.createdAt)}</td>
                  <td className="p-3 whitespace-nowrap" style={{ color: C.onSurfaceVar }}>{formatWhen(r.createdAt)}</td>
                  <td className="p-3">
                    <EndpointStatusDot online={!!r.online} />
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-1">
                      {(() => {
                        const online = !!r.online;
                        // Monitoring is available when the desktop socket is live.
                        // Do NOT gate on DB userId — guest registrations often leave it null
                        // even after the user signs in; the live endpoint carries the user.
                        const canMonitor = online && r.monitorCapable !== false;
                        const title = !online
                          ? "Endpoint offline"
                          : !canMonitor
                            ? "Monitoring unavailable"
                            : "Monitor";
                        return (
                          <button
                            type="button"
                            onClick={() => {
                              if (!online) {
                                toast.error("Endpoint offline");
                                return;
                              }
                              if (!canMonitor) {
                                toast.error("Monitoring unavailable on this endpoint");
                                return;
                              }
                              if (import.meta.env.DEV) {
                                console.info("[MONITOR] Admin requested endpoint:", r.installationId, {
                                  online: r.online,
                                  userId: r.userId,
                                  username: r.username,
                                });
                              }
                              setMonitorTarget(r);
                            }}
                            disabled={!canMonitor}
                            className="p-1.5 rounded-full hover:bg-black/5 disabled:opacity-40 disabled:pointer-events-none"
                            style={{ color: C.primary }}
                            aria-label={title}
                            title={title}
                          >
                            <MonitorIcon style={{ fontSize: 16 }} />
                          </button>
                        );
                      })()}
                      <button
                        type="button"
                        onClick={() => deleteOne(r)}
                        className="p-1.5 rounded-full hover:bg-black/5"
                        style={{ color: C.error }}
                        aria-label="Delete"
                      >
                        <DeleteIcon style={{ fontSize: 16 }} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div
          className="flex flex-wrap items-center justify-between gap-2 p-3 text-xs"
          style={{ color: C.onSurfaceVar, borderTop: `1px solid ${C.outlineVar}`, fontFamily: "Roboto" }}
        >
          <span>{total} total</span>
          <div className="flex items-center gap-2">
            <OutlinedBtn onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} cls="!px-3 !py-1 text-xs">
              Prev
            </OutlinedBtn>
            <span>Page {page} / {pageCount}</span>
            <OutlinedBtn onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page >= pageCount} cls="!px-3 !py-1 text-xs">
              Next
            </OutlinedBtn>
          </div>
        </div>
      </div>

      {monitorTarget && (
        <AdminMonitorModal
          target={monitorTarget}
          onClose={() => setMonitorTarget(null)}
        />
      )}
    </div>
  );
}

export default AdminAppInstallations;
