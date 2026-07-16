/**
 * Soft-deleted (and missing) user display — Discord-style tombstones.
 * Soft delete (`users.is_deleted = 1`) is the system of record; never hard-delete users
 * if message history must be preserved.
 */

export const DELETED_USER_DISPLAY_NAME = "Deleted User";

export type DisplayUser = {
  id: number;
  username: string;
  avatarUrl: string | null;
  isDeleted: boolean;
};

type UserLike = {
  id?: number | null;
  username?: string | null;
  avatar_url?: string | null;
  avatarUrl?: string | null;
  is_deleted?: number | null;
  isDeleted?: boolean | null;
} | null | undefined;

export function isDeletedUser(user: UserLike): boolean {
  if (!user) return true;
  if (user.isDeleted === true) return true;
  if (user.is_deleted === 1) return true;
  return false;
}

/** Safe public display fields for any user row (or missing row). */
export function toDisplayUser(user: UserLike, fallbackId = 0): DisplayUser {
  const id = Number(user?.id) || fallbackId;
  if (isDeletedUser(user) || !user?.username) {
    return {
      id,
      username: DELETED_USER_DISPLAY_NAME,
      avatarUrl: null,
      isDeleted: true,
    };
  }
  return {
    id,
    username: user.username,
    avatarUrl: (user.avatar_url ?? user.avatarUrl ?? null) as string | null,
    isDeleted: false,
  };
}

/** Apply tombstone to raw SQL join columns used by message formatters. */
export function tombstoneSenderFields(row: {
  username?: string | null;
  avatar_url?: string | null;
  is_deleted?: number | null;
}): { username: string; avatar_url: string | null; isDeleted: boolean } {
  const deleted = row.is_deleted === 1 || row.username == null || row.username === "";
  if (deleted) {
    return { username: DELETED_USER_DISPLAY_NAME, avatar_url: null, isDeleted: true };
  }
  return {
    username: row.username as string,
    avatar_url: row.avatar_url ?? null,
    isDeleted: false,
  };
}
