import { useEffect, useState, type ReactNode } from "react";
import CloseIcon from "@mui/icons-material/Close";
import { toast } from "sonner";
import { useC } from "@/app/shared";
import { getNinja } from "@/shared/electronBridge";
import type { DesktopSettings } from "../../electron/shared/settings";

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

const CATEGORIES = [
  "General",
  "Notifications",
  "Calls",
  "Downloads",
  "Privacy",
  "Storage",
  "Advanced",
] as const;
type Category = (typeof CATEGORIES)[number];

const ACCENTS = ["#6750A4", "#2E7D32", "#0277BD", "#C62828", "#EF6C00", "#00838F", "#AD1457"];

function fmtBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function SettingsDialog({
  settings,
  onPatch,
  onReset,
  onClose,
  initialCategory = "General",
}: {
  settings: DesktopSettings;
  onPatch: (patch: DeepPartial<DesktopSettings>) => void;
  onReset: () => void;
  onClose: () => void;
  initialCategory?: Category;
}) {
  const C = useC();
  const ninja = getNinja();
  const [cat, setCat] = useState<Category>(initialCategory);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [cacheBytes, setCacheBytes] = useState<number | null>(null);
  const [diag, setDiag] = useState<string>("");
  const [updateStatus, setUpdateStatus] = useState<string>("");

  useEffect(() => setCat(initialCategory), [initialCategory]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then(setDevices)
      .catch(() => {});
    ninja?.storage.cacheInfo().then((r) => setCacheBytes(r.bytes)).catch(() => {});
    if (!ninja) return;
    return ninja.updater.onEvent((e) => {
      if (e.type === "checking") setUpdateStatus("Checking for updates…");
      else if (e.type === "available") setUpdateStatus(`Update ${e.version} available — downloading…`);
      else if (e.type === "not-available") setUpdateStatus("You are on the latest version.");
      else if (e.type === "progress") setUpdateStatus(`Downloading update… ${e.percent}%`);
      else if (e.type === "downloaded") setUpdateStatus(`Update ${e.version} ready. Restart to install.`);
      else if (e.type === "error") setUpdateStatus(`Update error: ${String(e.message)}`);
      else if (e.type === "dev-skip") setUpdateStatus("Updates are only checked in packaged builds.");
    });
  }, [ninja]);

  const cams = devices.filter((d) => d.kind === "videoinput");
  const mics = devices.filter((d) => d.kind === "audioinput");
  const spks = devices.filter((d) => d.kind === "audiooutput");

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-6"
      style={{
        top: "var(--ninja-titlebar-h, 0px)",
        background: "rgba(0,0,0,0.5)",
      }}
      onMouseDown={onClose}
    >
      <div
        className="ninja-scroll flex w-full max-w-3xl rounded-3xl overflow-hidden shadow-2xl"
        style={{ background: C.surface, height: "min(640px, 90vh)" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Category rail */}
        <div className="w-48 shrink-0 py-4 border-r" style={{ background: C.surfaceVar, borderColor: C.outlineVar }}>
          <p className="px-5 pb-3 text-lg font-medium" style={{ color: C.onSurface, fontFamily: "'Trade Winds', cursive" }}>Settings</p>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className="w-full text-left px-5 py-2.5 text-sm transition-colors"
              style={{
                background: cat === c ? C.primaryCont : "transparent",
                // Dark mode primaryCont follows the accent; use on-container ink for contrast.
                color: cat === c ? C.onPrimaryCont : C.onSurfaceVar,
                fontFamily: "Roboto",
                fontWeight: cat === c ? 600 : 400,
              }}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Panel */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: C.outlineVar }}>
            <h2 className="text-base font-medium" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{cat}</h2>
            <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/5" style={{ color: C.onSurfaceVar }}>
              <CloseIcon style={{ fontSize: 20 }} />
            </button>
          </div>

          <div className="ninja-scroll flex-1 overflow-y-auto px-6 py-4">
            {cat === "General" && (
              <Section>
                <Toggle label="Launch at startup" value={settings.general.launchAtStartup} onChange={(v) => onPatch({ general: { launchAtStartup: v } })} />
                <Toggle label="Minimize to tray" value={settings.general.minimizeToTray} onChange={(v) => onPatch({ general: { minimizeToTray: v } })} />
                <Toggle label="Close button minimizes to tray" value={settings.general.closeToTray} onChange={(v) => onPatch({ general: { closeToTray: v } })} />
                <Toggle label="Start minimized" value={settings.general.startMinimized} onChange={(v) => onPatch({ general: { startMinimized: v } })} />
                <SelectRow label="Language" value={settings.general.language} onChange={(v) => onPatch({ general: { language: v } })} options={[["en", "English"], ["ja", "日本語"], ["es", "Español"], ["fr", "Français"], ["de", "Deutsch"]]} />
                <SelectRow label="Theme" value={settings.general.theme} onChange={(v) => onPatch({ general: { theme: v as DesktopSettings["general"]["theme"] } })} options={[["system", "Match system"], ["light", "Light"], ["dark", "Dark"]]} />
                <Row label="Accent color">
                  <div className="flex gap-2">
                    {ACCENTS.map((a) => (
                      <button key={a} onClick={() => onPatch({ general: { accentColor: a } })} className="w-6 h-6 rounded-full" style={{ background: a, outline: settings.general.accentColor === a ? `2px solid ${C.onSurface}` : "none", outlineOffset: 2 }} />
                    ))}
                  </div>
                </Row>
                <Row label={`Font scaling (${Math.round(settings.general.fontScale * 100)}%)`}>
                  <input type="range" min={0.8} max={1.4} step={0.05} value={settings.general.fontScale} onChange={(e) => onPatch({ general: { fontScale: Number(e.target.value) } })} />
                </Row>
                <Toggle label="Compact mode" value={settings.general.compactMode} onChange={(v) => onPatch({ general: { compactMode: v } })} />
              </Section>
            )}

            {cat === "Notifications" && (
              <Section>
                <Toggle label="Enable system notifications" value={settings.notifications.enabled} onChange={(v) => onPatch({ notifications: { enabled: v } })} />
                <Toggle label="Show message preview" value={settings.notifications.preview} onChange={(v) => onPatch({ notifications: { preview: v } })} />
                <Toggle label="Notification sound" value={settings.notifications.sound} onChange={(v) => onPatch({ notifications: { sound: v } })} />
                <Toggle label="Mention-only notifications" value={settings.notifications.mentionOnly} onChange={(v) => onPatch({ notifications: { mentionOnly: v } })} />
                <Toggle label="Mute all notifications" value={settings.notifications.muteAll} onChange={(v) => onPatch({ notifications: { muteAll: v } })} />
                <Toggle label="Quiet hours" value={settings.notifications.quietHours.enabled} onChange={(v) => onPatch({ notifications: { quietHours: { ...settings.notifications.quietHours, enabled: v } } })} />
                {settings.notifications.quietHours.enabled && (
                  <Row label="Quiet hours range">
                    <div className="flex items-center gap-2">
                      <input type="time" value={settings.notifications.quietHours.start} onChange={(e) => onPatch({ notifications: { quietHours: { ...settings.notifications.quietHours, start: e.target.value } } })} style={inputStyle(C)} />
                      <span style={{ color: C.onSurfaceVar }}>to</span>
                      <input type="time" value={settings.notifications.quietHours.end} onChange={(e) => onPatch({ notifications: { quietHours: { ...settings.notifications.quietHours, end: e.target.value } } })} style={inputStyle(C)} />
                    </div>
                  </Row>
                )}
                <Hint>Per-channel notification overrides are available from each conversation's details panel.</Hint>
              </Section>
            )}

            {cat === "Calls" && (
              <Section>
                <SelectRow label="Camera" value={settings.calls.cameraId} onChange={(v) => onPatch({ calls: { cameraId: v } })} options={[["default", "Default"], ...cams.map((d) => [d.deviceId, d.label || "Camera"] as [string, string])]} />
                <SelectRow label="Microphone" value={settings.calls.microphoneId} onChange={(v) => onPatch({ calls: { microphoneId: v } })} options={[["default", "Default"], ...mics.map((d) => [d.deviceId, d.label || "Microphone"] as [string, string])]} />
                <SelectRow label="Speaker" value={settings.calls.speakerId} onChange={(v) => onPatch({ calls: { speakerId: v } })} options={[["default", "Default"], ...spks.map((d) => [d.deviceId, d.label || "Speaker"] as [string, string])]} />
                <Toggle label="Echo cancellation" value={settings.calls.echoCancellation} onChange={(v) => onPatch({ calls: { echoCancellation: v } })} />
                <Toggle label="Noise suppression" value={settings.calls.noiseSuppression} onChange={(v) => onPatch({ calls: { noiseSuppression: v } })} />
                <Toggle label="Automatic gain control" value={settings.calls.autoGainControl} onChange={(v) => onPatch({ calls: { autoGainControl: v } })} />
                <Hint>Device and audio-processing preferences apply the next time you start or accept a call.</Hint>
                {cams.length === 0 && <Hint>Grant camera/microphone permission during a call to see device names.</Hint>}
              </Section>
            )}

            {cat === "Downloads" && (
              <Section>
                <Row label="Default download folder">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs truncate max-w-[220px]" style={{ color: C.onSurfaceVar }}>{settings.downloads.folder}</span>
                    <SmallBtn onClick={async () => {
                      try {
                        const dir = await ninja?.downloads.chooseDir();
                        if (dir) onPatch({ downloads: { folder: dir } });
                      } catch {
                        toast.error("Could not open the folder picker.");
                      }
                    }}>Change</SmallBtn>
                    <SmallBtn onClick={async () => {
                      try {
                        const r = await ninja?.shell.openPath(settings.downloads.folder);
                        if (r && !r.ok) toast.error(r.error || "Could not open the download folder.");
                      } catch {
                        toast.error("Could not open the download folder.");
                      }
                    }}>Open</SmallBtn>
                  </div>
                </Row>
                <Toggle label="Ask before every download" value={settings.downloads.askBeforeDownload} onChange={(v) => onPatch({ downloads: { askBeforeDownload: v } })} />
                <Toggle label="Automatically download media" value={settings.downloads.autoDownloadMedia} onChange={(v) => onPatch({ downloads: { autoDownloadMedia: v } })} />
              </Section>
            )}

            {cat === "Privacy" && (
              <Section>
                <Toggle label="Show my online status" value={settings.privacy.onlineStatusVisible} onChange={(v) => onPatch({ privacy: { onlineStatusVisible: v } })} />
                <Toggle label="Send read receipts" value={settings.privacy.readReceipts} onChange={(v) => onPatch({ privacy: { readReceipts: v } })} />
                <Toggle label="Send typing indicators" value={settings.privacy.typingIndicators} onChange={(v) => onPatch({ privacy: { typingIndicators: v } })} />
                <Toggle label="Share last seen" value={settings.privacy.lastSeen} onChange={(v) => onPatch({ privacy: { lastSeen: v } })} />
                <Hint>Block or unblock a user from their profile in the conversation details panel.</Hint>
              </Section>
            )}

            {cat === "Storage" && (
              <Section>
                <Row label="App cache size">
                  <span className="text-sm" style={{ color: C.onSurfaceVar }}>{cacheBytes == null ? "…" : fmtBytes(cacheBytes)}</span>
                </Row>
                <Row label="Clear media & web cache">
                  <SmallBtn onClick={async () => {
                    try {
                      const res = await ninja?.storage.clearCache();
                      const r = await ninja?.storage.cacheInfo();
                      setCacheBytes(r?.bytes ?? 0);
                      if (res && !res.ok) toast.error("Failed to clear the cache.");
                      else toast.success("Cache cleared.");
                    } catch {
                      toast.error("Failed to clear the cache.");
                    }
                  }}>Clear cache</SmallBtn>
                </Row>
                <Hint>Clearing the cache frees disk space. Downloaded files in your download folder are not affected.</Hint>
              </Section>
            )}

            {cat === "Advanced" && (
              <Section>
                <Toggle label="Hardware acceleration (restart required)" value={settings.advanced.hardwareAcceleration} onChange={(v) => { onPatch({ advanced: { hardwareAcceleration: v } }); }} />
                <Toggle label="Developer mode" value={settings.advanced.developerMode} onChange={(v) => onPatch({ advanced: { developerMode: v } })} />
                <Row label="Network diagnostics">
                  <SmallBtn onClick={async () => {
                    setDiag("Running…");
                    try {
                      const r = await ninja?.diagnostics.network();
                      if (r) setDiag(r.ok ? `OK • ${r.latencyMs}ms • socket ${r.socket}` : `Unreachable • socket ${r.socket}${r.error ? " • " + r.error : ""}`);
                      else setDiag("Diagnostics unavailable.");
                    } catch {
                      setDiag("Diagnostics failed to run.");
                    }
                  }}>Run test</SmallBtn>
                </Row>
                {diag && <Hint>{diag}</Hint>}
                <Row label="Software updates">
                  <SmallBtn onClick={async () => {
                    try { await ninja?.updater.check(); }
                    catch { toast.error("Could not check for updates."); }
                  }}>Check for updates</SmallBtn>
                </Row>
                {updateStatus && (
                  <Hint>
                    {updateStatus}
                    {updateStatus.includes("Restart to install") && (
                      <button className="ml-2 underline" style={{ color: C.primary }} onClick={() => ninja?.updater.quitAndInstall()}>Restart now</button>
                    )}
                  </Hint>
                )}
                <Row label="Restart application">
                  <SmallBtn onClick={() => ninja?.app.relaunch()}>Relaunch</SmallBtn>
                </Row>
                <div className="pt-2">
                  <button onClick={onReset} className="text-sm font-medium" style={{ color: C.error, fontFamily: "Roboto" }}>Reset all settings to defaults</button>
                </div>
              </Section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function inputStyle(C: ReturnType<typeof useC>) {
  return { background: C.surfaceVar, color: C.onSurface, border: `1px solid ${C.outlineVar}`, borderRadius: 8, padding: "4px 8px", fontFamily: "Roboto", fontSize: 13 };
}

function Section({ children }: { children: ReactNode }) {
  return <div className="flex flex-col divide-y" style={{ borderColor: "transparent" }}>{children}</div>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  const C = useC();
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="text-sm" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{label}</span>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const C = useC();
  return (
    <Row label={label}>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className="w-11 h-6 rounded-full transition-colors relative"
        style={{ background: value ? C.primary : C.outlineVar }}
      >
        <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all" style={{ left: value ? 22 : 2 }} />
      </button>
    </Row>
  );
}

function SelectRow({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  const C = useC();
  return (
    <Row label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle(C)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </Row>
  );
}

function SmallBtn({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  const C = useC();
  return (
    <button type="button" onClick={onClick} className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors hover:opacity-90" style={{ background: C.secondaryCont, color: C.onSecondaryCont, fontFamily: "Roboto" }}>
      {children}
    </button>
  );
}

function Hint({ children }: { children: ReactNode }) {
  const C = useC();
  return <p className="text-xs py-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>{children}</p>;
}
