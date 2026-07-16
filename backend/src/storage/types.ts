/** Storage provider abstraction for user-uploaded files. */

export type StorageProviderName = "local" | "s3" | "cloud";

export type PutObjectInput = {
  /** Destination key / relative path, e.g. `avatars/123.png` or `channel-avatar-….webp` */
  key: string;
  body: Buffer | Uint8Array;
  contentType?: string;
  originalName?: string;
};

export type PutObjectResult = {
  /** Public or app-relative URL stored in the database. */
  url: string;
  key: string;
  size: number;
};

export interface StorageProvider {
  readonly provider: StorageProviderName;
  /** Absolute local root when provider is local; otherwise null. */
  readonly localRoot: string | null;

  putObject(input: PutObjectInput): Promise<PutObjectResult>;
  deleteObject(urlOrKey: string): Promise<void>;
  /** Resolve a stored URL/key to a publicly fetchable URL. */
  getPublicUrl(urlOrKey: string): Promise<string>;
  /** Optional short-lived signed URL for private downloads. */
  getSignedDownloadUrl?(urlOrKey: string, expiresInSeconds?: number): Promise<string>;
  /** Whether this URL/key is managed by this storage layer. */
  isManagedUrl(url: string): boolean;
}

export function resolveStorageProviderName(): StorageProviderName {
  const raw = (process.env.STORAGE_PROVIDER || "local").trim().toLowerCase();
  if (raw === "s3" || raw === "r2" || raw === "cloud" || raw === "minio") return "s3";
  return "local";
}

/** Build a unique object key with optional prefix. */
export function makeObjectKey(prefix: string, originalName: string): string {
  const ext = (originalName.match(/\.[a-zA-Z0-9]+$/) || [""])[0].toLowerCase();
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, "") || "file";
  return `${safePrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
}
