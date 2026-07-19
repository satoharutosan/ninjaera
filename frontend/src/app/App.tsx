import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { toast, Toaster } from "sonner";
import Badge from "@mui/material/Badge";

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
import { messageCache } from "@/features/messages/messageCache";
import { toChatMsg } from "@/features/messages/types";
import {
  clearActiveConversation,
  clearAllConversationDrafts,
  getActiveConversation,
} from "@/features/messages/activeConversationStore";
import { appPerf } from "@/shared/perf";
import { pageFromLocation, setPageInLocation } from "@/shared/routing";
import { BrandLogo } from "@/shared/BrandLogo";
import { BRAND_LOGO_SRC, BRAND_NAME } from "@/shared/branding";
import { getCachedUser, setCachedUser, clearAuthStorage, getStoredToken } from "@/shared/authStorage";
import { useNavHeroOverlay } from "@/shared/navHero";
import { api, setToken, ApiError, type ApiUser, type ApiNotification, type ApiMessage } from "@/app/api";
import { SOCIAL_LINKS, isSocialUrlConfigured, type SocialPlatform } from "@/shared/socialLinks";
import { SECTION_IDS, scrollToSection, scrollToSectionWhenReady } from "@/shared/scrollToSection";
import { CallProvider } from "@/features/calling/CallProvider";
import { CallOverlays } from "@/features/calling/CallOverlays";

// Eager page imports — avoids Suspense flash on route changes (native-feeling navigation).
import HomePage from "@/features/landing/HomePage";
import LoginPage from "@/features/auth/LoginPage";
import OAuthCallbackPage from "@/features/auth/OAuthCallbackPage";
import ForgotPasswordPage from "@/features/auth/ForgotPasswordPage";
import ResetPasswordPage from "@/features/auth/ResetPasswordPage";
import AboutPage from "@/features/landing/AboutPage";
import ResourcesPage from "@/features/resources/ResourcesPage";
import TeamworkPage from "@/features/teamwork/TeamworkPage";
import ContactPage from "@/features/landing/ContactPage";
import AlarmsPage from "@/features/notifications/AlarmsPage";
import SignUpPage from "@/features/auth/SignUpPage";
import VerifyEmailPage from "@/features/auth/VerifyEmailPage";
import ProfilePage from "@/features/profile/ProfilePage";
import TermsOfServicePage from "@/features/landing/TermsOfServicePage";
import PrivacyPolicyPage from "@/features/landing/PrivacyPolicyPage";
import MessagesPage from "@/features/messages/MessagesPage";
import AdminPage from "@/features/admin/AdminPage";
import HelpCenterPage from "@/features/landing/HelpCenterPage";
import BugReportsPage from "@/features/landing/BugReportsPage";
import ServerStatusPage from "@/features/landing/ServerStatusPage";
import PatchNotesPage from "@/features/landing/PatchNotesPage";

/** Shared navbar badge — identical styling for notifications and messages (top-right). */
function NavIconBadge({
  badgeContent,
  children,
  max = 99,
}: {
  badgeContent: number;
  children: ReactNode;
  max?: number;
}) {
  return (
    <Badge
      badgeContent={badgeContent}
      max={max}
      invisible={badgeContent <= 0}
      color="error"
      overlap="circular"
      anchorOrigin={{ vertical: "top", horizontal: "right" }}
      sx={{
        "& .MuiBadge-badge": {
          backgroundColor: BADGE_BG,
          color: "#fff",
          fontSize: "8px",
          fontWeight: 700,
          lineHeight: 1,
          minWidth: 14,
          height: 14,
          padding: "0 2px",
          borderRadius: "9999px",
        },
      }}
    >
      {children}
    </Badge>
  );
}

// ── NAVBAR ───────────────────────────────────────────────────────────────────
function Navbar({ page, setPage, isDark, setIsDark, loggedIn, user, userAvatar, notifs, setNotifs, messageBadge, isAdmin, onLogout }: {
  page:Page; setPage:(p:Page)=>void; isDark:boolean; setIsDark:(v:boolean)=>void;
  loggedIn:boolean; user: ApiUser | null; userAvatar:string|null;
  notifs: ApiNotification[]; setNotifs: React.Dispatch<React.SetStateAction<ApiNotification[]>>;
  /** Unread DMs + pending DM requests (single navbar badge). */
  messageBadge: number; isAdmin?: boolean; onLogout: () => void;
}) {
  const C = useC();
  const [mob, setMob] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileMenu, setProfileMenu] = useState<{ x: number; y: number } | null>(null);
  /** Driven by shared `[data-nav-hero]` detection — works for every route automatically. */
  const overHero = useNavHeroOverlay(page);
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
    { label:"Contributors", page:"teamwork" as Page, Icon:GroupsIcon },
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

  // Solid chrome while mobile drawer is open; otherwise translucent over heroes.
  const translucent = overHero && !mob;
  const navFg = translucent ? "#FFFFFF" : C.onSurface;
  const navMuted = translucent ? "rgba(255,255,255,0.88)" : C.onSurfaceVar;
  const iconHover = translucent ? "hover:bg-white/15" : "hover:bg-black/5";
  const textShadow = translucent ? "0 1px 2px rgba(0,0,0,0.55)" : undefined;

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50"
      style={{
        background: translucent
          ? (isDark ? "rgba(20, 18, 24, 0.28)" : "rgba(255, 255, 255, 0.22)")
          : C.surface,
        backdropFilter: translucent ? "blur(14px) saturate(1.2)" : undefined,
        WebkitBackdropFilter: translucent ? "blur(14px) saturate(1.2)" : undefined,
        boxShadow: translucent ? "0 1px 0 rgba(255,255,255,0.08)" : SH2,
        transition: "background-color 250ms ease, box-shadow 250ms ease, backdrop-filter 250ms ease",
      }}
      onClick={closeOverlays}
    >
      <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-16">
        <button onClick={() => go("home")} className="flex items-center gap-2.5" aria-label={`${BRAND_NAME} home`}>
          <BrandLogo size={32} priority />
          <span className="font-medium text-lg" style={{ color: navFg, fontFamily: "'Trade Winds', cursive", textShadow }}>{BRAND_NAME}</span>
        </button>
        <div className="hidden md:flex items-center gap-0.5">
          {links.map(l => (
            <button key={l.page} onClick={() => go(l.page)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all"
              style={{
                background: page === l.page ? C.primary : "transparent",
                color: page === l.page ? "white" : navMuted,
                fontFamily: "Roboto",
                textShadow: page === l.page ? undefined : textShadow,
              }}>
              {showLabels ? <><l.Icon style={{ fontSize:16 }} />{l.label}</> : l.label}
            </button>
          ))}
        </div>
        <div className="hidden md:flex items-center gap-1">
          <button onClick={() => setIsDark(!isDark)} className={`w-10 h-10 rounded-full flex items-center justify-center ${iconHover} transition-colors`} style={{ color: navMuted }}>
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
              className={`w-10 h-10 rounded-full flex items-center justify-center ${iconHover} transition-colors`}
              style={{ color: notifOpen ? C.primary : navMuted }}
            >
              <NavIconBadge badgeContent={unreadCount}>
                <NotificationsIcon style={{ fontSize:20 }} />
              </NavIconBadge>
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
                <button onClick={() => go("admin")} title="Administration" className={`w-10 h-10 rounded-full flex items-center justify-center ${iconHover} transition-colors`} style={{ color: page === "admin" ? C.primary : navMuted }}>
                  <AdminPanelSettingsIcon style={{ fontSize: 20 }} />
                </button>
              )}
              <button onClick={() => go("messages")} className={`flex items-center justify-center ${iconHover} rounded-full transition-colors`} style={{ padding: showLabels ? "8px 16px" : "8px", gap: showLabels ? "6px" : 0, color: translucent ? "#FFFFFF" : C.primary, fontFamily:"Roboto", fontSize:"0.875rem", fontWeight:500, textShadow }} aria-label={`Messages${messageBadge > 0 ? ` (${messageBadge})` : ""}`}>
                <NavIconBadge badgeContent={messageBadge}>
                  <ChatBubbleIcon style={{ fontSize:18 }} />
                </NavIconBadge>
                {showLabels && <span>Messages</span>}
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
                  <button onClick={() => go("login")} title="Login" className={`w-9 h-9 rounded-full flex items-center justify-center border transition-colors ${iconHover}`} style={{ borderColor: translucent ? "rgba(255,255,255,0.55)" : C.outline, color: translucent ? "#FFFFFF" : C.primary }}><LoginIcon style={{ fontSize:18 }} /></button>
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
                className={`w-10 h-10 rounded-full flex items-center justify-center ${iconHover} transition-colors`}
                style={{ color: page === "alarms" ? C.primary : navMuted }}
              >
                <NavIconBadge badgeContent={unreadCount}>
                  <NotificationsIcon style={{ fontSize: 20 }} />
                </NavIconBadge>
              </button>
              <button
                type="button"
                onClick={() => go("messages")}
                aria-label={`Messages${messageBadge > 0 ? ` (${messageBadge})` : ""}`}
                className={`w-10 h-10 rounded-full flex items-center justify-center ${iconHover} transition-colors`}
                style={{ color: page === "messages" ? C.primary : navMuted }}
              >
                <NavIconBadge badgeContent={messageBadge}>
                  <ChatBubbleIcon style={{ fontSize: 20 }} />
                </NavIconBadge>
              </button>
            </>
          )}
          <button
            type="button"
            className={`w-10 h-10 flex items-center justify-center rounded-full ${iconHover}`}
            onClick={() => setMob(!mob)}
            aria-label={mob ? "Close menu" : "Open menu"}
            aria-expanded={mob}
            style={{ color: navFg }}
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
                {isAdmin && (
                  <button type="button" onClick={() => go("admin")} className="flex items-center gap-3 w-full px-5 py-3.5 text-sm hover:bg-[#6750A4]/6 transition-colors" style={{ color: page === "admin" ? C.primary : C.onSurface, fontFamily: "Roboto" }}>
                    <AdminPanelSettingsIcon style={{ fontSize: 20, color: page === "admin" ? C.primary : C.onSurfaceVar }} />
                    Admin Dashboard
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => go("profile")}
                  aria-label={`Open profile for ${user?.username || "user"}`}
                  className="flex items-center gap-3 w-full px-5 py-4 text-left hover:bg-[#6750A4]/6 active:bg-[#6750A4]/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset"
                  style={{ color: C.onSurface, outlineColor: C.primary }}
                >
                  <div className="w-11 h-11 rounded-full overflow-hidden flex items-center justify-center text-white font-medium text-base shrink-0" style={{ background: C.primary, fontFamily: "Roboto" }}>
                    {userAvatar ? <img src={userAvatar} alt="" className="w-full h-full object-cover" /> : (user?.username?.[0]?.toUpperCase() || "?")}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{user?.username || "User"}</p>
                    <p className="text-xs truncate" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                      {user?.isTeamMember ? "Team Member" : user?.isAdmin ? "Administrator" : "Member"}
                    </p>
                  </div>
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

function Footer({ setPage, onGoToDownload }: { setPage:(p:Page)=>void; onGoToDownload: () => void }) {
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

  const supportLinks: { label: string; action: () => void }[] = [
    { label: "Help Center", action: () => go("help") },
    { label: "Bug Reports", action: () => go("bugs") },
    { label: "Server Status", action: () => go("status") },
    { label: "Patch Notes", action: () => go("patches") },
    { label: "Game", action: onGoToDownload },
  ];

  return (
    <footer className="pt-16 pb-8 overflow-hidden" style={{ background:"#1C1B1F" }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2.5 mb-4">
              <BrandLogo size={36} priority />
              <span className="text-white font-medium text-xl" style={{ fontFamily:"Roboto" }}>{BRAND_NAME}</span>
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
            {supportLinks.map(l => (
              <button
                key={l.label}
                type="button"
                onClick={l.action}
                className="block text-sm py-1.5 hover:text-white transition-colors text-left w-full"
                style={{ color:"#CAC4D0", fontFamily:"Roboto" }}
              >
                {l.label}
              </button>
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
          <p className="text-xs text-center sm:text-left" style={{ color:"#79747E", fontFamily:"Roboto" }}>© 2026 {BRAND_NAME} Studio. All rights reserved.</p>
          <div className="flex flex-wrap justify-center gap-4">
            <button type="button" onClick={() => go("terms")} className="text-xs hover:text-white transition-colors" style={{ color:"#79747E", fontFamily:"Roboto" }}>Terms of Service</button>
            <button type="button" onClick={() => go("privacy")} className="text-xs hover:text-white transition-colors" style={{ color:"#79747E", fontFamily:"Roboto" }}>Privacy Policy</button>
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
  const pendingSectionRef = useRef<string | null>(null);
  const setPage = useCallback((p: Page) => {
    appPerf.mark(`route:${p}`);
    setPageState(p);
    // Preserve hash query (e.g. verify-email?token= / ?email=) when navigating to the same page
    const current = pageFromLocation();
    const hash = window.location.hash.replace(/^#\/?/, "");
    const hasQuery = hash.includes("?");
    if (!(p === current && hasQuery)) {
      setPageInLocation(p);
    }
    if (!pendingSectionRef.current) window.scrollTo(0, 0);
    requestAnimationFrame(() => appPerf.measure(`route:${p}`));
  }, []);

  const goToDownload = useCallback(() => {
    if (page === "home") {
      scrollToSection(SECTION_IDS.download);
      return;
    }
    pendingSectionRef.current = SECTION_IDS.download;
    setPage("home");
  }, [page, setPage]);

  useEffect(() => {
    if (page !== "home" || !pendingSectionRef.current) return;
    const target = pendingSectionRef.current;
    pendingSectionRef.current = null;
    scrollToSectionWhenReady(target);
  }, [page]);
  const [isDark, setIsDark] = useState(() => localStorage.getItem("ninja-era-theme") === "dark");
  const toggleTheme = (v: boolean) => { setIsDark(v); localStorage.setItem("ninja-era-theme", v ? "dark" : "light"); };

  useEffect(() => {
    appPerf.mark("app:boot");
    return () => appPerf.measure("app:boot");
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);
  const [user, setUser] = useState<ApiUser | null>(() => {
    // Optimistic restore so protected routes don't flash Login on refresh
    return getStoredToken() ? getCachedUser() : null;
  });
  const [authReady, setAuthReady] = useState(() => {
    const token = getStoredToken();
    if (!token) return true;
    // Cached profile → show app immediately while revalidating in the background
    return !!getCachedUser();
  });
  const [settings, setSettings] = useState<AppSettings>({ emailNotif:true, pushNotif:false, twoFA:false, publicProfile:true });
  const [userAvatar, setUserAvatar] = useState<string|null>(() => {
    const cached = getStoredToken() ? getCachedUser() : null;
    return cached?.avatarUrl ?? null;
  });
  const [contacts, setContacts] = useState<Contact[]>(MSGS_DATA_INIT);
  const [notifs, setNotifs] = useState<ApiNotification[]>(ADMIN_NOTIFICATIONS.map(n => ({ ...n, page: "alarms" })));
  const [msgUnread, setMsgUnread] = useState(0);
  const [dmRequestCount, setDmRequestCount] = useState(0);
  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(null);
  const [focusMessageInput, setFocusMessageInput] = useState(false);
  /** Keep MessagesPage mounted after first visit so selection/scroll/draft survive navigation. */
  const [messagesKeepAlive, setMessagesKeepAlive] = useState(() => pageFromLocation() === "messages");
  const convRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dmRequestsIntent, setDmRequestsIntent] = useState<{ requestId?: number; nonce: number } | null>(null);
  const dmRequestsNonce = useRef(0);
  const clearSelectedConversation = useCallback(() => setSelectedConversationId(null), []);
  const clearFocusMessageInput = useCallback(() => setFocusMessageInput(false), []);
  const clearDmRequestsIntent = useCallback(() => setDmRequestsIntent(null), []);
  const openDmRequestsView = useCallback((requestId?: number) => {
    dmRequestsNonce.current += 1;
    setDmRequestsIntent({ requestId, nonce: dmRequestsNonce.current });
  }, []);
  const loggedIn = !!user;
  const theme = isDark ? DARK_C : LIGHT_C;
  const noNav: Page[] = ["oauth-callback", "verify-email", "forgot-password", "reset-password"];
  const noFoot: Page[] = ["messages","login","signup","oauth-callback","admin","forgot-password","reset-password","verify-email"];
  const go = setPage;

  useEffect(() => {
    const onPopState = () => setPageState(pageFromLocation());
    window.addEventListener("popstate", onPopState);
    if (!window.location.hash) setPageInLocation(pageFromLocation());
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const handleLogin = useCallback((u: ApiUser) => {
    setUser(u);
    setCachedUser(u);
    setAuthReady(true);
    if (u.avatarUrl) setUserAvatar(u.avatarUrl);
  }, []);

  // Keep local profile snapshot in sync for instant restore after refresh
  useEffect(() => {
    if (user) setCachedUser(user);
  }, [user]);

  const handleLogout = useCallback(() => {
    const uid = user?.id;
    api.auth.logout().catch(() => {});
    clearAuthStorage();
    setToken(null);
    setUser(null);
    setUserAvatar(null);
    setContacts(MSGS_DATA_INIT);
    setMsgUnread(0);
    setDmRequestCount(0);
    setSelectedConversationId(null);
    setMessagesKeepAlive(false);
    if (uid) {
      clearActiveConversation(uid);
      clearAllConversationDrafts(uid);
    }
    setAuthReady(true);
    messageCache.clear();
    disconnectRealtime();
  }, [user?.id]);

  // Mount Messages once visited; keep it alive across route changes (Discord-style).
  useEffect(() => {
    if (page === "messages" && loggedIn) setMessagesKeepAlive(true);
  }, [page, loggedIn]);

  useEffect(() => {
    if (!loggedIn) setMessagesKeepAlive(false);
  }, [loggedIn]);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      clearAuthStorage();
      setAuthReady(true);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const { user: me } = await api.auth.me();
        if (cancelled) return;
        setUser(me);
        setCachedUser(me);
        if (me.avatarUrl) setUserAvatar(me.avatarUrl);
        // Settings are best-effort — failure must not log the user out
        try {
          const r = await api.users.me();
          if (cancelled) return;
          setSettings({
            emailNotif: r.settings.emailNotif,
            pushNotif: r.settings.pushNotif,
            twoFA: r.settings.twoFA,
            publicProfile: r.settings.publicProfile,
          });
          if (r.user?.avatarUrl) setUserAvatar(r.user.avatarUrl);
        } catch {
          /* keep session; settings stay at defaults / previous */
        }
      } catch (e) {
        if (cancelled) return;
        const status = e instanceof ApiError ? e.status : 0;
        // Only clear the persistent session when the server rejects the token
        if (status === 401 || status === 403) {
          clearAuthStorage();
          setToken(null);
          setUser(null);
          setUserAvatar(null);
        }
        // Network / 5xx: keep cached user so refresh doesn't force logout
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const refreshConversations = useCallback(() => {
    if (!loggedIn) return;
    if (convRefreshTimer.current) clearTimeout(convRefreshTimer.current);
    convRefreshTimer.current = setTimeout(() => {
      convRefreshTimer.current = null;
      api.messages.conversations()
        .then(r => {
          setContacts(r.conversations as Contact[]);
          setMsgUnread(r.conversations.filter(c => c.type === "dm").reduce((s, c) => s + c.unread, 0));
        })
        .catch(() => {});
    }, 400);
  }, [loggedIn]);

  /** Efficient badge sync: unread DMs + pending DM requests (COUNT queries only). */
  const refreshMessageBadge = useCallback(() => {
    if (!loggedIn) return;
    api.messages.badgeCount()
      .then(r => {
        setMsgUnread(r.unreadMessages);
        setDmRequestCount(r.pendingDMRequests);
      })
      .catch(() => {});
  }, [loggedIn]);

  const refreshNotifications = useCallback(() => {
    api.notifications.list().then(r => setNotifs(r.notifications)).catch(() => {});
  }, []);

  // Fresh-value refs so stable realtime handlers read current contacts/settings/page/user.
  const contactsRef = useRef(contacts);
  contactsRef.current = contacts;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const pageRef = useRef(page);
  pageRef.current = page;
  const userRef = useRef(user);
  userRef.current = user;

  // Ask for browser notification permission once, after login.
  useEffect(() => {
    if (!loggedIn) return;
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, [loggedIn]);

  const messagePreview = useCallback((m: ApiMessage): string => {
    if (typeof m.msg === "string" && m.msg.trim()) return m.msg;
    switch (m.mediaType) {
      case "image": return "📷 Photo";
      case "video": return "🎥 Video";
      case "audio":
      case "voice": return "🎙️ Voice message";
      case "file": return "📎 Attachment";
      default: return "New message";
    }
  }, []);

  /** Deep-link a browser notification for a new message (mute-gated, focus + select). */
  const notifyNewMessage = useCallback((conversationId: number, message: ApiMessage) => {
    const me = userRef.current;
    if (!me) return;
    if (message.self || Number(message.userId) === Number(me.id)) return;
    if (!settingsRef.current.pushNotif) return;
    const contact = contactsRef.current.find(c => c.id === conversationId);
    // Per-conversation mute suppresses all notifications from that conversation.
    if (contact?.muted) return;
    // Skip when the user is already viewing this conversation in a focused tab.
    const active = getActiveConversation(me.id)?.conversationId === conversationId;
    if (active && pageRef.current === "messages" && typeof document !== "undefined" && document.hasFocus()) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;

    const isChannel = contact?.type === "channel";
    const username = message.user || contact?.name || "New message";
    const title = isChannel && contact ? `${username} • ${contact.name}` : username;
    try {
      const n = new Notification(title, {
        body: messagePreview(message),
        icon: message.avatarUrl || contact?.avatarUrl || BRAND_LOGO_SRC,
        tag: `conversation-${conversationId}`,
      });
      n.onclick = () => {
        try { window.focus(); } catch { /* ignore */ }
        setMessagesKeepAlive(true);
        setSelectedConversationId(conversationId);
        setFocusMessageInput(true);
        go("messages");
        n.close();
      };
    } catch { /* Notification construction can throw on some browsers */ }
  }, [go, messagePreview]);

  /** Deep-link a browser notification for a new DM request (opens the DM Requests view). */
  const notifyDmRequest = useCallback(() => {
    if (!settingsRef.current.pushNotif) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    api.dm.listRequests()
      .then(r => {
        const newest = r.incoming[0];
        try {
          const n = new Notification("New message request", {
            body: newest
              ? `${newest.requesterDisplayName || newest.requesterName} wants to message you`
              : "You have a new direct message request.",
            icon: newest?.requesterAvatar || BRAND_LOGO_SRC,
            tag: "dm-request",
          });
          n.onclick = () => {
            try { window.focus(); } catch { /* ignore */ }
            setMessagesKeepAlive(true);
            go("messages");
            openDmRequestsView(newest?.id);
            n.close();
          };
        } catch { /* ignore */ }
      })
      .catch(() => {});
  }, [go, openDmRequestsView]);

  useEffect(() => {
    refreshConversations();
    refreshMessageBadge();
  }, [loggedIn, refreshConversations, refreshMessageBadge]);

  useEffect(() => {
    if (!loggedIn) return;
    connectRealtime();
    const unsubs = [
      onRealtimeEvent("notification:new", () => refreshNotifications()),
      onRealtimeEvent("counts:update", () => {
        refreshNotifications();
        refreshConversations();
        refreshMessageBadge();
      }),
      onRealtimeEvent("conversation:update", () => {
        refreshConversations();
        refreshMessageBadge();
      }),
      onRealtimeEvent<{ conversationId: number }>("conversation:restored", ({ conversationId }) => {
        joinConversation(conversationId);
        refreshConversations();
        refreshMessageBadge();
      }),
      onRealtimeEvent<{ conversationId: number }>("conversation:hidden", () => {
        refreshConversations();
        refreshMessageBadge();
      }),
      onRealtimeEvent<{
        peerUserId: number;
        blockedByMe: boolean;
        isBlocked: boolean;
      }>("relationship:updated", (data) => {
        if (!data?.peerUserId) return;
        setContacts(prev => prev.map(c =>
          c.type === "dm" && c.otherUserId === data.peerUserId
            ? { ...c, blockedByMe: data.blockedByMe, isBlocked: data.isBlocked }
            : c,
        ));
        refreshMessageBadge();
      }),
      onRealtimeEvent<{ conversationId: number }>("conversation:new", ({ conversationId }) => {
        joinConversation(conversationId);
        refreshConversations();
        refreshMessageBadge();
      }),
      // Keep messageCache warm while MessagesPage is unmounted (e.g. user on Home).
      // Without this, openConversation trusts a stale hasNewestWindow and skips fetch.
      onRealtimeEvent<{ conversationId: number; message: ApiMessage }>("message:new", ({ conversationId, message }) => {
        if (!user?.id || !conversationId || !message?.id) return;
        messageCache.upsertMessage(conversationId, toChatMsg(message, user.id));
        notifyNewMessage(conversationId, message);
      }),
      onRealtimeEvent<{ conversationId: number; message: ApiMessage }>("message:updated", ({ conversationId, message }) => {
        if (!user?.id || !conversationId || !message?.id) return;
        messageCache.upsertMessage(conversationId, toChatMsg(message, user.id));
      }),
      onRealtimeEvent<{ conversationId: number; messageId: number }>("message:deleted", ({ conversationId, messageId }) => {
        if (!conversationId || !messageId) return;
        messageCache.removeMessage(conversationId, messageId);
      }),
      onRealtimeEvent("dm_request:new", () => { refreshMessageBadge(); notifyDmRequest(); }),
      onRealtimeEvent("dm_request:resolved", () => refreshMessageBadge()),
      onRealtimeEvent<{ requestId: number; conversationId: number }>("dm_request:accepted", ({ conversationId }) => {
        joinConversation(conversationId);
        refreshMessageBadge();
        refreshConversations();
        refreshNotifications();
      }),
      onRealtimeEvent<{ userId: number; status: string; online: boolean }>("presence:update", ({ userId, status, online }) => {
        // Skip identity-preserving updates so App/Navbar don't thrash on identical presence.
        setContacts(prev => {
          let changed = false;
          const next = prev.map(c => {
            if (c.type !== "dm" || c.otherUserId !== userId) return c;
            if (c.online === online && c.status === status) return c;
            changed = true;
            return { ...c, online, status };
          });
          return changed ? next : prev;
        });
      }),
      onRealtimeEvent<{
        userId: number;
        username: string;
        avatarUrl?: string | null;
        bio?: string;
        mood?: string;
        status?: string;
      }>("profile:updated", (data) => {
        if (!data?.userId || !data.username) return;
        // Own session (other tab / admin edit): keep navbar + auth cache current.
        if (user?.id === data.userId) {
          setUser(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              username: data.username,
              avatarUrl: data.avatarUrl !== undefined ? data.avatarUrl : prev.avatarUrl,
              bio: data.bio !== undefined ? data.bio : prev.bio,
              mood: data.mood !== undefined ? data.mood : prev.mood,
              status: data.status !== undefined ? data.status : prev.status,
            };
          });
          if (data.avatarUrl) setUserAvatar(data.avatarUrl);
          else if (data.avatarUrl === null) setUserAvatar(null);
        }
        // Patch DM list in place (no full conversations refetch).
        setContacts(prev => {
          let changed = false;
          const next = prev.map(c => {
            if (c.type !== "dm" || c.otherUserId !== data.userId) return c;
            changed = true;
            return {
              ...c,
              name: data.username,
              avatarUrl: data.avatarUrl !== undefined ? data.avatarUrl : c.avatarUrl,
              bio: data.bio !== undefined ? data.bio : c.bio,
              mood: data.mood !== undefined ? data.mood : c.mood,
              ...(data.status !== undefined ? { status: data.status } : {}),
            };
          });
          return changed ? next : prev;
        });
        messageCache.patchUserIdentity(
          data.userId,
          { username: data.username, avatarUrl: data.avatarUrl },
          user?.id,
        );
      }),
    ];
    return () => {
      unsubs.forEach(u => u());
      if (convRefreshTimer.current) clearTimeout(convRefreshTimer.current);
    };
  }, [loggedIn, user?.id, refreshConversations, refreshNotifications, refreshMessageBadge, notifyNewMessage, notifyDmRequest]);

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
      const n = new Notification(title, { body, icon: BRAND_LOGO_SRC });
      n.onclick = () => { window.focus(); go(targetPage); };
    }
  };

  return (
    <ThemeCtx.Provider value={theme}>
    <CallProvider>
    <div style={{
      minHeight: page === "admin" || page === "messages" ? undefined : "100vh",
      height: page === "admin" || page === "messages" ? "100dvh" : undefined,
      maxHeight: page === "admin" || page === "messages" ? "100dvh" : undefined,
      overflow: page === "admin" || page === "messages" ? "hidden" : undefined,
      background: theme.bg,
      fontFamily: "Roboto, sans-serif",
    }}>
      <Toaster position="top-right" richColors />
      <CallOverlays />
      {!authReady ? (
        <div className="min-h-screen flex items-center justify-center" aria-busy="true" aria-label="Restoring session">
          <div className="flex flex-col items-center gap-3">
            <BrandLogo size={48} priority />
            <div className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: theme.primary, borderTopColor: "transparent" }} />
            <p className="text-sm" style={{ color: theme.onSurfaceVar, fontFamily: "Roboto" }}>Restoring session…</p>
          </div>
        </div>
      ) : (
        <>
      {!noNav.includes(page) && <Navbar page={page} setPage={go} isDark={isDark} setIsDark={toggleTheme} loggedIn={loggedIn} user={user} userAvatar={userAvatar} notifs={notifs} setNotifs={setNotifs} messageBadge={msgUnread + dmRequestCount} isAdmin={user?.isAdmin} onLogout={handleLogout} />}
        {page==="home"      && <HomePage setPage={go} onGoToDownload={goToDownload} />}
        {page==="about"     && <AboutPage setPage={go} />}
        {page==="resources" && <ResourcesPage isTeamMember={user?.isTeamMember} isAdmin={user?.isAdmin} />}
        {page==="teamwork"  && <TeamworkPage loggedIn={loggedIn} setPage={go} onAddDM={addDM} />}
        {page==="contact"   && <ContactPage />}
        {page==="alarms"    && <AlarmsPage setPage={go} onConversationsRefresh={refreshConversations} onNotificationsRefresh={refreshNotifications} />}
        {page==="login"     && !loggedIn && <LoginPage setPage={go} onLogin={handleLogin} />}
        {page==="signup"    && !loggedIn && <SignUpPage setPage={go} onLogin={handleLogin} />}
        {page==="verify-email" && !loggedIn && <VerifyEmailPage setPage={go} onLogin={handleLogin} />}
        {page==="forgot-password" && !loggedIn && <ForgotPasswordPage setPage={go} />}
        {page==="reset-password" && <ResetPasswordPage setPage={go} onComplete={handleLogout} />}
        {page==="oauth-callback" && <OAuthCallbackPage setPage={go} onLogin={handleLogin} />}
        {loggedIn && messagesKeepAlive && (
          <div
            style={page === "messages" ? undefined : { display: "none" }}
            aria-hidden={page !== "messages"}
          >
            <MessagesPage
              settings={settings}
              showEmailToast={showEmailToast}
              showPushNotif={showPushNotif}
              contacts={contacts}
              setContacts={setContacts}
              onUnreadChange={setMsgUnread}
              onConversationsRefresh={refreshConversations}
              currentUserId={user?.id ?? 0}
              currentUser={user}
              onUserUpdate={setUser}
              initialConversationId={selectedConversationId}
              dmRequestsIntent={dmRequestsIntent}
              onDmRequestsIntentHandled={clearDmRequestsIntent}
              focusInput={focusMessageInput}
              onFocusHandled={clearFocusMessageInput}
              onInitialConversationHandled={clearSelectedConversation}
              isActive={page === "messages"}
            />
          </div>
        )}
        {page==="profile"   && loggedIn && <ProfilePage setPage={go} isDark={isDark} setIsDark={toggleTheme} settings={settings} setSettings={setSettings} user={user} setUser={setUser} userAvatar={userAvatar} setUserAvatar={setUserAvatar} onLogout={handleLogout} />}
        {page==="admin"     && loggedIn && user?.isAdmin && <AdminPage setPage={go} />}
        {page==="terms"     && <TermsOfServicePage setPage={go} />}
        {page==="privacy"   && <PrivacyPolicyPage setPage={go} />}
        {page==="help"      && <HelpCenterPage />}
        {page==="bugs"      && <BugReportsPage setPage={go} />}
        {page==="status"    && <ServerStatusPage />}
        {page==="patches"   && <PatchNotesPage />}
      {!noFoot.includes(page) && <Footer setPage={go} onGoToDownload={goToDownload} />}
        </>
      )}
    </div>
    </CallProvider>
    </ThemeCtx.Provider>
  );
}
