/** Shared deleted-user display (must match backend `DELETED_USER_DISPLAY_NAME`). */
export const DELETED_USER_DISPLAY_NAME = "Deleted User";

export function isDeletedDisplayName(name: string | null | undefined): boolean {
  return !name || name === DELETED_USER_DISPLAY_NAME;
}

export function displayUserName(name: string | null | undefined, isDeleted?: boolean): string {
  if (isDeleted || isDeletedDisplayName(name)) return DELETED_USER_DISPLAY_NAME;
  return name!;
}
