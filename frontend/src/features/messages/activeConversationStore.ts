/**
 * Lightweight persistence for the last active Messages conversation.
 * Survives page navigation (with keep-alive) and full browser refresh.
 * Does not store message history — only IDs and composer draft metadata.
 */

export type ActiveConversationSelection = {
  conversationId: number;
  type: "channel" | "dm";
  listFilter?: "all" | "channel" | "dm" | "dm-requests";
};

export type ConversationDraft = {
  text: string;
  replyTo?: { id: number; user: string; msg: string } | null;
};

function selectionKey(userId: number) {
  return `ninja-era-active-conv-v1-${userId}`;
}

function draftsKey(userId: number) {
  return `ninja-era-msg-drafts-v1-${userId}`;
}

export function getActiveConversation(userId: number): ActiveConversationSelection | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(selectionKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveConversationSelection;
    if (!parsed?.conversationId || parsed.conversationId <= 0) return null;
    if (parsed.type !== "channel" && parsed.type !== "dm") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setActiveConversation(userId: number, selection: ActiveConversationSelection) {
  if (!userId || !selection.conversationId) return;
  try {
    localStorage.setItem(selectionKey(userId), JSON.stringify(selection));
  } catch {
    /* quota / private mode */
  }
}

export function clearActiveConversation(userId: number) {
  if (!userId) return;
  try {
    localStorage.removeItem(selectionKey(userId));
  } catch {
    /* ignore */
  }
}

function readDrafts(userId: number): Record<string, ConversationDraft> {
  if (!userId) return {};
  try {
    const raw = localStorage.getItem(draftsKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, ConversationDraft>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeDrafts(userId: number, drafts: Record<string, ConversationDraft>) {
  if (!userId) return;
  try {
    localStorage.setItem(draftsKey(userId), JSON.stringify(drafts));
  } catch {
    /* ignore */
  }
}

export function getConversationDraft(userId: number, conversationId: number): ConversationDraft | null {
  if (!userId || !conversationId) return null;
  return readDrafts(userId)[String(conversationId)] ?? null;
}

export function setConversationDraft(
  userId: number,
  conversationId: number,
  draft: ConversationDraft,
) {
  if (!userId || !conversationId) return;
  const drafts = readDrafts(userId);
  const text = draft.text ?? "";
  const replyTo = draft.replyTo ?? null;
  if (!text.trim() && !replyTo) {
    delete drafts[String(conversationId)];
  } else {
    drafts[String(conversationId)] = { text, replyTo };
  }
  writeDrafts(userId, drafts);
}

export function clearConversationDraft(userId: number, conversationId: number) {
  if (!userId || !conversationId) return;
  const drafts = readDrafts(userId);
  delete drafts[String(conversationId)];
  writeDrafts(userId, drafts);
}

export function clearAllConversationDrafts(userId: number) {
  if (!userId) return;
  try {
    localStorage.removeItem(draftsKey(userId));
  } catch {
    /* ignore */
  }
}
