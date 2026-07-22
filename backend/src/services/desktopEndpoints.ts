/**
 * Live desktop-endpoint presence keyed by installation_id.
 * Driven by authenticated Socket.IO clients that emit `desktop:register`.
 */
import { asUserId } from "./calls.js";

export type DesktopEndpoint = {
  socketId: string;
  userId: number;
  installationId: string;
  appId: string;
  connectedAt: number;
};

const bySocket = new Map<string, DesktopEndpoint>();
const byInstallation = new Map<string, DesktopEndpoint>();

function normalizeInstallationId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  if (!id || id.length < 8 || id.length > 128) return null;
  if (!/^[A-Za-z0-9._:-]+$/.test(id)) return null;
  return id;
}

function normalizeAppId(raw: unknown): string {
  if (typeof raw !== "string") return "messenger";
  const id = raw.trim().toLowerCase();
  return id || "messenger";
}

export function registerDesktopEndpoint(opts: {
  socketId: string;
  userId: number;
  installationId: unknown;
  appId?: unknown;
}): DesktopEndpoint | null {
  const installationId = normalizeInstallationId(opts.installationId);
  const userId = asUserId(opts.userId);
  if (!installationId || !Number.isFinite(userId)) return null;

  // One live socket per installation — replace prior registration.
  const prev = byInstallation.get(installationId);
  if (prev && prev.socketId !== opts.socketId) {
    bySocket.delete(prev.socketId);
  }

  const endpoint: DesktopEndpoint = {
    socketId: opts.socketId,
    userId,
    installationId,
    appId: normalizeAppId(opts.appId),
    connectedAt: Date.now(),
  };
  bySocket.set(opts.socketId, endpoint);
  byInstallation.set(installationId, endpoint);
  return endpoint;
}

export function unregisterDesktopEndpoint(socketId: string): DesktopEndpoint | null {
  const ep = bySocket.get(socketId);
  if (!ep) return null;
  bySocket.delete(socketId);
  const cur = byInstallation.get(ep.installationId);
  if (cur?.socketId === socketId) byInstallation.delete(ep.installationId);
  return ep;
}

export function getDesktopEndpoint(installationId: string): DesktopEndpoint | null {
  const id = normalizeInstallationId(installationId);
  if (!id) return null;
  return byInstallation.get(id) ?? null;
}

export function isInstallationOnline(installationId: string): boolean {
  return !!getDesktopEndpoint(installationId);
}

export function getOnlineInstallationIds(): string[] {
  return Array.from(byInstallation.keys());
}

export function isUserDesktopOnline(userId: number): boolean {
  const uid = asUserId(userId);
  if (!Number.isFinite(uid)) return false;
  for (const ep of byInstallation.values()) {
    if (ep.userId === uid) return true;
  }
  return false;
}
