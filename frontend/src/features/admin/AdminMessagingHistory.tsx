import { useCallback, useEffect, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import ForumIcon from "@mui/icons-material/Forum";
import SearchIcon from "@mui/icons-material/Search";
import ChatBubbleIcon from "@mui/icons-material/ChatBubble";
import DeleteIcon from "@mui/icons-material/Delete";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import PersonIcon from "@mui/icons-material/Person";
import DownloadIcon from "@mui/icons-material/Download";
import CircularProgress from "@mui/material/CircularProgress";
import { toast } from "sonner";
import { useC, SH1, ChatAvatar, Chip } from "@/app/shared";
import {
  api, ApiError, type AdminConversation, type AdminUser, type ApiMessage,
} from "@/app/api";
import { toChatMsg, type ChatMsg } from "@/features/messages/types";
import { VoiceMessagePlayer } from "@/features/messages/VoiceMessagePlayer";
import { MediaPreviewLine } from "@/features/messages/MediaPreviewLine";
import { fileTypeIcon } from "@/features/messages/mediaIcons";
import { getStandaloneEmojis, jumboEmojiFontSize } from "@/features/messages/emojiOnly";

function useDebounced(value: string, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function AdminBubble({ msg, C }: { msg: ChatMsg; C: ReturnType<typeof useC> }) {
  const FileIcon = fileTypeIcon(msg.fileName);
  if (msg.mediaType === "call_event") {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs" style={{ background: C.surfaceVar, color: C.onSurfaceVar, border: `1px solid ${C.outlineVar}` }}>
        {msg.msg}
      </div>
    );
  }
  if (msg.mediaType === "image" || msg.mediaType === "gif") {
    return (
      <div className="overflow-hidden rounded-2xl" style={{ maxWidth: 280, boxShadow: SH1 }}>
        <img src={msg.mediaUrl} alt="" className="block max-w-full h-auto" loading="lazy" decoding="async" />
        {msg.msg && <p className="px-3 py-1.5 text-sm" style={{ background: C.surface, color: C.onSurface }}>{msg.msg}</p>}
      </div>
    );
  }
  if (msg.mediaType === "video") {
    return <video src={msg.mediaUrl} controls className="max-w-[280px] rounded-2xl" preload="metadata" />;
  }
  if (msg.mediaType === "audio") {
    return (
      <VoiceMessagePlayer
        src={msg.mediaUrl!}
        messageId={msg.id}
        fileName={msg.fileName}
        durationMs={msg.durationMs}
        waveform={msg.waveform}
        mimeType={msg.mimeType}
      />
    );
  }
  if (msg.mediaType === "file") {
    return (
      <button
        type="button"
        onClick={() => {
          void api.messages.downloadAttachment(msg.id).catch((err) => {
            toast.error(err instanceof ApiError ? err.message : "Download failed");
          });
        }}
        className="flex items-center gap-3 px-4 py-3 rounded-2xl max-w-[260px] text-left"
        style={{ background: C.surface, boxShadow: SH1, color: C.onSurface }}
      >
        <FileIcon style={{ fontSize: 22, color: C.primary }} />
        <span className="text-sm truncate">{msg.fileName || "file"}</span>
        <DownloadIcon style={{ fontSize: 16, color: C.onSurfaceVar }} />
      </button>
    );
  }
  if (msg.msg) {
    const standalone = getStandaloneEmojis(msg.msg);
    const jumbo = standalone ? jumboEmojiFontSize(standalone.length) : null;
    if (standalone && jumbo) {
      return <div style={{ fontSize: jumbo, lineHeight: 1.15 }}>{standalone.join(" ")}</div>;
    }
    return (
      <div className="px-4 py-2.5 text-sm rounded-2xl max-w-md" style={{ background: C.surface, color: C.onSurface, boxShadow: SH1, fontFamily: "Roboto" }}>
        <span className="whitespace-pre-wrap break-words">{msg.msg}</span>
        {msg.edited && <span className="text-[9px] opacity-60 ml-1">(edited)</span>}
      </div>
    );
  }
  return null;
}

export function AdminMessagingHistory({
  onOpenProfile,
}: {
  onOpenProfile: (user: AdminUser) => void;
}) {
  const C = useC();
  const [viewerId, setViewerId] = useState(0);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 220);
  const [userA, setUserA] = useState("");
  const [userB, setUserB] = useState("");
  const debouncedA = useDebounced(userA, 220);
  const debouncedB = useDebounced(userB, 220);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [convs, setConvs] = useState<AdminConversation[]>([]);
  const [convsLoading, setConvsLoading] = useState(false);
  const [sel, setSel] = useState<AdminConversation | null>(null);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [msgsLoading, setMsgsLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [kw, setKw] = useState("");
  const debouncedKw = useDebounced(kw, 250);
  const [mediaType, setMediaType] = useState("");
  const [editedOnly, setEditedOnly] = useState(false);
  const [callsOnly, setCallsOnly] = useState(false);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const firstItemIndex = useRef(100_000);
  const [fi, setFi] = useState(100_000);

  useEffect(() => {
    api.admin.check().then((r) => {
      const u = (r as { user?: { id: number } }).user;
      if (u?.id) setViewerId(u.id);
    }).catch(() => {});
  }, []);

  const loadConvs = useCallback(async () => {
    setConvsLoading(true);
    try {
      const params: Record<string, string> = { limit: "120" };
      if (debouncedSearch) params.search = debouncedSearch;
      if (debouncedA) params.userA = debouncedA;
      if (debouncedB) params.userB = debouncedB;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = `${dateTo}T23:59:59.999Z`;
      const r = await api.admin.conversations(params);
      setConvs(r.conversations);
      setSel((prev) => (prev && r.conversations.some((c) => c.id === prev.id) ? prev : null));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to load conversations");
    } finally {
      setConvsLoading(false);
    }
  }, [debouncedSearch, debouncedA, debouncedB, dateFrom, dateTo]);

  useEffect(() => { void loadConvs(); }, [loadConvs]);

  const loadMessages = useCallback(async (conv: AdminConversation, reset = true) => {
    if (reset) {
      setMsgsLoading(true);
      setMsgs([]);
      firstItemIndex.current = 100_000;
      setFi(100_000);
    }
    try {
      const params: Record<string, string> = { limit: "50" };
      if (debouncedKw) params.q = debouncedKw;
      if (mediaType) params.mediaType = mediaType;
      if (editedOnly) params.edited = "1";
      if (callsOnly) params.calls = "1";
      const r = await api.admin.conversationMessages(conv.id, params);
      const mapped = r.messages.map((m: ApiMessage) => toChatMsg(m, viewerId));
      setMsgs(mapped);
      setHasMore(r.hasMore);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to load messages");
    } finally {
      setMsgsLoading(false);
    }
  }, [debouncedKw, mediaType, editedOnly, callsOnly, viewerId]);

  useEffect(() => {
    if (sel) void loadMessages(sel, true);
  }, [sel, loadMessages]);

  const loadOlder = async () => {
    if (!sel || !hasMore || loadingOlder || !msgs.length) return;
    setLoadingOlder(true);
    try {
      const params: Record<string, string> = {
        limit: "50",
        before: String(msgs[0]!.id),
      };
      if (debouncedKw) params.q = debouncedKw;
      if (mediaType) params.mediaType = mediaType;
      if (editedOnly) params.edited = "1";
      if (callsOnly) params.calls = "1";
      const r = await api.admin.conversationMessages(sel.id, params);
      const older = r.messages.map((m: ApiMessage) => toChatMsg(m, viewerId));
      if (older.length) {
        firstItemIndex.current -= older.length;
        setFi(firstItemIndex.current);
        setMsgs((prev) => [...older, ...prev]);
      }
      setHasMore(r.hasMore);
    } catch {
      toast.error("Failed to load older messages");
    } finally {
      setLoadingOlder(false);
    }
  };

  const deleteMsg = async (id: number) => {
    try {
      await api.admin.deleteMessage(id);
      setMsgs((prev) => prev.filter((m) => m.id !== id));
      void loadConvs();
      toast.success("Message deleted");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Delete failed");
    }
  };

  const openSender = async (m: ChatMsg) => {
    if (!m.userId) return;
    try {
      const r = await api.admin.getUser(m.userId);
      onOpenProfile(r.user);
    } catch {
      toast.error("Could not load profile");
    }
  };

  const copyText = async (m: ChatMsg) => {
    const text = m.msg || m.fileName || m.mediaUrl || "";
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] min-h-[28rem] rounded-2xl border overflow-hidden" style={{ borderColor: C.outlineVar, background: C.surface }}>
      <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0" style={{ borderColor: C.outlineVar }}>
        <ForumIcon style={{ color: C.primary }} />
        <div className="min-w-0">
          <h1 className="text-lg font-medium truncate" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Messaging History</h1>
          <p className="text-xs" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>DM conversations between other users (channels &amp; your own DMs excluded)</p>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Left — conversation explorer */}
        <aside className="w-full max-w-[20rem] border-r flex flex-col min-h-0 shrink-0" style={{ borderColor: C.outlineVar, background: C.surfaceVar }}>
          <div className="p-3 space-y-2 border-b shrink-0" style={{ borderColor: C.outlineVar }}>
            <div className="flex items-center gap-2 px-3 py-2 rounded-full border" style={{ borderColor: C.outlineVar, background: C.surface }}>
              <SearchIcon style={{ fontSize: 18, color: C.onSurfaceVar }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search DMs…"
                className="flex-1 bg-transparent text-sm focus:outline-none min-w-0"
                style={{ color: C.onSurface, fontFamily: "Roboto" }}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input value={userA} onChange={(e) => setUserA(e.target.value)} placeholder="Username A" className="px-3 py-1.5 rounded-full border text-xs" style={{ borderColor: C.outlineVar, background: C.surface, color: C.onSurface, fontFamily: "Roboto" }} />
              <input value={userB} onChange={(e) => setUserB(e.target.value)} placeholder="Username B" className="px-3 py-1.5 rounded-full border text-xs" style={{ borderColor: C.outlineVar, background: C.surface, color: C.onSurface, fontFamily: "Roboto" }} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="From date" className="px-2 py-1.5 rounded-full border text-xs" style={{ borderColor: C.outlineVar, background: C.surface, color: C.onSurface, fontFamily: "Roboto" }} />
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="To date" className="px-2 py-1.5 rounded-full border text-xs" style={{ borderColor: C.outlineVar, background: C.surface, color: C.onSurface, fontFamily: "Roboto" }} />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto ninja-scroll">
            {convsLoading && (
              <div className="flex justify-center py-8"><CircularProgress size={24} /></div>
            )}
            {!convsLoading && convs.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSel(c)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left border-b transition-colors hover:bg-black/5"
                style={{
                  borderColor: C.outlineVar,
                  background: sel?.id === c.id ? C.primaryCont : "transparent",
                }}
              >
                <ChatAvatar name={c.name} avatarUrl={c.avatarUrl} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <ChatBubbleIcon style={{ fontSize: 14, color: C.onSurfaceVar }} />
                    <span className="text-sm font-medium truncate" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{c.name}</span>
                  </div>
                  <p className="text-[11px] truncate" style={{ color: C.onSurfaceVar }}>
                    <MediaPreviewLine text={c.preview} color={C.onSurfaceVar} iconSize={11} />
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                    {c.time} · {c.messageCount} msg{c.messageCount === 1 ? "" : "s"}
                  </p>
                </div>
              </button>
            ))}
            {!convsLoading && convs.length === 0 && (
              <p className="text-center text-sm py-10" style={{ color: C.onSurfaceVar }}>No conversations</p>
            )}
          </div>
        </aside>

        {/* Right — message viewer */}
        <section className="flex-1 flex flex-col min-w-0 min-h-0">
          {!sel ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6">
              <ForumIcon style={{ fontSize: 48, color: C.outlineVar }} />
              <p className="text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>Select a conversation to review history</p>
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b flex flex-wrap items-center gap-2 shrink-0" style={{ borderColor: C.outlineVar }}>
                <ChatAvatar name={sel.name} avatarUrl={sel.avatarUrl} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{sel.name}</p>
                  <p className="text-[11px]" style={{ color: C.onSurfaceVar }}>Direct Message · #{sel.id}</p>
                </div>
                <input
                  value={kw}
                  onChange={(e) => setKw(e.target.value)}
                  placeholder="Filter messages…"
                  className="px-3 py-1.5 rounded-full border text-xs min-w-[10rem]"
                  style={{ borderColor: C.outlineVar, background: C.surfaceVar, color: C.onSurface, fontFamily: "Roboto" }}
                />
                <select
                  value={mediaType}
                  onChange={(e) => setMediaType(e.target.value)}
                  className="px-2 py-1.5 rounded-full border text-xs"
                  style={{ borderColor: C.outlineVar, background: C.surfaceVar, color: C.onSurface, fontFamily: "Roboto" }}
                >
                  <option value="">All types</option>
                  <option value="image">Images</option>
                  <option value="video">Videos</option>
                  <option value="audio">Voice</option>
                  <option value="file">Files</option>
                  <option value="gif">GIFs</option>
                  <option value="none">Text only</option>
                </select>
                <label className="flex items-center gap-1 text-xs" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                  <input type="checkbox" checked={editedOnly} onChange={(e) => setEditedOnly(e.target.checked)} /> Edited
                </label>
                <label className="flex items-center gap-1 text-xs" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                  <input type="checkbox" checked={callsOnly} onChange={(e) => setCallsOnly(e.target.checked)} /> Calls
                </label>
              </div>

              <div className="flex-1 min-h-0 relative">
                {msgsLoading ? (
                  <div className="absolute inset-0 flex items-center justify-center"><CircularProgress size={28} /></div>
                ) : msgs.length === 0 ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <p className="text-sm" style={{ color: C.onSurfaceVar }}>No messages match filters</p>
                  </div>
                ) : (
                  <Virtuoso
                    ref={virtuosoRef}
                    className="ninja-scroll h-full"
                    data={msgs}
                    firstItemIndex={fi}
                    startReached={() => { void loadOlder(); }}
                    increaseViewportBy={{ top: 400, bottom: 200 }}
                    itemContent={(_i, m) => (
                      <div className="px-4 py-2 group">
                        <div className="flex gap-2.5 min-w-0">
                          <button type="button" className="shrink-0 self-end p-0 border-0 bg-transparent rounded-full" onClick={() => void openSender(m)} aria-label={`View ${m.user}`}>
                            {m.avatarUrl
                              ? <img src={m.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
                              : (
                                <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs" style={{ background: C.primary }}>
                                  {m.user?.[0]?.toUpperCase() || <PersonIcon style={{ fontSize: 16 }} />}
                                </div>
                              )}
                          </button>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-0.5">
                              <button type="button" className="text-xs font-medium hover:underline" style={{ color: C.primary, fontFamily: "Roboto" }} onClick={() => void openSender(m)}>
                                {m.user}
                              </button>
                              <span className="text-[10px] tabular-nums" style={{ color: C.onSurfaceVar, fontFamily: "Roboto Mono, monospace" }}>{m.time}</span>
                              {m.edited && <Chip label="Edited" />}
                              <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 ml-auto">
                                <button type="button" title="Copy" aria-label="Copy message" onClick={() => void copyText(m)} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ color: C.onSurfaceVar }}>
                                  <ContentCopyIcon style={{ fontSize: 14 }} />
                                </button>
                                <button type="button" title="View profile" aria-label="View sender profile" onClick={() => void openSender(m)} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ color: C.onSurfaceVar }}>
                                  <PersonIcon style={{ fontSize: 14 }} />
                                </button>
                                <button type="button" title="Delete" aria-label="Delete message" onClick={() => void deleteMsg(m.id)} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ color: C.error }}>
                                  <DeleteIcon style={{ fontSize: 14 }} />
                                </button>
                              </div>
                            </div>
                            {m.replyTo && (
                              <div className="text-[11px] px-2 py-1 mb-1 rounded-lg border-l-2 truncate" style={{ borderColor: C.primary, background: C.surfaceVar, color: C.onSurfaceVar }}>
                                {m.replyTo.user}: {m.replyTo.preview}
                              </div>
                            )}
                            <AdminBubble msg={m} C={C} />
                            {m.reactions && Object.keys(m.reactions).length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {Object.entries(m.reactions).map(([emoji, users]) => (
                                  <span key={emoji} className="px-2 py-0.5 rounded-full text-xs border" style={{ borderColor: C.outlineVar, color: C.onSurface }}>
                                    {emoji} {users.length}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  />
                )}
                {loadingOlder && (
                  <div className="absolute top-2 left-1/2 -translate-x-1/2"><CircularProgress size={18} /></div>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
