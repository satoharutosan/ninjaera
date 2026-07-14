import { useState, useEffect, useCallback, useRef } from "react";
import { toast, Toaster } from "sonner";

// MUI Icons (Navbar & Footer)
import HomeIcon from "@mui/icons-material/Home";
import InfoIcon from "@mui/icons-material/Info";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import GroupsIcon from "@mui/icons-material/Groups";
import ContactSupportIcon from "@mui/icons-material/ContactSupport";
import LoginIcon from "@mui/icons-material/Login";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import MenuIcon from "@mui/icons-material/Menu";
import CloseIcon from "@mui/icons-material/Close";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import NotificationsIcon from "@mui/icons-material/Notifications";
import SendIcon from "@mui/icons-material/Send";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import FacebookIcon from "@mui/icons-material/Facebook";
import XIcon from "@mui/icons-material/X";
import YouTubeIcon from "@mui/icons-material/YouTube";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import LogoutIcon from "@mui/icons-material/Logout";
import PersonIcon from "@mui/icons-material/Person";
import ChatBubbleIcon from "@mui/icons-material/ChatBubble";

import {
  Page, AppSettings, Contact,
  LIGHT_C, DARK_C, ThemeCtx, useC, useWide,
  SH2, ADMIN_NOTIFICATIONS, MSGS_DATA_INIT, BADGE_BG,
  FilledBtn, OutlinedBtn,
} from "@/app/shared";
import { connectRealtime, disconnectRealtime, onRealtimeEvent, joinConversation } from "@/app/realtime";

import HomePage from "@/app/pages/HomePage";
import AboutPage from "@/app/pages/AboutPage";
import ResourcesPage from "@/app/pages/ResourcesPage";
import TeamworkPage from "@/app/pages/TeamworkPage";
import ContactPage from "@/app/pages/ContactPage";
import AlarmsPage from "@/app/pages/AlarmsPage";
import LoginPage from "@/app/pages/LoginPage";
import SignUpPage from "@/app/pages/SignUpPage";
import OAuthCallbackPage from "@/app/pages/OAuthCallbackPage";
import MessagesPage from "@/app/pages/MessagesPage";
import AdminPage from "@/app/pages/AdminPage";
import ProfilePage from "@/app/pages/ProfilePage";
import TermsOfServicePage from "@/app/pages/TermsOfServicePage";
import { pageFromLocation, setPageInLocation } from "@/app/routing";
import { api, setToken, ApiError, type ApiUser, type ApiNotification } from "@/app/api";
import { SOCIAL_LINKS, isSocialUrlConfigured, type SocialPlatform } from "@/app/socialLinks";

// ── NAVBAR ───────────────────────────────────────────────────────────────────
function Navbar({ page, setPage, isDark, setIsDark, loggedIn, user, userAvatar, notifs, setNotifs, msgUnread, dmRequestCount, isAdmin, onLogout }: {
  page:Page; setPage:(p:Page)=>void; isDark:boolean; setIsDark:(v:boolean)=>void;
  loggedIn:boolean; user: ApiUser | null; userAvatar:string|null;
  notifs: ApiNotification[]; setNotifs: React.Dispatch<React.SetStateAction<ApiNotification[]>>;
  msgUnread: number; dmRequestCount: number; isAdmin?: boolean; onLogout: () => void;
}) {
  const C = useC();
  const [mob, setMob] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileMenu, setProfileMenu] = useState<{ x: number; y: number } | null>(null);
  const avatarLongPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notifPanelRef = useRef<HTMLDivElement>(null);
  const notifBtnRef = useRef<HTMLButtonElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const avatarBtnRef = useRef<HTMLButtonElement>(null);
  const showLabels = useWide(1392);
  const go = (p:Page) => { setPage(p); setMob(false); setNotifOpen(false); setProfileMenu(null); window.scrollTo(0,0); };
  const unreadCount = notifs.filter(n => !n.read).length;
  const previewNotifs = notifs.slice(0, 3);
  const links = [
    { label:"Home", page:"home" as Page, Icon:HomeIcon },
    { label:"About", page:"about" as Page, Icon:InfoIcon },
    { label:"Resources", page:"resources" as Page, Icon:MenuBookIcon },
    { label:"Teamwork", page:"teamwork" as Page, Icon:GroupsIcon },
    { label:"Contact", page:"contact" as Page, Icon:ContactSupportIcon },
  ];
  const closeOverlays = useCallback(() => {
    setNotifOpen(false);
    setProfileMenu(null);
  }, []);
  const openProfileMenu = (x: number, y: number) => {
    setNotifOpen(false);
    setProfileMenu({ x, y });
  };
  const closeProfileMenu = () => setProfileMenu(null);
  const toggleNotifOpen = () => {
    setProfileMenu(null);
    setNotifOpen(o => !o);
  };

  useEffect(() => {
    if (!notifOpen && !profileMenu) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (notifPanelRef.current?.contains(target) || notifBtnRef.current?.contains(target)) return;
      if (profileMenuRef.current?.contains(target) || avatarBtnRef.current?.contains(target)) return;
      closeOverlays();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        const focusTarget = notifOpen ? notifBtnRef.current : avatarBtnRef.current;
        closeOverlays();
        focusTarget?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [notifOpen, profileMenu, closeOverlays]);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50" style={{ background:C.surface, boxShadow:SH2 }} onClick={closeOverlays}>
      <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-16">
        <button onClick={() => go("home")} className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ background:C.primary, fontFamily:"Roboto" }}>NE</div>
          <span className="font-medium text-lg" style={{ color:C.onSurface, fontFamily:"Roboto" }}>Ninja Era</span>
        </button>
        <div className="hidden md:flex items-center gap-0.5">
          {links.map(l => (
            <button key={l.page} onClick={() => go(l.page)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all"
              style={{ background:page===l.page?C.primary:"transparent", color:page===l.page?"white":C.onSurfaceVar, fontFamily:"Roboto" }}>
              {showLabels ? <><l.Icon style={{ fontSize:16 }} />{l.label}</> : l.label}
            </button>
          ))}
        </div>
        <div className="hidden md:flex items-center gap-1">
          <button onClick={() => setIsDark(!isDark)} className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-black/5 transition-colors" style={{ color:C.onSurfaceVar }}>
            {isDark ? <LightModeIcon style={{ fontSize:20 }} /> : <DarkModeIcon style={{ fontSize:20 }} />}
          </button>
          <div className="relative" onClick={e => e.stopPropagation()}>
            <button
              ref={notifBtnRef}
              type="button"
              onClick={toggleNotifOpen}
              aria-haspopup="true"
              aria-expanded={notifOpen}
              aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
              className="w-10 h-10 rounded-full flex items-center justify-center relative hover:bg-black/5 transition-colors"
              style={{ color: notifOpen ? C.primary : C.onSurfaceVar }}
            >
              <NotificationsIcon style={{ fontSize:20 }} />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 min-w-[14px] h-3.5 px-0.5 rounded-full flex items-center justify-center text-[8px] font-bold text-white leading-none" style={{ background: BADGE_BG }}>
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>
            {notifOpen && (
              <div
                ref={notifPanelRef}
                role="menu"
                aria-label="Notifications"
                className="absolute right-0 top-full mt-1 w-80 max-w-[calc(100vw-1.5rem)] rounded-2xl border shadow-2xl overflow-hidden z-50"
                style={{ background:C.surface, borderColor:C.outlineVar }}
              >
                <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor:C.outlineVar }}>
                  <span className="font-medium text-sm" style={{ color:C.onSurface, fontFamily:"Roboto" }}>Notifications</span>
                  {unreadCount > 0 && <button onClick={async () => { try { await api.notifications.markAllRead(); } catch { /* */ } setNotifs(ns => ns.map(n => ({...n,read:true}))); }} className="text-[11px] font-medium" style={{ color:C.primary, fontFamily:"Roboto" }}>Mark all read</button>}
                </div>
                {previewNotifs.length === 0 ? (
                  <p className="px-4 py-6 text-center text-xs" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>No notifications yet</p>
                ) : previewNotifs.map(n => (
                  <button key={n.id} role="menuitem" onClick={async () => { try { await api.notifications.markRead(n.id); } catch { /* */ } setNotifs(ns => ns.map(x => x.id===n.id?{...x,read:true}:x)); go("alarms"); }} className="w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-black/5 transition-colors border-b" style={{ borderColor:C.outlineVar }}>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: n.read ? C.surfaceVar : C.primaryCont }}>
                      <NotificationsIcon style={{ fontSize:16, color: n.read ? C.onSurfaceVar : C.primary }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate" style={{ color: n.read ? C.onSurfaceVar : C.onSurface, fontFamily:"Roboto" }}>{n.title}</p>
                      <p className="text-[11px] mt-0.5 line-clamp-2" style={{ color: n.read ? C.onSurfaceVar : C.onSurface, fontFamily:"Roboto", opacity: n.read ? 0.65 : 1 }}>{n.body}</p>
                      <p className="text-[10px] mt-1" style={{ color:C.onSurfaceVar, fontFamily:"Roboto Mono,monospace" }}>{n.time}</p>
                    </div>
                    {!n.read && <span className="w-2 h-2 rounded-full shrink-0 mt-1.5" style={{ background:C.primary }} />}
                  </button>
                ))}
                <button onClick={() => go("alarms")} className="w-full text-center py-3 text-xs font-medium hover:bg-black/5 transition-colors" style={{ color:C.primary, fontFamily:"Roboto" }}>
                  View all notifications <ChevronRightIcon style={{ fontSize:14, verticalAlign:"middle" }} />
                </button>
              </div>
            )}
          </div>
          {loggedIn ? (
            <>
              {isAdmin && (
                <button onClick={() => go("admin")} title="Administration" className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-black/5 transition-colors" style={{ color: page === "admin" ? C.primary : C.onSurfaceVar }}>
                  <AdminPanelSettingsIcon style={{ fontSize: 20 }} />
                </button>
              )}
              <button onClick={() => go("messages")} className="relative flex items-center justify-center hover:bg-[#6750A4]/8 rounded-full transition-colors" style={{ padding: showLabels ? "8px 16px" : "8px", gap: showLabels ? "6px" : 0, color:C.primary, fontFamily:"Roboto", fontSize:"0.875rem", fontWeight:500 }}>
                <ChatBubbleIcon style={{ fontSize:18 }} />
                {showLabels && "Messages"}
                {msgUnread > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 rounded-full text-white text-[9px] flex items-center justify-center font-bold" style={{ background: BADGE_BG }}>{msgUnread > 9 ? "9+" : msgUnread}</span>}
                {dmRequestCount > 0 && <span className="absolute -bottom-0.5 -right-0.5 min-w-[14px] h-3.5 px-0.5 rounded-full text-white text-[8px] flex items-center justify-center font-bold" style={{ background: BADGE_BG }}>{dmRequestCount}</span>}
              </button>
              <button
                ref={avatarBtnRef}
                type="button"
                onClick={() => go("profile")}
                onContextMenu={e => { e.preventDefault(); openProfileMenu(e.clientX, e.clientY); }}
                onKeyDown={e => { if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) { e.preventDefault(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); openProfileMenu(r.left, r.bottom); } }}
                onTouchStart={() => { avatarLongPress.current = setTimeout(() => { const el = avatarBtnRef.current; const r = el?.getBoundingClientRect?.(); if (r) openProfileMenu(r.left, r.bottom); }, 500); }}
                onTouchEnd={() => { if (avatarLongPress.current) clearTimeout(avatarLongPress.current); }}
                onTouchMove={() => { if (avatarLongPress.current) clearTimeout(avatarLongPress.current); }}
                aria-haspopup="menu"
                aria-expanded={!!profileMenu}
                title={`Profile (${user?.username || ""})`}
                className="w-9 h-9 rounded-full overflow-hidden text-white font-medium text-sm ml-1 flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                style={{ background:C.primary, fontFamily:"Roboto", outlineColor: C.primary }}>
                {userAvatar ? <img src={userAvatar} alt="avatar" className="w-full h-full object-cover" /> : (user?.username?.[0] || "Y")}
              </button>
              {profileMenu && (
                <div
                  ref={profileMenuRef}
                  role="menu"
                  aria-label="Profile menu"
                  className="fixed z-[60] min-w-[12rem] rounded-2xl border shadow-2xl overflow-hidden py-1 animate-in fade-in"
                  style={{ top: profileMenu.y, left: Math.min(profileMenu.x, window.innerWidth - 200), background: C.surface, borderColor: C.outlineVar }}
                  onClick={e => e.stopPropagation()}
                >
                  <button role="menuitem" onClick={() => go("profile")} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-black/5 transition-colors" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
                    <PersonIcon style={{ fontSize: 18, color: C.primary }} />Profile ({user?.username})
                  </button>
                  <button role="menuitem" onClick={() => { onLogout(); closeProfileMenu(); go("home"); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-black/5 transition-colors border-t" style={{ color: C.error, borderColor: C.outlineVar, fontFamily: "Roboto" }}>
                    <LogoutIcon style={{ fontSize: 18 }} />Logout
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2 ml-1">
              {showLabels ? (
                <>
                  <OutlinedBtn onClick={() => go("login")}><LoginIcon style={{ fontSize:16 }} />Login</OutlinedBtn>
                  <FilledBtn onClick={() => go("signup")}><PersonAddIcon style={{ fontSize:16 }} />Sign Up</FilledBtn>
                </>
              ) : (
                <>
                  <button onClick={() => go("login")} title="Login" className="w-9 h-9 rounded-full flex items-center justify-center border transition-colors hover:bg-black/5" style={{ borderColor:C.outline, color:C.primary }}><LoginIcon style={{ fontSize:18 }} /></button>
                  <button onClick={() => go("signup")} title="Sign Up" className="w-9 h-9 rounded-full flex items-center justify-center text-white transition-colors hover:opacity-90" style={{ background:C.primary }}><PersonAddIcon style={{ fontSize:18 }} /></button>
                </>
              )}
            </div>
          )}
        </div>
        {/* Mobile: quick actions + hamburger */}
        <div className="md:hidden flex items-center gap-0.5 shrink-0">
          {loggedIn && (
            <>
              <button
                type="button"
                onClick={() => go("alarms")}
                aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
                className="w-10 h-10 rounded-full flex items-center justify-center relative hover:bg-black/5 transition-colors"
                style={{ color: page === "alarms" ? C.primary : C.onSurfaceVar }}
              >
                <NotificationsIcon style={{ fontSize: 20 }} />
                {unreadCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 min-w-[14px] h-3.5 px-0.5 rounded-full flex items-center justify-center text-[8px] font-bold text-white leading-none" style={{ background: BADGE_BG }}>
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => go("messages")}
                aria-label={`Messages${msgUnread > 0 ? ` (${msgUnread} unread)` : ""}`}
                className="w-10 h-10 rounded-full flex items-center justify-center relative hover:bg-black/5 transition-colors"
                style={{ color: page === "messages" ? C.primary : C.onSurfaceVar }}
              >
                <ChatBubbleIcon style={{ fontSize: 20 }} />
                {msgUnread > 0 && (
                  <span className="absolute top-1 right-1 min-w-[14px] h-3.5 px-0.5 rounded-full text-white text-[8px] flex items-center justify-center font-bold leading-none" style={{ background: BADGE_BG }}>
                    {msgUnread > 9 ? "9+" : msgUnread}
                  </span>
                )}
                {dmRequestCount > 0 && (
                  <span className="absolute bottom-1 right-1 min-w-[12px] h-3 px-0.5 rounded-full text-white text-[7px] flex items-center justify-center font-bold leading-none" style={{ background: BADGE_BG }}>
                    {dmRequestCount}
                  </span>
                )}
              </button>
            </>
          )}
          <button
            type="button"
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-black/5"
            onClick={() => setMob(!mob)}
            aria-label={mob ? "Close menu" : "Open menu"}
            aria-expanded={mob}
            style={{ color: C.onSurface }}
          >
            {mob ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>
      </div>
      {mob && (
        <div className="md:hidden border-t" style={{ background:C.surface, borderColor:C.outlineVar }}>
          {links.map(l => (
            <button key={l.page} onClick={() => go(l.page)} className="flex items-center gap-3 w-full px-5 py-3.5 text-sm hover:bg-[#6750A4]/6 transition-colors" style={{ color:page===l.page?C.primary:C.onSurface, fontFamily:"Roboto" }}>
              <l.Icon style={{ fontSize:20, color:page===l.page?C.primary:C.onSurfaceVar }} />{l.label}
            </button>
          ))}
          <div className="border-t" style={{ borderColor:C.outlineVar }}>
            {loggedIn ? (
              <>
                <div className="flex items-center gap-3 px-5 py-4">
                  <div className="w-11 h-11 rounded-full overflow-hidden flex items-center justify-center text-white font-medium text-base shrink-0" style={{ background: C.primary, fontFamily: "Roboto" }}>
                    {userAvatar ? <img src={userAvatar} alt="" className="w-full h-full object-cover" /> : (user?.username?.[0]?.toUpperCase() || "?")}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{user?.username || "User"}</p>
                    <p className="text-xs truncate" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                      {user?.isTeamMember ? "Team Member" : user?.isAdmin ? "Administrator" : "Member"}
                    </p>
                  </div>
                </div>
                {isAdmin && (
                  <button type="button" onClick={() => go("admin")} className="flex items-center gap-3 w-full px-5 py-3.5 text-sm hover:bg-[#6750A4]/6 transition-colors" style={{ color: page === "admin" ? C.primary : C.onSurface, fontFamily: "Roboto" }}>
                    <AdminPanelSettingsIcon style={{ fontSize: 20, color: page === "admin" ? C.primary : C.onSurfaceVar }} />
                    Admin Dashboard
                  </button>
                )}
                <button type="button" onClick={() => go("profile")} className="flex items-center gap-3 w-full px-5 py-3.5 text-sm hover:bg-[#6750A4]/6 transition-colors" style={{ color: page === "profile" ? C.primary : C.onSurface, fontFamily: "Roboto" }}>
                  <PersonIcon style={{ fontSize: 20, color: page === "profile" ? C.primary : C.onSurfaceVar }} />
                  Profile
                </button>
                <button type="button" onClick={() => { onLogout(); go("home"); }} className="flex items-center gap-3 w-full px-5 py-3.5 text-sm hover:bg-[#6750A4]/6 transition-colors border-t" style={{ color: C.error, borderColor: C.outlineVar, fontFamily: "Roboto" }}>
                  <LogoutIcon style={{ fontSize: 20 }} />
                  Log Out
                </button>
              </>
            ) : (
              <div className="flex gap-3 p-4">
                <OutlinedBtn onClick={() => go("login")} cls="flex-1 justify-center">Login</OutlinedBtn>
                <FilledBtn onClick={() => go("signup")} cls="flex-1 justify-center">Sign Up</FilledBtn>
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}

// ── FOOTER ───────────────────────────────────────────────────────────────────
const SOCIAL_ICON_MAP: Record<SocialPlatform, typeof FacebookIcon> = {
  facebook: FacebookIcon,
  x: XIcon,
  youtube: YouTubeIcon,
  whatsapp: WhatsAppIcon,
};

const SOCIAL_BRAND_COLORS: Record<SocialPlatform, string> = {
  facebook: "#1877F2",
  x: "#CAC4D0",
  youtube: "#FF0000",
  whatsapp: "#25D366",
};

function Footer({ setPage }: { setPage:(p:Page)=>void }) {
  const C = useC();
  const [newsletterEmail, setNewsletterEmail] = useState("");
  const go = (p:Page) => { setPage(p); window.scrollTo(0,0); };

  const handleNewsletter = async () => {
    if (!newsletterEmail) return;
    try {
      await api.newsletter.subscribe(newsletterEmail);
      toast.success("Subscribed to newsletter!");
      setNewsletterEmail("");
    } catch {
      toast.error("Could not subscribe. Email may already be registered.");
    }
  };
  return (
    <footer className="pt-16 pb-8 overflow-hidden" style={{ background:"#1C1B1F" }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0" style={{ background:C.primary }}>NE</div>
              <span className="text-white font-medium text-xl" style={{ fontFamily:"Roboto" }}>Ninja Era</span>
            </div>
            <p className="text-sm leading-relaxed mb-5" style={{ color:"#CAC4D0", fontFamily:"Roboto" }}>An immersive MMORPG in a world of shinobi, ancient clans, and forbidden jutsu.</p>
            <div className="flex flex-wrap gap-2" role="list" aria-label="Social media">
              {SOCIAL_LINKS.map((link) => {
                const Icon = SOCIAL_ICON_MAP[link.id];
                const configured = isSocialUrlConfigured(link.url);
                const brandColor = SOCIAL_BRAND_COLORS[link.id];
                const commonCls = "w-10 h-10 rounded-full flex items-center justify-center border transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1C1B1F] focus-visible:ring-[#CAC4D0]";
                if (!configured) {
                  return (
                    <button
                      key={link.id}
                      type="button"
                      role="listitem"
                      title="Link not configured."
                      aria-label={`${link.label} — Link not configured.`}
                      onClick={() => toast.message(`${link.label} link is not configured.`)}
                      className={`${commonCls} opacity-40 cursor-not-allowed`}
                      style={{ borderColor: "#49454F", color: "#79747E" }}
                    >
                      <Icon style={{ fontSize: 18 }} aria-hidden />
                    </button>
                  );
                }
                return (
                  <a
                    key={link.id}
                    role="listitem"
                    href={link.url.trim()}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={link.label}
                    aria-label={`Open ${link.label} (opens in a new tab)`}
                    className={`${commonCls} hover:bg-white/10 hover:scale-110 hover:-translate-y-0.5`}
                    style={{ borderColor: "#49454F", color: brandColor }}
                  >
                    <Icon style={{ fontSize: 18 }} aria-hidden />
                  </a>
                );
              })}
            </div>
          </div>
          <div>
            <h4 className="text-white font-medium text-sm mb-4 uppercase tracking-wide" style={{ fontFamily:"Roboto" }}>Navigation</h4>
            {(["home","about","resources","teamwork","contact"] as Page[]).map(l => (
              <button key={l} onClick={() => go(l)} className="block capitalize text-sm py-1.5 hover:text-white transition-colors" style={{ color:"#CAC4D0", fontFamily:"Roboto" }}>{l}</button>
            ))}
          </div>
          <div>
            <h4 className="text-white font-medium text-sm mb-4 uppercase tracking-wide" style={{ fontFamily:"Roboto" }}>Support</h4>
            {["Help Center","Bug Reports","Server Status","Patch Notes","Game"].map(l => (
              <a key={l} href="#" className="block text-sm py-1.5 hover:text-white transition-colors" style={{ color:"#CAC4D0", fontFamily:"Roboto" }}>{l}</a>
            ))}
          </div>
          <div className="col-span-2 md:col-span-1">
            <h4 className="text-white font-medium text-sm mb-4 uppercase tracking-wide" style={{ fontFamily:"Roboto" }}>Newsletter</h4>
            <p className="text-sm mb-3" style={{ color:"#CAC4D0", fontFamily:"Roboto" }}>Get patch notes and events in your inbox.</p>
            <div className="flex gap-2">
              <input type="email" placeholder="your@email.com" value={newsletterEmail} onChange={e => setNewsletterEmail(e.target.value)}
                className="min-w-0 flex-1 px-3 py-2.5 rounded-[4px] border bg-white/10 text-white text-sm placeholder:text-[#79747E] focus:outline-none"
                style={{ borderColor:"#49454F", fontFamily:"Roboto" }} />
              <button type="button" onClick={handleNewsletter} className="shrink-0 px-3 py-2.5 rounded-[4px] text-white hover:opacity-90" style={{ background:C.primary }}><SendIcon style={{ fontSize:18 }} /></button>
            </div>
          </div>
        </div>
        <div className="border-t pt-6 flex flex-col sm:flex-row justify-between items-center gap-3" style={{ borderColor:"#49454F" }}>
          <p className="text-xs text-center sm:text-left" style={{ color:"#79747E", fontFamily:"Roboto" }}>© 2025 Ninja Era Studio. All rights reserved.</p>
          <div className="flex flex-wrap justify-center gap-4">
            <button type="button" onClick={() => go("terms")} className="text-xs hover:text-white transition-colors" style={{ color:"#79747E", fontFamily:"Roboto" }}>Terms of Service</button>
            <a href="#" className="text-xs hover:text-white transition-colors" style={{ color:"#79747E", fontFamily:"Roboto" }}>Privacy Policy</a>
            <a href="#" className="text-xs hover:text-white transition-colors" style={{ color:"#79747E", fontFamily:"Roboto" }}>Cookie Policy</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

// ── APP ROOT ──────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPageState] = useState<Page>(() => pageFromLocation());
  const setPage = useCallback((p: Page) => {
    setPageState(p);
    setPageInLocation(p);
    window.scrollTo(0, 0);
  }, []);
  const [isDark, setIsDark] = useState(() => localStorage.getItem("ninja-era-theme") === "dark");
  const toggleTheme = (v: boolean) => { setIsDark(v); localStorage.setItem("ninja-era-theme", v ? "dark" : "light"); };

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);
  const [user, setUser] = useState<ApiUser | null>(null);
  const [authReady, setAuthReady] = useState(() => !localStorage.getItem("ninja-era-token"));
  const [settings, setSettings] = useState<AppSettings>({ emailNotif:true, pushNotif:false, twoFA:false, publicProfile:true });
  const [userAvatar, setUserAvatar] = useState<string|null>(null);
  const [contacts, setContacts] = useState<Contact[]>(MSGS_DATA_INIT);
  const [notifs, setNotifs] = useState<ApiNotification[]>(ADMIN_NOTIFICATIONS.map(n => ({ ...n, page: "alarms" })));
  const [msgUnread, setMsgUnread] = useState(0);
  const [dmRequestCount, setDmRequestCount] = useState(0);
  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(null);
  const [focusMessageInput, setFocusMessageInput] = useState(false);
  const clearSelectedConversation = useCallback(() => setSelectedConversationId(null), []);
  const clearFocusMessageInput = useCallback(() => setFocusMessageInput(false), []);
  const loggedIn = !!user;
  const theme = isDark ? DARK_C : LIGHT_C;
  const noNav: Page[] = ["oauth-callback"];
  const noFoot: Page[] = ["messages","login","signup","oauth-callback","admin"];
  const go = setPage;

  useEffect(() => {
    const onPopState = () => setPageState(pageFromLocation());
    window.addEventListener("popstate", onPopState);
    if (!window.location.hash) setPageInLocation(pageFromLocation());
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const handleLogin = useCallback((u: ApiUser) => {
    setUser(u);
    setAuthReady(true);
    if (u.avatarUrl) setUserAvatar(u.avatarUrl);
  }, []);

  const handleLogout = useCallback(() => {
    api.auth.logout().catch(() => {});
    setToken(null);
    setUser(null);
    setUserAvatar(null);
    setContacts(MSGS_DATA_INIT);
    setMsgUnread(0);
    setDmRequestCount(0);
    setSelectedConversationId(null);
    setAuthReady(true);
    disconnectRealtime();
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("ninja-era-token");
    if (!token) {
      setAuthReady(true);
      return;
    }
    let cancelled = false;
    api.auth.me()
      .then(r => {
        if (cancelled) return;
        setUser(r.user);
        if (r.user.avatarUrl) setUserAvatar(r.user.avatarUrl);
        return api.users.me();
      })
      .then(r => {
        if (cancelled || !r) return;
        setSettings({
          emailNotif: r.settings.emailNotif,
          pushNotif: r.settings.pushNotif,
          twoFA: r.settings.twoFA,
          publicProfile: r.settings.publicProfile,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setToken(null);
          setUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) setAuthReady(true);
      });
    return () => { cancelled = true; };
  }, []);

  const refreshConversations = useCallback(() => {
    if (!loggedIn) return;
    api.messages.conversations()
      .then(r => {
        setContacts(r.conversations as Contact[]);
        setMsgUnread(r.conversations.filter(c => c.type === "dm").reduce((s, c) => s + c.unread, 0));
      })
      .catch(() => {});
  }, [loggedIn]);

  const refreshDmRequests = useCallback(() => {
    if (!loggedIn) return;
    api.dm.listRequests()
      .then(r => setDmRequestCount(r.incoming.length))
      .catch(() => {});
  }, [loggedIn]);

  const refreshNotifications = useCallback(() => {
    api.notifications.list().then(r => setNotifs(r.notifications)).catch(() => {});
  }, []);

  useEffect(() => {
    refreshConversations();
    refreshDmRequests();
  }, [loggedIn, refreshConversations, refreshDmRequests]);

  useEffect(() => {
    if (!loggedIn) return;
    connectRealtime();
    const unsubs = [
      onRealtimeEvent("notification:new", () => refreshNotifications()),
      onRealtimeEvent("counts:update", () => {
        refreshNotifications();
        refreshConversations();
        refreshDmRequests();
      }),
      onRealtimeEvent("conversation:update", () => refreshConversations()),
      onRealtimeEvent<{ conversationId: number }>("conversation:new", ({ conversationId }) => {
        joinConversation(conversationId);
        refreshConversations();
      }),
      onRealtimeEvent("dm_request:new", () => refreshDmRequests()),
      onRealtimeEvent("dm_request:resolved", () => refreshDmRequests()),
      onRealtimeEvent<{ userId: number; status: string; online: boolean }>("presence:update", ({ userId, status, online }) => {
        setContacts(prev => prev.map(c => (
          c.type === "dm" && c.otherUserId === userId ? { ...c, online, status } : c
        )));
      }),
    ];
    return () => { unsubs.forEach(u => u()); };
  }, [loggedIn, refreshConversations, refreshNotifications, refreshDmRequests]);

  useEffect(() => {
    refreshNotifications();
  }, [loggedIn, refreshNotifications]);

  useEffect(() => {
    if (!loggedIn) return;
    const ping = () => { api.users.pingPresence().catch(() => {}); };
    ping();
    const id = setInterval(ping, 60000);
    return () => clearInterval(id);
  }, [loggedIn]);

  const sortContacts = (list: Contact[]) => {
    const channels = list.filter(c => c.type === "channel");
    const dms = list.filter(c => c.type === "dm");
    return [...channels, ...dms];
  };

  const addDM = async (name: string, _role: string, _country: string, _city: string) => {
    if (!loggedIn) { go("login"); return; }

    const existingLocal = contacts.find(c => c.type === "dm" && c.name.toLowerCase() === name.toLowerCase());
    if (existingLocal) {
      setContacts(prev => {
        const filtered = prev.filter(c => c.id !== existingLocal.id);
        const dms = [existingLocal, ...filtered.filter(c => c.type === "dm")];
        const channels = filtered.filter(c => c.type === "channel");
        return [...channels, ...dms];
      });
      setSelectedConversationId(existingLocal.id);
      go("messages");
      return;
    }

    try {
      const result = await api.dm.createRequest(name);
      if (result.conversationId) {
        await api.messages.conversations().then(r => {
          setContacts(r.conversations as Contact[]);
          setMsgUnread(r.conversations.filter(c => c.type === "dm").reduce((s, c) => s + c.unread, 0));
        });
        setSelectedConversationId(result.conversationId);
        setFocusMessageInput(true);
        go("messages");
        toast.success("Conversation opened");
        return;
      }
      toast.success("Direct message request sent");
      void refreshNotifications();
    } catch (e) {
      if (e instanceof ApiError && e.data?.conversationId != null) {
        const convId = Number(e.data.conversationId);
        await api.messages.conversations().then(r => {
          setContacts(r.conversations as Contact[]);
          setMsgUnread(r.conversations.filter(c => c.type === "dm").reduce((s, c) => s + c.unread, 0));
        }).catch(() => {});
        setSelectedConversationId(convId);
        go("messages");
        return;
      }
      toast.error(e instanceof Error ? e.message : "Could not start a conversation");
    }
  };

  useEffect(() => {
    if (!authReady) return;
    if ((page === "profile" || page === "messages" || page === "admin") && !loggedIn) {
      go("login");
      return;
    }
    if ((page === "login" || page === "signup") && loggedIn) {
      go("home");
      return;
    }
    if (page === "admin" && loggedIn && !user?.isAdmin) {
      toast.error("Administrator access required");
      go("home");
    }
  }, [authReady, page, loggedIn, user?.isAdmin, go]);

  const showEmailToast = (title: string, body: string, targetPage: Page) => {
    if (!settings.emailNotif) return;
    toast(title, {
      description: body,
      duration: 5000,
      action: { label:"View", onClick: () => go(targetPage) },
    });
  };

  const showPushNotif = (title: string, body: string, targetPage: Page) => {
    if (!settings.pushNotif) return;
    if ("Notification" in window && Notification.permission === "granted") {
      const n = new Notification(title, { body, icon:"/favicon.ico" });
      n.onclick = () => { window.focus(); go(targetPage); };
    }
  };

  return (
    <ThemeCtx.Provider value={theme}>
    <div style={{ minHeight:"100vh", background:theme.bg, fontFamily:"Roboto, sans-serif" }}>
      <Toaster position="top-right" richColors />
      {!authReady ? (
        <div className="min-h-screen flex items-center justify-center" aria-busy="true" aria-label="Restoring session">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: theme.primary, borderTopColor: "transparent" }} />
            <p className="text-sm" style={{ color: theme.onSurfaceVar, fontFamily: "Roboto" }}>Restoring session…</p>
          </div>
        </div>
      ) : (
        <>
      {!noNav.includes(page) && <Navbar page={page} setPage={go} isDark={isDark} setIsDark={toggleTheme} loggedIn={loggedIn} user={user} userAvatar={userAvatar} notifs={notifs} setNotifs={setNotifs} msgUnread={msgUnread} dmRequestCount={dmRequestCount} isAdmin={user?.isAdmin} onLogout={handleLogout} />}
      {page==="home"      && <HomePage setPage={go} />}
      {page==="about"     && <AboutPage />}
      {page==="resources" && <ResourcesPage isTeamMember={user?.isTeamMember} />}
      {page==="teamwork"  && <TeamworkPage loggedIn={loggedIn} setPage={go} onAddDM={addDM} />}
      {page==="contact"   && <ContactPage />}
      {page==="alarms"    && <AlarmsPage setPage={go} onConversationsRefresh={refreshConversations} onNotificationsRefresh={refreshNotifications} />}
      {page==="login"     && !loggedIn && <LoginPage setPage={go} onLogin={handleLogin} />}
      {page==="signup"    && !loggedIn && <SignUpPage setPage={go} onLogin={handleLogin} />}
      {page==="oauth-callback" && <OAuthCallbackPage setPage={go} onLogin={handleLogin} />}
      {page==="messages"  && loggedIn && <MessagesPage settings={settings} showEmailToast={showEmailToast} showPushNotif={showPushNotif} contacts={contacts} setContacts={setContacts} onUnreadChange={setMsgUnread} currentUserId={user?.id ?? 0} currentUser={user} onUserUpdate={setUser} initialConversationId={selectedConversationId} focusInput={focusMessageInput} onFocusHandled={clearFocusMessageInput} onInitialConversationHandled={clearSelectedConversation} />}
      {page==="profile"   && loggedIn && <ProfilePage setPage={go} isDark={isDark} setIsDark={toggleTheme} settings={settings} setSettings={setSettings} user={user} setUser={setUser} userAvatar={userAvatar} setUserAvatar={setUserAvatar} onLogout={handleLogout} />}
      {page==="admin"     && loggedIn && user?.isAdmin && <AdminPage setPage={go} />}
      {page==="terms"     && <TermsOfServicePage />}
      {!noFoot.includes(page) && <Footer setPage={go} />}
        </>
      )}
    </div>
    </ThemeCtx.Provider>
  );
}
