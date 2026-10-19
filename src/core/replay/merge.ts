// Builds one race replay from runners pulled out of v40+ replays
// Chunks are copied as is (still compressed) unless a runner needs a tick shift, only the zip, meta.json and timelines.json are new
import { zipSync, strToU8 } from "fflate";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";
import { FORMAT_MARKER, ReplayError, readRrf, checkReadable, splitChunks, type RawChunk, type ReplayMeta, type TimelineEntry } from "./decode";
import { recordLength } from "./walk";

export interface RunnerSource {
  bytes: Uint8Array;
  uuid: string;
  /** Ticks to add to this runner's timeline, positive = later */
  shiftTicks?: number;
}

export interface MergeResult { bytes: Uint8Array; meta: ReplayMeta; timelines: TimelineEntry[] }

export const FINISH_TYPES = ["projectelo.timeline.dragon_death", "projectelo.timeline.complete"];

/** Adds `shift` to every absolute tick in a compressed chunk */
export function retimeChunk(body: Uint8Array, shift: number): Uint8Array {
  if (!shift) return body;
  const raw = new Uint8Array(zstdDecompressSync(body));
  const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (raw[16] !== FORMAT_MARKER) throw new ReplayError("unknown record format");
  let i = 17;
  while (i < raw.length) {
    const type = raw[i], d = raw[i + 1];
    i += 2;
    if (d === 255) { v.setInt32(i, v.getInt32(i) + shift); i += 4; }
    i += recordLength(type, raw, i);
  }
  return new Uint8Array(zstdCompressSync(raw));
}

export function mergeRunners(sources: RunnerSource[]): MergeResult {
  const metas: ReplayMeta[] = [];
  const players: ReplayMeta["players"] = [];
  const timelines: TimelineEntry[] = [];
  const picked: RawChunk[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    if (seen.has(s.uuid)) throw new ReplayError("the same player can't be in a race twice");
    seen.add(s.uuid);
    const { meta, timelines: tl, rpd } = readRrf(s.bytes);
    checkReadable(meta);
    metas.push(meta);
    const p = meta.players.find((x) => x.uuid === s.uuid);
    if (!p) throw new ReplayError(`player ${s.uuid} is not in that replay`);
    players.push(p);
    const shift = s.shiftTicks ?? 0;
    for (const e of tl) if (e.uuid === s.uuid) timelines.push({ ...e, time: e.time + shift * 50 });
    for (const c of splitChunks(rpd)) {
      if (c.uuid !== s.uuid) continue;
      picked.push(shift ? { ...c, firstTick: c.firstTick + shift, body: retimeChunk(c.body, shift) } : c);
    }
  }
  const seeds = new Set(metas.map((m) => `${m.overworldSeed}/${m.netherSeed}`));
  if (seeds.size > 1) throw new ReplayError("these runs are on different seeds");
  // Keep each runner's chunk order, interleave by first tick like Ranked's own files
  const body = picked.map((c, i) => ({ c, i })).sort((a, b) => a.c.firstTick - b.c.firstTick || a.i - b.i).map((x) => x.c);
  let size = 0;
  for (const c of body) size += 4 + c.body.length;
  const rpd = new Uint8Array(size);
  const dv = new DataView(rpd.buffer);
  let o = 0;
  for (const c of body) { dv.setUint32(o, c.body.length); rpd.set(c.body, o + 4); o += 4 + c.body.length; }

  const finishes = timelines.filter((e) => FINISH_TYPES.includes(e.type)).sort((a, b) => a.time - b.time);
  const meta: ReplayMeta = {
    ...metas[0],
    players,
    symmetricKey: null,
    result: finishes.length ? { uuid: finishes[0].uuid, time: finishes[0].time } : { uuid: null, time: Math.max(0, ...timelines.map((e) => e.time)) },
  };
  timelines.sort((a, b) => b.time - a.time);
  const bytes = zipSync({
    "replay.rpd": [rpd, { level: 0 }],
    "meta.json": strToU8(JSON.stringify(meta)),
    "timelines.json": strToU8(JSON.stringify(timelines)),
  });
  return { bytes, meta, timelines };
}
