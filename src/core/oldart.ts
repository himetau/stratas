// Menu backgrounds from older MCSR Ranked releases. Reads only the zip index and the image out of each jar on
// Modrinth (HTTP range requests), one release per minor version, and keeps each different image once
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "fflate";

const VERSIONS = "https://api.modrinth.com/v2/project/mcsr-ranked/version";
const UA = "Stratas (MCSR Ranked training tool)";

export interface OldArt { key: string; label: string; versions: string; file: string }

interface Entry { name: string; crc: number; method: number; csize: number; offset: number }

async function range(url: string, from: number, to: number): Promise<Uint8Array> {
  const res = await fetch(url, { headers: { Range: `bytes=${from}-${to}`, "User-Agent": UA } });
  if (res.status !== 206 && res.status !== 200) throw new Error(`${res.status} for ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Zip central directory of a remote file, from its last 64 KB (end record) then the directory itself */
async function zipIndex(url: string, size: number): Promise<Entry[]> {
  const tail = await range(url, Math.max(0, size - 65_557), size - 1);
  const dv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("no zip end record");
  const cdSize = dv.getUint32(eocd + 12, true), cdOff = dv.getUint32(eocd + 16, true);
  const cd = await range(url, cdOff, cdOff + cdSize - 1);
  const c = new DataView(cd.buffer, cd.byteOffset, cd.byteLength), dec = new TextDecoder();
  const out: Entry[] = [];
  for (let p = 0; p + 46 <= cd.length && c.getUint32(p, true) === 0x02014b50;) {
    const nameLen = c.getUint16(p + 28, true), extra = c.getUint16(p + 30, true), comment = c.getUint16(p + 32, true);
    out.push({ name: dec.decode(cd.subarray(p + 46, p + 46 + nameLen)), method: c.getUint16(p + 10, true), crc: c.getUint32(p + 16, true),
      csize: c.getUint32(p + 20, true), offset: c.getUint32(p + 42, true) });
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

/** One file out of a remote zip: its local header says where the data starts */
async function zipFile(url: string, e: Entry): Promise<Uint8Array> {
  const head = await range(url, e.offset, e.offset + 29);
  const h = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const start = e.offset + 30 + h.getUint16(26, true) + h.getUint16(28, true);
  const data = await range(url, start, start + e.csize - 1);
  return e.method === 8 ? inflateSync(data) : data;
}

/** The menu background in a release: the sharp one if it has it, else the blurred one, else any big gui background */
const pick = (es: Entry[]) => {
  const bg = es.filter((e) => /textures\/gui\/background(_blur)?\.png$/i.test(e.name) || (/\/gui\/.*background.*\.png$/i.test(e.name) && !/seed_background|user_background|flags/.test(e.name)));
  return bg.find((e) => /background\.png$/i.test(e.name)) ?? bg.find((e) => /background_blur\.png$/i.test(e.name)) ?? bg.sort((a, b) => b.csize - a.csize)[0];
};

/** What's been fetched before, newest first */
export function cachedOldArt(dir: string): OldArt[] {
  try { return JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as OldArt[]; } catch { return []; }
}

/** Look through one release per minor version and save each different menu background. Slow-ish, goes online */
export async function fetchOldArt(dir: string, log: (m: string) => void = () => {}): Promise<OldArt[]> {
  mkdirSync(dir, { recursive: true });
  const res = await fetch(VERSIONS, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Modrinth ${res.status}`);
  const all = (await res.json()) as { version_number: string; date_published: string; files: { url: string; size: number; primary?: boolean }[] }[];
  // Newest patch of each minor version, newest first (the API lists newest first)
  const minors = new Map<string, typeof all[number]>();
  for (const v of all) { const m = v.version_number.split(".").slice(0, 2).join("."); if (!minors.has(m)) minors.set(m, v); }
  const found = new Map<number, OldArt & { crc: number }>();
  for (const [minor, v] of minors) {
    const f = v.files.find((x) => x.primary) ?? v.files[0];
    if (!f) continue;
    try {
      const e = pick(await zipIndex(f.url, f.size));
      if (!e) continue;
      const seen = found.get(e.crc);
      // Same image as a newer release, it just goes back further
      if (seen) { seen.versions = `${minor}–${seen.versions.split("–").at(-1)}`; continue; }
      const file = join(dir, `${e.crc.toString(16)}.png`);
      if (!existsSync(file)) writeFileSync(file, await zipFile(f.url, e));
      found.set(e.crc, { key: `old:${e.crc.toString(16)}`, label: `Ranked ${minor}`, versions: minor, file, crc: e.crc });
      log(`Ranked ${minor}: new menu background`);
    } catch (err) { log(`Ranked ${minor}: ${(err as Error).message}`); }
  }
  const list = [...found.values()].map(({ crc: _, ...a }) => ({ ...a, label: `Ranked ${a.versions}` }));
  writeFileSync(join(dir, "index.json"), JSON.stringify(list));
  return list;
}

/** A fetched background as a data URL */
export function oldArtData(dir: string, key: string): string | null {
  const a = cachedOldArt(dir).find((x) => x.key === key);
  if (!a || !existsSync(a.file)) return null;
  return `data:image/png;base64,${readFileSync(a.file).toString("base64")}`;
}
