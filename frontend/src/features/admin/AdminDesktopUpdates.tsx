import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import SystemUpdateAltIcon from "@mui/icons-material/SystemUpdateAlt";
import DeleteIcon from "@mui/icons-material/Delete";
import PublishIcon from "@mui/icons-material/Publish";
import UnpublishedIcon from "@mui/icons-material/Unpublished";
import RefreshIcon from "@mui/icons-material/Refresh";
import EditIcon from "@mui/icons-material/Edit";
import { useC, SH1, FilledBtn, OutlinedBtn, Field, Chip } from "@/app/shared";
import { appDisplayName } from "@/shared/appRegistry";
import { api, ApiError, type DesktopReleaseRecord } from "@/app/api";

type ConfirmState = { title: string; body: string; onOk: () => void };

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function toDatetimeLocalValue(iso: string | null | undefined) {
  if (!iso) {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AdminDesktopUpdates({
  onConfirm,
}: {
  onConfirm: (c: ConfirmState) => void;
}) {
  const C = useC();
  const [releases, setReleases] = useState<DesktopReleaseRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [apps, setApps] = useState<{ id: string; name: string }[]>([]);
  const [channels, setChannels] = useState<string[]>(["stable", "beta", "development"]);
  const [appFilter, setAppFilter] = useState("messenger");
  const [channelFilter, setChannelFilter] = useState("stable");

  const [editingId, setEditingId] = useState<number | null>(null);
  const [appId, setAppId] = useState("messenger");
  const [version, setVersion] = useState("");
  const [channel, setChannel] = useState("stable");
  const [githubUrl, setGithubUrl] = useState("");
  const [releaseNotes, setReleaseNotes] = useState("");
  const [minSupported, setMinSupported] = useState("");
  const [checksum, setChecksum] = useState("");
  const [publishDate, setPublishDate] = useState(toDatetimeLocalValue(null));
  const [publishOnSave, setPublishOnSave] = useState(true);
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setEditingId(null);
    setAppId("messenger");
    setVersion("");
    setChannel("stable");
    setGithubUrl("");
    setReleaseNotes("");
    setMinSupported("");
    setChecksum("");
    setPublishDate(toDatetimeLocalValue(null));
    setPublishOnSave(true);
  };

  const loadMeta = useCallback(async () => {
    try {
      const meta = await api.admin.desktopReleasesMeta();
      setApps(meta.apps || []);
      setChannels(meta.channels || ["stable", "beta", "development"]);
    } catch {
      /* ignore */
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: "1", limit: "50" };
      if (appFilter) params.appId = appFilter;
      if (channelFilter) params.channel = channelFilter;
      const res = await api.admin.desktopReleases(params);
      setReleases(res.releases);
      setTotal(res.total);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Unable to load releases");
    } finally {
      setLoading(false);
    }
  }, [appFilter, channelFilter]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    void load();
  }, [load]);

  const startEdit = (r: DesktopReleaseRecord) => {
    setEditingId(r.id);
    setAppId(r.appId);
    setVersion(r.version);
    setChannel(r.channel);
    setGithubUrl(r.githubReleaseUrl || "");
    setReleaseNotes(r.releaseNotes || "");
    setMinSupported(r.minSupportedVersion || "");
    setChecksum(r.checksum || "");
    setPublishDate(toDatetimeLocalValue(r.publishedAt));
    setPublishOnSave(false);
  };

  const onSave = async () => {
    if (!version.trim()) {
      toast.error("Version is required (e.g. 1.4.2)");
      return;
    }
    if (!githubUrl.trim()) {
      toast.error("GitHub Release URL is required");
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await api.admin.updateDesktopRelease(editingId, {
          githubReleaseUrl: githubUrl.trim(),
          releaseNotes,
          minSupportedVersion: minSupported.trim() || undefined,
          checksum: checksum.trim() || null,
          publishDate: publishDate ? new Date(publishDate).toISOString() : undefined,
          channel,
        });
        toast.success("Release updated");
      } else {
        await api.admin.createDesktopRelease({
          appId,
          version: version.trim(),
          channel,
          githubReleaseUrl: githubUrl.trim(),
          releaseNotes,
          minSupportedVersion: minSupported.trim() || undefined,
          checksum: checksum.trim() || undefined,
          publishDate: publishDate ? new Date(publishDate).toISOString() : undefined,
          publish: publishOnSave,
        });
        toast.success(publishOnSave ? "Release created and published" : "Release saved as draft");
      }
      resetForm();
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const publish = (r: DesktopReleaseRecord) => {
    onConfirm({
      title: "Publish release",
      body: `Publish ${appDisplayName(r.appId)} ${r.version} (${r.channel})? Clients will download the installer from GitHub automatically.`,
      onOk: async () => {
        try {
          await api.admin.publishDesktopRelease(r.id);
          toast.success("Published");
          await load();
        } catch (e) {
          toast.error(e instanceof ApiError ? e.message : "Publish failed");
        }
      },
    });
  };

  const unpublish = (r: DesktopReleaseRecord) => {
    onConfirm({
      title: "Unpublish release",
      body: `Unpublish ${r.version}? The update feed will have no package until another release is published.`,
      onOk: async () => {
        try {
          await api.admin.unpublishDesktopRelease(r.id);
          toast.success("Unpublished");
          await load();
        } catch (e) {
          toast.error(e instanceof ApiError ? e.message : "Unpublish failed");
        }
      },
    });
  };

  const remove = (r: DesktopReleaseRecord) => {
    onConfirm({
      title: "Delete release",
      body: `Permanently delete metadata for ${r.version}? (Installer files on GitHub are not deleted.)`,
      onOk: async () => {
        try {
          await api.admin.deleteDesktopRelease(r.id);
          toast.success("Deleted");
          await load();
        } catch (e) {
          toast.error(e instanceof ApiError ? e.message : "Delete failed");
        }
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-medium flex items-center gap-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
            <SystemUpdateAltIcon style={{ color: C.primary }} />
            Desktop App Updates
          </h2>
          <p className="text-sm mt-1" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
            Manage release metadata and GitHub download links only. Installers are hosted on GitHub Releases —
            the backend never stores or proxies update packages.
          </p>
        </div>
        <OutlinedBtn onClick={() => void load()} cls="inline-flex items-center gap-1">
          <RefreshIcon style={{ fontSize: 18 }} /> Refresh
        </OutlinedBtn>
      </div>

      <div className="rounded-2xl p-5 space-y-4" style={{ background: C.surface, boxShadow: SH1 }}>
        <h3 className="text-base font-medium" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
          {editingId ? `Edit release #${editingId}` : "Create release"}
        </h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-xs flex flex-col gap-1" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
            Application
            <select
              value={appId}
              disabled={!!editingId}
              onChange={(e) => setAppId(e.target.value)}
              className="rounded-xl px-3 py-2 text-sm"
              style={{ background: C.surfaceVar, color: C.onSurface, border: `1px solid ${C.outlineVar}` }}
            >
              {(apps.length ? apps : [{ id: "messenger", name: "Ninja Era Messenger" }]).map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs flex flex-col gap-1" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
            Release channel
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="rounded-xl px-3 py-2 text-sm"
              style={{ background: C.surfaceVar, color: C.onSurface, border: `1px solid ${C.outlineVar}` }}
            >
              {channels.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <Field label="Version" value={version} onChange={setVersion} placeholder="1.4.2" />
          <Field
            label="Publish date"
            type="datetime-local"
            value={publishDate}
            onChange={setPublishDate}
          />
        </div>
        <Field
          label="GitHub Release URL"
          value={githubUrl}
          onChange={setGithubUrl}
          placeholder="https://github.com/org/repo/releases/download/v1.4.2/NinjaEraMessenger-Setup-1.4.2.exe"
        />
        <Field label="Release notes" value={releaseNotes} onChange={setReleaseNotes} placeholder="What’s new…" rows={3} />
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Minimum supported version (optional)" value={minSupported} onChange={setMinSupported} placeholder="1.0.0" />
          <Field label="SHA-256 checksum (optional)" value={checksum} onChange={setChecksum} placeholder="64-char hex digest" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {!editingId && (
            <label className="flex items-center gap-2 text-sm" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
              <input type="checkbox" checked={publishOnSave} onChange={(e) => setPublishOnSave(e.target.checked)} />
              Publish immediately
            </label>
          )}
          <FilledBtn onClick={() => void onSave()} disabled={saving}>
            {saving ? "Saving…" : editingId ? "Save changes" : "Create release"}
          </FilledBtn>
          {editingId && (
            <OutlinedBtn onClick={resetForm}>Cancel edit</OutlinedBtn>
          )}
        </div>
        <p className="text-xs" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
          Attach the installer to a GitHub Release, then paste the asset download URL here.
          Clients download directly from GitHub after reading this metadata.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <label className="text-xs flex flex-col gap-1" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
          Filter app
          <select
            value={appFilter}
            onChange={(e) => setAppFilter(e.target.value)}
            className="rounded-xl px-3 py-2 text-sm"
            style={{ background: C.surfaceVar, color: C.onSurface, border: `1px solid ${C.outlineVar}` }}
          >
            {(apps.length ? apps : [{ id: "messenger", name: "Messenger" }]).map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs flex flex-col gap-1" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
          Filter channel
          <select
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
            className="rounded-xl px-3 py-2 text-sm"
            style={{ background: C.surfaceVar, color: C.onSurface, border: `1px solid ${C.outlineVar}` }}
          >
            {channels.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background: C.surface, boxShadow: SH1 }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ fontFamily: "Roboto" }}>
            <thead>
              <tr style={{ background: C.surfaceVar, color: C.onSurfaceVar }}>
                <th className="text-left p-3 font-medium">App</th>
                <th className="text-left p-3 font-medium">Version</th>
                <th className="text-left p-3 font-medium">Channel</th>
                <th className="text-left p-3 font-medium">GitHub URL</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-left p-3 font-medium">Published</th>
                <th className="text-left p-3 font-medium w-40" />
              </tr>
            </thead>
            <tbody>
              {loading && releases.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center" style={{ color: C.onSurfaceVar }}>Loading…</td>
                </tr>
              )}
              {!loading && releases.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center" style={{ color: C.onSurfaceVar }}>No releases yet</td>
                </tr>
              )}
              {releases.map((r) => (
                <tr key={r.id} style={{ borderTop: `1px solid ${C.outlineVar}` }}>
                  <td className="p-3" style={{ color: C.onSurface }}>{appDisplayName(r.appId, r.appName)}</td>
                  <td className="p-3 font-medium" style={{ color: C.onSurface }}>{r.version}</td>
                  <td className="p-3 capitalize" style={{ color: C.onSurfaceVar }}>{r.channel}</td>
                  <td className="p-3 text-xs max-w-[280px]">
                    {r.githubReleaseUrl ? (
                      <a
                        href={r.githubReleaseUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="underline break-all"
                        style={{ color: C.primary }}
                      >
                        {r.githubReleaseUrl}
                      </a>
                    ) : (
                      <span style={{ color: C.error }}>Missing URL</span>
                    )}
                  </td>
                  <td className="p-3">
                    {r.published ? <Chip label="Published" /> : <span style={{ color: C.onSurfaceVar }}>Draft</span>}
                  </td>
                  <td className="p-3 whitespace-nowrap" style={{ color: C.onSurfaceVar }}>{formatWhen(r.publishedAt)}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-1">
                      <button type="button" className="p-1.5 rounded-full hover:bg-black/5" style={{ color: C.primary }} onClick={() => startEdit(r)} title="Edit">
                        <EditIcon style={{ fontSize: 18 }} />
                      </button>
                      {!r.published ? (
                        <button type="button" className="p-1.5 rounded-full hover:bg-black/5" style={{ color: C.primary }} onClick={() => publish(r)} title="Publish">
                          <PublishIcon style={{ fontSize: 18 }} />
                        </button>
                      ) : (
                        <button type="button" className="p-1.5 rounded-full hover:bg-black/5" style={{ color: C.onSurfaceVar }} onClick={() => unpublish(r)} title="Unpublish">
                          <UnpublishedIcon style={{ fontSize: 18 }} />
                        </button>
                      )}
                      <button type="button" className="p-1.5 rounded-full hover:bg-black/5" style={{ color: C.error }} onClick={() => remove(r)} title="Delete">
                        <DeleteIcon style={{ fontSize: 18 }} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-3 text-xs" style={{ color: C.onSurfaceVar, borderTop: `1px solid ${C.outlineVar}`, fontFamily: "Roboto" }}>
          {total} release(s)
        </div>
      </div>
    </div>
  );
}

export default AdminDesktopUpdates;
