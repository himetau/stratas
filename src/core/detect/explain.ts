import type { Vec3 } from "../replay/decode";
import { WORLDS } from "../replay/registries";
import {
  ACTIVITIES,
  ACTIVITY_LABEL,
  countActivities,
  type Activity,
  type ActivityTimeline,
} from "./activity";
import { END_SPLIT, START_SPLIT, SPLITS, fmtDur, fmtSec, fmtTime } from "./names";
import { Run, type Action, type ActionKind } from "./run";
import type { GapWindow } from "./windows";

export interface Cause {
  key: string;
  seconds: number;
  text: string;
  tag?: "local" | "route" | "speed";
  label?: string;
}

export interface Finding {
  kind: "loss" | "gain";
  /** Seconds lost or gained, always positive */
  seconds: number;
  phase: string;
  you: [number, number];
  them: [number, number];
  headline: string;
  causes: Cause[];
  notes: string[];
  watch: { youAt: string; themAt: string; alignFrom: string; alignTo: string; camera: string };
  jump: boolean;
}

export interface Side {
  run: Run;
  tl: ActivityTimeline;
}

/** Long actions that count when they overlap a stretch at all, not only when they start in it */
const LONG_ACTIONS: ActionKind[] = [
  "craft",
  "inventory",
  "chest",
  "furnace",
  "villager",
  "screen",
  "pie",
  "mine",
  "mine_abandoned",
  "eat",
];
const SCREEN_CAUSES = ["craft", "inventory", "chest", "pie"];
const MIN_CAUSE_SECONDS = 2;

const nice = (s: string) => s.replace(/^minecraft:/, "").replace(/_/g, " ");
const inWin = (a: Action, t0: number, t1: number) => a.t0 >= t0 && a.t0 < t1;
const overlapping = (acts: Action[], t0: number, t1: number) =>
  acts.filter((a) => (LONG_ACTIONS.includes(a.kind) ? a.t1 >= t0 && a.t0 < t1 : inWin(a, t0, t1)));
const ofKind = (acts: Action[], k: ActionKind | ActionKind[]) =>
  acts.filter((a) => (Array.isArray(k) ? k.includes(a.kind) : a.kind === k));
const near = (a: Vec3 | undefined, xs: Action[], d: number) =>
  !!a && xs.some((b) => b.at && Math.hypot(a[0] - b.at[0], a[1] - b.at[1], a[2] - b.at[2]) <= d);

/** Blocks walked on walking ticks, teleports (respawn, pearl, portal) don't count */
function walked(side: Side, t0: number, t1: number): number {
  const pts = side.run.slice(t0, t1);
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a.w !== b.w || ACTIVITIES[side.tl.act[a.t]] !== "walking") {
      continue;
    }
    const step = Math.hypot(b.x - a.x, b.z - a.z);
    if (step <= 2 + (b.t - a.t) * 0.6) {
      d += step;
    }
  }
  return d;
}

function splitBefore(r: Run, t: number): string {
  let name = START_SPLIT;
  let best = -1;
  for (const [type, label] of SPLITS) {
    const s = r.splits.get(type);
    if (s !== undefined && s <= t && s > best) {
      best = s;
      name = label;
    }
  }
  return name;
}
function splitAfter(r: Run, t: number): string | null {
  let name: string | null = null;
  let best = Infinity;
  for (const [type, label] of SPLITS) {
    const s = r.splits.get(type);
    if (s !== undefined && s >= t && s < best) {
      best = s;
      name = label;
    }
  }
  return name;
}

/** Chests grouped by position with visits and seconds */
function chestVisits(acts: Action[]) {
  const by = new Map<string, { visits: number; secs: number; at?: Vec3 }>();
  for (const a of acts) {
    const k = a.at ? a.at.join(",") : "?";
    const x = by.get(k) ?? { visits: 0, secs: 0, at: a.at };
    x.visits++;
    x.secs += (a.t1 - a.t0) / 20;
    by.set(k, x);
  }
  return [...by.values()];
}

export function explainWindow(Y: Side, T: Side, win: GapWindow): Finding {
  const [ys0, g0] = win.from;
  const [ys1, g1] = win.to;
  return explainSpan(Y, T, ys0 * 20, ys1 * 20, (ys0 - g0) * 20, (ys1 - g1) * 20, win.jump);
}

interface Stretch {
  Y: Side;
  T: Side;
  y0: number;
  y1: number;
  t0: number;
  t1: number;
  /** Your actions overlapping the stretch */
  yActs: Action[];
  /** Their actions overlapping the stretch */
  tActs: Action[];
}

function inTrading(side: Side, t: number) {
  return side.tl.trading.some(([a, b]) => t >= a && t <= b + 20);
}

function deathText(st: Stretch, N: string): string {
  const yd = st.Y.tl.deaths.filter((d) => d.t >= st.y0 && d.t < st.y1);
  const td = st.T.tl.deaths.filter((d) => d.t >= st.t0 && d.t < st.t1);
  const text = [
    ...yd.map(
      (d) =>
        `You died at ${fmtTime(d.t)}${d.back !== null ? ` and were back at ${fmtTime(d.back)}` : " and never got back"}.`,
    ),
    ...td.map((d) => `${N} died at ${fmtTime(d.t)}.`),
  ].join(" ");
  const hitsBeforeDeath = ofKind(st.yActs, "hit").filter((x) =>
    yd.some((d) => x.t0 > d.t - 300 && x.t0 <= d.t),
  );
  const mobs = [
    ...new Set(
      hitsBeforeDeath
        .map((x) => x.what)
        .filter((m): m is string => !!m && m !== "?" && m !== "mob"),
    ),
  ];
  if (yd.length && mobs.length) {
    return text.replace(/\.$/, ` (fighting ${mobs.map(nice).join(" and ")}s).`);
  }
  return text;
}

function chestText(st: Stretch, N: string, a: number, b: number): string {
  const yv = chestVisits(ofKind(st.yActs, "chest"));
  const tv = chestVisits(ofKind(st.tActs, "chest"));
  const repeats = yv.filter((x) => x.visits > 1).length;
  const theirChests = st.T.run.actions.filter((x) => x.kind === "chest");
  const onlyYou = yv.filter((x) => !near(x.at, theirChests, 3)).length;
  let text = `You opened ${yv.length} chests, ${N} ${tv.length}.`;
  if (repeats) {
    text += ` You reopened ${repeats}.`;
  }
  if (onlyYou && a > b) {
    text += ` ${onlyYou} of yours ${N} skipped.`;
  }
  return text;
}

function miningText(st: Stretch, N: string): string {
  const yn = ofKind(st.yActs, "mine").length;
  const tn = ofKind(st.tActs, "mine").length;
  let text =
    yn === 0 && tn
      ? `${N} mined ${tn} blocks here; you didn't.`
      : `You mined ${yn} blocks, ${N} ${tn}.`;
  const gaveUp = ofKind(st.yActs, "mine_abandoned").length;
  if (gaveUp >= 2) {
    text += ` You gave up on ${gaveUp} halfway.`;
  }
  return text;
}

function tradingText(st: Stretch, N: string, vs: string, a: number, b: number): string {
  const piglins = (bs: Action[]) => new Set(bs.map((x) => x.id)).size;
  const yp = piglins(ofKind(st.yActs, "barter"));
  const tp = piglins(ofKind(st.tActs, "barter"));
  let text = `Waiting on trades: you ${vs}. You had ${yp} piglins, ${N} ${tp}.`;
  if (a > b && tp > yp + 1) {
    text += ` More piglins trade faster.`;
  }
  return text;
}

function roundedRangeWidth(xs: number[]): number {
  return xs.length ? Math.round(Math.max(...xs) - Math.min(...xs)) : 0;
}

function walkingCause(
  st: Stretch,
  N: string,
  a: number,
  b: number,
): { text: string; tag: NonNullable<Cause["tag"]> } {
  const yp = walked(st.Y, st.y0, st.y1);
  const tp = walked(st.T, st.t0, st.t1);
  if (yp < 5 || tp < 5) {
    return {
      tag: "route",
      text:
        yp < 5
          ? `${N} walked ${Math.round(tp)} blocks here that you didn't.`
          : `You walked ${Math.round(yp)} blocks here that ${N} didn't need.`,
    };
  }
  const pts = st.Y.run
    .slice(st.y0, st.y1)
    .filter((p) => ACTIVITIES[st.Y.tl.act[p.t]] === "walking");
  const spread = Math.max(
    roundedRangeWidth(pts.map((p) => p.x)),
    roundedRangeWidth(pts.map((p) => p.z)),
  );
  if (spread < 30 && yp > spread * 2.5 && yp > tp * 1.5 + 20) {
    return {
      tag: "local",
      text: `Walking back and forth in the same spot: ${Math.round(yp)} blocks, ${N} ${Math.round(tp)}.`,
    };
  }
  if (yp > tp * 1.3 + 10 || tp > yp * 1.3 + 10) {
    return {
      tag: "route",
      text: `${yp > tp ? "Your" : `${N}'s`} route was longer: ${Math.round(yp)} blocks, ${N} ${Math.round(tp)}.`,
    };
  }
  const vs = `${fmtDur(a)}, ${N} ${fmtDur(b)}`;
  return { tag: "speed", text: `Same distance, you were ${a > b ? "slower" : "faster"}: ${vs}.` };
}

function walkingLabel(tag: Cause["tag"]): string {
  if (tag === "local") {
    return "Walking back and forth";
  }
  return tag === "route" ? "Route" : "Walking speed";
}

/** What one activity's time difference was, given your `a` and their `b` seconds on it */
function activityText(act: Activity, st: Stretch, N: string, a: number, b: number): string {
  const vs = `${fmtDur(a)}, ${N} ${fmtDur(b)}`;
  switch (act) {
    case "dead":
      return deathText(st, N);
    case "craft":
      return `Crafting: you ${vs}.`;
    case "inventory": {
      const duringTrades = ofKind(st.yActs, "inventory").filter((x) =>
        inTrading(st.Y, x.t0),
      ).length;
      return `Inventory open: you ${vs}.${duringTrades >= 2 && a > b ? " Mostly sorting trade loot." : ""}`;
    }
    case "chest":
      return chestText(st, N, a, b);
    case "furnace":
      return `Furnace: you ${vs}.`;
    case "villager":
      return `Villager trades: you ${vs}.`;
    case "screen":
      return `Other menus: you ${vs}.`;
    case "pie":
      return a < 1
        ? `${N} had the pie chart up for ${fmtDur(b)} with nothing else going on.`
        : `Pie chart up with nothing else going on: you ${ofKind(st.yActs, "pie").length} times, ${N} ${ofKind(st.tActs, "pie").length}.`;
    case "mining":
      return miningText(st, N);
    case "fighting":
      return a < 1 ? `${N} fought for ${fmtDur(b)}; you didn't.` : `Fighting: you ${vs}.`;
    case "eating":
      return a < 1 ? `${N} stopped to eat for ${fmtDur(b)}.` : `Eating: you ${vs}.`;
    case "placing":
      return `You placed ${ofKind(st.yActs, "place").length} blocks, ${N} ${ofKind(st.tActs, "place").length}.`;
    case "pearl":
      return `You threw ${ofKind(st.yActs, ["pearl", "eye"]).length} pearls and eyes, ${N} ${ofKind(st.tActs, ["pearl", "eye"]).length}.`;
    case "trading":
      return tradingText(st, N, vs, a, b);
    case "pickup":
      return `Picking up items: you ${vs}.`;
    case "looking":
      return `Turning the camera, standing still: you ${vs}.`;
    case "paused":
      return `Paused: you ${vs}.`;
    case "standing":
      return `Standing still: you ${vs}.`;
    default:
      return "";
  }
}

function activityCauses(st: Stretch, N: string): Cause[] {
  const cy = countActivities(st.Y.tl, st.y0, st.y1);
  const ct = countActivities(st.T.tl, st.t0, st.t1);
  const causes: Cause[] = [];
  for (const act of ACTIVITIES) {
    const a = cy[act];
    const b = ct[act];
    if (Math.abs(a - b) < 1) {
      continue;
    }
    if (act === "walking") {
      const { text, tag } = walkingCause(st, N, a, b);
      causes.push({ key: act, seconds: a - b, text, tag, label: walkingLabel(tag) });
      continue;
    }
    causes.push({
      key: act,
      seconds: a - b,
      text: activityText(act, st, N, a, b),
      label: ACTIVITY_LABEL[act],
    });
  }
  return causes;
}

/** Things worth knowing that are not time on their own: damage, other portals, mined blocks never used */
function sideNotes(
  you: Run,
  yStarted: Action[],
  tStarted: Action[],
  y1: number,
  N: string,
  isLoss: boolean,
): string[] {
  const notes: string[] = [];
  const damage = (acts: Action[]) =>
    acts.filter((a) => a.kind === "damage").reduce((s, a) => s + (a.amount ?? 0), 0) / 2;
  const yh = damage(yStarted);
  const th = damage(tStarted);
  if (Math.abs(yh - th) >= 3) {
    notes.push(`You took ${yh} hearts of damage, ${N} ${th}.`);
  }
  const tPortals = ofKind(tStarted, "portal");
  for (const p of ofKind(yStarted, "portal")) {
    const q = tPortals.find((x) => x.w === p.w && x.to === p.to);
    if (q && p.at && q.at && Math.hypot(p.at[0] - q.at[0], p.at[2] - q.at[2]) > 30) {
      notes.push(`You used a different portal to the ${WORLDS[p.to!]}.`);
    }
  }
  if (!isLoss) {
    return notes;
  }
  const byItem = new Map<string, { n: number; secs: number }>();
  for (const a of ofKind(yStarted, "mine").filter((x) => x.item && x.item !== "?")) {
    const x = byItem.get(a.item!) ?? { n: 0, secs: 0 };
    x.n += a.count ?? 1;
    x.secs += (a.t1 - a.t0) / 20;
    byItem.set(a.item!, x);
  }
  const atEnd = you.invAt(you.end);
  const afterWin = you.invAt(y1);
  for (const [it, x] of byItem) {
    if (x.secs >= 2 && (afterWin.get(it) ?? 0) >= x.n && (atEnd.get(it) ?? 0) >= x.n) {
      notes.push(`You mined ${x.n} ${nice(it)} and never used it (${fmtDur(x.secs)}).`);
    }
  }
  return notes;
}

function cameraFor(topCause: string | undefined): string {
  if (topCause === "walking") {
    return "Free Cam above both of you";
  }
  if (topCause && SCREEN_CAUSES.includes(topCause)) {
    return "Player Cam on you, then on them";
  }
  return "3rd Person on you, then on them";
}

/** Explain your ticks [y0, y1) against their ticks [t0, t1) */
function explainSpan(
  Y: Side,
  T: Side,
  y0: number,
  y1: number,
  t0: number,
  t1: number,
  jump: boolean,
): Finding {
  const you = Y.run;
  const them = T.run;
  const N = them.name;
  const lost = (y1 - y0 - (t1 - t0)) / 20;
  const kind = lost >= 0 ? "loss" : "gain";
  const sign = kind === "loss" ? 1 : -1;
  const st: Stretch = {
    Y,
    T,
    y0,
    y1,
    t0,
    t1,
    yActs: overlapping(you.actions, y0, y1),
    tActs: overlapping(them.actions, t0, t1),
  };
  const causes = activityCauses(st, N);

  // The rest can be the part of their window past the end of their run.
  const rest = lost - causes.reduce((s, c) => s + c.seconds, 0);
  if (Math.abs(rest) >= MIN_CAUSE_SECONDS) {
    causes.push({
      key: "other",
      seconds: rest,
      label: "Other",
      text: rest > 0 && t1 > them.end ? `${N}'s run had already ended.` : "Small differences.",
    });
  }
  causes.sort((a, b) => sign * (b.seconds - a.seconds));

  const notes = sideNotes(
    you,
    you.actions.filter((a) => inWin(a, y0, y1)),
    them.actions.filter((a) => inWin(a, t0, t1)),
    y1,
    N,
    kind === "loss",
  );

  const phase = you.phaseAt(y0);
  const main = causes
    .filter((c) => sign * c.seconds >= Math.max(MIN_CAUSE_SECONDS, Math.abs(lost) * 0.15))
    .slice(0, 2);
  const mainText = main.length
    ? main.map((c) => `${(c.label ?? c.key).toLowerCase()} (${fmtSec(-c.seconds)})`).join(" and ")
    : "no single cause";
  return {
    kind,
    seconds: Math.abs(lost),
    phase,
    you: [y0, y1],
    them: [t0, t1],
    headline: `${phase} ${fmtSec(-lost)}: ${mainText}`,
    causes: causes.filter((c) => Math.abs(c.seconds) >= MIN_CAUSE_SECONDS),
    notes,
    watch: {
      youAt: fmtTime(y0),
      themAt: fmtTime(t0),
      alignFrom: splitBefore(you, y0),
      alignTo: splitAfter(you, y1) ?? splitAfter(them, t1) ?? END_SPLIT,
      camera: cameraFor(main[0]?.key),
    },
    jump,
  };
}
