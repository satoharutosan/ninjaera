import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import DownloadIcon from "@mui/icons-material/Download";
import DeleteIcon from "@mui/icons-material/Delete";
import { useC, SH1, FilledBtn, OutlinedBtn, Chip } from "@/app/shared";
import { onRealtimeEvent } from "@/app/realtime";
import { api, ApiError, type ActivityLogEntry } from "@/app/api";

type ConfirmState = { title: string; body: string; onOk: () => void };

const PAGE_SIZES = [25, 50, 100] as const;

function formatEventLabel(eventType: string) {
  return eventType
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function AdminActivityLogs({
  onConfirm,
  onOpenDetail,
}: {
  onConfirm: (c: ConfirmState) => void;
  onOpenDetail: (log: ActivityLogEntry) => void;
}) {
  const C = useC();
  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState<number>(50);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filters, setFilters] = useState({
    username: "",
    timeRange: "",
    dateFrom: "",
    dateTo: "",
    userRole: "",
    eventCategory: "",
    eventType: "",
    result: "",
    os: "",
  });
  const [sort, setSort] = useState<{ sortBy: string; sortDir: "asc" | "desc" }>({ sortBy: "timestamp", sortDir: "desc" });
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [eventCategories, setEventCategories] = useState<string[]>([]);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadEpochRef = useRef(0);

  useEffect(() => {
    api.admin.activityLogsMeta()
      .then((m) => {
        setEventTypes(m.eventTypes);
        setEventCategories(m.eventCategories);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
      searchTimerRef.current = null;
    }, 350);
    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
        searchTimerRef.current = null;
      }
    };
  }, [searchInput]);

  const loadLogs = useCallback(async () => {
    const epoch = ++loadEpochRef.current;
    setLoading(true);
    try {
      const params: Record<string, string> = {
        page: String(page),
        limit: String(limit),
        sortBy: sort.sortBy,
        sortDir: sort.sortDir,
      };
      if (debouncedSearch) params.search = debouncedSearch;
      if (filters.username) params.username = filters.username;
      if (filters.timeRange && filters.timeRange !== "custom") params.timeRange = filters.timeRange;
      if (filters.timeRange === "custom" && filters.dateFrom) params.dateFrom = new Date(filters.dateFrom).toISOString();
      if (filters.timeRange === "custom" && filters.dateTo) {
        const end = new Date(filters.dateTo);
        end.setHours(23, 59, 59, 999);
        params.dateTo = end.toISOString();
      }
      if (filters.userRole) params.userRole = filters.userRole;
      if (filters.eventCategory) params.eventCategory = filters.eventCategory;
      if (filters.eventType) params.eventType = filters.eventType;
      if (filters.result) params.result = filters.result;
      if (filters.os) params.os = filters.os;

      const r = await api.admin.activityLogs(params);
      if (epoch !== loadEpochRef.current) return;
      setLogs(r.logs);
      setTotal(r.total);
      setSelectedIds(new Set());
    } catch (e) {
      if (epoch !== loadEpochRef.current) return;
      toast.error(e instanceof ApiError ? e.message : "Failed to load activity logs");
      setLogs([]);
      setTotal(0);
    } finally {
      if (epoch === loadEpochRef.current) setLoading(false);
    }
  }, [page, limit, sort, debouncedSearch, filters]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    return onRealtimeEvent("admin:activity", () => {
      void loadLogs();
    });
  }, [loadLogs]);

  const pageCount = Math.max(1, Math.ceil(total / limit));
  const allSelected = logs.length > 0 && logs.every((l) => selectedIds.has(l.id));
  const someSelected = logs.some((l) => selectedIds.has(l.id)) && !allSelected;

  const eventTypeOptions = useMemo(() => {
    const fallback = [
      "login", "logout", "register", "resource_download", "message_delete",
      "database_backup", "database_restore", "activity_logs_delete",
    ];
    return [...new Set([...eventTypes, ...fallback])].sort((a, b) => a.localeCompare(b));
  }, [eventTypes]);

  const categoryOptions = useMemo(() => {
    const fallback = ["authentication", "messaging", "teamwork", "resources", "downloads", "administration", "security"];
    return [...new Set([...eventCategories, ...fallback])].sort((a, b) => a.localeCompare(b));
  }, [eventCategories]);

  const deleteIds = (ids: number[], methodLabel: string) => {
    if (!ids.length) return;
    onConfirm({
      title: ids.length === 1 ? "Delete log entry?" : "Delete selected logs?",
      body: `Permanently delete ${ids.length} log ${ids.length === 1 ? "entry" : "entries"}? This cannot be undone. An administrative audit record will be kept.`,
      onOk: async () => {
        try {
          const r = await api.admin.deleteActivityLogs(ids);
          toast.success(`Deleted ${r.deleted} log(s)`);
          await loadLogs();
        } catch (e) {
          toast.error(e instanceof ApiError ? e.message : `${methodLabel} failed`);
        }
      },
    });
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-medium" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Activity Logs</h1>
          <p className="text-sm mt-1" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
            Search, filter, and purge historical audit records. Deletions are themselves audited.
          </p>
        </div>
        <OutlinedBtn onClick={async () => { try { await api.admin.exportActivityLogs(); } catch { toast.error("Export failed"); } }}>
          <DownloadIcon style={{ fontSize: 16 }} /> Export CSV
        </OutlinedBtn>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search username, IP, platform, action, keyword…"
          className="px-3 py-2 rounded-full border text-sm flex-1 min-w-[14rem]"
          style={{ borderColor: C.outlineVar, background: C.surface, color: C.onSurface, fontFamily: "Roboto" }}
          aria-label="Search activity logs"
        />
        <input
          value={filters.username}
          onChange={(e) => { setFilters((f) => ({ ...f, username: e.target.value })); setPage(1); }}
          placeholder="User"
          className="px-3 py-2 rounded-full border text-sm w-36"
          style={{ borderColor: C.outlineVar, background: C.surface, color: C.onSurface, fontFamily: "Roboto" }}
        />
        <select
          value={filters.timeRange}
          onChange={(e) => { setFilters((f) => ({ ...f, timeRange: e.target.value })); setPage(1); }}
          className="px-3 py-2 rounded-full border text-xs"
          style={{ borderColor: C.outlineVar, background: C.surface, color: C.onSurface, fontFamily: "Roboto" }}
        >
          <option value="">All time</option>
          <option value="today">Today</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="custom">Custom range</option>
        </select>
        {filters.timeRange === "custom" && (
          <>
            <input type="date" value={filters.dateFrom} onChange={(e) => { setFilters((f) => ({ ...f, dateFrom: e.target.value })); setPage(1); }} className="px-3 py-2 rounded-full border text-xs" style={{ borderColor: C.outlineVar, background: C.surface, color: C.onSurface }} />
            <input type="date" value={filters.dateTo} onChange={(e) => { setFilters((f) => ({ ...f, dateTo: e.target.value })); setPage(1); }} className="px-3 py-2 rounded-full border text-xs" style={{ borderColor: C.outlineVar, background: C.surface, color: C.onSurface }} />
          </>
        )}
        <select value={filters.eventType} onChange={(e) => { setFilters((f) => ({ ...f, eventType: e.target.value })); setPage(1); }} className="px-3 py-2 rounded-full border text-xs max-w-[12rem]" style={{ borderColor: C.outlineVar, background: C.surface, color: C.onSurface, fontFamily: "Roboto" }}>
          <option value="">All actions</option>
          {eventTypeOptions.map((t) => <option key={t} value={t}>{formatEventLabel(t)}</option>)}
        </select>
        <select value={filters.eventCategory} onChange={(e) => { setFilters((f) => ({ ...f, eventCategory: e.target.value })); setPage(1); }} className="px-3 py-2 rounded-full border text-xs" style={{ borderColor: C.outlineVar, background: C.surface, color: C.onSurface, fontFamily: "Roboto" }}>
          <option value="">All categories</option>
          {categoryOptions.map((c) => <option key={c} value={c}>{formatEventLabel(c)}</option>)}
        </select>
        <select value={filters.userRole} onChange={(e) => { setFilters((f) => ({ ...f, userRole: e.target.value })); setPage(1); }} className="px-3 py-2 rounded-full border text-xs" style={{ borderColor: C.outlineVar, background: C.surface, color: C.onSurface, fontFamily: "Roboto" }}>
          <option value="">All roles</option>
          <option value="guest">Guest</option>
          <option value="registered_user">Registered</option>
          <option value="team_member">Team</option>
          <option value="administrator">Admin</option>
        </select>
        <select value={filters.os} onChange={(e) => { setFilters((f) => ({ ...f, os: e.target.value })); setPage(1); }} className="px-3 py-2 rounded-full border text-xs" style={{ borderColor: C.outlineVar, background: C.surface, color: C.onSurface, fontFamily: "Roboto" }}>
          <option value="">All platforms</option>
          <option value="Windows">Windows</option>
          <option value="macOS">macOS</option>
          <option value="Linux">Linux</option>
          <option value="Android">Android</option>
          <option value="iOS">iOS</option>
        </select>
        <select value={filters.result} onChange={(e) => { setFilters((f) => ({ ...f, result: e.target.value })); setPage(1); }} className="px-3 py-2 rounded-full border text-xs" style={{ borderColor: C.outlineVar, background: C.surface, color: C.onSurface, fontFamily: "Roboto" }}>
          <option value="">All results</option>
          <option value="success">Success</option>
          <option value="failure">Failure</option>
        </select>
        <select value={String(limit)} onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }} className="px-3 py-2 rounded-full border text-xs" style={{ borderColor: C.outlineVar, background: C.surface, color: C.onSurface, fontFamily: "Roboto" }} aria-label="Rows per page">
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} / page</option>)}
        </select>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-3 px-3 py-2 rounded-2xl border" style={{ background: C.primaryCont, borderColor: C.outlineVar }}>
          <span className="text-sm font-medium" style={{ color: C.primary, fontFamily: "Roboto" }}>{selectedIds.size} selected</span>
          <FilledBtn onClick={() => deleteIds([...selectedIds], "Bulk delete")}>
            <DeleteIcon style={{ fontSize: 16 }} /> Delete selected
          </FilledBtn>
          <OutlinedBtn onClick={() => setSelectedIds(new Set())}>Clear selection</OutlinedBtn>
        </div>
      )}

      <div className="rounded-2xl overflow-hidden border" style={{ borderColor: C.outlineVar, background: C.surface, boxShadow: SH1 }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ fontFamily: "Roboto" }}>
            <thead>
              <tr style={{ background: C.surfaceVar }}>
                <th className="px-3 py-2 w-10 text-left">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedIds(new Set(logs.map((l) => l.id)));
                      else setSelectedIds(new Set());
                    }}
                    aria-label="Select all visible logs"
                  />
                </th>
                <th className="text-left px-3 py-2 text-xs font-medium uppercase whitespace-nowrap" style={{ color: C.onSurfaceVar }}>ID</th>
                {([
                  ["timestamp", "Time"],
                  ["user", "User"],
                  ["", "Role"],
                  ["event", "Event"],
                  ["", "Category"],
                  ["platform", "Platform"],
                  ["", "Country"],
                  ["", "IP"],
                  ["", "Result"],
                  ["", ""],
                ] as [string, string][]).map(([key, label]) => (
                  <th key={label || "actions"} className="text-left px-3 py-2 text-xs font-medium uppercase whitespace-nowrap" style={{ color: C.onSurfaceVar }}>
                    {key ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:opacity-80"
                        style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}
                        onClick={() => {
                          setSort((s) => ({
                            sortBy: key,
                            sortDir: s.sortBy === key && s.sortDir === "desc" ? "asc" : "desc",
                          }));
                          setPage(1);
                        }}
                      >
                        {label}
                        {sort.sortBy === key ? (sort.sortDir === "asc" ? " ↑" : " ↓") : ""}
                      </button>
                    ) : label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={11} className="px-3 py-10 text-center text-sm" style={{ color: C.onSurfaceVar }}>Loading activity logs…</td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-3 py-10 text-center text-sm" style={{ color: C.onSurfaceVar }}>No activity logs match your filters</td>
                </tr>
              ) : logs.map((l) => {
                const selected = selectedIds.has(l.id);
                return (
                  <tr key={l.id} className="border-t hover:bg-black/5" style={{ borderColor: C.outlineVar }}>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(e) => {
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(l.id);
                            else next.delete(l.id);
                            return next;
                          });
                        }}
                        aria-label={`Select log ${l.id}`}
                      />
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums cursor-pointer" style={{ color: C.onSurfaceVar }} onClick={() => onOpenDetail(l)}>#{l.id}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap cursor-pointer" style={{ color: C.onSurfaceVar }} onClick={() => onOpenDetail(l)}>{l.time}</td>
                    <td className="px-3 py-2 cursor-pointer" style={{ color: C.onSurface }} onClick={() => onOpenDetail(l)}>{l.username || "Guest"}</td>
                    <td className="px-3 py-2 text-xs cursor-pointer" style={{ color: C.onSurfaceVar }} onClick={() => onOpenDetail(l)}>{l.userRole}</td>
                    <td className="px-3 py-2 text-xs cursor-pointer" style={{ color: C.onSurface }} onClick={() => onOpenDetail(l)}>{l.eventType}</td>
                    <td className="px-3 py-2 text-xs cursor-pointer" style={{ color: C.onSurfaceVar }} onClick={() => onOpenDetail(l)}>{l.eventCategory}</td>
                    <td className="px-3 py-2 text-xs max-w-[14rem] cursor-pointer" style={{ color: C.onSurface }} title={l.platform || undefined} onClick={() => onOpenDetail(l)}>
                      <span className="truncate block">{l.platform || "—"}</span>
                    </td>
                    <td className="px-3 py-2 text-xs cursor-pointer" style={{ color: C.onSurfaceVar }} onClick={() => onOpenDetail(l)}>{l.country || "—"}</td>
                    <td className="px-3 py-2 text-xs font-mono cursor-pointer" style={{ color: C.onSurfaceVar }} onClick={() => onOpenDetail(l)}>{l.ipAddress || "—"}</td>
                    <td className="px-3 py-2 cursor-pointer" onClick={() => onOpenDetail(l)}>
                      <Chip label={l.result} color={l.result === "success" ? "#386A20" : C.error} filled={l.result === "failure"} />
                    </td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        title="Delete"
                        aria-label={`Delete log ${l.id}`}
                        className="p-1.5 rounded-full hover:bg-black/5"
                        style={{ color: C.error }}
                        onClick={() => deleteIds([l.id], "Delete")}
                      >
                        <DeleteIcon style={{ fontSize: 16 }} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap justify-between items-center gap-3 mt-4 text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
        <span>{total.toLocaleString()} total entries</span>
        <div className="flex gap-2 items-center">
          <OutlinedBtn onClick={() => setPage((p) => Math.max(1, p - 1))} cls={page <= 1 ? "opacity-50 pointer-events-none" : ""}>Previous</OutlinedBtn>
          <span className="px-3 py-2">Page {page} of {pageCount}</span>
          <OutlinedBtn onClick={() => setPage((p) => Math.min(pageCount, p + 1))} cls={page >= pageCount ? "opacity-50 pointer-events-none" : ""}>Next</OutlinedBtn>
        </div>
      </div>
    </div>
  );
}
