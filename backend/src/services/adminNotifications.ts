import { qRun } from "../db/query.js";
import { emitToAdmins, broadcast } from "./realtime.js";

const now = () => new Date().toISOString();

export type AdminSystemNotificationInput = {
  title: string;
  body: string;
  source?: string;
  page?: string;
  notifType?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Creates a notification visible only to administrators (recipient_type = admins).
 * Does not target normal users.
 */
export async function createAdminSystemNotification(input: AdminSystemNotificationInput): Promise<number> {
  const ts = now();
  const result = await qRun(`
    INSERT INTO notifications (
      title, body, source, page, recipient_type, recipient_ids, pinned,
      notif_type, metadata, created_at
    ) VALUES (?, ?, ?, ?, 'admins', '[]', 0, ?, ?, ?)
  `,
    input.title,
    input.body,
    input.source || "Moderation",
    input.page || "alarms",
    input.notifType || "admin_alert",
    JSON.stringify(input.metadata || {}),
    ts,
  );
  const id = Number(result.lastInsertRowid);
  emitToAdmins("admin:notifications", {});
  broadcast("notification:new", {});
  broadcast("counts:update", {});
  return id;
}
