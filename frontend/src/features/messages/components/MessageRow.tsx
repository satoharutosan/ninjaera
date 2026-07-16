import { useState, memo } from "react";
import ReplyIcon from "@mui/icons-material/Reply";
import EditIcon from "@mui/icons-material/Edit";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import DeleteIcon from "@mui/icons-material/Delete";
import FlagIcon from "@mui/icons-material/Flag";
import CallIcon from "@mui/icons-material/Call";
import { ColorTheme, ChatAvatar } from "@/app/shared";
import { QUICK_REACTIONS } from "../constants";
import type { ChatMsg } from "../types";
import { MediaBubble } from "./MediaBubble";

type MessageRowProps = {
  m: ChatMsg;
  prev?: ChatMsg;
  lastReadMessageId: number | null;
  currentUserId: number;
  isMobile: boolean;
  C: ColorTheme;
  editingId: number | null;
  editText: string;
  setEditText: (v: string) => void;
  setEditingId: (id: number | null) => void;
  registerRef: (id: number, el: HTMLDivElement | null) => void;
  onScrollTo: (id: number) => void;
  onLightbox: (url: string) => void;
  onReply: (m: ChatMsg) => void;
  onReact: (id: number, emoji: string) => void;
  onDelete: (id: number) => void;
  /** Instant moderator delete (channel admins) — no confirm dialog. */
  onAdminDelete?: (id: number) => void;
  canAdminDelete?: boolean;
  onReport: (id: number) => void;
  onCommitEdit: (id: number) => void;
  onOpenProfile: (m: ChatMsg) => void | Promise<void>;
};

export const MessageRow = memo(function MessageRow({
  m,
  prev,
  lastReadMessageId,
  currentUserId,
  isMobile,
  C,
  editingId,
  editText,
  setEditText,
  setEditingId,
  registerRef,
  onScrollTo,
  onLightbox,
  onReply,
  onReact,
  onDelete,
  onAdminDelete,
  canAdminDelete,
  onReport,
  onCommitEdit,
  onOpenProfile,
}: MessageRowProps) {
  const [hovered, setHovered] = useState(false);
  const [reactionOpen, setReactionOpen] = useState(false);
  const showHeader = !prev || prev.user !== m.user || prev.time !== m.time;
  const showUnreadDivider = !!(
    lastReadMessageId
    && !m.self
    && m.id > lastReadMessageId
    && (!prev || prev.id <= lastReadMessageId || prev.self)
  );

  // System call timeline — centered, not a user bubble
  if (m.mediaType === "call_event") {
    return (
      <div className="pb-3 min-w-0 max-w-full">
        {showUnreadDivider && (
          <div className="flex items-center gap-3 my-3">
            <div className="flex-1 h-px" style={{ background: C.error }} />
            <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: C.error, fontFamily: "Roboto" }}>New</span>
            <div className="flex-1 h-px" style={{ background: C.error }} />
          </div>
        )}
        <div className="flex items-center justify-center gap-2 py-1 px-3">
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs max-w-full"
            style={{
              background: C.surfaceVar,
              color: C.onSurfaceVar,
              border: `1px solid ${C.outlineVar}`,
              fontFamily: "Roboto",
            }}
            role="status"
          >
            <CallIcon style={{ fontSize: 14, color: C.primary }} />
            <span className="font-medium truncate" style={{ color: C.onSurface }}>{m.msg}</span>
            <span className="opacity-70 tabular-nums shrink-0" style={{ fontFamily: "Roboto Mono, monospace" }}>{m.time}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-3 min-w-0 max-w-full">
      {showUnreadDivider && (
        <div className="flex items-center gap-3 my-3">
          <div className="flex-1 h-px" style={{ background: C.error }} />
          <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: C.error, fontFamily: "Roboto" }}>New</span>
          <div className="flex-1 h-px" style={{ background: C.error }} />
        </div>
      )}
      <div className={`flex gap-2.5 min-w-0 max-w-full ${m.self ? "flex-row-reverse" : ""}`}>
        {!m.self ? (
          showHeader
            ? (
              <button
                type="button"
                className="self-end shrink-0 rounded-full focus:outline-none focus-visible:ring-2 p-0 border-0 bg-transparent"
                onClick={e => { e.stopPropagation(); void onOpenProfile(m); }}
                aria-label={isMobile ? `View ${m.user}'s profile` : undefined}
                tabIndex={isMobile ? 0 : -1}
                style={{ cursor: isMobile ? "pointer" : "default" }}
              >
                <ChatAvatar name={m.user} avatarUrl={m.avatarUrl} size={32} deleted={!!m.isDeleted} />
              </button>
            )
            : <div className="w-8 shrink-0" />
        ) : <div className="w-8 shrink-0" />}
        <div className={`flex flex-col gap-1 min-w-0 max-w-[min(100%,20rem)] lg:max-w-md ${m.self ? "items-end" : "items-start"}`}>
          {showHeader && (
            <span className="text-[11px] mb-0.5 mx-1 flex items-center gap-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              <span style={{ fontFamily: "Roboto Mono,monospace" }}>{m.time}</span>
              {!m.self && <span>{m.user || "Deleted User"}</span>}
            </span>
          )}
          <div
            ref={el => registerRef(m.id, el)}
            className="relative min-w-0 max-w-full"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => { setHovered(false); setReactionOpen(false); }}
          >
            {hovered && (
              <div className="absolute -top-8 right-0 flex items-center gap-0.5 px-1.5 py-1 rounded-full shadow-lg z-20" style={{ background: C.surface, border: `1px solid ${C.outlineVar}` }}>
                <div className="relative">
                  <button title="React" onClick={e => { e.stopPropagation(); setReactionOpen(o => !o); }} className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-black/8 transition-colors text-sm" style={{ color: C.onSurfaceVar }}>😊</button>
                  {reactionOpen && (
                    <div
                      className={`absolute bottom-full mb-1 flex gap-1 px-2 py-1.5 rounded-full shadow-lg ${m.self ? "right-0" : "left-0"}`}
                      style={{ background: C.surface, border: `1px solid ${C.outlineVar}` }}
                      onClick={e => e.stopPropagation()}
                    >
                      {QUICK_REACTIONS.map(emoji => (
                        <button key={emoji} onClick={() => { onReact(m.id, emoji); setReactionOpen(false); }} className="text-lg hover:scale-125 transition-transform w-7 h-7 flex items-center justify-center rounded-full hover:bg-black/8">{emoji}</button>
                      ))}
                    </div>
                  )}
                </div>
                <button title="Reply" onClick={e => { e.stopPropagation(); onReply(m); }} className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-black/8 transition-colors" style={{ color: C.onSurfaceVar }}><ReplyIcon style={{ fontSize: 14 }} /></button>
                {m.self && editingId !== m.id && (
                  <button title="Edit" onClick={e => { e.stopPropagation(); setEditingId(m.id); setEditText(m.msg); }} className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-black/8 transition-colors" style={{ color: C.onSurfaceVar }}><EditIcon style={{ fontSize: 14 }} /></button>
                )}
                {m.self && (
                  <button title="Delete" onClick={e => { e.stopPropagation(); onDelete(m.id); }} className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-black/8 transition-colors" style={{ color: C.error }}><DeleteIcon style={{ fontSize: 14 }} /></button>
                )}
                {!m.self && canAdminDelete && onAdminDelete && (
                  <button title="Delete message" aria-label="Delete message" onClick={e => { e.stopPropagation(); onAdminDelete(m.id); }} className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-black/8 transition-colors" style={{ color: C.error }}><DeleteIcon style={{ fontSize: 14 }} /></button>
                )}
                {!m.self && (
                  <button title="Report" onClick={e => { e.stopPropagation(); onReport(m.id); }} className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-black/8 transition-colors" style={{ color: C.error }}><FlagIcon style={{ fontSize: 14 }} /></button>
                )}
              </div>
            )}
            {editingId === m.id ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-2xl border min-w-0 max-w-full" style={{ background: C.surfaceVar, borderColor: C.primary }}>
                <input autoFocus value={editText} onChange={e => setEditText(e.target.value)} onKeyDown={e => { if (e.key === "Enter") onCommitEdit(m.id); if (e.key === "Escape") setEditingId(null); }} className="flex-1 min-w-0 bg-transparent text-sm focus:outline-none" style={{ color: C.onSurface, fontFamily: "Roboto" }} />
                <button onClick={() => onCommitEdit(m.id)} className="w-6 h-6 flex items-center justify-center rounded-full text-white shrink-0" style={{ background: C.primary }}><CheckIcon style={{ fontSize: 12 }} /></button>
                <button onClick={() => setEditingId(null)} className="w-6 h-6 flex items-center justify-center rounded-full shrink-0" style={{ background: C.surfaceVar, color: C.onSurfaceVar }}><CloseIcon style={{ fontSize: 12 }} /></button>
              </div>
            ) : (
              <div>
                <MediaBubble msg={m} self={m.self} C={C} onScrollTo={onScrollTo} onLightbox={onLightbox} />
                {m.reactions && Object.keys(m.reactions).length > 0 && (
                  <div className={`flex flex-wrap gap-1 mt-1 ${m.self ? "justify-end" : "justify-start"}`}>
                    {Object.entries(m.reactions).map(([emoji, users]) => (
                      <button key={emoji} onClick={() => onReact(m.id, emoji)} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-all hover:scale-105" style={{ background: users.includes(String(currentUserId)) ? C.primaryCont : C.surface, borderColor: users.includes(String(currentUserId)) ? C.primary : C.outlineVar, color: C.onSurface, fontFamily: "Roboto" }}>
                        <span>{emoji}</span><span className="font-medium">{users.length}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

