import { useState, useEffect } from "react";
import { ImageWithFallback } from "@/app/components/figma/ImageWithFallback";
import NotificationsIcon from "@mui/icons-material/Notifications";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import imgMoonlight from "@/imports/4f5edfe0-4198-4699-9e91-557039c6bad6.webp";
import { Page, useC, SH1, FilledBtn, OutlinedBtn } from "@/app/shared";
import { api, type ApiNotification } from "@/app/api";
import { onRealtimeEvent } from "@/app/realtime";
import { toast } from "sonner";

function AlarmsPage({ setPage, onConversationsRefresh, onNotificationsRefresh }: { setPage?: (p: Page) => void; onConversationsRefresh?: () => void; onNotificationsRefresh?: () => void }) {
  const C = useC();
  const [notifs, setNotifs] = useState<ApiNotification[]>([]);

  const [acceptingId, setAcceptingId] = useState<number | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);

  const load = () => {
    api.notifications.list().then(r => setNotifs(r.notifications)).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const unsubs = [
      onRealtimeEvent("notification:new", () => { load(); onNotificationsRefresh?.(); }),
      onRealtimeEvent("counts:update", () => { load(); onNotificationsRefresh?.(); }),
      onRealtimeEvent("dm_request:accepted", () => { load(); onNotificationsRefresh?.(); onConversationsRefresh?.(); }),
      onRealtimeEvent("dm_request:resolved", () => { load(); onNotificationsRefresh?.(); }),
    ];
    return () => { unsubs.forEach(u => u()); };
  }, [onNotificationsRefresh, onConversationsRefresh]);

  const markAllRead = async () => {
    try {
      await api.notifications.markAllRead();
      setNotifs(ns => ns.map(n => ({ ...n, read: true })));
    } catch {
      setNotifs(ns => ns.map(n => ({ ...n, read: true })));
    }
  };

  const markRead = async (id: number) => {
    try { await api.notifications.markRead(id); } catch { /* ignore */ }
    setNotifs(ns => ns.map(x => x.id === id ? { ...x, read: true } : x));
  };

  const handleAcceptDm = async (n: ApiNotification) => {
    if (acceptingId != null) return;
    setAcceptingId(n.id);
    setNotifs(ns => ns.map(x => x.id === n.id ? { ...x, read: true, metadata: { ...x.metadata, processed: true } } : x));
    try {
      const result = await api.notifications.acceptDm(n.id);
      toast.success(result.alreadyExists ? "Conversation already open" : "Direct message request accepted");
      onConversationsRefresh?.();
      onNotificationsRefresh?.();
      if (setPage && result.conversationId) setPage("messages");
    } catch (err) {
      setNotifs(ns => ns.map(x => x.id === n.id ? { ...x, metadata: { ...x.metadata, processed: false } } : x));
      load();
      toast.error(err instanceof Error ? err.message : "Could not accept request");
    } finally {
      setAcceptingId(null);
    }
  };

  const handleRejectDm = async (n: ApiNotification) => {
    if (rejectingId != null) return;
    setRejectingId(n.id);
    setNotifs(ns => ns.map(x => x.id === n.id ? { ...x, read: true, metadata: { ...x.metadata, processed: true } } : x));
    try {
      await api.notifications.rejectDm(n.id);
      toast.success("Request declined");
      onNotificationsRefresh?.();
    } catch (err) {
      setNotifs(ns => ns.map(x => x.id === n.id ? { ...x, metadata: { ...x.metadata, processed: false } } : x));
      load();
      toast.error(err instanceof Error ? err.message : "Could not decline request");
    } finally {
      setRejectingId(null);
    }
  };

  return (
    <div style={{ background: C.bg }} className="min-h-screen">
      <div data-nav-hero className="relative h-[35vh] min-h-[200px] overflow-hidden">
        <ImageWithFallback src={imgMoonlight} alt="Alarms" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/60" />
        <div className="absolute inset-0 flex items-center justify-center pt-16">
          <h1 className="text-5xl md:text-6xl font-light text-white" style={{ fontFamily: "'Trade Winds', cursive" }}>Notifications</h1>
        </div>
      </div>
      <div className="max-w-3xl mx-auto px-6 py-14">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-xl font-light" style={{ color: C.onSurface, fontFamily: "'Trade Winds', cursive" }}>From the <span className="font-medium">Operations Team</span></h2>
          <button onClick={markAllRead} className="text-xs font-medium px-3 py-1.5 rounded-full border transition-colors hover:bg-black/5" style={{ borderColor: C.outline, color: C.primary, fontFamily: "Roboto" }}>Mark all read</button>
        </div>
        <div className="space-y-4">
          {notifs.map(n => (
            <div key={n.id} className="rounded-2xl p-5 transition-all" style={{ background: C.surface, boxShadow: SH1, borderLeft: `4px solid ${n.read ? C.outlineVar : C.primary}` }}
              onClick={() => n.notifType !== "dm_request" && markRead(n.id)}>
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: n.read ? C.surfaceVar : C.primaryCont }}>
                  <NotificationsIcon style={{ fontSize: 20, color: n.read ? C.onSurfaceVar : C.primary }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-medium text-sm" style={{ color: n.read ? C.onSurfaceVar : C.onSurface, fontFamily: "Roboto" }}>{n.title}</h3>
                    {!n.read && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: C.primary }} />}
                    {n.pinned && <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: C.primaryCont, color: C.primary }}>Pinned</span>}
                  </div>
                  <p className="text-sm leading-relaxed" style={{ color: n.read ? C.onSurfaceVar : C.onSurface, fontFamily: "Roboto", opacity: n.read ? 0.7 : 1 }}>{n.body}</p>
                  {n.notifType === "dm_request" && !n.metadata?.processed && (
                    <div className="flex gap-2 mt-3" onClick={e => e.stopPropagation()}>
                      <FilledBtn
                        disabled={acceptingId === n.id || rejectingId === n.id}
                        onClick={() => void handleAcceptDm(n)}
                      >
                        <CheckIcon style={{ fontSize: 14 }} /> {acceptingId === n.id ? "Accepting…" : "Accept"}
                      </FilledBtn>
                      <OutlinedBtn
                        disabled={acceptingId === n.id || rejectingId === n.id}
                        onClick={() => void handleRejectDm(n)}
                      >
                        <CloseIcon style={{ fontSize: 14 }} /> {rejectingId === n.id ? "Declining…" : "Reject"}
                      </OutlinedBtn>
                    </div>
                  )}
                  <p className="text-[11px] mt-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto Mono,monospace" }}>{n.time} · Ninja Era Operations</p>
                </div>
              </div>
            </div>
          ))}
        </div>
        {notifs.length === 0 && (
          <div className="text-center py-20">
            <NotificationsIcon style={{ fontSize: 48, color: C.onSurfaceVar, opacity: 0.3 }} />
            <p className="mt-4 text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>No notifications</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default AlarmsPage;
