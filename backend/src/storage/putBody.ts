import fs from "fs";
import type { Readable } from "stream";
import type { PutObjectInput } from "./types.js";

/** Resolve a PutObjectInput into a streamable/buffer body without loading path→Buffer. */
export function resolvePutBody(input: PutObjectInput): {
  body: Buffer | Uint8Array | Readable;
  size: number;
  fromPath?: string;
} {
  if (input.filePath) {
    if (!fs.existsSync(input.filePath)) {
      throw new Error(`Upload temp file missing: ${input.filePath}`);
    }
    const size = input.contentLength ?? fs.statSync(input.filePath).size;
    return {
      body: fs.createReadStream(input.filePath),
      size,
      fromPath: input.filePath,
    };
  }
  if (input.stream) {
    return {
      body: input.stream,
      size: input.contentLength ?? 0,
    };
  }
  if (input.body) {
    const buf = Buffer.isBuffer(input.body) ? input.body : Buffer.from(input.body);
    return { body: buf, size: buf.length };
  }
  throw new Error("putObject requires body, filePath, or stream");
}
