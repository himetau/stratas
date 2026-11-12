import { ACTIVITIES, ACTIVITY_LABEL, type ActivityTimeline } from "./activity";
import { PIG, SAMPLE } from "./facts";
import { outsideBarters, split, SPLIT_LABEL, tradesDone, type SplitKey } from "./bastion";
import { enoughAt, type LeaveGoals, type Side, type Span } from "./findings";
import { fmtDur, fmtTime } from "./names";
import { dragonFight, endParts } from "./end";
import { itemName, listItems, STEP_LABEL, type StepKind } from "./steps";
import { overworldCrafts, pearlsThrown } from "./stats";

/** Where to look in the replay, your time and theirs */
export interface At {
  you?: number;
  them?: number;
}
export interface Part {
  key: string;
  label: string;
  seconds: number;
  text: string;
  at?: At;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const lc = (s: string) => s[0].toLowerCase() + s.slice(1);

/** Start of the longest run of ticks in [t0, t1) where `on` is true */
function longest(t0: number, t1: number, on: (t: number) => boolean): number | undefined {
  let best = 0;
  let at: number | undefined;
  let run = -1;
  for (let t = t0; t <= t1; t++) {
    if (t < t1 && on(t)) {
      if (run < 0) {
        run = t;
      }
      if (t - run + 1 > best) {
        best = t - run + 1;
        at = run;
      }
    } else {
      run = -1;
    }
  }
  return at;
}

interface BastionTime {
  b: number;
  l: number;
  first: number;
  done: number;
  pre: number;
  stall: number;
  barters: number;
  usual: number;
  stallWhy: { angry: number; noGold: number };
  stuck: { n: number; t0: number; t1: number } | null;
  longestStall: number | null;
  /** Item the last needed trade completed */
  decider: string | null;
}

/** Start of the longest stretch of samples with no piglin bartering */
function longestStallStart(smp: { t: number; barter: number }[]): number | null {
  let start: number | null = null;
  let run0 = -1;
  let best = 0;
  for (const x of smp) {
    if (x.barter !== 0) {
      run0 = -1;
      continue;
    }
    if (run0 < 0) {
      run0 = x.t;
    }
    if (x.t - run0 > best) {
      best = x.t - run0;
      start = run0;
    }
  }
  return start;
}

/** Piglins seeking gold for 10 s or more while you traded, when at least two got stuck */
function stuckPiglins(s: Side, first: number, done: number): BastionTime["stuck"] {
  const seekers = s.facts.pigSpans.filter(
    (p) => p.state === PIG.SEEKING && p.t1 - p.t0 >= 200 && p.t1 > first && p.t0 < done,
  );
  const ids = new Set(seekers.map((p) => p.id));
  if (ids.size < 2) {
    return null;
  }
  return {
    n: ids.size,
    t0: Math.max(first, Math.min(...seekers.map((p) => p.t0))),
    t1: Math.min(done, Math.max(...seekers.map((p) => p.t1))),
  };
}

function bastionTime(s: Side, goals: LeaveGoals): BastionTime | null {
  const r = s.run;
  const b = r.mark("bastion");
  const l = r.mark("bastion_left");
  if (b === undefined || l === undefined) {
    return null;
  }
  const enough = enoughAt(r, goals) ?? l;
  // Trades are done at the barter that completed everything, and pickup comes after.
  const td = tradesDone(r, goals);
  const done = Math.min(enough, td?.t ?? enough);
  const first = Math.min(done, s.facts.goldThrown.find((g) => g.t >= b)?.t ?? done);
  const smp = s.facts.samples(first, done);
  const busy = smp.filter((x) => x.barter > 0);
  const idle = smp.filter((x) => x.barter === 0);
  const sampleSecs = SAMPLE / 20;
  const stallWhy = { angry: 0, noGold: 0 };
  for (const x of idle) {
    if (x.angry >= 3) {
      stallWhy.angry += sampleSecs;
    } else if (x.ground <= 0) {
      stallWhy.noGold += sampleSecs;
    }
  }
  const barters =
    td?.barters ??
    r.actions.filter((a) => a.kind === "barter" && a.t0 >= b && a.t0 <= enough).length;
  const sorted = busy.map((x) => x.barter).sort((p, q) => p - q);
  return {
    b,
    l,
    first,
    done,
    pre: (first - b) / 20,
    stall: idle.length * sampleSecs,
    barters,
    usual: sorted.length ? sorted[sorted.length >> 1] : 0,
    stallWhy,
    stuck: stuckPiglins(s, first, done),
    longestStall: longestStallStart(smp),
    decider: td?.last ?? null,
  };
}

/** First gold thrown to the trade that completed what you need */
function tradingPart(Y: Side, T: Side, y: BastionTime, t: BastionTime): Part {
  const ty = (y.done - y.first) / 20;
  const tt = (t.done - t.first) / 20;
  let text = `${fmtDur(ty)} vs ${fmtDur(tt)} · ${y.usual} vs ${t.usual} piglins at once`;
  if (y.stuck) {
    text += ` · ${y.stuck.n} piglins stuck on gold ${fmtTime(y.stuck.t0)}–${fmtTime(y.stuck.t1)}`;
  }
  if (Math.abs(y.stall - t.stall) >= 5) {
    const why = [
      y.stallWhy.angry >= 3 ? `piglins angry ${fmtDur(y.stallWhy.angry)}` : "",
      y.stallWhy.noGold >= 3 ? `no gold on the ground ${fmtDur(y.stallWhy.noGold)}` : "",
    ]
      .filter(Boolean)
      .join(", ");
    const yourWait = why && y.stall > t.stall ? ` · your wait: ${why}` : "";
    text += ` · ${fmtDur(y.stall)} vs ${fmtDur(t.stall)} no piglin trading${yourWait}`;
  }
  if (y.barters !== t.barters) {
    // Everyone on a seed gets the same trades in the same order, so a different count comes from chests.
    text += ` · ${y.barters} vs ${t.barters} trades`;
    const it = y.decider;
    if (it) {
      const oy = outsideBarters(Y.run, it, y.done);
      const ot = outsideBarters(T.run, it, t.done);
      const later = oy.later.map((c) => `${c.how} ${c.n} more at ${fmtTime(c.t)}`).join(", ");
      text += ` · ${oy.by} vs ${ot.by} ${itemName(it)} from chests or mining`;
      text += oy.later.length ? ` · you ${later}` : "";
    }
  }
  let where = y.first;
  if (y.stuck) {
    where = y.stuck.t0;
  } else if (y.stall - t.stall >= 5) {
    where = y.longestStall ?? y.first;
  }
  return {
    key: "trading",
    label: "Trading",
    seconds: ty - tt,
    text,
    at: { you: where, them: t.first },
  };
}

/** That trade to leaving the bastion: pickup, finishing off and walking out */
function afterTradingPart(Y: Side, y: BastionTime, t: BastionTime): Part {
  const ay = (y.l - y.done) / 20;
  const af = (t.l - t.done) / 20;
  const doing = (Object.entries(split(Y, y.done, y.l).secs) as [SplitKey, number][])
    .filter(([, v]) => v >= 2)
    .sort((p, q) => q[1] - p[1])
    .slice(0, 3)
    .map(([k, v]) => `${SPLIT_LABEL[k].toLowerCase()} ${fmtDur(v)}`)
    .join(", ");
  return {
    key: "after",
    label: "After trading",
    seconds: ay - af,
    at: { you: y.done, them: t.done },
    text: `${fmtDur(ay)} vs ${fmtDur(af)}${doing ? ` · your ${fmtDur(ay)}: ${doing}` : ""}`,
  };
}

/** Bastion time as entering to first throw, trading, and after trading */
function bastionWhy(Y: Side, T: Side, goals: LeaveGoals): Part[] | null {
  const y = bastionTime(Y, goals);
  const t = bastionTime(T, goals);
  if (!y || !t) {
    return null;
  }
  const firstThrow: Part = {
    key: "pre",
    label: "First throw",
    seconds: y.pre - t.pre,
    at: { you: y.b, them: t.b },
    text: `${fmtDur(y.pre)} vs ${fmtDur(t.pre)} after entering`,
  };
  return [firstThrow, tradingPart(Y, T, y, t), afterTradingPart(Y, y, t)];
}

const WALK = 1 << ACTIVITIES.indexOf("walking");
const PEARL = 1 << ACTIVITIES.indexOf("pearl");
const STOP: Record<string, string> = {
  dead: "Dead",
  fighting: "Fighting",
  eating: "Eating",
  mining: "Mining",
  placing: "Bridging and pillaring",
  chest: "Menus",
  craft: "Menus",
  furnace: "Menus",
  villager: "Menus",
  screen: "Menus",
  inventory: "Menus",
  pie: "Pie chart",
  pickup: "Picking up items",
  drinking: "Drinking",
  aiming: "Aiming a bow",
  portal: "In a portal",
  flight: "Pearl and eye flights",
  trading: "Waiting on trades",
  looking: "Looking around",
  standing: "Idle",
  paused: "Paused",
};

const stopAt = (tl: ActivityTimeline, t: number) => STOP[ACTIVITIES[tl.act[t]]] ?? "Other";

function travelTime(s: Side, sp: [number, number]) {
  const r = s.run;
  const tl = s.tl;
  let moving = 0;
  let dist = 0;
  const stops: Record<string, number> = {};
  // Moving is any tick you were going somewhere, even digging or bridging on the way.
  const moves = (t: number) =>
    (tl.present[t] & (WALK | PEARL)) !== 0 && ACTIVITIES[tl.act[t]] !== "dead";
  for (let t = sp[0]; t < sp[1]; t++) {
    if (moves(t)) {
      moving++;
    } else {
      const g = stopAt(tl, t);
      stops[g] = (stops[g] ?? 0) + 1 / 20;
    }
  }
  const pts = r.slice(sp[0], sp[1]);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a.w !== b.w || !moves(a.t)) {
      continue;
    }
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    // A pearl can move you about 100 blocks in one step.
    const pearled = ((tl.present[a.t] | tl.present[b.t]) & PEARL) !== 0;
    if (d < 12 || (pearled && d < 120)) {
      dist += d;
    }
  }
  return { moving: moving / 20, dist, stops, pearls: pearlsThrown(r, sp[0], sp[1]).length };
}

function travelWhy(Y: Side, T: Side, ys: [number, number], ts: [number, number]): Part[] {
  const y = travelTime(Y, ys);
  const t = travelTime(T, ts);
  const parts: Part[] = [];
  const vy = y.moving ? y.dist / y.moving : 0;
  const vt = t.moving ? t.dist / t.moving : 0;
  if (vy > 0 && vt > 0) {
    const pearls = y.pearls || t.pearls ? ` · ${y.pearls} vs ${t.pearls} pearls` : "";
    parts.push({
      key: "route",
      label: "Distance",
      seconds: (y.dist - t.dist) / vy,
      at: { you: ys[0], them: ts[0] },
      text: `${Math.round(y.dist)} vs ${Math.round(t.dist)} blocks${pearls}`,
    });
    parts.push({
      key: "speed",
      label: "Speed",
      at: { you: ys[0], them: ts[0] },
      seconds: t.dist / vy - t.dist / vt,
      text: `${vy.toFixed(1)} vs ${vt.toFixed(1)} blocks/s`,
    });
  } else {
    parts.push({
      key: "moving",
      label: "Moving",
      at: { you: ys[0], them: ts[0] },
      seconds: y.moving - t.moving,
      text: `${fmtDur(y.moving)} vs ${fmtDur(t.moving)}`,
    });
  }
  for (const g of new Set([...Object.keys(y.stops), ...Object.keys(t.stops)])) {
    const a = y.stops[g] ?? 0;
    const b = t.stops[g] ?? 0;
    const longestStop = (s: Side, sp: [number, number]) =>
      longest(sp[0], sp[1], (x) => stopAt(s.tl, x) === g);
    parts.push({
      key: `stop:${g}`,
      label: `${g} on the way`,
      seconds: a - b,
      at: { you: longestStop(Y, ys), them: longestStop(T, ts) },
      text: `${fmtDur(a)} vs ${fmtDur(b)}`,
    });
  }
  return parts;
}

/** Eyes you have or can craft from what you carry */
export function eyesFor(s: Side, t: number): number {
  const inv = s.run.invAt(t);
  const g = (k: string) => inv.get(k) ?? 0;
  return g("ender_eye") + Math.min(g("ender_pearl"), g("blaze_rod") * 2 + g("blaze_powder"));
}

const PRIORITY: StepKind[] = [
  "death",
  "pause",
  "portal",
  "trade",
  "fight",
  "loot",
  "craft",
  "sort",
  "eyes",
  "beds",
  "mine",
  "build",
  "eat",
  "travel",
  "still",
];
/** Owner of a tick spent back in the Nether, outside the PRIORITY indices */
const NETHER_OWNER = 99;

const BY_ACTIVITY: Record<string, StepKind> = {
  dead: "death",
  mining: "mine",
  fighting: "fight",
  placing: "build",
  eating: "eat",
  pearl: "travel",
  walking: "travel",
  trading: "trade",
  chest: "loot",
  craft: "craft",
  furnace: "craft",
  villager: "craft",
  screen: "sort",
  inventory: "sort",
  paused: "pause",
  standing: "still",
};

/** Step kind owning each tick of `sp`, as a PRIORITY index, NETHER_OWNER, or -1 for none */
function tickOwners(s: Side, sp: [number, number], back: boolean): Int8Array {
  const owner = new Int8Array(sp[1] - sp[0]).fill(-1);
  if (back) {
    for (let t = sp[0]; t < sp[1]; t++) {
      if (s.run.posAt(t).w === 1) {
        owner[t - sp[0]] = NETHER_OWNER;
      }
    }
  }
  PRIORITY.forEach((k, i) => {
    for (const st of s.steps) {
      if (st.kind !== k) {
        continue;
      }
      for (let t = Math.max(sp[0], st.t0); t < Math.min(sp[1], st.t1); t++) {
        if (owner[t - sp[0]] < 0) {
          owner[t - sp[0]] = i;
        }
      }
    }
  });
  return owner;
}

/** Seconds per step kind in `sp`, and where the longest stretch of each starts */
function stepTime(
  s: Side,
  sp: [number, number],
  back: boolean,
): { secs: Record<string, number>; at: Record<string, number> } {
  const n = sp[1] - sp[0];
  const owner = tickOwners(s, sp, back);
  // Time between known steps goes to whatever you were doing that tick.
  const kind = (i: number) => {
    if (owner[i] === NETHER_OWNER) {
      return "nether";
    }
    if (owner[i] >= 0) {
      return PRIORITY[owner[i]];
    }
    const activity = ACTIVITIES[s.tl.act[sp[0] + i]];
    return BY_ACTIVITY[activity] ?? `act:${activity}`;
  };
  const secs: Record<string, number> = {};
  const at: Record<string, number> = {};
  const best: Record<string, number> = {};
  let runK = "";
  let run0 = 0;
  for (let i = 0; i <= n; i++) {
    const k = i < n ? kind(i) : "";
    if (i < n) {
      secs[k] = (secs[k] ?? 0) + 1 / 20;
    }
    if (k !== runK) {
      if (runK && i - run0 > (best[runK] ?? 0)) {
        best[runK] = i - run0;
        at[runK] = sp[0] + run0;
      }
      runK = k;
      run0 = i;
    }
  }
  return { secs, at };
}

/** Label of a stepTime key: a step kind, or "act:" and the activity outside known steps */
const partLabel = (k: string) =>
  k.startsWith("act:")
    ? ACTIVITY_LABEL[k.slice(4) as keyof typeof ACTIVITY_LABEL]
    : STEP_LABEL[k as StepKind];

/** Under Overworld crafting: how many screens, the longest each, and what your slowest one made */
function craftBreakdown(Y: Side, T: Side): string {
  const y = overworldCrafts(Y);
  const t = overworldCrafts(T);
  if (!y.length && !t.length) {
    return "";
  }
  const longest = (xs: typeof y) =>
    xs.reduce<(typeof y)[number] | null>((m, x) => (!m || x.secs > m.secs ? x : m), null);
  const ly = longest(y);
  const lt = longest(t);
  const out = [`${y.length} vs ${t.length} screens`];
  if (ly || lt) {
    out.push(`${ly ? fmtDur(ly.secs) : "—"} vs ${lt ? fmtDur(lt.secs) : "—"} longest screen`);
  }
  // Per item made, crafting screens only (smelting is waiting on the furnace)
  const made = (xs: typeof y) =>
    xs.filter((x) => !x.smelt).reduce((n, x) => n + Object.keys(x.items).length, 0);
  const cy = y.filter((x) => !x.smelt).reduce((n, x) => n + x.secs, 0);
  const ct = t.filter((x) => !x.smelt).reduce((n, x) => n + x.secs, 0);
  if (made(y) && made(t)) {
    out.push(`${(cy / made(y)).toFixed(1)} s vs ${(ct / made(t)).toFixed(1)} s per item`);
  }
  if (ly && lt && ly.secs - lt.secs >= 3) {
    out.push(`your slowest made ${listItems(ly.items, 4, false)} at ${fmtTime(ly.t0)}`);
  }
  return ` · ${out.join(" · ")}`;
}

/** Your steps of kind `k` that started in `sp`, with a repeated step read as "built 2 portals" or "x ×2" */
function stepTexts(s: Side, sp: [number, number], k: string): string {
  const n = new Map<string, number>();
  for (const x of s.steps) {
    if (x.kind === k && x.t0 >= sp[0] && x.t0 < sp[1]) {
      n.set(lc(x.text), (n.get(lc(x.text)) ?? 0) + 1);
    }
  }
  return [...n]
    .slice(0, 2)
    .map(([text, c]) =>
      c < 2
        ? text
        : text
            .replace(/^built an? ((?:lava|blind) )?portal\b/, `built ${c} $1portals`)
            .replace(/^(?!built \d)(.*)$/, `$1 ×${c}`),
    )
    .join(", ");
}

const netherPoints = (s: Side, sp: [number, number]) =>
  s.run.slice(sp[0], sp[1]).filter((p) => p.w === 1);

/** " (12:03–13:10, got 2 more rods)": when you were back in the Nether and what it got you */
function netherTrip(s: Side, sp: [number, number]): string {
  const pts = netherPoints(s, sp);
  if (!pts.length) {
    return "";
  }
  const a = pts[0].t;
  const b = pts.at(-1)!.t;
  const rods = s.run.rodsIn(a, b);
  return ` (${fmtTime(a)}–${fmtTime(b)}${rods ? `, got ${plural(rods, "more rod")}` : ""})`;
}

function backInNetherPart(
  Y: Side,
  T: Side,
  ys: [number, number],
  ts: [number, number],
  y: number,
  t: number,
): Part {
  return {
    key: "back",
    label: "Back in the Nether after blind",
    at: { you: netherPoints(Y, ys)[0]?.t, them: netherPoints(T, ts)[0]?.t },
    seconds: y - t,
    text: `${fmtDur(y)}${netherTrip(Y, ys)} vs ${fmtDur(t)}${netherTrip(T, ts)}`,
  };
}

/** What the time went to, step by step */
function stepsWhy(
  Y: Side,
  T: Side,
  ys: [number, number],
  ts: [number, number],
  phase: string,
): Part[] {
  const back = phase === "Stronghold" || phase === "End";
  const sy = stepTime(Y, ys, back);
  const st = stepTime(T, ts, back);
  const y = sy.secs;
  const t = st.secs;
  return [...new Set([...Object.keys(y), ...Object.keys(t)])].map((k) => {
    if (k === "nether") {
      return backInNetherPart(Y, T, ys, ts, y.nether ?? 0, t.nether ?? 0);
    }
    const wy = stepTexts(Y, ys, k);
    let text = `${fmtDur(y[k] ?? 0)} vs ${fmtDur(t[k] ?? 0)}`;
    if (k === "portal" && wy) {
      text += ` · ${wy}`;
    }
    if (k === "craft" && phase === "Overworld") {
      text += craftBreakdown(Y, T);
    }
    return {
      key: `step:${k}`,
      label: partLabel(k),
      seconds: (y[k] ?? 0) - (t[k] ?? 0),
      at: { you: sy.at[k], them: st.at[k] },
      text,
    };
  });
}

/** Fortress start, 6 rods and Eye Spy, unless you blinded before 6 rods */
function rodMilestones(s: Side, sp: [number, number]): number[] | null {
  const r6 = s.run.rodsAt(6);
  const eye = s.run.mark("eye");
  const bl = s.run.mark("blind");
  if (r6 === null || eye === undefined || !(sp[0] < r6 && r6 < eye && eye <= sp[1])) {
    return null;
  }
  // Blinding before 6 rods means the rods came on a second trip, so blind is when the fortress ended.
  if (bl !== undefined && bl < r6) {
    return null;
  }
  return [sp[0], r6, eye];
}

/** Fortress start, blind travel and Eye Spy */
function blindMilestones(s: Side, sp: [number, number]): number[] | null {
  const bl = s.run.mark("blind");
  const eye = s.run.mark("eye");
  if (bl === undefined || eye === undefined || !(sp[0] < bl && bl < eye && eye <= sp[1])) {
    return null;
  }
  return [sp[0], bl, eye];
}

/** Fortress to stronghold split at milestones, each line the time between two with the step diffs
 *  inside. Only when you both hit them in the same order */
function fortressWhy(Y: Side, T: Side, ys: [number, number], ts: [number, number]): Part[] | null {
  const y6 = rodMilestones(Y, ys);
  const t6 = rodMilestones(T, ts);
  // Both by 6 rods or both by blind, since mixing them compares different things.
  const bothR6 = Boolean(y6 && t6);
  const y = bothR6 ? y6 : blindMilestones(Y, ys);
  const t = bothR6 ? t6 : blindMilestones(T, ts);
  if (!y || !t) {
    return null;
  }
  const names = [
    ["rods", bothR6 ? "6 rods" : "To blind"],
    ["to_stronghold", "To the stronghold"],
  ];
  return names.map(([key, label], i) => {
    const a: [number, number] = [y[i], y[i + 1]];
    const b: [number, number] = [t[i], t[i + 1]];
    const sa = stepTime(Y, a, false);
    const sb = stepTime(T, b, false);
    const biggestDiffs = [...new Set([...Object.keys(sa.secs), ...Object.keys(sb.secs)])]
      .map((k) => ({ k, d: (sa.secs[k] ?? 0) - (sb.secs[k] ?? 0) }))
      .filter((x) => Math.abs(x.d) >= 3)
      .sort((p, q) => Math.abs(q.d) - Math.abs(p.d))
      .slice(0, 2)
      .map(
        (x) =>
          `${partLabel(x.k).toLowerCase()} ${fmtDur(sa.secs[x.k] ?? 0)} vs ${fmtDur(sb.secs[x.k] ?? 0)}`,
      );
    const worst = Object.entries(sa.secs)
      .map(([k, v]) => ({ k, d: v - (sb.secs[k] ?? 0) }))
      .sort((p, q) => q.d - p.d)[0];
    const inside = biggestDiffs.length ? ` · ${biggestDiffs.join(" · ")}` : "";
    return {
      key,
      label,
      seconds: (a[1] - a[0] - (b[1] - b[0])) / 20,
      text: `${fmtDur((a[1] - a[0]) / 20)} vs ${fmtDur((b[1] - b[0]) / 20)}${inside}`,
      at: { you: worst && sa.at[worst.k] !== undefined ? sa.at[worst.k] : a[0], them: b[0] },
    };
  });
}

/** Part keys of phases whose parts are already in the order they happened */
const ORDERED_PART_KEYS = [
  "pre",
  "trading",
  "after",
  "rods",
  "to_stronghold",
  "end_kill",
  "end_after",
];

/** Parts of a phase's time diff, in the order they happened */
export function phaseWhy(
  phase: string,
  Y: Side,
  T: Side,
  ys: Span,
  ts: Span,
  goals: LeaveGoals,
): Part[] {
  if (!ys || !ts) {
    return [];
  }
  let parts: Part[] | null = null;
  if (phase === "Bastion") {
    parts = bastionWhy(Y, T, goals);
  } else if (phase === "Fortress to stronghold") {
    parts = fortressWhy(Y, T, ys, ts);
  } else if (phase === "End") {
    parts = endParts(dragonFight(Y, ys), dragonFight(T, ts));
  } else if (
    phase === "Nether travel" ||
    phase.startsWith("Bastion to") ||
    phase === "After the bastion"
  ) {
    parts = travelWhy(Y, T, ys, ts);
  }
  parts ??= stepsWhy(Y, T, ys, ts, phase);
  const shown = parts.filter((p) => Math.abs(p.seconds) >= 2);
  if (
    ["Bastion", "Fortress to stronghold", "End"].includes(phase) &&
    parts.every((p) => ORDERED_PART_KEYS.includes(p.key))
  ) {
    return shown;
  }
  const when = (p: Part) => p.at?.you ?? p.at?.them ?? Infinity;
  return shown.sort((a, b) => when(a) - when(b));
}
