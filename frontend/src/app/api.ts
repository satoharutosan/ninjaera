const API_BASE = "/api";

export type ApiUser = {
  id: number;
  email?: string;
  username: string;
  avatarUrl?: string | null;
  gender?: string;
  dateOfBirth?: string | null;
  country?: string;
  city?: string | null;
  status?: string;
  bio?: string;
  memberSince?: string;
  village?: string;
  clan?: string;
  level?: number;
  rank?: string;
  isAdmin?: boolean;
  isTeamMember?: boolean;
};

export type ApiSettings = {
  emailNotif: boolean;
  pushNotif: boolean;
  twoFA: boolean;
  publicProfile: boolean;
};

export type ApiConversation = {
  id: number;
  name: string;
  msg: string;
  time: string;
  unread: number;
  online: boolean;
  status?: string;
  muted?: boolean;
  bio: string;
  type: "channel" | "dm";
  avatarUrl?: string | null;
  otherUserId?: number;
  village?: string;
  clan?: string;
  level?: number;
  rank?: string;
  memberSince?: string;
  isTeamMember?: boolean;
  country?: string;
  city?: string | null;
};

export type ApiMessage = {
  id: number;
  userId: number;
  user: string;
  msg: string;
  time: string;
  self: boolean;
  avatarUrl?: string | null;
  mediaUrl?: string;
  mediaType?: string;
  fileName?: string;
  fileSize?: number;
  replyTo?: { id: number; user: string; preview: string };
  edited?: boolean;
  reactions?: Record<string, string[]>;
};

export type ApiNotification = {
  id: number;
  title: string;
  body: string;
  time: string;
  read: boolean;
  page: string;
  notifType?: string;
  metadata?: { requestId?: number; requesterId?: number; requesterName?: string; processed?: boolean };
  pinned?: boolean;
};

export class ApiError extends Error {
  status: number;
  data: Record<string, unknown>;
  constructor(message: string, status: number, data: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export function getToken(): string | null {
  return localStorage.getItem("ninja-era-token");
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem("ninja-era-token", token);
  else localStorage.removeItem("ninja-era-token");
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(data.error || res.statusText, res.status, typeof data === "object" && data ? data as Record<string, unknown> : {});
  }
  return data as T;
}

export const api = {
  auth: {
    register: (email: string, username: string, password: string) =>
      request<{ token: string; user: ApiUser }>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, username, password }),
      }),
    login: (email: string, password: string) =>
      request<{ token: string; user: ApiUser }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    me: () => request<{ user: ApiUser }>("/auth/me"),
    logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
    forgotPassword: (email: string) =>
      request<{ ok: boolean }>("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      }),
  },

  users: {
    me: () => request<{ user: ApiUser; settings: ApiSettings; stats: Record<string, number> }>("/users/me"),
    update: (data: Partial<ApiUser & { bio: string; status: string }>) =>
      request<{ user: ApiUser }>("/users/me", { method: "PATCH", body: JSON.stringify(data) }),
    uploadAvatar: (file: File) => {
      const form = new FormData();
      form.append("avatar", file);
      return request<{ avatarUrl: string }>("/users/me/avatar", { method: "POST", body: form });
    },
    changePassword: (currentPassword: string, newPassword: string) =>
      request<{ ok: boolean }>("/users/me/password", {
        method: "PATCH",
        body: JSON.stringify({ currentPassword, newPassword }),
      }),
    updateSettings: (settings: Partial<ApiSettings>) =>
      request<{ ok: boolean }>("/users/me/settings", {
        method: "PATCH",
        body: JSON.stringify(settings),
      }),
    stats: () => request<{ stats: Record<string, number>; activities: { description: string; createdAt: string }[] }>("/users/me/stats"),
    achievements: () => request<{ achievements: { title: string; description: string; icon: string }[] }>("/users/me/achievements"),
    inventory: () => request<{ inventory: { name: string; rarity: string; quantity: number; icon: string }[] }>("/users/me/inventory"),
    block: (userId: number) => request<{ ok: boolean }>(`/users/${userId}/block`, { method: "POST" }),
    pingPresence: () => request<{ ok: boolean }>("/users/me/presence", { method: "POST" }),
    get: (id: number) => request<{ user: ApiUser }>(`/users/${id}`),
  },

  messages: {
    conversations: () => request<{ conversations: ApiConversation[] }>("/conversations"),
    getMessages: (conversationId: number, opts?: {
      limit?: number;
      before?: number;
      after?: number;
      around?: number;
    }) => {
      const params = new URLSearchParams();
      if (opts?.limit != null) params.set("limit", String(opts.limit));
      if (opts?.before != null) params.set("before", String(opts.before));
      if (opts?.after != null) params.set("after", String(opts.after));
      if (opts?.around != null) params.set("around", String(opts.around));
      const qs = params.toString();
      return request<{
        messages: ApiMessage[];
        hasMore: boolean;
        hasMoreOlder?: boolean;
        hasMoreNewer?: boolean;
      }>(`/conversations/${conversationId}/messages${qs ? `?${qs}` : ""}`);
    },
    send: (conversationId: number, msg: string, replyTo?: number) =>
      request<{ message: ApiMessage }>("/messages", {
        method: "POST",
        body: JSON.stringify({ conversationId, msg, replyTo }),
      }),
    sendMedia: (conversationId: number, file: File, replyTo?: number) => {
      const form = new FormData();
      form.append("file", file);
      form.append("conversationId", String(conversationId));
      if (replyTo) form.append("replyTo", String(replyTo));
      return request<{ message: ApiMessage }>("/messages/media", { method: "POST", body: form });
    },
    edit: (id: number, msg: string) =>
      request<{ message: ApiMessage }>(`/messages/${id}`, { method: "PATCH", body: JSON.stringify({ msg }) }),
    delete: (id: number) => request<{ ok: boolean }>(`/messages/${id}`, { method: "DELETE" }),
    react: (id: number, emoji: string) =>
      request<{ reactions: Record<string, string[]> }>(`/messages/${id}/reactions`, {
        method: "POST",
        body: JSON.stringify({ emoji }),
      }),
    mute: (conversationId: number) =>
      request<{ muted: boolean }>(`/conversations/${conversationId}/mute`, { method: "PUT" }),
    markRead: (conversationId: number) =>
      request<{ ok: boolean }>(`/conversations/${conversationId}/read`, { method: "POST" }),
    deleteContact: (contactId: number) =>
      request<{ ok: boolean }>(`/contacts/${contactId}`, { method: "DELETE" }),
    startDm: (name: string, bio?: string) =>
      request<{ conversation: ApiConversation }>("/conversations", {
        method: "POST",
        body: JSON.stringify({ name, bio }),
      }),
    report: (data: { userId?: number; messageId?: number; reason?: string }) =>
      request<{ ok: boolean }>("/reports", { method: "POST", body: JSON.stringify(data) }),
  },

  notifications: {
    list: () => request<{ notifications: ApiNotification[] }>("/notifications"),
    markRead: (id: number) => request<{ ok: boolean }>(`/notifications/${id}/read`, { method: "PATCH" }),
    markAllRead: () => request<{ ok: boolean }>("/notifications/read-all", { method: "PATCH" }),
    acceptDm: (id: number) => request<{ ok: boolean; conversationId: number }>(`/notifications/${id}/dm-accept`, { method: "POST" }),
    rejectDm: (id: number) => request<{ ok: boolean }>(`/notifications/${id}/dm-reject`, { method: "POST" }),
  },

  contact: {
    submit: (data: { name: string; email: string; subject: string; category: string; message: string }) =>
      request<{ ok: boolean }>("/contact", { method: "POST", body: JSON.stringify(data) }),
  },

  newsletter: {
    subscribe: (email: string) =>
      request<{ ok: boolean }>("/newsletter/subscribe", { method: "POST", body: JSON.stringify({ email }) }),
  },

  jobs: {
    list: () => request<{ jobs: { id: number; title: string; department: string; type: string }[] }>("/jobs"),
    apply: (jobId: number, data: FormData) =>
      request<{ ok: boolean }>(`/jobs/${jobId}/apply`, { method: "POST", body: data }),
  },

  content: {
    team: () => request<{ team: { name: string; role: string; department: string; country: string; city: string; statusLabel?: string; statusColor?: string; userId?: number; username?: string; avatarUrl?: string | null }[] }>("/team"),
    resources: (category?: string) =>
      request<{ resources: { id: number; title: string; category: string; description: string; contentUrl?: string | null; publishedAt?: string; fileSize?: number; version?: string }[] }>(
        category ? `/resources?category=${encodeURIComponent(category)}` : "/resources"
      ),
    downloadResource: async (id: number) => {
      const token = getToken();
      const res = await fetch(`${API_BASE}/resources/${id}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new ApiError((data as { error?: string }).error || res.statusText, res.status);
      }
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = /filename\*?=(?:UTF-8''|")?([^\";]+)/i.exec(disposition);
      const filename = match ? decodeURIComponent(match[1].replace(/"/g, "")) : `resource-${id}`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },
    gameDownloads: () => request<{ downloads: GameDownloadInfo[] }>("/game-downloads"),
    downloadGame: async (platform: string) => {
      const token = getToken();
      const res = await fetch(`${API_BASE}/game-downloads/${platform}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new ApiError((data as { error?: string }).error || res.statusText, res.status);
      }
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = /filename\*?=(?:UTF-8''|")?([^\";]+)/i.exec(disposition);
      const filename = match ? decodeURIComponent(match[1].replace(/"/g, "")) : `${platform}-client`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },
  },

  dm: {
    searchUser: (username: string) => request<{ user: { id: number; username: string; avatarUrl?: string; status: string } }>(`/user-search?username=${encodeURIComponent(username)}`),
    createRequest: (username: string) => request<{ ok: boolean; requestId?: number; conversationId?: number }>("/dm-requests", { method: "POST", body: JSON.stringify({ username }) }),
    listRequests: () => request<{ incoming: { id: number; requesterId: number; requesterName: string; requesterAvatar?: string | null; requesterDisplayName?: string; time: string; createdAt: string }[]; outgoing: { id: number; recipientName: string; time: string }[] }>("/dm-requests"),
    accept: (id: number) => request<{ ok: boolean; conversationId: number }>(`/dm-requests/${id}/accept`, { method: "POST" }),
    reject: (id: number) => request<{ ok: boolean }>(`/dm-requests/${id}/reject`, { method: "POST" }),
    contacts: () => request<{ contacts: { id: number; username: string; avatarUrl?: string; status: string }[] }>("/dm-contacts"),
  },

  admin: {
    check: () => request<{ isAdmin: boolean }>("/admin/check"),
    stats: () => request<{
      totalUsers: number; onlineUsers: number; totalChannels: number; totalDms: number;
      pendingApplications: number; teamMembers: number; unreadNotifications: number;
      unreadContacts: number; totalContacts: number; repliedContacts: number; pendingContactReplies: number;
      totalMessages: number; pendingDmRequests: number; totalResources: number; totalDownloads: number;
      approvedApplications: number; rejectedApplications: number;
      userDistribution: { name: string; value: number }[];
      userGrowth: { date: string; label: string; count: number }[];
      activityTimeline: { date: string; label: string; messages: number; downloads: number; logins: number }[];
      downloadsByPlatform: { platform: string; label: string; count: number }[];
      mostDownloadedResource: { title: string; downloads: number } | null;
      recentUsers: { id: number; username: string; avatarUrl: string | null; createdAt: string; isOnline: boolean; time: string }[];
      recentApplications: { id: number; status: string; createdAt: string; username: string | null; position: string | null; time: string }[];
      recentContacts: { id: number; name: string; subject: string; isRead: boolean; replyStatus: string; createdAt: string; time: string }[];
      recentActivity: { id: number; timestamp: string; username: string | null; eventType: string; eventCategory: string; description: string; userRole: string | null; result: string; time: string }[];
    }>("/admin/stats"),
    users: (search?: string, filter?: string) => request<{ users: AdminUser[] }>(`/admin/users?${new URLSearchParams({ ...(search ? { search } : {}), ...(filter ? { filter } : {}) })}`),
    getUser: (id: number) => request<{ user: AdminUser }>(`/admin/users/${id}`),
    updateUser: (id: number, data: Partial<AdminUser & { isAdmin: boolean; isTeamMember: boolean }>) => request<{ user: AdminUser }>(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    disableUser: (id: number) => request<{ ok: boolean }>(`/admin/users/${id}/disable`, { method: "POST" }),
    enableUser: (id: number) => request<{ ok: boolean }>(`/admin/users/${id}/enable`, { method: "POST" }),
    deleteUser: (id: number) => request<{ ok: boolean }>(`/admin/users/${id}`, { method: "DELETE" }),
    notifications: () => request<{ notifications: AdminNotification[] }>("/admin/notifications"),
    createNotification: (data: Partial<AdminNotification>) => request<{ id: number }>("/admin/notifications", { method: "POST", body: JSON.stringify(data) }),
    updateNotification: (id: number, data: Partial<AdminNotification>) => request<{ ok: boolean }>(`/admin/notifications/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteNotification: (id: number) => request<{ ok: boolean }>(`/admin/notifications/${id}`, { method: "DELETE" }),
    pinNotification: (id: number) => request<{ ok: boolean }>(`/admin/notifications/${id}/pin`, { method: "POST" }),
    unpinNotification: (id: number) => request<{ ok: boolean }>(`/admin/notifications/${id}/unpin`, { method: "POST" }),
    channels: () => request<{ channels: AdminChannel[] }>("/admin/channels"),
    createChannel: (data: { name: string; bio?: string; visibility?: string }) => request<{ id: number }>("/admin/channels", { method: "POST", body: JSON.stringify(data) }),
    updateChannel: (id: number, data: Partial<AdminChannel>) => request<{ ok: boolean }>(`/admin/channels/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteChannel: (id: number) => request<{ ok: boolean }>(`/admin/channels/${id}`, { method: "DELETE" }),
    applications: () => request<{ applications: TeamApplication[] }>("/admin/applications"),
    approveApplication: (id: number) => request<{ ok: boolean }>(`/admin/applications/${id}/approve`, { method: "POST" }),
    rejectApplication: (id: number) => request<{ ok: boolean }>(`/admin/applications/${id}/reject`, { method: "POST" }),
    resources: () => request<{ resources: AdminResource[] }>("/admin/resources"),
    createResource: (form: FormData) => request<{ id: number }>("/admin/resources", { method: "POST", body: form }),
    updateResource: (id: number, form: FormData) => request<{ ok: boolean }>(`/admin/resources/${id}`, { method: "PATCH", body: form }),
    deleteResource: (id: number) => request<{ ok: boolean }>(`/admin/resources/${id}`, { method: "DELETE" }),
    gameDownloads: () => request<{ downloads: AdminGameDownload[] }>("/admin/game-downloads"),
    createGameDownload: (form: FormData) => request<{ id: number }>("/admin/game-downloads", { method: "POST", body: form }),
    updateGameDownload: (id: number, form: FormData) => request<{ ok: boolean }>(`/admin/game-downloads/${id}`, { method: "PATCH", body: form }),
    deleteGameDownload: (id: number) => request<{ ok: boolean }>(`/admin/game-downloads/${id}`, { method: "DELETE" }),
    activityLogs: (params: Record<string, string>) => request<{ logs: ActivityLogEntry[]; total: number; page: number; limit: number }>(`/admin/activity-logs?${new URLSearchParams(params)}`),
    exportActivityLogs: async () => {
      const token = getToken();
      const res = await fetch(`${API_BASE}/admin/activity-logs/export`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new ApiError("Export failed", res.status);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "activity-logs.csv";
      a.click();
      URL.revokeObjectURL(url);
    },
    archiveActivityLogs: (before: string) => request<{ ok: boolean; deleted: number }>("/admin/activity-logs", { method: "DELETE", body: JSON.stringify({ before }) }),
    contacts: () => request<{ contacts: ContactTicket[] }>("/admin/contacts"),
    getContact: (id: number) => request<{ contact: ContactTicket }>(`/admin/contacts/${id}`),
    markContactRead: (id: number) => request<{ ok: boolean }>(`/admin/contacts/${id}/read`, { method: "PATCH" }),
    replyContact: (id: number, body: string) => request<{ contact: ContactTicket }>(`/admin/contacts/${id}/reply`, { method: "POST", body: JSON.stringify({ body }) }),
    databaseInfo: () => request<{
      type: string; version: string; userVersion: number; path: string; sizeBytes: number; sizeLabel: string;
      totalUsers: number; totalMessages: number; totalChannels: number; totalResources: number;
      totalNotifications: number; totalLogs: number; lastBackupAt: string | null; lastBackupFile: string | null;
    }>("/admin/database/info"),
    databaseBackup: async () => {
      const token = getToken();
      const res = await fetch(`${API_BASE}/admin/database/backup`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new ApiError((err as { error?: string }).error || "Backup failed", res.status);
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const match = /filename="?([^"]+)"?/.exec(cd);
      const filename = match?.[1] || `ninja-era-backup-${Date.now()}.db`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },
    databaseRestore: async (file: File) => {
      const token = getToken();
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API_BASE}/admin/database/restore`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new ApiError((err as { error?: string }).error || "Restore failed", res.status, err);
      }
      return res.json() as Promise<{ ok: boolean; safetyBackup: string }>;
    },
  },

  legal: {
    viewTerms: () => request<{ ok: boolean }>("/legal/terms-viewed", { method: "POST" }),
  },
};

export type AdminUser = ApiUser & {
  isDisabled?: boolean;
  isDeleted?: boolean;
  isTeamMember?: boolean;
  isOnline?: boolean;
  createdAt?: string;
  registrationNumber?: number;
  lastLoginAt?: string | null;
  gameStats?: {
    missionsComplete?: number; pvpWins?: number; playtimeHours?: number; legendaryItems?: number;
    globalRank?: number;
    ninjutsu?: number; taijutsu?: number; genjutsu?: number; senjutsu?: number; kenjutsu?: number;
  } | null;
  achievements?: { title: string; description: string; icon: string; earnedAt?: string }[];
  inventory?: { name: string; rarity: string; quantity: number; icon: string }[];
  recentLogins?: { timestamp: string; description: string }[];
  location?: {
    ip: string | null;
    countryCode: string | null;
    countryName: string | null;
    isVpn: boolean;
    vpnIp: string | null;
    vpnCountryCode: string | null;
    vpnCountryName: string | null;
    originIp: string | null;
    originCountryCode: string | null;
    originCountryName: string | null;
  } | null;
  activities?: { description: string; createdAt: string }[];
};

export type AdminNotification = {
  id?: number;
  title: string;
  body: string;
  source?: string;
  page?: string;
  recipientType?: string;
  recipientIds?: number[];
  pinned?: boolean;
  time?: string;
};

export type AdminChannel = {
  id: number;
  name: string;
  bio: string;
  archived: boolean;
  visibility: string;
  moderatorIds: number[];
  memberCount: number;
};

export type TeamApplication = {
  id: number;
  applicant: { id: number; username: string; email: string; avatarUrl?: string };
  fullName: string;
  country?: string;
  city?: string;
  message?: string;
  jobTitle: string;
  status: string;
  time: string;
  photoUrl?: string;
  cvUrl?: string;
};

export type AdminResource = {
  id: number;
  title: string;
  category: string;
  description: string;
  contentUrl?: string | null;
  enabled: boolean;
  fileSize?: number;
  version?: string;
  sortOrder?: number;
  uploaderName?: string;
};

export type GameDownloadInfo = {
  platform: string;
  available: boolean;
  id: number | null;
  version: string | null;
  releaseNotes: string | null;
  fileSize: number | null;
  publishedAt: string | null;
};

export type AdminGameDownload = {
  id: number;
  platform: string;
  version: string;
  releaseNotes: string;
  fileUrl?: string | null;
  fileSize?: number;
  published: boolean;
  publishedAt?: string;
  uploaderName?: string;
};

export type ContactTicket = {
  id: number;
  userId?: number | null;
  guestIdentifier?: string | null;
  name: string;
  email: string;
  subject: string;
  category: string;
  message: string;
  status: string;
  isRead: boolean;
  replyStatus: string;
  ipAddress?: string | null;
  country?: string | null;
  countryCode?: string | null;
  createdAt: string;
  updatedAt?: string;
  time: string;
  replies?: { id: number; body: string; createdAt: string; adminUsername?: string }[];
};

export type ActivityLogEntry = {
  id: number;
  timestamp: string;
  time: string;
  userId?: number;
  username?: string;
  displayName?: string;
  userRole: string;
  eventType: string;
  eventCategory: string;
  description: string;
  affectedObject?: string;
  requestPath?: string;
  httpMethod?: string;
  browser?: string;
  os?: string;
  deviceType?: string;
  ipAddress?: string;
  country?: string;
  countryCode?: string;
  isVpn?: boolean;
  result: string;
  metadata?: Record<string, unknown>;
};

