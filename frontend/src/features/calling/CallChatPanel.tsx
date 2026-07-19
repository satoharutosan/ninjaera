import { useEffect, useRef, useState } from "react";
import CloseIcon from "@mui/icons-material/Close";
import SendIcon from "@mui/icons-material/Send";
import { api, type ApiMessage } from "@/app/api";
import { onRealtimeEvent } from "@/app/realtime";
import { useC } from "@/app/shared";

type CallChatLine = {
  id: number;
  userId: number;
  user: string;
  msg: string;
  self: boolean;
  time: string;
};

/**
 * In-call chat bound to the existing DM conversation.
 * Starts empty (no history fetch); only messages from this call session.
 */
export function CallChatPanel({
  conversationId,
  active,
  open,
  onClose,
  onUnread,
}: {
  conversationId: number;
  active: boolean;
  open: boolean;
  onClose: () => void;
  /** Fired when a non-self message arrives while the sidebar is closed. */
  onUnread?: (delta: number) => void;
}) {
  const C = useC();
  const [lines, setLines] = useState<CallChatLine[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const seenIds = useRef(new Set<number>());
  const sessionStartedRef = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    if (!active || !conversationId) return;
    setLines([]);
    seenIds.current = new Set();
    sessionStartedRef.current = true;
    return () => {
      sessionStartedRef.current = false;
      setLines([]);
      seenIds.current = new Set();
    };
  }, [active, conversationId]);

  useEffect(() => {
    if (!active || !conversationId) return;
    const unsub = onRealtimeEvent<{ conversationId: number; message: ApiMessage }>(
      "message:new",
      ({ conversationId: cid, message }) => {
        if (!sessionStartedRef.current) return;
        if (Number(cid) !== Number(conversationId)) return;
        if (!message?.id || !message.msg) return;
        if (message.mediaType === "call_event") return;
        if (message.mediaType && message.mediaType !== "gif" && !message.msg.trim()) return;
        const id = Number(message.id);
        if (seenIds.current.has(id)) return;
        seenIds.current.add(id);
        const self = !!message.self;
        setLines(prev => [
          ...prev,
          {
            id,
            userId: Number(message.userId),
            user: self ? "You" : (message.user || "User"),
            msg: message.msg,
            self,
            time: message.time || "",
          },
        ]);
        if (!self && !openRef.current) {
          onUnread?.(1);
        }
      },
    );
    return unsub;
  }, [active, conversationId, onUnread]);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines.length, open]);

  // Outside click closes sidebar (no backdrop dimming).
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent | TouchEvent) => {
      const el = panelRef.current;
      const target = e.target as Node | null;
      if (!el || !target) return;
      if (el.contains(target)) return;
      // Ignore clicks on the chat toggle button (marked via data attribute).
      const t = target instanceof Element ? target : target.parentElement;
      if (t?.closest?.("[data-call-chat-toggle]")) return;
      onClose();
    };
    // Defer so the opening click does not immediately close.
    const timer = window.setTimeout(() => {
      document.addEventListener("mousedown", onPointer);
      document.addEventListener("touchstart", onPointer);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
    };
  }, [open, onClose]);

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending || !conversationId) return;
    setSending(true);
    setText("");
    try {
      const { message } = await api.messages.send(conversationId, trimmed);
      if (message?.id && !seenIds.current.has(Number(message.id))) {
        seenIds.current.add(Number(message.id));
        setLines(prev => [
          ...prev,
          {
            id: Number(message.id),
            userId: Number(message.userId),
            user: "You",
            msg: message.msg,
            self: true,
            time: message.time || "",
          },
        ]);
      }
    } catch {
      setText(trimmed);
    } finally {
      setSending(false);
    }
  };

  if (!active || !conversationId) return null;

  return (
    <aside
      ref={panelRef}
      className="absolute top-0 right-0 bottom-0 z-[90] flex flex-col shadow-2xl border-l"
      style={{
        width: "min(360px, 92vw)",
        background: C.surface,
        borderColor: C.outlineVar,
        transform: open ? "translateX(0)" : "translateX(100%)",
        transition: "transform 220ms cubic-bezier(0.2, 0, 0, 1)",
        pointerEvents: open ? "auto" : "none",
      }}
      role="complementary"
      aria-label="Call chat"
      aria-hidden={!open}
    >
      <div
        className="flex items-center justify-between px-4 py-3 border-b shrink-0"
        style={{ borderColor: C.outlineVar }}
      >
        <div>
          <p className="text-sm font-medium" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
            Call Chat
          </p>
          <p className="text-[11px]" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
            Saved to this conversation
          </p>
        </div>
        <button
          type="button"
          aria-label="Close chat"
          onClick={onClose}
          className="w-9 h-9 rounded-full flex items-center justify-center transition-opacity hover:opacity-80"
          style={{ color: C.onSurfaceVar }}
        >
          <CloseIcon style={{ fontSize: 20 }} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2">
        {lines.length === 0 && (
          <p className="text-xs text-center py-8 px-4" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
            No messages yet. Chat during the call appears here and in your DM history afterward.
          </p>
        )}
        {lines.map(line => (
          <div
            key={line.id}
            className={`flex flex-col ${line.self ? "items-end" : "items-start"}`}
          >
            <span className="text-[10px] mb-0.5" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              {line.user}{line.time ? ` · ${line.time}` : ""}
            </span>
            <div
              className="max-w-[90%] px-3 py-1.5 rounded-2xl text-sm break-words"
              style={{
                background: line.self ? C.primary : C.surfaceVar,
                color: line.self ? C.onPrimary : C.onSurface,
                fontFamily: "Roboto",
              }}
            >
              {line.msg}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form
        className="flex items-center gap-2 px-3 py-3 border-t shrink-0"
        style={{ borderColor: C.outlineVar }}
        onSubmit={e => { e.preventDefault(); void send(); }}
      >
        <input
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Message…"
          aria-label="Call chat message"
          maxLength={4000}
          className="flex-1 min-w-0 rounded-xl px-3 py-2 text-sm border focus:outline-none focus-visible:ring-2"
          style={{
            background: C.bg,
            color: C.onSurface,
            borderColor: C.outlineVar,
            fontFamily: "Roboto",
          }}
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          aria-label="Send message"
          className="w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0 disabled:opacity-40 hover:opacity-90 transition-opacity"
          style={{ background: C.primary }}
        >
          <SendIcon style={{ fontSize: 18 }} />
        </button>
      </form>
    </aside>
  );
}
