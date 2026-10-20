// Play by play for a runner from what the replay records (screens, mining, buckets, barters, kills, eyes etc)
// Steps can overlap, like mining while piglins barter
import type { ActivityTimeline } from "./activity";
import { ACTIVITIES } from "./activity";
import { Facts } from "./facts";
import { Run, type Action } from "./run";
import { fmtDur } from "./names";
import { meals } from "./stats";

export type StepKind = "trade" | "loot" | "craft" | "sort" | "mine" | "fight" | "portal" | "build" | "eyes" | "beds" | "eat" | "death" | "pause" | "travel" | "still";
/** Text is the headline, detail is what was gained or used if any */
export interface Step { t0: number; t1: number; kind: StepKind; text: string; detail?: string }

export const STEP_LABEL: Record<StepKind, string> = {
  trade: "Trading", loot: "Chests", craft: "Crafting", sort: "Sorting inventory", mine: "Mining", fight: "Fighting", portal: "Building a portal",
  build: "Bridging and pillaring", eyes: "Eyes", beds: "Beds", eat: "Eating", death: "Dead", pause: "Paused", travel: "Travelling", still: "Idle",
};

const NAME: Record<string, string> = {
  ender_pearl: "pearls", obsidian: "obsidian", crying_obsidian: "crying obsidian", string: "string", gold_ingot: "gold ingots", gold_block: "gold blocks",
  iron_ingot: "iron", flint_and_steel: "flint and steel", fire_charge: "fire charges", bread: "bread", blaze_rod: "blaze rods", ender_eye: "eyes",
  water_bucket: "water bucket", lava_bucket: "lava bucket", bucket: "bucket", crafting_table: "crafting table", glowstone: "glowstone",
  respawn_anchor: "respawn anchor", golden_carrot: "golden carrots", cooked_porkchop: "porkchops", cooked_beef: "steak", tnt: "TNT",
  diamond: "diamonds", blaze_powder: "blaze powder", white_wool: "wool", soul_sand: "soul sand", gravel: "gravel", flint: "flint",
};
const USEFUL = /pearl|obsidian|^string$|gold_ingot|gold_block|iron_ingot|_pickaxe|_axe|_shovel|_sword|_helmet|_chestplate|_leggings|_boots|flint_and_steel|fire_charge|bucket|bread|cooked|golden_carrot|diamond|tnt|blaze|ender_eye|_bed$|wool|glowstone|respawn_anchor|potion|bow$|crossbow|boat|crafting_table|soul_sand|flint$/;
export const itemName = (it: string) => NAME[it] ?? it.replace(/_/g, " ");
export const listItems = (d: Record<string, number>, k = 4, filter = true) => {
  const xs = Object.entries(d).filter(([it, n]) => n > 0 && (!filter || USEFUL.test(it))).sort((a, b) => b[1] - a[1]).slice(0, k);
  return xs.map(([it, n]) => (n === 1 ? itemName(it).replace(/s$/, "") : `${n} ${itemName(it)}`)).join(", ");
};
const s0 = (t: number) => fmtDur(t / 20);

/** Group actions whose gaps are at most `gap` ticks */
function clusters<T extends { t0: number; t1: number }>(xs: T[], gap: number): T[][] {
  const out: T[][] = [];
  for (const x of [...xs].sort((a, b) => a.t0 - b.t0)) {
    const last = out.at(-1);
    if (last && x.t0 - Math.max(...last.map((y) => y.t1)) <= gap) last.push(x); else out.push([x]);
  }
  return out;
}
const span = (xs: { t0: number; t1: number }[]) => [Math.min(...xs.map((x) => x.t0)), Math.max(...xs.map((x) => x.t1))] as const;

function mineText(ms: Action[]): string {
  const by: Record<string, number> = {};
  for (const m of ms) { const k = m.item ?? "?"; by[k] = (by[k] ?? 0) + 1; }
  const n = ms.length;
  const group = (re: RegExp) => Object.entries(by).filter(([k]) => re.test(k)).reduce((s, [, v]) => s + v, 0);
  const gold = group(/^gold_block$/), logs = group(/_log$|_wood$|_stem$|_hyphae$/), grav = group(/^gravel$|^flint$/), obby = group(/obsidian/);
  if (gold >= 1 && gold >= n * 0.4) return `Mined ${gold} gold block${gold > 1 ? "s" : ""}${n - gold >= 3 ? `, ${n - gold} other blocks` : ""}`;
  if (logs >= n * 0.6) return `Chopped ${logs} log${logs > 1 ? "s" : ""}`;
  if (grav >= n * 0.6) return `Dug ${grav} gravel${by.flint ? `, ${by.flint} flint` : ""}`;
  if (obby >= n * 0.6) return `Mined ${obby} obsidian`;
  const top = Object.entries(by).filter(([k]) => k !== "?").sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= n * 0.6 && n >= 2) return `Mined ${top[1]} ${itemName(top[0])}`;
  return `Broke ${n} block${n > 1 ? "s" : ""}`;
}

export function buildSteps(r: Run, tl: ActivityTimeline, f: Facts): Step[] {
  const steps: Step[] = [];
  const add = (t0: number, t1: number, kind: StepKind, text: string, detail?: string) => steps.push({ t0, t1: Math.max(t1, t0 + 1), kind, text, ...(detail ? { detail } : {}) });
  const A = r.actions;
  const of = (...k: Action["kind"][]) => A.filter((a) => k.includes(a.kind));

  for (const d of tl.deaths) add(d.t, d.until, "death", d.warp ? `Death warp to your ${d.reset}` : d.reset ? `Death reset (${d.reset})` : "Died");
  for (const [a, b] of r.pauses) if (b - a >= 20) add(a, b, "pause", `Paused ${s0(b - a)}`);

  // Trading = barters under 8 s apart, starts when the gold was thrown
  for (const c of clusters(of("barter"), 160)) {
    const [, b] = span(c);
    const first = f.goldThrown.filter((g) => g.t <= c[0].t0 && g.t >= c[0].t0 - 400).at(0)?.t ?? c[0].t0 - 120;
    const pigs = new Set(c.map((x) => x.id)).size;
    const got: Record<string, number> = {};
    for (const x of c) for (const [it, n] of Object.entries(x.delta ?? {})) got[it] = (got[it] ?? 0) + n;
    add(first, b, "trade", `${c.length} trade${c.length > 1 ? "s" : ""} from ${pigs} piglin${pigs > 1 ? "s" : ""}`, listItems(got, 4));
  }

  // Portals = bucket work in the Overworld before the Nether, or obsidian placed in a frame
  const enter = r.mark("nether");
  const lava = f.buckets.filter((b) => b.t < (enter ?? Infinity) && b.t >= (enter ?? Infinity) - 1200);
  if (enter !== undefined && lava.some((b) => b.fluid === "lava")) {
    const t0 = lava[0].t;
    const ln = lava.filter((b) => b.op === "empty" && b.fluid === "lava").length, wn = lava.filter((b) => b.op === "empty" && b.fluid === "water").length;
    add(t0, enter, "portal", "Built a lava portal", `${ln} lava, ${wn} water`);
  }
  const blind = r.mark("blind");
  for (const c of clusters(of("place").filter((p) => p.what === "obsidian"), 200)) {
    if (c.length < 4) continue;
    const [a, b] = span(c);
    // Going through starts at your last position record, which is before the last block if you stood still while
    // placing it, so match on when you came out
    const lit = A.find((x) => x.kind === "portal" && x.t1 > b && x.t0 <= b + 600);
    // Built in the Nether = the blind, out to the Overworld to measure eyes. One after blind travel (back for more
    // rods) goes to stronghold coords already measured
    const t1 = lit ? Math.max(lit.t0, b) : b, nether = lit?.w === 1;
    if (lit) add(a, t1, "portal", nether ? (blind !== undefined && t1 > blind ? "Built a portal to the stronghold" : "Built a blind portal") : "Built a portal", `${c.length} obsidian`);
    else add(a, b, "build", `Placed ${c.length} obsidian`);
  }

  for (const c of clusters(of("chest"), 80)) {
    const [a, b] = span(c);
    const got: Record<string, number> = {};
    for (const x of c) for (const [it, n] of Object.entries(x.delta ?? {})) got[it] = (got[it] ?? 0) + n;
    const items = listItems(got, 4);
    add(a, b, "loot", c.length > 1 ? `Looted ${c.length} chests` : "Looted a chest", items || "nothing useful");
  }

  const picks = of("pickup");
  for (const x of of("craft", "inventory", "furnace")) {
    // Stuff picked up off the ground while the screen was open isn't crafted
    const d = { ...(x.delta ?? {}) };
    for (const p of picks) if (p.t0 >= x.t0 && p.t0 <= x.t1 + 1 && p.item) d[p.item] = (d[p.item] ?? 0) - (p.count ?? 1);
    if (!Object.values(d).some((n) => n < 0)) for (const k of Object.keys(d)) if (d[k] > 0 && x.kind !== "furnace") delete d[k];
    const plus = Object.fromEntries(Object.entries(d).filter(([, n]) => n > 0)), minus = Object.entries(d).filter(([, n]) => n < 0);
    if (Object.keys(plus).length) add(x.t0, x.t1, "craft", `${x.kind === "furnace" ? "Smelted" : "Crafted"} ${listItems(plus, 4) || listItems(plus, 3, false)}`);
    else if (minus.length) add(x.t0, x.t1, "sort", `Dropped ${minus.sort((a, b) => a[1] - b[1]).slice(0, 3).map(([it]) => itemName(it)).join(", ")}`);
  }

  for (const c of clusters(of("mine").filter((m) => m.t1 - m.t0 <= 300), 60)) { const [a, b] = span(c); add(a, b, "mine", mineText(c)); }

  // Fights = your hits on one mob type plus what you killed
  const hits = of("hit");
  const fights = clusters(hits, 100);
  for (const [i, c] of fights.entries()) {
    const [a, b] = span(c);
    // Rods picked up after the fight, until the next one starts so none count twice
    const until = Math.min(b + 200, i + 1 < fights.length ? span(fights[i + 1])[0] - 1 : Infinity);
    const mobs: Record<string, number> = {};
    for (const h of c) mobs[h.what ?? "mob"] = (mobs[h.what ?? "mob"] ?? 0) + 1;
    const killed = f.kills.filter((k) => k.t >= a && k.t <= b + 40);
    const kt: Record<string, number> = {};
    for (const k of killed) kt[k.entity] = (kt[k.entity] ?? 0) + 1;
    const main = Object.entries(mobs).sort((p, q) => q[1] - p[1])[0][0];
    if (!killed.length && (c.length < 3 || main === "mob")) continue;
    const rods = main === "blaze" ? r.rodsIn(a, until) : 0;
    const kills = Object.entries(kt).map(([m, n]) => `${n} ${m.replace(/_/g, " ")}${n > 1 ? "s" : ""}`).join(", ");
    add(a, b, "fight", kills ? `Killed ${kills}` : `Fought ${main.replace(/_/g, " ")}s`, rods > 0 ? `${rods} rod${rods > 1 ? "s" : ""}` : undefined);
  }

  for (const c of clusters(f.eyes, 1200)) {
    const [a, b] = span(c);
    const broke = c.filter((e) => e.broke).length;
    add(a, b, "eyes", `Threw ${c.length} eye${c.length > 1 ? "s" : ""}`, broke ? `${broke} broke` : undefined);
  }
  // Beds and respawn anchors explode with power 5
  const endBeds = f.explosions.filter((x) => x.power === 5).map((x) => ({ t0: x.t, t1: x.t, w: x.w }));
  for (const c of clusters(endBeds, 600)) { const [a, b] = span(c); add(a, b, "beds", `Exploded ${c.length} ${c[0].w === 2 ? "bed" : "bed or anchor"}${c.length > 1 ? "s" : ""}`); }
  if (f.framesFilled.length) { const a = f.framesFilled[0], b = f.framesFilled.at(-1)!; add(a, b, "build", `Put ${f.framesFilled.length} eye${f.framesFilled.length > 1 ? "s" : ""} in the end portal`); }

  for (const raw of clusters(of("place").filter((p) => p.what !== "obsidian"), 40)) {
    // Split placements on dimension change or pearl tp (> 12 block jump)
    const groups: Action[][] = [];
    for (const p of raw) {
      const prev = groups.at(-1)?.at(-1);
      if (prev && r.posAt(prev.t0).w === r.posAt(p.t0).w && (!prev.at || !p.at || Math.hypot(p.at[0] - prev.at[0], p.at[2] - prev.at[2]) <= 12)) groups.at(-1)!.push(p);
      else groups.push([p]);
    }
    for (const c of groups) {
      if (c.length < 4) continue;
      const [a, b] = span(c);
      const ys = c.map((p) => p.at?.[1] ?? 0), up = Math.max(...ys) - Math.min(...ys);
      const xs = c.map((p) => p.at?.[0] ?? 0), zs = c.map((p) => p.at?.[2] ?? 0);
      const across = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
      add(a, b, "build", up >= across && up >= 3 ? `Pillared ${up} blocks` : across >= 3 ? `Bridged ${across} blocks` : `Placed ${c.length} blocks`);
    }
  }
  const food = meals(r);
  for (const x of of("eat")) { const m = food.find((f) => f.t === x.t1)?.item; add(x.t0, x.t1, "eat", m ? `Ate ${itemName(m).replace(/(?<!ie)s$/, "")}` : "Ate"); }

  // Whatever time is left is travel or standing still
  steps.sort((a, b) => a.t0 - b.t0);
  const covered = new Uint8Array(r.end + 1);
  for (const s of steps) for (let t = Math.max(0, s.t0); t <= Math.min(r.end, s.t1); t++) covered[t] = 1;
  for (const x of of("craft", "inventory", "chest", "furnace", "villager", "screen")) for (let t = x.t0; t <= Math.min(r.end, x.t1); t++) covered[t] = 1;
  let g0 = -1;
  const gaps: [number, number][] = [];
  for (let t = 0; t <= r.end + 1; t++) {
    const free = t <= r.end && !covered[t];
    if (free && g0 < 0) g0 = t;
    else if (!free && g0 >= 0) { if (t - g0 >= 60) gaps.push([g0, t]); g0 = -1; }
  }
  const pearls = of("pearl");
  for (const [a, b] of gaps) {
    const pts = r.slice(a, b);
    let d = 0;
    for (let i = 1; i < pts.length; i++) if (pts[i].w === pts[i - 1].w) { const st = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z); if (st < 12) d += st; }
    let still = 0;
    for (let t = a; t < b; t++) if (ACTIVITIES[tl.act[t]] === "standing") still++;
    const p = pearls.filter((x) => x.t0 >= a && x.t0 < b).length;
    if (d >= 15 && still < (b - a) * 0.6) add(a, b, "travel", `Travelled ${Math.round(d)} blocks${p ? `, ${p} pearl${p > 1 ? "s" : ""}` : ""}`);
    else if (still >= 60) add(a, b, "still", `Idle ${s0(still)}`);
  }
  steps.sort((a, b) => a.t0 - b.t0 || b.t1 - a.t1);
  return steps;
}

/** Seconds per step kind in [t0, t1), overlapping steps of the same kind count once */
export function stepTotals(steps: Step[], t0: number, t1: number): Partial<Record<StepKind, number>> {
  const out: Partial<Record<StepKind, number>> = {};
  const by = new Map<StepKind, [number, number][]>();
  for (const s of steps) {
    const a = Math.max(t0, s.t0), b = Math.min(t1, s.t1);
    if (b > a) by.set(s.kind, [...(by.get(s.kind) ?? []), [a, b]]);
  }
  for (const [k, xs] of by) {
    xs.sort((p, q) => p[0] - q[0]);
    let total = 0, cur: [number, number] | null = null;
    for (const x of xs) {
      if (cur && x[0] <= cur[1]) cur[1] = Math.max(cur[1], x[1]);
      else { if (cur) total += cur[1] - cur[0]; cur = [...x] as [number, number]; }
    }
    if (cur) total += cur[1] - cur[0];
    out[k] = total / 20;
  }
  return out;
}
