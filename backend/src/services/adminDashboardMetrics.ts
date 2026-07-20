/**
 * Shared SQL / helpers for Admin Dashboard metrics.
 * Dashboard counts must use the same filters as the corresponding management lists.
 */

/** Pending teamwork applications — same status filter as Teamwork Applications management. */
export const PENDING_JOB_APPLICATIONS_SQL =
  "SELECT COUNT(*) as c FROM job_applications WHERE status = 'pending'";

/**
 * Teamwork applications list — LEFT JOIN so rows remain visible if a posting/user
 * row is missing; matches recentApplications on the dashboard.
 */
export const TEAMWORK_APPLICATIONS_LIST_SQL = `
  SELECT ja.*, u.username, u.email, u.avatar_url, jp.title as job_title
  FROM job_applications ja
  LEFT JOIN users u ON u.id = ja.user_id
  LEFT JOIN job_postings jp ON jp.id = ja.job_id
  ORDER BY ja.created_at DESC
`;

/** Unread contact tickets — same filter as Contact Management unread badge. */
export const UNREAD_CONTACTS_SQL =
  "SELECT COUNT(*) as c FROM contact_tickets WHERE is_read = 0";

/** Active users shown by default in User Management (non-NPC, not soft-deleted). */
export const TOTAL_USERS_SQL =
  "SELECT COUNT(*) as c FROM users WHERE is_npc = 0 AND is_deleted = 0";

/** Total notifications listed in Notifications management. */
export const TOTAL_NOTIFICATIONS_SQL =
  "SELECT COUNT(*) as c FROM notifications";

/** Successful download events (resource + game) — same category as Activity Logs downloads. */
export const TOTAL_DOWNLOADS_SQL = `
  SELECT COUNT(*) as c FROM activity_logs
  WHERE event_category = 'downloads' AND result = 'success'
`;

/** User-visible messages (excludes call-event system chips). */
export const TOTAL_MESSAGES_SQL = `
  SELECT COUNT(*) as c FROM messages
  WHERE media_type IS NULL OR media_type != 'call_event'
`;

/** Pending DM friend requests — NOT teamwork applications; tracked separately. */
export const PENDING_DM_REQUESTS_SQL =
  "SELECT COUNT(*) as c FROM dm_requests WHERE status = 'pending'";

export function isAdminStatsDiagnosticsEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}
