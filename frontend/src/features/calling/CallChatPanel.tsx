import { useEffect, useRef, useState } from "react";
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
 * Lightweight in-call chat bound to the existing DM conversation.
 * Starts empty (no history fetch); only messages sent/received during this call session.
 */
export function CallChatPanel({
  conversationId,
  active,
}: {
  conversationId: number;
  active: boolean;
}) {
  const C = useC();
  const [lines, setLines] = useState<CallChatLine[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const seenIds = useRef(new Set<number>());
  const sessionStartedRef = useRef(false);

  // Reset when a call session becomes active — never load prior DM history.
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
        // Text-only panel: skip media-only rows without caption
        if (message.mediaType && message.mediaType !== "gif" && !message.msg.trim()) return;
        if (seenIds.current.has(Number(message.id))) return;
        seenIds.current.add(Number(message.id));
        setLines(prev => [
          ...prev,
          {
            id: Number(message.id),
            userId: Number(message.userId),
            user: message.self ? "You" : (message.user || "User"),
            msg: message.msg,
            self: !!message.self,
            time: message.time || "",
          },
        ]);
      },
    );
    return unsub;
  }, [active, conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines.length]);

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
    <div
      className="flex flex-col min-h-0 border-t"
      style={{ borderColor: "#49454F", background: "#211F26", maxHeight: "40vh" }}
      role="region"
      aria-label="Call chat"
    >
      <div className="px-3 py-2 flex items-center justify-between shrink-0">
        <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.65)", fontFamily: "Roboto" }}>
          Call Chat
        </p>
        <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.4)", fontFamily: "Roboto" }}>
          Saved to conversation
        </p>
      </div>
      <div className="flex-1 min-h-[6rem] overflow-y-auto px-3 pb-2 space-y-2">
        {lines.length === 0 && (
          <p className="text-xs text-center py-4" style={{ color: "rgba(255,255,255,0.4)", fontFamily: "Roboto" }}>
            Messages sent here appear in this DM after the call.
          </p>
        )}
        {lines.map(line => (
          <div
            key={line.id}
            className={`flex flex-col ${line.self ? "items-end" : "items-start"}`}
          >
            <span className="text-[10px] mb-0.5" style={{ color: "rgba(255,255,255,0.45)", fontFamily: "Roboto" }}>
              {line.user}{line.time ? ` · ${line.time}` : ""}
            </span>
            <div
              className="max-w-[85%] px-3 py-1.5 rounded-2xl text-sm break-words"
              style={{
                background: line.self ? C.primary : "rgba(255,255,255,0.08)",
                color: line.self ? "#fff" : "rgba(255,255,255,0.9)",
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
        className="flex items-center gap-2 px-3 py-2 border-t shrink-0"
        style={{ borderColor: "#49454F" }}
        onSubmit={e => { e.preventDefault(); void send(); }}
      >
        <input
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Type a message…"
          aria-label="Call chat message"
          maxLength={4000}
          className="flex-1 min-w-0 rounded-xl px-3 py-2 text-sm border focus:outline-none focus-visible:ring-2"
          style={{
            background: "#1C1B1F",
            color: "#E6E1E5",
            borderColor: "#938F99",
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
    </div>
  );
}
