import { qGet, qRun } from "../db/query.js";
import { broadcast } from "./realtime.js";

export type ProfileUpdatedPayload = {
  userId: number;
  username: string;
  avatarUrl: string | null;
  bio: string;
  status: string;
  updatedAt: string;
};

/** Keep denormalized team card name aligned with users.username. */
export async function syncTeamMemberDisplayName(userId: number, username: string) {
  await qRun("UPDATE team_members SET name = ? WHERE user_id = ?", username, userId);
}

/** Broadcast identity changes so all clients can patch UI without a full refresh. */
export async function emitProfileUpdated(userId: number) {
  const row = await qGet<{
    username: string;
    avatar_url: string | null;
    bio: string | null;
    status: string | null;
    updated_at: string | null;
  }>("SELECT username, avatar_url, bio, status, updated_at FROM users WHERE id = ?", userId);
  if (!row) return;

  const payload: ProfileUpdatedPayload = {
    userId,
    username: row.username,
    avatarUrl: row.avatar_url,
    bio: row.bio ?? "",
    status: row.status || "Online",
    updatedAt: row.updated_at || new Date().toISOString(),
  };
  broadcast("profile:updated", payload);
}
