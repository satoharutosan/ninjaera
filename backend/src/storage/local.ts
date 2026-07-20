import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import type { Readable } from "stream";
import type { PutObjectInput, PutObjectResult, StorageProvider } from "./types.js";
import { resolvePutBody } from "./putBody.js";

export type LocalStorageOptions = {
  rootDir: string;
  /** Public URL prefix, default `/uploads` */
  publicPrefix?: string;
};

function sanitizeKey(raw: string): string {
  return raw.replace(/^[/\\]+/, "").replace(/\.\./g, "").replace(/\\/g, "/");
}

export function createLocalStorage(opts: LocalStorageOptions): StorageProvider {
  const root = path.resolve(opts.rootDir);
  const prefix = (opts.publicPrefix || "/uploads").replace(/\/$/, "");
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });

  function keyFromUrl(urlOrKey: string): string | null {
    if (!urlOrKey) return null;
    if (urlOrKey.startsWith(prefix + "/")) return sanitizeKey(urlOrKey.slice(prefix.length + 1));
    if (urlOrKey.startsWith("/uploads/")) return sanitizeKey(urlOrKey.slice("/uploads/".length));
    if (!urlOrKey.includes("://") && !urlOrKey.startsWith("/")) return sanitizeKey(urlOrKey);
    try {
      const u = new URL(urlOrKey);
      const idx = u.pathname.indexOf("/uploads/");
      if (idx >= 0) return sanitizeKey(u.pathname.slice(idx + "/uploads/".length));
    } catch { /* */ }
    return null;
  }

  /** Resolve a key under the storage root; returns null if it would escape. */
  function resolveUnderRoot(key: string): string | null {
    const safe = sanitizeKey(key);
    if (!safe) return null;
    const dest = path.resolve(root, safe);
    const relative = path.relative(root, dest);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
    return dest;
  }

  return {
    provider: "local",
    localRoot: root,

    async putObject(input: PutObjectInput): Promise<PutObjectResult> {
      const key = sanitizeKey(input.key);
      const dest = resolveUnderRoot(key);
      if (!dest) throw new Error("Invalid storage key");
      const dir = path.dirname(dest);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      // Same-volume copy avoids buffering multi‑GB files in Node heap.
      if (input.filePath && fs.existsSync(input.filePath)) {
        await fs.promises.copyFile(input.filePath, dest);
        const size = input.contentLength ?? (await fs.promises.stat(dest)).size;
        return { url: `${prefix}/${key.replace(/\\/g, "/")}`, key, size };
      }

      const resolved = resolvePutBody(input);
      if (Buffer.isBuffer(resolved.body) || resolved.body instanceof Uint8Array) {
        const buf = Buffer.isBuffer(resolved.body) ? resolved.body : Buffer.from(resolved.body);
        await fs.promises.writeFile(dest, buf);
        return { url: `${prefix}/${key.replace(/\\/g, "/")}`, key, size: buf.length };
      }

      await pipeline(resolved.body as Readable, fs.createWriteStream(dest));
      const size = input.contentLength ?? (await fs.promises.stat(dest)).size;
      return { url: `${prefix}/${key.replace(/\\/g, "/")}`, key, size };
    },

    async deleteObject(urlOrKey: string) {
      const key = keyFromUrl(urlOrKey);
      if (!key) return;
      const dest = resolveUnderRoot(key);
      if (!dest) return;
      try {
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
      } catch { /* */ }
    },

    async getPublicUrl(urlOrKey: string) {
      // Never bounce absolute external URLs — avoid open redirect via stored content_url.
      if (urlOrKey.startsWith("http://") || urlOrKey.startsWith("https://")) {
        const key = keyFromUrl(urlOrKey);
        if (!key) return `${prefix}/`;
        return `${prefix}/${key.replace(/\\/g, "/")}`;
      }
      const key = keyFromUrl(urlOrKey) || sanitizeKey(urlOrKey);
      return `${prefix}/${key.replace(/\\/g, "/")}`;
    },

    isManagedUrl(url: string) {
      return url.startsWith(prefix + "/") || url.startsWith("/uploads/");
    },
  };
}
