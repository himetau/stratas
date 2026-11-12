import type { ActivityTimeline } from "./activity";
import { ACTIVITIES } from "./activity";
import { Facts } from "./facts";
import { Run, type Action } from "./run";
import { fmtDur } from "./names";
import { BED_POWER, LOG, meals, withoutPickups } from "./stats";

export type StepKind =
  | "trade"
  | "loot"
  | "craft"
  | "sort"
  | "mine"
  | "fight"
  | "portal"
  | "build"
  | "eyes"
  | "beds"
  | "eat"
  | "death"
  | "pause"
  | "travel"
  | "still";
/** One play-by-play entry. Text is the headline, detail is what was gained or used if any. Steps can overlap. */
export interface Step {
  t0: number;
  t1: number;
  kind: StepKind;
  text: string;
  detail?: string;
}

export const STEP_LABEL: Record<StepKind, string> = {
  trade: "Trading",
  loot: "Chests",
  craft: "Crafting",
  sort: "Sorting inventory",
  mine: "Mining",
  fight: "Fighting",
  portal: "Building a portal",
  build: "Bridging and pillaring",
  eyes: "Eyes",
  beds: "Beds",
  eat: "Eating",
  death: "Dead",
  pause: "Paused",
  travel: "Travelling",
  still: "Idle",
};

const NAME: Record<string, string> = {
  ender_pearl: "pearls",
  obsidian: "obsidian",
  crying_obsidian: "crying obsidian",
  string: "string",
  gold_ingot: "gold ingots",
  gold_block: "gold blocks",
  iron_ingot: "iron",
  flint_and_steel: "flint and steel",
  fire_charge: "fire charges",
  bread: "bread",
  blaze_rod: "blaze rods",
  ender_eye: "eyes",
  water_bucket: "water bucket",
  lava_bucket: "lava bucket",
  bucket: "bucket",
  crafting_table: "crafting table",
  glowstone: "glowstone",
  respawn_anchor: "respawn anchor",
  golden_carrot: "golden carrots",
  cooked_porkchop: "porkchops",
  cooked_beef: "steak",
  tnt: "TNT",
  diamond: "diamonds",
  blaze_powder: "blaze powder",
  white_wool: "wool",
  soul_sand: "soul sand",
  gravel: "gravel",
  flint: "flint",
};
const USEFUL =
  /pearl|obsidian|^string$|gold_ingot|gold_block|iron_ingot|_pickaxe|_axe|_shovel|_sword|_helmet|_chestplate|_leggings|_boots|flint_and_steel|fire_charge|bucket|bread|cooked|golden_carrot|diamond|tnt|blaze|ender_eye|_bed$|wool|glowstone|respawn_anchor|potion|bow$|crossbow|boat|crafting_table|soul_sand|flint$/;
export const itemName = (it: string) => NAME[it] ?? it.replace(/_/g, " ");
export const listItems = (d: Record<string, number>, k = 4, filter = true) => {
  const xs = Object.entries(d)
    .filter(([it, n]) => n > 0 && (!filter || USEFUL.test(it)))
    .sort((a, b) => b[1] - a[1])
    .slice(0, k);
  return xs
    .map(([it, n]) => (n === 1 ? itemName(it).replace(/s$/, "") : `${n} ${itemName(it)}`))
    .join(", ");
};
const dur = (t: number) => fmtDur(t / 20);
/** "1 eye", "3 eyes" */
const counted = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;

function step(t0: number, t1: number, kind: StepKind, text: string, detail?: string): Step {
  return { t0, t1: Math.max(t1, t0 + 1), kind, text, ...(detail ? { detail } : {}) };
}

const actionsOf = (r: Run, ...kinds: Action["kind"][]) =>
  r.actions.filter((a) => kinds.includes(a.kind));

/** Group actions whose gaps are at most `gap` ticks */
function clusters<T extends { t0: number; t1: number }>(xs: T[], gap: number): T[][] {
  const out: T[][] = [];
  for (const x of [...xs].sort((a, b) => a.t0 - b.t0)) {
    const last = out.at(-1);
    if (last && x.t0 - Math.max(...last.map((y) => y.t1)) <= gap) {
      last.push(x);
    } else {
      out.push([x]);
    }
  }
  return out;
}
const span = (xs: { t0: number; t1: number }[]) =>
  [Math.min(...xs.map((x) => x.t0)), Math.max(...xs.map((x) => x.t1))] as const;
const range = (xs: number[]) => Math.max(...xs) - Math.min(...xs);

function tally(keys: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) {
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function sumDeltas(xs: Action[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) {
    for (const [it, n] of Object.entries(x.delta ?? {})) {
      out[it] = (out[it] ?? 0) + n;
    }
  }
  return out;
}

function mineText(ms: Action[]): string {
  const by = tally(ms.map((m) => m.item ?? "?"));
  const n = ms.length;
  const group = (re: RegExp) =>
    Object.entries(by)
      .filter(([k]) => re.test(k))
      .reduce((s, [, v]) => s + v, 0);
  const gold = group(/^gold_block$/);
  const logs = group(LOG);
  const grav = group(/^gravel$|^flint$/);
  const obby = group(/obsidian/);
  if (gold >= 1 && gold >= n * 0.4) {
    const others = n - gold >= 3 ? `, ${n - gold} other blocks` : "";
    return `Mined ${counted(gold, "gold block")}${others}`;
  }
  if (logs >= n * 0.6) {
    return `Chopped ${counted(logs, "log")}`;
  }
  if (grav >= n * 0.6) {
    return `Dug ${grav} gravel${by.flint ? `, ${by.flint} flint` : ""}`;
  }
  if (obby >= n * 0.6) {
    return `Mined ${obby} obsidian`;
  }
  const top = Object.entries(by)
    .filter(([k]) => k !== "?")
    .sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= n * 0.6 && n >= 2) {
    return `Mined ${top[1]} ${itemName(top[0])}`;
  }
  return `Broke ${counted(n, "block")}`;
}

function deathAndPauseSteps(r: Run, tl: ActivityTimeline): Step[] {
  const out: Step[] = [];
  for (const d of tl.deaths) {
    let text = "Died";
    if (d.warp) {
      text = `Death warp to your ${d.reset}`;
    } else if (d.reset) {
      text = `Death reset (${d.reset})`;
    }
    out.push(step(d.t, d.until, "death", text));
  }
  for (const [a, b] of r.pauses) {
    if (b - a >= 20) {
      out.push(step(a, b, "pause", `Paused ${dur(b - a)}`));
    }
  }
  return out;
}

/** Trading is barters under 8 s apart, starting when the gold was thrown */
function tradeSteps(r: Run, f: Facts): Step[] {
  return clusters(actionsOf(r, "barter"), 160).map((c) => {
    const [, b] = span(c);
    const first =
      f.goldThrown.filter((g) => g.t <= c[0].t0 && g.t >= c[0].t0 - 400).at(0)?.t ?? c[0].t0 - 120;
    const pigs = new Set(c.map((x) => x.id)).size;
    const text = `${counted(c.length, "trade")} from ${counted(pigs, "piglin")}`;
    return step(first, b, "trade", text, listItems(sumDeltas(c), 4));
  });
}

function portalText(builtInNether: boolean, afterBlind: boolean): string {
  if (!builtInNether) {
    return "Built a portal";
  }
  return afterBlind ? "Built a portal to the stronghold" : "Built a blind portal";
}

/** Portals are bucket work in the Overworld before the Nether, or obsidian placed in a frame */
function portalSteps(r: Run, f: Facts): Step[] {
  const out: Step[] = [];
  const enter = r.mark("nether");
  const lava = f.buckets.filter(
    (b) => b.t < (enter ?? Infinity) && b.t >= (enter ?? Infinity) - 1200,
  );
  if (enter !== undefined && lava.some((b) => b.fluid === "lava")) {
    const emptied = (fluid: string) => lava.filter((b) => b.op === "empty" && b.fluid === fluid);
    const detail = `${emptied("lava").length} lava, ${emptied("water").length} water`;
    out.push(step(lava[0].t, enter, "portal", "Built a lava portal", detail));
  }
  const blind = r.mark("blind");
  const obsidian = actionsOf(r, "place").filter((p) => p.what === "obsidian");
  for (const c of clusters(obsidian, 200)) {
    if (c.length < 4) {
      continue;
    }
    const [a, b] = span(c);
    // Going through starts at your last position record, which is before the last block if you stood still
    // while placing it, so the portal is matched on when you came out.
    const lit = r.actions.find((x) => x.kind === "portal" && x.t1 > b && x.t0 <= b + 600);
    if (!lit) {
      out.push(step(a, b, "build", `Placed ${c.length} obsidian`));
      continue;
    }
    // A portal built in the Nether is the blind, out to the Overworld to measure eyes. One after blind
    // travel (back for more rods) goes to stronghold coords already measured.
    const t1 = Math.max(lit.t0, b);
    const text = portalText(lit.w === 1, blind !== undefined && t1 > blind);
    out.push(step(a, t1, "portal", text, `${c.length} obsidian`));
  }
  return out;
}

function lootSteps(r: Run): Step[] {
  return clusters(actionsOf(r, "chest"), 80).map((c) => {
    const [a, b] = span(c);
    const text = c.length > 1 ? `Looted ${c.length} chests` : "Looted a chest";
    return step(a, b, "loot", text, listItems(sumDeltas(c), 4) || "nothing useful");
  });
}

function screenSteps(r: Run): Step[] {
  const out: Step[] = [];
  for (const x of actionsOf(r, "craft", "inventory", "furnace")) {
    const d = withoutPickups(r, x.delta ?? {}, x.t0, x.t1);
    if (!Object.values(d).some((n) => n < 0)) {
      for (const k of Object.keys(d)) {
        if (d[k] > 0 && x.kind !== "furnace") {
          delete d[k];
        }
      }
    }
    const plus = Object.fromEntries(Object.entries(d).filter(([, n]) => n > 0));
    const minus = Object.entries(d).filter(([, n]) => n < 0);
    if (Object.keys(plus).length) {
      const verb = x.kind === "furnace" ? "Smelted" : "Crafted";
      const made = listItems(plus, 4) || listItems(plus, 3, false);
      out.push(step(x.t0, x.t1, "craft", `${verb} ${made}`));
    } else if (minus.length) {
      const dropped = minus
        .sort((a, b) => a[1] - b[1])
        .slice(0, 3)
        .map(([it]) => itemName(it))
        .join(", ");
      out.push(step(x.t0, x.t1, "sort", `Dropped ${dropped}`));
    }
  }
  return out;
}

function mineSteps(r: Run): Step[] {
  const mined = actionsOf(r, "mine").filter((m) => m.t1 - m.t0 <= 300);
  return clusters(mined, 60).map((c) => {
    const [a, b] = span(c);
    return step(a, b, "mine", mineText(c));
  });
}

/** Fights are your hits on one mob type plus what you killed */
function fightSteps(r: Run, f: Facts): Step[] {
  const out: Step[] = [];
  const fights = clusters(actionsOf(r, "hit"), 100);
  for (const [i, c] of fights.entries()) {
    const [a, b] = span(c);
    const mobs = tally(c.map((h) => h.what ?? "mob"));
    const killed = f.kills.filter((k) => k.t >= a && k.t <= b + 40);
    const main = Object.entries(mobs).sort((p, q) => q[1] - p[1])[0][0];
    if (!killed.length && (c.length < 3 || main === "mob")) {
      continue;
    }
    // Rods count until the next fight starts, so none count twice.
    const until = Math.min(b + 200, i + 1 < fights.length ? span(fights[i + 1])[0] - 1 : Infinity);
    const rods = main === "blaze" ? r.rodsIn(a, until) : 0;
    const kills = Object.entries(tally(killed.map((k) => k.entity)))
      .map(([m, n]) => counted(n, m.replace(/_/g, " ")))
      .join(", ");
    const text = kills ? `Killed ${kills}` : `Fought ${main.replace(/_/g, " ")}s`;
    out.push(step(a, b, "fight", text, rods > 0 ? counted(rods, "rod") : undefined));
  }
  return out;
}

function eyeAndBedSteps(f: Facts): Step[] {
  const out: Step[] = [];
  for (const c of clusters(f.eyes, 1200)) {
    const [a, b] = span(c);
    const broke = c.filter((e) => e.broke).length;
    out.push(
      step(a, b, "eyes", `Threw ${counted(c.length, "eye")}`, broke ? `${broke} broke` : undefined),
    );
  }
  const bedBlasts = f.explosions
    .filter((x) => x.power === BED_POWER)
    .map((x) => ({ t0: x.t, t1: x.t, w: x.w }));
  for (const c of clusters(bedBlasts, 600)) {
    const [a, b] = span(c);
    const what = c[0].w === 2 ? "bed" : "bed or anchor";
    out.push(step(a, b, "beds", `Exploded ${counted(c.length, what)}`));
  }
  if (f.framesFilled.length) {
    const a = f.framesFilled[0];
    const b = f.framesFilled.at(-1)!;
    const text = `Put ${counted(f.framesFilled.length, "eye")} in the end portal`;
    out.push(step(a, b, "build", text));
  }
  return out;
}

/** Splits placements on a dimension change or a pearl teleport (a jump over 12 blocks) */
function splitOnJumps(r: Run, places: Action[]): Action[][] {
  const groups: Action[][] = [];
  for (const p of places) {
    const prev = groups.at(-1)?.at(-1);
    if (
      prev &&
      r.posAt(prev.t0).w === r.posAt(p.t0).w &&
      (!prev.at || !p.at || Math.hypot(p.at[0] - prev.at[0], p.at[2] - prev.at[2]) <= 12)
    ) {
      groups.at(-1)!.push(p);
    } else {
      groups.push([p]);
    }
  }
  return groups;
}

function placeText(c: Action[]): string {
  const up = range(c.map((p) => p.at?.[1] ?? 0));
  const across = Math.max(range(c.map((p) => p.at?.[0] ?? 0)), range(c.map((p) => p.at?.[2] ?? 0)));
  if (up >= across && up >= 3) {
    return `Pillared ${up} blocks`;
  }
  if (across >= 3) {
    return `Bridged ${across} blocks`;
  }
  return `Placed ${c.length} blocks`;
}

function placeSteps(r: Run): Step[] {
  const out: Step[] = [];
  const blocks = actionsOf(r, "place").filter((p) => p.what !== "obsidian");
  for (const raw of clusters(blocks, 40)) {
    for (const c of splitOnJumps(r, raw)) {
      if (c.length < 4) {
        continue;
      }
      const [a, b] = span(c);
      out.push(step(a, b, "build", placeText(c)));
    }
  }
  return out;
}

function eatSteps(r: Run): Step[] {
  const food = meals(r);
  return actionsOf(r, "eat").map((x) => {
    const m = food.find((f) => f.t === x.t1)?.item;
    return step(x.t0, x.t1, "eat", m ? `Ate ${itemName(m).replace(/(?<!ie)s$/, "")}` : "Ate");
  });
}

/** Stretches of at least 3 s covered by no step and no open screen */
function uncoveredGaps(r: Run, steps: Step[]): [number, number][] {
  const covered = new Uint8Array(r.end + 1);
  for (const s of steps) {
    for (let t = Math.max(0, s.t0); t <= Math.min(r.end, s.t1); t++) {
      covered[t] = 1;
    }
  }
  for (const x of actionsOf(r, "craft", "inventory", "chest", "furnace", "villager", "screen")) {
    for (let t = x.t0; t <= Math.min(r.end, x.t1); t++) {
      covered[t] = 1;
    }
  }
  let g0 = -1;
  const gaps: [number, number][] = [];
  for (let t = 0; t <= r.end + 1; t++) {
    const free = t <= r.end && !covered[t];
    if (free && g0 < 0) {
      g0 = t;
    } else if (!free && g0 >= 0) {
      if (t - g0 >= 60) {
        gaps.push([g0, t]);
      }
      g0 = -1;
    }
  }
  return gaps;
}

/** Walked distance in [a, b], leaving out pearl and dimension jumps */
function walked(r: Run, a: number, b: number): number {
  const pts = r.slice(a, b);
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].w !== pts[i - 1].w) {
      continue;
    }
    const st = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    if (st < 12) {
      d += st;
    }
  }
  return d;
}

/** Time no other step covers, as travel or standing still */
function travelSteps(r: Run, tl: ActivityTimeline, steps: Step[]): Step[] {
  const out: Step[] = [];
  const pearls = actionsOf(r, "pearl");
  for (const [a, b] of uncoveredGaps(r, steps)) {
    const d = walked(r, a, b);
    let still = 0;
    for (let t = a; t < b; t++) {
      if (ACTIVITIES[tl.act[t]] === "standing") {
        still++;
      }
    }
    const p = pearls.filter((x) => x.t0 >= a && x.t0 < b).length;
    if (d >= 15 && still < (b - a) * 0.6) {
      const thrown = p ? `, ${counted(p, "pearl")}` : "";
      out.push(step(a, b, "travel", `Travelled ${Math.round(d)} blocks${thrown}`));
    } else if (still >= 60) {
      out.push(step(a, b, "still", `Idle ${dur(still)}`));
    }
  }
  return out;
}

/** Play by play for a runner from what the replay records */
export function buildSteps(r: Run, tl: ActivityTimeline, f: Facts): Step[] {
  const steps = [
    ...deathAndPauseSteps(r, tl),
    ...tradeSteps(r, f),
    ...portalSteps(r, f),
    ...lootSteps(r),
    ...screenSteps(r),
    ...mineSteps(r),
    ...fightSteps(r, f),
    ...eyeAndBedSteps(f),
    ...placeSteps(r),
    ...eatSteps(r),
  ];
  steps.sort((a, b) => a.t0 - b.t0);
  steps.push(...travelSteps(r, tl, steps));
  steps.sort((a, b) => a.t0 - b.t0 || b.t1 - a.t1);
  return steps;
}

/** Seconds per step kind in [t0, t1), overlapping steps of the same kind count once */
export function stepTotals(
  steps: Step[],
  t0: number,
  t1: number,
): Partial<Record<StepKind, number>> {
  const out: Partial<Record<StepKind, number>> = {};
  const by = new Map<StepKind, [number, number][]>();
  for (const s of steps) {
    const a = Math.max(t0, s.t0);
    const b = Math.min(t1, s.t1);
    if (b > a) {
      const xs = by.get(s.kind) ?? [];
      xs.push([a, b]);
      by.set(s.kind, xs);
    }
  }
  for (const [k, xs] of by) {
    xs.sort((p, q) => p[0] - q[0]);
    let total = 0;
    let cur: [number, number] | null = null;
    for (const x of xs) {
      if (cur && x[0] <= cur[1]) {
        cur[1] = Math.max(cur[1], x[1]);
      } else {
        if (cur) {
          total += cur[1] - cur[0];
        }
        cur = [...x] as [number, number];
      }
    }
    if (cur) {
      total += cur[1] - cur[0];
    }
    out[k] = total / 20;
  }
  return out;
}
