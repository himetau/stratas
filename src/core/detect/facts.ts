// World facts Run doesn't keep (piglins, aggro, gold, kills, explosions, eyes, buckets)
// Only what the replay records directly, no guessing intent
import type { ReplayEvent } from "../replay/decode";
import { Run } from "./run";

/** Ranked piglin states */
export const PIG = { ROAMING: 0, SEEKING: 1, ADMIRING: 2, ANGRY: 3, BARTERING: 4, AGGRO_LIGHT: 5, AGGRO_HEAVY: 6 } as const;

/** Piglins this close count as at the trading spot */
const NEAR = 16;
export const SAMPLE = 10;

export interface PigSample { t: number; barter: number; seek: number; angry: number; near: number; ground: number }
export interface AngerBurst { t: number; n: number; cause: string | null; causeT: number | null }
export interface PigSpan { id: number; state: number; t0: number; t1: number }
export interface Kill { t: number; entity: string }
export interface Eye { t0: number; t1: number; broke: boolean }
export interface BucketOp { t: number; op: "fill" | "empty"; fluid: "lava" | "water" }

export class Facts {
  /** Piglins around you every half second, Nether only */
  readonly pigs: PigSample[] = [];
  /** State stretches per piglin */
  readonly pigSpans: PigSpan[] = [];
  readonly anger: AngerBurst[] = [];
  /** Gold dropped at your feet with stack size */
  readonly goldThrown: { t: number; count: number }[] = [];
  readonly kills: Kill[] = [];
  /** Where it went off and whether you were within 16 blocks (so likely yours, lit TNT goes off a way off) */
  readonly explosions: { t: number; w: number; power: number; pos?: [number, number, number]; near: boolean }[] = [];
  readonly eyes: Eye[] = [];
  readonly buckets: BucketOp[] = [];
  /** Blocks you placed in an End portal frame */
  readonly framesFilled: number[] = [];
  readonly fireRes: number[] = [];
  /** Damage you took and from what. Null = no mob (fall, lava, fire) */
  readonly hurt: { t: number; by: string | null }[] = [];
  /** Your health in half hearts whenever it changed */
  readonly health: { t: number; hp: number }[] = [];

  constructor(readonly run: Run) {
    this.scan(run.events);
    this.scanBuckets();
    this.scanFrames();
  }

  /** Eyes that left the inventory without a throw went into the portal */
  private scanFrames() {
    const r = this.run;
    let prev = 0;
    for (let t = 0; t <= r.end; t += 2) {
      const n = r.invAt(t).get("ender_eye") ?? 0;
      const nearDeath = r.actions.some((a) => a.kind === "death" && Math.abs(a.t0 - t) <= 20);
      if (n < prev && !nearDeath && prev - n <= 4 && r.posAt(t).w === 0
        && !r.actions.some((a) => a.kind === "screen" || a.kind === "inventory" || a.kind === "craft" ? a.t0 <= t && a.t1 >= t : false)
        && !this.eyes.some((e) => Math.abs(e.t0 - t) <= 4)) for (let i = 0; i < prev - n; i++) this.framesFilled.push(t);
      prev = n;
    }
  }

  private scan(ev: ReplayEvent[]) {
    const r = this.run;
    const type = new Map<number, string>();
    const pos = new Map<number, [number, number, number]>();
    const state = new Map<number, { s: number; t: number }>();
    const lastHit = new Map<number, number>();
    const dead = new Set<number>();
    const items = new Map<number, { item: string; t: number; pos: [number, number, number] }>();
    let lastSwing = -100, sampleAt = 0;
    const closeSpan = (id: number, t: number) => {
      const s = state.get(id);
      if (s) this.pigSpans.push({ id, state: s.s, t0: s.t, t1: t });
    };
    const turnedAngry: { t: number; id: number }[] = [];
    // Gold you threw that's still on the ground
    const ground = new Map<number, number>();

    for (const e of ev) {
      while (e.t >= sampleAt) { this.sample(sampleAt, state, pos, ground); sampleAt += SAMPLE; }
      if ((e.type === "ITEM_PICKUP" || e.type === "ENTITY_REMOVE") && ground.has(e.id!)) ground.delete(e.id!);
      if (e.pos && e.id !== undefined) pos.set(e.id, e.pos as [number, number, number]);
      switch (e.type) {
        case "ENTITY_ADD": case "PROJECTILE": type.set(e.id!, e.entity!); if (e.entity === "eye_of_ender") this.eyes.push({ t0: e.t, t1: e.t, broke: true }); break;
        case "PIGLIN_STATE": {
          const s = state.get(e.id!);
          if (s && s.s === e.state) break; // Ranked resends the same state sometimes
          closeSpan(e.id!, e.t);
          if (e.state === PIG.ANGRY && (!s || s.s !== PIG.ANGRY)) turnedAngry.push({ t: e.t, id: e.id! });
          state.set(e.id!, { s: e.state!, t: e.t });
          break;
        }
        case "SWING": lastSwing = e.t; break;
        case "ENTITY_DAMAGE":
          if (e.id === -2) this.hurt.push({ t: e.t, by: e.attacker !== undefined && e.attacker >= 0 ? type.get(e.attacker) ?? null : null });
          else if (e.t - lastSwing <= 4 && e.t >= lastSwing) lastHit.set(e.id!, e.t);
          break;
        case "ENTITY_REMOVE": {
          const ty = type.get(e.id!);
          if (e.killed && ty && !dead.has(e.id!) && (lastHit.get(e.id!) ?? -1e9) >= e.t - 100) { this.kills.push({ t: e.t, entity: ty }); dead.add(e.id!); }
          if (ty === "eye_of_ender") {
            const eye = this.eyes.findLast((x) => x.t0 === x.t1);
            if (eye) eye.t1 = e.t;
          }
          if (state.has(e.id!)) { closeSpan(e.id!, e.t); state.delete(e.id!); }
          break;
        }
        case "ITEM_ENTITY": {
          if (items.has(e.id!)) break; // Same item coming back into view
          items.set(e.id!, { item: e.item!, t: e.t, pos: e.pos as [number, number, number] });
          if (e.item === "gold_ingot") {
            const p = r.posAt(e.t);
            if (p.w === e.world && Math.hypot(e.pos![0] - p.x, e.pos![1] - p.y, e.pos![2] - p.z) <= 3) { this.goldThrown.push({ t: e.t, count: e.count ?? 1 }); ground.set(e.id!, e.count ?? 1); }
          }
          // Eye that survives drops as an item where it was
          if (e.item === "ender_eye") { const eye = this.eyes.findLast((x) => x.t1 >= e.t - 5 && x.t1 <= e.t + 1); if (eye) eye.broke = false; }
          break;
        }
        case "STATS": if (e.health !== undefined && this.health.at(-1)?.hp !== e.health) this.health.push({ t: e.t, hp: e.health }); break;
        case "EXPLOSION": {
          const p = r.posAt(e.t), at = e.pos as [number, number, number] | undefined;
          this.explosions.push({ t: e.t, w: e.world!, power: e.power!, pos: at, near: !!at && p.w === e.world && Math.hypot(at[0] - p.x, at[1] - p.y, at[2] - p.z) <= 16 });
          break;
        }
        case "EFFECT": if (e.effect === "fire_resistance" && (e.duration ?? 0) > 0) this.fireRes.push(e.t); break;
      }
    }
    for (const id of state.keys()) closeSpan(id, r.end);
    this.pigSpans.sort((a, b) => a.t0 - b.t0);

    // Burst = 3+ piglins going angry within half a second
    turnedAngry.sort((a, b) => a.t - b.t);
    for (let i = 0; i < turnedAngry.length;) {
      let j = i;
      while (j + 1 < turnedAngry.length && turnedAngry[j + 1].t - turnedAngry[i].t <= 10) j++;
      const n = new Set(turnedAngry.slice(i, j + 1).map((x) => x.id)).size;
      if (n >= 3) this.anger.push({ t: turnedAngry[i].t, n, ...this.angerCause(turnedAngry[i].t) });
      i = j + 1;
    }
  }

  /** What you did right before piglins got angry (stuff that angers them in 1.16) */
  private angerCause(t: number): { cause: string | null; causeT: number | null } {
    const r = this.run;
    const near = r.actions.filter((a) => a.t1 >= t - 30 && a.t1 <= t + 2);
    const mined = near.filter((a) => a.kind === "mine").at(-1);
    if (mined) {
      const what = mined.item === "gold_block" ? "mining a gold block" : mined.item === "gold_nugget" ? "mining gold ore" : mined.item === "gilded_blackstone" ? "mining gilded blackstone" : null;
      if (what) return { cause: what, causeT: mined.t1 };
    }
    const chest = r.actions.filter((a) => a.kind === "chest" && a.t0 >= t - 30 && a.t0 <= t + 2).at(-1);
    if (chest) return { cause: "opening a chest", causeT: chest.t0 };
    const hit = near.filter((a) => a.kind === "hit" && /piglin/.test(a.what ?? "")).at(-1);
    if (hit) return { cause: "hitting a piglin", causeT: hit.t0 };
    return { cause: null, causeT: null };
  }

  private sample(t: number, state: Map<number, { s: number; t: number }>, pos: Map<number, [number, number, number]>, ground: Map<number, number>) {
    const me = this.run.posAt(t);
    if (me.w !== 1) return;
    let barter = 0, seek = 0, angry = 0, near = 0;
    for (const [id, s] of state) {
      const p = pos.get(id);
      if (!p || Math.hypot(p[0] - me.x, p[2] - me.z) > NEAR) continue;
      near++;
      if (s.s === PIG.BARTERING || s.s === PIG.ADMIRING) barter++;
      else if (s.s === PIG.SEEKING) seek++;
      else if (s.s === PIG.ANGRY) angry++;
    }
    this.pigs.push({ t, barter, seek, angry, near, ground: [...ground.values()].reduce((a, c) => a + c, 0) });
  }

  /** Bucket fills and empties from the inventory */
  private scanBuckets() {
    const r = this.run;
    let prev = { b: 0, l: 0, w: 0 };
    for (let t = 0; t <= r.end; t += 5) {
      const c = r.invAt(t);
      const now = { b: c.get("bucket") ?? 0, l: c.get("lava_bucket") ?? 0, w: c.get("water_bucket") ?? 0 };
      if (now.l > prev.l) this.buckets.push({ t, op: "fill", fluid: "lava" });
      if (now.w > prev.w && now.l >= prev.l) this.buckets.push({ t, op: "fill", fluid: "water" });
      if (now.l < prev.l && now.b > prev.b) this.buckets.push({ t, op: "empty", fluid: "lava" });
      if (now.w < prev.w && now.b > prev.b) this.buckets.push({ t, op: "empty", fluid: "water" });
      prev = now;
    }
  }

  // ---- queries

  samples(t0: number, t1: number) { return this.pigs.filter((s) => s.t >= t0 && s.t < t1); }
  gold(t0: number, t1: number) { return this.goldThrown.filter((g) => g.t >= t0 && g.t < t1).reduce((s, g) => s + g.count, 0); }
}
