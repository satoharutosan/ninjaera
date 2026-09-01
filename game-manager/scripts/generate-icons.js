/**
 * Generate PNG icons for the Chrome extension.
 * Run: node scripts/generate-icons.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let j = 0; j < 8; j++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (~c) >>> 0;
}

function createChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function createPNG(size) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = [];
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.38;

  for (let y = 0; y < size; y++) {
    raw.push(0); // filter none
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < r) {
        // Purple-indigo gradient circle
        const t = (dx + r) / (2 * r);
        raw.push(Math.round(99 + t * 40));  // R
        raw.push(Math.round(102 + t * 20)); // G
        raw.push(Math.round(241 - t * 30)); // B
      } else if (dist < r + 1.5) {
        raw.push(99, 102, 241); // border
      } else {
        raw.push(0, 0, 0, 0); // transparent - use RGBA instead
      }
    }
  }

  // Use RGBA for transparency
  ihdr[9] = 6;
  const rawRGBA = [];
  for (let y = 0; y < size; y++) {
    rawRGBA.push(0);
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < r) {
        const t = (dx + r) / (2 * r);
        rawRGBA.push(Math.round(99 + t * 40));
        rawRGBA.push(Math.round(102 + t * 20));
        rawRGBA.push(Math.round(241 - t * 30));
        rawRGBA.push(255);
      } else {
        rawRGBA.push(0, 0, 0, 0);
      }
    }
  }

  const compressed = zlib.deflateSync(Buffer.from(rawRGBA));
  const ihdrChunk = createChunk('IHDR', ihdr);
  const idatChunk = createChunk('IDAT', compressed);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const outDir = path.join(__dirname, '..', 'extension', 'assets', 'icons');
fs.mkdirSync(outDir, { recursive: true });

for (const size of [16, 48, 128]) {
  const png = createPNG(size);
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), png);
  console.log(`Created icon${size}.png`);
}

console.log('Done.');
