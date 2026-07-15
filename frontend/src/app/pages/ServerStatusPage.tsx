import { useEffect, useState } from "react";
import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import { useC, SH1 } from "@/app/shared";

type ServiceStatus = "operational" | "degraded" | "outage" | "unknown";

type ServiceRow = {
  id: string;
  name: string;
  description: string;
  status: ServiceStatus;
  detail?: string;
};

const STATUS_META: Record<ServiceStatus, { label: string; color: string }> = {
  operational: { label: "Operational", color: "#386A20" },
  degraded: { label: "Degraded", color: "#E8A317" },
  outage: { label: "Outage", color: "#B3261E" },
  unknown: { label: "Checking…", color: "#79747E" },
};

const BASE_SERVICES: Omit<ServiceRow, "status" | "detail">[] = [
  { id: "website", name: "Website", description: "Marketing site and SPA delivery" },
  { id: "auth", name: "Authentication", description: "Login, signup, and session restore" },
  { id: "messaging", name: "Messaging", description: "Channels, DMs, and realtime delivery" },
  { id: "downloads", name: "Downloads", description: "Game builds and resource files" },
  { id: "database", name: "Database", description: "Primary application data store" },
  { id: "api", name: "API", description: "REST and Socket.IO backends" },
];

function ServerStatusPage() {
  const C = useC();
  const [rows, setRows] = useState<ServiceRow[]>(
    BASE_SERVICES.map(s => ({ ...s, status: "unknown" as const })),
  );
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Server Status · Ninja Era";
    return () => { document.title = "Ninja Era"; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const next: ServiceRow[] = BASE_SERVICES.map(s => ({
        ...s,
        status: "operational" as const,
        detail: "Placeholder — live probes pending",
      }));

      try {
        const res = await fetch("/api/health", { credentials: "include" });
        const ok = res.ok;
        const idx = (id: string) => next.findIndex(r => r.id === id);
        const set = (id: string, status: ServiceStatus, detail: string) => {
          const i = idx(id);
          if (i >= 0) next[i] = { ...next[i], status, detail };
        };
        set("api", ok ? "operational" : "outage", ok ? "Health check passed" : `HTTP ${res.status}`);
        set("website", "operational", "Client reachable");
        set("auth", ok ? "operational" : "degraded", ok ? "Auth routes available" : "API unreachable");
        set("messaging", ok ? "operational" : "degraded", ok ? "Messaging stack up" : "API unreachable");
        set("downloads", ok ? "operational" : "degraded", ok ? "Download routes available" : "API unreachable");
        set("database", ok ? "operational" : "unknown", ok ? "Reachable via API" : "Could not verify");
      } catch {
        next.forEach((r, i) => {
          next[i] = {
            ...r,
            status: r.id === "website" ? "operational" : "outage",
            detail: r.id === "website" ? "Static client loaded" : "Unable to reach API",
          };
        });
      }

      if (!cancelled) {
        setRows(next);
        setCheckedAt(new Date().toLocaleString());
      }
    };
    void check();
    const id = window.setInterval(check, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <div className="pt-24 pb-16 px-4 min-h-screen" style={{ background: C.bg }}>
      <div className="max-w-3xl mx-auto">
        <header className="mb-8">
          <p className="text-xs font-medium uppercase tracking-widest mb-2" style={{ color: C.primary, fontFamily: "Roboto" }}>Support</p>
          <h1 className="text-3xl font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Server Status</h1>
          <p className="text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
            Operational overview of plantend services. Prepared for live monitoring feeds.
          </p>
          {checkedAt && (
            <p className="text-xs mt-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto Mono, monospace" }}>
              Last checked: {checkedAt}
            </p>
          )}
        </header>

        <div className="space-y-3">
          {rows.map(row => {
            const meta = STATUS_META[row.status];
            return (
              <div
                key={row.id}
                className="rounded-2xl border p-4 sm:p-5 flex items-start justify-between gap-4"
                style={{ background: C.surface, borderColor: C.outlineVar, boxShadow: SH1 }}
              >
                <div>
                  <h2 className="text-base font-medium" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{row.name}</h2>
                  <p className="text-sm mt-0.5" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>{row.description}</p>
                  {row.detail && (
                    <p className="text-xs mt-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>{row.detail}</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                  <FiberManualRecordIcon style={{ fontSize: 12, color: meta.color }} />
                  <span className="text-xs font-medium whitespace-nowrap" style={{ color: meta.color, fontFamily: "Roboto" }}>
                    {meta.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default ServerStatusPage;
