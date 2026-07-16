import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import TableChartIcon from "@mui/icons-material/TableChart";
import SearchIcon from "@mui/icons-material/Search";
import RefreshIcon from "@mui/icons-material/Refresh";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import DownloadIcon from "@mui/icons-material/Download";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import CloseIcon from "@mui/icons-material/Close";
import StorageIcon from "@mui/icons-material/Storage";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import { useC, SH1, FilledBtn, OutlinedBtn, Field } from "@/app/shared";
import { api, ApiError, type DbConsoleColumn } from "@/app/api";

type DbInfo = {
  provider: "sqlite" | "postgres";
  type: string;
  version: string;
  schemaVersion: string;
  sizeLabel: string;
  path: string;
  totalUsers: number;
  totalMessages: number;
  totalChannels: number;
  totalResources: number;
  totalNotifications: number;
  totalLogs: number;
  lastBackupAt: string | null;
  lastBackupFile: string | null;
};

type BackupFormat = "native" | "portable";

type ConfirmState = { title: string; body: string; onOk: () => void };

function cellPreview(value: unknown, col: DbConsoleColumn): string {
  if (value == null) return "—";
  if (col.sensitive) return String(value);
  if (typeof value === "object") {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  const s = String(value);
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}

function isBoolCol(col: DbConsoleColumn) {
  const n = col.name.toLowerCase();
  return n.startsWith("is_") || n.endsWith("_flag") || col.type.includes("INT") && /^(enabled|published|pinned|muted|archived)$/i.test(col.name);
}

function isUrlCol(col: DbConsoleColumn, value: unknown) {
  if (typeof value !== "string") return false;
  const n = col.name.toLowerCase();
  return (n.includes("url") || n.includes("avatar") || n.includes("image")) && (/^https?:\/\//i.test(value) || value.startsWith("/uploads/"));
}

export function AdminDatabaseConsole({
  onConfirm,
}: {
  onConfirm: (c: ConfirmState) => void;
}) {
  const C = useC();
  const [dbInfo, setDbInfo] = useState<DbInfo | null>(null);
  const [dbBusy, setDbBusy] = useState<"backup" | "restore" | null>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [backupFormat, setBackupFormat] = useState<BackupFormat>("portable");

  const [tables, setTables] = useState<{ name: string; rowCount: number }[]>([]);
  const [tableSearch, setTableSearch] = useState("");
  const [selectedTable, setSelectedTable] = useState<string | null>(null);

  const [columns, setColumns] = useState<DbConsoleColumn[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [primaryKey, setPrimaryKey] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [sortBy, setSortBy] = useState<string>("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loadingTables, setLoadingTables] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const [editRow, setEditRow] = useState<Record<string, unknown> | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [rowsError, setRowsError] = useState<string | null>(null);

  const restoreInputRef = useRef<HTMLInputElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadRowsEpochRef = useRef(0);

  const loadMeta = useCallback(async () => {
    setLoadingTables(true);
    setMetaError(null);
    try {
      const [info, t] = await Promise.all([api.admin.databaseInfo(), api.admin.databaseTables()]);
      setDbInfo(info);
      setTables(t.tables);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Unable to load database";
      setMetaError(msg);
      setTables([]);
      setDbInfo(null);
      toast.error(msg);
    } finally {
      setLoadingTables(false);
    }
  }, []);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(search.trim());
      searchTimerRef.current = null;
    }, 300);
    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
        searchTimerRef.current = null;
      }
    };
  }, [search]);

  const loadRows = useCallback(async () => {
    if (!selectedTable) {
      setRows([]);
      setColumns([]);
      setTotal(0);
      setPrimaryKey([]);
      setRowsError(null);
      setLoadingRows(false);
      return;
    }
    const epoch = ++loadRowsEpochRef.current;
    setLoadingRows(true);
    setRowsError(null);
    try {
      const params: Record<string, string> = {
        page: String(page),
        limit: String(limit),
        sortDir,
      };
      if (sortBy) params.sortBy = sortBy;
      if (debouncedSearch) params.search = debouncedSearch;
      const r = await api.admin.databaseTableRows(selectedTable, params);
      if (epoch !== loadRowsEpochRef.current) return;
      setColumns(r.columns);
      setRows(r.rows);
      setTotal(r.total);
      setPrimaryKey(r.primaryKey);
      setSelectedKeys(new Set());
    } catch (e) {
      if (epoch !== loadRowsEpochRef.current) return;
      const msg = e instanceof ApiError ? e.message : "Unable to load rows";
      setRowsError(msg);
      setRows([]);
      setTotal(0);
      toast.error(msg);
    } finally {
      if (epoch === loadRowsEpochRef.current) setLoadingRows(false);
    }
  }, [selectedTable, page, limit, sortBy, sortDir, debouncedSearch]);

  useEffect(() => {
    void loadRows();
    return () => {
      // Invalidate in-flight row fetches on dependency change / unmount.
      loadRowsEpochRef.current += 1;
    };
  }, [loadRows]);

  const filteredTables = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    const list = q ? tables.filter((t) => t.name.toLowerCase().includes(q)) : tables;
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [tables, tableSearch]);

  const pageCount = Math.max(1, Math.ceil(total / limit));

  const rowKey = (row: Record<string, unknown>) =>
    primaryKey.map((k) => `${k}=${String(row[k])}`).join("|") || JSON.stringify(row);

  const pkFromRow = (row: Record<string, unknown>) => {
    const pk: Record<string, unknown> = {};
    for (const k of primaryKey) pk[k] = row[k];
    return pk;
  };

  const toggleSort = (col: string) => {
    if (sortBy === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(col);
      setSortDir("asc");
    }
    setPage(1);
  };

  const openCreate = () => {
    const initial: Record<string, string> = {};
    for (const c of columns) {
      if (c.sensitive || (c.pk && c.type.includes("INT"))) continue;
      initial[c.name] = c.dfltValue?.replace(/^'|'$/g, "") ?? "";
    }
    setFormData(initial);
    setCreateOpen(true);
    setEditRow(null);
  };

  const openEdit = (row: Record<string, unknown>) => {
    const initial: Record<string, string> = {};
    for (const c of columns) {
      if (c.sensitive) continue;
      const v = row[c.name];
      initial[c.name] = v == null ? "" : String(v);
    }
    setFormData(initial);
    setEditRow(row);
    setCreateOpen(false);
  };

  const saveForm = async () => {
    if (!selectedTable) return;
    setSaving(true);
    try {
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(formData)) {
        const col = columns.find((c) => c.name === k);
        if (!col || col.sensitive) continue;
        if (editRow && col.pk) continue;
        data[k] = v === "" ? null : v;
      }
      if (editRow) {
        await api.admin.databaseUpdateRow(selectedTable, pkFromRow(editRow), data);
        toast.success("Row updated");
      } else {
        await api.admin.databaseInsertRow(selectedTable, data);
        toast.success("Row created");
      }
      setEditRow(null);
      setCreateOpen(false);
      await loadRows();
      await loadMeta();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const deleteSelected = () => {
    if (!selectedTable || selectedKeys.size === 0) return;
    const keys = rows.filter((r) => selectedKeys.has(rowKey(r))).map(pkFromRow);
    onConfirm({
      title: "Delete rows?",
      body: `Permanently delete ${keys.length} row(s) from “${selectedTable}”? This cannot be undone.`,
      onOk: async () => {
        try {
          const r = await api.admin.databaseDeleteRows(selectedTable, keys);
          toast.success(`Deleted ${r.changes} row(s)`);
          await loadRows();
          await loadMeta();
        } catch (e) {
          toast.error(e instanceof ApiError ? e.message : "Delete failed");
        }
      },
    });
  };

  const allVisibleSelected = rows.length > 0 && rows.every((r) => selectedKeys.has(rowKey(r)));

  return (
    <div className="flex flex-col gap-4 min-h-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-medium flex items-center gap-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
            <StorageIcon style={{ fontSize: 28, color: C.primary }} /> Database
          </h1>
          <p className="text-sm mt-1" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
            Browse tables, edit rows, and manage backups. All changes are audited.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={backupFormat}
            onChange={(e) => setBackupFormat(e.target.value as BackupFormat)}
            className="px-2.5 py-2 rounded-xl text-xs border-0 focus:outline-none"
            style={{ background: C.surfaceVar, color: C.onSurface, fontFamily: "Roboto" }}
            title="Backup format"
          >
            <option value="portable">Portable (.json.gz)</option>
            <option value="native">Native ({dbInfo?.type || "engine"})</option>
          </select>
          <OutlinedBtn
            cls={dbBusy ? "opacity-60 pointer-events-none" : ""}
            onClick={async () => {
              setDbBusy("backup");
              try {
                await api.admin.databaseBackup({ format: backupFormat });
                toast.success("Backup downloaded");
                await loadMeta();
              } catch (e) {
                toast.error(e instanceof ApiError ? e.message : "Backup failed");
              } finally {
                setDbBusy(null);
              }
            }}
          >
            <DownloadIcon style={{ fontSize: 16 }} />{dbBusy === "backup" ? "Creating…" : "Backup"}
          </OutlinedBtn>
          <OutlinedBtn
            cls={dbBusy ? "opacity-60 pointer-events-none" : ""}
            onClick={() => restoreInputRef.current?.click()}
          >
            <CloudUploadIcon style={{ fontSize: 16 }} />{dbBusy === "restore" ? "Restoring…" : "Restore"}
          </OutlinedBtn>
          <input
            ref={restoreInputRef}
            type="file"
            accept=".db,.sql,.json,.gz,application/octet-stream,application/x-sqlite3,application/json,application/gzip"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0] || null;
              e.target.value = "";
              if (!file) return;
              setRestoreFile(file);
              onConfirm({
                title: "Restore Database?",
                body: `Overwrite live data with “${file.name}”? A safety backup is created first.`,
                onOk: async () => {
                  setDbBusy("restore");
                  try {
                    const r = await api.admin.databaseRestore(file);
                    toast.success(`Restored (safety: ${r.safetyBackup})`);
                    setRestoreFile(null);
                    setSelectedTable(null);
                    await loadMeta();
                  } catch (err) {
                    toast.error(err instanceof ApiError ? err.message : "Restore failed");
                  } finally {
                    setDbBusy(null);
                  }
                },
              });
            }}
          />
          <OutlinedBtn onClick={() => { void loadMeta(); void loadRows(); }}>
            <RefreshIcon style={{ fontSize: 16 }} /> Refresh
          </OutlinedBtn>
        </div>
      </div>

      {dbInfo && (
        <div className="flex flex-wrap gap-3 text-xs" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
          <span className="px-2.5 py-1 rounded-full font-medium" style={{ background: C.primaryCont, color: C.primary }}>{dbInfo.type} {dbInfo.version}</span>
          <span className="px-2.5 py-1 rounded-full" style={{ background: C.surfaceVar }}>Schema {dbInfo.schemaVersion}</span>
          <span className="px-2.5 py-1 rounded-full" style={{ background: C.surfaceVar }}>{dbInfo.sizeLabel}</span>
          {dbInfo.path && <span className="px-2.5 py-1 rounded-full" style={{ background: C.surfaceVar }}>{dbInfo.path}</span>}
          <span className="px-2.5 py-1 rounded-full" style={{ background: C.surfaceVar }}>
            Last backup: {dbInfo.lastBackupAt ? new Date(dbInfo.lastBackupAt).toLocaleString() : "Never"}
          </span>
          {restoreFile && <span className="px-2.5 py-1 rounded-full" style={{ background: C.primaryCont, color: C.primary }}>Queued: {restoreFile.name}</span>}
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-4 min-h-[min(70vh,720px)]">
        {/* Table explorer */}
        <aside className="lg:w-64 shrink-0 rounded-2xl border flex flex-col min-h-[240px] lg:min-h-0 overflow-hidden" style={{ background: C.surface, borderColor: C.outlineVar, boxShadow: SH1 }}>
          <div className="p-3 border-b shrink-0" style={{ borderColor: C.outlineVar }}>
            <div className="relative">
              <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2" style={{ fontSize: 16, color: C.onSurfaceVar }} />
              <input
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                placeholder="Search tables"
                className="w-full pl-8 pr-3 py-2 rounded-xl text-sm border-0 focus:outline-none"
                style={{ background: C.surfaceVar, color: C.onSurface, fontFamily: "Roboto" }}
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {loadingTables ? (
              <p className="text-xs p-3" style={{ color: C.onSurfaceVar }}>Loading database…</p>
            ) : metaError ? (
              <div className="p-3 space-y-2">
                <p className="text-xs" style={{ color: C.error, fontFamily: "Roboto" }}>{metaError}</p>
                <OutlinedBtn onClick={() => void loadMeta()}>Retry</OutlinedBtn>
              </div>
            ) : filteredTables.length === 0 ? (
              <p className="text-xs p-3" style={{ color: C.onSurfaceVar }}>No tables found.</p>
            ) : filteredTables.map((t) => {
              const active = selectedTable === t.name;
              return (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => { setSelectedTable(t.name); setPage(1); setSearch(""); setDebouncedSearch(""); setSortBy(""); }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left text-sm transition-colors"
                  style={{
                    background: active ? C.primaryCont : "transparent",
                    color: active ? C.primary : C.onSurface,
                    fontFamily: "Roboto",
                  }}
                >
                  <TableChartIcon style={{ fontSize: 16, color: active ? C.primary : C.onSurfaceVar }} />
                  <span className="flex-1 min-w-0 truncate font-medium">{t.name}</span>
                  <span className="text-[10px] tabular-nums shrink-0" style={{ color: C.onSurfaceVar }}>{t.rowCount.toLocaleString()}</span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Table viewer */}
        <section className="flex-1 min-w-0 rounded-2xl border flex flex-col overflow-hidden" style={{ background: C.surface, borderColor: C.outlineVar, boxShadow: SH1 }}>
          {!selectedTable ? (
            <div className="flex-1 flex items-center justify-center p-8 text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Select a table to browse and edit its rows.
            </div>
          ) : (
            <>
              <div className="p-3 md:p-4 border-b flex flex-wrap items-center gap-2 shrink-0" style={{ borderColor: C.outlineVar }}>
                <div className="min-w-0 flex-1">
                  <h2 className="font-medium truncate" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{selectedTable}</h2>
                  <p className="text-[11px]" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                    {total.toLocaleString()} rows · {columns.length} columns
                    {primaryKey.length ? ` · PK: ${primaryKey.join(", ")}` : ""}
                  </p>
                </div>
                <div className="relative">
                  <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2" style={{ fontSize: 16, color: C.onSurfaceVar }} />
                  <input
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                    placeholder="Search rows"
                    className="w-44 md:w-56 pl-8 pr-3 py-2 rounded-xl text-sm border-0 focus:outline-none"
                    style={{ background: C.surfaceVar, color: C.onSurface, fontFamily: "Roboto" }}
                  />
                </div>
                <OutlinedBtn onClick={openCreate}><AddIcon style={{ fontSize: 16 }} /> Add row</OutlinedBtn>
                <OutlinedBtn
                  cls={selectedKeys.size === 0 ? "opacity-50 pointer-events-none" : ""}
                  onClick={deleteSelected}
                >
                  <DeleteIcon style={{ fontSize: 16 }} /> Delete ({selectedKeys.size})
                </OutlinedBtn>
              </div>

              <div className="flex-1 overflow-auto min-h-0">
                {loadingRows ? (
                  <p className="p-6 text-sm" style={{ color: C.onSurfaceVar }}>Loading rows…</p>
                ) : rowsError ? (
                  <div className="p-6 space-y-3">
                    <p className="text-sm" style={{ color: C.error, fontFamily: "Roboto" }}>{rowsError}</p>
                    <OutlinedBtn onClick={() => void loadRows()}>Retry</OutlinedBtn>
                  </div>
                ) : (
                  <table className="w-full text-sm border-collapse" style={{ fontFamily: "Roboto" }}>
                    <thead className="sticky top-0 z-10" style={{ background: C.surfaceVar }}>
                      <tr>
                        <th className="p-2 w-10 text-left">
                          <input
                            type="checkbox"
                            checked={allVisibleSelected}
                            onChange={(e) => {
                              if (e.target.checked) setSelectedKeys(new Set(rows.map(rowKey)));
                              else setSelectedKeys(new Set());
                            }}
                            aria-label="Select all visible rows"
                          />
                        </th>
                        <th className="p-2 w-12" />
                        {columns.map((col) => (
                          <th key={col.name} className="p-2 text-left whitespace-nowrap font-medium" style={{ color: C.onSurfaceVar }}>
                            <button type="button" className="inline-flex items-center gap-1 hover:opacity-80" onClick={() => !col.sensitive && toggleSort(col.name)} disabled={col.sensitive}>
                              {col.name}
                              {col.pk && <span className="text-[9px] uppercase opacity-70">pk</span>}
                              {sortBy === col.name && (sortDir === "asc" ? <ArrowUpwardIcon style={{ fontSize: 12 }} /> : <ArrowDownwardIcon style={{ fontSize: 12 }} />)}
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length === 0 ? (
                        <tr>
                          <td colSpan={columns.length + 2} className="p-6 text-center" style={{ color: C.onSurfaceVar }}>No rows</td>
                        </tr>
                      ) : rows.map((row) => {
                        const key = rowKey(row);
                        const selected = selectedKeys.has(key);
                        return (
                          <tr key={key} className="border-t hover:bg-black/[0.03]" style={{ borderColor: C.outlineVar }}>
                            <td className="p-2 align-top">
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={(e) => {
                                  setSelectedKeys((prev) => {
                                    const next = new Set(prev);
                                    if (e.target.checked) next.add(key);
                                    else next.delete(key);
                                    return next;
                                  });
                                }}
                                aria-label="Select row"
                              />
                            </td>
                            <td className="p-2 align-top">
                              <button type="button" title="Edit" onClick={() => openEdit(row)} className="p-1 rounded-full hover:bg-black/5" style={{ color: C.primary }}>
                                <EditIcon style={{ fontSize: 16 }} />
                              </button>
                            </td>
                            {columns.map((col) => {
                              const value = row[col.name];
                              return (
                                <td key={col.name} className="p-2 align-top max-w-[14rem]" style={{ color: C.onSurface }}>
                                  {isUrlCol(col, value) && typeof value === "string" ? (
                                    <a href={value} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2">
                                      {(col.name.toLowerCase().includes("avatar") || col.name.toLowerCase().includes("image") || /\.(png|jpe?g|gif|webp)$/i.test(value)) && (
                                        <img src={value} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
                                      )}
                                      <span className="truncate text-xs underline" style={{ color: C.primary }}>{cellPreview(value, col)}</span>
                                    </a>
                                  ) : isBoolCol(col) && (value === 0 || value === 1 || value === true || value === false) ? (
                                    <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: value ? C.primaryCont : C.surfaceVar, color: value ? C.primary : C.onSurfaceVar }}>
                                      {value ? "Yes" : "No"}
                                    </span>
                                  ) : (
                                    <span className="block truncate text-xs" title={value == null ? "" : String(value)}>{cellPreview(value, col)}</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="p-3 border-t flex items-center justify-between gap-2 shrink-0 text-sm" style={{ borderColor: C.outlineVar, color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                <span>Page {page} of {pageCount}</span>
                <div className="flex gap-2">
                  <OutlinedBtn cls={page <= 1 ? "opacity-50 pointer-events-none" : ""} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</OutlinedBtn>
                  <OutlinedBtn cls={page >= pageCount ? "opacity-50 pointer-events-none" : ""} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>Next</OutlinedBtn>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {(createOpen || editRow) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => { setCreateOpen(false); setEditRow(null); }}>
          <div className="rounded-3xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" style={{ background: C.surface, boxShadow: SH1 }} onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between mb-4">
              <h3 className="font-medium" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{editRow ? "Edit row" : "Add row"} — {selectedTable}</h3>
              <button type="button" onClick={() => { setCreateOpen(false); setEditRow(null); }}><CloseIcon style={{ color: C.onSurfaceVar }} /></button>
            </div>
            <div className="space-y-3">
              {columns.filter((c) => !c.sensitive && !(editRow && c.pk) && !( !editRow && c.pk && c.type.includes("INT"))).map((col) => (
                <Field
                  key={col.name}
                  label={`${col.name}${col.notnull ? " *" : ""} (${col.type})`}
                  value={formData[col.name] ?? ""}
                  onChange={(v) => setFormData((d) => ({ ...d, [col.name]: v }))}
                  rows={col.type.includes("TEXT") && !col.name.toLowerCase().includes("url") ? 2 : undefined}
                />
              ))}
              <FilledBtn cls={saving ? "opacity-60 pointer-events-none" : ""} onClick={() => void saveForm()}>
                {saving ? "Saving…" : "Save"}
              </FilledBtn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
