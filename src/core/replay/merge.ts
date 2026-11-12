// Builds one race replay from runners pulled out of v40+ replays
// Chunks keep their records; retiming, size padding or stronger compression may change their encoded bytes.
import { zipSync, strToU8 } from "fflate";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";
import {
  FORMAT_MARKER,
  ReplayError,
  readRrf,
  checkReadable,
  splitChunks,
  type RawChunk,
  type ReplayMeta,
  type TimelineEntry,
} from "./decode";
import { recordLength } from "./walk";
import { matchReplaySize, packChunks, type SizeReference } from "./size";

export interface RunnerSource {
  bytes: Uint8Array;
  uuid: string;
  /** Ticks to add to this runner's timeline, positive = later */
  shiftTicks?: number;
}

export interface MergeResult {
  bytes: Uint8Array;
  meta: ReplayMeta;
  timelines: TimelineEntry[];
}

const FINISH_TYPES = ["projectelo.timeline.dragon_death", "projectelo.timeline.complete"];

/** Adds `shift` to every absolute tick in a compressed chunk */
export function retimeChunk(body: Uint8Array, shift: number): Uint8Array {
  if (!shift) {
    return body;
  }
  const raw = new Uint8Array(zstdDecompressSync(body));
  const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (raw[16] !== FORMAT_MARKER) {
    throw new ReplayError("unknown record format");
  }
  let i = 17;
  while (i < raw.length) {
    const type = raw[i];
    const d = raw[i + 1];
    i += 2;
    if (d === 255) {
      v.setInt32(i, v.getInt32(i) + shift);
      i += 4;
    }
    i += recordLength(type, raw, i);
  }
  return new Uint8Array(zstdCompressSync(raw));
}

export function mergeRunners(
  sources: RunnerSource[],
  options: { matchSourceSize?: boolean; sizeDonors?: () => SizeReference[] } = {},
): MergeResult {
  if (!sources.length) {
    throw new ReplayError("at least one runner is required");
  }
  const metas: ReplayMeta[] = [];
  const references: SizeReference[] = [];
  const players: ReplayMeta["players"] = [];
  const timelines: TimelineEntry[] = [];
  const picked: RawChunk[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    if (seen.has(s.uuid)) {
      throw new ReplayError("the same player can't be in a replay twice");
    }
    seen.add(s.uuid);
    const { meta, timelines: tl, rpd } = readRrf(s.bytes);
    checkReadable(meta);
    metas.push(meta);
    references.push({ meta, rpd });
    const p = meta.players.find((x) => x.uuid === s.uuid);
    if (!p) {
      throw new ReplayError(`player ${s.uuid} is not in that replay`);
    }
    players.push(p);
    const shift = s.shiftTicks ?? 0;
    for (const e of tl) {
      if (e.uuid === s.uuid) {
        timelines.push({ ...e, time: e.time + shift * 50 });
      }
    }
    for (const c of splitChunks(rpd)) {
      if (c.uuid !== s.uuid) {
        continue;
      }
      picked.push(
        shift ? { ...c, firstTick: c.firstTick + shift, body: retimeChunk(c.body, shift) } : c,
      );
    }
  }
  const seeds = new Set(metas.map((m) => `${m.overworldSeed}/${m.netherSeed}/${m.theEndSeed}`));
  if (seeds.size > 1) {
    throw new ReplayError("these runs are on different seeds");
  }
  // Chunks interleave by first tick like Ranked's own files.
  // The sort is stable, so each runner's chunks keep their order.
  picked.sort((a, b) => a.firstTick - b.firstTick);
  let rpd = packChunks(picked.map((c) => c.body));

  const finishes = timelines
    .filter((e) => FINISH_TYPES.includes(e.type))
    .sort((a, b) => a.time - b.time);
  let meta: ReplayMeta = {
    ...metas[0],
    players,
    symmetricKey: null,
    result: finishes.length
      ? { uuid: finishes[0].uuid, time: finishes[0].time }
      : { uuid: null, time: Math.max(0, ...timelines.map((e) => e.time)) },
  };
  if (options.matchSourceSize ?? metas.some((m) => m.version >= 41)) {
    ({ rpd, meta } = matchReplaySize(rpd, meta, references, options.sizeDonors?.()));
  }
  timelines.sort((a, b) => b.time - a.time);
  const bytes = zipSync({
    "replay.rpd": rpd,
    "meta.json": strToU8(JSON.stringify(meta)),
    "timelines.json": strToU8(JSON.stringify(timelines)),
  });
  return { bytes, meta, timelines };
}
