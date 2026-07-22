import { useState, useRef, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import SearchIcon from "@mui/icons-material/Search";
import SendIcon from "@mui/icons-material/Send";
import EmojiEmotionsIcon from "@mui/icons-material/EmojiEmotions";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import MenuIcon from "@mui/icons-material/Menu";
import CloseIcon from "@mui/icons-material/Close";
import ReplyIcon from "@mui/icons-material/Reply";
import SettingsIcon from "@mui/icons-material/Settings";
import TagIcon from "@mui/icons-material/Tag";
import ChatBubbleIcon from "@mui/icons-material/ChatBubble";
import GroupsIcon from "@mui/icons-material/Groups";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import BlockIcon from "@mui/icons-material/Block";
import FlagIcon from "@mui/icons-material/Flag";
import DeleteIcon from "@mui/icons-material/Delete";
import PersonIcon from "@mui/icons-material/Person";
import LogoutIcon from "@mui/icons-material/Logout";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import InboxIcon from "@mui/icons-material/Inbox";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import CheckIcon from "@mui/icons-material/Check";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import CircularProgress from "@mui/material/CircularProgress";
import Badge from "@mui/material/Badge";
import CallIcon from "@mui/icons-material/Call";
import VideocamIcon from "@mui/icons-material/Videocam";
import { toast } from "sonner";
import { VoiceRecorderButton } from "@/features/messages/VoiceRecorder";
import { useCallOptional } from "@/features/calling/CallProvider";
import { CALL_DENIED_MESSAGE, CALL_OFFLINE_MESSAGE, canPlaceCall, canCallPeer } from "@/features/calling/permissions";
import { MediaPreviewLine } from "@/features/messages/MediaPreviewLine";
import type { GifItem } from "@/features/messages/emojiData";
import {
  Page, AppSettings, Contact, useC, useWide, SH1, FilledBtn, OutlinedBtn, Field, ChatAvatar, BADGE_BG,
} from "@/app/shared";
import { api, ApiError, type ApiMessage } from "@/app/api";
import { isMessageFileWithinLimit, MESSAGE_MAX_FILE_ERROR, MESSAGE_MAX_FILE_LABEL } from "@/shared/messageUpload";
import { imageFileFromClipboard } from "@/features/messages/utils/clipboardImage";
import { formatBytes } from "@/features/messages/utils/formatBytes";
import { onRealtimeEvent, emitTyping, joinConversation } from "@/app/realtime";
import {
  getConversationReadState,
  saveConversationReadState,
} from "@/features/messages/conversationState";
import {
  getActiveConversation,
  setActiveConversation,
  clearActiveConversation,
  getStoredListFilter,
  setStoredListFilter,
  getConversationDraft,
  setConversationDraft,
  clearConversationDraft,
} from "@/features/messages/activeConversationStore";
import { messageCache } from "@/features/messages/messageCache";
import { msgPerf } from "@/features/messages/msgPerf";
import { useMessageThread } from "@/features/messages/useMessageThread";
import { nextTempMessageId, toChatMsg, type ChatMsg } from "@/features/messages/types";
import { STATUS_COLORS, COMPOSER_MAX_HEIGHT, type ListFilter } from "@/features/messages/constants";
import { useScrollReveal } from "@/features/messages/hooks/useScrollReveal";
import { ConversationDetailsBody } from "@/features/messages/components/ConversationDetailsBody";
import { ImageLightbox } from "@/features/messages/components/ImageLightbox";
import { MessageRow } from "@/features/messages/components/MessageRow";
import { TypingIndicatorStrip } from "@/features/messages/components/TypingIndicatorStrip";
import { ProfileStatusBadge, type PresenceStatus } from "@/features/messages/components/ProfileStatusBadge";
import { BrandLogo } from "@/shared/BrandLogo";
import { BRAND_NAME } from "@/shared/branding";

const EmojiGifPicker = lazy(() =>
  import("@/features/messages/EmojiGifPicker").then((m) => ({ default: m.EmojiGifPicker })),
);

function MessagesPage({ settings, showEmailToast, showPushNotif, contacts, setContacts, onUnreadChange, onConversationsRefresh, currentUserId, currentUser, onUserUpdate, initialConversationId, dmRequestsIntent, onDmRequestsIntentHandled, focusInput, onFocusHandled, onInitialConversationHandled, isActive = true, desktopMode = false, onDesktopOpenSettings, onDesktopLogout, realtimeEpoch = 0 }: {
  settings: AppSettings;
  showEmailToast: (title:string, body:string, page:Page)=>void;
  showPushNotif: (title:string, body:string, page:Page)=>void;
  contacts: Contact[];
  setContacts: React.Dispatch<React.SetStateAction<Contact[]>>;
  onUnreadChange?: (n: number) => void;
  /** Shared App-level coalesced conversation refresh (avoids duplicate list fetches). */
  onConversationsRefresh?: (opts?: {
    immediate?: boolean;
    recoveryFilter?: "All" | "Channels" | "DMs";
  }) => void;
  currentUserId: number;
  currentUser?: import("@/app/api").ApiUser | null;
  onUserUpdate?: (u: import("@/app/api").ApiUser) => void;
  initialConversationId?: number | null;
  /** Notification deep-link into the DM Requests view; `nonce` re-triggers on repeat clicks. */
  dmRequestsIntent?: { requestId?: number; nonce: number } | null;
  onDmRequestsIntentHandled?: () => void;
  focusInput?: boolean;
  onFocusHandled?: () => void;
  onInitialConversationHandled?: () => void;
  /** False while Messages is keep-alive-hidden on another route — pause read receipts. */
  isActive?: boolean;
  /** Electron desktop shell: integrates account controls into the sidebar and reclaims the right column. */
  desktopMode?: boolean;
  /** Desktop-only: open the comprehensive desktop settings dialog (owned by the shell). */
  onDesktopOpenSettings?: () => void;
  /** Desktop-only: sign the user out via the shell. */
  onDesktopLogout?: () => void;
  /** Bumped after realtime reconnect so the open thread re-syncs missed messages. */
  realtimeEpoch?: number;
}) {
  const C = useC();
  const callApi = useCallOptional();
  const isMobile = !useWide(767);
  /** Electron: show the conversation details rail above this width (tablet and below hide it). */
  const showDesktopRightRail = useWide(1100);
  const isDarkTheme = C.bg === "#141218";
  const onScrollReveal = useScrollReveal();
  const virtuosoScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emptyContact: Contact = { id: 0, name: "Select a conversation", msg: "", time: "", unread: 0, online: false, bio: "", type: "dm" };
  const storedActive = currentUserId ? getActiveConversation(currentUserId) : null;
  const [sel, setSel] = useState<Contact>(() => {
    const preferredId = initialConversationId || storedActive?.conversationId;
    if (preferredId) {
      const found = contacts.find(c => c.id === preferredId);
      if (found) return found;
    }
    // Desktop opens on the welcome screen (Telegram-style) rather than auto-selecting a channel.
    if (desktopMode) return emptyContact;
    return contacts.find(c => c.type === "channel") ?? contacts[0] ?? emptyContact;
  });
  const initialDraft = currentUserId && sel.id > 0 ? getConversationDraft(currentUserId, sel.id) : null;
  const [input, setInput] = useState(initialDraft?.text ?? "");
  const [showSidebar, setShowSidebar] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsContact, setDetailsContact] = useState<Contact | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [myStatus, setMyStatus] = useState(currentUser?.status || "Online");
  const [myBio, setMyBio] = useState(currentUser?.bio || "");
  const [myMood, setMyMood] = useState(currentUser?.mood || "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarFileRef = useRef<HTMLInputElement>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMsg|null>(() => {
    const r = initialDraft?.replyTo;
    if (!r?.id) return null;
    return { id: r.id, user: r.user, msg: r.msg, self: false, time: "", userId: 0 } as ChatMsg;
  });
  const [editingId, setEditingId] = useState<number|null>(null);
  const [editText, setEditText] = useState("");
  /** Which message's reaction picker is open (only one at a time). */
  const [openReactionId, setOpenReactionId] = useState<number|null>(null);
  const [headerMenu, setHeaderMenu] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{x:number;y:number;contact:Contact}|null>(null);
  const [confirm, setConfirm] = useState<{title:string;body:string;onOk:()=>void}|null>(null);
  const [lightbox, setLightbox] = useState<string|null>(null);
  const [listFilter, setListFilter] = useState<ListFilter>(
    () => getStoredListFilter(currentUserId) ?? "all",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composerTextRef = useRef(input);
  const replyingToRef = useRef(replyingTo);
  const isActiveRef = useRef(isActive);
  /** External jump (addDM) applied once — never re-forces the sidebar filter afterward. */
  const handledJumpIdRef = useRef<number | null>(null);
  composerTextRef.current = input;
  replyingToRef.current = replyingTo;
  isActiveRef.current = isActive;
  const [newDmOpen, setNewDmOpen] = useState(false);
  const [newDmUsername, setNewDmUsername] = useState("");
  const [newDmError, setNewDmError] = useState("");
  const [newDmLoading, setNewDmLoading] = useState(false);
  const [dmRequests, setDmRequests] = useState<{ id: number; requesterId: number; requesterName: string; requesterAvatar?: string | null; requesterDisplayName?: string; time: string }[]>([]);
  const [acceptingRequestId, setAcceptingRequestId] = useState<number | null>(null);
  const [rejectingRequestId, setRejectingRequestId] = useState<number | null>(null);
  const [highlightedRequestId, setHighlightedRequestId] = useState<number | null>(null);
  const dmRequestRowRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [typingUsers, setTypingUsers] = useState<{ userId: number; username: string }[]>([]);
  const [pendingPaste, setPendingPaste] = useState<{ file: File; previewUrl: string } | null>(null);
  const [uploadingPaste, setUploadingPaste] = useState(false);
  const pendingPasteRef = useRef<{ file: File; previewUrl: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const emojiBtnRef = useRef<HTMLButtonElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const [emojiPickerPos, setEmojiPickerPos] = useState<{ right: number; bottom: number }>({ right: 20, bottom: 72 });
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const msgRefs = useRef<Map<number,HTMLDivElement>>(new Map());
  const selIdRef = useRef(sel.id);
  const refreshContactsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markReadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMarkedReadRef = useRef<number | null>(null);
  /** Prevents Virtuoso content-growth from clearing pin before followOutput settles. */
  const unpinGraceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshContacts = useCallback(() => {
    // Prefer shared App coalescer when available so Messages + shell share one fetch.
    if (onConversationsRefresh) {
      onConversationsRefresh();
      return;
    }
    if (refreshContactsTimer.current) clearTimeout(refreshContactsTimer.current);
    refreshContactsTimer.current = setTimeout(() => {
      refreshContactsTimer.current = null;
      api.messages.conversations()
        .then(r => {
          setContacts(r.conversations as Contact[]);
          onUnreadChange?.(r.conversations.filter(c => c.type === "dm").reduce((sum, c) => sum + c.unread, 0));
        })
        .catch(() => {});
    }, 350);
  }, [setContacts, onUnreadChange, onConversationsRefresh]);

  /** Coalesce read receipts — avoid hammering /read while pinned to bottom under traffic. */
  const scheduleMarkRead = useCallback((conversationId: number) => {
    if (!conversationId) return;
    if (lastMarkedReadRef.current === conversationId && markReadTimer.current) return;
    if (markReadTimer.current) clearTimeout(markReadTimer.current);
    markReadTimer.current = setTimeout(() => {
      markReadTimer.current = null;
      lastMarkedReadRef.current = conversationId;
      api.messages.markRead(conversationId).then(() => refreshContacts()).catch(() => {});
    }, 500);
  }, [refreshContacts]);

  const thread = useMessageThread({
    conversationId: sel.id,
    currentUserId,
    expectedUnread: sel.unread,
    onContactsRefresh: refreshContacts,
  });

  const {
    msgs, setMsgs, msgsRef,
    hasMoreOlder, hasMoreNewer, hasMoreNewerRef, loadingOlder, loadingNewer,
    threadReady, threadBootId, initialScrollIndex,
    lastReadMessageId, lastReadMessageIdRef, markCaughtUpTo,
    firstItemIndex, firstItemIndexRef,
    showJumpBtn, setShowJumpBtn,
    unreadBelow, setUnreadBelow,
    isNearBottomRef, pinToBottomRef, visibleStartDataIndexRef, suppressMarkReadUntilRef, markReadTimerRef,
    loadOlderMessages, loadNewerMessages,
    applyNewMessage, applyUpdatedMessage, applyDeletedMessage, applyReaction,
    jumpToLatest, appendLocal, replaceOptimistic, markLocalFailed, removeLocal, updateLocal,
    syncAfterReconnect,
  } = thread;

  useEffect(() => { selIdRef.current = sel.id; }, [sel.id]);

  // After socket reconnect: re-join + fetch missed messages for the open thread.
  useEffect(() => {
    if (!realtimeEpoch || sel.id <= 0) return;
    void syncAfterReconnect();
  }, [realtimeEpoch, sel.id, syncAfterReconnect]);

  // When the live edge arrives after the user was already at the bottom of a
  // historical window, atBottomStateChange does not re-fire — catch up here.
  useEffect(() => {
    if (!threadReady || hasMoreNewer || !sel.id) return;
    if (!isNearBottomRef.current) return;
    if (Date.now() < suppressMarkReadUntilRef.current) return;
    const newest = [...msgsRef.current].reverse().find(m => m.id > 0)?.id
      ?? msgsRef.current[msgsRef.current.length - 1]?.id
      ?? null;
    if (newest == null) return;
    if (lastReadMessageIdRef.current != null && lastReadMessageIdRef.current >= newest) return;
    markCaughtUpTo(newest, { atBottom: true });
    scheduleMarkRead(sel.id);
  }, [
    threadReady, hasMoreNewer, sel.id, msgs.length,
    markCaughtUpTo, scheduleMarkRead, isNearBottomRef, suppressMarkReadUntilRef,
    msgsRef, lastReadMessageIdRef,
  ]);

  const clearPendingPaste = useCallback(() => {
    setPendingPaste(prev => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
    pendingPasteRef.current = null;
  }, []);

  const stagePasteImage = useCallback((file: File) => {
    if (!isMessageFileWithinLimit(file)) {
      toast.error(MESSAGE_MAX_FILE_ERROR);
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    setPendingPaste(prev => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      const next = { file, previewUrl };
      pendingPasteRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    clearPendingPaste();
    setUploadingPaste(false);
  }, [sel.id, clearPendingPaste]);

  useEffect(() => () => {
    const staged = pendingPasteRef.current;
    if (staged?.previewUrl) URL.revokeObjectURL(staged.previewUrl);
  }, []);

  useEffect(() => {
    if (currentUser) {
      setMyStatus(currentUser.status || "Online");
      setMyBio(currentUser.bio || "");
      setMyMood(currentUser.mood || "");
    }
  }, [currentUser]);

  const adjustComposerHeight = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
  }, []);

  const forceScrollToBottom = useCallback((behavior: "auto" | "smooth" = "auto") => {
    pinToBottomRef.current = true;
    isNearBottomRef.current = true;
    setShowJumpBtn(false);
    setUnreadBelow(0);
    const run = () => {
      virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior });
    };
    // Wait for React commit + Virtuoso measure (variable-height rows / media).
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        run();
        requestAnimationFrame(run);
      });
    });
  }, [pinToBottomRef, isNearBottomRef, setShowJumpBtn, setUnreadBelow]);

  /**
   * Open-at-bottom: exactly one positioning pass after Virtuoso mounts.
   * Media uses reserved boxes so later decode does not shift the viewport.
   * Unread / mid-thread opens (pinBottom=false) are left alone.
   */
  const initialOpenScrollDoneRef = useRef(false);
  const suppressFollowOutputRef = useRef(false);

  useEffect(() => {
    initialOpenScrollDoneRef.current = false;
    suppressFollowOutputRef.current = false;
  }, [threadBootId]);

  useEffect(() => {
    if (!threadReady || msgs.length === 0) return;
    if (!pinToBottomRef.current) return;
    if (initialOpenScrollDoneRef.current) return;

    suppressFollowOutputRef.current = true;
    let cancelled = false;
    let frames = 0;

    const settle = () => {
      if (cancelled) return;
      frames += 1;
      // Two frames for commit/measure, then one final align.
      if (frames < 2) {
        requestAnimationFrame(settle);
        return;
      }
      if (!pinToBottomRef.current) {
        suppressFollowOutputRef.current = false;
        return;
      }
      initialOpenScrollDoneRef.current = true;
      virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "auto" });
      // Re-enable followOutput on the next frame so live messages still auto-follow.
      requestAnimationFrame(() => {
        if (!cancelled) suppressFollowOutputRef.current = false;
      });
    };

    requestAnimationFrame(settle);
    return () => {
      cancelled = true;
      suppressFollowOutputRef.current = false;
    };
  }, [threadReady, threadBootId, msgs.length, pinToBottomRef]);

  const persistConversation = useCallback((conversationId: number) => {
    const list = msgsRef.current;
    if (!conversationId || !list.length || !currentUserId) return;
    const atBottom = isNearBottomRef.current && !hasMoreNewerRef.current;
    const start = Math.max(0, Math.min(list.length - 1, visibleStartDataIndexRef.current));
    const anchor = list[start]?.id ?? list[list.length - 1].id;
    const newest = [...list].reverse().find(m => m.id > 0)?.id ?? list[list.length - 1].id;
    // Never move the read cursor backwards when leaving a conversation.
    const cursor = Math.max(
      lastReadMessageIdRef.current ?? 0,
      getConversationReadState(currentUserId, conversationId)?.lastReadMessageId ?? 0,
      atBottom ? newest : 0,
    );
    saveConversationReadState(currentUserId, conversationId, {
      anchorMessageId: atBottom ? newest : anchor,
      atBottom,
      lastReadMessageId: cursor > 0 ? cursor : null,
      lastOpenedAt: Date.now(),
    });
  }, [currentUserId, msgsRef, isNearBottomRef, visibleStartDataIndexRef, hasMoreNewerRef, lastReadMessageIdRef]);

  useEffect(() => {
    const convId = sel.id;
    return () => { if (convId) persistConversation(convId); };
  }, [sel.id, persistConversation]);

  const persistComposerDraft = useCallback((conversationId: number) => {
    if (!currentUserId || !conversationId) return;
    const reply = replyingToRef.current;
    setConversationDraft(currentUserId, conversationId, {
      text: composerTextRef.current,
      replyTo: reply ? { id: reply.id, user: reply.user, msg: reply.msg } : null,
    });
  }, [currentUserId]);

  const loadComposerDraft = useCallback((conversationId: number) => {
    if (!currentUserId || !conversationId) {
      setInput("");
      setReplyingTo(null);
      return;
    }
    const draft = getConversationDraft(currentUserId, conversationId);
    setInput(draft?.text ?? "");
    if (draft?.replyTo?.id) {
      setReplyingTo({
        id: draft.replyTo.id,
        user: draft.replyTo.user,
        msg: draft.replyTo.msg,
        self: false,
        time: "",
        userId: 0,
      } as ChatMsg);
    } else {
      setReplyingTo(null);
    }
  }, [currentUserId]);

  /** Persist conversation ID only — never touches sidebar filter state. */
  const rememberActiveConversation = useCallback((contact: Contact) => {
    if (!currentUserId || contact.id <= 0) return;
    setActiveConversation(currentUserId, {
      conversationId: contact.id,
      type: contact.type,
    });
  }, [currentUserId]);

  const selectListFilter = useCallback((next: ListFilter) => {
    setListFilter(next);
    if (currentUserId) setStoredListFilter(currentUserId, next);

    // Desktop-only: recover when BOTH channel and DM lists are locally empty.
    // Do not refresh merely because the active filter subsection is empty
    // (e.g. Channels exist but DMs do not).
    if (!desktopMode) return;
    if (next !== "all" && next !== "channel" && next !== "dm") return;

    const active = contacts.filter((c) => !(c.type === "dm" && c.isDeleted));
    const channelCount = active.filter((c) => c.type === "channel").length;
    const dmCount = active.filter((c) => c.type === "dm").length;
    if (channelCount > 0 || dmCount > 0) return;

    const recoveryFilter = next === "channel" ? "Channels" : next === "dm" ? "DMs" : "All";
    if (onConversationsRefresh) {
      onConversationsRefresh({ immediate: true, recoveryFilter });
    } else {
      // Fallback path (should not hit on desktop shell) — still guard against floods.
      refreshContacts();
    }
  }, [currentUserId, desktopMode, contacts, onConversationsRefresh, refreshContacts]);

  // External navigation into a conversation (e.g. Teamwork → Message). One-shot only.
  useEffect(() => {
    if (!initialConversationId) {
      handledJumpIdRef.current = null;
      return;
    }
    if (handledJumpIdRef.current === initialConversationId) {
      onInitialConversationHandled?.();
      return;
    }
    const target = contacts.find(c => c.id === initialConversationId);
    if (!target) return;

    handledJumpIdRef.current = initialConversationId;
    if (sel.id !== target.id) {
      persistComposerDraft(sel.id);
      setSel(target);
      loadComposerDraft(target.id);
      rememberActiveConversation(target);
    }
    // Prefer showing the conversation's section for intentional external jumps only.
    const jumpFilter: ListFilter = target.type === "dm" ? "dm" : "all";
    selectListFilter(jumpFilter);
    if (isMobile) setShowSidebar(false);
    onInitialConversationHandled?.();
  }, [initialConversationId, contacts, onInitialConversationHandled, isMobile, sel.id, persistComposerDraft, loadComposerDraft, rememberActiveConversation, selectListFilter]);

  useEffect(() => {
    if (focusInput) {
      setTimeout(() => { inputRef.current?.focus(); onFocusHandled?.(); }, 100);
    }
  }, [focusInput, sel.id, onFocusHandled]);

  /** Reply icon → activate quote + focus composer (DM + channel, web + desktop). */
  const startReply = useCallback((m: ChatMsg) => {
    setReplyingTo(m);
    const focusComposer = () => {
      // Do not steal focus from overlays / other inputs.
      if (settingsOpen || newDmOpen || confirm || lightbox || detailsOpen || emojiOpen || voiceBusy) return;
      const el = inputRef.current;
      if (!el || el.disabled) return;
      el.focus({ preventScroll: true });
      const len = el.value.length;
      try {
        el.setSelectionRange(len, len);
      } catch {
        /* some browsers reject selection on empty/unfocused */
      }
    };
    // Wait for reply bar commit so layout is stable before focusing.
    requestAnimationFrame(() => {
      setTimeout(focusComposer, 0);
    });
  }, [settingsOpen, newDmOpen, confirm, lightbox, detailsOpen, emojiOpen, voiceBusy]);

  useEffect(() => {
    // Empty list usually means "still loading" — do not wipe the active selection.
    if (!contacts.length) return;

    const updated = contacts.find(c => c.id === sel.id);
    if (updated) {
      if (
        updated.avatarUrl !== sel.avatarUrl
        || updated.name !== sel.name
        || updated.bio !== sel.bio
        || updated.mood !== sel.mood
        || updated.msg !== sel.msg
        || updated.unread !== sel.unread
        || updated.muted !== sel.muted
        || updated.sortOrder !== sel.sortOrder
        || updated.blockedByMe !== sel.blockedByMe
        || updated.isBlocked !== sel.isBlocked
      ) {
        setSel(updated);
        setDetailsContact(prev => (prev && prev.id === updated.id ? updated : prev));
      }
      rememberActiveConversation(updated);
      return;
    }

    // Current selection gone — try App jump target, then persisted ID, then safe fallback.
    const stored = getActiveConversation(currentUserId);
    const preferredId = initialConversationId || stored?.conversationId;
    const preferred = preferredId ? contacts.find(c => c.id === preferredId) : null;
    if (preferred) {
      setSel(preferred);
      loadComposerDraft(preferred.id);
      rememberActiveConversation(preferred);
      return;
    }
    if (stored && !contacts.some(c => c.id === stored.conversationId)) {
      clearActiveConversation(currentUserId);
    }
    // Desktop: no forced auto-selection — return to the welcome screen when nothing is active.
    if (desktopMode) {
      if (sel.id !== 0) setSel(emptyContact);
      return;
    }
    const fallback = contacts.find(c => c.type === "channel") ?? contacts[0];
    setSel(fallback);
    loadComposerDraft(fallback.id);
    rememberActiveConversation(fallback);
  }, [contacts, sel.id, sel.avatarUrl, sel.name, sel.bio, sel.msg, sel.unread, sel.muted, sel.sortOrder, currentUserId, initialConversationId, loadComposerDraft, rememberActiveConversation, desktopMode]);

  // Persist composer draft while typing (debounced).
  useEffect(() => {
    if (!currentUserId || sel.id <= 0) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      draftTimerRef.current = null;
      persistComposerDraft(sel.id);
    }, 250);
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [input, replyingTo, sel.id, currentUserId, persistComposerDraft]);

  // Persist conversation ID when selection changes (filter is persisted separately).
  useEffect(() => {
    if (sel.id > 0) rememberActiveConversation(sel);
  }, [sel, rememberActiveConversation]);

  // Returning to Messages after keep-alive: if unread arrived while away, jump to the NEW boundary.
  useEffect(() => {
    if (!isActive || sel.id <= 0) return;
    const lastRead = lastReadMessageIdRef.current;
    const list = msgsRef.current;
    if (!list.length || lastRead == null) return;
    const firstUnreadIdx = list.findIndex(m => m.id > 0 && m.id > lastRead);
    if (firstUnreadIdx < 0) return;
    pinToBottomRef.current = false;
    isNearBottomRef.current = false;
    setShowJumpBtn(true);
    requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({
        index: firstItemIndexRef.current + firstUnreadIdx,
        align: "start",
        behavior: "auto",
      });
    });
  }, [isActive, sel.id, lastReadMessageIdRef, msgsRef, pinToBottomRef, isNearBottomRef, firstItemIndexRef, setShowJumpBtn]);

  const loadDmRequests = () => {
    api.dm.listRequests()
      .then(r => setDmRequests(r.incoming))
      .catch(() => setDmRequests([]));
  };

  useEffect(() => { loadDmRequests(); }, []);

  useEffect(() => {
    if (dmRequests.length === 0 && listFilter === "dm-requests") selectListFilter("all");
  }, [dmRequests.length, listFilter, selectListFilter]);

  // Notification deep-link → open the DM Requests view and highlight the target request.
  useEffect(() => {
    if (!dmRequestsIntent) return;
    selectListFilter("dm-requests");
    loadDmRequests();
    if (typeof dmRequestsIntent.requestId === "number") {
      setHighlightedRequestId(dmRequestsIntent.requestId);
    }
    onDmRequestsIntentHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dmRequestsIntent?.nonce]);

  // Scroll the highlighted request into view, then fade the highlight.
  useEffect(() => {
    if (highlightedRequestId == null) return;
    const el = dmRequestRowRefs.current.get(highlightedRequestId);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const t = setTimeout(() => setHighlightedRequestId(null), 2600);
    return () => clearTimeout(t);
  }, [highlightedRequestId, dmRequests]);

  useEffect(() => {
    const unsubs = [
      onRealtimeEvent<{ conversationId: number; message: ApiMessage }>("message:new", ({ conversationId, message }) => {
        if (Number(conversationId) === Number(selIdRef.current)) {
          applyNewMessage(message);
          const isSelf = Number(message.userId) === Number(currentUserId);
          // While Messages is hidden (keep-alive on another page), do not auto-read
          // or scroll — returning should use unread positioning if needed.
          if (!isActiveRef.current) {
            if (!isSelf) {
              setUnreadBelow(n => n + 1);
              setShowJumpBtn(true);
              pinToBottomRef.current = false;
              isNearBottomRef.current = false;
            }
          } else if (isSelf || pinToBottomRef.current || isNearBottomRef.current) {
            pinToBottomRef.current = true;
            isNearBottomRef.current = true;
            forceScrollToBottom("auto");
            if (!isSelf) {
              scheduleMarkRead(conversationId);
              markCaughtUpTo(message.id, { atBottom: true });
            } else if (message.id > 0) {
              markCaughtUpTo(message.id, { atBottom: true });
            }
          } else if (!isSelf) {
            setUnreadBelow(n => n + 1);
            setShowJumpBtn(true);
          }
        } else {
          // Keep non-active threads warm so switching/reopening shows new msgs instantly.
          messageCache.upsertMessage(conversationId, toChatMsg(message, currentUserId));
        }
        refreshContacts();
      }),
      onRealtimeEvent<{ conversationId: number; message: ApiMessage }>("message:updated", ({ conversationId, message }) => {
        if (Number(conversationId) === Number(selIdRef.current)) applyUpdatedMessage(message);
        else messageCache.upsertMessage(conversationId, toChatMsg(message, currentUserId));
      }),
      onRealtimeEvent<{ conversationId: number; messageId: number }>("message:deleted", ({ conversationId, messageId }) => {
        if (Number(conversationId) === Number(selIdRef.current)) applyDeletedMessage(messageId);
        else messageCache.removeMessage(conversationId, messageId);
        refreshContacts();
      }),
      onRealtimeEvent<{ conversationId: number; messageId: number; reactions: Record<string, string[]> }>("message:reaction", ({ conversationId, messageId, reactions }) => {
        if (Number(conversationId) === Number(selIdRef.current)) applyReaction(messageId, reactions);
        else messageCache.patchMessage(conversationId, messageId, { reactions });
      }),
      // conversation:update is owned by App shell — avoid a second list fetch here
      onRealtimeEvent<{ conversationId: number }>("conversation:new", ({ conversationId }) => {
        joinConversation(conversationId);
        refreshContacts();
      }),
      onRealtimeEvent<{ conversationId: number }>("conversation:restored", ({ conversationId }) => {
        joinConversation(conversationId);
        refreshContacts();
      }),
      onRealtimeEvent<{ conversationId: number }>("conversation:hidden", ({ conversationId }) => {
        setContacts(prev => prev.filter(c => c.id !== conversationId));
        if (selIdRef.current === conversationId) {
          setSel(emptyContact);
        }
        refreshContacts();
      }),
      onRealtimeEvent<{
        peerUserId: number;
        blockedByMe: boolean;
        isBlocked: boolean;
      }>("relationship:updated", (data) => {
        if (!data?.peerUserId) return;
        setContacts(prev => {
          let changed = false;
          const next = prev.map(c => {
            if (c.type !== "dm" || c.otherUserId !== data.peerUserId) return c;
            changed = true;
            return { ...c, blockedByMe: data.blockedByMe, isBlocked: data.isBlocked };
          });
          return changed ? next : prev;
        });
        setSel(prev => {
          if (prev.otherUserId !== data.peerUserId) return prev;
          return { ...prev, blockedByMe: data.blockedByMe, isBlocked: data.isBlocked };
        });
      }),
      onRealtimeEvent<{ conversationId: number; userId: number; username: string; typing: boolean }>("typing", ({ conversationId, userId, username, typing }) => {
        if (Number(conversationId) !== Number(selIdRef.current) || Number(userId) === Number(currentUserId)) return;
        setTypingUsers(prev => {
          const filtered = prev.filter(u => u.userId !== userId);
          return typing ? [...filtered, { userId, username }] : filtered;
        });
      }),
      onRealtimeEvent("dm_request:new", () => loadDmRequests()),
      onRealtimeEvent("dm_request:resolved", () => loadDmRequests()),
      onRealtimeEvent("channels:reorder", () => refreshContacts()),
      onRealtimeEvent<{
        requestId: number;
        conversationId: number;
        dm?: { id: number; userId: number; username: string; avatarUrl: string | null };
      }>("dm_request:accepted", ({ requestId, conversationId }) => {
        setDmRequests(prev => prev.filter(r => r.id !== requestId));
        joinConversation(conversationId);
        refreshContacts();
      }),
      onRealtimeEvent<{ userId: number; status: string; online: boolean }>("presence:update", ({ userId, status, online }) => {
        setContacts(prev => {
          let changed = false;
          const next = prev.map(c => {
            if (c.type !== "dm" || c.otherUserId !== userId || c.isDeleted) return c;
            if (c.online === online && c.status === status) return c;
            changed = true;
            return { ...c, online, status };
          });
          return changed ? next : prev;
        });
        setSel(prev => {
          if (prev.otherUserId !== userId || prev.isDeleted) return prev;
          if (prev.online === online && prev.status === status) return prev;
          return { ...prev, online, status };
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
        // Live thread bubbles
        setMsgs(prev => {
          let changed = false;
          const next = prev.map(m => {
            if (m.userId !== data.userId) return m;
            changed = true;
            const isSelf = data.userId === currentUserId || m.self;
            return {
              ...m,
              user: isSelf ? "You" : data.username,
              avatarUrl: data.avatarUrl !== undefined ? data.avatarUrl : m.avatarUrl,
            };
          });
          if (changed) msgsRef.current = next;
          return changed ? next : prev;
        });
        // Selected / details contact card
        setSel(prev => {
          if (prev.otherUserId !== data.userId) return prev;
          return {
            ...prev,
            name: data.username,
            avatarUrl: data.avatarUrl !== undefined ? data.avatarUrl : prev.avatarUrl,
            bio: data.bio !== undefined ? data.bio : prev.bio,
            mood: data.mood !== undefined ? data.mood : prev.mood,
            ...(data.status !== undefined ? { status: data.status } : {}),
          };
        });
        setDetailsContact(prev => {
          if (!prev || prev.otherUserId !== data.userId) return prev;
          return {
            ...prev,
            name: data.username,
            avatarUrl: data.avatarUrl !== undefined ? data.avatarUrl : prev.avatarUrl,
            bio: data.bio !== undefined ? data.bio : prev.bio,
            mood: data.mood !== undefined ? data.mood : prev.mood,
            ...(data.status !== undefined ? { status: data.status } : {}),
          };
        });
        setContacts(prev => {
          let changed = false;
          const next = prev.map(c => {
            if (c.type !== "dm" || c.otherUserId !== data.userId) return c;
            changed = true;
            return {
              ...c,
              name: data.username,
              avatarUrl: data.avatarUrl !== undefined ? data.avatarUrl : c.avatarUrl,
              bio: data.bio !== undefined ? data.bio : c.bio,
              mood: data.mood !== undefined ? data.mood : c.mood,
              ...(data.status !== undefined ? { status: data.status } : {}),
            };
          });
          return changed ? next : prev;
        });
      }),
    ];
    return () => {
      unsubs.forEach(u => u());
      if (refreshContactsTimer.current) clearTimeout(refreshContactsTimer.current);
      if (markReadTimer.current) clearTimeout(markReadTimer.current);
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      if (isTypingRef.current && selIdRef.current) {
        isTypingRef.current = false;
        emitTyping(selIdRef.current, false);
      }
    };
  }, [
    currentUserId, applyNewMessage, applyUpdatedMessage, applyDeletedMessage, applyReaction,
    forceScrollToBottom, refreshContacts, scheduleMarkRead, setContacts, markCaughtUpTo, setUnreadBelow,
    setShowJumpBtn, isNearBottomRef, pinToBottomRef, setMsgs, msgsRef,
  ]);

  useEffect(() => {
    if (!emojiOpen || !emojiBtnRef.current) return;
    const rect = emojiBtnRef.current.getBoundingClientRect();
    const pickerW = 320;
    const margin = 8;
    let right = window.innerWidth - rect.right;
    if (rect.right - pickerW < margin) right = Math.max(margin, window.innerWidth - pickerW - margin);
    setEmojiPickerPos({ right, bottom: window.innerHeight - rect.top + margin });
  }, [emojiOpen]);

  useEffect(() => { setTypingUsers([]); }, [sel.id]);

  const applyPresenceStatus = useCallback(async (next: PresenceStatus) => {
    const prev = myStatus;
    setMyStatus(next);
    try {
      const { user: updated } = await api.users.update({ status: next });
      setMyStatus(updated.status || next);
      onUserUpdate?.(updated);
    } catch {
      setMyStatus(prev);
      toast.error("Failed to update status");
    }
  }, [myStatus, onUserUpdate]);

  const saveMyProfile = async () => {
    setSavingProfile(true);
    try {
      const mood = myMood.trim().slice(0, 128);
      const { user: updated } = await api.users.update({ bio: myBio, mood });
      setMyMood(updated.mood || "");
      if (updated.status) setMyStatus(updated.status);
      onUserUpdate?.(updated);
      if (avatarPreview) {
        URL.revokeObjectURL(avatarPreview);
        setAvatarPreview(null);
      }
      setSettingsOpen(false);
      toast.success("Profile saved");
    } catch {
      toast.error("Failed to save profile");
    } finally {
      setSavingProfile(false);
    }
  };

  const uploadMyAvatar = async (file: File) => {
    if (!file.type.startsWith("image/") || file.type === "image/gif") {
      toast.error("Please choose a JPEG, PNG, or WebP image");
      return;
    }
    const preview = URL.createObjectURL(file);
    setAvatarPreview(preview);
    setAvatarUploading(true);
    try {
      const { avatarUrl } = await api.users.uploadAvatar(file);
      if (currentUser) {
        onUserUpdate?.({ ...currentUser, avatarUrl });
      }
      toast.success("Avatar updated");
      URL.revokeObjectURL(preview);
      setAvatarPreview(null);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to upload avatar");
    } finally {
      setAvatarUploading(false);
      if (avatarFileRef.current) avatarFileRef.current.value = "";
    }
  };

  const presenceColor = (c: Contact) => {
    if (c.type !== "dm") return C.outline;
    return STATUS_COLORS[c.status || (c.online ? "Online" : "Offline")] || C.outline;
  };

  const presenceLabel = (c: Contact) => {
    if (c.type === "channel") return "Channel";
    return c.status || (c.online ? "Online" : "Offline");
  };

  const selectConversation = useCallback((m: Contact) => {
    if (m.id === sel.id) {
      if (isMobile) setShowSidebar(false);
      return;
    }
    persistComposerDraft(sel.id);
    setEditingId(null);
    setEditText("");
    setSel(m);
    loadComposerDraft(m.id);
    rememberActiveConversation(m);
    if (isMobile) setShowSidebar(false);
  }, [isMobile, sel.id, persistComposerDraft, loadComposerDraft, rememberActiveConversation]);

  const openConversationDetails = useCallback(() => {
    if (sel.id <= 0) return;
    // Electron large layout: details already live in the right rail.
    if (desktopMode && showDesktopRightRail) return;
    // Electron tablet/small: open the details modal. Web mobile: same.
    if (desktopMode || isMobile) {
      setDetailsContact(sel);
      setDetailsOpen(true);
    }
  }, [isMobile, desktopMode, showDesktopRightRail, sel]);

  const apiUserToContact = useCallback((user: import("@/app/api").ApiUser, fallback?: Partial<Contact>): Contact => ({
    id: -(user.id || 0),
    name: user.isDeleted ? "Deleted User" : (user.username || "Deleted User"),
    msg: "",
    time: "",
    unread: 0,
    online: !user.isDeleted && (user.status || "Online") === "Online",
    bio: user.isDeleted ? "" : (user.bio || ""),
    mood: user.isDeleted ? "" : (user.mood || ""),
    type: "dm",
    avatarUrl: user.isDeleted ? null : (user.avatarUrl ?? fallback?.avatarUrl),
    otherUserId: user.id,
    isDeleted: !!user.isDeleted,
    status: user.isDeleted ? "Offline" : user.status,
    village: user.isDeleted ? undefined : user.village,
    clan: user.isDeleted ? undefined : user.clan,
    level: user.isDeleted ? undefined : user.level,
    rank: user.isDeleted ? undefined : user.rank,
    memberSince: user.isDeleted ? undefined : user.memberSince,
    isTeamMember: user.isDeleted ? false : user.isTeamMember,
    country: user.isDeleted ? undefined : user.country,
    city: user.isDeleted ? undefined : user.city,
  }), []);

  const openUserProfileFromMessage = useCallback(async (m: ChatMsg) => {
    if (!isMobile || m.self) return;
    if (m.isDeleted) {
      setDetailsContact({
        id: -(m.userId || 0),
        name: "Deleted User",
        msg: "",
        time: "",
        unread: 0,
        online: false,
        bio: "This account is no longer available.",
        type: "dm",
        avatarUrl: null,
        otherUserId: m.userId,
        isDeleted: true,
        status: "Offline",
      });
      setDetailsOpen(true);
      return;
    }
    const userId = m.userId;
    if (!userId) {
      // Fall back to conversation peer only for DMs when metadata lacks userId
      if (sel.type === "dm" && sel.id > 0) {
        setDetailsContact(sel);
        setDetailsOpen(true);
      }
      return;
    }
    const existing = contacts.find(c => c.type === "dm" && c.otherUserId === userId);
    if (existing) {
      setDetailsContact(existing);
      setDetailsOpen(true);
      return;
    }
    const provisional: Contact = {
      id: -userId,
      name: m.user || "Deleted User",
      msg: "",
      time: "",
      unread: 0,
      online: false,
      bio: "",
      type: "dm",
      avatarUrl: m.avatarUrl,
      otherUserId: userId,
      isDeleted: !!m.isDeleted,
    };
    setDetailsContact(provisional);
    setDetailsOpen(true);
    try {
      const { user } = await api.users.get(userId);
      setDetailsContact(apiUserToContact(user, { avatarUrl: m.avatarUrl }));
    } catch {
      /* keep provisional profile from message metadata */
    }
  }, [isMobile, sel, contacts, apiUserToContact]);

  const dismissConversationDetails = useCallback(() => {
    if (typeof window !== "undefined" && window.history.state && (window.history.state as { msgDetails?: boolean }).msgDetails) {
      window.history.back();
    } else {
      setDetailsOpen(false);
      setDetailsContact(null);
    }
  }, []);

  useEffect(() => {
    if (!detailsOpen) return;
    window.history.pushState({ ...(window.history.state || {}), msgDetails: true }, "");
    const onPop = () => {
      setDetailsOpen(false);
      setDetailsContact(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [detailsOpen]);

  // Electron: when the window grows wide enough for the details rail, close any open modal.
  useEffect(() => {
    if (!desktopMode || !showDesktopRightRail || !detailsOpen) return;
    setDetailsOpen(false);
    setDetailsContact(null);
  }, [desktopMode, showDesktopRightRail, detailsOpen]);

  const showLeftPanel = isMobile ? showSidebar : true;
  const showConversationList = showSidebar;
  const showChatPane = !isMobile || !showSidebar;

  const handleInputChange = (value: string) => {
    setInput(value);
    if (!sel?.id) return;
    if (!isTypingRef.current && value.trim()) {
      isTypingRef.current = true;
      emitTyping(sel.id, true);
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      if (isTypingRef.current) {
        isTypingRef.current = false;
        emitTyping(sel.id, false);
      }
    }, 2000);
  };

  const typingLabel = useMemo(() => {
    if (!typingUsers.length) return null;
    if (sel.type === "dm") return `${typingUsers[0].username} is typing...`;
    if (typingUsers.length === 1) return `${typingUsers[0].username} is typing...`;
    if (typingUsers.length === 2) {
      return `${typingUsers[0].username} and ${typingUsers[1].username} are typing...`;
    }
    return "Several users are typing...";
  }, [typingUsers, sel.type]);

  const nowTime = () => new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
  const closeAll = () => { setEmojiOpen(false); setHeaderMenu(false); setCtxMenu(null); setAccountMenuOpen(false); setOpenReactionId(null); };

  // Switching conversations dismisses any open reaction picker.
  useEffect(() => { setOpenReactionId(null); }, [sel.id]);

  const askConfirm = (title:string, body:string, onOk:()=>void) => setConfirm({ title, body, onOk });

  useEffect(() => {
    if (!confirm && !(desktopMode && settingsOpen) && !(desktopMode && newDmOpen)) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (confirm) setConfirm(null);
      else if (desktopMode && newDmOpen) setNewDmOpen(false);
      else if (desktopMode && settingsOpen) setSettingsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm, desktopMode, settingsOpen, newDmOpen]);

  const sendPendingPaste = async () => {
    const staged = pendingPasteRef.current;
    if (!staged || !sel.id || uploadingPaste) return;
    if (guardBlockedCompose()) return;
    if (!isMessageFileWithinLimit(staged.file)) {
      toast.error(MESSAGE_MAX_FILE_ERROR);
      clearPendingPaste();
      return;
    }
    const replySnap = replyingTo;
    const file = staged.file;
    const tempId = nextTempMessageId();
    const localPreview = staged.previewUrl;
    // Detach staging UI without revoking — optimistic bubble owns the blob URL.
    setPendingPaste(null);
    pendingPasteRef.current = null;
    setUploadingPaste(true);
    setReplyingTo(null);
    setEmojiOpen(false);
    if (isTypingRef.current) { isTypingRef.current = false; emitTyping(sel.id, false); }
    pinToBottomRef.current = true;
    isNearBottomRef.current = true;
    appendLocal({
      id: tempId,
      user: "You",
      msg: "",
      time: nowTime(),
      self: true,
      pending: true,
      mediaUrl: localPreview,
      mediaType: "image",
      ...(replySnap ? { replyTo: { id: replySnap.id, user: replySnap.user, preview: replySnap.msg.slice(0, 60) || replySnap.mediaType || "" } } : {}),
    });
    forceScrollToBottom("auto");
    try {
      const { message } = await api.messages.sendMedia(sel.id, file, replySnap?.id);
      if (localPreview.startsWith("blob:")) URL.revokeObjectURL(localPreview);
      replaceOptimistic(tempId, toChatMsg(message, currentUserId));
      refreshContacts();
    } catch (err) {
      if (localPreview.startsWith("blob:")) URL.revokeObjectURL(localPreview);
      if (isBlockedSendError(err)) removeLocal(tempId);
      else markLocalFailed(tempId);
      toastBlockedOrSendError(err, "Failed to upload screenshot");
    } finally {
      setUploadingPaste(false);
    }
    forceScrollToBottom("auto");
  };

  const send = async (extra?: Partial<ChatMsg>) => {
    if (pendingPasteRef.current) {
      await sendPendingPaste();
      return;
    }
    const trimmed = input.trim();
    if (!trimmed && !extra?.mediaUrl) return;
    if (guardBlockedCompose()) return;
    const replySnap = replyingTo;
    const convId = sel.id;
    setInput(""); setReplyingTo(null); setEmojiOpen(false);
    if (currentUserId && convId) clearConversationDraft(currentUserId, convId);
    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.style.height = "auto";
      }
    });
    if (isTypingRef.current) { isTypingRef.current = false; emitTyping(convId, false); }
    pinToBottomRef.current = true;
    isNearBottomRef.current = true;
    const tempId = nextTempMessageId();
    appendLocal({
      id: tempId,
      user: "You",
      msg: trimmed,
      time: nowTime(),
      self: true,
      pending: true,
      ...(replySnap ? { replyTo: { id: replySnap.id, user: replySnap.user, preview: replySnap.msg.slice(0, 60) || replySnap.mediaType || "" } } : {}),
      ...extra,
    });
    forceScrollToBottom("auto");
    try {
      const { message } = await api.messages.send(convId, trimmed, replySnap?.id);
      replaceOptimistic(tempId, toChatMsg(message, currentUserId));
      refreshContacts();
    } catch (err) {
      if (isBlockedSendError(err)) removeLocal(tempId);
      else markLocalFailed(tempId);
      toastBlockedOrSendError(err, "Failed to send message");
    }
    forceScrollToBottom("auto");
  };

  const handleComposerPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const image = imageFileFromClipboard(e.clipboardData);
    if (!image) return; // text / other — keep default paste
    e.preventDefault();
    if (!sel.id || voiceBusy || uploadingPaste) return;
    stagePasteImage(image);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    if (guardBlockedCompose()) return;
    if (!isMessageFileWithinLimit(file)) {
      toast.error(MESSAGE_MAX_FILE_ERROR);
      return;
    }
    const replySnap = replyingTo;
    setReplyingTo(null);
    pinToBottomRef.current = true;
    isNearBottomRef.current = true;
    const tempId = nextTempMessageId();
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    const isAudio = file.type.startsWith("audio/");
    const localUrl = (isImage || isVideo) ? URL.createObjectURL(file) : undefined;
    appendLocal({
      id: tempId,
      user: "You",
      msg: "",
      time: nowTime(),
      self: true,
      pending: true,
      mediaUrl: localUrl,
      mediaType: isImage ? "image" : isVideo ? "video" : isAudio ? "audio" : "file",
      fileName: file.name,
      fileSize: file.size,
      ...(replySnap ? { replyTo: { id: replySnap.id, user: replySnap.user, preview: replySnap.msg.slice(0, 60) || replySnap.mediaType || "" } } : {}),
    });
    forceScrollToBottom("auto");
    try {
      const { message } = await api.messages.sendMedia(sel.id, file, replySnap?.id);
      if (localUrl) URL.revokeObjectURL(localUrl);
      replaceOptimistic(tempId, toChatMsg(message, currentUserId));
      refreshContacts();
    } catch (err) {
      if (localUrl) URL.revokeObjectURL(localUrl);
      if (isBlockedSendError(err)) removeLocal(tempId);
      else markLocalFailed(tempId);
      toastBlockedOrSendError(err, "Failed to upload file");
    }
    forceScrollToBottom("auto");
  };

  const sendVoiceFile = async (file: File, meta: import("@/features/messages/voiceAudio").VoiceUploadMeta) => {
    if (guardBlockedCompose()) return;
    if (!isMessageFileWithinLimit(file)) {
      toast.error(MESSAGE_MAX_FILE_ERROR);
      return;
    }
    const replySnap = replyingTo;
    setReplyingTo(null);
    pinToBottomRef.current = true;
    isNearBottomRef.current = true;
    const tempId = nextTempMessageId();
    const localUrl = URL.createObjectURL(file);
    appendLocal({
      id: tempId,
      user: "You",
      msg: "",
      time: nowTime(),
      self: true,
      pending: true,
      mediaUrl: localUrl,
      mediaType: "audio",
      durationMs: meta.durationMs,
      mimeType: meta.mimeType,
      codec: meta.codec,
      sampleRate: meta.sampleRate,
      channels: meta.channels,
      waveform: meta.waveform,
      ...(replySnap ? { replyTo: { id: replySnap.id, user: replySnap.user, preview: replySnap.msg.slice(0, 60) || "Voice" } } : {}),
    });
    forceScrollToBottom("auto");
    try {
      const { message } = await api.messages.sendMedia(sel.id, file, replySnap?.id, {
        durationMs: meta.durationMs,
        mimeType: meta.mimeType,
        codec: meta.codec,
        sampleRate: meta.sampleRate,
        channels: meta.channels,
        waveform: meta.waveform,
      });
      URL.revokeObjectURL(localUrl);
      replaceOptimistic(tempId, toChatMsg(message, currentUserId));
      refreshContacts();
    } catch (err) {
      URL.revokeObjectURL(localUrl);
      if (isBlockedSendError(err)) removeLocal(tempId);
      else markLocalFailed(tempId);
      toastBlockedOrSendError(err, "Failed to upload voice message");
    }
    forceScrollToBottom("auto");
  };

  const sendGifItem = async (g: GifItem) => {
    if (!sel.id) return;
    if (guardBlockedCompose()) return;
    const replySnap = replyingTo;
    setReplyingTo(null);
    setEmojiOpen(false);
    pinToBottomRef.current = true;
    isNearBottomRef.current = true;
    const tempId = nextTempMessageId();
    appendLocal({
      id: tempId,
      user: "You",
      msg: "",
      time: nowTime(),
      self: true,
      pending: true,
      mediaUrl: g.url,
      mediaType: "gif",
      ...(replySnap ? { replyTo: { id: replySnap.id, user: replySnap.user, preview: replySnap.msg.slice(0, 60) || "GIF" } } : {}),
    });
    forceScrollToBottom("auto");
    try {
      const { message } = await api.messages.sendGif(sel.id, g.url, g.label, replySnap?.id);
      replaceOptimistic(tempId, toChatMsg(message, currentUserId));
      refreshContacts();
    } catch (err) {
      if (isBlockedSendError(err)) removeLocal(tempId);
      else markLocalFailed(tempId);
      toastBlockedOrSendError(err, "Failed to send GIF");
    }
    forceScrollToBottom("auto");
  };

  const startDmCall = (type: "voice" | "video") => {
    if (sel.type !== "dm" || !sel.otherUserId || sel.isDeleted) {
      if (sel.isDeleted) toast.message("This user is no longer available");
      return;
    }
    if (sel.isBlocked || sel.blockedByMe) {
      toast.error(sel.blockedByMe
        ? "You blocked this user. Unblock them to call."
        : "You cannot call this user because they have blocked you.");
      return;
    }
    if (!canCallPeer(sel)) {
      toast.message(CALL_OFFLINE_MESSAGE);
      return;
    }
    if (!canPlaceCall(currentUser, { isTeamMember: sel.isTeamMember, isAdmin: sel.isAdmin })) {
      toast.message(CALL_DENIED_MESSAGE);
      return;
    }
    if (!callApi) {
      toast.error("Calling is unavailable");
      return;
    }
    callApi.startCall({
      conversationId: sel.id,
      calleeId: sel.otherUserId,
      type,
      peerName: sel.name,
      peerAvatar: sel.avatarUrl,
    });
  };

  const peerCallable = sel.type === "dm" && !!sel.otherUserId && !sel.isDeleted
    && canCallPeer(sel)
    && canPlaceCall(currentUser, { isTeamMember: sel.isTeamMember, isAdmin: sel.isAdmin });
  const callDisabledReason = sel.type === "dm" && !sel.isDeleted
    ? (!canCallPeer(sel)
      ? CALL_OFFLINE_MESSAGE
      : (!canPlaceCall(currentUser, { isTeamMember: sel.isTeamMember, isAdmin: sel.isAdmin })
        ? CALL_DENIED_MESSAGE
        : undefined))
    : undefined;

  const commitEdit = async (id: number) => {
    if (!editText.trim()) return;
    try {
      const { message } = await api.messages.edit(id, editText.trim());
      updateLocal(id, toChatMsg(message, currentUserId));
    } catch {
      updateLocal(id, { msg: editText.trim(), edited: true });
    }
    setEditingId(null);
  };

  const deleteMsg = async (id: number) => {
    if (id > 0) {
      try { await api.messages.delete(id); } catch { /* */ }
    }
    applyDeletedMessage(id);
  };

  const addReaction = async (msgId: number, emoji: string) => {
    try {
      const { reactions } = await api.messages.react(msgId, emoji);
      applyReaction(msgId, reactions);
    } catch {
      const m = msgsRef.current.find(x => x.id === msgId);
      if (!m) return;
      const r = { ...(m.reactions || {}) };
      const users = r[emoji] ? [...r[emoji]] : [];
      const me = String(currentUserId);
      if (users.includes(me) || users.includes("You")) {
        const f = users.filter(u => u !== me && u !== "You");
        if (f.length === 0) delete r[emoji];
        else r[emoji] = f;
      } else {
        r[emoji] = [...users, me];
      }
      applyReaction(msgId, r);
    }
  };

  const isBlockedSendError = (err: unknown) =>
    err instanceof ApiError && (err.data?.code === "blocked" || /blocked/i.test(err.message));

  const toastBlockedOrSendError = (err: unknown, fallback: string) => {
    if (isBlockedSendError(err)) {
      toast.error(err instanceof ApiError ? err.message : "You cannot send messages because this user has blocked you.");
      return;
    }
    toast.error(err instanceof ApiError ? err.message : fallback);
  };

  const guardBlockedCompose = () => {
    if (sel.type !== "dm") return false;
    if (sel.blockedByMe) {
      toast.error("You blocked this user. Unblock them to send messages.");
      return true;
    }
    if (sel.isBlocked) {
      toast.error("You cannot send messages because this user has blocked you.");
      return true;
    }
    return false;
  };

  const deleteContact = async (contactId: number) => {
    try { await api.messages.deleteContact(contactId); } catch { /* */ }
    setContacts(prev => prev.filter(c => c.id !== contactId));
    if (sel.id === contactId) {
      const remaining = contacts.filter(c => c.id !== contactId);
      if (remaining.length) setSel(remaining[0]);
      else setSel(emptyContact);
    }
    refreshContacts();
  };

  const blockUser = async (contact: Contact) => {
    if (!contact.otherUserId) return;
    try {
      await api.users.block(contact.otherUserId);
      setContacts(prev => prev.map(c =>
        c.otherUserId === contact.otherUserId
          ? { ...c, blockedByMe: true, isBlocked: true }
          : c,
      ));
      setSel(prev => prev.otherUserId === contact.otherUserId
        ? { ...prev, blockedByMe: true, isBlocked: true }
        : prev);
      toast.success(`Blocked ${contact.name}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to block user");
    }
  };

  const unblockUser = async (contact: Contact) => {
    if (!contact.otherUserId) return;
    try {
      await api.users.unblock(contact.otherUserId);
      setContacts(prev => prev.map(c =>
        c.otherUserId === contact.otherUserId
          ? { ...c, blockedByMe: false, isBlocked: false }
          : c,
      ));
      setSel(prev => prev.otherUserId === contact.otherUserId
        ? { ...prev, blockedByMe: false, isBlocked: false }
        : prev);
      toast.success(`Unblocked ${contact.name}`);
      refreshContacts();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to unblock user");
    }
  };

  const scrollTo = (id: number) => {
    const el = msgRefs.current.get(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.animate([{ boxShadow: "0 0 0 3px " + C.primary + "66" }, { boxShadow: "0 0 0 0px transparent" }], { duration: 800 });
      return;
    }
    const dataIndex = msgsRef.current.findIndex(m => m.id === id);
    if (dataIndex >= 0) {
      virtuosoRef.current?.scrollToIndex({
        index: firstItemIndexRef.current + dataIndex,
        align: "center",
        behavior: "smooth",
      });
    }
  };

  const filteredContacts = contacts
    .filter(c => {
      // Soft-deleted DM peers are omitted from the active inbox
      if (c.type === "dm" && c.isDeleted) return false;
      if (listFilter === "dm-requests") return false;
      if (listFilter !== "all" && c.type !== listFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return c.name.toLowerCase().includes(q) || c.msg.toLowerCase().includes(q);
      }
      return true;
    });

  const sortByActivityDesc = (a: Contact, b: Contact) => {
    const ta = a.lastActivityAt ? Date.parse(a.lastActivityAt) : 0;
    const tb = b.lastActivityAt ? Date.parse(b.lastActivityAt) : 0;
    return tb - ta;
  };

  /** Admin-defined channel order (sortOrder), then id. Never by last activity. */
  const sortChannelsByAdminOrder = (a: Contact, b: Contact) => {
    const sa = a.sortOrder ?? a.id;
    const sb = b.sortOrder ?? b.id;
    if (sa !== sb) return sa - sb;
    return a.id - b.id;
  };

  const channelContacts = filteredContacts
    .filter(c => c.type === "channel")
    .sort(sortChannelsByAdminOrder);
  const dmContacts = filteredContacts
    .filter(c => c.type === "dm")
    .sort(sortByActivityDesc);
  const orderedContacts = listFilter === "channel"
    ? channelContacts
    : listFilter === "dm"
      ? dmContacts
      : null; // "all" renders two sections

  const sendDmRequest = async () => {
    const username = newDmUsername.trim();
    if (!username) { setNewDmError("Please enter a username"); return; }
    setNewDmLoading(true);
    setNewDmError("");
    try {
      const result = await api.dm.createRequest(username);
      if (result.conversationId) {
        const convs = await api.messages.conversations();
        setContacts(convs.conversations as Contact[]);
        const conv = convs.conversations.find(c => c.id === result.conversationId);
        if (conv) setSel(conv as Contact);
        setNewDmOpen(false);
        setNewDmUsername("");
        toast.success("Conversation opened");
      } else {
        setNewDmOpen(false);
        setNewDmUsername("");
        toast.success("Direct message request sent");
      }
    } catch (e) {
      if (e instanceof ApiError && e.data?.conversationId != null) {
        const convId = Number(e.data.conversationId);
        const convs = await api.messages.conversations();
        setContacts(convs.conversations as Contact[]);
        const conv = convs.conversations.find(c => c.id === convId);
        if (conv) setSel(conv as Contact);
        setNewDmOpen(false);
        setNewDmUsername("");
        toast.success("Conversation opened");
      } else {
        setNewDmError(e instanceof Error ? e.message : "Could not send request");
      }
    } finally {
      setNewDmLoading(false);
    }
  };

  const acceptDmRequest = async (requestId: number) => {
    if (acceptingRequestId != null) return;
    setAcceptingRequestId(requestId);
    // Optimistic: remove from inbox immediately so UI never looks "still pending".
    const removed = dmRequests.find(r => r.id === requestId);
    setDmRequests(prev => prev.filter(r => r.id !== requestId));
    try {
      const result = await api.dm.accept(requestId);
      joinConversation(result.conversationId);
      refreshContacts();
      try {
        const convs = await api.messages.conversations();
        setContacts(convs.conversations as Contact[]);
        const conv = convs.conversations.find(c => c.id === result.conversationId);
        if (conv) {
          setSel(conv as Contact);
          selectListFilter("dm");
          if (isMobile) setShowSidebar(false);
        }
      } catch {
        // Accept succeeded — list refresh can catch up via realtime / refreshContacts.
      }
      toast.success(result.alreadyExists ? "Conversation already open" : "Request accepted");
    } catch (err) {
      // Restore request only when the server says it is still pending / failed.
      if (removed) setDmRequests(prev => (prev.some(r => r.id === requestId) ? prev : [removed, ...prev]));
      loadDmRequests();
      toast.error(err instanceof ApiError ? err.message : "Could not accept request");
    } finally {
      setAcceptingRequestId(null);
    }
  };

  const rejectDmRequest = async (requestId: number) => {
    if (rejectingRequestId != null) return;
    setRejectingRequestId(requestId);
    const removed = dmRequests.find(r => r.id === requestId);
    setDmRequests(prev => prev.filter(r => r.id !== requestId));
    try {
      await api.dm.reject(requestId);
      toast.success("Request declined");
    } catch (err) {
      if (removed) setDmRequests(prev => (prev.some(r => r.id === requestId) ? prev : [removed, ...prev]));
      loadDmRequests();
      toast.error(err instanceof ApiError ? err.message : "Could not decline request");
    } finally {
      setRejectingRequestId(null);
    }
  };

  const sidebarFilters: { id: ListFilter; Icon: typeof TagIcon; l: string; badge?: number }[] = [
    { Icon: TagIcon, l: "All", id: "all" },
    { Icon: GroupsIcon, l: "Channels", id: "channel" },
    { Icon: ChatBubbleIcon, l: "DMs", id: "dm" },
    ...(dmRequests.length > 0 ? [{ Icon: InboxIcon, l: "DM Requests", id: "dm-requests" as const, badge: dmRequests.length }] : []),
  ];

  const makeMenuItems = (contact: Contact, closeFn: ()=>void) => {
    if (contact.type === "channel") {
      return [
        { Icon:VolumeOffIcon, label: contact.muted ? "Unmute Notifications" : "Mute Notifications", danger:false, action:() => {
          api.messages.mute(contact.id).then(r => {
            setContacts(prev => prev.map(c => c.id === contact.id ? { ...c, muted: r.muted } : c));
            setSel(prev => prev.id === contact.id ? { ...prev, muted: r.muted } : prev);
          }).catch(() => {});
          closeFn();
        } },
      ];
    }
    return [
      { Icon:VolumeOffIcon, label: contact.muted ? "Unmute Notifications" : "Mute Notifications", danger:false, action:() => {
        api.messages.mute(contact.id).then(r => {
          setContacts(prev => prev.map(c => c.id === contact.id ? { ...c, muted: r.muted } : c));
          setSel(prev => prev.id === contact.id ? { ...prev, muted: r.muted } : prev);
        }).catch(() => {});
        closeFn();
      } },
      ...(!contact.isDeleted ? [
        contact.blockedByMe
          ? { Icon: BlockIcon, label: "Unblock User", danger: false, action: () => { void unblockUser(contact); closeFn(); } }
          : { Icon: BlockIcon, label: "Block User", danger: true, action: () => {
              askConfirm(
                "Block User",
                `Block ${contact.name}? They won't be able to message you.`,
                () => { void blockUser(contact); closeFn(); },
              );
            } },
        { Icon: FlagIcon, label: "Report User", danger: true, action: () => {
          askConfirm(
            "Report User",
            `Report ${contact.name} for inappropriate behaviour?`,
            () => {
              api.messages.report({ reason: `Reported user: ${contact.name}`, userId: contact.otherUserId })
                .then(() => toast.success("Report submitted"))
                .catch(() => toast.error("Failed to submit report"));
              closeFn();
            },
          );
        } },
      ] : []),
      { Icon: PersonIcon, label: "Delete Contact", danger: true, action: () => {
        askConfirm(
          "Delete Contact",
          `Remove ${contact.name} from your list? Your message history is kept and will reappear if they message you again.`,
          () => { void deleteContact(contact.id); closeFn(); },
        );
      } },
    ];
  };

  const DropdownMenu = ({ items, onClose }: { items: ReturnType<typeof makeMenuItems>; onClose: ()=>void }) => (
    <div className="py-1" onClick={e => e.stopPropagation()}>
      {items.map(item => (
        <button key={item.label} onClick={item.action} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-black/5 transition-colors" style={{ color:item.danger?C.error:C.onSurface, fontFamily:"Roboto" }}>
          <item.Icon style={{ fontSize:18 }} />{item.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="h-screen flex overflow-hidden pt-16 max-w-[100vw]" style={{ background:C.bg }} onClick={closeAll}>
      {/* New DM modal */}
      {newDmOpen && (
        <div
          className={`fixed inset-x-0 bottom-0 z-[60] flex items-center justify-center p-4${desktopMode ? "" : " bg-black/50 backdrop-blur-sm"}`}
          style={{
            top: desktopMode ? "var(--ninja-titlebar-h, 44px)" : 0,
            ...(desktopMode ? { background: "rgba(0,0,0,0.5)" } : undefined),
          }}
          onClick={() => setNewDmOpen(false)}
        >
          <div className="rounded-3xl p-6 w-full max-w-sm shadow-2xl" style={{ background: C.surface }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-base" style={{ color: C.onSurface, fontFamily: "Roboto" }}>New Direct Message</h3>
              <button onClick={() => setNewDmOpen(false)} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/5" style={{ color: C.onSurfaceVar }}><CloseIcon style={{ fontSize: 18 }} /></button>
            </div>
            <Field label="Username" value={newDmUsername} onChange={v => { setNewDmUsername(v); setNewDmError(""); }} placeholder="Enter exact username" />
            {newDmError && <p className="text-sm mt-2" style={{ color: C.error, fontFamily: "Roboto" }}>{newDmError}</p>}
            <div className="flex gap-3 justify-end mt-6">
              <OutlinedBtn onClick={() => setNewDmOpen(false)}>Cancel</OutlinedBtn>
              <FilledBtn onClick={sendDmRequest} cls={newDmLoading ? "opacity-60 pointer-events-none" : ""}>
                {newDmLoading ? "Sending…" : "Send Request"}
              </FilledBtn>
            </div>
          </div>
        </div>
      )}
      {confirm && (
        <div
          className={`fixed inset-x-0 bottom-0 z-[60] flex items-center justify-center p-4${desktopMode ? "" : " bg-black/50 backdrop-blur-sm"}`}
          style={{
            top: desktopMode ? "var(--ninja-titlebar-h, 44px)" : 0,
            ...(desktopMode ? { background: "rgba(0,0,0,0.5)" } : undefined),
          }}
          onClick={() => setConfirm(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="msg-confirm-title"
        >
          <div
            className={`rounded-3xl p-6 w-full max-w-xs${desktopMode ? "" : " shadow-2xl"}`}
            style={{
              background: C.surface,
              ...(desktopMode ? { boxShadow: "0 8px 32px rgba(0,0,0,.24)" } : null),
            }}
            onClick={e => e.stopPropagation()}
          >
            <h3 id="msg-confirm-title" className="font-medium text-base mb-2" style={{ color:C.onSurface, fontFamily:"Roboto" }}>{confirm.title}</h3>
            <p className="text-sm mb-6" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>{confirm.body}</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirm(null)} className="px-4 py-2 rounded-full text-sm font-medium border transition-colors hover:bg-black/5" style={{ borderColor:C.outline, color:C.onSurface, fontFamily:"Roboto" }}>Cancel</button>
              <button onClick={() => { confirm.onOk(); setConfirm(null); }} className="px-4 py-2 rounded-full text-sm font-medium text-white transition-colors hover:opacity-90" style={{ background:C.error, fontFamily:"Roboto" }}>Confirm</button>
            </div>
          </div>
        </div>
      )}
      {/* Image lightbox */}
      {lightbox && (
        <ImageLightbox
          src={lightbox}
          onClose={() => setLightbox(null)}
          desktopMode={desktopMode}
        />
      )}
      {/* Right-click context menu */}
      {ctxMenu && (
        <div className="fixed z-50 rounded-2xl border shadow-xl overflow-hidden" style={{ top:ctxMenu.y, left:ctxMenu.x, background:C.surface, borderColor:C.outlineVar, minWidth:"13rem" }} onClick={e => e.stopPropagation()}>
          <DropdownMenu items={makeMenuItems(ctxMenu.contact, ()=>setCtxMenu(null))} onClose={()=>setCtxMenu(null)} />
        </div>
      )}
      {/* Settings Modal */}
      {settingsOpen && (
        <div
          className={`fixed inset-x-0 bottom-0 z-50 flex items-center justify-center p-4${desktopMode ? "" : " bg-black/40 backdrop-blur-[2px]"}`}
          style={{
            top: desktopMode ? "var(--ninja-titlebar-h, 44px)" : 0,
            ...(desktopMode ? { background: "rgba(0,0,0,0.5)" } : undefined),
          }}
          onClick={() => {
            if (avatarPreview) {
              URL.revokeObjectURL(avatarPreview);
              setAvatarPreview(null);
            }
            setSettingsOpen(false);
          }}
        >
          <div className="rounded-3xl p-6 w-full max-w-sm" style={{ background:C.surface, boxShadow:"0 8px 32px rgba(0,0,0,.24)" }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-medium text-base" style={{ color:C.onSurface, fontFamily:"Roboto" }}>My Profile</h3>
              <button type="button" onClick={() => {
                if (avatarPreview) {
                  URL.revokeObjectURL(avatarPreview);
                  setAvatarPreview(null);
                }
                setSettingsOpen(false);
              }} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/5" style={{ color:C.onSurfaceVar }} aria-label="Close"><CloseIcon style={{ fontSize:18 }} /></button>
            </div>
            <div className="flex items-center gap-4 mb-5">
              <div className="relative shrink-0 w-16 h-16 ninja-profile-avatar group">
                <button
                  type="button"
                  disabled={avatarUploading || savingProfile}
                  onClick={() => avatarFileRef.current?.click()}
                  className="relative w-16 h-16 rounded-full overflow-hidden focus:outline-none"
                  title="Change avatar"
                  aria-label="Change avatar"
                >
                  <ChatAvatar
                    name={currentUser?.username || "?"}
                    avatarUrl={avatarPreview || currentUser?.avatarUrl}
                    size={64}
                    bg={desktopMode ? (isDarkTheme ? "transparent" : C.primary) : undefined}
                  />
                  <div className="absolute inset-0 rounded-full bg-black/45 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    {avatarUploading
                      ? <CircularProgress size={22} sx={{ color: "#fff" }} />
                      : <PhotoCameraIcon style={{ fontSize: 22, color: "white" }} />}
                  </div>
                </button>
                <input
                  ref={avatarFileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadMyAvatar(f);
                  }}
                />
                <ProfileStatusBadge
                  status={myStatus}
                  C={C}
                  disabled={savingProfile || avatarUploading}
                  onChange={applyPresenceStatus}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm truncate" style={{ color:C.onSurface, fontFamily:"'Trade Winds', cursive" }}>{currentUser?.username || "Shinobi"}</p>
                <label className="block mt-1.5">
                  <span className="sr-only">Mood</span>
                  <input
                    type="text"
                    value={myMood}
                    maxLength={128}
                    onChange={e => setMyMood(e.target.value)}
                    placeholder="Set a mood…"
                    className="w-full px-0 py-0.5 bg-transparent border-0 border-b text-xs focus:outline-none focus-visible:ring-0"
                    style={{ borderColor: C.outlineVar, color: C.onSurface, fontFamily: "Roboto" }}
                  />
                </label>
              </div>
            </div>
            <p className="text-[11px] font-medium mb-2 uppercase tracking-widest" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>Bio</p>
            <textarea
              rows={3}
              value={myBio}
              onChange={e => setMyBio(e.target.value)}
              className="w-full px-4 py-3 rounded-2xl border text-sm focus:outline-none resize-none mb-5"
              style={{ borderColor: C.outline, color: C.onSurface, background: "transparent", fontFamily: "Roboto" }}
            />
            <FilledBtn cls={`w-full justify-center ${savingProfile ? "opacity-60 pointer-events-none" : ""}`} onClick={saveMyProfile}><CheckIcon style={{ fontSize:16 }} />{savingProfile ? "Saving…" : "Save"}</FilledBtn>
          </div>
        </div>
      )}
      {/* Left chrome: filter rail + conversation list (mobile: exactly 100vw, no overflow) */}
      {showLeftPanel && (
        <div
          className={isMobile
            ? "grid grid-cols-[72px_minmax(0,1fr)] w-full max-w-full min-w-0 min-h-0 flex-1 overflow-hidden"
            : "flex shrink-0 min-h-0"}
        >
          <div className="w-[72px] border-r flex flex-col items-center py-4 gap-2 shrink-0 min-w-[72px] max-w-[72px]" style={{ background:C.surfaceVar, borderColor:C.outlineVar }}>
            {sidebarFilters.map(({ Icon, l, id, badge }) => {
              const active = listFilter === id;
              return (
                <button key={l} title={l} onClick={() => selectListFilter(id)} aria-pressed={active}
                  className="relative w-12 h-12 rounded-full flex items-center justify-center transition-all hover:scale-110 focus:outline-none focus-visible:ring-2"
                  style={{
                    background: active ? C.primaryCont : C.surface,
                    // Desktop dark: on-container ink for contrast on accent fill.
                    // Desktop light: black icons (avoid purple onPrimaryCont / primary).
                    color: active
                      ? (desktopMode ? (isDarkTheme ? C.onPrimaryCont : "#000000") : C.primary)
                      : (desktopMode && !isDarkTheme ? "#000000" : C.onSurfaceVar),
                    boxShadow: active ? `0 0 0 2px ${C.primary}` : SH1,
                  }}>
                  <Icon style={{ fontSize:20 }} />
                  {badge != null && badge > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 rounded-full text-white text-[9px] flex items-center justify-center font-bold" style={{ background: BADGE_BG }}>{badge}</span>
                  )}
                </button>
              );
            })}
            {desktopMode ? (
              <div className="mt-auto relative flex flex-col items-center">
                <div className="relative w-12 h-12 ninja-profile-avatar">
                  <button
                    type="button"
                    title={currentUser?.username || "Account"}
                    aria-label="Open account menu"
                    aria-haspopup="menu"
                    aria-expanded={accountMenuOpen}
                    onClick={e => { e.stopPropagation(); setAccountMenuOpen(o => !o); }}
                    className="ninja-account-avatar w-12 h-12 rounded-full overflow-hidden flex items-center justify-center transition-transform hover:scale-105 focus:outline-none"
                  >
                    <ChatAvatar
                      name={currentUser?.username || "?"}
                      avatarUrl={currentUser?.avatarUrl}
                      size={48}
                      bg={isDarkTheme ? "transparent" : C.primary}
                    />
                  </button>
                  <ProfileStatusBadge
                    status={myStatus}
                    C={C}
                    onChange={applyPresenceStatus}
                  />
                </div>
                {accountMenuOpen && (
                  <div
                    className="absolute bottom-0 left-[56px] w-56 rounded-2xl border shadow-2xl overflow-hidden py-1 z-50"
                    style={{ background:C.surface, borderColor:C.outlineVar }}
                    role="menu"
                    onClick={e => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => { setAccountMenuOpen(false); setSettingsOpen(true); }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-black/5 transition-colors border-b"
                      style={{ borderColor:C.outlineVar }}
                    >
                      <ChatAvatar
                        name={currentUser?.username || "?"}
                        avatarUrl={currentUser?.avatarUrl}
                        size={38}
                        bg={isDarkTheme ? "transparent" : C.primary}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate" style={{ color:C.onSurface, fontFamily:"Roboto" }}>{currentUser?.username || "User"}</p>
                        <p className="text-xs truncate" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>{currentUser?.isTeamMember ? "Team Member" : currentUser?.isAdmin ? "Administrator" : "Member"}</p>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => { setAccountMenuOpen(false); onDesktopOpenSettings?.(); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-black/5 transition-colors"
                      style={{ color:C.onSurface, fontFamily:"Roboto" }}
                    >
                      <SettingsIcon style={{ fontSize:18, color:C.onSurfaceVar }} />Settings
                    </button>
                    <button
                      type="button"
                      onClick={() => { setAccountMenuOpen(false); onDesktopLogout?.(); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-black/5 transition-colors border-t"
                      style={{ color:C.error, borderColor:C.outlineVar, fontFamily:"Roboto" }}
                    >
                      <LogoutIcon style={{ fontSize:18 }} />Log Out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button title="Settings" onClick={e => { e.stopPropagation(); setSettingsOpen(true); }} className="w-12 h-12 rounded-full flex items-center justify-center transition-all hover:scale-110 mt-auto" style={{ background:C.surface, color:C.onSurfaceVar, boxShadow:SH1 }}>
                <SettingsIcon style={{ fontSize:20 }} />
              </button>
            )}
          </div>
          {showConversationList && (
            <div
              className={isMobile
                ? "border-r flex flex-col min-h-0 min-w-0 overflow-hidden"
                : "w-72 border-r flex flex-col shrink-0 min-h-0"}
              style={{ background:C.surface, borderColor:C.outlineVar, boxShadow:SH1 }}
            >
              <div className="p-4 border-b" style={{ borderColor:C.outlineVar }}>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-full border flex-1" style={{ background:C.surfaceVar, borderColor:C.outlineVar }}>
                    <SearchIcon style={{ fontSize:18, color:C.onSurfaceVar }} />
                    <input placeholder={desktopMode ? "Search Conversation" : "Search messages..."} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="flex-1 bg-transparent text-sm focus:outline-none" style={{ color:C.onSurface, fontFamily:"Roboto" }} />
                  </div>
                  <button title="New Direct Message" onClick={e => { e.stopPropagation(); setNewDmOpen(true); setNewDmError(""); setNewDmUsername(""); }}
                    className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all hover:scale-105 focus:outline-none focus-visible:ring-2"
                    style={{
                      background: C.primaryCont,
                      // Desktop dark: keep the PersonAdd icon pure white for contrast on the accent fill.
                      color: desktopMode && isDarkTheme ? "#FFFFFF" : C.primary,
                      boxShadow: SH1,
                    }}>
                    <PersonAddIcon style={{ fontSize: 20, color: "inherit" }} />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto py-2 ninja-scroll" onScroll={onScrollReveal}>
                {listFilter === "dm-requests" ? (
                  <div className="px-4">
                    <div className="px-4 pt-3 pb-1">
                      <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>Pending Requests</span>
                    </div>
                    <div className="space-y-2">
                      {dmRequests.length === 0 ? (
                        <p className="text-xs px-2 py-6 text-center" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>No pending requests.</p>
                      ) : dmRequests.map(req => {
                        const highlighted = highlightedRequestId === req.id;
                        return (
                        <div
                          key={req.id}
                          ref={el => { if (el) dmRequestRowRefs.current.set(req.id, el); else dmRequestRowRefs.current.delete(req.id); }}
                          className="flex items-center gap-3 p-2.5 rounded-2xl transition-all"
                          style={{
                            background: C.surfaceVar,
                            boxShadow: highlighted ? `0 0 0 2px ${C.primary}` : undefined,
                          }}
                        >
                          <ChatAvatar name={req.requesterName} avatarUrl={req.requesterAvatar} size={36} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{req.requesterDisplayName || req.requesterName}</p>
                            <p className="text-[10px] truncate" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>@{req.requesterName}</p>
                            <p className="text-[10px]" style={{ color: C.onSurfaceVar, fontFamily: "Roboto Mono,monospace" }}>{req.time}</p>
                          </div>
                          <div className="flex flex-col gap-1 shrink-0">
                            <button
                              type="button"
                              aria-label={`Accept message request from ${req.requesterDisplayName || req.requesterName}`}
                              disabled={acceptingRequestId === req.id || rejectingRequestId === req.id}
                              onClick={() => void acceptDmRequest(req.id)}
                              className="px-2.5 py-1 rounded-full text-[10px] font-medium text-white disabled:opacity-60"
                              style={{ background: C.primary, fontFamily: "Roboto" }}
                            >
                              {acceptingRequestId === req.id ? "Accepting…" : "Accept"}
                            </button>
                            <button
                              type="button"
                              aria-label={`Reject message request from ${req.requesterDisplayName || req.requesterName}`}
                              disabled={acceptingRequestId === req.id || rejectingRequestId === req.id}
                              onClick={() => void rejectDmRequest(req.id)}
                              className="px-2.5 py-1 rounded-full text-[10px] font-medium border disabled:opacity-60"
                              style={{ borderColor: C.outline, color: C.error, fontFamily: "Roboto" }}
                            >
                              {rejectingRequestId === req.id ? "Declining…" : "Reject"}
                            </button>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </div>
                ) : filteredContacts.length === 0 ? (
                  <p className="text-xs px-4 py-6 text-center" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                    {searchQuery.trim() ? "No conversations match your search." : "No conversations yet."}
                  </p>
                ) : listFilter === "all" ? (
                  <div>
                    {channelContacts.length > 0 && (
                      <div className="mb-1">
                        <div className="px-4 pt-2 pb-1">
                          <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>Channels</span>
                        </div>
                        {channelContacts.map(m => (
                          <button key={m.id} onClick={() => selectConversation(m)}
                            onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, contact: m }); }}
                            className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[#6750A4]/6" style={{ background: sel.id === m.id ? C.primaryCont : "transparent" }}>
                            <div className="relative shrink-0">
                              <ChatAvatar name={m.name} avatarUrl={m.avatarUrl} size={40} channel />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex justify-between items-center gap-2">
                                <span className="text-sm font-medium truncate" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{m.name}</span>
                                {m.muted && <VolumeOffIcon style={{ fontSize: 14, color: C.onSurfaceVar }} titleAccess="Muted" />}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {dmContacts.length > 0 && (
                      <div>
                        <div className="px-4 pt-3 pb-1">
                          <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>Direct Messages</span>
                        </div>
                        {dmContacts.map(m => (
                          <button key={m.id} onClick={() => selectConversation(m)}
                            onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, contact: m }); }}
                            className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[#6750A4]/6" style={{ background: sel.id === m.id ? C.primaryCont : "transparent" }}>
                            <div className="relative shrink-0">
                              <ChatAvatar name={m.name} avatarUrl={m.avatarUrl} size={40} deleted={!!m.isDeleted} />
                              <FiberManualRecordIcon style={{ fontSize: 12, color: presenceColor(m), position: "absolute", bottom: -1, right: -1 }} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex justify-between items-center gap-2">
                                <span className="text-sm font-medium truncate" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{m.name}</span>
                                {m.muted && <VolumeOffIcon style={{ fontSize: 14, color: C.onSurfaceVar }} titleAccess="Muted" />}
                              </div>
                              {(m.mood || "").trim() ? (
                                <p className="text-xs truncate italic" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                                  {m.mood!.trim()}
                                </p>
                              ) : null}
                            </div>
                            <div className="w-5 h-5 shrink-0 flex items-center justify-center" title={m.isBlocked ? "Blocked" : undefined}>
                              {m.isBlocked ? (
                                <BlockIcon style={{ fontSize: 16, color: C.onSurfaceVar }} aria-label="Blocked" />
                              ) : (m.unread > 0 && sel.id !== m.id) ? (
                                <div className="unread-badge rounded-full flex items-center justify-center text-white text-[10px] font-bold" style={{ background: BADGE_BG }}>{m.unread > 9 ? "9+" : m.unread}</div>
                              ) : null}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  (orderedContacts ?? []).map(m => (
                    <button key={m.id} onClick={() => selectConversation(m)}
                      onContextMenu={e => { e.preventDefault(); setCtxMenu({ x:e.clientX, y:e.clientY, contact:m }); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[#6750A4]/6" style={{ background:sel.id===m.id?C.primaryCont:"transparent" }}>
                      <div className="relative shrink-0">
                        {m.type === "channel" ? (
                          <ChatAvatar name={m.name} avatarUrl={m.avatarUrl} size={40} channel />
                        ) : (
                          <ChatAvatar name={m.name} avatarUrl={m.avatarUrl} size={40} deleted={!!m.isDeleted} />
                        )}
                        {m.type === "dm" && <FiberManualRecordIcon style={{ fontSize:12, color:presenceColor(m), position:"absolute", bottom:-1, right:-1 }} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center gap-2">
                          <span className="text-sm font-medium truncate" style={{ color:C.onSurface, fontFamily:"Roboto" }}>{m.name}</span>
                          {m.muted && <VolumeOffIcon style={{ fontSize:14, color:C.onSurfaceVar }} titleAccess="Muted" />}
                        </div>
                        {m.type === "dm" && (m.mood || "").trim() ? (
                          <p className="text-xs truncate italic" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>
                            {m.mood!.trim()}
                          </p>
                        ) : null}
                      </div>
                      {m.type === "dm" && (
                        <div className="w-5 h-5 shrink-0 flex items-center justify-center" title={m.isBlocked ? "Blocked" : undefined}>
                          {m.isBlocked ? (
                            <BlockIcon style={{ fontSize: 16, color: C.onSurfaceVar }} aria-label="Blocked" />
                          ) : (m.unread > 0 && sel.id !== m.id) ? (
                            <div className="unread-badge rounded-full flex items-center justify-center text-white text-[10px] font-bold" style={{ background:BADGE_BG }}>{m.unread > 9 ? "9+" : m.unread}</div>
                          ) : null}
                        </div>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {/* Chat */}
      {showChatPane && (
      <div className="flex-1 flex flex-col min-w-0 relative">
        {listFilter === "dm-requests" ? (
          <div className="flex-1 flex items-center justify-center px-6" style={{ background: C.surfaceVar }}>
            <div className="text-center max-w-sm">
              <InboxIcon style={{ fontSize: 48, color: C.onSurfaceVar, marginBottom: 16 }} />
              <p className="font-medium text-sm mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Direct Message Requests</p>
              <p className="text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>Select a request from the list to accept or decline.</p>
            </div>
          </div>
        ) : desktopMode && sel.id <= 0 ? (
          /* Desktop welcome screen — shown when no conversation is selected. */
          <div className="flex-1 flex flex-col items-center justify-center px-8 text-center select-none" style={{ background: C.surfaceVar }}>
            <BrandLogo size={104} priority />
            <h1 className="mt-6 text-3xl leading-none" style={{ fontFamily: "'Trade Winds', cursive", color: C.onSurface }}>{BRAND_NAME}</h1>
            <p className="mt-5 text-base font-medium" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Welcome to {BRAND_NAME}</p>
            <p className="mt-1.5 text-sm max-w-xs" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>Select a channel or direct message to start a conversation.</p>
          </div>
        ) : (
        <>
        {/* Chat header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b shrink-0 relative" style={{ background:C.surface, borderColor:C.outlineVar, boxShadow:SH1 }}>
          <button title={showSidebar?"Hide sidebar":"Show sidebar"} onClick={e => { e.stopPropagation(); setShowSidebar(!showSidebar); }} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-black/5 shrink-0" style={{ color:C.onSurfaceVar }}>
            <MenuIcon style={{ fontSize:20 }} />
          </button>
          <button
            type="button"
            className="relative shrink-0 rounded-full focus:outline-none focus-visible:ring-2"
            onClick={e => { e.stopPropagation(); openConversationDetails(); }}
            aria-label={(isMobile || (desktopMode && !showDesktopRightRail)) ? `View ${sel.type === "channel" ? "channel" : "user"} details` : undefined}
            style={{ cursor: (isMobile || (desktopMode && !showDesktopRightRail)) && sel.id > 0 ? "pointer" : "default" }}
            tabIndex={(isMobile || (desktopMode && !showDesktopRightRail)) && sel.id > 0 ? 0 : -1}
          >
            {sel.type === "channel" ? (
              <ChatAvatar name={sel.name} avatarUrl={sel.avatarUrl} size={36} channel />
            ) : (
              <ChatAvatar name={sel.name} avatarUrl={sel.avatarUrl} size={36} deleted={!!sel.isDeleted} />
            )}
            {sel.type === "dm" && !sel.isDeleted && <FiberManualRecordIcon style={{ fontSize:10, color:presenceColor(sel), position:"absolute", bottom:-1, right:-1 }} />}
          </button>
          <div>
            <p className="font-medium text-sm" style={{ color:C.onSurface, fontFamily:"Roboto" }}>{sel.name || "Deleted User"}</p>
            <p className="text-xs" style={{ color: sel.type==="channel" ? C.onSurfaceVar : (sel.isDeleted ? C.onSurfaceVar : presenceColor(sel)), fontFamily:"Roboto" }}>{sel.isDeleted ? "Account deleted" : presenceLabel(sel)}</p>
          </div>
          <div className="ml-auto flex items-center gap-1 relative">
            {sel.type === "dm" && sel.otherUserId && !sel.isDeleted ? (
              <>
                <button
                  type="button"
                  title={peerCallable ? "Voice call" : (callDisabledReason || "Voice call unavailable")}
                  aria-label="Start voice call"
                  aria-disabled={!peerCallable}
                  disabled={!peerCallable}
                  onClick={() => startDmCall("voice")}
                  className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-black/5 disabled:pointer-events-auto disabled:cursor-not-allowed"
                  style={{ color: peerCallable ? C.primary : C.onSurfaceVar, opacity: peerCallable ? 1 : 0.45 }}
                >
                  <CallIcon style={{ fontSize: 20 }} />
                </button>
                <button
                  type="button"
                  title={peerCallable ? "Video call" : (callDisabledReason || "Video call unavailable")}
                  aria-label="Start video call"
                  aria-disabled={!peerCallable}
                  disabled={!peerCallable}
                  onClick={() => startDmCall("video")}
                  className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-black/5 disabled:pointer-events-auto disabled:cursor-not-allowed"
                  style={{ color: peerCallable ? C.primary : C.onSurfaceVar, opacity: peerCallable ? 1 : 0.45 }}
                >
                  <VideocamIcon style={{ fontSize: 20 }} />
                </button>
              </>
            ) : null}
            <button onClick={e => { e.stopPropagation(); setHeaderMenu(o => !o); }} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-black/5" style={{ color:C.onSurfaceVar }}><MoreVertIcon style={{ fontSize:20 }} /></button>
            {headerMenu && (
              <div className="absolute right-0 top-full mt-1 w-52 rounded-2xl border shadow-xl z-50 overflow-hidden" style={{ background:C.surface, borderColor:C.outlineVar }}>
                <DropdownMenu items={makeMenuItems(sel, ()=>setHeaderMenu(false))} onClose={()=>setHeaderMenu(false)} />
              </div>
            )}
          </div>
        </div>
        {/* Message list */}
        <div className="flex-1 relative min-h-0 min-w-0 flex flex-col overflow-hidden" style={{ background:C.surfaceVar }} onClick={closeAll}>
          {threadReady && msgs.length > 0 ? (
            <Virtuoso
              key={`${sel.id}-${threadBootId}`}
              ref={virtuosoRef}
              className="flex-1 px-5 min-w-0"
              style={{ height: "100%", overflowX: "hidden" }}
              data={msgs}
              firstItemIndex={firstItemIndex}
              initialTopMostItemIndex={initialScrollIndex ?? msgs.length - 1}
              increaseViewportBy={{ top: 600, bottom: 600 }}
              defaultItemHeight={72}
              followOutput={() => {
                if (suppressFollowOutputRef.current) return false;
                return pinToBottomRef.current ? "auto" : false;
              }}
              startReached={() => { void loadOlderMessages(); }}
              endReached={() => { void loadNewerMessages(); }}
              atBottomStateChange={(atBottom) => {
                isNearBottomRef.current = atBottom;
                if (atBottom) {
                  if (unpinGraceTimer.current) {
                    clearTimeout(unpinGraceTimer.current);
                    unpinGraceTimer.current = null;
                  }
                  const convId = selIdRef.current;
                  const applyCaughtUp = () => {
                    // Abort if the user left this conversation or scrolled away.
                    if (selIdRef.current !== convId || !isNearBottomRef.current) return;
                    pinToBottomRef.current = true;
                    setShowJumpBtn(false);
                    setUnreadBelow(0);
                    // Use the ref — React state can be stale when atBottom fired before
                    // loadNewerMessages cleared hasMoreNewer (Discord catch-up race).
                    if (convId && msgsRef.current.length && !hasMoreNewerRef.current) {
                      const newest = [...msgsRef.current].reverse().find(m => m.id > 0)?.id
                        ?? msgsRef.current[msgsRef.current.length - 1].id;
                      markCaughtUpTo(newest, { atBottom: true });
                      scheduleMarkRead(convId);
                    }
                  };
                  // Defer mark-read after open-at-unread so Virtuoso's first at-bottom
                  // pulse does not clear the NEW separator before layout settles.
                  const suppressUntil = suppressMarkReadUntilRef.current;
                  if (markReadTimerRef.current) {
                    clearTimeout(markReadTimerRef.current);
                    markReadTimerRef.current = null;
                  }
                  if (Date.now() < suppressUntil) {
                    markReadTimerRef.current = setTimeout(() => {
                      markReadTimerRef.current = null;
                      applyCaughtUp();
                    }, suppressUntil - Date.now() + 16);
                    return;
                  }
                  applyCaughtUp();
                } else {
                  // Defer unpin: new rows briefly report not-at-bottom before followOutput catches up.
                  if (unpinGraceTimer.current) clearTimeout(unpinGraceTimer.current);
                  unpinGraceTimer.current = setTimeout(() => {
                    unpinGraceTimer.current = null;
                    if (!isNearBottomRef.current) {
                      pinToBottomRef.current = false;
                      setShowJumpBtn(sel.id > 0);
                    }
                  }, 80);
                }
              }}
              scrollerRef={(ref) => {
                if (ref instanceof HTMLElement) {
                  ref.classList.add("ninja-scroll");
                  if (!ref.dataset.scrollBound) {
                    ref.dataset.scrollBound = "1";
                    ref.addEventListener("scroll", () => {
                      ref.classList.add("is-scrolling");
                      if (virtuosoScrollTimer.current) clearTimeout(virtuosoScrollTimer.current);
                      virtuosoScrollTimer.current = setTimeout(() => ref.classList.remove("is-scrolling"), 900);
                    }, { passive: true });
                  }
                }
              }}
              rangeChanged={(range) => {
                visibleStartDataIndexRef.current = Math.max(0, range.startIndex - firstItemIndexRef.current);
                msgPerf.renderedRows(range.endIndex - range.startIndex + 1);
                // Backup catch-up: atBottom may have fired while hasMoreNewer was still true.
                // Require the live bottom flag so overscan (increaseViewportBy) cannot clear NEW early.
                if (
                  Date.now() >= suppressMarkReadUntilRef.current
                  && isNearBottomRef.current
                  && !hasMoreNewerRef.current
                  && msgsRef.current.length
                ) {
                  const newest = [...msgsRef.current].reverse().find(m => m.id > 0)?.id
                    ?? msgsRef.current[msgsRef.current.length - 1]?.id;
                  if (newest != null && (lastReadMessageIdRef.current == null || newest > lastReadMessageIdRef.current)) {
                    markCaughtUpTo(newest, { atBottom: true });
                    if (selIdRef.current) scheduleMarkRead(selIdRef.current);
                  }
                }
              }}
              components={{
                Header: () => (
                  <div className="flex flex-col items-center justify-center min-h-[28px] py-3 gap-1">
                    {loadingOlder ? (
                      <CircularProgress size={18} thickness={4} style={{ color: C.primary }} />
                    ) : !hasMoreOlder ? (
                      <span className="text-[11px]" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>Beginning of conversation</span>
                    ) : (
                      <span className="text-[11px] opacity-50" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>Scroll for older messages</span>
                    )}
                  </div>
                ),
                Footer: () => (
                  <div className="pb-3">
                    {loadingNewer && (
                      <div className="flex justify-center py-2">
                        <CircularProgress size={16} thickness={4} style={{ color: C.primary }} />
                      </div>
                    )}
                  </div>
                ),
              }}
              itemContent={(absoluteIndex, m) => {
                const dataIndex = absoluteIndex - firstItemIndex;
                const prev = dataIndex > 0 ? msgs[dataIndex - 1] : undefined;
                return (
                  <MessageRow
                    m={m}
                    prev={prev}
                    lastReadMessageId={lastReadMessageId}
                    currentUserId={currentUserId}
                    isMobile={isMobile}
                    C={C}
                    editingId={editingId}
                    editText={editingId === m.id ? editText : ""}
                    setEditText={setEditText}
                    setEditingId={setEditingId}
                    registerRef={(id, el) => {
                      if (el) msgRefs.current.set(id, el);
                      else msgRefs.current.delete(id);
                    }}
                    onScrollTo={scrollTo}
                    onLightbox={setLightbox}
                    onReply={startReply}
                    onReact={addReaction}
                    reactionOpen={openReactionId === m.id}
                    onReactionOpenChange={(open) => setOpenReactionId(open ? m.id : null)}
                    onDelete={(id) => askConfirm("Delete Message", "Delete this message permanently?", () => deleteMsg(id))}
                    onAdminDelete={(id) => { void deleteMsg(id); }}
                    canAdminDelete={!!currentUser?.isAdmin && sel.type === "channel"}
                    onReport={(id) => askConfirm("Report Message", "Report this message for inappropriate content?", () => { api.messages.report({ messageId: id, reason: "Inappropriate content" }).then(() => toast.success("Report submitted")).catch(() => toast.error("Failed to submit report")); })}
                    onCommitEdit={commitEdit}
                    onOpenProfile={openUserProfileFromMessage}
                  />
                );
              }}
            />
          ) : threadReady ? (
            <div className="flex-1 flex items-center justify-center px-6">
              <p className="text-sm text-center" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                {sel.id > 0 ? "No messages yet — say hello!" : "Select a conversation"}
              </p>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <CircularProgress size={28} thickness={4} style={{ color: C.primary }} />
            </div>
          )}
          {showJumpBtn && sel.id > 0 && (
            <div
              className="absolute z-20 transition-all duration-200 ease-out animate-in fade-in zoom-in-95"
              style={{ right: 28, bottom: 28 }}
            >
              <Badge
                badgeContent={unreadBelow > 0 ? (unreadBelow > 99 ? "99+" : unreadBelow) : 0}
                color="error"
                overlap="circular"
                invisible={unreadBelow <= 0}
              >
                <button
                  type="button"
                  onClick={async () => {
                    await jumpToLatest();
                    forceScrollToBottom("smooth");
                    if (sel?.id) {
                      scheduleMarkRead(sel.id);
                      const newest = [...msgsRef.current].reverse().find(m => m.id > 0)?.id
                        ?? msgsRef.current[msgsRef.current.length - 1]?.id;
                      markCaughtUpTo(newest, { atBottom: true });
                    }
                  }}
                  className="w-12 h-12 rounded-full flex items-center justify-center hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 transition-transform hover:scale-105"
                  style={{
                    background: C.bg === "#FFFBFE" ? "#1C1B1F" : "#FFFFFF",
                    color: C.bg === "#FFFBFE" ? "#FFFFFF" : "#1C1B1F",
                    boxShadow: SH1,
                  }}
                  aria-label="Jump to latest message"
                  title="Jump to latest"
                >
                  <KeyboardArrowDownIcon style={{ fontSize: 26, color: "inherit" }} />
                </button>
              </Badge>
            </div>
          )}
        </div>
        {/* Input bar — typing strip is anchored here (not in the message list). */}
        <div className="border-t shrink-0" style={{ background:C.surface, borderColor:C.outlineVar }}>
          <TypingIndicatorStrip label={typingLabel} color={C.onSurfaceVar} />
          {replyingTo && (
            <div className="flex items-center gap-3 px-5 py-2 border-b" style={{ borderColor:C.outlineVar, background:C.surfaceVar }}>
              <ReplyIcon style={{ fontSize:16, color:C.primary }} />
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium" style={{ color:C.primary, fontFamily:"Roboto" }}>Replying to {replyingTo.user}</span>
                <p className="text-xs truncate" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>
                  <MediaPreviewLine text={replyingTo.msg || "Attachment"} previewKind={replyingTo.mediaType} fileName={replyingTo.fileName} color={C.onSurfaceVar} iconSize={12} />
                </p>
              </div>
              <button onClick={() => setReplyingTo(null)} className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-black/8" style={{ color:C.onSurfaceVar }}><CloseIcon style={{ fontSize:14 }} /></button>
            </div>
          )}
          {(pendingPaste || uploadingPaste) && (
            <div className="flex items-center gap-3 px-5 py-2.5 border-b" style={{ borderColor: C.outlineVar, background: C.surfaceVar }}>
              <div
                className="relative shrink-0 overflow-hidden rounded-lg border"
                style={{ width: 56, height: 56, borderColor: C.outlineVar, background: C.bg }}
              >
                {pendingPaste ? (
                  <img src={pendingPaste.previewUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <CircularProgress size={22} thickness={4} style={{ color: C.primary }} />
                  </div>
                )}
                {uploadingPaste && pendingPaste && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <CircularProgress size={22} thickness={4} style={{ color: "#fff" }} />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
                  {pendingPaste?.file.name || "Uploading screenshot…"}
                </p>
                <p className="text-xs" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                  {pendingPaste ? formatBytes(pendingPaste.file.size) : "Please wait"}
                  {pendingPaste ? " · Image" : ""}
                </p>
              </div>
              {!uploadingPaste && (
                <button
                  type="button"
                  onClick={clearPendingPaste}
                  className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-black/8 shrink-0"
                  style={{ color: C.onSurfaceVar }}
                  title="Remove attachment"
                  aria-label="Remove screenshot attachment"
                >
                  <CloseIcon style={{ fontSize: 18 }} />
                </button>
              )}
            </div>
          )}
          <div className="px-5 py-3 relative">
            {emojiOpen && (
              <div ref={emojiPickerRef} className="fixed z-40" style={{ right: emojiPickerPos.right, bottom: emojiPickerPos.bottom }} onClick={e => e.stopPropagation()}>
                <Suspense fallback={
                  <div className="w-80 h-64 rounded-2xl border flex items-center justify-center" style={{ background: C.surface, borderColor: C.outlineVar }}>
                    <CircularProgress size={28} />
                  </div>
                }>
                  <EmojiGifPicker
                    onPickEmoji={(em) => {
                      setInput(i => i + em);
                      requestAnimationFrame(adjustComposerHeight);
                    }}
                    onPickGif={(g) => { void sendGifItem(g); }}
                  />
                </Suspense>
              </div>
            )}
            <input ref={fileRef} type="file" className="hidden" onChange={handleFile} />
            <div
              className="flex items-center gap-2 rounded-[24px] border px-4 py-2.5 cursor-text min-w-0"
              style={{ borderColor:C.outlineVar }}
              onMouseDown={e => {
                const target = e.target as HTMLElement;
                if (target.closest("button") || target.closest("a") || target.tagName === "TEXTAREA" || target.tagName === "AUDIO") return;
                if (settingsOpen || newDmOpen || confirm || emojiOpen || voiceBusy) return;
                e.preventDefault();
                inputRef.current?.focus();
              }}
            >
              {!voiceBusy && (
                <button type="button" className="shrink-0 self-center" onClick={() => fileRef.current?.click()} style={{ color:C.onSurfaceVar }} title={`Attach a file (max ${MESSAGE_MAX_FILE_LABEL})`} aria-label={`Attach file, maximum ${MESSAGE_MAX_FILE_LABEL}`}><AttachFileIcon style={{ fontSize:20 }} /></button>
              )}
              <VoiceRecorderButton disabled={!sel.id || uploadingPaste} onSend={sendVoiceFile} onBusyChange={setVoiceBusy} />
              {!voiceBusy && (
                <>
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={e => { handleInputChange(e.target.value); requestAnimationFrame(adjustComposerHeight); }}
                onPaste={handleComposerPaste}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (!uploadingPaste) void send();
                  } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                    e.preventDefault();
                    if (!uploadingPaste) void send();
                  }
                }}
                placeholder={pendingPaste ? "Press Send to upload screenshot…" : `Message ${sel.name}...`}
                className="flex-1 min-w-0 bg-transparent text-sm focus:outline-none resize-none leading-5 py-0.5"
                style={{ color:C.onSurface, fontFamily:"Roboto", maxHeight: COMPOSER_MAX_HEIGHT, overflowY: "auto" }}
                onClick={() => setEmojiOpen(false)}
                disabled={uploadingPaste}
              />
              <button type="button" ref={emojiBtnRef} className="shrink-0 self-center" onClick={e => { e.stopPropagation(); setEmojiOpen(o => !o); }} style={{ color:emojiOpen?C.primary:C.onSurfaceVar }} title="Emoji / GIF" aria-label="Open emoji and GIF picker"><EmojiEmotionsIcon style={{ fontSize:20 }} /></button>
              <button
                type="button"
                onClick={() => { if (!uploadingPaste) void send(); }}
                disabled={uploadingPaste || (!input.trim() && !pendingPaste)}
                className="w-8 h-8 rounded-full flex items-center justify-center ml-1 text-white hover:opacity-90 shrink-0 self-center disabled:opacity-50"
                style={{ background:C.primary }}
                aria-label="Send message"
              >
                {uploadingPaste ? <CircularProgress size={14} thickness={5} style={{ color: "#fff" }} /> : <SendIcon style={{ fontSize:16 }} />}
              </button>
                </>
              )}
            </div>
          </div>
        </div>
        </>
        )}
      </div>
      )}
      {/* Right panel — web: lg+; Electron: width-driven rail with animated open/close */}
      {listFilter !== "dm-requests" && sel.id > 0 && (
        desktopMode ? (
          <aside
            className={`ninja-desktop-details border-l flex flex-col shrink-0 overflow-y-auto ninja-scroll${showDesktopRightRail ? " is-open" : ""}`}
            style={{ background: C.surface, borderColor: C.outlineVar }}
            aria-hidden={!showDesktopRightRail}
            onScroll={onScrollReveal}
          >
            <div className="ninja-desktop-details-inner p-5 min-w-[18rem]">
              <ConversationDetailsBody sel={sel} C={C} presenceColor={presenceColor} presenceLabel={presenceLabel} />
            </div>
          </aside>
        ) : (
          <div className="hidden lg:flex w-72 border-l flex-col p-5 shrink-0 overflow-y-auto ninja-scroll" style={{ background:C.surface, borderColor:C.outlineVar }} onScroll={onScrollReveal}>
            <ConversationDetailsBody sel={sel} C={C} presenceColor={presenceColor} presenceLabel={presenceLabel} />
          </div>
        )
      )}
      {/* Conversation / user details modal — mobile, and Electron when the right rail is collapsed */}
      {detailsOpen && (isMobile || (desktopMode && !showDesktopRightRail)) && detailsContact && (
        <div
          className={`fixed inset-x-0 bottom-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4${desktopMode ? "" : " bg-black/50 backdrop-blur-sm"}`}
          style={{
            top: desktopMode ? "var(--ninja-titlebar-h, 44px)" : 0,
            ...(desktopMode ? { background: "rgba(0,0,0,0.5)" } : undefined),
          }}
          role="dialog"
          aria-modal="true"
          aria-label={detailsContact.type === "channel" ? "Channel details" : "User profile"}
          onClick={dismissConversationDetails}
        >
          <div
            className="w-full sm:max-w-sm max-h-[85vh] overflow-y-auto ninja-scroll rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl"
            style={{ background: C.surface }}
            onClick={e => e.stopPropagation()}
            onScroll={onScrollReveal}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-base" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
                {detailsContact.type === "channel" ? "Channel Info" : "Profile"}
              </h3>
              <button
                type="button"
                onClick={dismissConversationDetails}
                className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-black/5"
                style={{ color: C.onSurfaceVar }}
                aria-label="Close details"
              >
                <CloseIcon style={{ fontSize: 18 }} />
              </button>
            </div>
            <ConversationDetailsBody sel={detailsContact} C={C} presenceColor={presenceColor} presenceLabel={presenceLabel} />
          </div>
        </div>
      )}
    </div>
  );
}

export default MessagesPage;

