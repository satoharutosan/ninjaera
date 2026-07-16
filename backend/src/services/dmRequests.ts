/**
 * DM request accept / reject — portable across SQLite and PostgreSQL.
 * Avoids SQLite-only json_extract/json_set (which break acceptance on Railway Postgres
 * after the DM conversation was already created).
 */
import { qGet, qAll, qRun, qTransaction } from "../db/query.js";
import { emitToUser, getConversationParticipantIds } from "./realtime.js";
import { isDeletedUser } from "./deletedUser.js";

const now = () => new Date().toISOString();

export type DmPeerInfo = {
  id: number;
  userId: number;
  username: string;
  avatarUrl: string | null;
};

export type AcceptDmSuccess = {
  success: true;
  message: string;
  alreadyExists?: boolean;
  conversationId: number;
  requestId: number;
  dm: DmPeerInfo;
};

export type AcceptDmFailure = {
  success: false;
  status: number;
  error: string;
};

export type AcceptDmResult = AcceptDmSuccess | AcceptDmFailure;

export type RejectDmResult =
  | { success: true; message: string; requestId: number }
  | { success: false; status: number; error: string };

async function findDmConversation(userId1: number, userId2: number): Promise<number | null> {
  const row = await qGet<{ id: number }>(`
    SELECT c.id FROM conversations c
    JOIN conversation_participants cp1 ON cp1.conversation_id = c.id AND cp1.user_id = ?
    JOIN conversation_participants cp2 ON cp2.conversation_id = c.id AND cp2.user_id = ?
    WHERE c.type = 'dm'
    LIMIT 1
  `, userId1, userId2);
  return row?.id ?? null;
}

async function addContactPair(userId: number, contactUserId: number, ts: string) {
  await qRun(
    "INSERT OR IGNORE INTO dm_contacts (user_id, contact_user_id, created_at) VALUES (?, ?, ?)",
    userId, contactUserId, ts,
  );
  await qRun(
    "INSERT OR IGNORE INTO dm_contacts (user_id, contact_user_id, created_at) VALUES (?, ?, ?)",
    contactUserId, userId, ts,
  );
}

async function createDmConversation(requesterId: number, recipientId: number): Promise<number> {
  const existing = await findDmConversation(requesterId, recipientId);
  if (existing) return existing;

  const ts = now();
  const requester = await qGet<{ username: string; bio: string }>(
    "SELECT username, bio FROM users WHERE id = ?", requesterId,
  );
  const result = await qRun(
    "INSERT INTO conversations (type, name, bio, created_at) VALUES ('dm', ?, ?, ?)",
    requester?.username || "DM",
    requester?.bio || "",
    ts,
  );
  const convId = Number(result.lastInsertRowid);
  await qRun(
    "INSERT INTO conversation_participants (conversation_id, user_id, joined_at) VALUES (?, ?, ?)",
    convId, requesterId, ts,
  );
  await qRun(
    "INSERT INTO conversation_participants (conversation_id, user_id, joined_at) VALUES (?, ?, ?)",
    convId, recipientId, ts,
  );
  await addContactPair(requesterId, recipientId, ts);
  return convId;
}

/** Portable replacement for SQLite json_extract/json_set on notification metadata. */
export async function markDmRequestNotificationsProcessed(
  requestId: number,
  recipientId: number,
): Promise<void> {
  const rows = await qAll<{ id: number; metadata: string | null }>(`
    SELECT id, metadata FROM notifications
    WHERE notif_type = 'dm_request' AND user_id = ?
  `, recipientId);
  for (const row of rows) {
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(row.metadata || "{}") as Record<string, unknown>;
    } catch {
      meta = {};
    }
    if (Number(meta.requestId) !== Number(requestId)) continue;
    await qRun(
      "UPDATE notifications SET metadata = ? WHERE id = ?",
      JSON.stringify({ ...meta, processed: true }),
      row.id,
    );
  }
}

async function loadPeerForViewer(
  peerUserId: number,
  conversationId: number,
): Promise<DmPeerInfo> {
  const peer = await qGet<{
    id: number;
    username: string | null;
    avatar_url: string | null;
    is_deleted: number | null;
  }>("SELECT id, username, avatar_url, is_deleted FROM users WHERE id = ?", peerUserId);

  if (!peer || isDeletedUser(peer) || !peer.username) {
    return {
      id: conversationId,
      userId: peerUserId,
      username: "Deleted User",
      avatarUrl: null,
    };
  }
  return {
    id: conversationId,
    userId: peer.id,
    username: peer.username,
    avatarUrl: peer.avatar_url,
  };
}

function emitAcceptEvents(opts: {
  requestId: number;
  conversationId: number;
  recipientId: number;
  requesterId: number;
  dmForRecipient: DmPeerInfo;
  dmForRequester: DmPeerInfo;
}) {
  const { requestId, conversationId, recipientId, requesterId, dmForRecipient, dmForRequester } = opts;
  void getConversationParticipantIds(conversationId).then((pids) => {
    for (const pid of pids) {
      emitToUser(pid, "conversation:new", { conversationId });
      emitToUser(pid, "conversation:update", { conversationId });
    }
  });

  emitToUser(recipientId, "dm_request:accepted", {
    requestId,
    conversationId,
    dm: dmForRecipient,
  });
  emitToUser(requesterId, "dm_request:accepted", {
    requestId,
    conversationId,
    dm: dmForRequester,
  });
  emitToUser(recipientId, "dm_request:resolved", { requestId, conversationId });
  emitToUser(requesterId, "dm_request:resolved", { requestId, conversationId });
  emitToUser(requesterId, "notification:new", {});
  emitToUser(recipientId, "counts:update", {});
  emitToUser(requesterId, "counts:update", {});
}

/**
 * Accept a pending DM request for `recipientId`.
 * Idempotent: already-accepted (or existing DM) returns success with the conversation.
 */
export async function acceptDmRequest(
  requestId: number,
  recipientId: number,
  recipientUsername: string,
): Promise<AcceptDmResult> {
  if (!Number.isFinite(requestId) || requestId <= 0) {
    return { success: false, status: 400, error: "Invalid request id" };
  }

  const existing = await qGet<{
    id: number;
    requester_id: number;
    recipient_id: number;
    status: string;
    conversation_id: number | null;
  }>("SELECT * FROM dm_requests WHERE id = ? AND recipient_id = ?", requestId, recipientId);

  if (!existing) {
    return { success: false, status: 404, error: "DM request not found" };
  }

  // Already accepted — return existing DM without duplicating.
  if (existing.status === "accepted") {
    let convId = existing.conversation_id
      ? Number(existing.conversation_id)
      : await findDmConversation(existing.requester_id, existing.recipient_id);
    if (!convId) {
      convId = await createDmConversation(existing.requester_id, existing.recipient_id);
      await qRun(
        "UPDATE dm_requests SET conversation_id = ?, updated_at = ? WHERE id = ?",
        convId, now(), requestId,
      );
    }
    await markDmRequestNotificationsProcessed(requestId, recipientId);
    const dm = await loadPeerForViewer(existing.requester_id, convId);
    emitAcceptEvents({
      requestId,
      conversationId: convId,
      recipientId,
      requesterId: existing.requester_id,
      dmForRecipient: dm,
      dmForRequester: await loadPeerForViewer(recipientId, convId),
    });
    return {
      success: true,
      message: "DM already exists",
      alreadyExists: true,
      conversationId: convId,
      requestId,
      dm,
    };
  }

  if (existing.status !== "pending") {
    return { success: false, status: 404, error: "DM request not found" };
  }

  const requester = await qGet<{
    id: number;
    username: string | null;
    avatar_url: string | null;
    is_deleted: number | null;
  }>("SELECT id, username, avatar_url, is_deleted FROM users WHERE id = ?", existing.requester_id);

  if (!requester || isDeletedUser(requester) || !requester.username) {
    await qTransaction(async () => {
      await qRun(
        "UPDATE dm_requests SET status = 'rejected', updated_at = ? WHERE id = ?",
        now(), requestId,
      );
      await markDmRequestNotificationsProcessed(requestId, recipientId);
    });
    emitToUser(recipientId, "dm_request:resolved", { requestId });
    emitToUser(recipientId, "counts:update", {});
    return { success: false, status: 410, error: "User unavailable" };
  }

  try {
    const result = await qTransaction(async () => {
      const convId = await createDmConversation(existing.requester_id, existing.recipient_id);
      const ts = now();
      await qRun(
        "UPDATE dm_requests SET status = 'accepted', conversation_id = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
        convId, ts, requestId,
      );
      await markDmRequestNotificationsProcessed(requestId, recipientId);
      await qRun(`
        INSERT INTO notifications (title, body, source, page, user_id, notif_type, created_at)
        VALUES ('Request Accepted', ?, 'Messages', 'messages', ?, 'announcement', ?)
      `, `${recipientUsername} accepted your direct message request.`, existing.requester_id, ts);
      return convId;
    });

    const dm = await loadPeerForViewer(existing.requester_id, result);
    emitAcceptEvents({
      requestId,
      conversationId: result,
      recipientId,
      requesterId: existing.requester_id,
      dmForRecipient: dm,
      dmForRequester: await loadPeerForViewer(recipientId, result),
    });

    return {
      success: true,
      message: "DM request accepted",
      conversationId: result,
      requestId,
      dm,
    };
  } catch (err) {
    // Race: another session accepted first — resolve to existing DM.
    const again = await qGet<{ status: string; conversation_id: number | null; requester_id: number }>(
      "SELECT status, conversation_id, requester_id FROM dm_requests WHERE id = ?", requestId,
    );
    if (again?.status === "accepted") {
      const convId = again.conversation_id
        ? Number(again.conversation_id)
        : await findDmConversation(again.requester_id, recipientId);
      if (convId) {
        const dm = await loadPeerForViewer(again.requester_id, convId);
        return {
          success: true,
          message: "DM already exists",
          alreadyExists: true,
          conversationId: convId,
          requestId,
          dm,
        };
      }
    }
    const existingConv = await findDmConversation(existing.requester_id, recipientId);
    if (existingConv) {
      await qRun(
        "UPDATE dm_requests SET status = 'accepted', conversation_id = ?, updated_at = ? WHERE id = ?",
        existingConv, now(), requestId,
      );
      await markDmRequestNotificationsProcessed(requestId, recipientId);
      const dm = await loadPeerForViewer(existing.requester_id, existingConv);
      emitAcceptEvents({
        requestId,
        conversationId: existingConv,
        recipientId,
        requesterId: existing.requester_id,
        dmForRecipient: dm,
        dmForRequester: await loadPeerForViewer(recipientId, existingConv),
      });
      return {
        success: true,
        message: "DM already exists",
        alreadyExists: true,
        conversationId: existingConv,
        requestId,
        dm,
      };
    }
    console.error("[dm] accept failed:", err);
    return { success: false, status: 500, error: "Could not accept DM request" };
  }
}

export async function rejectDmRequest(
  requestId: number,
  recipientId: number,
  recipientUsername: string,
): Promise<RejectDmResult> {
  if (!Number.isFinite(requestId) || requestId <= 0) {
    return { success: false, status: 400, error: "Invalid request id" };
  }

  const request = await qGet<{ id: number; requester_id: number; status: string }>(`
    SELECT id, requester_id, status FROM dm_requests
    WHERE id = ? AND recipient_id = ?
  `, requestId, recipientId);

  if (!request) {
    return { success: false, status: 404, error: "DM request not found" };
  }

  if (request.status !== "pending") {
    // Idempotent — already resolved
    await markDmRequestNotificationsProcessed(requestId, recipientId);
    emitToUser(recipientId, "dm_request:resolved", { requestId });
    emitToUser(recipientId, "counts:update", {});
    return { success: true, message: "Request already resolved", requestId };
  }

  const ts = now();
  await qTransaction(async () => {
    await qRun(
      "UPDATE dm_requests SET status = 'rejected', updated_at = ? WHERE id = ? AND status = 'pending'",
      ts, requestId,
    );
    await markDmRequestNotificationsProcessed(requestId, recipientId);
    await qRun(`
      INSERT INTO notifications (title, body, source, page, user_id, notif_type, created_at)
      VALUES ('Request Declined', ?, 'Messages', 'messages', ?, 'announcement', ?)
    `, `${recipientUsername} declined your direct message request.`, request.requester_id, ts);
  });

  emitToUser(request.requester_id, "notification:new", {});
  emitToUser(request.requester_id, "counts:update", {});
  emitToUser(recipientId, "dm_request:resolved", { requestId });
  emitToUser(recipientId, "counts:update", {});

  return { success: true, message: "DM request declined", requestId };
}
