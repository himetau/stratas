// Decoder for MCSR Ranked replays (.rrf), meta version 40+ (mod 6.0.1+), record format 3
// .rrf = zip { meta.json, timelines.json, replay.rpd }
// replay.rpd = repeated [u32 BE length][zstd frame], decompressed chunk = [16 byte player UUID][0x83 marker][records...]
// record = [u8 type][u8 tickDelta or 0xFF + i32 absolute tick][payload]. Payloads have no length so every layout has to be known
// Layouts are from the mod's com.mcsrranked.client.anticheat.replay.format.* classes (TimeLineType ids, *Factory.getFromBytes)
// Positions are in 1/4096 block units per entity key. Absolute records set them, *_DELTA adds i16, *_SMALL_DELTA adds i8 * 16
import { unzipSync, strFromU8 } from "fflate";
import { zstdDecompressSync } from "node:zlib";
import { blockName, effectName, entityName, itemName, menuName } from "./registries";
import PIE_NAMES from "../../../data/pie-names.json";

export const FORMAT_MARKER = 0x83;
export const MIN_VERSION = 40;
const SCALE = 4096;
const PLAYER_KEY = -2147483647;

export type Vec3 = [number, number, number];

export interface ReplayMeta {
  version: number;
  matchId: number;
  date: number;
  matchType: number;
  overworldSeed: string;
  netherSeed: string;
  theEndSeed: string;
  symmetricKey: string | null;
  result: { uuid: string | null; time: number };
  players: { uuid: string; nickname: string; eloRate?: number | null; [k: string]: unknown }[];
  [k: string]: unknown;
}

export interface TimelineEntry { uuid: string; type: string; time: number; data?: number[] }

export type EventType =
  | "EMPTY" | "PLAYER_SPAWN" | "PLAYER_POSITION" | "PLAYER_LOOK" | "PLAYER_POS" | "POSE" | "RIDE" | "PAUSE"
  | "PLAYER_REMOVE" | "PERSPECTIVE" | "STATS" | "USE" | "EFFECT" | "HELD_SLOT" | "PLAYER_POSITION_DELTA"
  | "PLAYER_POS_DELTA" | "CONTAINER" | "PORTAL" | "SWING" | "RENDER_DISTANCE" | "ATTACK_RESET" | "PIE_CHART"
  | "BLOCK_UPDATE" | "BLOCK_BREAK" | "BLOCK_REMOVE" | "BLOCK_PROGRESS" | "CHEST_ANIMATION"
  | "ENTITY_ADD" | "ENTITY_MOVE" | "ENTITY_LOOK" | "ENTITY_POS" | "ENTITY_DAMAGE" | "ENTITY_REMOVE"
  | "PIGLIN_STATE" | "MOB_STATE" | "ITEM_ENTITY" | "ITEM_PICKUP" | "PROJECTILE" | "INVENTORY_SLOT"
  | "DRAGON_MOVE" | "DRAGON_PHASE" | "DRAGON_HEALTH" | "CRYSTAL_DESTROY" | "DRAGON_DEATH" | "DRAGON_DEATH_PROGRESS"
  | "DRAGON_NODES" | "DRAGON_ZERO" | "DRAGON_DAMAGE" | "DRAGON_TARGET" | "DRAGON_PATH"
  | "EXPLOSION" | "AREA_EFFECT_CLOUD" | "WORLD_TIME" | "PIGLIN_BARTER";

/** One decoded record, only the fields for its type are set */
export interface ReplayEvent {
  t: number;
  type: EventType;
  world?: number;
  pos?: Vec3;
  yaw?: number;
  pitch?: number;
  at?: Vec3;
  id?: number;
  entity?: string;
  item?: string;
  count?: number;
  slot?: number;
  durability?: number;
  enchantments?: number[];
  container?: string;
  slots?: number;
  positions?: Vec3[];
  block?: string;
  blockEvent?: number;
  progress?: number;
  open?: boolean;
  collector?: number;
  attacker?: number;
  killed?: boolean;
  state?: number;
  items?: [string, number][];
  health?: number;
  absorption?: number;
  food?: number;
  air?: number;
  hand?: number;
  finished?: boolean;
  effect?: string;
  amplifier?: number;
  duration?: number;
  paused?: boolean;
  inPortal?: boolean;
  pose?: number;
  vehicle?: number;
  perspective?: number;
  renderDistance?: number;
  pie?: [string, number, number][];
  vel?: Vec3;
  power?: number;
  worldTime?: bigint;
  value?: number;
}

export interface RawChunk { uuid: string; firstTick: number; body: Uint8Array }

export interface Replay {
  meta: ReplayMeta;
  timelines: TimelineEntry[];
  /** Decoded events per player UUID (no dashes), in recording order */
  events: Map<string, ReplayEvent[]>;
  chunks: RawChunk[];
}

export class ReplayError extends Error {}

const NAMES: Record<number, EventType> = {
  0: "EMPTY", 1: "PLAYER_SPAWN", 2: "PLAYER_POSITION", 3: "PLAYER_LOOK", 4: "PLAYER_POS", 5: "POSE", 6: "RIDE",
  7: "PAUSE", 8: "PLAYER_REMOVE", 9: "PERSPECTIVE", 10: "STATS", 11: "USE", 12: "EFFECT", 13: "HELD_SLOT",
  14: "PLAYER_POSITION_DELTA", 15: "PLAYER_POS_DELTA", 16: "CONTAINER", 17: "PORTAL", 18: "SWING",
  19: "RENDER_DISTANCE", 20: "ATTACK_RESET", 21: "PIE_CHART", 25: "BLOCK_UPDATE", 26: "BLOCK_BREAK",
  27: "BLOCK_REMOVE", 28: "BLOCK_PROGRESS", 29: "CHEST_ANIMATION", 30: "BLOCK_UPDATE", 31: "BLOCK_BREAK",
  32: "BLOCK_REMOVE", 33: "BLOCK_PROGRESS", 40: "ENTITY_ADD", 41: "ENTITY_MOVE", 42: "ENTITY_LOOK",
  43: "ENTITY_POS", 44: "ENTITY_MOVE", 45: "ENTITY_POS", 46: "ENTITY_DAMAGE", 47: "ENTITY_REMOVE",
  48: "ENTITY_MOVE", 49: "ENTITY_POS", 50: "PIGLIN_STATE", 51: "MOB_STATE", 61: "ITEM_ENTITY", 62: "ITEM_PICKUP",
  63: "PROJECTILE", 64: "INVENTORY_SLOT", 80: "DRAGON_MOVE", 81: "DRAGON_MOVE", 82: "DRAGON_PHASE",
  83: "DRAGON_HEALTH", 84: "CRYSTAL_DESTROY", 85: "DRAGON_DEATH", 86: "DRAGON_DEATH_PROGRESS",
  87: "DRAGON_NODES", 88: "DRAGON_ZERO", 89: "DRAGON_DAMAGE", 90: "DRAGON_TARGET", 91: "DRAGON_PATH",
  100: "EXPLOSION", 101: "AREA_EFFECT_CLOUD", 102: "WORLD_TIME", 103: "PIGLIN_BARTER",
};

class Reader {
  i = 0;
  private v: DataView;
  constructor(readonly b: Uint8Array) { this.v = new DataView(b.buffer, b.byteOffset, b.byteLength); }
  left() { return this.b.length - this.i; }
  need(n: number) { if (this.i + n > this.b.length) throw new ReplayError("record runs past the end of its chunk"); }
  u8() { this.need(1); return this.b[this.i++]; }
  i8() { this.need(1); return this.v.getInt8(this.i++); }
  u16() { this.need(2); const x = this.v.getUint16(this.i); this.i += 2; return x; }
  i16() { this.need(2); const x = this.v.getInt16(this.i); this.i += 2; return x; }
  i32() { this.need(4); const x = this.v.getInt32(this.i); this.i += 4; return x; }
  i64() { this.need(8); const x = this.v.getBigInt64(this.i); this.i += 8; return x; }
  f32() { this.need(4); const x = this.v.getFloat32(this.i); this.i += 4; return x; }
  f64() { this.need(8); const x = this.v.getFloat64(this.i); this.i += 8; return x; }
  xyz(): Vec3 { return [this.f32(), this.f32(), this.f32()]; }
  skip(n: number) { this.need(n); this.i += n; }
  bytes(n: number) { this.need(n); const x = this.b.subarray(this.i, this.i + n); this.i += n; return x; }
}

/** BlockPos.asLong (1.16), x 26 bits << 38 | z 26 bits << 12 | y 12 bits */
export function unpackBlockPos(v: bigint): Vec3 {
  const x = Number(v >> 38n);
  const y = Number(BigInt.asIntN(64, v << 52n) >> 52n);
  const z = Number(BigInt.asIntN(64, v << 26n) >> 38n);
  return [x, y, z];
}

/** Rotations are in hundredths of a degree */
const angle = (s: number) => ((((s * 0.01 + 180) % 360) + 360) % 360) - 180;

/** Per-player decoder state: positions per entity key, last block pos, tick */
class State {
  pos = new Map<number, [number, number, number, number]>(); // world, qx, qy, qz
  block: Vec3 = [0, 0, 0];
  blockWorld = 0;
  tick = 0;
  store(key: number, w: number, p: Vec3) {
    this.pos.set(key, [w, Math.round(p[0] * SCALE), Math.round(p[1] * SCALE), Math.round(p[2] * SCALE)]);
  }
  delta(key: number, w: number | null, d: Vec3, mul = 1): [number, Vec3] {
    let q = this.pos.get(key);
    if (!q) { q = [w ?? 0, 0, 0, 0]; this.pos.set(key, q); }
    if (w !== null) q[0] = w;
    q[1] += d[0] * mul; q[2] += d[1] * mul; q[3] += d[2] * mul;
    return [q[0], [q[1] / SCALE, q[2] / SCALE, q[3] / SCALE]];
  }
  world(key: number) { return this.pos.get(key)?.[0] ?? 0; }
}

function pieName(r: Reader): string {
  let v = r.u8();
  if (v >= 128) v = ((v & 127) << 8) | r.u8();
  if (v) return PIE_NAMES[v - 1] ?? `#${v}`;
  return new TextDecoder().decode(r.bytes(r.u8()));
}

function record(t: number, r: Reader, st: State, e: ReplayEvent) {
  switch (t) {
    case 1: case 2: {
      const w = r.u8(), p = r.xyz();
      e.world = w; e.pos = p; e.yaw = angle(r.i16()); e.pitch = angle(r.i16()); st.store(PLAYER_KEY, w, p); return;
    }
    case 3: e.world = r.u8(); e.yaw = angle(r.i16()); e.pitch = angle(r.i16()); return;
    case 4: { const w = r.u8(), p = r.xyz(); e.world = w; e.pos = p; st.store(PLAYER_KEY, w, p); return; }
    case 14: {
      const d: Vec3 = [r.i16(), r.i16(), r.i16()]; const yaw = r.i16(), pitch = r.i16();
      [e.world, e.pos] = st.delta(PLAYER_KEY, null, d); e.yaw = angle(yaw); e.pitch = angle(pitch); return;
    }
    case 15: [e.world, e.pos] = st.delta(PLAYER_KEY, null, [r.i16(), r.i16(), r.i16()]); return;
    case 5: e.pose = r.u8(); return;
    case 6: e.vehicle = r.i32(); return;
    case 7: e.paused = r.u8() !== 0; return;
    case 8: e.world = r.u8(); e.killed = r.u8() === 1; return;
    case 9: e.perspective = r.u8(); return;
    case 10: e.health = r.i8(); e.absorption = r.i8(); e.food = r.i8(); e.air = r.i8(); return;
    case 11: { const s = r.u8(); e.hand = s & 3; e.finished = (s & 4) !== 0; return; }
    case 12: e.effect = effectName(r.u8()); e.amplifier = r.u8(); e.duration = r.u16(); return;
    case 13: e.slot = r.u8(); return;
    case 16: {
      const type = r.u8(), slots = r.u8(), f = r.u8();
      e.container = type === 255 ? "closed" : type === 254 ? "inventory" : menuName(type);
      e.slots = slots; e.world = f >> 2;
      e.positions = Array.from({ length: f & 3 }, () => unpackBlockPos(r.i64()));
      return;
    }
    case 17: e.inPortal = r.u8() !== 0; return;
    case 18: e.hand = r.u8(); return;
    case 19: e.renderDistance = r.u8(); return;
    case 20: return;
    case 21: {
      const rows: [string, number, number][] = [];
      const n = r.u8();
      for (let i = 0; i < n; i++) {
        let name: string;
        if (i === 0) { const k = r.u8(); const parts = []; for (let j = 0; j < k; j++) parts.push(pieName(r)); name = parts.join("\u001e"); }
        else name = pieName(r);
        rows.push([name, r.u8(), r.u8()]);
      }
      e.pie = rows; return;
    }
    case 25: case 26: case 27: case 28: case 29: {
      const w = r.u8(), p = unpackBlockPos(r.i64());
      st.block = [...p] as Vec3; st.blockWorld = w; e.world = w; e.at = p;
      if (t === 25) { e.block = blockName(r.i32()); e.blockEvent = r.u8(); }
      else if (t === 28) e.progress = r.i8();
      else if (t === 29) e.open = r.u8() !== 0;
      return;
    }
    case 30: case 31: case 32: case 33: {
      st.block[0] += r.i8(); st.block[1] += r.i8(); st.block[2] += r.i8();
      e.world = st.blockWorld; e.at = [...st.block] as Vec3;
      if (t === 30) { e.block = blockName(r.u16()); e.blockEvent = r.u8(); }
      else if (t === 33) e.progress = r.i8();
      return;
    }
    case 40: {
      const w = r.u8(), p = r.xyz(); r.i16(); r.i16();
      const id = r.i32(), type = r.i32(); r.i32();
      st.store(id, w, p); e.world = w; e.pos = p; e.id = id; e.entity = entityName(type); return;
    }
    case 41: { const w = r.u8(), p = r.xyz(); r.i16(); r.i16(); const id = r.i32(); st.store(id, w, p); e.world = w; e.pos = p; e.id = id; return; }
    case 42: e.world = r.u8(); r.i16(); r.i16(); e.id = r.i32(); return;
    case 43: { const w = r.u8(), p = r.xyz(), id = r.i32(); st.store(id, w, p); e.world = w; e.pos = p; e.id = id; return; }
    case 44: {
      const w = r.u8(); const d: Vec3 = [r.i16(), r.i16(), r.i16()]; r.i16(); r.i16(); const id = r.i32();
      [e.world, e.pos] = st.delta(id, w, d); e.id = id; return;
    }
    case 45: {
      const w = r.u8(); const d: Vec3 = [r.i16(), r.i16(), r.i16()]; const id = r.i32();
      [e.world, e.pos] = st.delta(id, w, d); e.id = id; return;
    }
    case 48: {
      const d: Vec3 = [r.i8(), r.i8(), r.i8()]; r.i8(); r.i8(); const id = r.i32();
      [e.world, e.pos] = st.delta(id, st.world(id), d, 16); e.id = id; return;
    }
    case 49: {
      const d: Vec3 = [r.i8(), r.i8(), r.i8()]; const id = r.i32();
      [e.world, e.pos] = st.delta(id, st.world(id), d, 16); e.id = id; return;
    }
    case 46: e.world = r.u8(); e.id = r.i32(); e.attacker = r.i32(); return;
    case 47: e.world = r.u8(); e.id = r.i32(); e.killed = r.u8() === 1; return;
    case 50: e.world = r.u8(); e.id = r.i32(); e.state = r.u8(); r.u8(); r.i16(); r.i16(); return;
    case 51: e.world = r.u8(); e.id = r.i32(); e.state = r.i32(); return;
    case 61: {
      const w = r.u8(), p = r.xyz(), id = r.i32(), item = r.u16(), count = r.u8(); r.u8();
      st.store(id, w, p); e.world = w; e.pos = p; e.id = id; e.item = itemName(item); e.count = count; return;
    }
    case 62: e.world = r.u8(); e.id = r.i32(); e.collector = r.i32(); e.count = r.u8(); return;
    case 63: {
      const w = r.u8(), p = r.xyz(); r.i16(); r.i16(); const id = r.i32();
      const vel: Vec3 = [r.f64(), r.f64(), r.f64()]; const type = r.i32(); r.u8();
      st.store(id, w, p); e.world = w; e.pos = p; e.id = id; e.vel = vel; e.entity = entityName(type & 0xffff); return;
    }
    case 64: {
      const slot = r.u8(), item = r.u16(), count = r.u8(), dur = r.u8(); r.u8(); const f = r.u8();
      const ench: number[] = []; for (let i = 0; i < (f & 63); i++) ench.push(r.u16());
      e.slot = slot; e.item = count ? itemName(item) : "air"; e.count = count; e.durability = dur; e.enchantments = ench; return;
    }
    case 80: e.pos = r.xyz(); r.i16(); r.i16(); return;
    case 81: r.skip(10); return;
    case 82: case 83: case 84: case 85: e.value = r.u8(); return;
    case 86: r.skip(3); return;
    case 87: r.skip(8 * r.u8()); return;
    case 88: if (r.u8() !== 1) r.skip(18); return;
    case 89: r.skip(3); return;
    case 90: if (r.u8() !== 0) r.skip(12); return;
    case 91: { r.u8(); const n = r.u8(); for (let i = 0; i < n; i++) if (r.u8() === 255) r.skip(8); return; }
    case 100: e.world = r.u8(); e.pos = r.xyz(); e.power = r.f32(); return;
    case 101: r.skip(27); return;
    case 102: e.worldTime = r.i64(); return;
    case 103: {
      e.world = r.u8(); e.id = r.i32();
      const n = r.u8(); e.items = []; for (let i = 0; i < n; i++) e.items.push([itemName(r.u16()), r.u8()]);
      return;
    }
    case 0: r.u8(); return;
    default: throw new ReplayError(`unknown record type ${t}`);
  }
}

export const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** Splits replay.rpd into compressed chunks, only reads the length header */
export function splitChunks(rpd: Uint8Array): RawChunk[] {
  const v = new DataView(rpd.buffer, rpd.byteOffset, rpd.byteLength);
  const out: RawChunk[] = [];
  let i = 0;
  while (i < rpd.length) {
    if (i + 4 > rpd.length) throw new ReplayError("truncated chunk header");
    const n = v.getUint32(i);
    const body = rpd.subarray(i + 4, i + 4 + n);
    if (body.length !== n) throw new ReplayError("truncated chunk");
    const head = zstdDecompressSync(body).subarray(0, 23);
    const firstTick = head[18] === 0xff ? new DataView(head.buffer, head.byteOffset).getInt32(19) : 0;
    out.push({ uuid: hex(head.subarray(0, 16)), firstTick, body });
    i += 4 + n;
  }
  return out;
}

export interface RrfFiles { meta: ReplayMeta; timelines: TimelineEntry[]; rpd: Uint8Array }

export function readRrf(bytes: Uint8Array): RrfFiles {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes); } catch { throw new ReplayError("not a replay file (bad zip)"); }
  for (const f of ["meta.json", "timelines.json", "replay.rpd"]) if (!files[f]) throw new ReplayError(`replay is missing ${f}`);
  return {
    meta: JSON.parse(strFromU8(files["meta.json"])),
    timelines: JSON.parse(strFromU8(files["timelines.json"])),
    rpd: files["replay.rpd"],
  };
}

export function checkReadable(meta: ReplayMeta) {
  if (meta.symmetricKey) throw new ReplayError("encrypted replay (made before MCSR Ranked 6.0.1)");
  if ((meta.version ?? 0) < MIN_VERSION) throw new ReplayError(`replay version ${meta.version} is older than ${MIN_VERSION}`);
}

export function decodeRrf(bytes: Uint8Array, opts: { only?: Set<string> } = {}): Replay {
  const { meta, timelines, rpd } = readRrf(bytes);
  checkReadable(meta);
  const chunks = splitChunks(rpd);
  const states = new Map<string, State>();
  const events = new Map<string, ReplayEvent[]>();
  for (const c of chunks) {
    if (opts.only && !opts.only.has(c.uuid)) continue;
    const r = new Reader(zstdDecompressSync(c.body));
    r.skip(16);
    const fmt = r.u8();
    if (fmt !== FORMAT_MARKER) throw new ReplayError(`unknown record format 0x${fmt.toString(16)}`);
    let st = states.get(c.uuid);
    if (!st) { st = new State(); states.set(c.uuid, st); events.set(c.uuid, []); }
    const out = events.get(c.uuid)!;
    while (r.left()) {
      const type = r.u8(), d = r.u8();
      st.tick = d === 255 ? r.i32() : st.tick + d;
      const name = NAMES[type];
      if (!name) throw new ReplayError(`unknown record type ${type}`);
      const e: ReplayEvent = { t: st.tick, type: name };
      record(type, r, st, e);
      out.push(e);
    }
  }
  return { meta, timelines, events, chunks };
}
