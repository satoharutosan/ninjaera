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

export function getCall(callId: string) {
  return callsById.get(callId);
}

export function getUserCall(userId: number) {
  const id = callByUser.get(userId);
  return id ? callsById.get(id) : undefined;
}

export function isPrivilegedMember(user: { is_team_member?: number; is_admin?: number } | null | undefined) {
  if (!user) return false;
  return user.is_team_member === 1 || user.is_admin === 1;
}

/** At least one participant must be a team member (or admin). User↔User is blocked. */
export async function canParticipantsCall(callerId: number, calleeId: number): Promise<{ ok: boolean; error?: string }> {
  if (callerId === calleeId) return { ok: false, error: "Invalid call target" };
  const caller = await qGet<{ is_team_member: number; is_admin: number; is_deleted: number }>(
    "SELECT is_team_member, is_admin, is_deleted FROM users WHERE id = ?", callerId,
  );
  const callee = await qGet<{ is_team_member: number; is_admin: number; is_deleted: number }>(
    "SELECT is_team_member, is_admin, is_deleted FROM users WHERE id = ?", calleeId,
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
  const perm = await canParticipantsCall(opts.callerId, opts.calleeId);
  if (!perm.ok) return { ok: false, error: perm.error || "Not allowed", code: "forbidden" };

  if (await usersAreBlocked(opts.callerId, opts.calleeId)) {
    return { ok: false, error: "You cannot call this user", code: "blocked" };
  }

  if (getUserCall(opts.callerId)) {
    return { ok: false, error: "You are already in a call.", code: "busy" };
  }
  if (getUserCall(opts.calleeId)) {
    return { ok: false, error: "User is busy", code: "busy" };
  }

  const access = await assertCanAccessConversation(opts.callerId, opts.conversationId);
  if (!access.ok) return { ok: false, error: access.error, code: "forbidden" };
  const peerAccess = await assertCanAccessConversation(opts.calleeId, opts.conversationId);
  if (!peerAccess.ok) return { ok: false, error: "Not a participant", code: "forbidden" };

  const call: ActiveCall = {
    id: randomUUID(),
    type: opts.type,
    conversationId: opts.conversationId,
    callerId: opts.callerId,
    calleeId: opts.calleeId,
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
  callByUser.set(opts.callerId, call.id);
  callByUser.set(opts.calleeId, call.id);

  return { ok: true, call };
}

export function acceptCall(callId: string, userId: number): { ok: true; call: ActiveCall } | { ok: false; error: string } {
  const call = callsById.get(callId);
  if (!call) return { ok: false, error: "Call not found" };
  if (call.calleeId !== userId) return { ok: false, error: "Not authorized" };
  if (call.state !== "ringing") return { ok: false, error: "Call is not ringing" };
  if (call.ringTimer) {
    clearTimeout(call.ringTimer);
    call.ringTimer = undefined;
  }
  call.state = "active";
  return { ok: true, call };
}

export async function declineCall(callId: string, userId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const call = callsById.get(callId);
  if (!call) return { ok: false, error: "Call not found" };
  if (call.calleeId !== userId && call.callerId !== userId) return { ok: false, error: "Not authorized" };
  await endCallInternal(call, "declined", false);
  return { ok: true };
}

export async function hangupCall(callId: string, userId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const call = callsById.get(callId);
  if (!call) return { ok: false, error: "Call not found" };
  if (call.calleeId !== userId && call.callerId !== userId) return { ok: false, error: "Not authorized" };
  let reason = "hangup";
  if (call.state === "ringing") {
    reason = userId === call.callerId ? "cancelled" : "declined";
  }
  await endCallInternal(call, reason, false);
  return { ok: true };
}

/** Callee already in another call — end ringing invite as busy. */
export async function busyCall(callId: string, userId: number): Promise<{ ok: true; call: ActiveCall } | { ok: false; error: string }> {
  const call = callsById.get(callId);
  if (!call) return { ok: false, error: "Call not found" };
  if (call.calleeId !== userId) return { ok: false, error: "Not authorized" };
  if (call.state !== "ringing") return { ok: false, error: "Call is not ringing" };
  await endCallInternal(call, "busy", false);
  return { ok: true, call };
}

export function assertCallParticipant(callId: string, userId: number) {
  const call = callsById.get(callId);
  if (!call) return null;
  if (call.callerId !== userId && call.calleeId !== userId) return null;
  return call;
}

export function peerIdFor(call: ActiveCall, userId: number) {
  return call.callerId === userId ? call.calleeId : call.callerId;
}

export async function cleanupUserCalls(userId: number) {
  const call = getUserCall(userId);
  if (!call) return;
  if (call.state === "ringing" && userId === call.callerId) {
    await endCallInternal(call, "cancelled", false);
    return;
  }
  if (call.state === "ringing" && userId === call.calleeId) {
    // Callee vanished mid-ring — treat as missed for notification
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
