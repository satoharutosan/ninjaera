import {
  MAX_CACHED_CONVERSATIONS,
  MAX_CACHED_MESSAGES_PER_CONV,
} from "./messageConfig";
import type { ChatMsg } from "./types";

export type ConversationCacheEntry = {
  messages: ChatMsg[];
  hasMoreOlder: boolean;
  hasMoreNewer: boolean;
  lastAccessAt: number;
};

const store = new Map<number, ConversationCacheEntry>();

function touch(conversationId: number, entry: ConversationCacheEntry) {
  entry.lastAccessAt = Date.now();
  store.set(conversationId, entry);
  evictLru();
}

function evictLru() {
  if (store.size <= MAX_CACHED_CONVERSATIONS) return;
  const ranked = [...store.entries()].sort((a, b) => a[1].lastAccessAt - b[1].lastAccessAt);
  const overflow = store.size - MAX_CACHED_CONVERSATIONS;
  for (let i = 0; i < overflow; i++) {
    store.delete(ranked[i][0]);
  }
}

function trim(msgs: ChatMsg[]): ChatMsg[] {
  if (msgs.length <= MAX_CACHED_MESSAGES_PER_CONV) return msgs;
  // Keep the newest window when over cap
  return msgs.slice(msgs.length - MAX_CACHED_MESSAGES_PER_CONV);
}

function mergeById(existing: ChatMsg[], incoming: ChatMsg[]): ChatMsg[] {
  if (!incoming.length) return existing;
  const map = new Map<number, ChatMsg>();
  for (const m of existing) map.set(m.id, m);
  for (const m of incoming) map.set(m.id, m);
  return [...map.values()].sort((a, b) => a.id - b.id);
}

export const messageCache = {
  get(conversationId: number): ConversationCacheEntry | null {
    const entry = store.get(conversationId);
    if (!entry) return null;
    entry.lastAccessAt = Date.now();
    return entry;
  },

  /** True if the cache has a continuous window containing `messageId`. */
  hasMessage(conversationId: number, messageId: number): boolean {
    const entry = store.get(conversationId);
    return !!entry?.messages.some(m => m.id === messageId);
  },

  /** True when we already have a newest-page window (no newer history to fetch). */
  hasNewestWindow(conversationId: number): boolean {
    const entry = store.get(conversationId);
    return !!(entry && entry.messages.length > 0 && !entry.hasMoreNewer);
  },

  setWindow(
    conversationId: number,
    messages: ChatMsg[],
    flags: { hasMoreOlder: boolean; hasMoreNewer: boolean },
    mode: "replace" | "merge" = "merge",
  ) {
    const prev = store.get(conversationId);
    const merged = mode === "replace" || !prev
      ? [...messages].sort((a, b) => a.id - b.id)
      : mergeById(prev.messages, messages);

    const entry: ConversationCacheEntry = {
      messages: trim(merged),
      hasMoreOlder: flags.hasMoreOlder,
      hasMoreNewer: flags.hasMoreNewer,
      lastAccessAt: Date.now(),
    };

    // When merging pages, prefer more permissive "still more" until a page says false on that edge
    if (mode === "merge" && prev) {
      if (messages.length && messages[0].id <= (prev.messages[0]?.id ?? Infinity)) {
        entry.hasMoreOlder = flags.hasMoreOlder;
      } else {
        entry.hasMoreOlder = prev.hasMoreOlder;
      }
      if (messages.length && messages[messages.length - 1].id >= (prev.messages[prev.messages.length - 1]?.id ?? 0)) {
        entry.hasMoreNewer = flags.hasMoreNewer;
      } else {
        entry.hasMoreNewer = prev.hasMoreNewer;
      }
    }

    touch(conversationId, entry);
    return entry;
  },

  prepend(
    conversationId: number,
    older: ChatMsg[],
    hasMoreOlder: boolean,
  ) {
    const prev = store.get(conversationId);
    if (!prev) {
      return this.setWindow(conversationId, older, { hasMoreOlder, hasMoreNewer: true }, "replace");
    }
    const merged = mergeById(prev.messages, older);
    const entry: ConversationCacheEntry = {
      messages: trim(merged),
      hasMoreOlder,
      hasMoreNewer: prev.hasMoreNewer,
      lastAccessAt: Date.now(),
    };
    touch(conversationId, entry);
    return entry;
  },

  append(
    conversationId: number,
    newer: ChatMsg[],
    hasMoreNewer: boolean,
  ) {
    const prev = store.get(conversationId);
    if (!prev) {
      return this.setWindow(conversationId, newer, { hasMoreOlder: true, hasMoreNewer }, "replace");
    }
    const merged = mergeById(prev.messages, newer);
    const entry: ConversationCacheEntry = {
      messages: trim(merged),
      hasMoreOlder: prev.hasMoreOlder,
      hasMoreNewer,
      lastAccessAt: Date.now(),
    };
    touch(conversationId, entry);
    return entry;
  },

  upsertMessage(conversationId: number, msg: ChatMsg) {
    const prev = store.get(conversationId);
    if (!prev) {
      return this.setWindow(conversationId, [msg], { hasMoreOlder: true, hasMoreNewer: false }, "replace");
    }
    const idx = prev.messages.findIndex(m => m.id === msg.id);
    let messages: ChatMsg[];
    if (idx >= 0) {
      messages = [...prev.messages];
      messages[idx] = msg;
    } else {
      // Only append if contiguous with newest cached edge (or empty)
      const newest = prev.messages[prev.messages.length - 1];
      if (!newest || msg.id > newest.id) {
        messages = [...prev.messages, msg];
        prev.hasMoreNewer = false;
      } else if (msg.id < prev.messages[0].id) {
        messages = [msg, ...prev.messages];
      } else {
        messages = mergeById(prev.messages, [msg]);
      }
    }
    const entry: ConversationCacheEntry = {
      messages: trim(messages),
      hasMoreOlder: prev.hasMoreOlder,
      hasMoreNewer: prev.hasMoreNewer,
      lastAccessAt: Date.now(),
    };
    touch(conversationId, entry);
    return entry;
  },

  patchMessage(conversationId: number, messageId: number, patch: Partial<ChatMsg>) {
    const prev = store.get(conversationId);
    if (!prev) return null;
    const idx = prev.messages.findIndex(m => m.id === messageId);
    if (idx < 0) return null;
    const messages = [...prev.messages];
    messages[idx] = { ...messages[idx], ...patch };
    const entry: ConversationCacheEntry = { ...prev, messages, lastAccessAt: Date.now() };
    touch(conversationId, entry);
    return entry;
  },

  removeMessage(conversationId: number, messageId: number) {
    const prev = store.get(conversationId);
    if (!prev) return null;
    const messages = prev.messages.filter(m => m.id !== messageId);
    const entry: ConversationCacheEntry = { ...prev, messages, lastAccessAt: Date.now() };
    touch(conversationId, entry);
    return entry;
  },

  invalidate(conversationId: number) {
    store.delete(conversationId);
  },

  clear() {
    store.clear();
  },
};
