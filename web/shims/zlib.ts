// node:zlib for the browser build, just the zstd the replay format uses. fzstd decompresses. Mixed replays get written
// as zstd frames with uncompressed blocks: still valid zstd that any decoder reads, just not smaller
import { decompress } from "fzstd";

export function zstdDecompressSync(b: Uint8Array): Uint8Array { return decompress(b); }

const BLOCK = 128 * 1024;
export function zstdCompressSync(raw: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(raw.length / BLOCK));
  const out = new Uint8Array(4 + 1 + 4 + blocks * 3 + raw.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0xfd2fb528, true); // Magic
  out[4] = 0xa0; // Single segment, 4 byte content size, no checksum or dictionary
  v.setUint32(5, raw.length, true);
  let o = 9;
  for (let i = 0; i < blocks; i++) {
    const part = raw.subarray(i * BLOCK, Math.min(raw.length, (i + 1) * BLOCK));
    const head = (i === blocks - 1 ? 1 : 0) | (part.length << 3); // Raw block, last flag on the final one
    out[o] = head & 0xff; out[o + 1] = (head >> 8) & 0xff; out[o + 2] = (head >> 16) & 0xff;
    out.set(part, o + 3);
    o += 3 + part.length;
  }
  return out;
}

export default { zstdDecompressSync, zstdCompressSync };
