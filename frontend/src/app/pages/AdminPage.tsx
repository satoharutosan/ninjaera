import { useState, useEffect, useCallback, useRef, memo, type ReactNode } from "react";
import DashboardIcon from "@mui/icons-material/Dashboard";
import PeopleIcon from "@mui/icons-material/People";
import NotificationsIcon from "@mui/icons-material/Notifications";
import TagIcon from "@mui/icons-material/Tag";
import WorkIcon from "@mui/icons-material/Work";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import CheckIcon from "@mui/icons-material/Check";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import PushPinIcon from "@mui/icons-material/PushPin";
import BlockIcon from "@mui/icons-material/Block";
import SportsEsportsIcon from "@mui/icons-material/SportsEsports";
import HistoryIcon from "@mui/icons-material/History";
import DownloadIcon from "@mui/icons-material/Download";
import VpnKeyIcon from "@mui/icons-material/VpnKey";
import ContactMailIcon from "@mui/icons-material/ContactMail";
import PersonIcon from "@mui/icons-material/Person";
import StorageIcon from "@mui/icons-material/Storage";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import ChatBubbleIcon from "@mui/icons-material/ChatBubble";
import MailOutlineIcon from "@mui/icons-material/MailOutline";
import InboxIcon from "@mui/icons-material/Inbox";
import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, AreaChart, Area,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { toast } from "sonner";
import {
  Page, useC, SH1, SH2, FilledBtn, OutlinedBtn, TonalBtn, Field, Chip, FlagImg,
} from "@/app/shared";
import { formatCountryDisplay, maskIp } from "@/app/countryIso";
import {
  api, ApiError, type AdminUser, type AdminNotification, type AdminChannel,
  type TeamApplication, type AdminResource, type AdminGameDownload, type ActivityLogEntry,
  type ContactTicket,
} from "@/app/api";
import { onRealtimeEvent } from "@/app/realtime";

type Section = "dashboard" | "users" | "notifications" | "contacts" | "channels" | "applications" | "resources" | "game-downloads" | "activity-logs" | "database";

type DashboardStats = Awaited<ReturnType<typeof api.admin.stats>>;

const EMPTY_STATS: DashboardStats = {
  totalUsers: 0, onlineUsers: 0, totalChannels: 0, totalDms: 0, pendingApplications: 0, teamMembers: 0, unreadNotifications: 0,
  unreadContacts: 0, totalContacts: 0, repliedContacts: 0, pendingContactReplies: 0,
  totalMessages: 0, pendingDmRequests: 0, totalResources: 0, totalDownloads: 0,
  approvedApplications: 0, rejectedApplications: 0,
  userDistribution: [], userGrowth: [], activityTimeline: [], downloadsByPlatform: [],
  mostDownloadedResource: null, recentUsers: [], recentApplications: [], recentContacts: [], recentActivity: [],
};

const CHART_COLORS = ["#6750A4", "#386A20", "#B3261E", "#006A6A", "#7D5260", "#625B71"];

const SECTIONS: { id: Section; label: string; Icon: typeof DashboardIcon }[] = [
  { id: "dashboard", label: "Dashboard", Icon: DashboardIcon },
  { id: "users", label: "Users", Icon: PeopleIcon },
  { id: "contacts", label: "Contact Management", Icon: ContactMailIcon },
  { id: "notifications", label: "Notifications", Icon: NotificationsIcon },
  { id: "channels", label: "Channels", Icon: TagIcon },
  { id: "applications", label: "Teamwork Applications", Icon: WorkIcon },
  { id: "resources", label: "Resources", Icon: MenuBookIcon },
  { id: "game-downloads", label: "Game Downloads", Icon: SportsEsportsIcon },
  { id: "activity-logs", label: "Activity Logs", Icon: HistoryIcon },
  { id: "database", label: "Database", Icon: StorageIcon },
];

function UserAvatar({ user, size = 32 }: { user: AdminUser; size?: number }) {
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

const StatCard = memo(function StatCard({ label, value, color, hint, Icon }: { label: string; value: number; color?: string; hint?: string; Icon?: typeof PeopleIcon }) {
  const C = useC();
  return (
    <div className="rounded-2xl p-4 md:p-5 min-h-[96px] flex flex-col justify-between gap-2" style={{ background: C.surface, boxShadow: SH1 }} role="group" aria-label={`${label}: ${value}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-2xl md:text-3xl font-medium tabular-nums leading-none" style={{ color: color || C.primary, fontFamily: "Roboto" }}>{value.toLocaleString()}</p>
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

function DashSection({ title, children, defaultOpen = true, action }: { title: string; children: ReactNode; defaultOpen?: boolean; action?: ReactNode }) {
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

function ChartCard({ title, children, summary }: { title: string; children: ReactNode; summary?: string }) {
  const C = useC();
  return (
    <div className="rounded-2xl border p-4 h-full min-h-[280px] flex flex-col" style={{ background: C.surfaceVar, borderColor: C.outlineVar }} role="figure" aria-label={summary || title}>
      <h3 className="text-sm font-medium mb-3" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{title}</h3>
      {summary && <p className="sr-only">{summary}</p>}
      <div className="flex-1 min-h-[200px] w-full">{children}</div>
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  const C = useC();
  return <p className="text-sm py-6 text-center" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>{text}</p>;
}

function LocationCell({ loc }: { loc: AdminUser["location"] }) {
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

function AdminPage({ setPage }: { setPage: (p: Page) => void }) {
  const C = useC();
  const [section, setSection] = useState<Section>("dashboard");
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [userFilter, setUserFilter] = useState("active");
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [profileUser, setProfileUser] = useState<AdminUser | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const [contacts, setContacts] = useState<ContactTicket[]>([]);
  const [selectedContact, setSelectedContact] = useState<ContactTicket | null>(null);
  const [contactReply, setContactReply] = useState("");

  const [notifs, setNotifs] = useState<AdminNotification[]>([]);
  const [editNotif, setEditNotif] = useState<Partial<AdminNotification> | null>(null);
  const [notifUserSearch, setNotifUserSearch] = useState("");
  const [notifUserResults, setNotifUserResults] = useState<AdminUser[]>([]);

  const [channels, setChannels] = useState<AdminChannel[]>([]);
  const [editChannel, setEditChannel] = useState<Partial<AdminChannel> | null>(null);

  const [applications, setApplications] = useState<TeamApplication[]>([]);
  const [resources, setResources] = useState<AdminResource[]>([]);
  const [editResource, setEditResource] = useState<Partial<AdminResource> | null>(null);
  const [resourceFile, setResourceFile] = useState<File | null>(null);

  const [gameBuilds, setGameBuilds] = useState<AdminGameDownload[]>([]);
  const [editGameBuild, setEditGameBuild] = useState<Partial<AdminGameDownload> & { platform?: string } | null>(null);
  const [gameBuildFile, setGameBuildFile] = useState<File | null>(null);

  const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([]);
  const [activityTotal, setActivityTotal] = useState(0);
  const [activityPage, setActivityPage] = useState(1);
  const [logFilters, setLogFilters] = useState({ search: "", timeRange: "", userRole: "", eventCategory: "", eventType: "", result: "", isVpn: "" });
  const [selectedLog, setSelectedLog] = useState<ActivityLogEntry | null>(null);

  const [dbInfo, setDbInfo] = useState<{
    type: string; version: string; sizeLabel: string; path: string;
    totalUsers: number; totalMessages: number; totalChannels: number; totalResources: number;
    totalNotifications: number; totalLogs: number; lastBackupAt: string | null; lastBackupFile: string | null;
  } | null>(null);
  const [dbBusy, setDbBusy] = useState<"backup" | "restore" | null>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);

  const [confirm, setConfirm] = useState<{ title: string; body: string; onOk: () => void } | null>(null);

  useEffect(() => {
    api.admin.check()
      .then(() => setAuthorized(true))
      .catch((e: ApiError) => {
        setAuthorized(false);
        if (e.status === 403) { toast.error("Administrator access required"); setPage("home"); }
        else { toast.error("Please log in as an administrator"); setPage("login"); }
      });
  }, [setPage]);

  const loadSection = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!authorized) return;
    const quiet = !!opts?.quiet;
    if (!quiet) setLoading(true);
    try {
      if (section === "dashboard") {
        const s = await api.admin.stats();
        setStats(s);
      } else if (section === "users") {
        const r = await api.admin.users(userSearch || undefined, userFilter);
        setUsers(r.users);
      } else if (section === "contacts") {
        const r = await api.admin.contacts();
        setContacts(r.contacts);
      } else if (section === "notifications") {
        const r = await api.admin.notifications();
        setNotifs(r.notifications);
      } else if (section === "channels") {
        const r = await api.admin.channels();
        setChannels(r.channels);
      } else if (section === "applications") {
        const r = await api.admin.applications();
        setApplications(r.applications);
      } else if (section === "resources") {
        const r = await api.admin.resources();
        setResources(r.resources);
      } else if (section === "game-downloads") {
        const r = await api.admin.gameDownloads();
        setGameBuilds(r.downloads);
      } else if (section === "activity-logs") {
        const params: Record<string, string> = { page: String(activityPage), limit: "50" };
        if (logFilters.search) params.search = logFilters.search;
        if (logFilters.timeRange) params.timeRange = logFilters.timeRange;
        if (logFilters.userRole) params.userRole = logFilters.userRole;
        if (logFilters.eventCategory) params.eventCategory = logFilters.eventCategory;
        if (logFilters.eventType) params.eventType = logFilters.eventType;
        if (logFilters.result) params.result = logFilters.result;
        if (logFilters.isVpn) params.isVpn = logFilters.isVpn;
        const r = await api.admin.activityLogs(params);
        setActivityLogs(r.logs);
        setActivityTotal(r.total);
      } else if (section === "database") {
        const info = await api.admin.databaseInfo();
        setDbInfo(info);
      }
    } catch (e) {
      if (!quiet) toast.error(e instanceof ApiError ? e.message : "Failed to load data");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [authorized, section, userSearch, userFilter, activityPage, logFilters]);

  useEffect(() => { loadSection(); }, [loadSection]);

  const sectionRef = useRef(section);
  sectionRef.current = section;

  const statsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshStatsQuiet = useCallback(() => {
    if (statsTimer.current) clearTimeout(statsTimer.current);
    // Longer debounce — presence + activity flood free-tier CPU if stats refetch constantly.
    statsTimer.current = setTimeout(() => {
      api.admin.stats().then(setStats).catch(() => {});
    }, 1200);
  }, []);

  const refreshActiveSectionQuiet = useCallback((targets: Section[]) => {
    if (!targets.includes(sectionRef.current)) return;
    if (sectionTimer.current) clearTimeout(sectionTimer.current);
    sectionTimer.current = setTimeout(() => {
      void loadSection({ quiet: true });
    }, 600);
  }, [loadSection]);

  useEffect(() => {
    if (!authorized) return;
    const unsubs = [
      onRealtimeEvent("admin:stats", () => {
        refreshStatsQuiet();
        refreshActiveSectionQuiet(["channels", "resources", "game-downloads", "users", "database"]);
      }),
      onRealtimeEvent("admin:activity", () => {
        refreshStatsQuiet();
        refreshActiveSectionQuiet(["activity-logs", "dashboard"]);
      }),
      onRealtimeEvent("admin:contact", () => {
        refreshStatsQuiet();
        refreshActiveSectionQuiet(["contacts", "dashboard"]);
      }),
      onRealtimeEvent("admin:applications", () => {
        refreshStatsQuiet();
        refreshActiveSectionQuiet(["applications", "dashboard"]);
      }),
      onRealtimeEvent("notification:new", () => {
        refreshStatsQuiet();
        refreshActiveSectionQuiet(["notifications", "dashboard"]);
      }),
      onRealtimeEvent("admin:notifications", () => {
        refreshStatsQuiet();
        refreshActiveSectionQuiet(["notifications"]);
      }),
      onRealtimeEvent("presence:update", () => {
        // Only refresh stats on dashboard; users list refreshes separately.
        if (sectionRef.current === "dashboard") {
          refreshStatsQuiet();
        } else if (sectionRef.current === "users") {
          refreshActiveSectionQuiet(["users"]);
        }
      }),
      onRealtimeEvent("team:updated", () => {
        refreshStatsQuiet();
        refreshActiveSectionQuiet(["users", "applications", "dashboard"]);
      }),
      onRealtimeEvent("counts:update", () => {
        refreshStatsQuiet();
      }),
    ];
    return () => {
      unsubs.forEach(u => u());
      if (statsTimer.current) clearTimeout(statsTimer.current);
      if (sectionTimer.current) clearTimeout(sectionTimer.current);
    };
  }, [authorized, refreshStatsQuiet, refreshActiveSectionQuiet]);

  const openUserProfile = async (user: AdminUser) => {
    setProfileLoading(true);
    try {
      const r = await api.admin.getUser(user.id);
      setProfileUser(r.user);
    } catch {
      setProfileUser(user);
    } finally {
      setProfileLoading(false);
    }
  };

  const openContact = async (id: number) => {
    try {
      const r = await api.admin.getContact(id);
      setSelectedContact(r.contact);
      setContactReply("");
      loadSection();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to load contact");
    }
  };

  const sendContactReply = async () => {
    if (!selectedContact || !contactReply.trim()) return;
    try {
      const r = await api.admin.replyContact(selectedContact.id, contactReply.trim());
      setSelectedContact(r.contact);
      setContactReply("");
      toast.success("Reply sent");
      loadSection();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to send reply");
    }
  };

  const searchNotifUsers = async (q: string) => {
    setNotifUserSearch(q);
    if (!q.trim()) { setNotifUserResults([]); return; }
    try {
      const r = await api.admin.users(q, "active");
      setNotifUserResults(r.users);
    } catch { setNotifUserResults([]); }
  };

  const toggleNotifRecipient = (userId: number) => {
    if (!editNotif) return;
    const ids = editNotif.recipientIds || [];
    const next = ids.includes(userId) ? ids.filter(id => id !== userId) : [...ids, userId];
    setEditNotif({ ...editNotif, recipientIds: next });
  };

  const handleUserAction = async (action: () => Promise<unknown>, successMsg: string) => {
    try {
      await action();
      toast.success(successMsg);
      loadSection();
      setEditUser(null);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Action failed");
    }
  };

  if (authorized === null) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-16" style={{ background: C.bg }}>
        <p style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>Verifying access…</p>
      </div>
    );
  }

  if (!authorized) return null;

  return (
    <div className="min-h-screen pt-16 flex" style={{ background: C.bg }}>
      {confirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setConfirm(null)}>
          <div className="rounded-3xl p-6 w-full max-w-sm" style={{ background: C.surface }} onClick={e => e.stopPropagation()}>
            <h3 className="font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{confirm.title}</h3>
            <p className="text-sm mb-6" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>{confirm.body}</p>
            <div className="flex gap-3 justify-end">
              <OutlinedBtn onClick={() => setConfirm(null)}>Cancel</OutlinedBtn>
              <button onClick={() => { confirm.onOk(); setConfirm(null); }} className="px-4 py-2 rounded-full text-sm font-medium text-white" style={{ background: C.error, fontFamily: "Roboto" }}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <aside className="w-64 border-r shrink-0 hidden md:flex flex-col" style={{ background: C.surface, borderColor: C.outlineVar, boxShadow: SH1 }}>
        <div className="p-5 border-b" style={{ borderColor: C.outlineVar }}>
          <h2 className="font-medium text-lg flex items-center gap-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
            <VpnKeyIcon style={{ fontSize: 20, color: C.primary }} /> Administration
          </h2>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {SECTIONS.map(s => (
            <button key={s.id} onClick={() => setSection(s.id)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium transition-all text-left"
              style={{
                background: section === s.id ? C.primaryCont : "transparent",
                color: section === s.id ? C.primary : C.onSurfaceVar,
                fontFamily: "Roboto",
              }}>
              <s.Icon style={{ fontSize: 18 }} />{s.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Mobile section tabs */}
      <div className="md:hidden fixed top-16 left-0 right-0 z-40 overflow-x-auto border-b" style={{ background: C.surface, borderColor: C.outlineVar }}>
        <div className="flex gap-1 p-2">
          {SECTIONS.map(s => (
            <button key={s.id} onClick={() => setSection(s.id)} className="px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap"
              style={{ background: section === s.id ? C.primary : C.surfaceVar, color: section === s.id ? "white" : C.onSurfaceVar, fontFamily: "Roboto" }}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main content */}
      <main className="flex-1 p-4 md:p-8 mt-12 md:mt-0 overflow-y-auto">
        {loading ? (
          <div className="space-y-4 py-4" aria-busy="true" aria-label="Loading">
            <div className="h-8 w-48 rounded-lg animate-pulse" style={{ background: C.surfaceVar }} />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-24 rounded-2xl animate-pulse" style={{ background: C.surfaceVar }} />
              ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="h-64 rounded-2xl animate-pulse" style={{ background: C.surfaceVar }} />
              <div className="h-64 rounded-2xl animate-pulse" style={{ background: C.surfaceVar }} />
            </div>
          </div>
        ) : (
          <>
            {section === "dashboard" && (
              <div>
                <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
                  <div>
                    <h1 className="text-2xl font-medium" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Dashboard</h1>
                    <p className="text-sm mt-1" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>Operational overview across users, messaging, downloads, and team activity.</p>
                  </div>
                </div>

                <DashSection title="Overview" action={
                  <button type="button" onClick={() => loadSection()} className="text-xs font-medium px-3 py-1.5 rounded-full hover:bg-black/5" style={{ color: C.primary, fontFamily: "Roboto" }}>Refresh</button>
                }>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
                    <StatCard label="Total Users" value={stats.totalUsers} Icon={PeopleIcon} />
                    <StatCard label="Online Users" value={stats.onlineUsers} color="#386A20" Icon={FiberManualRecordIcon} />
                    <StatCard label="Administrators" value={stats.userDistribution.find(d => d.name === "Administrators")?.value ?? 0} Icon={AdminPanelSettingsIcon} />
                    <StatCard label="Team Members" value={stats.teamMembers} Icon={WorkIcon} />
                    <StatCard label="Pending Applications" value={stats.pendingApplications} color="#B3261E" Icon={InboxIcon} />
                    <StatCard label="Pending DM Requests" value={stats.pendingDmRequests} color="#B3261E" Icon={ChatBubbleIcon} />
                    <StatCard label="Unread Contacts" value={stats.unreadContacts} color="#B3261E" Icon={MailOutlineIcon} />
                    <StatCard label="Notifications" value={stats.unreadNotifications} Icon={NotificationsIcon} />
                    <StatCard label="Resources" value={stats.totalResources} Icon={MenuBookIcon} />
                    <StatCard label="Total Downloads" value={stats.totalDownloads} Icon={DownloadIcon} />
                    <StatCard label="Total Messages" value={stats.totalMessages} Icon={ChatBubbleIcon} />
                    <StatCard label="Active Channels" value={stats.totalChannels} Icon={TagIcon} />
                  </div>
                </DashSection>

                <DashSection title="Insights">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <ChartCard title="User Growth (14 days)" summary={`Registrations over the last 14 days. Total recent: ${stats.userGrowth.reduce((s, d) => s + d.count, 0)}`}>
                      {stats.userGrowth.some(d => d.count > 0) ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={stats.userGrowth} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={C.outlineVar} />
                            <XAxis dataKey="label" tick={{ fill: C.onSurfaceVar, fontSize: 11 }} />
                            <YAxis allowDecimals={false} tick={{ fill: C.onSurfaceVar, fontSize: 11 }} width={32} />
                            <Tooltip contentStyle={{ background: C.surface, border: `1px solid ${C.outlineVar}`, borderRadius: 12, fontFamily: "Roboto", fontSize: 12 }} />
                            <Line type="monotone" dataKey="count" name="Registrations" stroke={C.primary} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} isAnimationActive={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      ) : <EmptyNote text="No registrations in the last 14 days" />}
                    </ChartCard>

                    <ChartCard title="Downloads by Platform" summary={`Windows ${stats.downloadsByPlatform.find(p => p.platform === "windows")?.count ?? 0}, Android ${stats.downloadsByPlatform.find(p => p.platform === "android")?.count ?? 0}, iOS ${stats.downloadsByPlatform.find(p => p.platform === "ios")?.count ?? 0}`}>
                      {stats.downloadsByPlatform.some(d => d.count > 0) ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={stats.downloadsByPlatform} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={C.outlineVar} />
                            <XAxis dataKey="label" tick={{ fill: C.onSurfaceVar, fontSize: 11 }} />
                            <YAxis allowDecimals={false} tick={{ fill: C.onSurfaceVar, fontSize: 11 }} width={32} />
                            <Tooltip contentStyle={{ background: C.surface, border: `1px solid ${C.outlineVar}`, borderRadius: 12, fontFamily: "Roboto", fontSize: 12 }} />
                            <Bar dataKey="count" name="Downloads" fill={C.primary} radius={[8, 8, 0, 0]} isAnimationActive={false} />
                          </BarChart>
                        </ResponsiveContainer>
                      ) : <EmptyNote text="No platform downloads recorded yet" />}
                    </ChartCard>

                    <ChartCard title="User Distribution" summary={stats.userDistribution.map(d => `${d.name}: ${d.value}`).join(", ")}>
                      {stats.userDistribution.some(d => d.value > 0) ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={stats.userDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={78} paddingAngle={2}>
                              {stats.userDistribution.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                            </Pie>
                            <Tooltip contentStyle={{ background: C.surface, border: `1px solid ${C.outlineVar}`, borderRadius: 12, fontFamily: "Roboto", fontSize: 12 }} />
                            <Legend wrapperStyle={{ fontFamily: "Roboto", fontSize: 12 }} />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : <EmptyNote text="No user distribution data" />}
                    </ChartCard>

                    <ChartCard title="Activity Timeline (14 days)" summary="Messages, downloads, and logins over the last 14 days">
                      {stats.activityTimeline.some(d => d.messages + d.downloads + d.logins > 0) ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={stats.activityTimeline} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={C.outlineVar} />
                            <XAxis dataKey="label" tick={{ fill: C.onSurfaceVar, fontSize: 11 }} />
                            <YAxis allowDecimals={false} tick={{ fill: C.onSurfaceVar, fontSize: 11 }} width={32} />
                            <Tooltip contentStyle={{ background: C.surface, border: `1px solid ${C.outlineVar}`, borderRadius: 12, fontFamily: "Roboto", fontSize: 12 }} />
                            <Legend wrapperStyle={{ fontFamily: "Roboto", fontSize: 12 }} />
                            <Area type="monotone" dataKey="messages" name="Messages" stackId="1" stroke={C.primary} fill={C.primary} fillOpacity={0.35} isAnimationActive={false} />
                            <Area type="monotone" dataKey="downloads" name="Downloads" stackId="1" stroke="#386A20" fill="#386A20" fillOpacity={0.35} isAnimationActive={false} />
                            <Area type="monotone" dataKey="logins" name="Logins" stackId="1" stroke="#006A6A" fill="#006A6A" fillOpacity={0.35} isAnimationActive={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      ) : <EmptyNote text="No activity in the last 14 days" />}
                    </ChartCard>
                  </div>
                </DashSection>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-0 xl:gap-5">
                  <DashSection title="User Activity" action={
                    <button type="button" onClick={() => setSection("users")} className="text-xs font-medium" style={{ color: C.primary, fontFamily: "Roboto" }}>View all</button>
                  }>
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <StatCard label="Online Now" value={stats.onlineUsers} color="#386A20" />
                      <StatCard label="Total DMs" value={stats.totalDms} />
                    </div>
                    {stats.recentUsers.length === 0 ? <EmptyNote text="No recent registrations" /> : (
                      <ul className="space-y-2" aria-label="Recent registrations">
                        {stats.recentUsers.map(u => (
                          <li key={u.id} className="flex items-center gap-3 px-2 py-2 rounded-xl" style={{ background: C.surfaceVar }}>
                            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium shrink-0 overflow-hidden" style={{ background: C.primary }}>
                              {u.avatarUrl ? <img src={u.avatarUrl} alt="" className="w-full h-full object-cover" /> : u.username?.[0]?.toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{u.username}</p>
                              <p className="text-[11px]" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>Joined {u.time}</p>
                            </div>
                            <span className="flex items-center gap-1 text-[11px] shrink-0" style={{ color: u.isOnline ? "#386A20" : C.onSurfaceVar, fontFamily: "Roboto" }}>
                              <FiberManualRecordIcon style={{ fontSize: 10 }} />{u.isOnline ? "Online" : "Offline"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </DashSection>

                  <DashSection title="Downloads" action={
                    <button type="button" onClick={() => setSection("game-downloads")} className="text-xs font-medium" style={{ color: C.primary, fontFamily: "Roboto" }}>Manage</button>
                  }>
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <StatCard label="Total Downloads" value={stats.totalDownloads} />
                      <StatCard label="Resources" value={stats.totalResources} />
                    </div>
                    {stats.mostDownloadedResource ? (
                      <div className="rounded-xl px-3 py-3 mb-3" style={{ background: C.surfaceVar }}>
                        <p className="text-[11px] uppercase tracking-wide mb-1" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>Most downloaded resource</p>
                        <p className="text-sm font-medium" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{stats.mostDownloadedResource.title}</p>
                        <p className="text-xs mt-0.5" style={{ color: C.primary, fontFamily: "Roboto" }}>{stats.mostDownloadedResource.downloads.toLocaleString()} downloads</p>
                      </div>
                    ) : <EmptyNote text="No resource downloads yet" />}
                    <div className="grid grid-cols-3 gap-2">
                      {stats.downloadsByPlatform.map(p => (
                        <div key={p.platform} className="rounded-xl px-2 py-3 text-center" style={{ background: C.surfaceVar }}>
                          <p className="text-lg font-medium tabular-nums" style={{ color: C.primary, fontFamily: "Roboto" }}>{p.count}</p>
                          <p className="text-[11px]" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>{p.label}</p>
                        </div>
                      ))}
                    </div>
                  </DashSection>

                  <DashSection title="Teamwork" action={
                    <button type="button" onClick={() => setSection("applications")} className="text-xs font-medium" style={{ color: C.primary, fontFamily: "Roboto" }}>Applications</button>
                  }>
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      <StatCard label="Pending" value={stats.pendingApplications} color="#B3261E" />
                      <StatCard label="Approved" value={stats.approvedApplications} color="#386A20" />
                      <StatCard label="Rejected" value={stats.rejectedApplications} />
                    </div>
                    {stats.recentApplications.length === 0 ? <EmptyNote text="No applications yet" /> : (
                      <ul className="space-y-2" aria-label="Recent applications">
                        {stats.recentApplications.map(a => (
                          <li key={a.id} className="flex items-center gap-3 px-2 py-2 rounded-xl" style={{ background: C.surfaceVar }}>
                            <WorkIcon style={{ fontSize: 18, color: C.primary }} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{a.username || "Unknown"} · {a.position || "Role"}</p>
                              <p className="text-[11px]" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>{a.time}</p>
                            </div>
                            <Chip label={a.status} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </DashSection>

                  <DashSection title="Messaging" action={
                    <button type="button" onClick={() => setSection("channels")} className="text-xs font-medium" style={{ color: C.primary, fontFamily: "Roboto" }}>Channels</button>
                  }>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <StatCard label="Messages" value={stats.totalMessages} />
                      <StatCard label="DMs" value={stats.totalDms} />
                      <StatCard label="Channels" value={stats.totalChannels} />
                      <StatCard label="DM Requests" value={stats.pendingDmRequests} color="#B3261E" />
                    </div>
                  </DashSection>

                  <DashSection title="Contacts" action={
                    <button type="button" onClick={() => setSection("contacts")} className="text-xs font-medium" style={{ color: C.primary, fontFamily: "Roboto" }}>Inbox</button>
                  }>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                      <StatCard label="Unread" value={stats.unreadContacts} color="#B3261E" />
                      <StatCard label="Pending Reply" value={stats.pendingContactReplies} color="#B3261E" />
                      <StatCard label="Replied" value={stats.repliedContacts} color="#386A20" />
                      <StatCard label="Total" value={stats.totalContacts} />
                    </div>
                    {stats.recentContacts.length === 0 ? <EmptyNote text="No contact requests" /> : (
                      <ul className="space-y-2" aria-label="Recent contacts">
                        {stats.recentContacts.map(c => (
                          <li key={c.id} className="flex items-center gap-3 px-2 py-2 rounded-xl" style={{ background: C.surfaceVar }}>
                            <ContactMailIcon style={{ fontSize: 18, color: c.isRead ? C.onSurfaceVar : C.primary }} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{c.name} · {c.subject}</p>
                              <p className="text-[11px]" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>{c.time} · {c.replyStatus}</p>
                            </div>
                            {!c.isRead && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: C.primary }} aria-label="Unread" />}
                          </li>
                        ))}
                      </ul>
                    )}
                  </DashSection>

                  <DashSection title="Activity Logs" action={
                    <button type="button" onClick={() => setSection("activity-logs")} className="text-xs font-medium" style={{ color: C.primary, fontFamily: "Roboto" }}>View logs</button>
                  }>
                    {stats.recentActivity.length === 0 ? <EmptyNote text="No recent activity" /> : (
                      <ul className="space-y-2" aria-label="Recent activity">
                        {stats.recentActivity.map(a => (
                          <li key={a.id} className="flex items-start gap-3 px-2 py-2 rounded-xl" style={{ background: C.surfaceVar }}>
                            <HistoryIcon style={{ fontSize: 18, color: C.onSurfaceVar, marginTop: 2 }} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm truncate" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{a.description}</p>
                              <p className="text-[11px] mt-0.5" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                                {a.username || "System"} · {a.eventCategory} · {a.time}
                              </p>
                            </div>
                            <span className="text-[10px] uppercase shrink-0" style={{ color: a.result === "success" ? "#386A20" : C.error, fontFamily: "Roboto" }}>{a.result}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </DashSection>
                </div>
              </div>
            )}

            {section === "users" && (
              <div>
                <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                  <h1 className="text-2xl font-medium" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Users</h1>
                  <div className="flex gap-2 flex-wrap">
                    {["active", "disabled", "admin", "team"].map(f => (
                      <button key={f} onClick={() => setUserFilter(f)} className="px-3 py-1.5 rounded-full text-xs font-medium capitalize"
                        style={{ background: userFilter === f ? C.primary : C.surfaceVar, color: userFilter === f ? "white" : C.onSurfaceVar, fontFamily: "Roboto" }}>{f}</button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 mb-4 px-3 py-2.5 rounded-full border max-w-md" style={{ borderColor: C.outlineVar, background: C.surface }}>
                  <SearchIcon style={{ fontSize: 18, color: C.onSurfaceVar }} />
                  <input value={userSearch} onChange={e => setUserSearch(e.target.value)} onKeyDown={e => e.key === "Enter" && loadSection()}
                    placeholder="Search users…" className="flex-1 bg-transparent text-sm focus:outline-none" style={{ color: C.onSurface, fontFamily: "Roboto" }} />
                </div>
                <div className="rounded-2xl overflow-hidden border" style={{ borderColor: C.outlineVar, background: C.surface, boxShadow: SH1 }}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" style={{ fontFamily: "Roboto" }}>
                      <thead>
                        <tr style={{ background: C.surfaceVar }}>
                          {["#", "User", "Email", "Status", "Role", "Location", "Actions"].map(h => (
                            <th key={h} className="text-left px-4 py-3 text-xs font-medium uppercase tracking-wide" style={{ color: C.onSurfaceVar }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((u, idx) => (
                          <tr key={u.id} className="border-t" style={{ borderColor: C.outlineVar }}>
                            <td className="px-4 py-3 text-xs" style={{ color: C.onSurfaceVar }}>{u.registrationNumber ?? u.id}</td>
                            <td className="px-4 py-3">
                              <button onClick={() => openUserProfile(u)} className="flex items-center gap-2.5 text-left hover:opacity-80 transition-opacity">
                                <UserAvatar user={u} size={32} />
                                <div>
                                  <div className="font-medium" style={{ color: C.onSurface }}>{u.username}</div>
                                  {u.isDisabled && <Chip label="Disabled" color={C.error} />}
                                </div>
                              </button>
                            </td>
                            <td className="px-4 py-3" style={{ color: C.onSurfaceVar }}>{u.email}</td>
                            <td className="px-4 py-3">
                              <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{
                                background: u.isOnline ? "#D7E8D4" : C.surfaceVar,
                                color: u.isOnline ? "#386A20" : C.onSurfaceVar,
                                fontFamily: "Roboto",
                              }}>{u.status || (u.isOnline ? "Online" : "Offline")}</span>
                            </td>
                            <td className="px-4 py-3">
                              {u.isAdmin && <Chip label="Admin" filled />}
                              {u.isTeamMember && <Chip label="Team" color="#386A20" />}
                            </td>
                            <td className="px-4 py-3"><LocationCell loc={u.location} /></td>
                            <td className="px-4 py-3">
                              <div className="flex gap-1">
                                <button title="Edit" onClick={() => setEditUser(u)} className="p-1.5 rounded-full hover:bg-black/5" style={{ color: C.primary }}><EditIcon style={{ fontSize: 16 }} /></button>
                                {u.isDisabled
                                  ? <button title="Enable" onClick={() => handleUserAction(() => api.admin.enableUser(u.id), "User enabled")} className="p-1.5 rounded-full hover:bg-black/5" style={{ color: "#386A20" }}><CheckIcon style={{ fontSize: 16 }} /></button>
                                  : <button title="Disable" onClick={() => handleUserAction(() => api.admin.disableUser(u.id), "User disabled")} className="p-1.5 rounded-full hover:bg-black/5" style={{ color: C.error }}><BlockIcon style={{ fontSize: 16 }} /></button>}
                                <button title="Delete" onClick={() => setConfirm({ title: "Delete User", body: `Permanently delete ${u.username}?`, onOk: () => handleUserAction(() => api.admin.deleteUser(u.id), "User deleted") })} className="p-1.5 rounded-full hover:bg-black/5" style={{ color: C.error }}><DeleteIcon style={{ fontSize: 16 }} /></button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {users.length === 0 && <p className="text-center py-10 text-sm" style={{ color: C.onSurfaceVar }}>No users found</p>}
                  </div>
                </div>
              </div>
            )}

            {section === "contacts" && (
              <div>
                <h1 className="text-2xl font-medium mb-6" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Contact Management</h1>
                <div className="space-y-3">
                  {contacts.map(c => (
                    <button key={c.id} onClick={() => openContact(c.id)} className="w-full text-left rounded-2xl p-4 flex items-start gap-4 hover:bg-black/[0.02] transition-colors" style={{ background: C.surface, boxShadow: SH1, borderLeft: !c.isRead ? `4px solid ${C.primary}` : undefined }}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-medium text-sm" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{c.subject}</span>
                          {!c.isRead && <Chip label="Unread" color={C.primary} />}
                          <Chip label={c.replyStatus === "replied" ? "Replied" : "Pending"} color={c.replyStatus === "replied" ? "#386A20" : "#B3261E"} />
                          {c.userId ? <Chip label="Member" /> : <Chip label="Guest" color={C.onSurfaceVar} />}
                        </div>
                        <p className="text-sm truncate" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>{c.name} · {c.email}</p>
                        <p className="text-xs mt-1 line-clamp-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>{c.message}</p>
                        <p className="text-[10px] mt-1" style={{ color: C.onSurfaceVar, fontFamily: "Roboto Mono, monospace" }}>
                          #{c.id} · {c.time}
                          {c.country && <> · {formatCountryDisplay(c.country, c.countryCode || null)}</>}
                        </p>
                      </div>
                    </button>
                  ))}
                  {contacts.length === 0 && <p className="text-center py-10 text-sm" style={{ color: C.onSurfaceVar }}>No contact submissions yet</p>}
                </div>
              </div>
            )}

            {section === "notifications" && (
              <div>
                <div className="flex items-center justify-between mb-6">
                  <h1 className="text-2xl font-medium" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Notifications</h1>
                  <FilledBtn onClick={() => setEditNotif({ title: "", body: "", recipientType: "everyone", pinned: false })}>Create</FilledBtn>
                </div>
                <div className="space-y-3">
                  {notifs.map(n => (
                    <div key={n.id} className="rounded-2xl p-4 flex items-start gap-4" style={{ background: C.surface, boxShadow: SH1 }}>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {n.pinned && <PushPinIcon style={{ fontSize: 14, color: C.primary }} />}
                          <span className="font-medium text-sm" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{n.title}</span>
                          <Chip label={n.recipientType || "everyone"} />
                        </div>
                        <p className="text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>{n.body}</p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => setEditNotif(n)} className="p-1.5 rounded-full hover:bg-black/5" style={{ color: C.primary }}><EditIcon style={{ fontSize: 16 }} /></button>
                        {n.pinned
                          ? <button onClick={() => handleUserAction(() => api.admin.unpinNotification(n.id!), "Unpinned")} className="p-1.5 rounded-full hover:bg-black/5" style={{ color: C.onSurfaceVar }}><PushPinIcon style={{ fontSize: 16 }} /></button>
                          : <button onClick={() => handleUserAction(() => api.admin.pinNotification(n.id!), "Pinned")} className="p-1.5 rounded-full hover:bg-black/5" style={{ color: C.primary }}><PushPinIcon style={{ fontSize: 16 }} /></button>}
                        <button onClick={() => setConfirm({ title: "Delete", body: "Delete this notification?", onOk: () => handleUserAction(() => api.admin.deleteNotification(n.id!), "Deleted") })} className="p-1.5 rounded-full hover:bg-black/5" style={{ color: C.error }}><DeleteIcon style={{ fontSize: 16 }} /></button>
                      </div>
                    </div>
                  ))}
                  {notifs.length === 0 && <p className="text-center py-10 text-sm" style={{ color: C.onSurfaceVar }}>No notifications</p>}
                </div>
              </div>
            )}

            {section === "channels" && (
              <div>
                <div className="flex items-center justify-between mb-6">
                  <h1 className="text-2xl font-medium" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Channels</h1>
                  <FilledBtn onClick={() => setEditChannel({ name: "", bio: "", visibility: "public", archived: false })}>Create Channel</FilledBtn>
                </div>
                <div className="space-y-3">
                  {channels.map(ch => (
                    <div key={ch.id} className="rounded-2xl p-4 flex items-center gap-4" style={{ background: C.surface, boxShadow: SH1 }}>
                      <TagIcon style={{ fontSize: 24, color: C.primary }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{ch.name}</span>
                          {ch.archived && <Chip label="Archived" color={C.onSurfaceVar} />}
                          <Chip label={ch.visibility} />
                        </div>
                        <p className="text-xs truncate" style={{ color: C.onSurfaceVar }}>{ch.bio || "No description"} · {ch.memberCount} members</p>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => setEditChannel(ch)} className="p-1.5 rounded-full hover:bg-black/5" style={{ color: C.primary }}><EditIcon style={{ fontSize: 16 }} /></button>
                        <button onClick={() => setConfirm({ title: "Delete Channel", body: `Delete ${ch.name}?`, onOk: () => handleUserAction(() => api.admin.deleteChannel(ch.id), "Channel deleted") })} className="p-1.5 rounded-full hover:bg-black/5" style={{ color: C.error }}><DeleteIcon style={{ fontSize: 16 }} /></button>
                      </div>
                    </div>
                  ))}
                  {channels.length === 0 && <p className="text-center py-10 text-sm" style={{ color: C.onSurfaceVar }}>No channels</p>}
                </div>
              </div>
            )}

            {section === "applications" && (
              <div>
                <h1 className="text-2xl font-medium mb-6" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Teamwork Applications</h1>
                <div className="space-y-4">
                  {applications.map(app => (
                    <div key={app.id} className="rounded-2xl p-5" style={{ background: C.surface, boxShadow: SH1 }}>
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <h3 className="font-medium" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{app.fullName}</h3>
                          <p className="text-sm" style={{ color: C.primary }}>@{app.applicant.username} · {app.jobTitle}</p>
                          <p className="text-xs mt-1 flex items-center gap-1" style={{ color: C.onSurfaceVar }}>
                            {app.country && <FlagImg country={app.country} size={14} />}{app.country}{app.city ? ` · ${app.city}` : ""} · {app.time}
                          </p>
                          {app.message && <p className="text-sm mt-2" style={{ color: C.onSurfaceVar }}>{app.message}</p>}
                        </div>
                        <Chip label={app.status} color={app.status === "approved" ? "#386A20" : app.status === "rejected" ? C.error : C.primary} filled={app.status !== "pending"} />
                      </div>
                      {app.status === "pending" && (
                        <div className="flex gap-2 mt-4">
                          <FilledBtn onClick={() => handleUserAction(() => api.admin.approveApplication(app.id), "Application approved")}><CheckIcon style={{ fontSize: 16 }} /> Approve</FilledBtn>
                          <OutlinedBtn onClick={() => handleUserAction(() => api.admin.rejectApplication(app.id), "Application rejected")}>Reject</OutlinedBtn>
                        </div>
                      )}
                    </div>
                  ))}
                  {applications.length === 0 && <p className="text-center py-10 text-sm" style={{ color: C.onSurfaceVar }}>No applications</p>}
                </div>
              </div>
            )}

            {section === "resources" && (
              <div>
                <div className="flex items-center justify-between mb-6">
                  <h1 className="text-2xl font-medium" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Resources</h1>
                  <FilledBtn onClick={() => { setEditResource({ title: "", category: "Guides", description: "", enabled: true }); setResourceFile(null); }}>Upload Resource</FilledBtn>
                </div>
                <div className="space-y-3">
                  {resources.map(r => (
                    <div key={r.id} className="rounded-2xl p-4 flex items-center gap-4" style={{ background: C.surface, boxShadow: SH1 }}>
                      <MenuBookIcon style={{ fontSize: 24, color: C.primary }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{r.title}</span>
                          <Chip label={r.category} />
                          {!r.enabled && <Chip label="Disabled" color={C.error} />}
                        </div>
                        <p className="text-xs" style={{ color: C.onSurfaceVar }}>{r.description}</p>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => { setEditResource(r); setResourceFile(null); }} className="p-1.5 rounded-full hover:bg-black/5" style={{ color: C.primary }}><EditIcon style={{ fontSize: 16 }} /></button>
                        <button onClick={() => setConfirm({ title: "Delete Resource", body: `Delete ${r.title}?`, onOk: () => handleUserAction(() => api.admin.deleteResource(r.id), "Resource deleted") })} className="p-1.5 rounded-full hover:bg-black/5" style={{ color: C.error }}><DeleteIcon style={{ fontSize: 16 }} /></button>
                      </div>
                    </div>
                  ))}
                  {resources.length === 0 && <p className="text-center py-10 text-sm" style={{ color: C.onSurfaceVar }}>No resources</p>}
                </div>
              </div>
            )}

            {section === "game-downloads" && (
              <div>
                <div className="flex items-center justify-between mb-6">
                  <h1 className="text-2xl font-medium" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Game Downloads</h1>
                  <FilledBtn onClick={() => { setEditGameBuild({ platform: "windows", version: "", releaseNotes: "", published: false }); setGameBuildFile(null); }}>Upload Build</FilledBtn>
                </div>
                <div className="space-y-3">
                  {gameBuilds.map(g => (
                    <div key={g.id} className="rounded-2xl p-4 flex items-center gap-4" style={{ background: C.surface, boxShadow: SH1 }}>
                      <SportsEsportsIcon style={{ fontSize: 24, color: C.primary }} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium capitalize" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{g.platform}</span>
                          <Chip label={`v${g.version}`} />
                          {g.published ? <Chip label="Published" color="#386A20" filled /> : <Chip label="Draft" />}
                        </div>
                        <p className="text-xs" style={{ color: C.onSurfaceVar }}>{g.releaseNotes || "No release notes"} · {g.fileSize ? `${(g.fileSize / 1048576).toFixed(1)} MB` : "No file"}</p>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => { setEditGameBuild(g); setGameBuildFile(null); }} className="p-1.5 rounded-full hover:bg-black/5" style={{ color: C.primary }}><EditIcon style={{ fontSize: 16 }} /></button>
                        <button onClick={() => setConfirm({ title: "Delete Build", body: `Delete ${g.platform} v${g.version}?`, onOk: () => handleUserAction(() => api.admin.deleteGameDownload(g.id), "Build deleted") })} className="p-1.5 rounded-full hover:bg-black/5" style={{ color: C.error }}><DeleteIcon style={{ fontSize: 16 }} /></button>
                      </div>
                    </div>
                  ))}
                  {gameBuilds.length === 0 && <p className="text-center py-10 text-sm" style={{ color: C.onSurfaceVar }}>No game builds uploaded</p>}
                </div>
              </div>
            )}

            {section === "activity-logs" && (
              <div>
                <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                  <h1 className="text-2xl font-medium" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Activity Logs</h1>
                  <div className="flex gap-2">
                    <OutlinedBtn onClick={async () => { try { await api.admin.exportActivityLogs(); } catch { toast.error("Export failed"); } }}><DownloadIcon style={{ fontSize: 16 }} /> Export CSV</OutlinedBtn>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mb-4">
                  <input value={logFilters.search} onChange={e => setLogFilters(f => ({ ...f, search: e.target.value }))} placeholder="Search logs…" className="px-3 py-2 rounded-full border text-sm flex-1 min-w-[12rem]" style={{ borderColor: C.outlineVar, background: C.surface, color: C.onSurface, fontFamily: "Roboto" }} />
                  {[{ k: "timeRange", opts: [["", "All time"], ["today", "Today"], ["7d", "Last 7 days"], ["30d", "Last 30 days"]] }, { k: "userRole", opts: [["", "All roles"], ["guest", "Guest"], ["registered_user", "Registered"], ["team_member", "Team"], ["administrator", "Admin"]] }, { k: "eventCategory", opts: [["", "All categories"], ["authentication", "Auth"], ["messaging", "Messaging"], ["teamwork", "Teamwork"], ["resources", "Resources"], ["downloads", "Downloads"], ["administration", "Admin"], ["legal", "Legal"], ["security", "Security"]] }, { k: "eventType", opts: [["", "All events"], ["view_terms_of_service", "Viewed Terms of Service"], ["database_backup", "Database Backup"], ["database_restore", "Database Restore"], ["login", "Login"], ["register", "Register"]] }, { k: "result", opts: [["", "All results"], ["success", "Success"], ["failure", "Failure"]] }].map(({ k, opts }) => (
                    <select key={k} value={(logFilters as Record<string, string>)[k]} onChange={e => setLogFilters(f => ({ ...f, [k]: e.target.value }))} className="px-3 py-2 rounded-full border text-xs" style={{ borderColor: C.outlineVar, background: C.surface, color: C.onSurface, fontFamily: "Roboto" }}>
                      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  ))}
                  <FilledBtn onClick={() => { setActivityPage(1); loadSection(); }}>Apply</FilledBtn>
                </div>
                <div className="rounded-2xl overflow-hidden border" style={{ borderColor: C.outlineVar, background: C.surface }}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" style={{ fontFamily: "Roboto" }}>
                      <thead><tr style={{ background: C.surfaceVar }}>{["Time", "User", "Role", "Event", "Category", "Country", "IP", "Result"].map(h => <th key={h} className="text-left px-3 py-2 text-xs font-medium uppercase" style={{ color: C.onSurfaceVar }}>{h}</th>)}</tr></thead>
                      <tbody>
                        {activityLogs.map(l => (
                          <tr key={l.id} className="border-t cursor-pointer hover:bg-black/5" style={{ borderColor: C.outlineVar }} onClick={() => setSelectedLog(l)}>
                            <td className="px-3 py-2 text-xs whitespace-nowrap" style={{ color: C.onSurfaceVar }}>{l.time}</td>
                            <td className="px-3 py-2" style={{ color: C.onSurface }}>{l.username || "Guest"}</td>
                            <td className="px-3 py-2 text-xs" style={{ color: C.onSurfaceVar }}>{l.userRole}</td>
                            <td className="px-3 py-2 text-xs" style={{ color: C.onSurface }}>{l.eventType}</td>
                            <td className="px-3 py-2 text-xs" style={{ color: C.onSurfaceVar }}>{l.eventCategory}</td>
                            <td className="px-3 py-2 text-xs" style={{ color: C.onSurfaceVar }}>{l.country || "—"}</td>
                            <td className="px-3 py-2 text-xs font-mono" style={{ color: C.onSurfaceVar }}>{l.ipAddress || "—"}</td>
                            <td className="px-3 py-2"><Chip label={l.result} color={l.result === "success" ? "#386A20" : C.error} filled={l.result === "failure"} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {activityLogs.length === 0 && <p className="text-center py-10 text-sm" style={{ color: C.onSurfaceVar }}>No activity logs</p>}
                  </div>
                </div>
                <div className="flex justify-between items-center mt-4 text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                  <span>{activityTotal} total entries</span>
                  <div className="flex gap-2">
                    <OutlinedBtn onClick={() => setActivityPage(p => Math.max(1, p - 1))} cls={activityPage <= 1 ? "opacity-50 pointer-events-none" : ""}>Previous</OutlinedBtn>
                    <span className="px-3 py-2">Page {activityPage}</span>
                    <OutlinedBtn onClick={() => setActivityPage(p => p + 1)} cls={activityPage * 50 >= activityTotal ? "opacity-50 pointer-events-none" : ""}>Next</OutlinedBtn>
                  </div>
                </div>
              </div>
            )}

            {section === "database" && (
              <div>
                <h1 className="text-2xl font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Database Management</h1>
                <p className="text-sm mb-6" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                  Inspect the live SQLite database, download full backups, and restore from a verified backup file. All operations are audited.
                </p>

                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 mb-6">
                  <div className="rounded-2xl p-4 md:p-5 min-h-[96px] flex flex-col justify-between" style={{ background: C.surface, boxShadow: SH1 }}>
                    <p className="text-lg md:text-xl font-medium" style={{ color: C.primary, fontFamily: "Roboto" }}>{dbInfo ? `${dbInfo.type}` : "—"}</p>
                    <p className="text-sm font-medium" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Engine {dbInfo?.version ? `· ${dbInfo.version}` : ""}</p>
                  </div>
                  <div className="rounded-2xl p-4 md:p-5 min-h-[96px] flex flex-col justify-between" style={{ background: C.surface, boxShadow: SH1 }}>
                    <p className="text-2xl md:text-3xl font-medium tabular-nums" style={{ color: C.primary, fontFamily: "Roboto" }}>{dbInfo?.sizeLabel || "—"}</p>
                    <p className="text-sm font-medium" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Database Size</p>
                  </div>
                  <StatCard label="Users" value={dbInfo?.totalUsers ?? 0} />
                  <StatCard label="Messages" value={dbInfo?.totalMessages ?? 0} />
                  <StatCard label="Channels" value={dbInfo?.totalChannels ?? 0} />
                  <StatCard label="Resources" value={dbInfo?.totalResources ?? 0} />
                  <StatCard label="Notifications" value={dbInfo?.totalNotifications ?? 0} />
                  <StatCard label="Activity Logs" value={dbInfo?.totalLogs ?? 0} />
                </div>

                <div className="rounded-2xl border p-5 mb-5" style={{ background: C.surface, borderColor: C.outlineVar, boxShadow: SH1 }}>
                  <h2 className="text-base font-medium mb-3" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Status</h2>
                  <dl className="grid sm:grid-cols-2 gap-3 text-sm" style={{ fontFamily: "Roboto" }}>
                    <div>
                      <dt className="text-xs uppercase tracking-wide mb-1" style={{ color: C.onSurfaceVar }}>File</dt>
                      <dd style={{ color: C.onSurface }}>{dbInfo?.path || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide mb-1" style={{ color: C.onSurfaceVar }}>Last backup</dt>
                      <dd style={{ color: C.onSurface }}>
                        {dbInfo?.lastBackupAt ? new Date(dbInfo.lastBackupAt).toLocaleString() : "Never"}
                        {dbInfo?.lastBackupFile ? ` · ${dbInfo.lastBackupFile}` : ""}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div className="rounded-2xl border p-5" style={{ background: C.surface, borderColor: C.outlineVar, boxShadow: SH1 }}>
                    <h2 className="text-base font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Backup</h2>
                    <p className="text-sm mb-4" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                      Create a complete SQLite snapshot and download it. A safety copy is also retained on the server.
                    </p>
                    <FilledBtn
                      cls={dbBusy ? "opacity-60 pointer-events-none" : ""}
                      onClick={async () => {
                        setDbBusy("backup");
                        try {
                          await api.admin.databaseBackup();
                          toast.success("Backup downloaded");
                          const info = await api.admin.databaseInfo();
                          setDbInfo(info);
                        } catch (e) {
                          toast.error(e instanceof ApiError ? e.message : "Backup failed");
                        } finally {
                          setDbBusy(null);
                        }
                      }}
                    >
                      <DownloadIcon style={{ fontSize: 16 }} />{dbBusy === "backup" ? "Creating…" : "Download Backup"}
                    </FilledBtn>
                  </div>

                  <div className="rounded-2xl border p-5" style={{ background: C.surface, borderColor: C.outlineVar, boxShadow: SH1 }}>
                    <h2 className="text-base font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Restore</h2>
                    <p className="text-sm mb-4" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                      Upload a `.db` backup. Compatibility is validated first. A pre-restore safety backup is created automatically.
                    </p>
                    <input
                      type="file"
                      accept=".db,application/octet-stream,application/x-sqlite3"
                      className="block w-full text-sm mb-3"
                      style={{ color: C.onSurface, fontFamily: "Roboto" }}
                      onChange={e => setRestoreFile(e.target.files?.[0] || null)}
                    />
                    <FilledBtn
                      cls={!restoreFile || dbBusy ? "opacity-60 pointer-events-none" : ""}
                      onClick={() => {
                        if (!restoreFile) return;
                        setConfirm({
                          title: "Restore Database?",
                          body: `This will overwrite live data with “${restoreFile.name}”. A safety backup will be saved first. Continue?`,
                          onOk: async () => {
                            setDbBusy("restore");
                            try {
                              const r = await api.admin.databaseRestore(restoreFile);
                              toast.success(`Database restored (safety: ${r.safetyBackup})`);
                              setRestoreFile(null);
                              const info = await api.admin.databaseInfo();
                              setDbInfo(info);
                            } catch (e) {
                              toast.error(e instanceof ApiError ? e.message : "Restore failed — existing database preserved");
                            } finally {
                              setDbBusy(null);
                            }
                          },
                        });
                      }}
                    >
                      <CloudUploadIcon style={{ fontSize: 16 }} />{dbBusy === "restore" ? "Restoring…" : "Restore Backup"}
                    </FilledBtn>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Edit User Modal */}
      {editUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditUser(null)}>
          <div className="rounded-3xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" style={{ background: C.surface, boxShadow: SH2 }} onClick={e => e.stopPropagation()}>
            <div className="flex justify-between mb-4">
              <h3 className="font-medium" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Edit User</h3>
              <button onClick={() => setEditUser(null)}><CloseIcon style={{ color: C.onSurfaceVar }} /></button>
            </div>
            <div className="space-y-3">
              <Field label="Username" value={editUser.username} onChange={v => setEditUser({ ...editUser, username: v })} />
              <Field label="Email" value={editUser.email || ""} onChange={v => setEditUser({ ...editUser, email: v })} />
              <Field label="Bio" value={editUser.bio || ""} onChange={v => setEditUser({ ...editUser, bio: v })} />
              <label className="flex items-center gap-2 text-sm" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
                <input type="checkbox" checked={!!editUser.isAdmin} onChange={e => setEditUser({ ...editUser, isAdmin: e.target.checked })} /> Administrator
              </label>
              <label className="flex items-center gap-2 text-sm" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
                <input type="checkbox" checked={!!editUser.isTeamMember} onChange={e => setEditUser({ ...editUser, isTeamMember: e.target.checked })} /> Team Member
              </label>
              {editUser.activities && editUser.activities.length > 0 && (
                <div>
                  <p className="text-xs font-medium uppercase mb-2" style={{ color: C.onSurfaceVar }}>Recent Activity</p>
                  {editUser.activities.map((a, i) => <p key={i} className="text-xs" style={{ color: C.onSurfaceVar }}>{a.description}</p>)}
                </div>
              )}
              <FilledBtn onClick={() => handleUserAction(() => api.admin.updateUser(editUser.id, {
                username: editUser.username, email: editUser.email, bio: editUser.bio,
                isAdmin: editUser.isAdmin, isTeamMember: editUser.isTeamMember,
              }), "User updated")}>Save Changes</FilledBtn>
            </div>
          </div>
        </div>
      )}

      {/* Edit Notification Modal */}
      {editNotif && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditNotif(null)}>
          <div className="rounded-3xl p-6 w-full max-w-md" style={{ background: C.surface }} onClick={e => e.stopPropagation()}>
            <h3 className="font-medium mb-4" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{editNotif.id ? "Edit" : "Create"} Notification</h3>
            <div className="space-y-3">
              <Field label="Title" value={editNotif.title || ""} onChange={v => setEditNotif({ ...editNotif, title: v })} />
              <Field label="Body" value={editNotif.body || ""} onChange={v => setEditNotif({ ...editNotif, body: v })} rows={3} />
              <div className="relative mt-1">
                <select value={editNotif.recipientType || "everyone"} onChange={e => setEditNotif({ ...editNotif, recipientType: e.target.value, recipientIds: e.target.value === "users" ? (editNotif.recipientIds || []) : [] })}
                  className="w-full px-4 py-3.5 rounded-[4px] border text-sm" style={{ borderColor: C.outline, color: C.onSurface, background: C.surface, fontFamily: "Roboto" }}>
                  <option value="everyone">All Users</option>
                  <option value="users">Specific Users</option>
                  <option value="team">All Team Members</option>
                  <option value="admins">All Administrators</option>
                </select>
                <span className="absolute left-3 -top-2 px-1 text-xs" style={{ color: C.primary, background: C.surface }}>Recipients</span>
              </div>
              {editNotif.recipientType === "users" && (
                <div className="space-y-2">
                  <input value={notifUserSearch} onChange={e => searchNotifUsers(e.target.value)} placeholder="Search users to add…"
                    className="w-full px-4 py-2.5 rounded-[4px] border text-sm" style={{ borderColor: C.outline, color: C.onSurface, background: C.surface, fontFamily: "Roboto" }} />
                  {(editNotif.recipientIds || []).length > 0 && (
                    <p className="text-xs" style={{ color: C.onSurfaceVar }}>{editNotif.recipientIds!.length} user(s) selected</p>
                  )}
                  {notifUserResults.map(u => (
                    <label key={u.id} className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
                      <input type="checkbox" checked={(editNotif.recipientIds || []).includes(u.id)} onChange={() => toggleNotifRecipient(u.id)} />
                      <UserAvatar user={u} size={24} /> {u.username}
                    </label>
                  ))}
                </div>
              )}
              <label className="flex items-center gap-2 text-sm" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
                <input type="checkbox" checked={!!editNotif.pinned} onChange={e => setEditNotif({ ...editNotif, pinned: e.target.checked })} /> Pin notification
              </label>
              <FilledBtn onClick={() => handleUserAction(() => editNotif.id
                ? api.admin.updateNotification(editNotif.id, editNotif)
                : api.admin.createNotification(editNotif), editNotif.id ? "Updated" : "Created")}>Save</FilledBtn>
            </div>
          </div>
        </div>
      )}

      {/* Edit Channel Modal */}
      {editChannel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditChannel(null)}>
          <div className="rounded-3xl p-6 w-full max-w-md" style={{ background: C.surface }} onClick={e => e.stopPropagation()}>
            <h3 className="font-medium mb-4" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{editChannel.id ? "Edit" : "Create"} Channel</h3>
            <div className="space-y-3">
              <Field label="Name" value={editChannel.name || ""} onChange={v => setEditChannel({ ...editChannel, name: v })} />
              <Field label="Bio" value={editChannel.bio || ""} onChange={v => setEditChannel({ ...editChannel, bio: v })} />
              <div className="relative mt-1">
                <select value={editChannel.visibility || "public"} onChange={e => setEditChannel({ ...editChannel, visibility: e.target.value })}
                  className="w-full px-4 py-3.5 rounded-[4px] border text-sm" style={{ borderColor: C.outline, color: C.onSurface, background: C.surface, fontFamily: "Roboto" }}>
                  <option value="public">Public — all authenticated users</option>
                  <option value="private">Private — team members &amp; admins only</option>
                </select>
                <span className="absolute left-3 -top-2 px-1 text-xs" style={{ color: C.primary, background: C.surface }}>Visibility</span>
              </div>
              {editChannel.id && (
                <label className="flex items-center gap-2 text-sm" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
                  <input type="checkbox" checked={!!editChannel.archived} onChange={e => setEditChannel({ ...editChannel, archived: e.target.checked })} /> Archived
                </label>
              )}
              <FilledBtn onClick={() => handleUserAction(() => editChannel.id
                ? api.admin.updateChannel(editChannel.id, editChannel)
                : api.admin.createChannel({ name: editChannel.name!, bio: editChannel.bio, visibility: editChannel.visibility }),
                editChannel.id ? "Updated" : "Created")}>Save</FilledBtn>
            </div>
          </div>
        </div>
      )}

      {/* Edit Resource Modal */}
      {editResource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditResource(null)}>
          <div className="rounded-3xl p-6 w-full max-w-md" style={{ background: C.surface }} onClick={e => e.stopPropagation()}>
            <h3 className="font-medium mb-4" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{editResource.id ? "Edit" : "Upload"} Resource</h3>
            <div className="space-y-3">
              <Field label="Title" value={editResource.title || ""} onChange={v => setEditResource({ ...editResource, title: v })} />
              <div className="relative mt-1">
                <select value={editResource.category || "Guides"} onChange={e => setEditResource({ ...editResource, category: e.target.value })}
                  className="w-full px-4 py-3.5 rounded-[4px] border text-sm" style={{ borderColor: C.outline, color: C.onSurface, background: C.surface, fontFamily: "Roboto" }}>
                  {["Guides", "Wiki", "Downloads", "Patch Notes", "Media"].map(o => <option key={o}>{o}</option>)}
                </select>
                <span className="absolute left-3 -top-2 px-1 text-xs" style={{ color: C.primary, background: C.surface }}>Category</span>
              </div>
              <Field label="Description" value={editResource.description || ""} onChange={v => setEditResource({ ...editResource, description: v })} rows={2} />
              <Field label="Version (optional)" value={editResource.version || ""} onChange={v => setEditResource({ ...editResource, version: v })} />
              <div>
                <label className="text-xs" style={{ color: C.primary, fontFamily: "Roboto" }}>File {editResource.id ? "(replace)" : ""}</label>
                <input type="file" onChange={e => setResourceFile(e.target.files?.[0] || null)} className="mt-1 text-sm w-full" style={{ color: C.onSurface }} />
              </div>
              <label className="flex items-center gap-2 text-sm" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
                <input type="checkbox" checked={editResource.enabled !== false} onChange={e => setEditResource({ ...editResource, enabled: e.target.checked })} /> Enabled
              </label>
              <FilledBtn onClick={() => {
                const form = new FormData();
                form.append("title", editResource.title || "");
                form.append("category", editResource.category || "Guides");
                form.append("description", editResource.description || "");
                if (editResource.version) form.append("version", editResource.version);
                form.append("enabled", String(editResource.enabled !== false));
                if (resourceFile) form.append("file", resourceFile);
                handleUserAction(() => editResource.id
                  ? api.admin.updateResource(editResource.id, form)
                  : api.admin.createResource(form), editResource.id ? "Updated" : "Uploaded");
              }}>Save</FilledBtn>
            </div>
          </div>
        </div>
      )}

      {editGameBuild && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditGameBuild(null)}>
          <div className="rounded-3xl p-6 w-full max-w-md" style={{ background: C.surface }} onClick={e => e.stopPropagation()}>
            <h3 className="font-medium mb-4" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{editGameBuild.id ? "Edit" : "Upload"} Game Build</h3>
            <div className="space-y-3">
              <div className="relative mt-1">
                <select value={editGameBuild.platform || "windows"} onChange={e => setEditGameBuild({ ...editGameBuild, platform: e.target.value })} disabled={!!editGameBuild.id}
                  className="w-full px-4 py-3.5 rounded-[4px] border text-sm" style={{ borderColor: C.outline, color: C.onSurface, background: C.surface, fontFamily: "Roboto" }}>
                  {["windows", "android", "ios"].map(o => <option key={o} value={o}>{o}</option>)}
                </select>
                <span className="absolute left-3 -top-2 px-1 text-xs" style={{ color: C.primary, background: C.surface }}>Platform</span>
              </div>
              <Field label="Version" value={editGameBuild.version || ""} onChange={v => setEditGameBuild({ ...editGameBuild, version: v })} />
              <Field label="Release Notes" value={editGameBuild.releaseNotes || ""} onChange={v => setEditGameBuild({ ...editGameBuild, releaseNotes: v })} rows={3} />
              <div>
                <label className="text-xs" style={{ color: C.primary, fontFamily: "Roboto" }}>Build file {editGameBuild.id ? "(replace)" : ""}</label>
                <input type="file" onChange={e => setGameBuildFile(e.target.files?.[0] || null)} className="mt-1 text-sm w-full" style={{ color: C.onSurface }} />
              </div>
              <label className="flex items-center gap-2 text-sm" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
                <input type="checkbox" checked={!!editGameBuild.published} onChange={e => setEditGameBuild({ ...editGameBuild, published: e.target.checked })} /> Published
              </label>
              <FilledBtn onClick={() => {
                const form = new FormData();
                form.append("platform", editGameBuild.platform || "windows");
                form.append("version", editGameBuild.version || "");
                form.append("releaseNotes", editGameBuild.releaseNotes || "");
                form.append("published", String(!!editGameBuild.published));
                if (gameBuildFile) form.append("file", gameBuildFile);
                handleUserAction(() => editGameBuild.id
                  ? api.admin.updateGameDownload(editGameBuild.id, form)
                  : api.admin.createGameDownload(form), editGameBuild.id ? "Updated" : "Uploaded").then(() => setEditGameBuild(null));
              }}>Save</FilledBtn>
            </div>
          </div>
        </div>
      )}

      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSelectedLog(null)}>
          <div className="rounded-3xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" style={{ background: C.surface }} onClick={e => e.stopPropagation()}>
            <div className="flex justify-between mb-4">
              <h3 className="font-medium" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Log #{selectedLog.id}</h3>
              <button onClick={() => setSelectedLog(null)}><CloseIcon style={{ color: C.onSurfaceVar }} /></button>
            </div>
            <div className="space-y-2 text-sm" style={{ fontFamily: "Roboto", color: C.onSurfaceVar }}>
              <p><strong style={{ color: C.onSurface }}>Time:</strong> {selectedLog.timestamp}</p>
              <p><strong style={{ color: C.onSurface }}>User:</strong> {selectedLog.username || "Guest"} ({selectedLog.userRole})</p>
              <p><strong style={{ color: C.onSurface }}>Event:</strong> {selectedLog.eventType} / {selectedLog.eventCategory}</p>
              <p><strong style={{ color: C.onSurface }}>Description:</strong> {selectedLog.description}</p>
              <p><strong style={{ color: C.onSurface }}>Object:</strong> {selectedLog.affectedObject || "—"}</p>
              <p><strong style={{ color: C.onSurface }}>IP:</strong> {selectedLog.ipAddress || "—"} · {selectedLog.country || "—"} {selectedLog.isVpn ? "(VPN)" : ""}</p>
              <p><strong style={{ color: C.onSurface }}>Device:</strong> {selectedLog.deviceType} · {selectedLog.browser} · {selectedLog.os}</p>
              <p><strong style={{ color: C.onSurface }}>Request:</strong> {selectedLog.httpMethod} {selectedLog.requestPath}</p>
              <p><strong style={{ color: C.onSurface }}>Result:</strong> {selectedLog.result}</p>
            </div>
          </div>
        </div>
      )}

      {/* User Profile Modal */}
      {profileUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setProfileUser(null)}>
          <div className="rounded-3xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" style={{ background: C.surface, boxShadow: SH2 }} onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-6">
              <div className="flex items-center gap-4">
                <UserAvatar user={profileUser} size={56} />
                <div>
                  <h3 className="font-medium text-lg" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{profileUser.username}</h3>
                  <p className="text-sm" style={{ color: C.onSurfaceVar }}>ID #{profileUser.id}</p>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full inline-block mt-1" style={{
                    background: profileUser.isOnline ? "#D7E8D4" : C.surfaceVar,
                    color: profileUser.isOnline ? "#386A20" : C.onSurfaceVar,
                  }}>{profileUser.isOnline ? "Online" : "Offline"}</span>
                </div>
              </div>
              <button onClick={() => setProfileUser(null)}><CloseIcon style={{ color: C.onSurfaceVar }} /></button>
            </div>
            {profileLoading ? <p style={{ color: C.onSurfaceVar }}>Loading…</p> : (
              <div className="space-y-5 text-sm" style={{ fontFamily: "Roboto", color: C.onSurfaceVar }}>
                <section>
                  <p className="text-xs font-medium uppercase mb-2" style={{ color: C.primary }}>Identity</p>
                  <p>Email: {profileUser.email || "—"}</p>
                  <p>Bio: {profileUser.bio || "—"}</p>
                </section>
                <section>
                  <p className="text-xs font-medium uppercase mb-2" style={{ color: C.primary }}>Personal</p>
                  <p>Gender: {profileUser.gender || "—"}</p>
                  <p>Birthday: {profileUser.dateOfBirth || "—"}</p>
                  <p className="flex items-center gap-1.5">Country: {profileUser.country ? <><FlagImg country={profileUser.country} size={14} />{profileUser.country}</> : "—"}</p>
                  <p>City: {profileUser.city || "—"}</p>
                </section>
                <section>
                  <p className="text-xs font-medium uppercase mb-2" style={{ color: C.primary }}>Game</p>
                  <p>Level: {profileUser.level ?? "—"} · Rank: {profileUser.rank || "—"}</p>
                  <p>Village: {profileUser.village || "—"} · Clan: {profileUser.clan || "—"}</p>
                  {profileUser.gameStats && (
                    <p className="text-xs mt-1">Missions: {profileUser.gameStats.missionsComplete} · PvP Wins: {profileUser.gameStats.pvpWins} · Playtime: {profileUser.gameStats.playtimeHours}h</p>
                  )}
                  {profileUser.achievements && profileUser.achievements.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">{profileUser.achievements.map((a, i) => <Chip key={i} label={a.title} />)}</div>
                  )}
                </section>
                <section>
                  <p className="text-xs font-medium uppercase mb-2" style={{ color: C.primary }}>Membership</p>
                  <p>Registered: {profileUser.createdAt || profileUser.memberSince || "—"}</p>
                  <p>Last login: {profileUser.lastLoginAt || "—"}</p>
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {profileUser.isAdmin && <Chip label="Administrator" filled />}
                    {profileUser.isTeamMember && <Chip label="Team Member" color="#386A20" />}
                    {profileUser.isDisabled && <Chip label="Disabled" color={C.error} />}
                  </div>
                </section>
                {profileUser.location && (
                  <section>
                    <p className="text-xs font-medium uppercase mb-2" style={{ color: C.primary }}>Security</p>
                    <LocationCell loc={profileUser.location} />
                  </section>
                )}
                {profileUser.activities && profileUser.activities.length > 0 && (
                  <section>
                    <p className="text-xs font-medium uppercase mb-2" style={{ color: C.primary }}>Recent Activity</p>
                    {profileUser.activities.map((a, i) => <p key={i} className="text-xs">{a.description}</p>)}
                  </section>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Contact Detail Modal */}
      {selectedContact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSelectedContact(null)}>
          <div className="rounded-3xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" style={{ background: C.surface, boxShadow: SH2 }} onClick={e => e.stopPropagation()}>
            <div className="flex justify-between mb-4">
              <h3 className="font-medium" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{selectedContact.subject}</h3>
              <button onClick={() => setSelectedContact(null)}><CloseIcon style={{ color: C.onSurfaceVar }} /></button>
            </div>
            <div className="space-y-3 text-sm mb-6" style={{ fontFamily: "Roboto", color: C.onSurfaceVar }}>
              <p><strong style={{ color: C.onSurface }}>From:</strong> {selectedContact.name} · {selectedContact.email}</p>
              <p><strong style={{ color: C.onSurface }}>Category:</strong> {selectedContact.category}</p>
              <p><strong style={{ color: C.onSurface }}>Submitted:</strong> {selectedContact.createdAt}</p>
              {selectedContact.country && <p className="flex items-center gap-1.5"><strong style={{ color: C.onSurface }}>Country:</strong> <FlagImg country={selectedContact.country} size={14} />{formatCountryDisplay(selectedContact.country, selectedContact.countryCode || null)}</p>}
              {selectedContact.ipAddress && <p><strong style={{ color: C.onSurface }}>IP:</strong> {maskIp(selectedContact.ipAddress)}</p>}
              {selectedContact.userId ? <p><strong style={{ color: C.onSurface }}>User ID:</strong> {selectedContact.userId}</p> : <p><strong style={{ color: C.onSurface }}>Guest ID:</strong> {selectedContact.guestIdentifier}</p>}
              <div className="rounded-xl p-3 mt-2" style={{ background: C.surfaceVar, color: C.onSurface }}>{selectedContact.message}</div>
            </div>
            {selectedContact.replies && selectedContact.replies.length > 0 && (
              <div className="mb-4 space-y-2">
                <p className="text-xs font-medium uppercase" style={{ color: C.primary }}>Previous Replies</p>
                {selectedContact.replies.map(r => (
                  <div key={r.id} className="rounded-xl p-3 text-sm" style={{ background: C.primaryCont, color: C.onSurface }}>
                    <p className="text-[10px] mb-1" style={{ color: C.onSurfaceVar }}>{r.adminUsername} · {r.createdAt}</p>
                    {r.body}
                  </div>
                ))}
              </div>
            )}
            <Field label="Administrator Reply" value={contactReply} onChange={setContactReply} rows={4} placeholder="Type your reply…" />
            {!selectedContact.userId && (
              <p className="text-xs mt-2" style={{ color: C.onSurfaceVar }}>Guest submission — reply is saved and logged for email delivery to {selectedContact.email}.</p>
            )}
            <FilledBtn onClick={sendContactReply} cls="mt-4 w-full justify-center">Send Reply</FilledBtn>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminPage;
