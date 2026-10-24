// A background image you picked yourself, kept as a copy in the data folder
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
const MAX = 30 * 1024 * 1024;

/** Copies the image in and returns its art key, "custom:<hash>". Only the latest pick is kept. */
export function saveCustomArt(dir: string, file: string): string | null {
  const ext = extname(file).toLowerCase();
  if (!MIME[ext] || !existsSync(file) || statSync(file).size > MAX) return null;
  const hash = createHash("sha1").update(readFileSync(file)).digest("hex").slice(0, 10);
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (!f.startsWith(`${hash}.`)) rmSync(join(dir, f), { force: true });
  copyFileSync(file, join(dir, `${hash}${ext}`));
  return `custom:${hash}`;
}

export function customArtData(dir: string, key: string): string | null {
  const hash = key.slice("custom:".length);
  if (!/^[0-9a-f]{10}$/.test(hash) || !existsSync(dir)) return null;
  const f = readdirSync(dir).find((x) => x.startsWith(`${hash}.`));
  return f ? `data:${MIME[extname(f)] ?? "image/png"};base64,${readFileSync(join(dir, f)).toString("base64")}` : null;
}
