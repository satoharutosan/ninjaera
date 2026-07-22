const API_BASE = "/api";

export type ApiUser = {
  id: number;
  email?: string;
  /** True when the account has a local password (self view only). OAuth-only accounts start false. */
  hasPassword?: boolean;
  username: string;
  avatarUrl?: string | null;
  gender?: string;
  dateOfBirth?: string | null;
  country?: string;
  city?: string | null;
  status?: string;
  bio?: string;
  /** Discord-style custom status text. Empty string when unset. */
  mood?: string;
  memberSince?: string;
  village?: string;
  clan?: string;
  level?: number;
  rank?: string;
  isAdmin?: boolean;
  isTeamMember?: boolean;
  /** Soft-deleted account — show "Deleted User" tombstone in UI. */
  isDeleted?: boolean;
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
  mood?: string;
  type: "channel" | "dm";
  avatarUrl?: string | null;
  otherUserId?: number;
  isDeleted?: boolean;
  village?: string;
  clan?: string;
  level?: number;
  rank?: string;
  memberSince?: string;
  isTeamMember?: boolean;
  isAdmin?: boolean;
  country?: string;
  city?: string | null;
  blockedByMe?: boolean;
  isBlocked?: boolean;
};

export type ApiMessage = {
  id: number;
  userId: number;
  user: string;
  msg: string;
  time: string;
  self: boolean;
  avatarUrl?: string | null;
  isDeleted?: boolean;
  mediaUrl?: string;
  mediaType?: string;
  fileName?: string;
  fileSize?: number;
  replyTo?: { id: number; user: string; preview: string };
  edited?: boolean;
  reactions?: Record<string, string[]>;
  durationMs?: number;
  duration?: string;
  mimeType?: string;
  codec?: string;
  sampleRate?: number;
  channels?: number;
  waveform?: number[];
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

const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
/** Large admin game/resource uploads — keep in sync with backend HTTP_UPLOAD_TIMEOUT_MS (default 1h). */
const UPLOAD_REQUEST_TIMEOUT_MS = 60 * 60 * 1000;

/** Real browser→API transfer progress (bytes uploaded / Content-Length). */
export type UploadProgress = {
  loaded: number;
  total: number;
  /** 0–100 when length is known; -1 when indeterminate. */
  percent: number;
  /** True once the request body has finished sending (server may still be processing). */
  transferComplete?: boolean;
};

type RequestOptions = RequestInit & {
  timeoutMs?: number;
  onUploadProgress?: (progress: UploadProgress) => void;
};

import {
  getStoredToken,
  setStoredToken,
  clearAuthCredentials,
  isAuthPersistent,
} from "@/shared/authStorage";
import { CONNECTION_ERROR_MESSAGE } from "@/shared/networkMessages";
import { getNinja } from "@/shared/electronBridge";

/** Open an external download URL so the browser/OS downloads directly (e.g. GitHub). */
async function openExternalDownload(url: string): Promise<void> {
  const ninja = getNinja();
  if (ninja?.shell?.openExternal) {
    const r = await ninja.shell.openExternal(url);
    if (!r.ok) throw new ApiError("Could not open the download link.", 0);
    return;
  }
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function getToken(): string | null {
  return getStoredToken();
}

/** Clear or set the JWT. Optional `persist` controls localStorage vs sessionStorage. */
export function setToken(token: string | null, persist?: boolean) {
  if (!token) {
    clearAuthCredentials();
    return;
  }
  setStoredToken(token, persist ?? isAuthPersistent());
}

function networkErrorMessage(isUpload: boolean): string {
  if (isUpload) {
    return "Network error during upload. Check your connection and try again.";
  }
  return CONNECTION_ERROR_MESSAGE;
}

function abortErrorMessage(path: string, isUpload: boolean, timedOut: boolean): string {
  const isAuthVerificationPath =
    path.startsWith("/auth/register")
    || path.startsWith("/auth/verify")
    || path.startsWith("/auth/resend")
    || path.startsWith("/auth/forgot")
    || path.startsWith("/auth/verification");
  if (!timedOut) return "The request was cancelled.";
  if (isUpload) {
    return "The upload timed out. Check your connection and try again (large files can take several minutes).";
  }
  if (isAuthVerificationPath) {
    return "The verification service is temporarily unavailable. Please try again in a few minutes.";
  }
  return "The request timed out. Please try again.";
}

function parseXhrJson(xhr: XMLHttpRequest): unknown {
  const text = xhr.responseText;
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

/**
 * FormData uploads use XHR so `onUploadProgress` can report real transfer bytes.
 * JSON requests continue to use fetch.
 */
function requestWithUploadProgress<T>(path: string, options: RequestOptions): Promise<T> {
  const { timeoutMs: timeoutOverride, signal, onUploadProgress, ...fetchOptions } = options;
  const body = fetchOptions.body;
  if (!(body instanceof FormData)) {
    return Promise.reject(new Error("requestWithUploadProgress requires a FormData body"));
  }
  const timeoutMs = timeoutOverride ?? UPLOAD_REQUEST_TIMEOUT_MS;
  const method = (fetchOptions.method || "POST").toUpperCase();
  const headers: Record<string, string> = { ...(fetchOptions.headers as Record<string, string>) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  // Browser sets multipart boundary — never force Content-Type for FormData.

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let timedOut = false;
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      fn();
    };

    const onAbort = () => {
      timedOut = false;
      xhr.abort();
    };

    xhr.open(method, `${API_BASE}${path}`);
    xhr.timeout = timeoutMs;
    for (const [key, value] of Object.entries(headers)) {
      if (value != null && key.toLowerCase() !== "content-type") {
        xhr.setRequestHeader(key, value);
      }
    }

    xhr.upload.onprogress = (e) => {
      if (!onUploadProgress) return;
      if (e.lengthComputable && e.total > 0) {
        onUploadProgress({
          loaded: e.loaded,
          total: e.total,
          percent: Math.min(100, Math.round((e.loaded / e.total) * 100)),
        });
      } else {
        onUploadProgress({ loaded: e.loaded, total: 0, percent: -1 });
      }
    };
    xhr.upload.onload = () => {
      onUploadProgress?.({
        loaded: 1,
        total: 1,
        percent: 100,
        transferComplete: true,
      });
    };

    xhr.onload = () => {
      const data = parseXhrJson(xhr);
      finish(() => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data as T);
          return;
        }
        const bodyObj = typeof data === "object" && data ? data as Record<string, unknown> : {};
        reject(new ApiError(String(bodyObj.error || xhr.statusText || "Upload failed"), xhr.status, bodyObj));
      });
    };
    xhr.onerror = () => {
      finish(() => reject(new ApiError(networkErrorMessage(true), 0, { code: "NETWORK_ERROR", path })));
    };
    xhr.ontimeout = () => {
      timedOut = true;
      finish(() => reject(new ApiError(abortErrorMessage(path, true, true), 408, { code: "REQUEST_TIMEOUT", path, upload: true })));
    };
    xhr.onabort = () => {
      finish(() => reject(new ApiError(abortErrorMessage(path, true, timedOut), 408, {
        code: timedOut ? "REQUEST_TIMEOUT" : "REQUEST_CANCELLED",
        path,
        upload: true,
      })));
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort);
    }

    xhr.send(body);
  });
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { timeoutMs: timeoutOverride, signal, onUploadProgress, ...fetchOptions } = options;
  const isUpload = fetchOptions.body instanceof FormData;

  if (isUpload) {
    return requestWithUploadProgress<T>(path, { ...options, timeoutMs: timeoutOverride, signal, onUploadProgress });
  }

  const timeoutMs = timeoutOverride ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const headers: Record<string, string> = { ...(fetchOptions.headers as Record<string, string>) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  headers["Content-Type"] = headers["Content-Type"] || "application/json";

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let res: Response;
  let data: unknown;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...fetchOptions, headers, signal: controller.signal });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new ApiError(abortErrorMessage(path, false, timedOut), 408, {
        code: timedOut ? "REQUEST_TIMEOUT" : "REQUEST_CANCELLED",
        path,
        upload: false,
      });
    }
    throw new ApiError(networkErrorMessage(false), 0, { code: "NETWORK_ERROR", path });
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }

  if (!res.ok) {
    const body = typeof data === "object" && data ? data as Record<string, unknown> : {};
    const offline = body.offline === true || res.status === 503;
    const message = offline
      ? CONNECTION_ERROR_MESSAGE
      : String(body.error || res.statusText);
    throw new ApiError(message, res.status, body);
  }
  return data as T;
}

export const api = {
  auth: {
    register: (email: string, username: string, password: string) =>
      request<{
        pending: boolean;
        email: string;
        message: string;
        cooldownSeconds?: number;
        emailStatus?: "queued" | "sending" | "sent" | "failed";
        token?: string;
        user?: ApiUser;
      }>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, username, password }),
        timeoutMs: 8000,
      }),
    login: (email: string, password: string) =>
      request<{ token: string; user: ApiUser }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    verifyEmail: (payload: { email?: string; code?: string; token?: string }) =>
      request<{ token: string; user: ApiUser; verified: boolean }>("/auth/verify-email", {
        method: "POST",
        body: JSON.stringify(payload),
        timeoutMs: 10000,
      }),
    resendVerification: (email: string) =>
      request<{ ok: boolean; message: string; cooldownSeconds: number; emailStatus?: "queued" | "sending" | "sent" | "failed" }>("/auth/resend-verification", {
        method: "POST",
        body: JSON.stringify({ email }),
        timeoutMs: 8000,
      }),
    verificationStatus: (email: string) =>
      request<{
        pending: boolean;
        email: string;
        status: "queued" | "sending" | "sent" | "failed" | "none";
        cooldownSeconds: number;
        expiresAt: string | null;
        canResend: boolean;
      }>(`/auth/verification-status?${new URLSearchParams({ email })}`, { timeoutMs: 8000 }),
    me: () => request<{ user: ApiUser }>("/auth/me"),
    logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
    forgotPassword: (email: string) =>
      request<{ ok: boolean; message?: string }>("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      }),
    resetPassword: (token: string, password: string) =>
      request<{ ok: boolean }>("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      }),
    usernameAvailable: (username: string, excludeUserId?: number) => {
      const params = new URLSearchParams({ username });
      if (excludeUserId != null) params.set("excludeUserId", String(excludeUserId));
      return request<{ available: boolean; reason: string; error: string | null }>(
        `/auth/username-available?${params}`,
      );
    },
    oauthExchange: (code: string) =>
      request<{ token: string; user: ApiUser }>("/auth/oauth/exchange", {
        method: "POST",
        body: JSON.stringify({ code }),
      }),
  },


  users: {
    me: () => request<{ user: ApiUser; settings: ApiSettings; stats: Record<string, number> }>("/users/me"),
    update: (data: Partial<ApiUser & { bio: string; mood: string; status: string }>) =>
      request<{ user: ApiUser }>("/users/me", { method: "PATCH", body: JSON.stringify(data) }),
    uploadAvatar: (file: File) => {
      const form = new FormData();
      form.append("avatar", file);
      return request<{ avatarUrl: string }>("/users/me/avatar", { method: "POST", body: form });
    },
    changePassword: (currentPassword: string | null, newPassword: string) =>
      request<{ ok: boolean; token?: string; hasPassword?: boolean; created?: boolean }>("/users/me/password", {
        method: "PATCH",
        body: JSON.stringify(
          currentPassword ? { currentPassword, newPassword } : { newPassword },
        ),
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
    unblock: (userId: number) => request<{ ok: boolean }>(`/users/${userId}/block`, { method: "DELETE" }),
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
    sendMedia: (
      conversationId: number,
      file: File,
      replyTo?: number,
      meta?: {
        durationMs?: number;
        mimeType?: string;
        codec?: string;
        sampleRate?: number;
        channels?: number;
        waveform?: number[];
      },
    ) => {
      const form = new FormData();
      form.append("file", file);
      form.append("conversationId", String(conversationId));
      if (replyTo) form.append("replyTo", String(replyTo));
      if (meta?.durationMs != null) form.append("durationMs", String(meta.durationMs));
      if (meta?.mimeType) form.append("mimeType", meta.mimeType);
      if (meta?.codec) form.append("codec", meta.codec);
      if (meta?.sampleRate != null) form.append("sampleRate", String(meta.sampleRate));
      if (meta?.channels != null) form.append("channels", String(meta.channels));
      if (meta?.waveform?.length) form.append("waveform", JSON.stringify(meta.waveform));
      return request<{ message: ApiMessage }>("/messages/media", { method: "POST", body: form });
    },
    sendGif: (conversationId: number, url: string, label?: string, replyTo?: number) =>
      request<{ message: ApiMessage }>("/messages/gif", {
        method: "POST",
        body: JSON.stringify({ conversationId, url, label, replyTo }),
      }),
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
    badgeCount: () =>
      request<{ unreadMessages: number; pendingDMRequests: number; totalMessageBadge: number }>(
        "/messages/badge-count",
      ),
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
    acceptDm: (id: number) => request<{
      success: boolean;
      ok: boolean;
      message: string;
      alreadyExists?: boolean;
      conversationId: number;
      requestId: number;
      dm: { id: number; userId: number; username: string; avatarUrl: string | null };
    }>(`/notifications/${id}/dm-accept`, { method: "POST" }),
    rejectDm: (id: number) => request<{ success: boolean; ok: boolean; message: string; requestId: number }>(`/notifications/${id}/dm-reject`, { method: "POST" }),
  },

  contact: {
    submit: (data: { name: string; email: string; subject: string; category: string; message: string }) =>
      request<{ ok: boolean }>("/contact", { method: "POST", body: JSON.stringify(data) }),
  },

  /** Silent first-install ping from app landing pages (optional auth). */
  registerAppInstallation: (data: {
    appId: string;
    appName?: string;
    appVersion?: string;
    buildVersion?: string;
    releaseChannel?: string;
    installationId: string;
    platform?: string;
    operatingSystem?: string;
  }) =>
    request<{ ok: boolean; duplicate?: boolean; id?: number }>("/app-installations", {
      method: "POST",
      body: JSON.stringify(data),
    }),

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
      request<{ resources: { id: number; title: string; category: string; description: string; contentUrl?: string | null; publishedAt?: string; fileSize?: number; version?: string; visibility?: "PUBLIC" | "PRIVATE" }[] }>(
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
      const contentType = res.headers.get("Content-Type") || "";
      if (contentType.includes("application/json")) {
        const data = await res.json() as { externalUrl?: string };
        if (data.externalUrl) {
          await openExternalDownload(data.externalUrl);
          return;
        }
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
      const contentType = res.headers.get("Content-Type") || "";
      if (contentType.includes("application/json")) {
        const data = await res.json() as { externalUrl?: string };
        if (data.externalUrl) {
          await openExternalDownload(data.externalUrl);
          return;
        }
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
    ourStory: () => request<{ content: OurStoryPublic }>("/content/about-our-story"),
  },

  dm: {
    searchUser: (username: string) => request<{ user: { id: number; username: string; avatarUrl?: string; status: string } }>(`/user-search?username=${encodeURIComponent(username)}`),
    createRequest: (username: string) => request<{ ok: boolean; requestId?: number; conversationId?: number }>("/dm-requests", { method: "POST", body: JSON.stringify({ username }) }),
    listRequests: () => request<{ incoming: { id: number; requesterId: number; requesterName: string; requesterAvatar?: string | null; requesterDisplayName?: string; time: string; createdAt: string }[]; outgoing: { id: number; recipientName: string; time: string }[] }>("/dm-requests"),
    accept: (id: number) => request<{
      success: boolean;
      ok: boolean;
      message: string;
      alreadyExists?: boolean;
      conversationId: number;
      requestId: number;
      dm: { id: number; userId: number; username: string; avatarUrl: string | null };
    }>(`/dm-requests/${id}/accept`, { method: "POST" }),
    reject: (id: number) => request<{ success: boolean; ok: boolean; message: string; requestId: number }>(`/dm-requests/${id}/reject`, { method: "POST" }),
    contacts: () => request<{ contacts: { id: number; username: string; avatarUrl?: string; status: string }[] }>("/dm-contacts"),
  },

  webrtc: {
    iceServers: () =>
      request<{
        iceServers: RTCIceServer[];
        turnConfigured: boolean;
      }>("/webrtc/ice-servers"),
  },

  admin: {
    check: () => request<{ isAdmin: boolean; isSuperAdmin: boolean; user: ApiUser }>("/admin/check"),
    stats: () => request<{
      totalUsers: number;
      onlineUsers: number;
      pendingApplications: number;
      pendingJobApplications?: number;
      pendingDmRequests?: number;
      unreadContacts: number;
      notifications: number;
      totalDownloads: number;
      totalMessages: number;
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
    bulkDeleteUsers: (ids: number[]) =>
      request<{ ok: boolean; deleted: number }>("/admin/users/bulk-delete", {
        method: "POST",
        body: JSON.stringify({ ids }),
      }),
    notifications: () => request<{ notifications: AdminNotification[] }>("/admin/notifications"),
    createNotification: (data: Partial<AdminNotification>) => request<{ id: number }>("/admin/notifications", { method: "POST", body: JSON.stringify(data) }),
    updateNotification: (id: number, data: Partial<AdminNotification>) => request<{ ok: boolean }>(`/admin/notifications/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteNotification: (id: number) => request<{ ok: boolean }>(`/admin/notifications/${id}`, { method: "DELETE" }),
    pinNotification: (id: number) => request<{ ok: boolean }>(`/admin/notifications/${id}/pin`, { method: "POST" }),
    unpinNotification: (id: number) => request<{ ok: boolean }>(`/admin/notifications/${id}/unpin`, { method: "POST" }),
    getOurStory: () => request<{ content: OurStoryContent }>("/admin/content/about-our-story"),
    saveOurStory: (data: {
      title: string;
      subtitle?: string;
      body: string;
      quote?: string;
      status: "draft" | "published";
      removeImage?: boolean;
      image?: File | null;
    }) => {
      const form = new FormData();
      form.append("title", data.title);
      form.append("subtitle", data.subtitle ?? "");
      form.append("body", data.body);
      form.append("quote", data.quote ?? "");
      form.append("status", data.status);
      if (data.removeImage) form.append("removeImage", "true");
      if (data.image) form.append("image", data.image);
      return request<{ content: OurStoryContent }>("/admin/content/about-our-story", { method: "PUT", body: form });
    },
    channels: () => request<{ channels: AdminChannel[] }>("/admin/channels"),
    createChannel: (data: { name: string; bio?: string; visibility?: string }, avatarFile?: File | null) => {
      const form = new FormData();
      form.append("name", data.name);
      if (data.bio != null) form.append("bio", data.bio);
      if (data.visibility) form.append("visibility", data.visibility);
      if (avatarFile) form.append("avatar", avatarFile);
      return request<{ id: number; avatarUrl?: string | null }>("/admin/channels", { method: "POST", body: form });
    },
    updateChannel: (
      id: number,
      data: Partial<AdminChannel> & { removeAvatar?: boolean },
      avatarFile?: File | null,
    ) => {
      const form = new FormData();
      if (data.name != null) form.append("name", data.name);
      if (data.bio != null) form.append("bio", data.bio);
      if (data.visibility != null) form.append("visibility", data.visibility);
      if (data.archived != null) form.append("archived", data.archived ? "true" : "false");
      if (data.removeAvatar) form.append("removeAvatar", "true");
      if (avatarFile) form.append("avatar", avatarFile);
      return request<{ ok: boolean; avatarUrl?: string | null }>(`/admin/channels/${id}`, { method: "PATCH", body: form });
    },
    reorderChannels: (ids: number[]) =>
      request<{ ok: boolean; ids: number[] }>("/admin/channels/reorder", {
        method: "PUT",
        body: JSON.stringify({ ids }),
      }),
    deleteChannel: (id: number) => request<{ ok: boolean }>(`/admin/channels/${id}`, { method: "DELETE" }),
    applications: () => request<{ applications: TeamApplication[] }>("/admin/applications"),
    approveApplication: (id: number) => request<{ ok: boolean }>(`/admin/applications/${id}/approve`, { method: "POST" }),
    rejectApplication: (id: number) => request<{ ok: boolean }>(`/admin/applications/${id}/reject`, { method: "POST" }),
    deleteApplication: (id: number) => request<{ ok: boolean }>(`/admin/applications/${id}`, { method: "DELETE" }),
    resources: () => request<{ resources: AdminResource[] }>("/admin/resources"),
    createResource: (form: FormData, opts?: { onUploadProgress?: (p: UploadProgress) => void }) =>
      request<{ id: number }>("/admin/resources", { method: "POST", body: form, onUploadProgress: opts?.onUploadProgress }),
    updateResource: (id: number, form: FormData, opts?: { onUploadProgress?: (p: UploadProgress) => void }) =>
      request<{ ok: boolean }>(`/admin/resources/${id}`, { method: "PATCH", body: form, onUploadProgress: opts?.onUploadProgress }),
    deleteResource: (id: number) => request<{ ok: boolean }>(`/admin/resources/${id}`, { method: "DELETE" }),
    gameDownloads: () => request<{ downloads: AdminGameDownload[] }>("/admin/game-downloads"),
    createGameDownload: (data: {
      platform: string;
      version: string;
      releaseNotes?: string;
      published?: boolean;
      externalUrl: string;
      fileSize: number;
      fileSizeUnit: "MB" | "GB";
    }) =>
      request<{ id: number }>("/admin/game-downloads", { method: "POST", body: JSON.stringify(data) }),
    updateGameDownload: (id: number, data: {
      version?: string;
      releaseNotes?: string;
      published?: boolean;
      externalUrl?: string;
      fileSize?: number;
      fileSizeUnit?: "MB" | "GB";
    }) =>
      request<{ ok: boolean }>(`/admin/game-downloads/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteGameDownload: (id: number) => request<{ ok: boolean }>(`/admin/game-downloads/${id}`, { method: "DELETE" }),
    linkFiles: () => request<{ files: AdminLinkFile[] }>("/admin/link-files"),
    createLinkFile: (form: FormData, opts?: { onUploadProgress?: (p: UploadProgress) => void }) =>
      request<{ id: number }>("/admin/link-files", { method: "POST", body: form, onUploadProgress: opts?.onUploadProgress }),
    updateLinkFile: (id: number, form: FormData, opts?: { onUploadProgress?: (p: UploadProgress) => void }) =>
      request<{ ok: boolean }>(`/admin/link-files/${id}`, { method: "PATCH", body: form, onUploadProgress: opts?.onUploadProgress }),
    deleteLinkFile: (id: number) => request<{ ok: boolean }>(`/admin/link-files/${id}`, { method: "DELETE" }),
    linkFileLogs: (params: Record<string, string>) =>
      request<{ logs: AdminLinkFileAccessLog[]; total: number; page: number; limit: number }>(
        `/admin/link-files/logs?${new URLSearchParams(params)}`,
      ),
    deleteLinkFileLogs: (ids: number[]) =>
      request<{ ok: boolean; deleted: number }>("/admin/link-files/logs/bulk-delete", {
        method: "POST",
        body: JSON.stringify({ ids }),
      }),
    appInstallations: (params: Record<string, string>) =>
      request<{ installations: AppInstallationRecord[]; total: number; page: number; limit: number }>(
        `/admin/app-installations?${new URLSearchParams(params)}`,
      ),
    appInstallationsMeta: () =>
      request<{ appIds: string[]; apps: { id: string; name: string }[] }>("/admin/app-installations/meta"),
    deleteAppInstallations: (ids: number[]) =>
      request<{ ok: boolean; deleted: number }>("/admin/app-installations/bulk-delete", {
        method: "POST",
        body: JSON.stringify({ ids }),
      }),
    deleteAppInstallation: (id: number) =>
      request<{ ok: boolean }>(`/admin/app-installations/${id}`, { method: "DELETE" }),
    exportAppInstallations: async (params: Record<string, string> = {}) => {
      const token = getToken();
      const qs = new URLSearchParams(params).toString();
      const res = await fetch(`${API_BASE}/admin/app-installations/export${qs ? `?${qs}` : ""}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new ApiError("Export failed", res.status);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "app-installations.csv";
      a.click();
      URL.revokeObjectURL(url);
    },
    desktopReleases: (params: Record<string, string>) =>
      request<{ releases: DesktopReleaseRecord[]; total: number; page: number; limit: number }>(
        `/admin/desktop-releases?${new URLSearchParams(params)}`,
      ),
    desktopReleasesMeta: () =>
      request<{ apps: { id: string; name: string }[]; channels: string[] }>(
        "/admin/desktop-releases/meta",
      ),
    createDesktopRelease: (data: {
      appId: string;
      version: string;
      channel: string;
      githubReleaseUrl: string;
      releaseNotes?: string;
      minSupportedVersion?: string;
      checksum?: string;
      publishDate?: string;
      publish?: boolean;
    }) =>
      request<{ release: DesktopReleaseRecord }>("/admin/desktop-releases", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    updateDesktopRelease: (
      id: number,
      data: {
        githubReleaseUrl?: string;
        releaseNotes?: string;
        minSupportedVersion?: string;
        checksum?: string | null;
        publishDate?: string;
        channel?: string;
      },
    ) =>
      request<{ release: DesktopReleaseRecord }>(`/admin/desktop-releases/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    publishDesktopRelease: (id: number) =>
      request<{ release: DesktopReleaseRecord }>(`/admin/desktop-releases/${id}/publish`, { method: "POST" }),
    unpublishDesktopRelease: (id: number) =>
      request<{ ok: boolean }>(`/admin/desktop-releases/${id}/unpublish`, { method: "POST" }),
    deleteDesktopRelease: (id: number) =>
      request<{ ok: boolean }>(`/admin/desktop-releases/${id}`, { method: "DELETE" }),
    activityLogs: (params: Record<string, string>) => request<{ logs: ActivityLogEntry[]; total: number; page: number; limit: number }>(`/admin/activity-logs?${new URLSearchParams(params)}`),
    activityLogsMeta: () => request<{ eventTypes: string[]; eventCategories: string[] }>("/admin/activity-logs/meta"),
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
    deleteActivityLogs: (ids: number[]) =>
      request<{ ok: boolean; deleted: number; method: string }>("/admin/activity-logs/bulk-delete", {
        method: "POST",
        body: JSON.stringify({ ids }),
      }),
    conversations: (params?: Record<string, string>) =>
      request<{ conversations: AdminConversation[] }>(`/admin/conversations?${new URLSearchParams(params || {})}`),
    conversationMessages: (id: number, params?: Record<string, string>) =>
      request<{
        conversation: { id: number; type: string; name: string };
        messages: ApiMessage[];
        hasMore: boolean;
      }>(`/admin/conversations/${id}/messages?${new URLSearchParams(params || {})}`),
    deleteMessage: (id: number) =>
      request<{ ok: boolean }>(`/admin/messages/${id}`, { method: "DELETE" }),
    contacts: () => request<{ contacts: ContactTicket[] }>("/admin/contacts"),
    getContact: (id: number) => request<{ contact: ContactTicket }>(`/admin/contacts/${id}`),
    markContactRead: (id: number) => request<{ ok: boolean }>(`/admin/contacts/${id}/read`, { method: "PATCH" }),
    replyContact: (id: number, body: string) => request<{ contact: ContactTicket }>(`/admin/contacts/${id}/reply`, { method: "POST", body: JSON.stringify({ body }) }),
    deleteContact: (id: number) => request<{ ok: boolean }>(`/admin/contacts/${id}`, { method: "DELETE" }),
    databaseInfo: () => request<{
      provider: "sqlite" | "postgres"; type: string; version: string; schemaVersion: string; path: string;
      sizeBytes: number; sizeLabel: string;
      totalUsers: number; totalMessages: number; totalChannels: number; totalResources: number;
      totalNotifications: number; totalLogs: number; lastBackupAt: string | null; lastBackupFile: string | null;
    }>("/admin/database/info"),
    databaseBackup: async (opts?: { format?: "native" | "portable" }) => {
      const token = getToken();
      const qs = opts?.format ? `?${new URLSearchParams({ format: opts.format })}` : "";
      const res = await fetch(`${API_BASE}/admin/database/backup${qs}`, {
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
      const filename = match?.[1] || `ninja-era-backup-${Date.now()}.json.gz`;
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
    databaseTables: () => request<{ tables: { name: string; rowCount: number }[] }>("/admin/database/tables"),
    databaseTableSchema: (table: string) =>
      request<{ table: string; columns: DbConsoleColumn[]; columnCount: number; primaryKey: string[] }>(
        `/admin/database/tables/${encodeURIComponent(table)}/schema`,
      ),
    databaseTableRows: (table: string, params: Record<string, string>) =>
      request<{
        table: string;
        columns: DbConsoleColumn[];
        rows: Record<string, unknown>[];
        total: number;
        page: number;
        limit: number;
        primaryKey: string[];
      }>(`/admin/database/tables/${encodeURIComponent(table)}/rows?${new URLSearchParams(params)}`),
    databaseInsertRow: (table: string, data: Record<string, unknown>) =>
      request<{ ok: boolean; id: number; changes: number }>(`/admin/database/tables/${encodeURIComponent(table)}/rows`, {
        method: "POST",
        body: JSON.stringify({ data }),
      }),
    databaseUpdateRow: (table: string, pk: Record<string, unknown>, data: Record<string, unknown>) =>
      request<{ ok: boolean; changes: number }>(`/admin/database/tables/${encodeURIComponent(table)}/rows`, {
        method: "PATCH",
        body: JSON.stringify({ pk, data }),
      }),
    databaseDeleteRows: (table: string, keys: Record<string, unknown>[]) =>
      request<{ ok: boolean; changes: number }>(`/admin/database/tables/${encodeURIComponent(table)}/rows`, {
        method: "DELETE",
        body: JSON.stringify({ keys }),
      }),
  },
};

export type OurStoryPublic = {
  slug: string;
  title: string;
  subtitle: string;
  body: string;
  quote: string;
  imageUrl: string | null;
  updatedAt: string;
  publishedAt: string | null;
};

export type OurStoryContent = OurStoryPublic & {
  id: number;
  status: "draft" | "published";
  updatedBy: number | null;
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

export type AdminConversation = {
  id: number;
  type: "channel" | "dm";
  name: string;
  bio?: string;
  avatarUrl?: string | null;
  otherUserId?: number | null;
  preview: string;
  time: string;
  lastMessageAt?: string | null;
  messageCount: number;
  visibility?: string | null;
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
  avatarUrl?: string | null;
  sortOrder?: number;
  createdAt?: string;
};

export type TeamApplication = {
  id: number;
  applicant: { id: number; username: string; email: string; avatarUrl?: string };
  fullName: string;
  gender?: string;
  dateOfBirth?: string;
  country?: string;
  city?: string;
  message?: string;
  jobTitle: string;
  status: string;
  time: string;
  photoUrl?: string;
  cvUrl?: string;
  portfolioUrl?: string;
};

export type AdminResource = {
  id: number;
  title: string;
  category: string;
  description: string;
  contentUrl?: string | null;
  externalUrl?: string | null;
  enabled: boolean;
  fileSize?: number;
  version?: string;
  sortOrder?: number;
  uploaderName?: string;
  visibility?: "PUBLIC" | "PRIVATE";
};

export type DbConsoleColumn = {
  name: string;
  type: string;
  notnull: boolean;
  dfltValue: string | null;
  pk: boolean;
  sensitive: boolean;
};

export type GameFileSizeUnit = "MB" | "GB";

export type GameDownloadInfo = {
  platform: string;
  available: boolean;
  id: number | null;
  version: string | null;
  releaseNotes: string | null;
  /** Admin-entered size when `fileSizeUnit` is set; otherwise legacy byte count. */
  fileSize: number | null;
  fileSizeUnit: GameFileSizeUnit | null;
  publishedAt: string | null;
};

export type AdminGameDownload = {
  id: number;
  platform: string;
  version: string;
  releaseNotes: string;
  fileUrl?: string | null;
  externalUrl?: string | null;
  /** Admin-entered size when `fileSizeUnit` is set; otherwise legacy byte count. */
  fileSize?: number;
  fileSizeUnit?: GameFileSizeUnit | null;
  published: boolean;
  publishedAt?: string;
  uploaderName?: string;
};

export type AdminLinkFile = {
  id: number;
  alias: string;
  originalFilename: string;
  fileUrl: string;
  mimeType: string;
  fileSize: number;
  active: boolean;
  accessCount: number;
  lastAccessedAt: string | null;
  lastVisitor: string | null;
  lastVisitorUserId: number | null;
  uploaderId: number | null;
  uploaderName: string | null;
  createdAt: string;
  updatedAt: string;
  publicPath: string;
};

export type AdminLinkFileAccessLog = {
  id: number;
  linkFileId: number;
  alias: string;
  originalFilename: string;
  userId: number | null;
  visitor: string;
  ipAddress: string | null;
  userAgent: string | null;
  browser: string | null;
  platform: string | null;
  country?: string | null;
  countryCode?: string | null;
  createdAt: string;
};

export type AppInstallationRecord = {
  id: number;
  appId: string;
  appName: string | null;
  appVersion: string | null;
  buildVersion: string | null;
  releaseChannel: string | null;
  installationId: string;
  userId: number | null;
  username: string | null;
  userRole: string | null;
  isAnonymous: boolean;
  ipAddress: string | null;
  country: string | null;
  countryCode: string | null;
  operatingSystem: string | null;
  platform: string | null;
  status: string;
  userAgent: string | null;
  createdAt: string;
  /** Last opened / last upsert timestamp (falls back to createdAt). */
  updatedAt?: string;
};

export type DesktopReleaseRecord = {
  id: number;
  appId: string;
  appName?: string;
  version: string;
  channel: string;
  releaseNotes: string | null;
  minSupportedVersion: string | null;
  githubReleaseUrl: string | null;
  checksum: string | null;
  published: boolean;
  publishedAt: string | null;
  createdAt: string;
  createdBy: number | null;
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
  /** Formatted "Windows 10 (Chrome 149)" style label */
  platform?: string;
  ipAddress?: string;
  country?: string;
  countryCode?: string;
  isVpn?: boolean;
  result: string;
  metadata?: Record<string, unknown>;
};

