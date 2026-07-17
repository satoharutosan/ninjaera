import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import LinkIcon from "@mui/icons-material/Link";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import RefreshIcon from "@mui/icons-material/Refresh";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import VideocamIcon from "@mui/icons-material/Videocam";
import ImageIcon from "@mui/icons-material/Image";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import PublicIcon from "@mui/icons-material/Public";
import { useC, SH1, FilledBtn, OutlinedBtn, Field, Chip, FlagImg } from "@/app/shared";
import { countryFlagEmoji } from "@/shared/countryIso";
import {
  api,
  ApiError,
  type AdminLinkFile,
  type AdminLinkFileAccessLog,
} from "@/app/api";

type ConfirmState = { title: string; body: string; onOk: () => void };
type PageTab = "files" | "logs";

const ALLOWED_ACCEPT = ".jpg,.jpeg,.png,.gif,.webp,.mp4,.pdf";
const TABS: { id: PageTab; label: string }[] = [
  { id: "files", label: "Link Files" },
  { id: "logs", label: "Access Logs" },
];

function formatBytes(n: number) {
  if (!n || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
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

function PreviewThumb({ file }: { file: AdminLinkFile }) {
  const C = useC();
  const mime = (file.mimeType || "").toLowerCase();
  const src = file.fileUrl || file.publicPath;

  if (mime.startsWith("image/")) {
    return (
      <img
        src={src}
        alt=""
        className="w-12 h-12 rounded-lg object-cover"
        style={{ background: C.surfaceVar }}
      />
    );
  }
  if (mime === "video/mp4") {
    return (
      <div className="w-12 h-12 rounded-lg flex items-center justify-center" style={{ background: C.surfaceVar }}>
        <VideocamIcon style={{ fontSize: 22, color: C.primary }} />
      </div>
    );
  }
  if (mime === "application/pdf") {
    return (
      <div className="w-12 h-12 rounded-lg flex items-center justify-center" style={{ background: C.surfaceVar }}>
        <PictureAsPdfIcon style={{ fontSize: 22, color: C.error }} />
      </div>
    );
  }
  if (mime.startsWith("image")) {
    return <ImageIcon style={{ fontSize: 22, color: C.primary }} />;
  }
  return (
    <div className="w-12 h-12 rounded-lg flex items-center justify-center" style={{ background: C.surfaceVar }}>
      <InsertDriveFileIcon style={{ fontSize: 22, color: C.onSurfaceVar }} />
    </div>
  );
}

export function AdminLinkFileManagement({
  onConfirm,
}: {
  onConfirm: (c: ConfirmState) => void;
}) {
  const C = useC();
  const [tab, setTab] = useState<PageTab>("files");

  const [files, setFiles] = useState<AdminLinkFile[]>([]);
  const [filesLoaded, setFilesLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fileSearch, setFileSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "disabled">("all");

  const [edit, setEdit] = useState<Partial<AdminLinkFile> | null>(null);
  const [editFile, setEditFile] = useState<File | null>(null);
  const [alias, setAlias] = useState("");
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [logs, setLogs] = useState<AdminLinkFileAccessLog[]>([]);
  const [logsLoaded, setLogsLoaded] = useState(false);
  const [logTotal, setLogTotal] = useState(0);
  const [logPage, setLogPage] = useState(1);
  const [logLimit] = useState(50);
  const [logSearch, setLogSearch] = useState("");
  const [debouncedLogSearch, setDebouncedLogSearch] = useState("");
  const [logAliasFilter, setLogAliasFilter] = useState("");
  const [logSort, setLogSort] = useState<{ sortBy: string; sortDir: "asc" | "desc" }>({
    sortBy: "created_at",
    sortDir: "desc",
  });
  const [selectedLogIds, setSelectedLogIds] = useState<Set<number>>(new Set());
  const [logsLoading, setLogsLoading] = useState(false);
  const logTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logEpochRef = useRef(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollPosRef = useRef<Record<PageTab, number>>({ files: 0, logs: 0 });

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.admin.linkFiles();
      setFiles(res.files);
      setFilesLoaded(true);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Unable to load link files");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLogs = useCallback(async () => {
    const epoch = ++logEpochRef.current;
    setLogsLoading(true);
    try {
      const params: Record<string, string> = {
        page: String(logPage),
        limit: String(logLimit),
        sortBy: logSort.sortBy,
        sortDir: logSort.sortDir,
      };
      if (debouncedLogSearch) params.search = debouncedLogSearch;
      if (logAliasFilter) params.alias = logAliasFilter;
      const res = await api.admin.linkFileLogs(params);
      if (epoch !== logEpochRef.current) return;
      setLogs(res.logs);
      setLogTotal(res.total);
      setSelectedLogIds(new Set());
      setLogsLoaded(true);
    } catch (e) {
      if (epoch !== logEpochRef.current) return;
      toast.error(e instanceof ApiError ? e.message : "Unable to load access logs");
    } finally {
      if (epoch === logEpochRef.current) setLogsLoading(false);
    }
  }, [logPage, logLimit, logSort, debouncedLogSearch, logAliasFilter]);

  useEffect(() => {
    if (tab !== "files") return;
    if (!filesLoaded) void loadFiles();
  }, [tab, filesLoaded, loadFiles]);

  useEffect(() => {
    if (logTimerRef.current) clearTimeout(logTimerRef.current);
    logTimerRef.current = setTimeout(() => {
      setDebouncedLogSearch(logSearch.trim());
      setLogPage(1);
      logTimerRef.current = null;
    }, 300);
    return () => {
      if (logTimerRef.current) clearTimeout(logTimerRef.current);
    };
  }, [logSearch]);

  useEffect(() => {
    if (tab !== "logs") return;
    void loadLogs();
  }, [tab, loadLogs]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = scrollPosRef.current[tab] || 0;
  }, [tab]);

  const switchTab = (next: PageTab) => {
    if (next === tab) return;
    if (scrollRef.current) scrollPosRef.current[tab] = scrollRef.current.scrollTop;
    setTab(next);
  };

  const filteredFiles = useMemo(() => {
    const q = fileSearch.trim().toLowerCase();
    return files.filter((f) => {
      if (statusFilter === "active" && !f.active) return false;
      if (statusFilter === "disabled" && f.active) return false;
      if (!q) return true;
      return (
        f.alias.toLowerCase().includes(q)
        || f.originalFilename.toLowerCase().includes(q)
        || f.mimeType.toLowerCase().includes(q)
      );
    });
  }, [files, fileSearch, statusFilter]);

  const fileStats = useMemo(() => {
    const total = files.length;
    const activeCount = files.filter((f) => f.active).length;
    const totalAccess = files.reduce((sum, f) => sum + (f.accessCount || 0), 0);
    const totalBytes = files.reduce((sum, f) => sum + (f.fileSize || 0), 0);
    return { total, activeCount, disabledCount: total - activeCount, totalAccess, totalBytes };
  }, [files]);

  const openCreate = () => {
    setEdit({});
    setEditFile(null);
    setAlias("");
    setActive(true);
  };

  const openEdit = (f: AdminLinkFile) => {
    setEdit(f);
    setEditFile(null);
    setAlias(f.alias);
    setActive(f.active);
  };

  const save = async () => {
    if (!edit) return;
    const isNew = !edit.id;
    if (isNew && !editFile) {
      toast.error("Choose a file to upload");
      return;
    }
    if (!alias.trim()) {
      toast.error("Public path is required");
      return;
    }
    setSaving(true);
    try {
      const form = new FormData();
      form.append("alias", alias.trim());
      form.append("active", active ? "true" : "false");
      if (editFile) form.append("file", editFile);
      if (isNew) {
        await api.admin.createLinkFile(form);
        toast.success("Link file uploaded");
      } else {
        await api.admin.updateLinkFile(edit.id!, form);
        toast.success("Link file updated");
      }
      setEdit(null);
      setEditFile(null);
      await loadFiles();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const copyPublicUrl = async (f: AdminLinkFile) => {
    const url = `${window.location.origin}${f.publicPath}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Public URL copied");
    } catch {
      toast.error("Could not copy URL");
    }
  };

  const toggleLogSelect = (id: number) => {
    setSelectedLogIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allLogsSelected = logs.length > 0 && logs.every((l) => selectedLogIds.has(l.id));

  const toggleAllLogs = () => {
    if (allLogsSelected) setSelectedLogIds(new Set());
    else setSelectedLogIds(new Set(logs.map((l) => l.id)));
  };

  const deleteSelectedLogs = () => {
    const ids = [...selectedLogIds];
    if (!ids.length) return;
    onConfirm({
      title: "Delete access logs",
      body: `Delete ${ids.length} selected log entr${ids.length === 1 ? "y" : "ies"}? Uploaded files are not affected.`,
      onOk: () => {
        void api.admin.deleteLinkFileLogs(ids)
          .then(() => {
            toast.success("Logs deleted");
            void loadLogs();
          })
          .catch((e) => toast.error(e instanceof ApiError ? e.message : "Delete failed"));
      },
    });
  };

  const refreshActive = () => {
    if (tab === "files") void loadFiles();
    else void loadLogs();
  };

  const logPages = Math.max(1, Math.ceil(logTotal / logLimit));

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 px-4 md:px-8 pt-4 md:pt-8" style={{ background: C.bg }}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="text-2xl font-medium" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
              Link File Management
            </h1>
            <p className="text-sm mt-1" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Super Admin only. Public files are available at <code>/externals/&#123;alias&#125;</code>.
            </p>
          </div>
          <div className="flex gap-2">
            <OutlinedBtn onClick={refreshActive}>
              <RefreshIcon style={{ fontSize: 18 }} /> Refresh
            </OutlinedBtn>
            {tab === "files" && (
              <FilledBtn onClick={openCreate}>
                <UploadFileIcon style={{ fontSize: 18 }} /> Upload
              </FilledBtn>
            )}
            {tab === "logs" && (
              <OutlinedBtn onClick={deleteSelectedLogs} disabled={!selectedLogIds.size}>
                <DeleteIcon style={{ fontSize: 16 }} /> Delete selected ({selectedLogIds.size})
              </OutlinedBtn>
            )}
          </div>
        </div>

        <div
          className="flex w-full border-b overflow-x-auto"
          style={{ borderColor: C.outlineVar }}
          role="tablist"
          aria-label="Link File Management sections"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => switchTab(t.id)}
              className="flex-1 md:flex-none min-w-0 px-4 md:px-5 py-3 text-sm font-medium text-center whitespace-nowrap transition-all border-b-2"
              style={{
                borderColor: tab === t.id ? C.primary : "transparent",
                color: tab === t.id ? C.primary : C.onSurfaceVar,
                fontFamily: "Roboto",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 md:px-8 py-4 md:py-6"
        onScroll={() => {
          if (scrollRef.current) scrollPosRef.current[tab] = scrollRef.current.scrollTop;
        }}
      >
        {tab === "files" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Total files", value: String(fileStats.total) },
                { label: "Active", value: String(fileStats.activeCount) },
                { label: "Total accesses", value: String(fileStats.totalAccess) },
                { label: "Storage", value: formatBytes(fileStats.totalBytes) },
              ].map((s) => (
                <div key={s.label} className="rounded-2xl p-3" style={{ background: C.surface, boxShadow: SH1 }}>
                  <p className="text-xs" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>{s.label}</p>
                  <p className="text-lg font-medium mt-1" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{s.value}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[180px]">
                <Field label="Search files" value={fileSearch} onChange={setFileSearch} placeholder="Alias, filename, type…" />
              </div>
              <label className="text-xs flex flex-col gap-1" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                Status
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                  className="rounded-xl px-3 py-2 text-sm"
                  style={{ background: C.surfaceVar, color: C.onSurface, border: `1px solid ${C.outlineVar}` }}
                >
                  <option value="all">All</option>
                  <option value="active">Active</option>
                  <option value="disabled">Disabled</option>
                </select>
              </label>
            </div>

            <div className="rounded-2xl overflow-hidden" style={{ background: C.surface, boxShadow: SH1 }}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ fontFamily: "Roboto" }}>
                  <thead>
                    <tr style={{ background: C.surfaceVar, color: C.onSurfaceVar }}>
                      <th className="text-left p-3 font-medium">Preview</th>
                      <th className="text-left p-3 font-medium">File</th>
                      <th className="text-left p-3 font-medium">Alias</th>
                      <th className="text-left p-3 font-medium">Type</th>
                      <th className="text-left p-3 font-medium">Size</th>
                      <th className="text-left p-3 font-medium">Uploaded</th>
                      <th className="text-left p-3 font-medium">Accesses</th>
                      <th className="text-left p-3 font-medium">Last access</th>
                      <th className="text-left p-3 font-medium">Last visitor</th>
                      <th className="text-left p-3 font-medium">Status</th>
                      <th className="text-right p-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && !filesLoaded && (
                      <tr>
                        <td colSpan={11} className="p-8 text-center" style={{ color: C.onSurfaceVar }}>Loading…</td>
                      </tr>
                    )}
                    {filesLoaded && filteredFiles.length === 0 && (
                      <tr>
                        <td colSpan={11} className="p-8 text-center" style={{ color: C.onSurfaceVar }}>No link files yet</td>
                      </tr>
                    )}
                    {filteredFiles.map((f) => (
                      <tr key={f.id} style={{ borderTop: `1px solid ${C.outlineVar}` }}>
                        <td className="p-3"><PreviewThumb file={f} /></td>
                        <td className="p-3" style={{ color: C.onSurface }}>{f.originalFilename}</td>
                        <td className="p-3">
                          <a href={f.publicPath} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1" style={{ color: C.primary }}>
                            <LinkIcon style={{ fontSize: 14 }} />
                            {f.alias}
                          </a>
                        </td>
                        <td className="p-3" style={{ color: C.onSurfaceVar }}>{f.mimeType}</td>
                        <td className="p-3" style={{ color: C.onSurfaceVar }}>{formatBytes(f.fileSize)}</td>
                        <td className="p-3" style={{ color: C.onSurfaceVar }}>{formatWhen(f.createdAt)}</td>
                        <td className="p-3" style={{ color: C.onSurface }}>{f.accessCount}</td>
                        <td className="p-3" style={{ color: C.onSurfaceVar }}>{formatWhen(f.lastAccessedAt)}</td>
                        <td className="p-3" style={{ color: C.onSurfaceVar }}>{f.lastVisitor || "—"}</td>
                        <td className="p-3">
                          {f.active ? <Chip label="Active" color="#386A20" filled /> : <Chip label="Disabled" />}
                        </td>
                        <td className="p-3">
                          <div className="flex justify-end gap-1">
                            <button type="button" title="Copy URL" onClick={() => void copyPublicUrl(f)} className="p-1.5 rounded-full hover:bg-black/5" style={{ color: C.primary }}>
                              <ContentCopyIcon style={{ fontSize: 16 }} />
                            </button>
                            <button type="button" title="Edit" onClick={() => openEdit(f)} className="p-1.5 rounded-full hover:bg-black/5" style={{ color: C.primary }}>
                              <EditIcon style={{ fontSize: 16 }} />
                            </button>
                            <button
                              type="button"
                              title="Delete"
                              onClick={() => onConfirm({
                                title: "Delete link file",
                                body: `Delete “${f.alias}”? Public path ${f.publicPath} will stop working.`,
                                onOk: () => {
                                  void api.admin.deleteLinkFile(f.id)
                                    .then(() => {
                                      toast.success("Link file deleted");
                                      void loadFiles();
                                    })
                                    .catch((e) => toast.error(e instanceof ApiError ? e.message : "Delete failed"));
                                },
                              })}
                              className="p-1.5 rounded-full hover:bg-black/5"
                              style={{ color: C.error }}
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
            </div>
          </div>
        )}

        {tab === "logs" && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[180px]">
                <Field label="Search logs" value={logSearch} onChange={setLogSearch} placeholder="Alias, IP, visitor, browser, country…" />
              </div>
              <div className="min-w-[140px]">
                <Field label="Filter alias" value={logAliasFilter} onChange={(v) => { setLogAliasFilter(v); setLogPage(1); }} placeholder="Exact alias" />
              </div>
              <label className="text-xs flex flex-col gap-1" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                Sort
                <select
                  value={`${logSort.sortBy}:${logSort.sortDir}`}
                  onChange={(e) => {
                    const [sortBy, sortDir] = e.target.value.split(":") as [string, "asc" | "desc"];
                    setLogSort({ sortBy, sortDir });
                  }}
                  className="rounded-xl px-3 py-2 text-sm"
                  style={{ background: C.surfaceVar, color: C.onSurface, border: `1px solid ${C.outlineVar}` }}
                >
                  <option value="created_at:desc">Newest</option>
                  <option value="created_at:asc">Oldest</option>
                  <option value="alias:asc">Alias A–Z</option>
                  <option value="alias:desc">Alias Z–A</option>
                  <option value="visitor_label:asc">Visitor A–Z</option>
                  <option value="ip_address:asc">IP</option>
                </select>
              </label>
            </div>

            <div className="rounded-2xl overflow-hidden" style={{ background: C.surface, boxShadow: SH1 }}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ fontFamily: "Roboto" }}>
                  <thead>
                    <tr style={{ background: C.surfaceVar, color: C.onSurfaceVar }}>
                      <th className="p-3 w-10">
                        <input type="checkbox" checked={allLogsSelected} onChange={toggleAllLogs} aria-label="Select all logs" />
                      </th>
                      <th className="text-left p-3 font-medium">Time</th>
                      <th className="text-left p-3 font-medium">Alias</th>
                      <th className="text-left p-3 font-medium">File</th>
                      <th className="text-left p-3 font-medium">Visitor</th>
                      <th className="text-left p-3 font-medium">IP Address</th>
                      <th className="text-left p-3 font-medium">Browser</th>
                      <th className="text-left p-3 font-medium">Platform</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logsLoading && !logsLoaded && (
                      <tr>
                        <td colSpan={8} className="p-8 text-center" style={{ color: C.onSurfaceVar }}>Loading…</td>
                      </tr>
                    )}
                    {!logsLoading && logs.length === 0 && (
                      <tr>
                        <td colSpan={8} className="p-8 text-center" style={{ color: C.onSurfaceVar }}>No access logs</td>
                      </tr>
                    )}
                    {logs.map((l) => (
                      <tr key={l.id} style={{ borderTop: `1px solid ${C.outlineVar}` }}>
                        <td className="p-3">
                          <input
                            type="checkbox"
                            checked={selectedLogIds.has(l.id)}
                            onChange={() => toggleLogSelect(l.id)}
                            aria-label={`Select log ${l.id}`}
                          />
                        </td>
                        <td className="p-3 whitespace-nowrap" style={{ color: C.onSurfaceVar }}>{formatWhen(l.createdAt)}</td>
                        <td className="p-3" style={{ color: C.onSurface }}>{l.alias}</td>
                        <td className="p-3" style={{ color: C.onSurfaceVar }}>{l.originalFilename}</td>
                        <td className="p-3" style={{ color: C.onSurface }}>{l.visitor}</td>
                        <td className="p-3">
                          <IpWithFlag ip={l.ipAddress} country={l.country ?? null} countryCode={l.countryCode ?? null} />
                        </td>
                        <td className="p-3" style={{ color: C.onSurfaceVar }}>{l.browser || "—"}</td>
                        <td className="p-3" style={{ color: C.onSurfaceVar }}>{l.platform || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between p-3 text-xs" style={{ color: C.onSurfaceVar, borderTop: `1px solid ${C.outlineVar}`, fontFamily: "Roboto" }}>
                <span>{logTotal} total</span>
                <div className="flex gap-2 items-center">
                  <button
                    type="button"
                    disabled={logPage <= 1}
                    onClick={() => setLogPage((p) => Math.max(1, p - 1))}
                    className="px-2 py-1 rounded-lg disabled:opacity-40"
                    style={{ background: C.surfaceVar }}
                  >
                    Prev
                  </button>
                  <span>Page {logPage} / {logPages}</span>
                  <button
                    type="button"
                    disabled={logPage >= logPages}
                    onClick={() => setLogPage((p) => Math.min(logPages, p + 1))}
                    className="px-2 py-1 rounded-lg disabled:opacity-40"
                    style={{ background: C.surfaceVar }}
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }}>
          <div className="w-full max-w-md rounded-2xl p-6 space-y-4" style={{ background: C.surface, boxShadow: SH1 }}>
            <h3 className="text-lg font-medium" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
              {edit.id ? "Edit link file" : "Upload link file"}
            </h3>
            <Field
              label="Public path (alias)"
              value={alias}
              onChange={setAlias}
              placeholder="mybg"
            />
            <p className="text-xs" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Letters, numbers, hyphens, and underscores only. Accessible at /externals/{alias.trim() || "…"}
            </p>
            <div>
              <p className="text-xs mb-1" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                File {edit.id ? "(optional replace)" : ""} — jpg, jpeg, png, gif, webp, mp4, pdf
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept={ALLOWED_ACCEPT}
                onChange={(e) => setEditFile(e.target.files?.[0] || null)}
                className="block w-full text-sm"
                style={{ color: C.onSurface, fontFamily: "Roboto" }}
              />
              {editFile && (
                <p className="text-xs mt-1" style={{ color: C.onSurfaceVar }}>{editFile.name} · {formatBytes(editFile.size)}</p>
              )}
              {!editFile && edit.originalFilename && (
                <p className="text-xs mt-1" style={{ color: C.onSurfaceVar }}>Current: {edit.originalFilename}</p>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              Active (publicly accessible)
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <OutlinedBtn onClick={() => { setEdit(null); setEditFile(null); }} disabled={saving}>Cancel</OutlinedBtn>
              <FilledBtn onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save"}</FilledBtn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
