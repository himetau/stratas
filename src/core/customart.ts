import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { extname, join } from "node:path";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};
const MAX_BYTES = 30 * 1024 * 1024;
const KEY_PREFIX = "custom:";

/** Copies a picked background image into dir and returns its art key, "custom:<hash>".
 *  Only the latest pick is kept. */
export function saveCustomArt(dir: string, file: string): string | null {
  const ext = extname(file).toLowerCase();
  if (!MIME[ext] || !existsSync(file) || statSync(file).size > MAX_BYTES) {
    return null;
  }
  const hash = createHash("sha1").update(readFileSync(file)).digest("hex").slice(0, 10);
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) {
    if (!f.startsWith(`${hash}.`)) {
      rmSync(join(dir, f), { force: true });
    }
  }
  copyFileSync(file, join(dir, `${hash}${ext}`));
  return `${KEY_PREFIX}${hash}`;
}

export function customArtData(dir: string, key: string): string | null {
  const hash = key.slice(KEY_PREFIX.length);
  if (!/^[0-9a-f]{10}$/.test(hash) || !existsSync(dir)) {
    return null;
  }
  const file = readdirSync(dir).find((f) => f.startsWith(`${hash}.`));
  if (!file) {
    return null;
  }
  const mime = MIME[extname(file)] ?? "image/png";
  return `data:${mime};base64,${readFileSync(join(dir, file)).toString("base64")}`;
}
