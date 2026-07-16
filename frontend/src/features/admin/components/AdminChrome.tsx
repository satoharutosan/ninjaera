import { memo, useState, type ReactNode } from "react";
import PeopleIcon from "@mui/icons-material/People";
import PersonIcon from "@mui/icons-material/Person";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useC, SH1, FlagImg } from "@/app/shared";
import type { AdminUser } from "@/app/api";
import { formatCountryDisplay, maskIp } from "@/shared/countryIso";

export function UserAvatar({ user, size = 32 }: { user: AdminUser; size?: number }) {
  const C = useC();
  if (user.avatarUrl) {
    return <img src={user.avatarUrl} alt="" className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />;
  }
  return (
    <div className="rounded-full flex items-center justify-center text-white font-medium shrink-0" style={{ width: size, height: size, background: C.primary, fontSize: size * 0.4, fontFamily: "Roboto" }}>
      {user.username?.[0]?.toUpperCase() || <PersonIcon style={{ fontSize: size * 0.5 }} />}
    </div>
  );
}

export const StatCard = memo(function StatCard({ label, value, color, hint, Icon }: { label: string; value: number; color?: string; hint?: string; Icon?: typeof PeopleIcon }) {
  const C = useC();
  // Never render [object Object] — coerce unknown payloads to a safe integer.
  let n = 0;
  if (typeof value === "number" && Number.isFinite(value)) n = Math.trunc(value);
  else if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) n = Math.trunc(parsed);
  }
  const display = n;
  return (
    <div className="rounded-2xl p-4 md:p-5 min-h-[96px] flex flex-col justify-between gap-2" style={{ background: C.surface, boxShadow: SH1 }} role="group" aria-label={`${label}: ${display}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-2xl md:text-3xl font-medium tabular-nums leading-none" style={{ color: color || C.primary, fontFamily: "Roboto" }}>{display.toLocaleString()}</p>
        {Icon && (
          <Icon style={{ fontSize: 32, color: color || C.primary }} aria-hidden className="shrink-0" />
        )}
      </div>
      <div>
        <p className="text-sm font-medium" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{label}</p>
        {hint && <p className="text-[11px] mt-0.5" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>{hint}</p>}
      </div>
    </div>
  );
});

export function DashSection({ title, children, defaultOpen = true, action }: { title: string; children: ReactNode; defaultOpen?: boolean; action?: ReactNode }) {
  const C = useC();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-2xl border overflow-hidden mb-5" style={{ background: C.surface, borderColor: C.outlineVar, boxShadow: SH1 }}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b" style={{ borderColor: C.outlineVar }}>
        <button type="button" onClick={() => setOpen(o => !o)} className="flex items-center gap-2 min-w-0 text-left" aria-expanded={open}>
          <ExpandMoreIcon style={{ fontSize: 22, color: C.onSurfaceVar, transform: open ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.2s" }} />
          <h2 className="text-base font-medium truncate" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{title}</h2>
        </button>
        {action}
      </div>
      {open && <div className="p-4">{children}</div>}
    </section>
  );
}

export function ChartCard({ title, children, summary }: { title: string; children: ReactNode; summary?: string }) {
  const C = useC();
  return (
    <div className="rounded-2xl border p-4 h-full min-h-[280px] flex flex-col" style={{ background: C.surfaceVar, borderColor: C.outlineVar }} role="figure" aria-label={summary || title}>
      <h3 className="text-sm font-medium mb-3" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{title}</h3>
      {summary && <p className="sr-only">{summary}</p>}
      <div className="flex-1 min-h-[200px] w-full">{children}</div>
    </div>
  );
}

export function EmptyNote({ text }: { text: string }) {
  const C = useC();
  return <p className="text-sm py-6 text-center" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>{text}</p>;
}

export function LocationCell({ loc }: { loc: AdminUser["location"] }) {
  const C = useC();
  if (!loc) return <span style={{ color: C.onSurfaceVar, fontFamily: "Roboto", fontSize: 12 }}>No location data</span>;

  if (!loc.isVpn) {
    return (
      <div className="text-xs leading-relaxed" style={{ fontFamily: "Roboto" }}>
        <div className="flex items-center gap-1.5" style={{ color: C.onSurface }}>
          {loc.countryName && <FlagImg country={loc.countryName} size={14} />}
          {formatCountryDisplay(loc.countryName, loc.countryCode)}
        </div>
        <div style={{ color: C.onSurfaceVar, fontFamily: "Roboto Mono, monospace" }}>{maskIp(loc.ip)}</div>
      </div>
    );
  }

  return (
    <div className="text-xs leading-relaxed" style={{ fontFamily: "Roboto" }}>
      <div className="flex items-center gap-1.5" style={{ color: C.onSurface }}>
        {loc.originCountryName && <FlagImg country={loc.originCountryName} size={14} />}
        {loc.originCountryName
          ? formatCountryDisplay(loc.originCountryName, loc.originCountryCode)
          : "Origin unavailable"}
      </div>
      <div style={{ color: C.onSurfaceVar, fontFamily: "Roboto Mono, monospace" }}>
        {loc.originIp ? `Actual IP: ${maskIp(loc.originIp)}` : "Actual IP: unavailable"}
      </div>
      <div className="mt-1.5 pt-1.5 border-t" style={{ borderColor: C.outlineVar }}>
        <span className="font-medium" style={{ color: C.error }}>VPN</span>
        <div className="flex items-center gap-1.5" style={{ color: C.onSurface }}>
          {loc.vpnCountryName && <FlagImg country={loc.vpnCountryName} size={14} />}
          {formatCountryDisplay(loc.vpnCountryName, loc.vpnCountryCode)}
        </div>
        <div style={{ color: C.onSurfaceVar, fontFamily: "Roboto Mono, monospace" }}>VPN IP: {maskIp(loc.vpnIp || loc.ip)}</div>
      </div>
    </div>
  );
}

