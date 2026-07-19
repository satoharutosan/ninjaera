import { randomUUID } from "crypto";
import { qGet, qRun } from "../db/query.js";
import { assertCanAccessConversation, usersAreBlocked } from "./conversationAccess.js";

export type CallType = "voice" | "video";
export type CallState = "ringing" | "active" | "ended";

export type ActiveCall = {
  id: string;
  type: CallType;
  conversationId: number;
  callerId: number;
  calleeId: number;
  state: CallState;
  createdAt: number;
  ringTimer?: ReturnType<typeof setTimeout>;
};

const RING_TIMEOUT_MS = Number(process.env.CALL_RING_TIMEOUT_MS) || 45_000;

type EndHandler = (call: ActiveCall, reason: string, notifyMissed: boolean, wasActive: boolean) => void | Promise<void>;

let onCallEnded: EndHandler | null = null;

/** Register emit/notification side-effects from realtime init (avoids circular imports). */
export function setCallEndedHandler(handler: EndHandler) {
  onCallEnded = handler;
}

const callsById = new Map<string, ActiveCall>();
const callByUser = new Map<number, string>();

/** Coerce DB/socket IDs — Postgres BIGINT often arrives as string from node-pg. */
export function asUserId(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function sameUser(a: unknown, b: unknown): boolean {
  const na = asUserId(a);
  const nb = asUserId(b);
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
}

export function getCall(callId: string) {
  return callsById.get(callId);
}

export function getUserCall(userId: number) {
  const id = callByUser.get(asUserId(userId));
  return id ? callsById.get(id) : undefined;
}

export function isPrivilegedMember(user: { is_team_member?: number; is_admin?: number } | null | undefined) {
  if (!user) return false;
  return user.is_team_member === 1 || user.is_admin === 1;
}

/** At least one participant must be a team member (or admin). User↔User is blocked. */
export async function canParticipantsCall(callerId: number, calleeId: number): Promise<{ ok: boolean; error?: string }> {
  const a = asUserId(callerId);
  const b = asUserId(calleeId);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) {
    return { ok: false, error: "Invalid call target" };
  }
  const caller = await qGet<{ is_team_member: number; is_admin: number; is_deleted: number }>(
    "SELECT is_team_member, is_admin, is_deleted FROM users WHERE id = ?", a,
  );
  const callee = await qGet<{ is_team_member: number; is_admin: number; is_deleted: number }>(
    "SELECT is_team_member, is_admin, is_deleted FROM users WHERE id = ?", b,
  );
  if (!caller || !callee) return { ok: false, error: "User not found" };
  if (caller.is_deleted === 1 || callee.is_deleted === 1) {
    return { ok: false, error: "This user is no longer available" };
  }
  if (!isPrivilegedMember(caller) && !isPrivilegedMember(callee)) {
    return {
      ok: false,
      error: "Voice and video calls require at least one team member in the conversation.",
    };
  }
  return { ok: true };
}

async function endCallInternal(call: ActiveCall, reason: string, notifyMissed = false) {
  if (call.ringTimer) {
    clearTimeout(call.ringTimer);
    call.ringTimer = undefined;
  }
  const wasActive = call.state === "active";
  call.state = "ended";
  callsById.delete(call.id);
  callByUser.delete(call.callerId);
  callByUser.delete(call.calleeId);
  await onCallEnded?.(call, reason, notifyMissed, wasActive);
}

export async function startCall(opts: {
  type: CallType;
  conversationId: number;
  callerId: number;
  calleeId: number;
}): Promise<{ ok: true; call: ActiveCall } | { ok: false; error: string; code?: string }> {
  const callerId = asUserId(opts.callerId);
  const calleeId = asUserId(opts.calleeId);
  const conversationId = asUserId(opts.conversationId);
  if (!Number.isFinite(callerId) || !Number.isFinite(calleeId) || !Number.isFinite(conversationId)) {
    return { ok: false, error: "Invalid call", code: "invalid" };
  }

  const perm = await canParticipantsCall(callerId, calleeId);
  if (!perm.ok) return { ok: false, error: perm.error || "Not allowed", code: "forbidden" };

  if (await usersAreBlocked(callerId, calleeId)) {
    return { ok: false, error: "You cannot call this user", code: "blocked" };
  }

  if (getUserCall(callerId)) {
    return { ok: false, error: "You are already in a call.", code: "busy" };
  }
  if (getUserCall(calleeId)) {
    return { ok: false, error: "User is busy", code: "busy" };
  }

  const access = await assertCanAccessConversation(callerId, conversationId);
  if (!access.ok) return { ok: false, error: access.error, code: "forbidden" };
  const peerAccess = await assertCanAccessConversation(calleeId, conversationId);
  if (!peerAccess.ok) return { ok: false, error: "Not a participant", code: "forbidden" };

  const call: ActiveCall = {
    id: randomUUID(),
    type: opts.type,
    conversationId,
    callerId,
    calleeId,
    state: "ringing",
    createdAt: Date.now(),
  };

  call.ringTimer = setTimeout(() => {
    const current = callsById.get(call.id);
    if (current && current.state === "ringing") {
      void endCallInternal(current, "timeout", true);
    }
  }, RING_TIMEOUT_MS);

  callsById.set(call.id, call);
  callByUser.set(callerId, call.id);
  callByUser.set(calleeId, call.id);

  return { ok: true, call };
}

export function acceptCall(callId: string, userId: number): { ok: true; call: ActiveCall } | { ok: false; error: string; code?: string } {
  const call = callsById.get(callId);
  if (!call) return { ok: false, error: "Call not found", code: "not_found" };
  if (!sameUser(call.calleeId, userId)) {
    return { ok: false, error: "This call is no longer available", code: "forbidden" };
  }
  if (call.state !== "ringing") return { ok: false, error: "Call is not ringing", code: "invalid_state" };
  if (call.ringTimer) {
    clearTimeout(call.ringTimer);
    call.ringTimer = undefined;
  }
  call.state = "active";
  return { ok: true, call };
}

export async function declineCall(callId: string, userId: number): Promise<{ ok: true; call: ActiveCall } | { ok: false; error: string; code?: string }> {
  const call = callsById.get(callId);
  if (!call) return { ok: false, error: "Call not found", code: "not_found" };
  if (!sameUser(call.calleeId, userId) && !sameUser(call.callerId, userId)) {
    return { ok: false, error: "This call is no longer available", code: "forbidden" };
  }
  const snapshot = { ...call };
  await endCallInternal(call, "declined", false);
  return { ok: true, call: snapshot };
}

export async function hangupCall(callId: string, userId: number): Promise<{ ok: true } | { ok: false; error: string; code?: string }> {
  const call = callsById.get(callId);
  if (!call) return { ok: false, error: "Call not found", code: "not_found" };
  if (!sameUser(call.calleeId, userId) && !sameUser(call.callerId, userId)) {
    return { ok: false, error: "This call is no longer available", code: "forbidden" };
  }
  let reason = "hangup";
  if (call.state === "ringing") {
    reason = sameUser(userId, call.callerId) ? "cancelled" : "declined";
  }
  await endCallInternal(call, reason, false);
  return { ok: true };
}

/** End a ringing/active call as a connection/auth failure (both sides clear UI). */
export async function failCall(callId: string, userId: number): Promise<{ ok: true } | { ok: false; error: string; code?: string }> {
  const call = callsById.get(callId);
  if (!call) return { ok: false, error: "Call not found", code: "not_found" };
  if (!sameUser(call.calleeId, userId) && !sameUser(call.callerId, userId)) {
    return { ok: false, error: "This call is no longer available", code: "forbidden" };
  }
  await endCallInternal(call, "failed", false);
  return { ok: true };
}

/** Callee already in another call — end ringing invite as busy. */
export async function busyCall(callId: string, userId: number): Promise<{ ok: true; call: ActiveCall } | { ok: false; error: string; code?: string }> {
  const call = callsById.get(callId);
  if (!call) return { ok: false, error: "Call not found", code: "not_found" };
  if (!sameUser(call.calleeId, userId)) {
    return { ok: false, error: "This call is no longer available", code: "forbidden" };
  }
  if (call.state !== "ringing") return { ok: false, error: "Call is not ringing", code: "invalid_state" };
  const snapshot = { ...call };
  await endCallInternal(call, "busy", false);
  return { ok: true, call: snapshot };
}

/**
 * Recipient dismissed the incoming UI — end the ring for both sides so the
 * caller is never stuck on "Calling…". Persists as declined/rejected.
 */
export async function ignoreCall(callId: string, userId: number): Promise<{ ok: true; call: ActiveCall } | { ok: false; error: string; code?: string }> {
  const call = callsById.get(callId);
  if (!call) return { ok: false, error: "Call not found", code: "not_found" };
  if (!sameUser(call.calleeId, userId)) {
    return { ok: false, error: "This call is no longer available", code: "forbidden" };
  }
  if (call.state !== "ringing") return { ok: false, error: "Call is not ringing", code: "invalid_state" };
  const snapshot = { ...call };
  await endCallInternal(call, "declined", false);
  return { ok: true, call: snapshot };
}

export function assertCallParticipant(callId: string, userId: number) {
  const call = callsById.get(callId);
  if (!call) return null;
  if (!sameUser(call.callerId, userId) && !sameUser(call.calleeId, userId)) return null;
  return call;
}

export function peerIdFor(call: ActiveCall, userId: number) {
  return sameUser(call.callerId, userId) ? call.calleeId : call.callerId;
}

export async function cleanupUserCalls(userId: number) {
  const uid = asUserId(userId);
  const call = getUserCall(uid);
  if (!call) return;
  if (call.state === "ringing" && sameUser(uid, call.callerId)) {
    await endCallInternal(call, "cancelled", false);
    return;
  }
  if (call.state === "ringing" && sameUser(uid, call.calleeId)) {
    await endCallInternal(call, "timeout", true);
    return;
  }
  await endCallInternal(call, "disconnect", false);
}

export async function insertMissedCallNotification(call: ActiveCall) {
  const caller = await qGet<{ username: string }>("SELECT username FROM users WHERE id = ?", call.callerId);
  const title = call.type === "video" ? "Missed video call" : "Missed voice call";
  const body = `${caller?.username || "Someone"} tried to reach you.`;
  const ts = new Date().toISOString();
  await qRun(`
    INSERT INTO notifications (title, body, source, page, user_id, notif_type, metadata, created_at)
    VALUES (?, ?, 'Calls', 'messages', ?, 'missed_call', ?, ?)
  `,
    title,
    body,
    call.calleeId,
    JSON.stringify({
      callId: call.id,
      callerId: call.callerId,
      conversationId: call.conversationId,
      type: call.type,
    }),
    ts,
  );
}
