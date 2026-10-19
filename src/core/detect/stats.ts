// Run stats that aren't steps: precrafts, food, wood, pearls on the way, blaze bed explosives, zero setup and the
// bastion trade overview. Only what the replay records directly
import type { Side } from "./findings";
import type { DragonFight } from "./end";
import { Run } from "./run";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const add = (d: Record<string, number>, k: string, n: number) => { d[k] = (d[k] ?? 0) + n; };

// ---- precrafts

/** What a precraft makes. Gold ingots from blocks, planks, sticks, tables and boats are just crafting */
const PRECRAFT = /_bed$|_wool$|^respawn_anchor$|^glowstone$|^iron_(axe|sword)$|^golden_pickaxe$|^bow$|^arrow$|^nether_bricks$|^ender_eye$|^fire_charge$/;
/** Needs one of these to count as a precraft, not just eyes or blocks */
const PRECRAFT_KEY = /_bed$|_wool$|^respawn_anchor$|^glowstone$|^iron_(axe|sword)$|^bow$/;
export type PrecraftKind = "bastion" | "fort" | "stronghold";
export const PRECRAFT_LABEL: Record<PrecraftKind, string> = { bastion: "Bastion precraft", fort: "Fort precraft", stronghold: "Stronghold precraft" };
export interface Precraft { kind: PrecraftKind; t0: number; t1: number; /** Seconds in crafting screens */ secs: number; items: Record<string, number> }

/** Crafting screen sessions after the bastion that made run items, grouped when under 20 s apart. Bastion precraft is
 * from entering the bastion to the fortress (or blind), fort precraft from the fortress to blind, stronghold after blind */
export function precrafts(s: Side): Precraft[] {
  const r = s.run, b = r.mark("bastion");
  if (b === undefined) return [];
  const f = r.mark("fortress"), bl = r.mark("blind"), end = r.mark("end") ?? r.end;
  const kindAt = (t: number): PrecraftKind | null =>
    t < b || t >= end ? null : bl !== undefined && t >= bl ? "stronghold" : f !== undefined && t >= f && (r.mark("bastion")! < f) ? "fort" : "bastion";
  // Crafted steps already leave out what you picked up with the screen open
  const crafts = s.steps.filter((x) => x.kind === "craft" && x.text.startsWith("Crafted"));
  const out: Precraft[] = [];
  for (const c of crafts) {
    const kind = kindAt(c.t0);
    if (!kind) continue;
    const items: Record<string, number> = {};
    for (const [it, n] of Object.entries(craftedItems(r, c.t0, c.t1))) if (PRECRAFT.test(it) && n > 0) items[it] = n;
    if (!Object.keys(items).length) continue;
    const last = out.at(-1);
    if (last && last.kind === kind && c.t0 - last.t1 <= 400) {
      last.t1 = Math.max(last.t1, c.t1); last.secs += (c.t1 - c.t0) / 20;
      for (const [it, n] of Object.entries(items)) add(last.items, it, n);
    } else out.push({ kind, t0: c.t0, t1: c.t1, secs: (c.t1 - c.t0) / 20, items });
  }
  return out.filter((p) => Object.keys(p.items).some((it) => PRECRAFT_KEY.test(it)));
}

/** What a crafting screen made: inventory gains minus what you picked up while it was open */
function craftedItems(r: Run, t0: number, t1: number): Record<string, number> {
  const d = { ...r.invDelta(t0, t1) };
  for (const p of r.actions) if (p.kind === "pickup" && p.item && p.t0 >= t0 && p.t0 <= t1 + 1) d[p.item] = (d[p.item] ?? 0) - (p.count ?? 1);
  return d;
}

// ---- food

const FOODS = new Set(["apple", "baked_potato", "beef", "beetroot", "beetroot_soup", "bread", "carrot", "chicken", "chorus_fruit", "cod", "cooked_beef",
  "cooked_chicken", "cooked_cod", "cooked_mutton", "cooked_porkchop", "cooked_rabbit", "cooked_salmon", "cookie", "dried_kelp", "enchanted_golden_apple",
  "golden_apple", "golden_carrot", "honey_bottle", "melon_slice", "mushroom_stew", "mutton", "poisonous_potato", "porkchop", "potato", "pufferfish",
  "pumpkin_pie", "rabbit", "rabbit_stew", "rotten_flesh", "salmon", "spider_eye", "suspicious_stew", "sweet_berries", "tropical_fish"]);
export interface Meal { t: number; item: string | null; /** Hunger points it gave */ hunger: number }

/** Each time you ate and what. The food leaves the inventory up to a few ticks after hunger goes up */
export function meals(r: Run): Meal[] {
  return r.actions.filter((a) => a.kind === "eat").map((a) => {
    let item: string | null = null;
    const before = r.invAt(a.t1 - 5);
    for (let t = a.t1 - 4; t <= a.t1 + 12 && !item; t++) {
      const now = r.invAt(t);
      item = [...before.entries()].find(([k, n]) => FOODS.has(k) && (now.get(k) ?? 0) < n)?.[0] ?? null;
    }
    return { t: a.t1, item, hunger: a.amount ?? 0 };
  });
}

/** Total food you were carrying (count of food items) */
export const foodCarried = (r: Run, t: number) => sum([...r.invAt(t).entries()].filter(([k]) => FOODS.has(k)).map(([, n]) => n));

// ---- overworld wood

/** Logs and leaves you picked up in the Overworld before the Nether */
export function woodGrabbed(r: Run): { logs: number; leaves: number } {
  const end = r.mark("nether") ?? r.end;
  let logs = 0, leaves = 0;
  for (const a of r.actions) {
    if (a.kind !== "pickup" || a.t0 >= end || a.w !== 0 || !a.item) continue;
    if (/_log$|_wood$|_stem$|_hyphae$/.test(a.item)) logs += a.count ?? 1;
    else if (/_leaves$/.test(a.item)) leaves += a.count ?? 1;
  }
  return { logs, leaves };
}

// ---- pearls on the way

/** Pearls thrown in [t0, t1) */
export const pearlsThrown = (r: Run, t0: number, t1: number) => r.actions.filter((a) => a.kind === "pearl" && a.t0 >= t0 && a.t0 < t1).map((a) => a.t0);

// ---- blaze bed

export interface Blast { t: number; what: "bed" | "tnt" }
/** Beds (power 5) and TNT (power 4) you set off in the Nether from entering the fortress to blind. Respawn anchors
 * don't blow up in the Nether, so power 5 there is a bed */
export function blazeBedBlasts(s: Side): Blast[] {
  const r = s.run, f = r.mark("fortress");
  if (f === undefined) return [];
  const until = Math.min(r.mark("blind") ?? Infinity, r.mark("end") ?? Infinity, r.end);
  return s.facts.explosions.filter((x) => x.w === 1 && x.t >= f && x.t < until && (x.power === 5 || x.power === 4) && x.near)
    .map((x) => ({ t: x.t, what: x.power === 5 ? "bed" : "tnt" }));
}

/** "2 beds", "1 bed 1 tnt", "3 tnt" */
export function blastText(bs: Blast[]): string {
  const beds = bs.filter((b) => b.what === "bed").length, tnt = bs.length - beds;
  return [beds ? `${beds} bed${beds > 1 ? "s" : ""}` : "", tnt ? `${tnt} tnt` : ""].filter(Boolean).join(" ") || "none";
}

// ---- zero cycle setup

export interface ZeroSetup {
  /** First bed or anchor blast in the End */
  first: number;
  /** Height of the blast and where you stood */
  bedY: number;
  youY: number;
  /** At the fountain (portal at 0,0), out on a diagonal, or elsewhere */
  where: "fountain" | "diagonal" | "other";
  /** Blocks out from the fountain */
  out: number;
  /** The End spawn platform is at x 100, so x > 0 is the spawn side */
  side: "spawn side" | "far side";
  /** Last block you placed within 8 blocks of the first blast, before it */
  setupDone: number | null;
}

export function zeroSetup(s: Side, f: DragonFight | null): ZeroSetup | null {
  if (!f || !f.beds.length) return null;
  const r = s.run, first = f.beds[0];
  const ex = s.facts.explosions.find((x) => x.w === 2 && x.power === 5 && x.t === first);
  if (!ex?.pos) return null;
  const [x, y, z] = ex.pos, me = r.posAt(first);
  const out = Math.hypot(x, z), angle = Math.abs(Math.atan2(z, x) * 180 / Math.PI);
  const diag = Math.min(Math.abs(angle - 45), Math.abs(angle - 135)) <= 15;
  const where = out <= 4 ? "fountain" : diag && out >= 30 ? "diagonal" : "other";
  const near = r.actions.filter((a) => a.kind === "place" && a.w === 2 && a.t0 >= f.start && a.t0 < first && a.at && !/_bed$/.test(a.what ?? "")
    && Math.hypot(a.at[0] + 0.5 - x, a.at[1] + 0.5 - y, a.at[2] + 0.5 - z) <= 8);
  return { first, bedY: Math.round(y), youY: Math.round(me.y), where, out: Math.round(out), side: x > 0 ? "spawn side" : "far side", setupDone: near.at(-1)?.t0 ?? null };
}

/** "diagonal 41 out, spawn side, beds at y100, standing at y95" */
export function zeroText(z: ZeroSetup): string {
  const place = z.where === "fountain" ? "at the fountain" : z.where === "diagonal" ? `diagonal ${z.out} out, ${z.side}` : `${z.out} blocks out, ${z.side}`;
  return `${place}, beds at y${z.bedY}, standing at y${z.youY}`;
}

// ---- bastion trades

/** Items worth tracking from barters */
export const TRADE_ITEMS = ["ender_pearl", "obsidian", "crying_obsidian", "string", "fire_res", "fire_charge", "glowstone_dust"] as const;
export type TradeItem = (typeof TRADE_ITEMS)[number];
export const TRADE_NAME: Record<TradeItem, string> = {
  ender_pearl: "pearls", obsidian: "obsidian", crying_obsidian: "crying obsidian", string: "string", fire_res: "fire res", fire_charge: "fire charges", glowstone_dust: "glowstone dust",
};
const tradeKey = (it: string): TradeItem | null => (it === "potion" || it === "splash_potion" ? "fire_res" : (TRADE_ITEMS as readonly string[]).includes(it) ? (it as TradeItem) : null);

export interface Barter { t: number; items: Record<string, number> }
export interface TradeSummary {
  barters: Barter[];
  /** Tracked items you picked up from barters, and ones you left on the ground */
  got: Partial<Record<TradeItem, number>>;
  left: Partial<Record<TradeItem, number>>;
  /** What you had of each when you left, and used for the rest of the run */
  leftWith: Partial<Record<TradeItem, number>>;
  used: Partial<Record<TradeItem, number>>;
  /** The trade that covered everything you used (counting what you brought and chests), or null if trades never did */
  needed: { n: number; t: number } | null;
  /** You had what you used before trading at all */
  noneNeeded: boolean;
  /** Each time you picked up a tracked item from barter drops, with your running total of it from barters */
  pickups: { t: number; item: TradeItem; total: number }[];
}

/** Barters in the bastion, and how much of each item you picked up from barter drops before leaving (+10 s).
 * - Drops show up when the piglin finishes, or when they come into view if you're away (within 2 s)
 * - The same item merges into one stack on the ground, so one pickup can carry several barters' worth
 * - A stack that doesn't fit is taken in part with no pickup record, the stack just shrinks
 * - Merging moves items between stacks in one tick: one is removed or shrinks and another grows by as much. A stack
 *   going out of view is removed too, with nothing growing. So per tick, shrinking that growth doesn't account for
 *   (after removals) is what you took */
export function barters(r: Run): { list: Barter[]; picked: Record<string, number>; picks: { t: number; item: string; n: number }[] } {
  const b = r.mark("bastion"), l = r.mark("bastion_left");
  const list: Barter[] = [], picked: Record<string, number> = {}, picks: { t: number; item: string; n: number }[] = [];
  if (b === undefined || l === undefined) return { list, picked, picks };
  const take = (t: number, item: string, n: number) => { add(picked, item, n); picks.push({ t, item, n }); };
  const pending: { t: number; items: string[] }[] = [];
  // Barter drop stacks on the ground: item and count (the top bit of the count is a flag)
  const drops = new Map<number, { item: string; n: number }>();
  const count = (n: number | undefined) => (n ?? 1) & 127;
  // Per item this tick: stacks growing, shrinking and removed without a pickup record
  let tick = -1, grew: Record<string, number> = {}, shrank: Record<string, number> = {}, removed: Record<string, number> = {};
  const settle = () => {
    if (tick <= l + 200) for (const [it, sh] of Object.entries(shrank)) {
      const fromShrinking = Math.max(0, (grew[it] ?? 0) - (removed[it] ?? 0));
      if (sh > fromShrinking) take(tick, it, sh - fromShrinking);
    }
    grew = {}; shrank = {}; removed = {};
  };
  for (const e of r.events) {
    if (e.t !== tick) { settle(); tick = e.t; }
    if (e.type === "PIGLIN_BARTER" && e.t >= b && e.t <= l) {
      const items: Record<string, number> = {};
      for (const [it, n] of e.items ?? []) add(items, it, n);
      list.push({ t: e.t, items });
      pending.push({ t: e.t, items: (e.items ?? []).map(([it]) => it) });
    } else if (e.type === "ITEM_ENTITY") {
      const d = drops.get(e.id!);
      if (d) { const c = count(e.count) - d.n; if (c > 0) add(grew, d.item, c); else if (c < 0) add(shrank, d.item, -c); d.n = count(e.count); continue; }
      const p = pending.find((x) => e.t - x.t >= 0 && e.t - x.t <= 40 && x.items.includes(e.item!));
      if (p) { p.items.splice(p.items.indexOf(e.item!), 1); drops.set(e.id!, { item: e.item!, n: count(e.count) }); }
    } else if (e.type === "ITEM_PICKUP" && e.collector === -2 && drops.has(e.id!)) {
      const d = drops.get(e.id!)!;
      if (e.t <= l + 200) take(e.t, d.item, e.count ?? 1);
      d.n = Math.max(0, d.n - (e.count ?? 1));
    } else if (e.type === "ENTITY_REMOVE" && drops.has(e.id!)) {
      // Gone without a pickup: merged into another stack or out of view
      const d = drops.get(e.id!)!;
      add(removed, d.item, d.n);
      drops.delete(e.id!);
    }
  }
  settle();
  return { list, picked, picks };
}

/** Items you used after leaving the bastion: pearls thrown, fire res drunk or thrown, obsidian and crying obsidian placed
 * or crafted away, string crafted into wool */
export function usedAfter(r: Run, from: number): Partial<Record<TradeItem, number>> {
  const out: Partial<Record<TradeItem, number>> = {};
  const deaths = r.actions.filter((a) => a.kind === "death").map((a) => a.t0);
  const nearDeath = (t: number) => deaths.some((d) => t >= d - 5 && t <= d + 60);
  out.ender_pearl = r.actions.filter((a) => a.kind === "pearl" && a.t0 >= from).length;
  out.obsidian = r.actions.filter((a) => a.kind === "place" && a.what === "obsidian" && a.t0 >= from).length;
  // Crafting screens: what went down while open (crying obsidian into anchors, string into wool)
  const screens = r.actions.filter((a) => (a.kind === "craft" || a.kind === "inventory") && a.t0 >= from);
  const spent = (it: string) => sum(screens.map((a) => Math.max(0, -(a.delta?.[it] ?? 0))));
  out.crying_obsidian = spent("crying_obsidian") + r.actions.filter((a) => a.kind === "place" && a.what === "crying_obsidian" && a.t0 >= from).length;
  out.string = spent("string");
  out.fire_charge = 0;
  // Potions leave the inventory when drunk or thrown, outside screens and deaths
  let fr = 0, prev = potions(r, from);
  for (let t = from + 1; t <= r.end; t += 2) {
    const n = potions(r, t);
    if (n < prev && !nearDeath(t) && !screens.some((a) => t >= a.t0 && t <= a.t1 + 2)) fr += prev - n;
    prev = n;
  }
  out.fire_res = fr;
  return out;
}
const potions = (r: Run, t: number) => { const c = r.invAt(t); return (c.get("potion") ?? 0) + (c.get("splash_potion") ?? 0); };
const have = (r: Run, t: number, k: TradeItem) => (k === "fire_res" ? potions(r, t) : r.invAt(t).get(k) ?? 0);

export function tradeSummary(r: Run): TradeSummary | null {
  const b = r.mark("bastion"), l = r.mark("bastion_left");
  if (b === undefined || l === undefined) return null;
  const { list: bs, picked, picks } = barters(r);
  const running: Record<string, number> = {};
  const pickups: TradeSummary["pickups"] = [];
  for (const p of picks) { const k = tradeKey(p.item); if (k) { add(running, k, p.n); pickups.push({ t: p.t, item: k, total: running[k] }); } }
  if (!bs.length) return null;
  const total: Record<string, number> = {};
  for (const x of bs) for (const [it, n] of Object.entries(x.items)) add(total, it, n);
  const got: Partial<Record<TradeItem, number>> = {}, left: Partial<Record<TradeItem, number>> = {};
  for (const [it, n] of Object.entries(total)) {
    const k = tradeKey(it);
    if (!k) continue;
    const p = Math.min(n, picked[it] ?? 0);
    if (p) add(got, k, p);
    if (n - p) add(left, k, n - p);
  }
  const leftWith: Partial<Record<TradeItem, number>> = {};
  for (const k of TRADE_ITEMS) leftWith[k] = have(r, l + 1, k);
  const usedAll = usedAfter(r, l);
  // Only what you left with can have come from here
  const used: Partial<Record<TradeItem, number>> = {};
  for (const k of TRADE_ITEMS) used[k] = Math.min(usedAll[k] ?? 0, leftWith[k] ?? 0);
  // From what you left with, take barters off the end while what's left still covers what you used. Drops left on
  // the ground were the last ones, so those come off first without costing you anything
  const remaining: Record<string, number> = {}, unpicked: Record<string, number> = {};
  for (const k of TRADE_ITEMS) { remaining[k] = leftWith[k] ?? 0; unpicked[k] = left[k] ?? 0; }
  const enough = (r: Record<string, number>) => TRADE_ITEMS.every((k) => r[k] >= (used[k] ?? 0));
  let kept = bs.length;
  for (; kept > 0; kept--) {
    const next = { ...remaining }, nextUnpicked = { ...unpicked };
    for (const [it, c] of Object.entries(bs[kept - 1].items)) {
      const k = tradeKey(it);
      if (!k) continue;
      const off = Math.min(c, nextUnpicked[k]);
      nextUnpicked[k] -= off;
      next[k] -= c - off;
    }
    if (!enough(next)) break;
    Object.assign(remaining, next); Object.assign(unpicked, nextUnpicked);
  }
  if (!kept) return { barters: bs, got, left, leftWith, used, needed: null, noneNeeded: true, pickups };
  const needed = enough(remaining) ? { n: kept, t: bs[kept - 1].t } : null;
  return { barters: bs, got, left, leftWith, used, needed, noneNeeded: false, pickups };
}

/** "7b 3a 32 pearls 5 fres": string as beds (12 each), crying obsidian as anchors (6 each) */
export function kitText(k: Partial<Record<TradeItem, number>>): string {
  const beds = Math.floor((k.string ?? 0) / 12), anchors = Math.floor((k.crying_obsidian ?? 0) / 6);
  return [beds ? `${beds}b` : "", anchors ? `${anchors}a` : "", `${k.ender_pearl ?? 0} pearls`, k.fire_res ? `${k.fire_res} fres` : "", k.obsidian ? `${k.obsidian} obsidian` : ""].filter(Boolean).join(" ");
}

/** What their extra barters gave, since everyone on a seed gets the same barters in the same order */
export function extraBarters(mine: Barter[], theirs: Barter[]): Partial<Record<TradeItem, number>> {
  const out: Partial<Record<TradeItem, number>> = {};
  for (const x of theirs.slice(mine.length)) for (const [it, n] of Object.entries(x.items)) { const k = tradeKey(it); if (k) add(out, k, n); }
  return out;
}

export const itemsText = (d: Partial<Record<TradeItem, number>>, keys: readonly TradeItem[] = TRADE_ITEMS) =>
  keys.filter((k) => (d[k] ?? 0) > 0).map((k) => `${d[k]} ${TRADE_NAME[k]}`).join(", ");
