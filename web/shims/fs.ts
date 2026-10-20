// node:fs for the browser build. Files live in memory: replays you drop on the page, mixed replays Stratas makes
// and the database folder. persist.ts saves them in the browser between visits
import { dirname, normalize } from "path-browserify";

interface Entry { data: Uint8Array; mtime: number }
const files = new Map<string, Entry>();
const dirs = new Set<string>(["/"]);
const norm = (p: string) => { const n = normalize(p); return n.length > 1 && n.endsWith("/") ? n.slice(0, -1) : n; };
const missing = (p: string) => Object.assign(new Error(`ENOENT: no such file or directory, '${p}'`), { code: "ENOENT" });

export type FSWatcher = { close(): void };

export function mkdirSync(p: string, _opts?: unknown) {
  for (let d = norm(p); !dirs.has(d); d = dirname(d)) dirs.add(d);
}
export function existsSync(p: string) { const n = norm(p); return files.has(n) || dirs.has(n); }
export function readdirSync(p: string): string[] {
  const n = norm(p);
  if (!dirs.has(n)) throw missing(p);
  const out = new Set<string>();
  for (const k of [...files.keys(), ...dirs]) if (k !== n && dirname(k) === n) out.add(k.slice(n === "/" ? 1 : n.length + 1));
  return [...out];
}
export function statSync(p: string) {
  const n = norm(p), f = files.get(n);
  if (f) return { size: f.data.length, mtimeMs: f.mtime, isFile: () => true, isDirectory: () => false };
  if (dirs.has(n)) return { size: 0, mtimeMs: 0, isFile: () => false, isDirectory: () => true };
  throw missing(p);
}
export function readFileSync(p: string, enc?: string | { encoding?: string }): never | Uint8Array | string {
  const f = files.get(norm(p));
  if (!f) throw missing(p);
  const e = typeof enc === "string" ? enc : enc?.encoding;
  return e ? new TextDecoder().decode(f.data) : f.data;
}
export function writeFileSync(p: string, data: Uint8Array | string, mtime = Date.now()) {
  const n = norm(p);
  mkdirSync(dirname(n));
  files.set(n, { data: typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data), mtime });
  changed();
}
export function copyFileSync(a: string, b: string) { writeFileSync(b, readFileSync(a) as Uint8Array); }
export function renameSync(a: string, b: string) { copyFileSync(a, b); unlinkSync(a); }
export function unlinkSync(p: string) { if (!files.delete(norm(p))) throw missing(p); changed(); }
export function rmSync(p: string) { files.delete(norm(p)); changed(); }
export function rmdirSync(p: string) { dirs.delete(norm(p)); }
// No folder watching in a browser, the page rescans after you drop files instead
export function watch(): FSWatcher { throw new Error("can't watch folders in the browser"); }

// ---- for the web app: saving and loading, and knowing when something changed
let onChange: (() => void) | null = null;
const changed = () => onChange?.();
export function onFilesChanged(fn: () => void) { onChange = fn; }
export function allFiles(): [string, Entry][] { return [...files.entries()]; }
export function loadFiles(list: [string, Entry][]) { for (const [p, e] of list) { mkdirSync(dirname(p)); files.set(p, e); } }

export default { mkdirSync, existsSync, readdirSync, statSync, readFileSync, writeFileSync, copyFileSync, renameSync, unlinkSync, rmSync, rmdirSync, watch };
