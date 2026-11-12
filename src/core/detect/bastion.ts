import { ACTIVITIES, type Activity } from "./activity";
import { enoughAt, wantedGoals, type LeaveGoals, type Side } from "./findings";
import { Run, type Action } from "./run";

const SPLIT = [
  "gold",
  "loot",
  "craft",
  "mine",
  "fight",
  "build",
  "move",
  "menus",
  "eat",
  "wait",
] as const;
export type SplitKey = (typeof SPLIT)[number];
export const SPLIT_LABEL: Record<SplitKey, string> = {
  gold: "Mining gold",
  loot: "Looting chests",
  craft: "Crafting",
  mine: "Mining other blocks",
  fight: "Fighting",
  build: "Placing blocks",
  move: "Moving",
  menus: "Inventory and menus",
  eat: "Eating",
  wait: "Waiting",
};
export interface Split {
  t0: number;
  t1: number;
  secs: Partial<Record<SplitKey, number>>;
}

const MENU_ACTIVITIES: Activity[] = ["inventory", "screen", "chest", "craft", "furnace"];
/** Piglins need a moment to walk to thrown gold and pick it up */
const PIGLIN_PICKUP_TICKS = 40;
const DEFAULT_ADMIRE_TICKS = 119;

/** Ticks from entering to leaving the bastion, or null without both marks */
export function bastionSpan(r: Run): [number, number] | null {
  const b = r.mark("bastion");
  const l = r.mark("bastion_left");
  return b === undefined || l === undefined ? null : [b, l];
}

/** A mined block counts as loot when the mining finishes */
function mineAsLoot(a: Action): Action {
  return a.kind === "mine" ? { ...a, t0: a.t1, delta: { [a.item!]: a.count ?? 1 } } : a;
}

function activityKey(act: Activity): SplitKey {
  if (act === "mining") {
    return "mine";
  }
  if (act === "fighting" || act === "dead") {
    return "fight";
  }
  if (act === "placing") {
    return "build";
  }
  if (act === "pearl" || act === "walking") {
    return "move";
  }
  if (act === "eating") {
    return "eat";
  }
  if (MENU_ACTIVITIES.includes(act)) {
    return "menus";
  }
  return "wait";
}

/** What someone was doing on each tick of [t0, t1) */
export function split(s: Side, t0: number, t1: number): Split {
  const secs: Partial<Record<SplitKey, number>> = {};
  const stepCovers = (t: number, pred: (x: Side["steps"][number]) => boolean) =>
    s.steps.some((x) => x.t0 <= t && x.t1 >= t && pred(x));
  const chests = s.run.actions.filter((a) => a.kind === "chest" && a.t1 >= t0 && a.t0 < t1);
  for (let t = Math.max(0, t0); t < t1 && t < s.tl.act.length; t++) {
    const act = ACTIVITIES[s.tl.act[t]];
    let k: SplitKey;
    if (
      act === "mining" &&
      stepCovers(t, (x) => x.kind === "mine" && /gold|gilded/i.test(x.text))
    ) {
      k = "gold";
    } else if (chests.some((a) => a.t0 <= t && a.t1 >= t)) {
      k = "loot";
    } else if (stepCovers(t, (x) => x.kind === "craft")) {
      k = "craft";
    } else {
      k = activityKey(act);
    }
    secs[k] = (secs[k] ?? 0) + 1 / 20;
  }
  return { t0, t1, secs };
}

interface TradeView {
  /** First gold thrown in the bastion */
  start: number;
  enough: number | null;
  left: number;
  /** The last needed trade */
  done: number;
  during: Split;
  after: Split;
}

export function tradeView(s: Side, goals: LeaveGoals): TradeView | null {
  const r = s.run;
  const span = bastionSpan(r);
  if (!span) {
    return null;
  }
  const [b, l] = span;
  const start = s.facts.goldThrown.find((g) => g.t >= b && g.t <= l)?.t;
  if (start === undefined) {
    return null;
  }
  const enough = enoughAt(r, goals);
  const end = Math.min(enough ?? l, tradesDone(r, goals)?.t ?? l);
  return {
    start,
    enough,
    left: l,
    done: end,
    during: split(s, start, end),
    after: split(s, end, l),
  };
}

/** Chests they looted for stuff you need that you never opened */
export function missedChests(Y: Side, T: Side, goals: LeaveGoals) {
  const span = bastionSpan(T.run);
  if (!span) {
    return [];
  }
  const [tb, tl] = span;
  const mine = Y.run.actions.filter((a) => a.kind === "chest" && a.at);
  const want = wantedGoals(goals).map(([k]) => k);
  return T.run.actions
    .filter((a) => a.kind === "chest" && a.at && a.t0 >= tb && a.t0 <= tl)
    .filter(
      (a) =>
        !mine.some(
          (m) => Math.hypot(m.at![0] - a.at![0], m.at![1] - a.at![1], m.at![2] - a.at![2]) <= 2,
        ),
    )
    .map((a) => ({
      t: a.t0,
      secs: (a.t1 - a.t0) / 20,
      at: a.at!,
      got: Object.fromEntries(
        want.map((k) => [k, Math.max(0, a.delta?.[k] ?? 0)]).filter(([, n]) => (n as number) > 0),
      ) as Record<string, number>,
    }))
    .filter((c) => Object.keys(c.got).length);
}

/** Pearl hang = pearl leaves loaded chunks without teleporting you, then you teleport later with no pearl in the air. Hang time is throw to tp */
export function pearlHangs(r: Run): { thrown: number; landed: number }[] {
  const out: { thrown: number; landed: number }[] = [];
  const flights = new Map<number, { thrown: number; lastMove: number; maxGap: number }>();
  const pending: number[] = [];
  const ended: { t: number; thrown: number }[] = [];
  for (const e of r.events) {
    if (e.type === "PROJECTILE" && e.entity === "ender_pearl") {
      flights.set(e.id!, { thrown: e.t, lastMove: e.t, maxGap: 0 });
    } else if (e.id !== undefined && flights.has(e.id) && e.pos) {
      const f = flights.get(e.id)!;
      f.maxGap = Math.max(f.maxGap, e.t - f.lastMove);
      f.lastMove = e.t;
    } else if (e.type === "ENTITY_REMOVE" && flights.has(e.id!)) {
      const f = flights.get(e.id!)!;
      f.maxGap = Math.max(f.maxGap, e.t - f.lastMove);
      ended.push({ t: e.t, thrown: f.thrown });
      flights.delete(e.id!);
      // A pearl stuck in unloaded chunks stops sending positions, then sends ENTITY_REMOVE when it reloads and teleports you
      if (e.t - f.thrown >= 140 && f.maxGap >= 80) {
        const a = r.posAt(Math.max(0, e.t - 2));
        const b = r.posAt(e.t + 2);
        if (a.w === b.w && Math.hypot(b.x - a.x, b.z - a.z) >= 8) {
          out.push({ thrown: f.thrown, landed: e.t });
        }
      }
    }
  }
  // Pearl ended and you're still where you were, so it's hanging
  for (const p of ended) {
    if (out.some((h) => h.thrown === p.thrown)) {
      continue;
    }
    const a = r.posAt(p.t - 1);
    const b = r.posAt(p.t + 30);
    if (a.w === b.w && Math.hypot(b.x - a.x, b.z - a.z) < 3) {
      pending.push(p.thrown);
    }
  }
  const tr = r.track;
  for (let i = 1; i < tr.length && pending.length; i++) {
    const a = tr[i - 1];
    const b = tr[i];
    if (a.w !== b.w || b.t - a.t > 2 || Math.hypot(b.x - a.x, b.z - a.z) < 8) {
      continue;
    }
    if (
      ended.some((p) => Math.abs(p.t - b.t) <= 3) ||
      [...flights.values()].some((f) => f.thrown <= b.t)
    ) {
      continue;
    }
    const thrown = pending.filter((t0) => t0 < b.t - 60).at(-1);
    if (thrown !== undefined) {
      out.push({ thrown, landed: b.t });
      pending.splice(pending.indexOf(thrown), 1);
    }
  }
  return out.sort((a, b) => a.thrown - b.thrown);
}

/** When you'd have had everything with `pigs` piglins at once, from your real gold throws, the seed's barter order
 * (the same for everyone on a Ranked seed) and measured admire time. `extra` is items from elsewhere (chests) */
export function simulateTrades(
  s: Side,
  goals: LeaveGoals,
  pigs: number,
  extra: Record<string, number> = {},
): number | null {
  const span = bastionSpan(s.run);
  if (!span) {
    return null;
  }
  const [b, l] = span;
  const target = tradesDone(s.run, goals, extra);
  if (target === null) {
    return null;
  }
  const need = target.barters;
  const spans = s.facts.pigSpans
    .filter((p) => p.state === 4 && p.t0 >= b && p.t1 <= l)
    .map((p) => p.t1 - p.t0)
    .sort((x, y) => x - y);
  const admire = spans.length ? spans[spans.length >> 1] : DEFAULT_ADMIRE_TICKS;
  const gold: number[] = [];
  for (const g of s.facts.goldThrown.filter((g) => g.t >= b && g.t <= l)) {
    for (let i = 0; i < g.count; i++) {
      gold.push(g.t);
    }
  }
  const freeAt = Array.from({ length: Math.max(1, pigs) }, () => 0);
  let done = b;
  for (let i = 0; i < need; i++) {
    if (i >= gold.length) {
      return null;
    }
    freeAt.sort((x, y) => x - y);
    const t = Math.max(freeAt[0], gold[i] + PIGLIN_PICKUP_TICKS);
    done = t + admire;
    freeAt[0] = done;
  }
  return done;
}

/** The barter that completed what you need to leave, counting what you brought, chests and all barter drops so far
 * (picked up or not). Loot sits on the ground so this can be well before your inventory shows it */
export function tradesDone(
  r: Run,
  goals: LeaveGoals,
  extra: Record<string, number> = {},
): { t: number; barters: number; last: string | null } | null {
  const span = bastionSpan(r);
  if (!span) {
    return null;
  }
  const [b, l] = span;
  const items = wantedGoals(goals);
  const start = r.invAt(b);
  const have: Record<string, number> = {};
  for (const [it] of items) {
    have[it] = (start.get(it) ?? 0) + (extra[it] ?? 0);
  }
  // Loot is chests plus mined blocks such as bucket obsidian and string from cobwebs.
  const loot = r.actions
    .filter(
      (a) =>
        (a.kind === "chest" || (a.kind === "mine" && items.some(([it]) => it === a.item))) &&
        a.t0 >= b &&
        a.t0 <= l,
    )
    .map(mineAsLoot)
    .sort((x, y) => x.t0 - y.t0);
  const add = (a: Action) => {
    for (const [it] of items) {
      have[it] += Math.max(0, a.delta?.[it] ?? 0);
    }
  };
  const haveAll = () => items.every(([it, g]) => have[it] >= g);
  if (haveAll()) {
    return { t: b, barters: 0, last: null };
  }
  let li = 0;
  let barters = 0;
  for (const a of r.actions.filter((x) => x.kind === "barter" && x.t0 >= b && x.t0 <= l)) {
    while (li < loot.length && loot[li].t0 <= a.t0) {
      add(loot[li]);
      li++;
    }
    barters++;
    const missing = items.filter(([it, g]) => have[it] < g).map(([it]) => it);
    add(a);
    if (haveAll()) {
      return { t: a.t0, barters, last: missing[0] ?? null };
    }
  }
  return null;
}

/** Count of an item from non-barter sources (brought in, chests) by tick t, plus what chests gave after */
export function outsideBarters(r: Run, item: string, t: number) {
  const span = bastionSpan(r);
  if (!span) {
    return { by: 0, later: [] as { t: number; n: number; how: string }[] };
  }
  const [b, l] = span;
  const loot = r.actions
    .filter(
      (a) =>
        a.t0 >= b &&
        a.t0 <= l &&
        ((a.kind === "chest" && (a.delta?.[item] ?? 0) > 0) ||
          (a.kind === "mine" && a.item === item)),
    )
    .map(mineAsLoot);
  return {
    by:
      (r.invAt(b).get(item) ?? 0) +
      loot.filter((a) => a.t0 <= t).reduce((s, a) => s + a.delta![item], 0),
    later: loot
      .filter((a) => a.t0 > t)
      .map((a) => ({ t: a.t0, n: a.delta![item], how: a.kind === "mine" ? "mined" : "looted" })),
  };
}
