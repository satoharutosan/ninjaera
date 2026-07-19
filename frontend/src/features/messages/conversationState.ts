/** Per-conversation reading position, persisted across switches and reloads. */

export type ConversationReadState = {
  /** Message ID near the top of the last viewport (restore anchor). */
  anchorMessageId: number | null;
  /** True if the user left while pinned to the newest messages. */
  atBottom: boolean;
  /** Last message ID the user is considered to have read. */
  lastReadMessageId: number | null;
  lastOpenedAt: number;
};

type Store = Record<string, ConversationReadState>;

function storageKey(userId: number) {
  return `ninja-era-conv-state-v1-${userId}`;
}

function readStore(userId: number): Store {
  if (!userId) return {};
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Store;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(userId: number, store: Store) {
  if (!userId) return;
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(store));
  } catch {
    /* quota / private mode — ignore */
  }
}

export function getConversationReadState(userId: number, conversationId: number): ConversationReadState | null {
  if (!userId || !conversationId) return null;
  return readStore(userId)[String(conversationId)] ?? null;
}

export function saveConversationReadState(
  userId: number,
  conversationId: number,
  state: ConversationReadState,
) {
  if (!userId || !conversationId) return;
  const store = readStore(userId);
  store[String(conversationId)] = state;
  writeStore(userId, store);
}

/**
 * Monotonic read-cursor update. Never moves lastReadMessageId backwards.
 * Returns the effective lastReadMessageId after the write.
 */
export function advanceConversationReadState(
  userId: number,
  conversationId: number,
  opts: {
    lastReadMessageId: number;
    atBottom?: boolean;
    anchorMessageId?: number | null;
  },
): number {
  const prev = getConversationReadState(userId, conversationId);
  const nextLast = Math.max(
    opts.lastReadMessageId,
    prev?.lastReadMessageId ?? 0,
  );
  saveConversationReadState(userId, conversationId, {
    anchorMessageId: opts.anchorMessageId ?? prev?.anchorMessageId ?? nextLast,
    atBottom: opts.atBottom ?? prev?.atBottom ?? false,
    lastReadMessageId: nextLast > 0 ? nextLast : null,
    lastOpenedAt: Date.now(),
  });
  return nextLast > 0 ? nextLast : opts.lastReadMessageId;
}

export function markConversationOpened(userId: number, conversationId: number) {
  const prev = getConversationReadState(userId, conversationId);
  saveConversationReadState(userId, conversationId, {
    anchorMessageId: prev?.anchorMessageId ?? null,
    atBottom: prev?.atBottom ?? true,
    lastReadMessageId: prev?.lastReadMessageId ?? null,
    lastOpenedAt: Date.now(),
  });
}

/**
 * First open of a channel with no local read state: pin to newest and treat
 * the current window as already read (no historical "New" separator).
 */
export function ensureFirstOpenReadBaseline(
  userId: number,
  conversationId: number,
  newestMessageId: number | null,
) {
  if (!userId || !conversationId || newestMessageId == null) return;
  const prev = getConversationReadState(userId, conversationId);
  if (prev?.lastReadMessageId != null) return;
  saveConversationReadState(userId, conversationId, {
    anchorMessageId: newestMessageId,
    atBottom: true,
    lastReadMessageId: newestMessageId,
    lastOpenedAt: Date.now(),
  });
}

/** True when the stored cursor is at/ past the newest known message. */
export function isConversationCaughtUp(
  lastReadMessageId: number | null | undefined,
  newestMessageId: number | null | undefined,
): boolean {
  if (newestMessageId == null || newestMessageId <= 0) return true;
  if (lastReadMessageId == null || lastReadMessageId <= 0) return false;
  return lastReadMessageId >= newestMessageId;
}
