// Explains one stretch of the race. Splits the time diff by activity per tick then says what that actually was
import type { Vec3 } from "../replay/decode";
import { WORLDS } from "../replay/registries";
import { ACTIVITIES, ACTIVITY_LABEL, countActivities, type Activity, type ActivityTimeline } from "./activity";
import { END_SPLIT, START_SPLIT, SPLITS, fmtDur, fmtSec, fmtTime } from "./names";
import { Run, type Action, type ActionKind } from "./run";
import type { GapWindow } from "./windows";

export interface Cause { key: string; seconds: number; text: string; tag?: "local" | "route" | "speed"; label?: string }

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

export interface Side { run: Run; tl: ActivityTimeline }

const s0 = fmtDur;
const nice = (s: string) => s.replace(/^minecraft:/, "").replace(/_/g, " ");
const inWin = (a: Action, t0: number, t1: number) => a.t0 >= t0 && a.t0 < t1;
const tally = (acts: Action[], f: (a: Action) => string | undefined, w: (a: Action) => number = () => 1) => {
  const out: Record<string, number> = {};
  for (const a of acts) { const k = f(a); if (k && k !== "?") out[k] = (out[k] ?? 0) + w(a); }
  return out;
};
const near = (a: Vec3 | undefined, xs: Action[], d: number) => !!a && xs.some((b) => b.at && Math.hypot(a[0] - b.at[0], a[1] - b.at[1], a[2] - b.at[2]) <= d);

/** Blocks walked on walking ticks, teleports (respawn, pearl, portal) don't count */
function walked(side: Side, t0: number, t1: number): number {
  const pts = side.run.slice(t0, t1);
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (a.w !== b.w || ACTIVITIES[side.tl.act[a.t]] !== "walking") continue;
    const step = Math.hypot(b.x - a.x, b.z - a.z);
    if (step <= 2 + (b.t - a.t) * 0.6) d += step;
  }
  return d;
}

function splitBefore(r: Run, t: number): string {
  let name = START_SPLIT, best = -1;
  for (const [type, label] of SPLITS) { const s = r.splits.get(type); if (s !== undefined && s <= t && s > best) { best = s; name = label; } }
  return name;
}
function splitAfter(r: Run, t: number): string | null {
  let name: string | null = null, best = Infinity;
  for (const [type, label] of SPLITS) { const s = r.splits.get(type); if (s !== undefined && s >= t && s < best) { best = s; name = label; } }
  return name;
}

/** Chests grouped by position with visits and seconds */
function chestVisits(acts: Action[]) {
  const by = new Map<string, { visits: number; secs: number; at?: Vec3 }>();
  for (const a of acts) {
    const k = a.at ? a.at.join(",") : "?";
    const x = by.get(k) ?? { visits: 0, secs: 0, at: a.at };
    x.visits++; x.secs += (a.t1 - a.t0) / 20; by.set(k, x);
  }
  return [...by.values()];
}

export function explainWindow(Y: Side, T: Side, win: GapWindow): Finding {
  const [ys0, g0] = win.from, [ys1, g1] = win.to;
  return explainSpan(Y, T, ys0 * 20, ys1 * 20, (ys0 - g0) * 20, (ys1 - g1) * 20, win.jump);
}

/** Explain your ticks [y0, y1) against their ticks [t0, t1) */
export function explainSpan(Y: Side, T: Side, y0: number, y1: number, t0: number, t1: number, jump = false, phaseName?: string): Finding {
  const you = Y.run, them = T.run, N = them.name;
  const lost = ((y1 - y0) - (t1 - t0)) / 20;
  const kind = lost >= 0 ? "loss" : "gain";
  const sign = kind === "loss" ? 1 : -1;
  const cy = countActivities(Y.tl, y0, y1), ct = countActivities(T.tl, t0, t1);
  const ya = you.actions.filter((a) => inWin(a, y0, y1)), ta = them.actions.filter((a) => inWin(a, t0, t1));
  const of = (acts: Action[], k: ActionKind | ActionKind[]) => acts.filter((a) => (Array.isArray(k) ? k.includes(a.kind) : a.kind === k));
  // Long actions (screens, pie chart, mining) count if they overlap the stretch at all
  const DURING: ActionKind[] = ["craft", "inventory", "chest", "furnace", "villager", "screen", "pie", "mine", "mine_abandoned", "eat"];
  const ya2 = you.actions.filter((a) => DURING.includes(a.kind) ? a.t1 >= y0 && a.t0 < y1 : inWin(a, y0, y1));
  const ta2 = them.actions.filter((a) => DURING.includes(a.kind) ? a.t1 >= t0 && a.t0 < t1 : inWin(a, t0, t1));
  const causes: Cause[] = [];
  const notes: string[] = [];
  const inTrading = (side: Side, t: number) => side.tl.trading.some(([a, b]) => t >= a && t <= b + 20);

  for (const act of ACTIVITIES) {
    const a = cy[act], b = ct[act];
    if (Math.abs(a - b) < 1) continue;
    let text = "";
    let tag: Cause["tag"];
    const vs = `${s0(a)}, ${N} ${s0(b)}`;
    switch (act as Activity) {
      case "dead": {
        const yd = Y.tl.deaths.filter((d) => d.t >= y0 && d.t < y1), td = T.tl.deaths.filter((d) => d.t >= t0 && d.t < t1);
        text = [
          ...yd.map((d) => `You died at ${fmtTime(d.t)}${d.back !== null ? ` and were back at ${fmtTime(d.back)}` : " and never got back"}.`),
          ...td.map((d) => `${N} died at ${fmtTime(d.t)}.`),
        ].join(" ");
        const mobs = Object.keys(tally(of(ya2, "hit").filter((x) => yd.some((d) => x.t0 > d.t - 300 && x.t0 <= d.t)), (x) => x.what)).filter((m) => m !== "mob");
        if (yd.length && mobs.length) text = text.replace(/\.$/, ` (fighting ${mobs.map(nice).join(" and ")}s).`);
        break;
      }
      case "craft": text = `Crafting: you ${vs}.`; break;
      case "inventory": {
        const yo = of(ya2, "inventory"), duringTrades = yo.filter((x) => inTrading(Y, x.t0)).length;
        text = `Inventory open: you ${vs}.${duringTrades >= 2 && a > b ? " Mostly sorting trade loot." : ""}`;
        break;
      }
      case "chest": {
        const yv = chestVisits(of(ya2, "chest")), tv = chestVisits(of(ta2, "chest"));
        const repeats = yv.filter((x) => x.visits > 1).length;
        const onlyYou = yv.filter((x) => !near(x.at, them.actions.filter((x) => x.kind === "chest"), 3)).length;
        text = `You opened ${yv.length} chests, ${N} ${tv.length}.`;
        if (repeats) text += ` You reopened ${repeats}.`;
        if (onlyYou && a > b) text += ` ${onlyYou} of yours ${N} skipped.`;
        break;
      }
      case "furnace": text = `Furnace: you ${vs}.`; break;
      case "villager": text = `Villager trades: you ${vs}.`; break;
      case "screen": text = `Other menus: you ${vs}.`; break;
      case "pie": {
        const yo = of(ya2, "pie"), to = of(ta2, "pie");
        text = a < 1 ? `${N} had the pie chart up for ${s0(b)} with nothing else going on.` : `Pie chart up with nothing else going on: you ${yo.length} times, ${N} ${to.length}.`;
        break;
      }
      case "mining": {
        const yn = of(ya2, "mine").length, tn = of(ta2, "mine").length;
        text = yn === 0 && tn ? `${N} mined ${tn} blocks here; you didn't.` : `You mined ${yn} blocks, ${N} ${tn}.`;
        const gaveUp = of(ya2, "mine_abandoned").length;
        if (gaveUp >= 2) text += ` You gave up on ${gaveUp} halfway.`;
        break;
      }
      case "fighting": text = a < 1 ? `${N} fought for ${s0(b)}; you didn't.` : `Fighting: you ${vs}.`; break;
      case "eating": text = a < 1 ? `${N} stopped to eat for ${s0(b)}.` : `Eating: you ${vs}.`; break;
      case "placing": text = `You placed ${of(ya2, "place").length} blocks, ${N} ${of(ta2, "place").length}.`; break;
      case "pearl": text = `You threw ${of(ya2, ["pearl", "eye"]).length} pearls and eyes, ${N} ${of(ta2, ["pearl", "eye"]).length}.`; break;
      case "trading": {
        const piglins = (bs: Action[]) => new Set(bs.map((x) => x.id)).size;
        const yp = piglins(of(ya2, "barter")), tp = piglins(of(ta2, "barter"));
        text = `Waiting on trades: you ${vs}. You had ${yp} piglins, ${N} ${tp}.`;
        if (a > b && tp > yp + 1) text += ` More piglins trade faster.`;
        break;
      }
      case "pickup": text = `Picking up items: you ${vs}.`; break;
      case "walking": {
        const yp = walked(Y, y0, y1), tp = walked(T, t0, t1);
        const pts = you.slice(y0, y1).filter((p) => ACTIVITIES[Y.tl.act[p.t]] === "walking");
        const bw = pts.length ? Math.round(Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x))) : 0;
        const bh = pts.length ? Math.round(Math.max(...pts.map((p) => p.z)) - Math.min(...pts.map((p) => p.z))) : 0;
        if (yp < 5 || tp < 5) { tag = "route"; text = yp < 5 ? `${N} walked ${Math.round(tp)} blocks here that you didn't.` : `You walked ${Math.round(yp)} blocks here that ${N} didn't need.`; }
        else if (Math.max(bw, bh) < 30 && yp > Math.max(bw, bh) * 2.5 && yp > tp * 1.5 + 20) { tag = "local"; text = `Walking back and forth in the same spot: ${Math.round(yp)} blocks, ${N} ${Math.round(tp)}.`; }
        else if (yp > tp * 1.3 + 10 || tp > yp * 1.3 + 10) { tag = "route"; text = `${yp > tp ? "Your" : `${N}'s`} route was longer: ${Math.round(yp)} blocks, ${N} ${Math.round(tp)}.`; }
        else { tag = "speed"; text = `Same distance, you were ${a > b ? "slower" : "faster"}: ${vs}.`; }
        break;
      }
      case "looking": text = `Turning the camera, standing still: you ${vs}.`; break;
      case "paused": text = `Paused: you ${vs}.`; break;
      case "standing": text = `Standing still: you ${vs}.`; break;
    }
    const label = act === "walking"
      ? tag === "local" ? "Walking back and forth" : tag === "route" ? "Route" : "Walking speed"
      : ACTIVITY_LABEL[act as Activity];
    causes.push({ key: act, seconds: a - b, text, tag, label });
  }

  // Part of their window past the end of their run
  const rest = lost - causes.reduce((s, c) => s + c.seconds, 0);
  if (Math.abs(rest) >= 2) causes.push({ key: "other", seconds: rest, label: "Other",
    text: rest > 0 && t1 > them.end ? `${N}'s run had already ended.` : "Small differences." });
  causes.sort((a, b) => sign * (b.seconds - a.seconds));

  // Stuff worth knowing that isn't time on its own
  const dmg = (acts: Action[]) => acts.filter((a) => a.kind === "damage").reduce((s, a) => s + (a.amount ?? 0), 0) / 2;
  const yh = dmg(ya), th = dmg(ta);
  if (Math.abs(yh - th) >= 3) notes.push(`You took ${yh} hearts of damage, ${N} ${th}.`);
  const yPortals = of(ya, "portal"), tPortals = of(ta, "portal");
  for (const p of yPortals) {
    const q = tPortals.find((x) => x.w === p.w && x.to === p.to);
    if (q && p.at && q.at && Math.hypot(p.at[0] - q.at[0], p.at[2] - q.at[2]) > 30)
      notes.push(`You used a different portal to the ${WORLDS[p.to!]}.`);
  }
  if (kind === "loss") {
    const byItem = new Map<string, { n: number; secs: number }>();
    for (const a of of(ya, "mine").filter((x) => x.item && x.item !== "?")) { const x = byItem.get(a.item!) ?? { n: 0, secs: 0 }; x.n += a.count ?? 1; x.secs += (a.t1 - a.t0) / 20; byItem.set(a.item!, x); }
    const atEnd = you.invAt(you.end), afterWin = you.invAt(y1);
    for (const [it, x] of byItem) if (x.secs >= 2 && (afterWin.get(it) ?? 0) >= x.n && (atEnd.get(it) ?? 0) >= x.n)
      notes.push(`You mined ${x.n} ${nice(it)} and never used it (${s0(x.secs)}).`);
  }

  const phase = phaseName ?? you.phaseAt(y0);
  const main = causes.filter((c) => sign * c.seconds >= Math.max(2, Math.abs(lost) * 0.15)).slice(0, 2);
  const headline = `${phase} ${fmtSec(-lost)}: ${main.length ? main.map((c) => `${(c.label ?? c.key).toLowerCase()} (${fmtSec(-c.seconds)})`).join(" and ") : "no single cause"}`;
  const top = main[0]?.key;
  const camera = top === "walking" ? "Free Cam above both of you" : top && ["craft", "inventory", "chest", "pie"].includes(top) ? "Player Cam on you, then on them" : "3rd Person on you, then on them";
  return {
    kind, seconds: Math.abs(lost), phase, you: [y0, y1], them: [t0, t1], headline,
    causes: causes.filter((c) => Math.abs(c.seconds) >= 2), notes,
    watch: { youAt: fmtTime(y0), themAt: fmtTime(t0), alignFrom: splitBefore(you, y0), alignTo: splitAfter(you, y1) ?? splitAfter(them, t1) ?? END_SPLIT, camera },
    jump,
  };
}
