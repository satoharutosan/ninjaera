import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import BackupIcon from "@mui/icons-material/Backup";
import DeleteIcon from "@mui/icons-material/Delete";
import DownloadIcon from "@mui/icons-material/Download";
import RefreshIcon from "@mui/icons-material/Refresh";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import BlockIcon from "@mui/icons-material/Block";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { useC, SH1, FilledBtn, OutlinedBtn, Chip } from "@/app/shared";
import {
  api,
  ApiError,
  type VersionBackupRecord,
  type UploadProgress,
} from "@/app/api";
import {
  AdminUploadProgress,
  type AdminUploadProgressState,
} from "@/features/admin/components/AdminUploadProgress";

type ConfirmState = { title: string; body: string; onOk: () => void };

function formatBytes(n: number) {
  if (!n || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function AdminTelegramBackup({
  onConfirm,
}: {
  onConfirm: (c: ConfirmState) => void;
}) {
  const C = useC();
  const [files, setFiles] = useState<VersionBackupRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<VersionBackupRecord | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<AdminUploadProgressState | null>(null);
  const [uploadBytes, setUploadBytes] = useState<{ loaded: number; total: number } | null>(null);
  const [allowedExt, setAllowedExt] = useState<string[]>([".zip", ".7z", ".rar", ".tar", ".gz", ".tgz", ".bz2", ".xz"]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.admin.versionBackups();
      setFiles(res.files || []);
      if (res.allowedExtensions?.length) setAllowedExt(res.allowedExtensions);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Unable to load backups");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onPickFile = async (file: File | null) => {
    if (!file || uploading) return;
    const ext = `.${(file.name.split(".").pop() || "").toLowerCase()}`;
    if (!allowedExt.map((a) => a.toLowerCase()).includes(ext)) {
      toast.error(`Invalid file type. Allowed: ${allowedExt.join(", ")}`);
      return;
    }
    setUploading(true);
    setUploadProgress({ filename: file.name, percent: 0, phase: "uploading" });
    setUploadBytes({ loaded: 0, total: file.size });
    try {
      const form = new FormData();
      form.append("file", file);
      await api.admin.createVersionBackup(form, {
        onUploadProgress: (p: UploadProgress) => {
          const percent = p.total ? Math.round((p.loaded / p.total) * 100) : 0;
          setUploadBytes({ loaded: p.loaded, total: p.total || file.size });
          setUploadProgress({
            filename: file.name,
            percent,
            phase: percent >= 100 ? "processing" : "uploading",
          });
        },
      });
      setUploadProgress({ filename: file.name, percent: 100, phase: "complete" });
      toast.success("Backup uploaded");
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      setUploadProgress(null);
      setUploadBytes(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const toggleStatus = (f: VersionBackupRecord) => {
    const next = f.status === "active" ? "disabled" : "active";
    onConfirm({
      title: next === "disabled" ? "Disable backup" : "Enable backup",
      body: `${next === "disabled" ? "Disable" : "Enable"} "${f.originalName}"?`,
      onOk: async () => {
        try {
          await api.admin.updateVersionBackupStatus(f.id, next);
          toast.success(next === "disabled" ? "Disabled" : "Enabled");
          await load();
        } catch (e) {
          toast.error(e instanceof ApiError ? e.message : "Update failed");
        }
      },
    });
  };

  const remove = (f: VersionBackupRecord) => {
    onConfirm({
      title: "Delete backup",
      body: `Permanently delete "${f.originalName}"? The stored file will be removed.`,
      onOk: async () => {
        try {
          await api.admin.deleteVersionBackup(f.id);
          toast.success("Deleted");
          if (detail?.id === f.id) setDetail(null);
          await load();
        } catch (e) {
          toast.error(e instanceof ApiError ? e.message : "Delete failed");
        }
      },
    });
  };

  const download = async (f: VersionBackupRecord) => {
    try {
      await api.admin.downloadVersionBackup(f.id);
      toast.success(`Downloading ${f.originalName}`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Download failed");
    }
  };

  return (
    <div className="space-y-4 p-4 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-medium flex items-center gap-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
            <BackupIcon style={{ color: C.primary }} />
            Telegram Backup Management
          </h2>
          <p className="text-sm mt-1" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
            Manage archives uploaded via{" "}
            <code style={{ fontFamily: "Roboto Mono, monospace" }}>POST /api/versionbackup</code>
            {" "}(CMD/curl). Allowed: {allowedExt.join(", ")}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <OutlinedBtn onClick={() => void load()} cls="inline-flex items-center gap-1" disabled={loading}>
            <RefreshIcon style={{ fontSize: 18 }} /> Refresh
          </OutlinedBtn>
          <FilledBtn
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            cls="inline-flex items-center gap-1"
          >
            <UploadFileIcon style={{ fontSize: 18 }} /> Upload
          </FilledBtn>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept={allowedExt.join(",")}
            onChange={(e) => void onPickFile(e.target.files?.[0] || null)}
          />
        </div>
      </div>

      {uploadProgress && (
        <AdminUploadProgress
          state={uploadProgress}
          loaded={uploadBytes?.loaded}
          total={uploadBytes?.total}
        />
      )}

      <div className="rounded-2xl overflow-hidden border" style={{ borderColor: C.outlineVar, background: C.surface, boxShadow: SH1 }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ fontFamily: "Roboto" }}>
            <thead>
              <tr style={{ background: C.surfaceVar }}>
                <th className="text-left px-4 py-3 font-medium" style={{ color: C.onSurfaceVar }}>File Name</th>
                <th className="text-left px-4 py-3 font-medium" style={{ color: C.onSurfaceVar }}>Size</th>
                <th className="text-left px-4 py-3 font-medium" style={{ color: C.onSurfaceVar }}>Upload Date</th>
                <th className="text-left px-4 py-3 font-medium" style={{ color: C.onSurfaceVar }}>IP</th>
                <th className="text-left px-4 py-3 font-medium" style={{ color: C.onSurfaceVar }}>Downloads</th>
                <th className="text-left px-4 py-3 font-medium" style={{ color: C.onSurfaceVar }}>Status</th>
                <th className="text-right px-4 py-3 font-medium" style={{ color: C.onSurfaceVar }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id} className="border-t" style={{ borderColor: C.outlineVar }}>
                  <td className="px-4 py-3" style={{ color: C.onSurface }}>
                    <button
                      type="button"
                      className="text-left hover:underline"
                      style={{ color: C.primary }}
                      onClick={() => setDetail(f)}
                      title="View details"
                    >
                      {f.originalName}
                    </button>
                    <div className="text-[11px] mt-0.5" style={{ color: C.onSurfaceVar, fontFamily: "Roboto Mono, monospace" }}>
                      {f.storedName}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap" style={{ color: C.onSurfaceVar }}>{formatBytes(f.size)}</td>
                  <td className="px-4 py-3 whitespace-nowrap" style={{ color: C.onSurfaceVar }}>{formatWhen(f.uploadedAt)}</td>
                  <td className="px-4 py-3 whitespace-nowrap" style={{ color: C.onSurfaceVar, fontFamily: "Roboto Mono, monospace" }}>
                    {f.uploaderIp || "—"}
                  </td>
                  <td className="px-4 py-3" style={{ color: C.onSurfaceVar }}>{f.downloads}</td>
                  <td className="px-4 py-3">
                    <Chip
                      label={f.status}
                      color={f.status === "active" ? "#386A20" : C.error}
                      filled={f.status === "active"}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        title="Details"
                        onClick={() => setDetail(f)}
                        className="p-1.5 rounded-full hover:bg-black/5"
                        style={{ color: C.onSurfaceVar }}
                      >
                        <InfoOutlinedIcon style={{ fontSize: 18 }} />
                      </button>
                      <button
                        type="button"
                        title="Download"
                        disabled={f.status !== "active"}
                        onClick={() => void download(f)}
                        className="p-1.5 rounded-full hover:bg-black/5 disabled:opacity-30"
                        style={{ color: C.primary }}
                      >
                        <DownloadIcon style={{ fontSize: 18 }} />
                      </button>
                      <button
                        type="button"
                        title={f.status === "active" ? "Disable" : "Enable"}
                        onClick={() => toggleStatus(f)}
                        className="p-1.5 rounded-full hover:bg-black/5"
                        style={{ color: C.onSurfaceVar }}
                      >
                        {f.status === "active"
                          ? <BlockIcon style={{ fontSize: 18 }} />
                          : <CheckCircleIcon style={{ fontSize: 18 }} />}
                      </button>
                      <button
                        type="button"
                        title="Delete"
                        onClick={() => remove(f)}
                        className="p-1.5 rounded-full hover:bg-black/5"
                        style={{ color: C.error }}
                      >
                        <DeleteIcon style={{ fontSize: 18 }} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && files.length === 0 && (
            <p className="text-center py-12 text-sm" style={{ color: C.onSurfaceVar }}>No backup files yet</p>
          )}
          {loading && (
            <p className="text-center py-12 text-sm" style={{ color: C.onSurfaceVar }}>Loading…</p>
          )}
        </div>
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDetail(null)}>
          <div
            className="rounded-3xl p-6 w-full max-w-lg space-y-3"
            style={{ background: C.surface, boxShadow: SH1 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-medium text-lg" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Backup details</h3>
            <dl className="text-sm space-y-2" style={{ fontFamily: "Roboto", color: C.onSurfaceVar }}>
              <div><dt className="text-xs">Original name</dt><dd style={{ color: C.onSurface }}>{detail.originalName}</dd></div>
              <div><dt className="text-xs">Stored name</dt><dd style={{ fontFamily: "Roboto Mono, monospace" }}>{detail.storedName}</dd></div>
              <div><dt className="text-xs">Storage path</dt><dd style={{ fontFamily: "Roboto Mono, monospace", wordBreak: "break-all" }}>{detail.path}</dd></div>
              <div className="grid grid-cols-2 gap-3">
                <div><dt className="text-xs">Size</dt><dd>{formatBytes(detail.size)}</dd></div>
                <div><dt className="text-xs">Extension</dt><dd>{detail.extension}</dd></div>
                <div><dt className="text-xs">Downloads</dt><dd>{detail.downloads}</dd></div>
                <div><dt className="text-xs">Status</dt><dd>{detail.status}</dd></div>
                <div><dt className="text-xs">Upload IP</dt><dd style={{ fontFamily: "Roboto Mono, monospace" }}>{detail.uploaderIp || "—"}</dd></div>
                <div><dt className="text-xs">Uploaded</dt><dd>{formatWhen(detail.uploadedAt)}</dd></div>
              </div>
            </dl>
            <div className="flex justify-end gap-2 pt-2">
              <OutlinedBtn onClick={() => setDetail(null)}>Close</OutlinedBtn>
              <FilledBtn onClick={() => void download(detail)} disabled={detail.status !== "active"}>Download</FilledBtn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
