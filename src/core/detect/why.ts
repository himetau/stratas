// Why a phase was slower or faster, split into parts that add up to the diff
//   bastion  = before first throw + barters needed / trade speed + trading stalled + after having everything
//   travel   = distance / speed + stops (fighting, eating, mining, menus)
//   fortress = finding blazes + getting rods + after the last rod
//   other    = the steps you spent it on (portal, chests, crafting)
import { ACTIVITIES, ACTIVITY_LABEL, type ActivityTimeline } from "./activity";
import { SAMPLE } from "./facts";
import { outsideBarters, split, SPLIT_LABEL, tradesDone, type SplitKey } from "./bastion";
import { enoughAt, type LeaveGoals, type Side, type Span } from "./findings";
import { fmtDur, fmtTime } from "./names";
import { dragonFight, endParts } from "./end";
import { itemName, STEP_LABEL, type StepKind } from "./steps";

/** Where to look in the replay, your time and theirs */
export interface At { you?: number; them?: number }
export interface Part { key: string; label: string; seconds: number; text: string; at?: At }

const at = fmtTime;
const sec = fmtDur;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const lc = (s: string) => s[0].toLowerCase() + s.slice(1);

/** Start of the longest run of ticks in [t0, t1) where `on` is true */
function longest(t0: number, t1: number, on: (t: number) => boolean): number | undefined {
  let best = 0, at: number | undefined, run = -1;
  for (let t = t0; t <= t1; t++) {
    if (t < t1 && on(t)) { if (run < 0) run = t; if (t - run + 1 > best) { best = t - run + 1; at = run; } } else run = -1;
  }
  return at;
}

// ---- bastion

interface BastionTime {
  b: number; l: number; enough: number; first: number; done: number;
  pre: number; active: number; stall: number; pickup: number; after: number;
  barters: number; rate: number; usual: number;
  stallWhy: { angry: number; untaken: number; noGold: number; gettingGold: number };
  stuck: { n: number; t0: number; t1: number } | null;
  last: { item: string; at: number } | null;
  fromChests: Record<string, number>;
  longestStall: number | null;
  /** Item the last needed trade completed */
  decider: string | null;
}

function bastionTime(s: Side, goals: LeaveGoals): BastionTime | null {
  const r = s.run, b = r.mark("bastion"), l = r.mark("bastion_left");
  if (b === undefined || l === undefined) return null;
  const enough = enoughAt(r, goals) ?? l;
  // Trades are done at the barter that completed everything, pickup comes after
  const td = tradesDone(r, goals);
  const done = Math.min(enough, td?.t ?? enough);
  const first = Math.min(done, s.facts.goldThrown.find((g) => g.t >= b)?.t ?? done);
  const smp = s.facts.samples(first, done);
  const busy = smp.filter((x) => x.barter > 0), idle = smp.filter((x) => x.barter === 0);
  const tick = SAMPLE / 20;
  const goldWork = (t: number) => s.steps.some((x) => x.t0 <= t && x.t1 >= t && ((x.kind === "mine" && /gold|gilded/.test(x.text)) || x.kind === "loot"));
  const stallWhy = { angry: 0, untaken: 0, noGold: 0, gettingGold: 0 };
  for (const x of idle) {
    if (x.angry >= 3) stallWhy.angry += tick;
    else if (x.ground > 0) stallWhy.untaken += tick;
    else { stallWhy.noGold += tick; if (goldWork(x.t)) stallWhy.gettingGold += tick; }
  }
  const barters = td?.barters ?? r.actions.filter((a) => a.kind === "barter" && a.t0 >= b && a.t0 <= enough).length;
  const active = busy.length * tick;
  const seekers = s.facts.pigSpans.filter((p) => p.state === 1 && p.t1 - p.t0 >= 200 && p.t1 > first && p.t0 < done);
  const ids = new Set(seekers.map((p) => p.id));
  const items = (Object.entries(goals) as [string, number][]).filter(([, n]) => n > 0);
  const reach = items.map(([it, n]) => ({ item: it, at: r.firstReach(it, n, b, l) })).filter((x) => x.at !== null).sort((p, q) => q.at! - p.at!);
  const fromChests: Record<string, number> = {};
  for (const a of r.actions.filter((x) => x.kind === "chest" && x.t0 >= b && x.t0 <= l)) for (const [it] of items) fromChests[it] = (fromChests[it] ?? 0) + Math.max(0, a.delta?.[it] ?? 0);
  const sorted = busy.map((x) => x.barter).sort((p, q) => p - q);
  let longestStall: number | null = null, run0 = -1, best = 0;
  for (const x of smp) {
    if (x.barter === 0) { if (run0 < 0) run0 = x.t; if (x.t - run0 > best) { best = x.t - run0; longestStall = run0; } } else run0 = -1;
  }
  return {
    b, l, enough, first, done, pre: (first - b) / 20, active, stall: idle.length * tick, pickup: (enough - done) / 20, after: (l - enough) / 20,
    barters, rate: active > 0 ? barters / active : 0, usual: sorted.length ? sorted[sorted.length >> 1] : 0,
    stallWhy, stuck: ids.size >= 2 ? { n: ids.size, t0: Math.max(first, Math.min(...seekers.map((p) => p.t0))), t1: Math.min(done, Math.max(...seekers.map((p) => p.t1))) } : null,
    last: reach[0] ? { item: reach[0].item, at: reach[0].at! } : null, fromChests, longestStall, decider: td?.last ?? null,
  };
}

function bastionWhy(Y: Side, T: Side, goals: LeaveGoals): Part[] | null {
  const y = bastionTime(Y, goals), t = bastionTime(T, goals);
  if (!y || !t) return null;
  const parts: Part[] = [];

  // 1. Entering to first gold thrown
  parts.push({ key: "pre", label: "First throw", seconds: y.pre - t.pre, at: { you: y.b, them: t.b },
    text: `${sec(y.pre)} vs ${sec(t.pre)} after entering` });

  // 2. First gold thrown to the trade that completed what you need
  const ty = (y.done - y.first) / 20, tt = (t.done - t.first) / 20;
  let st = `${sec(ty)} vs ${sec(tt)} · ${y.usual} vs ${t.usual} piglins at once`;
  if (y.stuck) st += ` · ${y.stuck.n} piglins stuck on gold ${at(y.stuck.t0)}–${at(y.stuck.t1)}`;
  if (Math.abs(y.stall - t.stall) >= 5) {
    const why = [y.stallWhy.angry >= 3 ? `angry ${sec(y.stallWhy.angry)}` : "", y.stallWhy.noGold >= 3 ? `no gold down ${sec(y.stallWhy.noGold)}` : ""].filter(Boolean).join(", ");
    st += ` · no piglin trading ${sec(y.stall)} vs ${sec(t.stall)}${why && y.stall > t.stall ? ` (${why})` : ""}`;
  }
  if (y.barters !== t.barters) {
    // Same trades in same order for everyone on a seed, so a different count comes from chests
    st += ` · ${y.barters} vs ${t.barters} trades`;
    const it = y.decider;
    if (it) {
      const oy = outsideBarters(Y.run, it, y.done), ot = outsideBarters(T.run, it, t.done);
      st += ` (${itemName(it)} from chests or mining ${oy.by} vs ${ot.by}${oy.later.length ? `, ${oy.later.map((c) => `${c.n} ${c.how} after at ${at(c.t)}`).join(", ")}` : ""})`;
    }
  }
  const where = y.stuck?.t0 ?? (y.stall - t.stall >= 5 ? y.longestStall ?? y.first : y.first);
  parts.push({ key: "trading", label: "Trading", seconds: ty - tt, text: st, at: { you: where, them: t.first } });

  // 3. That trade to leaving the bastion (pickup, finishing off, walking out)
  const doing = (x: BastionTime, s: Side) => (Object.entries(split(s, x.done, x.l).secs) as [SplitKey, number][]).filter(([, v]) => v >= 2)
    .sort((p, q) => q[1] - p[1]).slice(0, 3).map(([k, v]) => `${SPLIT_LABEL[k].toLowerCase()} ${sec(v)}`).join(", ");
  const ay = (y.l - y.done) / 20, af = (t.l - t.done) / 20;
  const dy = doing(y, Y);
  parts.push({ key: "after", label: "After trading", seconds: ay - af, at: { you: y.done, them: t.done },
    text: `${sec(ay)} vs ${sec(af)}${dy ? ` · yours: ${dy}` : ""}` });
  return parts;
}

// ---- travel

const WALK = 1 << ACTIVITIES.indexOf("walking"), PEARL = 1 << ACTIVITIES.indexOf("pearl");
const STOP: Record<string, string> = {
  dead: "Dead", fighting: "Fighting", eating: "Eating", mining: "Mining", placing: "Bridging and pillaring",
  chest: "Menus", craft: "Menus", furnace: "Menus", villager: "Menus", screen: "Menus", inventory: "Menus", pie: "Pie chart", pickup: "Picking up items",
  drinking: "Drinking", aiming: "Aiming a bow", portal: "In a portal", flight: "Pearl and eye flights",
  trading: "Waiting on trades", looking: "Looking around", standing: "Idle", paused: "Paused",
};

function travelTime(s: Side, sp: [number, number]) {
  const r = s.run, tl: ActivityTimeline = s.tl;
  let moving = 0, dist = 0;
  const stops: Record<string, number> = {};
  // Moving = any tick you were going somewhere, even digging or bridging on the way
  const moves = (t: number) => (tl.present[t] & (WALK | PEARL)) !== 0 && ACTIVITIES[tl.act[t]] !== "dead";
  for (let t = sp[0]; t < sp[1]; t++) {
    if (moves(t)) moving++;
    else { const g = STOP[ACTIVITIES[tl.act[t]]] ?? "Other"; stops[g] = (stops[g] ?? 0) + 1 / 20; }
  }
  const pts = r.slice(sp[0], sp[1]);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    // A pearl can move you ~100 blocks in one step
    if (a.w === b.w && moves(a.t)) { const d = Math.hypot(b.x - a.x, b.z - a.z); if (d < 12 || (tl.present[a.t] & PEARL && d < 120) || (tl.present[b.t] & PEARL && d < 120)) dist += d; }
  }
  const p0 = r.posAt(sp[0] + 1), p1 = r.posAt(sp[1]);
  return { moving: moving / 20, dist, straight: p0.w === p1.w ? Math.hypot(p1.x - p0.x, p1.z - p0.z) : null, stops,
    pearls: r.actions.filter((a) => a.kind === "pearl" && a.t0 >= sp[0] && a.t0 < sp[1]).length };
}

function travelWhy(Y: Side, T: Side, ys: [number, number], ts: [number, number]): Part[] {
  const y = travelTime(Y, ys), t = travelTime(T, ts), parts: Part[] = [];
  const vy = y.moving ? y.dist / y.moving : 0, vt = t.moving ? t.dist / t.moving : 0;
  if (vy > 0 && vt > 0) {
    const pearls = y.pearls || t.pearls ? ` · ${y.pearls} vs ${t.pearls} pearls` : "";
    parts.push({ key: "route", label: "Distance", seconds: (y.dist - t.dist) / vy, at: { you: ys[0], them: ts[0] }, text: `${Math.round(y.dist)} vs ${Math.round(t.dist)} blocks${pearls}` });
    parts.push({ key: "speed", label: "Speed", at: { you: ys[0], them: ts[0] }, seconds: t.dist / vy - t.dist / vt, text: `${vy.toFixed(1)} vs ${vt.toFixed(1)} blocks/s` });
  } else parts.push({ key: "moving", label: "Moving", at: { you: ys[0], them: ts[0] }, seconds: y.moving - t.moving, text: `${sec(y.moving)} vs ${sec(t.moving)}` });
  for (const g of new Set([...Object.keys(y.stops), ...Object.keys(t.stops)])) {
    const a = y.stops[g] ?? 0, b = t.stops[g] ?? 0;
    const firstOf = (s: Side, sp: [number, number]) => longest(sp[0], sp[1], (x) => (STOP[ACTIVITIES[s.tl.act[x]]] ?? "Other") === g);
    parts.push({ key: `stop:${g}`, label: `${g} on the way`, seconds: a - b, at: { you: firstOf(Y, ys), them: firstOf(T, ts) }, text: `${sec(a)} vs ${sec(b)}` });
  }
  return parts;
}

/** Eyes you have or can craft from what you carry */
export function eyesFor(s: Side, t: number): number {
  const inv = s.run.invAt(t), g = (k: string) => inv.get(k) ?? 0;
  return g("ender_eye") + Math.min(g("ender_pearl"), g("blaze_rod") * 2 + g("blaze_powder"));
}

// ---- everything else, what the time went to step by step

const PRIORITY: StepKind[] = ["death", "pause", "portal", "trade", "fight", "loot", "craft", "sort", "eyes", "beds", "mine", "build", "eat", "travel", "still"];

function stepTime(s: Side, sp: [number, number], back: boolean): { secs: Record<string, number>; at: Record<string, number> } {
  const steps = s.steps, n = sp[1] - sp[0], owner = new Int8Array(n).fill(-1);
  if (back) for (let t = sp[0]; t < sp[1]; t++) if (s.run.posAt(t).w === 1) owner[t - sp[0]] = 99;
  PRIORITY.forEach((k, i) => {
    for (const s of steps) if (s.kind === k) for (let t = Math.max(sp[0], s.t0); t < Math.min(sp[1], s.t1); t++) if (owner[t - sp[0]] < 0) owner[t - sp[0]] = i;
  });
  // Time between known steps goes to whatever you were doing that tick
  const kind = (i: number) => (owner[i] === 99 ? "nether" : owner[i] >= 0 ? PRIORITY[owner[i]] : BY_ACTIVITY[ACTIVITIES[s.tl.act[sp[0] + i]]] ?? `act:${ACTIVITIES[s.tl.act[sp[0] + i]]}`);
  const secs: Record<string, number> = {}, at: Record<string, number> = {}, best: Record<string, number> = {};
  let runK = "", run0 = 0;
  for (let i = 0; i <= n; i++) {
    const k = i < n ? kind(i) : "";
    if (i < n) secs[k] = (secs[k] ?? 0) + 1 / 20;
    if (k !== runK) {
      if (runK && i - run0 > (best[runK] ?? 0)) { best[runK] = i - run0; at[runK] = sp[0] + run0; }
      runK = k; run0 = i;
    }
  }
  return { secs, at };
}
const BY_ACTIVITY: Record<string, StepKind> = {
  dead: "death", mining: "mine", fighting: "fight", placing: "build", eating: "eat", pearl: "travel", walking: "travel",
  trading: "trade", chest: "loot", craft: "craft", furnace: "craft", villager: "craft", screen: "sort", inventory: "sort",
  paused: "pause", standing: "still",
};

function stepsWhy(Y: Side, T: Side, ys: [number, number], ts: [number, number], phase: string): Part[] {
  const back = phase === "Stronghold" || phase === "End";
  const sy = stepTime(Y, ys, back), st = stepTime(T, ts, back), y = sy.secs, t = st.secs;
  // Same step twice reads "built 2 portals" not "built a portal, built a portal"
  const texts = (s: Side, sp: [number, number], k: string) => {
    const n = new Map<string, number>();
    for (const x of s.steps) if (x.kind === k && x.t0 >= sp[0] && x.t0 < sp[1]) n.set(lc(x.text), (n.get(lc(x.text)) ?? 0) + 1);
    return [...n].slice(0, 2).map(([t, c]) => (c < 2 ? t : t.replace(/^built an? (lava )?portal\b/, `built ${c} $1portals`).replace(/^(?!built \d)(.*)$/, `$1 ×${c}`))).join(", ");
  };
  return [...new Set([...Object.keys(y), ...Object.keys(t)])].map((k) => {
    if (k === "nether") {
      const trip = (s: Side, sp: [number, number]) => {
        const ts2 = s.run.slice(sp[0], sp[1]).filter((p) => p.w === 1);
        if (!ts2.length) return "";
        const a = ts2[0].t, b = ts2.at(-1)!.t;
        let rods = 0;
        for (let x = a, prev = s.run.invAt(a).get("blaze_rod") ?? 0; x <= b; x += 5) { const n = s.run.invAt(x).get("blaze_rod") ?? 0; if (n > prev) rods += n - prev; prev = n; }
        return ` (${at(a)}–${at(b)}${rods ? `, got ${plural(rods, "more rod")}` : ""})`;
      };
      const firstNether = (s: Side, sp: [number, number]) => s.run.slice(sp[0], sp[1]).find((p) => p.w === 1)?.t;
      return { key: "back", label: "Back in the nether after blind", at: { you: firstNether(Y, ys), them: firstNether(T, ts) }, seconds: (y.nether ?? 0) - (t.nether ?? 0),
        text: `${sec(y.nether ?? 0)}${trip(Y, ys)} vs ${sec(t.nether ?? 0)}${trip(T, ts)}` };
    }
    // Time outside known steps is named by what you were doing (aiming, in a portal etc)
    const label = k.startsWith("act:") ? ACTIVITY_LABEL[k.slice(4) as keyof typeof ACTIVITY_LABEL] : STEP_LABEL[k as StepKind];
    const wy = texts(Y, ys, k);
    return { key: `step:${k}`, label, seconds: (y[k] ?? 0) - (t[k] ?? 0), at: { you: sy.at[k], them: st.at[k] },
      text: `${sec(y[k] ?? 0)} vs ${sec(t[k] ?? 0)}${k === "portal" && wy ? ` · ${wy.replace(/built (the|a) portal: /g, "")}` : ""}` };
  });
}

/** Fortress to stronghold split at milestones (enter fortress, 6 rods, Eye Spy). Each line is time between two
 * milestones with the step diffs inside. Only when you both hit them in the same order */
function fortressWhy(Y: Side, T: Side, ys: [number, number], ts: [number, number]): Part[] | null {
  const ms = (s: Side, sp: [number, number]) => {
    const r6 = s.run.rodsAt(6), eye = s.run.mark("eye");
    if (r6 === null || eye === undefined || !(sp[0] < r6 && r6 < eye && eye <= sp[1])) return null;
    return [sp[0], r6, eye];
  };
  const msEarlyBlind = (s: Side, sp: [number, number]) => {
    const bl = s.run.mark("blind"), eye = s.run.mark("eye");
    if (bl === undefined || eye === undefined || !(sp[0] < bl && bl < eye && eye <= sp[1])) return null;
    return [sp[0], bl, eye];
  };
  const y6 = ms(Y, ys), t6 = ms(T, ts);
  // Both by 6 rods or both by blind, mixing them compares different things
  const bothR6 = Boolean(y6 && t6);
  const y = bothR6 ? y6 : msEarlyBlind(Y, ys), t = bothR6 ? t6 : msEarlyBlind(T, ts);
  if (!y || !t) return null;
  const names = bothR6
    ? [["rods", "6 rods"], ["to_stronghold", "To the stronghold"]]
    : [["rods", "To blind"], ["to_stronghold", "To the stronghold"]];
  return names.map(([key, label], i) => {
    const a: [number, number] = [y[i], y[i + 1]], b: [number, number] = [t[i], t[i + 1]];
    const sa = stepTime(Y, a, false), sb = stepTime(T, b, false);
    // Step diffs in this stretch, biggest first
    const inside = [...new Set([...Object.keys(sa.secs), ...Object.keys(sb.secs)])]
      .map((k) => ({ k, d: (sa.secs[k] ?? 0) - (sb.secs[k] ?? 0) })).filter((x) => Math.abs(x.d) >= 3)
      .sort((p, q) => Math.abs(q.d) - Math.abs(p.d)).slice(0, 2)
      .map((x) => `${(x.k.startsWith("act:") ? ACTIVITY_LABEL[x.k.slice(4) as keyof typeof ACTIVITY_LABEL] : STEP_LABEL[x.k as StepKind]).toLowerCase()} ${sec(sa.secs[x.k] ?? 0)} vs ${sec(sb.secs[x.k] ?? 0)}`);
    const worst = Object.entries(sa.secs).map(([k, v]) => ({ k, d: v - (sb.secs[k] ?? 0) })).sort((p, q) => q.d - p.d)[0];
    return { key, label, seconds: (a[1] - a[0] - (b[1] - b[0])) / 20,
      text: `${sec((a[1] - a[0]) / 20)} vs ${sec((b[1] - b[0]) / 20)}${inside.length ? ` · ${inside.join(" · ")}` : ""}`,
      at: { you: worst && sa.at[worst.k] !== undefined ? sa.at[worst.k] : a[0], them: b[0] } };
  });
}

/** Parts of a phase's time diff, biggest first, they add up to `change` */
export function phaseWhy(phase: string, Y: Side, T: Side, ys: Span, ts: Span, change: number | null, goals: LeaveGoals): Part[] {
  if (!ys || !ts) return [];
  let parts: Part[] | null = null;
  if (phase === "Bastion") parts = bastionWhy(Y, T, goals);
  else if (phase === "Fortress to stronghold") parts = fortressWhy(Y, T, ys, ts);
  else if (phase === "End") parts = endParts(dragonFight(Y, ys), dragonFight(T, ts));
  else if (phase === "Nether travel" || phase.startsWith("Bastion to") || phase === "After the bastion") parts = travelWhy(Y, T, ys, ts);
  parts ??= stepsWhy(Y, T, ys, ts, phase);
  const shown = parts.filter((p) => Math.abs(p.seconds) >= 2);
  // In the order it happened. Milestone and bastion lines already are, rest sorted by your time
  if (["Bastion", "Fortress to stronghold", "End"].includes(phase) && parts !== null && parts.every((p) => ["pre", "trading", "after", "rods", "to_stronghold", "end_kill", "end_after"].includes(p.key))) return shown;
  const when = (p: Part) => p.at?.you ?? p.at?.them ?? Infinity;
  return shown.sort((a, b) => when(a) - when(b));
}
