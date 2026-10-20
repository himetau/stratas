// One runner's replay rebuilt as a track, inventory history and actions
import type { ReplayEvent, TimelineEntry, Vec3 } from "../replay/decode";
import { DEATH_TYPES } from "./names";
import { isBlock } from "../replay/registries";

export interface TrackPoint { t: number; w: number; x: number; y: number; z: number }

export type ActionKind =
  | "craft" | "inventory" | "chest" | "furnace" | "villager" | "screen"
  | "mine" | "mine_abandoned" | "pickup" | "barter" | "pearl" | "eye" | "death" | "portal" | "damage" | "eat" | "place" | "hit" | "pie";

/** Route point, Ranked splits plus "left the bastion" which Ranked doesn't record */
export interface Mark { key: MarkKey; label: string; t: number }
export type MarkKey = "nether" | "bastion" | "bastion_left" | "fortress" | "blind" | "eye" | "end" | "finish";
const MARK_SPLITS: [string, MarkKey, string][] = [
  ["story.enter_the_nether", "nether", "Entered the Nether"],
  ["nether.find_bastion", "bastion", "Entered Bastion"],
  ["nether.find_fortress", "fortress", "Entered Fortress"],
  ["projectelo.timeline.blind_travel", "blind", "Blind Travelled"],
  ["story.follow_ender_eye", "eye", "Eye Spy"],
  ["story.enter_the_end", "end", "Entered the End"],
  ["projectelo.timeline.dragon_death", "finish", "Defeated the Dragon"],
];
/** How far from the bastion middle still counts as in it */
const BASTION_RADIUS = 40;
/** Close enough to a chest, gold or trade spot to still be working there */
const WORK_RADIUS = 10;

export interface Action {
  kind: ActionKind;
  t0: number;
  t1: number;
  w: number;
  at?: Vec3;
  /** Inventory change while a screen was open, or barter result */
  delta?: Record<string, number>;
  item?: string;
  count?: number;
  to?: number;
  amount?: number;
  /** Placed block, hit mob, or pie chart section being looked at */
  what?: string;
  /** Entity involved, like which piglin a barter came from */
  id?: number;
  /** When a picked up item dropped */
  dropped?: number;
}

const CONTAINER_KIND: Record<string, ActionKind> = {
  crafting: "craft", inventory: "inventory", furnace: "furnace", blast_furnace: "furnace", smoker: "furnace",
  merchant: "villager", generic_9x1: "chest", generic_9x2: "chest", generic_9x3: "chest", generic_9x4: "chest",
  generic_9x5: "chest", generic_9x6: "chest", generic_3x3: "chest", shulker_box: "chest", hopper: "chest",
};

type Counts = Map<string, number>;

export class Run {
  readonly track: TrackPoint[] = [];
  private readonly trackT: number[] = [];
  readonly looks: { t: number; yaw: number; pitch: number }[] = [];
  readonly splits = new Map<string, number>();
  readonly splitList: { type: string; t: number }[] = [];
  readonly actions: Action[] = [];
  readonly pauses: [number, number][] = [];
  private inv: { t: number; c: Counts }[] = [];
  private invT: number[] = [];
  readonly end: number;
  /** Paused for good before the replay ended, so they left the match */
  readonly quit: boolean = false;
  readonly finished: boolean;
  readonly marks: Mark[] = [];

  constructor(readonly uuid: string, readonly name: string, readonly events: ReplayEvent[], timelines: TimelineEntry[]) {
    for (const e of events) {
      if (e.pos && (e.type === "PLAYER_POSITION" || e.type === "PLAYER_POSITION_DELTA" || e.type === "PLAYER_POS" ||
        e.type === "PLAYER_POS_DELTA" || e.type === "PLAYER_SPAWN")) {
        this.track.push({ t: e.t, w: e.world ?? 0, x: e.pos[0], y: e.pos[1], z: e.pos[2] });
        this.trackT.push(e.t);
      }
      if (e.yaw !== undefined && e.type.startsWith("PLAYER")) this.looks.push({ t: e.t, yaw: e.yaw, pitch: e.pitch ?? 0 });
    }
    const tl = timelines.filter((e) => e.uuid === uuid).sort((a, b) => a.time - b.time);
    for (const e of tl) {
      const t = Math.round(e.time / 50);
      if (!this.splits.has(e.type)) this.splits.set(e.type, t);
      this.splitList.push({ type: e.type, t });
    }
    this.end = Math.max(this.track.at(-1)?.t ?? 0, tl.at(-1) ? Math.round(tl.at(-1)!.time / 50) : 0);
    this.finished = this.splits.has("projectelo.timeline.dragon_death");
    this.buildInventory();
    this.buildActions(tl);
    // Paused until the replay ended, they stopped playing here
    const last = this.pauses.at(-1);
    if (!this.finished && last && last[1] >= this.end - 20 && last[1] - last[0] >= 600) {
      this.end = last[0];
      this.quit = true;
      this.pauses.pop();
    }
    this.actions.sort((a, b) => a.t0 - b.t0);
    this.buildMarks();
  }

  mark(key: MarkKey): number | undefined { return this.marks.find((m) => m.key === key)?.t; }

  private buildMarks() {
    for (const [type, key, label] of MARK_SPLITS) {
      const t = this.splits.get(type);
      if (t !== undefined) this.marks.push({ key, label, t });
    }
    const fb = this.mark("bastion");
    // Leaving the bastion is worked out from positions, a run built from Ranked's API splits alone has none
    if (fb !== undefined && this.track.length) {
      // Bastion ends when you leave for good, last time you were near where you looted, mined gold and traded
      // before the next structure or blind
      const next = Math.min(...this.marks.filter((m) => m.t > fb && ["fortress", "blind", "end", "finish"].includes(m.key)).map((m) => m.t), this.end);
      const w = this.posAt(fb + 1).w;
      const spots = this.actions.filter((a) => a.t0 >= fb && a.t0 < next && ["chest", "barter", "mine"].includes(a.kind)).map((a) => this.posAt(a.t0)).filter((p) => p.w === w);
      const med = (xs: number[]) => xs.sort((a, b) => a - b)[xs.length >> 1];
      const c = spots.length >= 3 ? { x: med(spots.map((p) => p.x)), z: med(spots.map((p) => p.z)) } : this.posAt(fb + 20);
      // You've left once you're away (other dim or past the radius) for 15 s straight, or you die. Except you
      // haven't left while you still come back to trade or loot: big bastions put piglins and gold past the radius,
      // and a death you run back from to keep trading doesn't end it either
      const near = (a: Action) => a.w === w && (() => { const p = this.posAt(a.t0); return Math.hypot(p.x - c.x, p.z - c.z) <= BASTION_RADIUS * 2; })();
      const lastWork = this.actions.filter((a) => (a.kind === "barter" || a.kind === "chest") && a.t0 > fb && a.t0 < next && near(a)).at(-1)?.t0 ?? fb;
      const rawDeath = this.actions.find((a) => a.kind === "death" && a.t0 > fb && a.t0 < next)?.t0 ?? Infinity;
      const death = rawDeath < lastWork ? Infinity : rawDeath;
      let left = fb, awaySince: number | null = null;
      // Ranked only records position when you move, so standing at the trade spot leaves a gap. You were there till the next record
      let wasInside = false;
      for (const p of this.slice(fb, Math.min(next, death) - 1)) {
        const inside = p.w === w && Math.hypot(p.x - c.x, p.z - c.z) <= BASTION_RADIUS;
        if (inside) { left = p.t; awaySince = null; }
        else {
          if (wasInside) left = Math.max(left, p.t - 1);
          if (p.t < lastWork) continue;
          if (awaySince === null) awaySince = p.t;
          else if (p.t - awaySince >= 300) break;
        }
        wasInside = inside;
      }
      if (death < next && death - left < 300) left = Math.min(left, death);
      // Leaving starts when you stop working in the bastion (last time near a chest, gold or trade spot)
      // Walking or pearling out after that is travel, so both count the same
      const workSpots = this.actions.filter((a) => a.t0 >= fb && a.t0 <= left && ["chest", "barter", "mine", "craft"].includes(a.kind)).map((a) => this.posAt(a.t0)).filter((p) => p.w === w);
      if (workSpots.length) {
        let lastNear = fb;
        for (const p of this.slice(fb, left)) if (p.w === w && workSpots.some((q) => Math.hypot(p.x - q.x, p.z - q.z) <= WORK_RADIUS)) lastNear = p.t;
        // Standing still leaves no records so you were there till the next one, unless you pearled out in between
        // (no records during the flight either)
        const after = this.slice(lastNear + 1, left)[0];
        const pearl = this.actions.find((a) => a.kind === "pearl" && a.t0 >= lastNear && a.t0 <= (after?.t ?? left));
        left = Math.min(left, pearl ? pearl.t0 : after ? Math.max(lastNear, after.t - 1) : left);
        // Pearl out counts from the throw, unless you stayed for more pearl trades while a hang pearl waited
        const out = this.actions.find((a) => a.kind === "pearl" && a.t0 < left && a.t1 >= left - 40 && a.t1 <= left + 60 && left - a.t0 <= 200
          && !this.actions.some((x) => x.kind === "pickup" && x.item === "ender_pearl" && x.t0 > a.t0 + 40 && x.t0 <= left));
        if (out) left = out.t0;
      }
      this.marks.push({ key: "bastion_left", label: "Left the Bastion", t: Math.max(left, fb + 1) });
    }
    this.marks.sort((a, b) => a.t - b.t);
  }

  // ---- queries

  /** When you picked up n rods total. Counts pickups since rods get crafted away, and moving rods between
   *  slots or through the crafting grid makes inventory counts go up without any new rods */
  rodsAt(n: number): number | null {
    let got = 0;
    for (const a of this.actions) {
      if (a.kind !== "pickup" || a.item !== "blaze_rod") continue;
      got += a.count ?? 1;
      if (got >= n) return a.t0;
    }
    return null;
  }

  /** Each rod you picked up, when it dropped and when you got it, one entry per rod */
  rodTimes(): { dropped: number; got: number }[] {
    return this.actions.flatMap((a) => (a.kind === "pickup" && a.item === "blaze_rod" ? Array.from({ length: a.count ?? 1 }, () => ({ dropped: a.dropped ?? a.t0, got: a.t0 })) : []));
  }

  /** Rods picked up in [t0, t1] */
  rodsIn(t0: number, t1: number): number {
    return this.actions.reduce((n, a) => n + (a.kind === "pickup" && a.item === "blaze_rod" && a.t0 >= t0 && a.t0 <= t1 ? a.count ?? 1 : 0), 0);
  }

  posAt(t: number): TrackPoint {
    const tr = this.track;
    if (!tr.length) return { t, w: 0, x: 0, y: 0, z: 0 };
    let lo = 0, hi = tr.length - 1;
    if (t <= tr[0].t) return tr[0];
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.trackT[m] <= t) lo = m; else hi = m - 1; }
    return tr[lo];
  }

  /** Track points within [t0, t1] */
  slice(t0: number, t1: number): TrackPoint[] {
    const a = lowerBound(this.trackT, t0), b = lowerBound(this.trackT, t1 + 1);
    return this.track.slice(a, b);
  }

  /** Horizontal distance in [t0, t1], same dimension steps only */
  path(t0: number, t1: number): number {
    const pts = this.slice(t0, t1);
    let d = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (a.w === b.w) d += Math.hypot(b.x - a.x, b.z - a.z);
    }
    return d;
  }

  invAt(t: number): Counts {
    const i = lowerBound(this.invT, t + 1) - 1;
    return i >= 0 ? this.inv[i].c : new Map();
  }

  /** First tick in [from, to] you had at least n of an item */
  firstReach(item: string, n: number, from: number, to: number): number | null {
    if ((this.invAt(from).get(item) ?? 0) >= n) return from;
    for (let i = lowerBound(this.invT, from); i < this.inv.length && this.inv[i].t <= to; i++) if ((this.inv[i].c.get(item) ?? 0) >= n) return this.inv[i].t;
    return null;
  }

  invDelta(t0: number, t1: number): Record<string, number> {
    const a = this.invAt(t0 - 1), b = this.invAt(t1 + 1), out: Record<string, number> = {};
    for (const k of new Set([...a.keys(), ...b.keys()])) {
      const d = (b.get(k) ?? 0) - (a.get(k) ?? 0);
      if (d) out[k] = d;
    }
    return out;
  }

  /** Phase that starts at a mark */
  phaseAfter(i: number): string {
    const m = this.marks[i];
    if (!m) return "Overworld";
    const next = this.marks[i + 1]?.key;
    switch (m.key) {
      case "nether": return "Nether travel";
      case "bastion": return "Bastion";
      case "bastion_left": return next === "fortress" ? "Bastion to fortress" : next === "blind" ? "Bastion to blind" : "After the bastion";
      // Rod count when blinding is a choice (fewer rods, more time later) so fortress and the way to the stronghold
      // are one stretch. Inside the stronghold is its own
      case "fortress": return next === "bastion" ? "Fortress" : "Fortress to stronghold";
      case "eye": return "Stronghold";
      case "blind": return this.marks.some((x) => x.key === "fortress" && x.t < m.t && !this.marks.some((y) => y.key === "bastion" && y.t > x.t && y.t < m.t)) ? "Fortress to stronghold" : "Stronghold";
      case "end": return "End";
      default: return "Finished";
    }
  }

  phaseAt(t: number): string {
    let i = -1;
    for (let k = 0; k < this.marks.length; k++) if (this.marks[k].t <= t) i = k;
    return i < 0 ? "Overworld" : this.phaseAfter(i);
  }

  // ---- building

  private buildInventory() {
    const slots = new Map<number, [string, number]>();
    for (const e of this.events) {
      // 0-8 hotbar, 9-35 main, 36-39 armour, 40 offhand. Higher slots are the open container
      if (e.type !== "INVENTORY_SLOT" || e.slot! > 40) continue;
      slots.set(e.slot!, [e.item!, e.count!]);
      const c: Counts = new Map();
      for (const [it, n] of slots.values()) if (it !== "air") c.set(it, (c.get(it) ?? 0) + n);
      this.inv.push({ t: e.t, c });
      this.invT.push(e.t);
    }
  }

  private add(a: Omit<Action, "w"> & { w?: number }) {
    this.actions.push({ w: a.w ?? this.posAt(a.t0).w, ...a } as Action);
  }

  private buildActions(tl: TimelineEntry[]) {
    let open: ReplayEvent | null = null;
    const mining = new Map<string, { t0: number; t1: number; w: number; at: Vec3 }>();
    const itemEntities = new Map<number, string>(), itemSpawned = new Map<number, number>();
    const justMined: Action[] = [];
    const flying = new Map<number, Action>();
    const entityType = new Map<number, string>();
    let lastSwing = -100;
    let pie: { t0: number; t1: number; focus: string } | null = null;
    let lastHealth = 20, lastFood = 20, pausedAt: number | null = null, usingSince: number | null = null;

    for (const e of this.events) {
      switch (e.type) {
        case "CONTAINER":
          if (open && (e.container === "closed" || e.container !== open.container)) {
            this.add({ kind: CONTAINER_KIND[open.container!] ?? "screen", t0: open.t, t1: e.t, at: open.positions?.[0], delta: this.invDelta(open.t, e.t) });
            open = null;
          }
          if (e.container !== "closed") open = e;
          break;
        case "BLOCK_PROGRESS": {
          const k = `${e.world}:${e.at}`;
          const m = mining.get(k);
          if (!m || e.t - m.t1 > 40) mining.set(k, { t0: e.t, t1: e.t, w: e.world!, at: e.at! });
          else m.t1 = e.t;
          break;
        }
        case "BLOCK_BREAK": case "BLOCK_REMOVE": {
          const k = `${e.world}:${e.at}`;
          const m = mining.get(k);
          if (m) {
            mining.delete(k);
            const w0 = this.posAt(m.t0).w, w1 = this.posAt(e.t).w;
            if (!(w0 === 0 && e.t - m.t1 > 5000) && !(w1 === 2 && e.t - m.t1 > 100)) {
              this.add({ kind: "mine", t0: m.t0, t1: e.t, w: m.w, at: m.at });
              justMined.push(this.actions.at(-1)!);
            }
          }
          break;
        }
        case "ITEM_ENTITY": {
          itemEntities.set(e.id!, e.item!);
          if (!itemSpawned.has(e.id!)) itemSpawned.set(e.id!, e.t);
          // Block drop spawns where it broke a tick or two later
          const m = justMined.find((a) => !a.item && e.t - a.t1 <= 4 && a.at && e.pos && Math.hypot(e.pos[0] - a.at[0] - 0.5, e.pos[1] - a.at[1] - 0.5, e.pos[2] - a.at[2] - 0.5) <= 1.5);
          if (m) { m.item = e.item; m.count = e.count; }
          while (justMined.length && e.t - justMined[0].t1 > 10) justMined.shift();
          break;
        }
        case "ITEM_PICKUP":
          if (e.collector === -2) this.add({ kind: "pickup", t0: e.t, t1: e.t, item: itemEntities.get(e.id!) ?? "?", count: e.count, dropped: itemSpawned.get(e.id!) });
          break;
        case "PIGLIN_BARTER": {
          const d: Record<string, number> = {};
          for (const [it, n] of e.items ?? []) d[it] = (d[it] ?? 0) + n;
          this.add({ kind: "barter", t0: e.t, t1: e.t, w: e.world, delta: d, id: e.id });
          break;
        }
        case "PROJECTILE":
          if (e.entity === "ender_pearl") { this.add({ kind: "pearl", t0: e.t, t1: e.t, w: e.world, at: e.pos }); flying.set(e.id!, this.actions.at(-1)!); }
          break;
        case "ENTITY_REMOVE": {
          // Pearl flight lasts until it lands
          const f = flying.get(e.id!);
          if (f) { f.t1 = Math.min(e.t, f.t0 + 200); flying.delete(e.id!); }
          break;
        }
        case "ENTITY_ADD":
          entityType.set(e.id!, e.entity!);
          if (e.entity === "eye_of_ender") { this.add({ kind: "eye", t0: e.t, t1: e.t, w: e.world, at: e.pos }); flying.set(e.id!, this.actions.at(-1)!); }
          break;
        case "SWING": lastSwing = e.t; break;
        case "ENTITY_DAMAGE":
          // Mob hurt right after you swung means you hit it
          if (e.t - lastSwing <= 4 && e.t >= lastSwing) this.add({ kind: "hit", t0: e.t, t1: e.t, w: e.world, what: entityType.get(e.id!) ?? "mob" });
          break;
        case "BLOCK_UPDATE":
          if (e.blockEvent === 0 && e.block && e.block !== "air") this.add({ kind: "place", t0: e.t, t1: e.t, w: e.world, at: e.at, what: e.block });
          break;
        case "PIE_CHART": {
          const focus = (e.pie?.[0]?.[0] ?? "").split("\u001e").at(-1) || "root";
          if (pie && e.t - pie.t1 <= 20) { pie.t1 = e.t; pie.focus = focus; }
          else { if (pie) this.add({ kind: "pie", t0: pie.t0, t1: pie.t1, what: pie.focus }); pie = { t0: e.t, t1: e.t, focus }; }
          break;
        }
        case "STATS":
          if (e.health! < lastHealth) this.add({ kind: "damage", t0: e.t, t1: e.t, amount: lastHealth - e.health! });
          if (e.food! > lastFood && usingSince !== null) this.add({ kind: "eat", t0: usingSince, t1: e.t, amount: e.food! - lastFood });
          lastHealth = e.health!; lastFood = e.food!;
          break;
        case "USE":
          usingSince = e.hand ? (usingSince ?? e.t) : null;
          break;
        case "PAUSE":
          if (e.paused && pausedAt === null) pausedAt = e.t;
          else if (!e.paused && pausedAt !== null) { this.pauses.push([pausedAt, e.t]); pausedAt = null; }
          break;
      }
    }
    if (open) this.add({ kind: CONTAINER_KIND[open.container!] ?? "screen", t0: open.t, t1: this.end, at: open.positions?.[0], delta: {} });
    if (pie) this.add({ kind: "pie", t0: pie.t0, t1: pie.t1, what: pie.focus });
    if (pausedAt !== null) this.pauses.push([pausedAt, this.end]);
    for (const m of mining.values()) if (m.t1 - m.t0 > 10) this.add({ kind: "mine_abandoned", t0: m.t0, t1: m.t1, w: m.w, at: m.at });
    for (const e of tl) if (DEATH_TYPES.includes(e.type)) { const t = Math.round(e.time / 50); this.add({ kind: "death", t0: t, t1: t, what: e.type.endsWith("spawnpoint") ? "spawnpoint" : "spawn" }); }
    for (let i = 1; i < this.track.length; i++) {
      const a = this.track[i - 1], b = this.track[i];
      if (a.w !== b.w) this.add({ kind: "portal", t0: a.t, t1: b.t, w: a.w, at: [Math.round(a.x), Math.round(a.y), Math.round(a.z)], to: b.w });
    }
    // What a mined block gave = next pickup within 3 s if it's something a block drops
    const picks = this.actions.filter((a) => a.kind === "pickup");
    let p = 0;
    for (const a of this.actions.filter((x) => x.kind === "mine" && !x.item).sort((x, y) => x.t1 - y.t1)) {
      while (p < picks.length && picks[p].t0 < a.t1) p++;
      if (p < picks.length && picks[p].t0 <= a.t1 + 60 && isBlockDrop(picks[p].item ?? "")) { a.item = picks[p].item; a.count = Math.min(picks[p].count ?? 1, 4); }
    }
  }
}

const DROPS = new Set(["flint", "coal", "diamond", "redstone", "lapis_lazuli", "emerald", "glowstone_dust", "quartz", "gold_nugget", "stick", "wheat_seeds", "apple", "string"]);
const isBlockDrop = (item: string) => item !== "?" && (isBlock(item) || DROPS.has(item));

export function lowerBound(a: number[], x: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; }
  return lo;
}
