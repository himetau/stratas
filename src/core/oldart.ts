import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "fflate";

const VERSIONS = "https://api.modrinth.com/v2/project/mcsr-ranked/version";
const UA = "Stratas (MCSR Ranked training tool)";

const EOCD_SIGNATURE = 0x06054b50;
const EOCD_SIZE = 22;
const MAX_ZIP_COMMENT = 0xffff;
const CENTRAL_SIGNATURE = 0x02014b50;
const CENTRAL_HEADER_SIZE = 46;
const LOCAL_HEADER_SIZE = 30;
const DEFLATE = 8;

export interface OldArt {
  key: string;
  label: string;
  versions: string;
  file: string;
}

interface Entry {
  name: string;
  crc: number;
  method: number;
  csize: number;
  offset: number;
}

interface ModrinthVersion {
  version_number: string;
  files: { url: string; size: number; primary?: boolean }[];
}

async function range(url: string, from: number, to: number): Promise<Uint8Array> {
  const res = await fetch(url, { headers: { Range: `bytes=${from}-${to}`, "User-Agent": UA } });
  if (res.status !== 206 && res.status !== 200) {
    throw new Error(`${res.status} for ${url}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

const dataView = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** Reads the central directory of a remote zip through the end record in its tail. */
async function zipIndex(url: string, size: number): Promise<Entry[]> {
  const tail = await range(url, Math.max(0, size - EOCD_SIZE - MAX_ZIP_COMMENT), size - 1);
  const tailView = dataView(tail);
  let eocd = -1;
  for (let i = tail.length - EOCD_SIZE; i >= 0; i--) {
    if (tailView.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error("no zip end record");
  }
  const cdSize = tailView.getUint32(eocd + 12, true);
  const cdOffset = tailView.getUint32(eocd + 16, true);
  const cd = await range(url, cdOffset, cdOffset + cdSize - 1);
  const cdView = dataView(cd);
  const decoder = new TextDecoder();
  const out: Entry[] = [];
  let p = 0;
  while (p + CENTRAL_HEADER_SIZE <= cd.length && cdView.getUint32(p, true) === CENTRAL_SIGNATURE) {
    const nameLen = cdView.getUint16(p + 28, true);
    const extraLen = cdView.getUint16(p + 30, true);
    const commentLen = cdView.getUint16(p + 32, true);
    out.push({
      name: decoder.decode(cd.subarray(p + CENTRAL_HEADER_SIZE, p + CENTRAL_HEADER_SIZE + nameLen)),
      method: cdView.getUint16(p + 10, true),
      crc: cdView.getUint32(p + 16, true),
      csize: cdView.getUint32(p + 20, true),
      offset: cdView.getUint32(p + 42, true),
    });
    p += CENTRAL_HEADER_SIZE + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Downloads one file out of a remote zip. Its local header says where the data starts. */
async function zipFile(url: string, e: Entry): Promise<Uint8Array> {
  const head = dataView(await range(url, e.offset, e.offset + LOCAL_HEADER_SIZE - 1));
  const start = e.offset + LOCAL_HEADER_SIZE + head.getUint16(26, true) + head.getUint16(28, true);
  const data = await range(url, start, start + e.csize - 1);
  return e.method === DEFLATE ? inflateSync(data) : data;
}

/** Picks a release's menu background: the sharp one, else the blurred one,
 *  else the biggest gui background. */
function pickMenuBackground(entries: Entry[]): Entry | undefined {
  const backgrounds = entries.filter(
    (e) =>
      /textures\/gui\/background(_blur)?\.png$/i.test(e.name) ||
      (/\/gui\/.*background.*\.png$/i.test(e.name) &&
        !/seed_background|user_background|flags/.test(e.name)),
  );
  return (
    backgrounds.find((e) => /background\.png$/i.test(e.name)) ??
    backgrounds.find((e) => /background_blur\.png$/i.test(e.name)) ??
    backgrounds.sort((a, b) => b.csize - a.csize)[0]
  );
}

/** Lists the backgrounds fetched before, newest first. */
export function cachedOldArt(dir: string): OldArt[] {
  try {
    return JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as OldArt[];
  } catch {
    return [];
  }
}

/** Returns the newest patch of each minor version, newest first. */
function newestPerMinor(versions: ModrinthVersion[]): Map<string, ModrinthVersion> {
  const minors = new Map<string, ModrinthVersion>();
  // The Modrinth API lists versions newest first.
  for (const v of versions) {
    const minor = v.version_number.split(".").slice(0, 2).join(".");
    if (!minors.has(minor)) {
      minors.set(minor, v);
    }
  }
  return minors;
}

/** Saves each different menu background from one Ranked release per minor version on Modrinth.
 *  Range requests read only each jar's zip index and its background image. */
export async function fetchOldArt(
  dir: string,
  log: (m: string) => void = () => {},
): Promise<OldArt[]> {
  mkdirSync(dir, { recursive: true });
  const res = await fetch(VERSIONS, { headers: { "User-Agent": UA } });
  if (!res.ok) {
    throw new Error(`Modrinth ${res.status}`);
  }
  const all = (await res.json()) as ModrinthVersion[];
  const byCrc = new Map<number, Omit<OldArt, "label">>();
  for (const [minor, v] of newestPerMinor(all)) {
    const jar = v.files.find((x) => x.primary) ?? v.files[0];
    if (!jar) {
      continue;
    }
    try {
      const e = pickMenuBackground(await zipIndex(jar.url, jar.size));
      if (!e) {
        continue;
      }
      const seen = byCrc.get(e.crc);
      if (seen) {
        seen.versions = `${minor}–${seen.versions.split("–").at(-1)}`;
        continue;
      }
      const file = join(dir, `${e.crc.toString(16)}.png`);
      if (!existsSync(file)) {
        writeFileSync(file, await zipFile(jar.url, e));
      }
      byCrc.set(e.crc, { key: `old:${e.crc.toString(16)}`, versions: minor, file });
      log(`Ranked ${minor}: new menu background`);
    } catch (err) {
      log(`Ranked ${minor}: ${(err as Error).message}`);
    }
  }
  const fetched: OldArt[] = [...byCrc.values()].map(({ key, versions, file }) => ({
    key,
    label: `Ranked ${versions}`,
    versions,
    file,
  }));
  const missedThisTime = cachedOldArt(dir).filter(
    (old) => existsSync(old.file) && !fetched.some((f) => f.key === old.key),
  );
  const list = [...fetched, ...missedThisTime];
  writeFileSync(join(dir, "index.json"), JSON.stringify(list));
  return list;
}

/** Returns a fetched background as a data URL. */
export function oldArtData(dir: string, key: string): string | null {
  const art = cachedOldArt(dir).find((x) => x.key === key);
  if (!art || !existsSync(art.file)) {
    return null;
  }
  return `data:image/png;base64,${readFileSync(art.file).toString("base64")}`;
}
