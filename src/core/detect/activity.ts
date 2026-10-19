// What a runner was doing every tick. Each tick is charged to one activity (whatever was holding them up)
// and anything else at the same time is free overlap, so lost time in a stretch splits exactly
import { Run, type Action } from "./run";

export const ACTIVITIES = [
  "dead", "mining", "fighting", "placing", "eating", "pearl", "walking", "trading", "chest", "craft", "furnace", "villager",
  "screen", "inventory", "pickup", "drinking", "aiming", "portal", "flight", "pie", "looking", "paused", "standing",
] as const;
export type Activity = (typeof ACTIVITIES)[number];
const A = Object.fromEntries(ACTIVITIES.map((a, i) => [a, i])) as Record<Activity, number>;
// ACTIVITIES is in priority order, earlier one gets the tick

/** Reset = died on purpose after setting spawn (bed, or anchor in the Nether) to come back healed. Warp = spawn was far away */
export interface DeathInfo { t: number; back: number | null; until: number; w: number; x: number; z: number; reset: "bed" | "anchor" | null; warp: boolean }
export interface ActivityTimeline {
  /** The activity each tick is charged to */
  act: Uint8Array;
  /** Every activity present on each tick, as bits */
  present: Uint32Array;
  deaths: DeathInfo[];
  trading: [number, number][];
}

const SWEEP_DEG_PER_S = 120;

export function buildActivities(r: Run): ActivityTimeline {
  const n = r.end + 1;
  const present = new Uint32Array(n);
  const mark = (t0: number, t1: number, a: Activity) => {
    const bit = 1 << A[a];
    for (let t = Math.max(0, Math.floor(t0)); t <= Math.min(n - 1, Math.ceil(t1)); t++) present[t] |= bit;
  };

  const pos = Array.from({ length: n }, (_, t) => r.posAt(t));
  for (let t = 0; t < n; t++) {
    const a = pos[Math.max(0, t - 10)], b = pos[Math.min(n - 1, t + 10)];
    if (a.w !== b.w || Math.hypot(b.x - a.x, b.z - a.z) >= 1) present[t] |= 1 << A.walking;
  }
  const L = r.looks;
  for (let i = 1; i < L.length; i++) {
    const a = L[i - 1], b = L[i], dt = b.t - a.t;
    if (dt <= 0 || dt > 4) continue;
    if ((Math.abs(((b.yaw - a.yaw + 540) % 360) - 180) / dt) * 20 >= SWEEP_DEG_PER_S) mark(a.t, b.t, "looking");
  }
  for (const [p0, p1] of r.pauses) mark(p0, p1, "paused");

  // Stuff you do while standing still. In a portal, pearl or eye in the air, aiming a bow, drinking a potion
  const slots = new Map<number, string>();
  let held = 0, useFrom: number | null = null, useItem = "", portalFrom: number | null = null;
  for (const e of r.events) {
    if (e.type === "INVENTORY_SLOT" && e.slot! <= 40) slots.set(e.slot!, e.item!);
    else if (e.type === "HELD_SLOT") held = e.slot!;
    else if (e.type === "USE") {
      if (e.hand && useFrom === null) {
        useFrom = e.t;
        useItem = (e.hand & 2) ? (slots.get(40) ?? "") : (slots.get(held) ?? "");
      }
      else if (!e.hand && useFrom !== null) {
        if (/bow$/.test(useItem)) mark(useFrom, e.t, "aiming");
        else if (/potion|milk_bucket/.test(useItem)) mark(useFrom, e.t, "drinking");
        useFrom = null;
      }
    } else if (e.type === "PORTAL") {
      if (e.inPortal && portalFrom === null) portalFrom = e.t;
      else if (!e.inPortal && portalFrom !== null) { mark(portalFrom, e.t, "portal"); portalFrom = null; }
    }
  }
  for (const x of r.actions) if ((x.kind === "pearl" || x.kind === "eye") && x.t1 > x.t0) mark(x.t0, x.t1, "flight");

  // Barter session = barters under 8 s apart, starts a bit before the first one
  const trading: [number, number][] = [];
  for (const b of r.actions.filter((x) => x.kind === "barter")) {
    const last = trading.at(-1);
    if (last && b.t0 - last[1] <= 160) last[1] = b.t0; else trading.push([b.t0 - 60, b.t0]);
  }
  for (const [a, b] of trading) mark(a, b + 20, "trading");

  const near = (x: Action, before: number, after: number, a: Activity) => mark(x.t0 - before, x.t1 + after, a);
  for (const x of r.actions) {
    switch (x.kind) {
      case "craft": case "inventory": case "chest": case "furnace": case "villager": case "screen": near(x, 0, 0, x.kind); break;
      case "pie": near(x, 0, 2, "pie"); break;
      case "mine": case "mine_abandoned": near(x, 0, 0, "mining"); break;
      case "hit": near(x, 8, 4, "fighting"); break;
      case "eat": near(x, 0, 0, "eating"); break;
      case "place": near(x, 6, 4, "placing"); break;
      case "pearl": case "eye": near(x, 6, 4, "pearl"); break;
      case "pickup": near(x, 4, 4, "pickup"); break;
    }
  }

  const deaths: DeathInfo[] = [];
  for (const d of r.actions.filter((x) => x.kind === "death")) {
    const spot = r.posAt(Math.max(0, d.t0 - 2));
    let back: number | null = null;
    for (let t = d.t0 + 40; t < n; t++) {
      const p = pos[t];
      if (p.w === spot.w && Math.hypot(p.x - spot.x, p.z - spot.z) < 8) { back = t; break; }
    }
    const nextSplit = r.splitList.find((s) => s.t > d.t0 + 40)?.t ?? n - 1;
    let until = Math.min(back ?? n - 1, nextSplit);
    let reset: DeathInfo["reset"] = null, warp = false;
    if (d.what === "spawnpoint") {
      const placed = r.events.filter((e) => e.type === "BLOCK_UPDATE" && e.t <= d.t0 && e.t >= d.t0 - 1200 && /(_bed|respawn_anchor)$/.test(e.block ?? "")).at(-1);
      reset = placed?.block === "respawn_anchor" || spot.w === 1 ? "anchor" : "bed";
      const r1 = r.posAt(Math.min(n - 1, d.t0 + 30));
      warp = r1.w !== spot.w || Math.hypot(r1.x - spot.x, r1.z - spot.z) > 32;
      // Reset is over once your stuff is picked back up
      if (!warp) until = Math.max(back ?? d.t0, r.events.filter((e) => e.type === "ITEM_PICKUP" && e.t > d.t0 && e.t <= d.t0 + 300).at(-1)?.t ?? d.t0);
    }
    deaths.push({ t: d.t0, back, until, w: spot.w, x: spot.x, z: spot.z, reset, warp });
    for (let t = d.t0; t <= until && t < n; t++) present[t] |= 1 << A.dead;
  }

  const act = new Uint8Array(n).fill(A.standing);
  for (let t = 0; t < n; t++) {
    const p = present[t];
    if (p) act[t] = 31 - Math.clz32(p & -p); // Lowest bit is highest priority
  }
  // Gaps under a second are just reaction time, give them to whatever comes next
  for (let t = 0; t < n;) {
    if (act[t] !== A.standing) { t++; continue; }
    let e = t;
    while (e < n && act[e] === A.standing) e++;
    if (e - t < 20 && e < n && act[e] !== A.paused) act.fill(act[e], t, e);
    t = e;
  }
  return { act, present, deaths, trading };
}

/** Seconds per activity over ticks [t0, t1) */
export function countActivities(tl: ActivityTimeline, t0: number, t1: number): Record<Activity, number> {
  const c = Object.fromEntries(ACTIVITIES.map((a) => [a, 0])) as Record<Activity, number>;
  const a = Math.max(0, Math.round(t0)), b = Math.min(tl.act.length, Math.round(t1));
  for (let t = a; t < b; t++) c[ACTIVITIES[tl.act[t]]] += 1;
  for (const k of ACTIVITIES) c[k] /= 20;
  return c;
}

export const ACTIVITY_LABEL: Record<Activity, string> = {
  dead: "Death", mining: "Mining", fighting: "Fighting", placing: "Placing blocks", eating: "Eating", pearl: "Pearls and eyes",
  walking: "Walking", trading: "Waiting on trades", chest: "Chests", craft: "Crafting", furnace: "Furnace", villager: "Villager trading",
  screen: "Menus", inventory: "Inventory", pickup: "Picking up items", drinking: "Drinking", aiming: "Aiming a bow", portal: "In a portal", flight: "Pearl and eye flights",
  pie: "Pie chart", looking: "Looking around", paused: "Paused", standing: "Idle",
};
