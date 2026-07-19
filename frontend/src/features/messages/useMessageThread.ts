import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ApiMessage } from "@/app/api";
import {
  getConversationReadState,
  markConversationOpened,
  ensureFirstOpenReadBaseline,
  saveConversationReadState,
} from "@/features/messages/conversationState";
import { joinConversation } from "@/app/realtime";
import { messageCache } from "./messageCache";
import { MESSAGE_PAGE_SIZE, VIRTUOSO_START_INDEX } from "./messageConfig";
import { msgPerf } from "./msgPerf";
import { sortChatMessages, toChatMsg, type ChatMsg } from "./types";

export type ThreadOpenMode = "newest" | "around";

export type InitialScrollIndex =
  | number
  | { index: number; align: "start" | "center" | "end" };

export type UseMessageThreadOptions = {
  conversationId: number;
  currentUserId: number;
  /** Sidebar unread count — helps decide open-at-unread vs open-at-bottom. */
  expectedUnread?: number;
  onContactsRefresh?: () => void;
};

/** First message after the read cursor (single NEW boundary target). */
function findFirstUnreadId(list: ChatMsg[], lastReadId: number | null): number | null {
  if (lastReadId == null || lastReadId <= 0) return null;
  const found = list.find(m => m.id > 0 && m.id > lastReadId);
  return found?.id ?? null;
}

export function useMessageThread({
  conversationId,
  currentUserId,
  expectedUnread = 0,
  onContactsRefresh,
}: UseMessageThreadOptions) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [hasMoreNewer, setHasMoreNewer] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadingNewer, setLoadingNewer] = useState(false);
  const [threadReady, setThreadReady] = useState(false);
  const [threadBootId, setThreadBootId] = useState(0);
  const [initialScrollIndex, setInitialScrollIndex] = useState<InitialScrollIndex | null>(null);
  const [lastReadMessageId, setLastReadMessageId] = useState<number | null>(null);
  const [firstItemIndex, setFirstItemIndex] = useState(VIRTUOSO_START_INDEX);
  const [showJumpBtn, setShowJumpBtn] = useState(false);
  const [unreadBelow, setUnreadBelow] = useState(0);

  const msgsRef = useRef<ChatMsg[]>([]);
  const hasMoreOlderRef = useRef(false);
  const hasMoreNewerRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const loadingNewerRef = useRef(false);
  const loadGenRef = useRef(0);
  const firstItemIndexRef = useRef(VIRTUOSO_START_INDEX);
  const isNearBottomRef = useRef(true);
  const pinToBottomRef = useRef(true);
  const visibleStartDataIndexRef = useRef(0);
  const conversationIdRef = useRef(conversationId);
  const expectedUnreadRef = useRef(expectedUnread);
  /** Ignore spurious at-bottom marks right after opening at the unread boundary. */
  const suppressMarkReadUntilRef = useRef(0);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    expectedUnreadRef.current = expectedUnread;
  }, [expectedUnread]);

  useEffect(() => {
    msgsRef.current = msgs;
  }, [msgs]);

  const applyFlags = useCallback((older: boolean, newer: boolean) => {
    setHasMoreOlder(older);
    hasMoreOlderRef.current = older;
    setHasMoreNewer(newer);
    hasMoreNewerRef.current = newer;
  }, []);

  const bootThread = useCallback((
    list: ChatMsg[],
    flags: { hasMoreOlder: boolean; hasMoreNewer: boolean },
    opts: {
      scrollToId?: number | null;
      /** Align first unread near the top so the NEW separator is visible. */
      scrollAlign?: "start" | "center" | "end";
      pinBottom: boolean;
      lastReadId?: number | null;
      showJump?: boolean;
    },
  ) => {
    msgsRef.current = list;
    setMsgs(list);
    applyFlags(flags.hasMoreOlder, flags.hasMoreNewer);
    firstItemIndexRef.current = VIRTUOSO_START_INDEX;
    setFirstItemIndex(VIRTUOSO_START_INDEX);

    let idx = Math.max(0, list.length - 1);
    if (opts.scrollToId != null) {
      const found = list.findIndex(m => m.id === opts.scrollToId);
      if (found >= 0) idx = found;
    }
    const align = opts.scrollAlign ?? (opts.pinBottom ? "end" : "start");
    setInitialScrollIndex(opts.pinBottom ? idx : { index: idx, align });
    pinToBottomRef.current = opts.pinBottom;
    isNearBottomRef.current = opts.pinBottom;
    setShowJumpBtn(!!opts.showJump || !opts.pinBottom);
    setUnreadBelow(0);
    if (opts.lastReadId !== undefined) setLastReadMessageId(opts.lastReadId);
    suppressMarkReadUntilRef.current = opts.pinBottom ? 0 : Date.now() + 500;
    setThreadBootId(id => id + 1);
    setThreadReady(true);
  }, [applyFlags]);

  const openConversation = useCallback(async () => {
    if (!conversationId || !currentUserId) return;
    const gen = ++loadGenRef.current;
    msgPerf.markOpenStart(conversationId);
    joinConversation(conversationId);
    markConversationOpened(currentUserId, conversationId);

    const saved = getConversationReadState(currentUserId, conversationId);
    setThreadReady(false);
    setLastReadMessageId(saved?.lastReadMessageId ?? null);

    const finalizeOpen = (
      list: ChatMsg[],
      flags: { hasMoreOlder: boolean; hasMoreNewer: boolean },
      source: "cache" | "network",
    ) => {
      if (gen !== loadGenRef.current) return;

      const newestId = list.filter(m => m.id > 0).at(-1)?.id
        ?? list[list.length - 1]?.id
        ?? null;
      ensureFirstOpenReadBaseline(currentUserId, conversationId, newestId);
      const afterBaseline = getConversationReadState(currentUserId, conversationId);
      const lastReadId = afterBaseline?.lastReadMessageId ?? null;
      const firstUnreadId = findFirstUnreadId(list, lastReadId);
      const hasUnread = firstUnreadId != null
        || (expectedUnreadRef.current > 0 && lastReadId != null && newestId != null && newestId > lastReadId);

      if (hasUnread && firstUnreadId != null) {
        // Open at the unread boundary — keep lastRead so a single NEW separator stays.
        saveConversationReadState(currentUserId, conversationId, {
          anchorMessageId: firstUnreadId,
          atBottom: false,
          lastReadMessageId: lastReadId,
          lastOpenedAt: Date.now(),
        });
        bootThread(list, flags, {
          scrollToId: firstUnreadId,
          scrollAlign: "start",
          pinBottom: false,
          lastReadId,
          showJump: true,
        });
      } else {
        // Fully caught up — pin to bottom, clear NEW, mark server read.
        if (newestId != null) {
          saveConversationReadState(currentUserId, conversationId, {
            anchorMessageId: newestId,
            atBottom: true,
            lastReadMessageId: newestId,
            lastOpenedAt: Date.now(),
          });
        }
        bootThread(list, flags, {
          pinBottom: true,
          lastReadId: newestId,
        });
        api.messages.markRead(conversationId).then(() => onContactsRefresh?.()).catch(() => {});
        requestAnimationFrame(() => {
          pinToBottomRef.current = true;
          isNearBottomRef.current = true;
        });
      }
      msgPerf.markOpenReady(conversationId, source);
      onContactsRefresh?.();
    };

    // When sidebar reports unread but the newest window has no boundary yet, load around lastRead.
    const loadAroundUnread = async (lastReadId: number): Promise<boolean> => {
      try {
        const t0 = performance.now();
        const r = await api.messages.getMessages(conversationId, {
          limit: MESSAGE_PAGE_SIZE,
          around: lastReadId,
        });
        msgPerf.markFetch(performance.now() - t0, { conversationId, mode: "around" });
        if (gen !== loadGenRef.current) return true;
        const mapped = r.messages.map(m => toChatMsg(m, currentUserId));
        const flags = {
          hasMoreOlder: r.hasMoreOlder ?? r.hasMore,
          hasMoreNewer: r.hasMoreNewer ?? false,
        };
        messageCache.setWindow(conversationId, mapped, flags, "merge");
        finalizeOpen(mapped, flags, "network");
        return true;
      } catch {
        return false;
      }
    };

    // Cache-first boot
    const cached = messageCache.get(conversationId);
    if (cached?.messages.length && messageCache.hasNewestWindow(conversationId)) {
      msgPerf.cacheHit(conversationId);
      const newestId = cached.messages.filter(m => m.id > 0).at(-1)?.id ?? null;
      ensureFirstOpenReadBaseline(currentUserId, conversationId, newestId);
      const lastReadId = getConversationReadState(currentUserId, conversationId)?.lastReadMessageId ?? null;
      const firstUnreadId = findFirstUnreadId(cached.messages, lastReadId);
      // Unread exists server-side but boundary isn't in the newest window — refetch around cursor.
      if (
        expectedUnreadRef.current > 0
        && lastReadId != null
        && firstUnreadId == null
        && newestId != null
        && newestId > lastReadId
      ) {
        const ok = await loadAroundUnread(lastReadId);
        if (ok) return;
      }
      finalizeOpen(cached.messages, cached, "cache");
      return;
    }

    msgPerf.cacheMiss(conversationId);
    try {
      const priorLastRead = saved?.lastReadMessageId ?? null;
      const preferAround = !!(
        priorLastRead
        && expectedUnreadRef.current > 0
      );
      const t0 = performance.now();
      const r = preferAround
        ? await api.messages.getMessages(conversationId, {
            limit: MESSAGE_PAGE_SIZE,
            around: priorLastRead!,
          })
        : await api.messages.getMessages(conversationId, { limit: MESSAGE_PAGE_SIZE });
      msgPerf.markFetch(performance.now() - t0, {
        conversationId,
        mode: preferAround ? "around" : "newest",
      });
      if (gen !== loadGenRef.current) return;

      const mapped = r.messages.map(m => toChatMsg(m, currentUserId));
      const flags = {
        hasMoreOlder: r.hasMoreOlder ?? r.hasMore,
        hasMoreNewer: r.hasMoreNewer ?? false,
      };
      messageCache.setWindow(conversationId, mapped, flags, "merge");

      // Prefer-around miss: fall back to newest window once.
      if (preferAround) {
        const lastReadId = priorLastRead;
        const firstUnreadId = findFirstUnreadId(mapped, lastReadId);
        if (firstUnreadId == null && !flags.hasMoreNewer) {
          // Around window had no unread after cursor — treat as caught up via newest.
          const newest = await api.messages.getMessages(conversationId, { limit: MESSAGE_PAGE_SIZE });
          if (gen !== loadGenRef.current) return;
          const newestMapped = newest.messages.map(m => toChatMsg(m, currentUserId));
          const newestFlags = {
            hasMoreOlder: newest.hasMoreOlder ?? newest.hasMore,
            hasMoreNewer: newest.hasMoreNewer ?? false,
          };
          messageCache.setWindow(conversationId, newestMapped, newestFlags, "merge");
          finalizeOpen(newestMapped, newestFlags, "network");
          return;
        }
      }

      finalizeOpen(mapped, flags, "network");
    } catch {
      if (gen !== loadGenRef.current) return;
      bootThread([], { hasMoreOlder: false, hasMoreNewer: false }, { pinBottom: true });
      msgPerf.markOpenReady(conversationId, "network");
    }
  }, [conversationId, currentUserId, bootThread, onContactsRefresh]);

  useEffect(() => {
    void openConversation();
    return () => {
      loadGenRef.current += 1;
    };
  }, [openConversation]);

  const loadOlderMessages = useCallback(async (): Promise<number> => {
    if (!conversationId || loadingOlderRef.current || !hasMoreOlderRef.current) return 0;
    const current = msgsRef.current;
    if (!current.length) return 0;
    const oldestId = current[0].id;
    const gen = loadGenRef.current;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const t0 = performance.now();
      const r = await api.messages.getMessages(conversationId, {
        limit: MESSAGE_PAGE_SIZE,
        before: oldestId,
      });
      msgPerf.markFetch(performance.now() - t0, { conversationId, mode: "before" });
      if (gen !== loadGenRef.current) return 0;
      const older = r.messages.map(m => toChatMsg(m, currentUserId));
      const hasOlder = r.hasMoreOlder ?? r.hasMore;
      if (!older.length) {
        applyFlags(false, hasMoreNewerRef.current);
        messageCache.setWindow(conversationId, current, {
          hasMoreOlder: false,
          hasMoreNewer: hasMoreNewerRef.current,
        }, "merge");
        return 0;
      }
      const unique = older.filter(m => !current.some(c => c.id === m.id));
      if (!unique.length) {
        applyFlags(hasOlder, hasMoreNewerRef.current);
        return 0;
      }
      const next = [...unique, ...current];
      msgsRef.current = next;
      firstItemIndexRef.current -= unique.length;
      setFirstItemIndex(firstItemIndexRef.current);
      setMsgs(next);
      applyFlags(hasOlder, hasMoreNewerRef.current);
      messageCache.prepend(conversationId, unique, hasOlder);
      return unique.length;
    } catch {
      return 0;
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [conversationId, currentUserId, applyFlags]);

  const loadNewerMessages = useCallback(async (): Promise<number> => {
    if (!conversationId || loadingNewerRef.current || !hasMoreNewerRef.current) return 0;
    const current = msgsRef.current;
    if (!current.length) return 0;
    const newestId = current[current.length - 1].id;
    const gen = loadGenRef.current;

    // Prefer cache continuation if we somehow have newer ids (rare)
    const cached = messageCache.get(conversationId);
    if (cached) {
      const extras = cached.messages.filter(m => m.id > newestId);
      if (extras.length && !cached.hasMoreNewer) {
        // contiguous cache already has newer side closed
      }
    }

    loadingNewerRef.current = true;
    setLoadingNewer(true);
    try {
      const t0 = performance.now();
      const r = await api.messages.getMessages(conversationId, {
        limit: MESSAGE_PAGE_SIZE,
        after: newestId,
      });
      msgPerf.markFetch(performance.now() - t0, { conversationId, mode: "after" });
      if (gen !== loadGenRef.current) return 0;
      const newer = r.messages.map(m => toChatMsg(m, currentUserId));
      const hasNewer = r.hasMoreNewer ?? false;
      if (!newer.length) {
        applyFlags(hasMoreOlderRef.current, false);
        messageCache.append(conversationId, [], false);
        return 0;
      }
      const unique = newer.filter(m => !current.some(c => c.id === m.id));
      if (!unique.length) {
        applyFlags(hasMoreOlderRef.current, hasNewer);
        return 0;
      }
      const next = [...current, ...unique];
      msgsRef.current = next;
      setMsgs(next);
      applyFlags(hasMoreOlderRef.current, hasNewer);
      messageCache.append(conversationId, unique, hasNewer);
      return unique.length;
    } catch {
      return 0;
    } finally {
      loadingNewerRef.current = false;
      setLoadingNewer(false);
    }
  }, [conversationId, currentUserId, applyFlags]);

  const applyNewMessage = useCallback((message: ApiMessage) => {
    if (conversationIdRef.current !== conversationId) return;
    const t0 = performance.now();
    const chatMsg = toChatMsg(message, currentUserId);
    // Drop if viewing historical gap (hasMoreNewer) — only append when at/near live edge
    if (hasMoreNewerRef.current && !isNearBottomRef.current) {
      messageCache.upsertMessage(conversationId, chatMsg);
      setUnreadBelow(n => n + 1);
      setShowJumpBtn(true);
      msgPerf.markWsApply(performance.now() - t0, "message:new-buffered");
      return;
    }
    setMsgs(prev => {
      if (prev.some(m => m.id === chatMsg.id)) {
        // Real id already present — drop any matching optimistic twin
        const cleaned = prev.filter(m => !(m.pending && m.self && chatMsg.self && m.msg === chatMsg.msg));
        if (cleaned.length !== prev.length) {
          msgsRef.current = cleaned;
          return cleaned;
        }
        return prev;
      }
      // Replace optimistic temp row instead of duplicating (WS may beat POST response)
      const optIdx = prev.findIndex(m =>
        m.pending
        && m.self
        && chatMsg.self
        && m.msg === chatMsg.msg
        && (m.mediaType || undefined) === (chatMsg.mediaType || undefined),
      );
      if (optIdx >= 0) {
        const tempId = prev[optIdx].id;
        const next = [...prev];
        next[optIdx] = chatMsg;
        msgsRef.current = next;
        messageCache.removeMessage(conversationId, tempId);
        messageCache.upsertMessage(conversationId, chatMsg);
        applyFlags(hasMoreOlderRef.current, false);
        return next;
      }
      const next = [...prev, chatMsg];
      msgsRef.current = next;
      messageCache.upsertMessage(conversationId, chatMsg);
      applyFlags(hasMoreOlderRef.current, false);
      return next;
    });
    msgPerf.markWsApply(performance.now() - t0, "message:new");
  }, [conversationId, currentUserId, applyFlags]);

  const applyUpdatedMessage = useCallback((message: ApiMessage) => {
    const chatMsg = toChatMsg(message, currentUserId);
    messageCache.upsertMessage(conversationId, chatMsg);
    setMsgs(prev => prev.map(m => (m.id === chatMsg.id ? chatMsg : m)));
  }, [conversationId, currentUserId]);

  const applyDeletedMessage = useCallback((messageId: number) => {
    messageCache.removeMessage(conversationId, messageId);
    setMsgs(prev => {
      const next = prev.filter(m => m.id !== messageId);
      msgsRef.current = next;
      return next;
    });
  }, [conversationId]);

  const applyReaction = useCallback((messageId: number, reactions: Record<string, string[]>) => {
    messageCache.patchMessage(conversationId, messageId, { reactions });
    setMsgs(prev => prev.map(m => (m.id === messageId ? { ...m, reactions } : m)));
  }, [conversationId]);

  const jumpToLatest = useCallback(async () => {
    pinToBottomRef.current = true;
    isNearBottomRef.current = true;
    setShowJumpBtn(false);
    setUnreadBelow(0);

    if (hasMoreNewerRef.current) {
      // Reload newest window instead of walking after-cursor many times
      const gen = ++loadGenRef.current;
      setThreadReady(false);
      try {
        const r = await api.messages.getMessages(conversationId, { limit: MESSAGE_PAGE_SIZE });
        if (gen !== loadGenRef.current) return;
        const mapped = r.messages.map(m => toChatMsg(m, currentUserId));
        const flags = {
          hasMoreOlder: r.hasMoreOlder ?? r.hasMore,
          hasMoreNewer: false,
        };
        messageCache.setWindow(conversationId, mapped, flags, "merge");
        bootThread(mapped, flags, {
          pinBottom: true,
          lastReadId: mapped[mapped.length - 1]?.id ?? null,
        });
      } catch {
        if (gen !== loadGenRef.current) return;
        setThreadReady(true);
      }
      return;
    }

    // Already on live edge — Virtuoso scroll handled by caller
  }, [conversationId, currentUserId, bootThread]);

  const replaceOptimistic = useCallback((tempId: number, real: ChatMsg) => {
    setMsgs(prev => {
      if (prev.some(m => m.id === real.id)) {
        // WS already confirmed — just drop the temp row
        const next = prev.filter(m => m.id !== tempId);
        msgsRef.current = next;
        messageCache.removeMessage(conversationId, tempId);
        return next;
      }
      const next = sortChatMessages(
        prev.map(m => (m.id === tempId ? { ...real, pending: false, failed: false } : m)),
      );
      msgsRef.current = next;
      messageCache.removeMessage(conversationId, tempId);
      messageCache.upsertMessage(conversationId, real);
      return next;
    });
  }, [conversationId]);

  const appendLocal = useCallback((msg: ChatMsg) => {
    setMsgs(prev => {
      if (prev.some(m => m.id === msg.id)) return prev;
      const next = [...prev, msg];
      msgsRef.current = next;
      messageCache.upsertMessage(conversationId, msg);
      return next;
    });
  }, [conversationId]);

  const markLocalFailed = useCallback((tempId: number) => {
    setMsgs(prev => {
      const next = prev.map(m => (m.id === tempId ? { ...m, pending: false, failed: true } : m));
      msgsRef.current = next;
      messageCache.patchMessage(conversationId, tempId, { pending: false, failed: true });
      return next;
    });
  }, [conversationId]);

  const updateLocal = useCallback((messageId: number, patch: Partial<ChatMsg>) => {
    messageCache.patchMessage(conversationId, messageId, patch);
    setMsgs(prev => prev.map(m => (m.id === messageId ? { ...m, ...patch } : m)));
  }, [conversationId]);

  return {
    msgs,
    setMsgs,
    msgsRef,
    hasMoreOlder,
    hasMoreNewer,
    loadingOlder,
    loadingNewer,
    threadReady,
    threadBootId,
    initialScrollIndex,
    lastReadMessageId,
    setLastReadMessageId,
    firstItemIndex,
    firstItemIndexRef,
    showJumpBtn,
    setShowJumpBtn,
    unreadBelow,
    setUnreadBelow,
    isNearBottomRef,
    pinToBottomRef,
    visibleStartDataIndexRef,
    suppressMarkReadUntilRef,
    loadOlderMessages,
    loadNewerMessages,
    applyNewMessage,
    applyUpdatedMessage,
    applyDeletedMessage,
    applyReaction,
    jumpToLatest,
    replaceOptimistic,
    appendLocal,
    markLocalFailed,
    updateLocal,
    openConversation,
  };
}
