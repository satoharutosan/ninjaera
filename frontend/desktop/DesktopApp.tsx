import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import {
  Contact,
  ThemeCtx,
  MSGS_DATA_INIT,
  type AppSettings,
} from "@/app/shared";
import { applyDesktopAccentCssVars, buildDesktopTheme } from "./accentTheme";
import {
  connectRealtime,
  disconnectRealtime,
  onRealtimeEvent,
  onRealtimeReconnect,
  onRealtimeStatus,
  nudgeRealtimeOnOnline,
  joinConversation,
  type RealtimeStatus,
} from "@/app/realtime";
import { messageCache } from "@/features/messages/messageCache";
import { toChatMsg } from "@/features/messages/types";
import {
  clearActiveConversation,
  clearAllConversationDrafts,
  getActiveConversation,
} from "@/features/messages/activeConversationStore";
import { getCachedUser, setCachedUser, clearAuthStorage, getStoredToken } from "@/shared/authStorage";
import { api, setToken, ApiError, type ApiUser, type ApiNotification, type ApiMessage } from "@/app/api";
import { CallProvider, useCallOptional } from "@/features/calling/CallProvider";
import { CallOverlays } from "@/features/calling/CallOverlays";
import MessagesPage from "@/features/messages/MessagesPage";
import { BrandLogo } from "@/shared/BrandLogo";
import { getNinja, type NinjaNavIntent } from "@/shared/electronBridge";
import type { DesktopSettings } from "../electron/shared/settings";
import { defaultSettings } from "../electron/shared/settings";
import { TitleBar } from "./shell/TitleBar";
import { LoginScreen } from "./shell/LoginScreen";
import { SettingsDialog } from "./shell/SettingsDialog";

const ninja = getNinja();

/** Report call/transfer busy state so silent updates delay restart safely. */
function UpdaterBusyReporter() {
  const call = useCallOptional();
  useEffect(() => {
    if (!ninja?.updater?.setBusy) return;
    const inCall = !!call && call.phase !== "idle" && call.phase !== "ignored";
    const screenSharing = !!call?.screenSharing;
    ninja.updater.setBusy({ inCall, screenSharing });
  }, [call?.phase, call?.screenSharing]);
  return null;
}

/** Human-readable preview for a notification body. */
function previewText(m: ApiMessage): string {
  if (m.msg && m.msg.trim()) return m.msg;
  switch (m.mediaType) {
    case "image":
      return "📷 Photo";
    case "video":
      return "🎬 Video";
    case "gif":
      return "GIF";
    case "voice":
    case "audio":
      return "🎤 Voice message";
    case "file":
      return `📎 ${m.fileName || "File"}`;
    default:
      return m.fileName ? `📎 ${m.fileName}` : "New message";
  }
}

export default function DesktopApp() {
  // ── Settings ──
  const [settings, setSettings] = useState<DesktopSettings>(() => defaultSettings(""));
  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)").matches : false,
  );
  const [signupUrl, setSignupUrl] = useState("");

  useEffect(() => {
    ninja?.settings.getAll().then((s) => setSettings(s as DesktopSettings)).catch(() => {});
    ninja?.app.info().then((info) => setSignupUrl(info.signupUrl)).catch(() => {});
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener("change", onChange);
    const off = ninja?.settings.onChanged((s) => setSettings(s as DesktopSettings));
    return () => {
      mq.removeEventListener("change", onChange);
      off?.();
    };
  }, []);

  const patchSettings = useCallback((patch: Record<string, unknown>) => {
    if (!ninja) {
      setSettings((prev) => ({ ...prev, ...(patch as object) } as DesktopSettings));
      return;
    }
    ninja.settings
      .set(patch as Partial<DesktopSettings>)
      .then((s) => setSettings(s as DesktopSettings))
      .catch(() => toast.error("Could not save that setting. Please try again."));
  }, []);

  const resetSettings = useCallback(() => {
    ninja?.settings
      .reset()
      .then((s) => {
        setSettings(s as DesktopSettings);
        toast.success("Settings reset to defaults.");
      })
      .catch(() => toast.error("Could not reset settings."));
  }, []);

  const isDark =
    settings.general.theme === "system" ? systemDark : settings.general.theme === "dark";

  const accentColor = settings.general.accentColor || "#6750A4";
  const theme = useMemo(() => buildDesktopTheme(isDark, accentColor), [isDark, accentColor]);

  // Apply theme + accent CSS vars + font scaling + compact to the document.
  // CSS zoom shrinks the layout box — compensate width/height so the client area stays filled.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", isDark);
    root.classList.toggle("ninja-compact", settings.general.compactMode);
    root.lang = settings.general.language || "en";
    localStorage.setItem("ninja-era-theme", isDark ? "dark" : "light");
    applyDesktopAccentCssVars(theme);

    const scale = settings.general.fontScale || 1;
    const zoomStyle = root.style as CSSStyleDeclaration & { zoom?: string };
    zoomStyle.zoom = String(scale);
    if (scale !== 1) {
      const pct = `${(100 / scale).toFixed(4)}%`;
      root.style.width = pct;
      root.style.height = pct;
    } else {
      root.style.width = "";
      root.style.height = "";
    }
    document.body.style.background = theme.bg;
  }, [isDark, settings.general.compactMode, settings.general.fontScale, settings.general.language, theme]);

  // ── Auth ──
  const [user, setUser] = useState<ApiUser | null>(() => (getStoredToken() ? getCachedUser() : null));
  const [authReady, setAuthReady] = useState(() => {
    const token = getStoredToken();
    if (!token) return true;
    return !!getCachedUser();
  });
  const loggedIn = !!user;

  // ── Messaging state ──
  const [contacts, setContacts] = useState<Contact[]>(MSGS_DATA_INIT);
  const [msgUnread, setMsgUnread] = useState(0);
  const [dmRequestCount, setDmRequestCount] = useState(0);
  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(null);
  const [dmRequestsIntent, setDmRequestsIntent] = useState<{ requestId?: number; nonce: number } | null>(null);
  const dmRequestsNonce = useRef(0);
  const [focusMessageInput, setFocusMessageInput] = useState(false);
  const [, setNotifs] = useState<ApiNotification[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<RealtimeStatus>("connected");
  const [realtimeEpoch, setRealtimeEpoch] = useState(0);
  const convRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const clearSelectedConversation = useCallback(() => setSelectedConversationId(null), []);
  const clearFocusMessageInput = useCallback(() => setFocusMessageInput(false), []);
  const clearDmRequestsIntent = useCallback(() => setDmRequestsIntent(null), []);
  const openDmRequests = useCallback((requestId?: number) => {
    dmRequestsNonce.current += 1;
    setDmRequestsIntent({ requestId, nonce: dmRequestsNonce.current });
  }, []);

  const handleLogin = useCallback((u: ApiUser) => {
    setUser(u);
    setCachedUser(u);
    setAuthReady(true);
    connectRealtime();
  }, []);

  useEffect(() => {
    if (user) setCachedUser(user);
  }, [user]);

  const handleLogout = useCallback(() => {
    const uid = user?.id;
    api.auth.logout().catch(() => {});
    clearAuthStorage();
    setToken(null);
    void import("@/features/calling/iceConfig").then((m) => m.clearIceServerCache());
    setUser(null);
    setContacts(MSGS_DATA_INIT);
    setMsgUnread(0);
    setDmRequestCount(0);
    setSelectedConversationId(null);
    setSettingsOpen(false);
    if (uid) {
      clearActiveConversation(uid);
      clearAllConversationDrafts(uid);
    }
    setAuthReady(true);
    messageCache.clear();
    disconnectRealtime();
  }, [user?.id]);

  // Session restore + validation on launch.
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
      } catch (e) {
        if (cancelled) return;
        const status = e instanceof ApiError ? e.status : 0;
        // Only a server-rejected token clears the session (never network/5xx).
        if (status === 401 || status === 403) {
          clearAuthStorage();
          setToken(null);
          setUser(null);
        }
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshConversations = useCallback(() => {
    if (!loggedIn) return;
    if (convRefreshTimer.current) clearTimeout(convRefreshTimer.current);
    convRefreshTimer.current = setTimeout(() => {
      convRefreshTimer.current = null;
      api.messages
        .conversations()
        .then((r) => {
          setContacts(r.conversations as Contact[]);
          setMsgUnread(r.conversations.filter((c) => c.type === "dm").reduce((s, c) => s + c.unread, 0));
        })
        .catch(() => {});
    }, 400);
  }, [loggedIn]);

  const refreshMessageBadge = useCallback(() => {
    if (!loggedIn) return;
    api.messages
      .badgeCount()
      .then((r) => {
        setMsgUnread(r.unreadMessages);
        setDmRequestCount(r.pendingDMRequests);
      })
      .catch(() => {});
  }, [loggedIn]);

  // Must be declared after refreshConversations / refreshMessageBadge (TDZ).
  // Runs the existing DM-request workflow from a native notification action button.
  const runDmRequestAction = useCallback(
    async (requestId: number, action: "accept" | "reject") => {
      try {
        if (action === "accept") {
          const result = await api.dm.accept(requestId);
          joinConversation(result.conversationId);
          refreshConversations();
          refreshMessageBadge();
          setSelectedConversationId(result.conversationId);
          toast.success(result.alreadyExists ? "Conversation already open" : "Request accepted");
        } else {
          await api.dm.reject(requestId);
          refreshMessageBadge();
          refreshConversations();
          toast.success("Request declined");
        }
      } catch (err) {
        // Obsolete/failed request: surface a friendly message, open the panel so the
        // user can see current state, and never throw into the console.
        const msg = err instanceof ApiError ? err.message : "This request is no longer available";
        toast.error(msg);
        openDmRequests(requestId);
      }
    },
    [openDmRequests, refreshConversations, refreshMessageBadge],
  );

  const refreshNotifications = useCallback(() => {
    api.notifications.list().then((r) => setNotifs(r.notifications)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!loggedIn) return;
    refreshConversations();
    refreshMessageBadge();
    refreshNotifications();
  }, [loggedIn, refreshConversations, refreshMessageBadge, refreshNotifications]);

  // Native notification dispatcher.
  const maybeNotify = useCallback(
    (conversationId: number, message: ApiMessage) => {
      if (!ninja || !user) return;
      if (message.self || message.userId === user.id) return;
      const active = getActiveConversation(user.id)?.conversationId === conversationId;
      if (active && document.hasFocus()) return;

      const contact = contacts.find((c) => c.id === conversationId);
      // Per-conversation mute suppresses every notification from that conversation.
      if (contact?.muted) return;
      const isChannel = contact?.type === "channel";
      const username = message.user || contact?.name || "New message";
      const body = previewText(message);
      const mentioned =
        !!user.username &&
        typeof message.msg === "string" &&
        message.msg.toLowerCase().includes(`@${user.username.toLowerCase()}`);

      ninja.notify({
        title: isChannel && contact ? `${username} • ${contact.name}` : username,
        body,
        iconUrl: message.avatarUrl ?? contact?.avatarUrl ?? null,
        conversationId,
        kind: mentioned ? "mention" : isChannel ? "channel" : "dm",
        conversationType: isChannel ? "channel" : "dm",
        senderId: message.userId,
        messageId: message.id,
        navTarget: "conversation",
        timestamp: Date.now(),
      });
    },
    [contacts, user],
  );

  // Realtime subscriptions (mirrors the web app, trimmed to messaging).
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
      onRealtimeEvent<{ conversationId: number }>("conversation:new", ({ conversationId }) => {
        joinConversation(conversationId);
        refreshConversations();
        refreshMessageBadge();
      }),
      onRealtimeEvent<{ conversationId: number; message: ApiMessage }>("message:new", ({ conversationId, message }) => {
        if (!user?.id || !conversationId || !message?.id) return;
        messageCache.upsertMessage(conversationId, toChatMsg(message, user.id));
        maybeNotify(conversationId, message);
      }),
      onRealtimeEvent<{ conversationId: number; message: ApiMessage }>("message:updated", ({ conversationId, message }) => {
        if (!user?.id || !conversationId || !message?.id) return;
        messageCache.upsertMessage(conversationId, toChatMsg(message, user.id));
      }),
      onRealtimeEvent<{ conversationId: number; messageId: number }>("message:deleted", ({ conversationId, messageId }) => {
        if (!conversationId || !messageId) return;
        messageCache.removeMessage(conversationId, messageId);
      }),
      onRealtimeEvent("dm_request:new", () => {
        refreshMessageBadge();
        // Resolve the concrete request so the notification carries a requestId
        // for native Accept/Reject actions and reliable deep-linking.
        api.dm
          .listRequests()
          .then((r) => {
            const newest = r.incoming[0];
            ninja?.notify({
              title: "New message request",
              body: newest
                ? `${newest.requesterDisplayName || newest.requesterName} wants to message you`
                : "You have a new direct message request.",
              iconUrl: newest?.requesterAvatar ?? null,
              kind: "dm-request",
              navTarget: "dm-requests",
              requestId: newest?.id,
              senderId: newest?.requesterId,
              timestamp: Date.now(),
            });
          })
          .catch(() => {
            ninja?.notify({
              title: "New message request",
              body: "You have a new direct message request.",
              kind: "dm-request",
              navTarget: "dm-requests",
              timestamp: Date.now(),
            });
          });
      }),
      onRealtimeEvent("dm_request:resolved", () => refreshMessageBadge()),
      onRealtimeEvent<{ conversationId: number }>("dm_request:accepted", ({ conversationId }) => {
        joinConversation(conversationId);
        refreshMessageBadge();
        refreshConversations();
        refreshNotifications();
      }),
      onRealtimeEvent<{ userId: number; status: string; online: boolean }>("presence:update", ({ userId, status, online }) => {
        setContacts((prev) => {
          let changed = false;
          const next = prev.map((c) => {
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
        if (user?.id === data.userId) {
          setUser((prev) =>
            prev
              ? {
                  ...prev,
                  username: data.username,
                  avatarUrl: data.avatarUrl !== undefined ? data.avatarUrl : prev.avatarUrl,
                }
              : prev,
          );
        }
        setContacts((prev) => {
          let changed = false;
          const next = prev.map((c) => {
            if (c.type !== "dm" || c.otherUserId !== data.userId) return c;
            changed = true;
            return { ...c, name: data.username, avatarUrl: data.avatarUrl !== undefined ? data.avatarUrl : c.avatarUrl };
          });
          return changed ? next : prev;
        });
        messageCache.patchUserIdentity(data.userId, { username: data.username, avatarUrl: data.avatarUrl }, user?.id);
      }),
      onRealtimeEvent<{ callId?: string; fromName?: string; from?: { username?: string }; conversationId?: number }>(
        "call:incoming",
        (data) => {
          const caller = data?.fromName || data?.from?.username || "Someone";
          ninja?.notify({
            title: "Incoming call",
            body: `${caller} is calling…`,
            kind: "call",
            conversationId: data?.conversationId,
          });
        },
      ),
    ];
    return () => {
      unsubs.forEach((u) => u());
      if (convRefreshTimer.current) clearTimeout(convRefreshTimer.current);
    };
  }, [loggedIn, user?.id, refreshConversations, refreshNotifications, refreshMessageBadge, maybeNotify]);

  // Presence heartbeat.
  useEffect(() => {
    if (!loggedIn) return;
    const ping = () => api.users.pingPresence().catch(() => {});
    ping();
    const id = setInterval(ping, 60000);
    return () => clearInterval(id);
  }, [loggedIn]);

  // Connection status banner + automatic recovery sync.
  useEffect(() => {
    if (!loggedIn) {
      setConnectionStatus("connected");
      return;
    }
    return onRealtimeStatus((s) => {
      setConnectionStatus(s);
      if (import.meta.env.DEV) console.info("[REALTIME] status", s);
    });
  }, [loggedIn]);

  useEffect(() => {
    if (!loggedIn) return;
    return onRealtimeReconnect(() => {
      if (import.meta.env.DEV) console.info("[RECONNECT] syncing desktop session");
      // Verify session without forcing logout on transient failures.
      api.auth
        .me()
        .then(({ user: me }) => {
          setUser(me);
          setCachedUser(me);
        })
        .catch((e) => {
          const status = e instanceof ApiError ? e.status : 0;
          if (status === 401 || status === 403) handleLogout();
        });
      refreshConversations();
      refreshMessageBadge();
      refreshNotifications();
      api.users.pingPresence().catch(() => {});
      setRealtimeEpoch((n) => n + 1);
    });
  }, [
    loggedIn,
    handleLogout,
    refreshConversations,
    refreshMessageBadge,
    refreshNotifications,
  ]);

  // Auth rejected by the socket layer (expired/revoked JWT) — only then force login.
  useEffect(() => {
    if (!ninja) return;
    return ninja.socket.onAuthInvalid?.(() => {
      if (import.meta.env.DEV) console.info("[AUTH] socket auth invalid — signing out");
      handleLogout();
    });
  }, [handleLogout]);

  // Network / wake / tray restore nudges — single socket, continuous retry.
  useEffect(() => {
    if (!loggedIn) return;
    const onOnline = () => nudgeRealtimeOnOnline();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        nudgeRealtimeOnOnline();
        refreshConversations();
        refreshMessageBadge();
      }
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loggedIn, refreshConversations, refreshMessageBadge]);

  // Tray / notification navigation intents.
  useEffect(() => {
    if (!ninja) return;
    return ninja.nav.onIntent((intent: NinjaNavIntent) => {
      if (intent.type === "open-settings") setSettingsOpen(true);
      else if (intent.type === "logout") handleLogout();
      else if (intent.type === "check-updates") ninja.updater.check();
      else if (intent.type === "open-conversation") {
        setSettingsOpen(false);
        setSelectedConversationId(intent.conversationId);
        setFocusMessageInput(true);
      } else if (intent.type === "open-dm-requests") {
        setSettingsOpen(false);
        openDmRequests(intent.requestId);
      } else if (intent.type === "dm-request-action") {
        void runDmRequestAction(intent.requestId, intent.action);
      }
    });
  }, [handleLogout, openDmRequests, runDmRequestAction]);

  const messagesSettings: AppSettings = {
    emailNotif: true,
    pushNotif: settings.notifications.enabled,
    twoFA: false,
    publicProfile: settings.privacy.onlineStatusVisible,
  };

  const noopToast = useCallback(() => {}, []);
  const noopPush = useCallback(() => {}, []);

  const titleBar = (
    <TitleBar
      isDark={isDark}
      onToggleTheme={() => patchSettings({ general: { theme: isDark ? "light" : "dark" } })}
      onOpenSettings={() => setSettingsOpen(true)}
    />
  );

  return (
    <ThemeCtx.Provider value={theme}>
      <CallProvider>
        <UpdaterBusyReporter />
        <Toaster
          position="top-right"
          richColors
          offset="calc(var(--ninja-titlebar-h, 44px) + 0.75rem)"
          mobileOffset="calc(var(--ninja-titlebar-h, 44px) + 0.5rem)"
        />
        <div className="ninja-desktop-root" style={{ background: theme.bg }}>
          {titleBar}
          {!authReady ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 min-h-0">
              <BrandLogo size={48} priority />
              <div
                className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin"
                style={{ borderColor: theme.primary, borderTopColor: "transparent" }}
              />
              <p className="text-sm" style={{ color: theme.onSurfaceVar, fontFamily: "Roboto" }}>
                Restoring session…
              </p>
            </div>
          ) : !loggedIn ? (
            <LoginScreen onLogin={handleLogin} signupUrl={signupUrl} />
          ) : (
            <div className="ninja-desktop-body">
              {connectionStatus !== "connected" && (
                <div
                  className="ninja-connection-banner"
                  role="status"
                  aria-live="polite"
                  style={{
                    background:
                      connectionStatus === "disconnected"
                        ? "color-mix(in srgb, #B3261E 18%, transparent)"
                        : "color-mix(in srgb, var(--ninja-accent, #6750A4) 16%, transparent)",
                    color: theme.onSurface,
                    borderBottom: `1px solid ${theme.outlineVar}`,
                  }}
                >
                  {connectionStatus === "disconnected"
                    ? "Offline — reconnecting when the network is back…"
                    : connectionStatus === "reconnecting"
                      ? "Reconnecting…"
                      : "Connecting…"}
                </div>
              )}
              <div className="ninja-desktop-messages ninja-scroll">
                <MessagesPage
                  settings={messagesSettings}
                  showEmailToast={noopToast}
                  showPushNotif={noopPush}
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
                  isActive={!settingsOpen}
                  desktopMode
                  onDesktopOpenSettings={() => setSettingsOpen(true)}
                  onDesktopLogout={handleLogout}
                  realtimeEpoch={realtimeEpoch}
                />
              </div>
            </div>
          )}
        </div>
        {/* Overlays after title bar in DOM, but CSS keeps title bar above via z-index + top offset */}
        <CallOverlays />
        {settingsOpen && (
          <SettingsDialog
            settings={settings}
            onPatch={patchSettings}
            onReset={resetSettings}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </CallProvider>
    </ThemeCtx.Provider>
  );
}
