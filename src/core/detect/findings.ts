import type { ActivityTimeline } from "./activity";
import { Facts } from "./facts";
import { fmtDur, fmtTime } from "./names";
import { cycleName, dragonFight, perchLines } from "./end";
import { Run } from "./run";
import { itemName, stepTotals, STEP_LABEL, type Step, type StepKind } from "./steps";
import { eyesFor } from "./why";
import {
  bastionSpan,
  missedChests,
  simulateTrades,
  tradesDone,
  SPLIT_LABEL,
  tradeView,
  type Split,
  type SplitKey,
} from "./bastion";
import { runMechanicNotes } from "./mechanics";
import { statNotes } from "./stat-notes";

export interface Side {
  run: Run;
  tl: ActivityTimeline;
  facts: Facts;
  steps: Step[];
}
export interface Note {
  text: string;
  /** Set only when the note compares the same measured thing for both of you */
  seconds: number | null;
  at?: { you?: number; them?: number };
}
export type Span = [number, number] | undefined;

/** What you need to leave the bastion, anything past this isn't needed */
export interface LeaveGoals {
  ender_pearl: number;
  obsidian: number;
  string: number;
}
export const DEFAULT_LEAVE: LeaveGoals = { ender_pearl: 20, obsidian: 20, string: 64 };

const dur = (t: number) => fmtDur(t / 20);
const KEEP =
  /ender_pearl|obsidian|^string$|blaze_rod|ender_eye|_bed$|gold_ingot|gold_block|flint_and_steel|fire_charge|lava_bucket|water_bucket|respawn_anchor|glowstone/;

/** Goal items with a count above zero, as [item, count] */
export function wantedGoals(goals: LeaveGoals): [string, number][] {
  return (Object.entries(goals) as [string, number][]).filter(([, n]) => n > 0);
}

/** When you had all the bastion goals, or null */
export function enoughAt(r: Run, goals: LeaveGoals): number | null {
  const span = bastionSpan(r);
  if (!span) {
    return null;
  }
  const [b, l] = span;
  const items = wantedGoals(goals);
  if (!items.length) {
    return null;
  }
  const ts = items.map(([it, n]) => r.firstReach(it, n, b, l));
  return ts.every((x) => x !== null) ? Math.max(...(ts as number[])) : null;
}

function deathCause(s: Side, t: number): string {
  const r = s.run;
  const here = r.posAt(t);
  if (here.w === 2 && here.y < 30) {
    return "fell into the void";
  }
  const ownBed =
    here.w === 2 &&
    s.facts.explosions.some((x) => x.w === 2 && x.power === 5 && x.t >= t - 10 && x.t <= t);
  if (ownBed) {
    return "own bed";
  }
  const hits = s.facts.hurt.filter((h) => h.t >= t - 100 && h.t <= t);
  const mobs = [...new Set(hits.map((h) => h.by).filter(Boolean))] as string[];
  if (mobs.length) {
    return mobs.map((m) => m.replace(/_/g, " ")).join(", ");
  }
  const ys = r
    .slice(t - 60, t)
    .filter((p) => p.w === here.w)
    .map((p) => p.y);
  const fell = ys.length ? Math.max(...ys) - here.y : 0;
  return fell >= 4 ? `fell ${Math.round(fell)} blocks` : "no mob";
}

/** Up to four kept items lost in a death, most first */
function itemsLost(r: Run, t: number): string[] {
  const before = r.invAt(t - 2);
  const after = r.invAt(t + 40);
  return [...before.entries()]
    .filter(([it, n]) => KEEP.test(it) && n - (after.get(it) ?? 0) > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([it, n]) => `${n - (after.get(it) ?? 0)} ${itemName(it)}`);
}

function deaths(s: Side, sp: Span, who: string): Note[] {
  if (!sp) {
    return [];
  }
  const isYou = who === "You";
  const out: Note[] = [];
  for (const d of s.tl.deaths.filter((x) => x.t >= sp[0] && x.t < sp[1])) {
    const at = isYou ? { you: d.t } : { them: d.t };
    const spawn = d.reset === "bed" ? "a bed" : "an anchor";
    if (d.reset && !d.warp) {
      out.push({
        text: `${isYou ? "Death reset" : `${who}: death reset`} with ${spawn} · full health and hunger, items back ${dur(d.until - d.t)} later`,
        seconds: null,
        at,
      });
      continue;
    }
    const cause = deathCause(s, d.t);
    let text = d.warp
      ? `${isYou ? "Death warp" : `${who}: death warp`} to ${spawn} (${cause})`
      : `${isYou ? "Died" : `${who} died`} (${cause})`;
    const lost = itemsLost(s.run, d.t);
    if (lost.length) {
      text += ` · lost ${lost.join(", ")}`;
    }
    if (!d.warp) {
      text += d.back !== null ? ` · back ${dur(d.back - d.t)} later` : " · never got back";
    }
    out.push({ text, seconds: null, at });
  }
  return out;
}

function tradingStart(s: Side, b: number, l: number): number | null {
  const trades = s.steps.filter((x) => x.kind === "trade" && x.t0 < l && x.t1 > b);
  return trades.length ? Math.max(b, trades[0].t0) : null;
}

/** The three biggest piglin anger bursts in your bastion, in time order */
function angerNotes(Y: Side): Note[] {
  const span = bastionSpan(Y.run);
  if (!span) {
    return [];
  }
  const [yb, yl] = span;
  const tradeStart = tradingStart(Y, yb, yl);
  const biggest = Y.facts.anger
    .filter((a) => a.t >= yb && a.t <= yl)
    .sort((p, q) => q.n - p.n)
    .slice(0, 3)
    .sort((p, q) => p.t - q.t);
  return biggest.map((a) => {
    const resume = Y.facts.pigs.find((x) => x.t > a.t && x.barter > 0)?.t;
    const wasTrading = Y.facts.pigs.some((x) => x.t >= a.t - 40 && x.t <= a.t && x.barter > 0);
    const stop =
      !wasTrading && tradeStart !== null && a.t >= tradeStart - 200 && resume && resume - a.t >= 60
        ? ` · no trades till ${fmtTime(resume)}`
        : "";
    const cause = a.cause
      ? ` (${a.cause
          .replace(/^mining /, "mined ")
          .replace(/^hitting /, "hit ")
          .replace(/^opening /, "opened ")})`
      : "";
    return { text: `${a.n} piglins angry${cause}${stop}`, seconds: null, at: { you: a.t } };
  });
}

/** Median piglins bartering at once while trading, counting only samples with any */
function usualTraders(s: Side, start: number, end: number): number {
  const counts = s.facts
    .samples(start, end)
    .map((x) => x.barter)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  return counts.length ? counts[counts.length >> 1] : 0;
}

/** When you could have left with more piglins or their chests, and what you did while trading */
function tradingNotes(Y: Side, T: Side, N: string, goals: LeaveGoals): Note[] {
  const y = tradeView(Y, goals);
  const t = tradeView(T, goals);
  if (!y) {
    return [];
  }
  const list = (sp: Split) =>
    (Object.entries(sp.secs) as [SplitKey, number][])
      .filter(([, v]) => v >= 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k, v]) => `${SPLIT_LABEL[k].toLowerCase()} ${dur(v * 20)}`)
      .join(" · ");
  const out: Note[] = [];
  // Time after trades (pickup and walking out) counts as long as it took you, at most 10 s.
  const doneAt = tradesDone(Y.run, goals)?.t ?? y.enough;
  const leaveAfter = doneAt !== null ? Math.min(y.left - doneAt, 200) : 0;
  const usual = usualTraders(Y, y.start, y.enough ?? y.left);
  const seen = Math.max(
    ...Y.facts.samples(y.start, y.enough ?? y.left).map((x) => x.barter + x.seek),
    0,
  );
  const tUsual = t ? usualTraders(T, t.start, t.enough ?? t.left) : 0;
  const scen: string[] = [];
  const add = (label: string, done: number | null) => {
    if (done === null || doneAt === null || done >= doneAt - 40) {
      return false;
    }
    scen.push(`~${fmtTime(done + leaveAfter)} ${label}`);
    return true;
  };
  if (seen > usual) {
    add(`with all ${seen} piglins trading`, simulateTrades(Y, goals, seen));
  }
  if (tUsual > seen) {
    add(`${tUsual} at once like ${N}`, simulateTrades(Y, goals, tUsual));
  }
  const missed = missedChests(Y, T, goals);
  let chestAt: number | undefined;
  if (missed.length) {
    const extra: Record<string, number> = {};
    for (const c of missed) {
      for (const [k, n] of Object.entries(c.got)) {
        extra[k] = (extra[k] ?? 0) + n;
      }
    }
    const what = Object.entries(extra)
      .map(([k, n]) => `${n} ${itemName(k)}`)
      .join(", ");
    if (
      add(`plus ${N}'s chest (${what})`, simulateTrades(Y, goals, Math.max(seen, usual), extra))
    ) {
      chestAt = missed[0].t;
    }
  }
  if (scen.length) {
    out.push({
      text: `Could have left: ${scen.join(" · ")} (you left ${fmtTime(y.left)})`,
      seconds: null,
      at: { you: y.start, them: chestAt },
    });
  }
  out.push({
    text: `While trading: ${list(y.during) || "—"}`,
    seconds: null,
    at: { you: y.start, them: t?.start },
  });
  return out;
}

/** Time from entering the fortress to 6 rods, unless you blinded first and came back for them */
function rodsNote(Y: Side, T: Side): Note[] {
  const m = (s: Side) => {
    const f = s.run.mark("fortress");
    const r = s.run.rodsAt(6);
    const bl = s.run.mark("blind");
    return f !== undefined && r !== null && r > f && !(bl !== undefined && bl < r)
      ? { f, r }
      : null;
  };
  const y = m(Y);
  const t = m(T);
  if (!y && !t) {
    return [];
  }
  const d = (x: { f: number; r: number } | null) => (x ? dur(x.r - x.f) : "—");
  return [
    {
      text: `6 rods: ${d(y)} vs ${d(t)} after entering the fortress`,
      seconds: y && t ? (y.r - y.f - (t.r - t.f)) / 20 : null,
      at: { you: y?.r, them: t?.r },
    },
  ];
}

/** Rods each of you blinded with. Fewer rods just moves time to later */
function blindNote(Y: Side, T: Side): Note[] {
  const m = (s: Side) => {
    const b = s.run.mark("blind");
    if (b === undefined) {
      return null;
    }
    const inv = s.run.invAt(b - 1);
    const g = (k: string) => inv.get(k) ?? 0;
    const rods = g("blaze_rod") + Math.ceil((g("blaze_powder") + g("ender_eye")) / 2);
    const back = s.run.slice(b, s.run.mark("end") ?? s.run.end).filter((p) => p.w === 1);
    return {
      b,
      rods,
      eyes: eyesFor(s, b - 1),
      back: back.length ? ([back[0].t, back.at(-1)!.t] as const) : null,
    };
  };
  const y = m(Y);
  const t = m(T);
  if (!y) {
    return [];
  }
  return [
    {
      text: `Blinded with ${y.rods} vs ${t?.rods ?? "—"} rods (${y.eyes} vs ${t?.eyes ?? "—"} eyes)${y.back ? ` · back in the Nether ${fmtTime(y.back[0])}–${fmtTime(y.back[1])}` : ""}`,
      seconds: null,
      at: { you: y.b, them: t?.b },
    },
  ];
}

function strongholdNote(Y: Side, T: Side, ys: Span, ts: Span): Note[] {
  const m = (s: Side, sp: Span) => {
    if (!sp) {
      return null;
    }
    const eyes = s.facts.eyes.filter((e) => e.t0 >= sp[0] && e.t0 < sp[1]);
    return {
      thrown: eyes.length,
      broke: eyes.filter((e) => e.broke).length,
      filled: s.facts.framesFilled.filter((t) => t >= sp[0] && t < sp[1]).length,
    };
  };
  const a = m(Y, ys);
  const b = m(T, ts);
  if (!a || (!a.thrown && !a.filled)) {
    return [];
  }
  return [
    {
      text: `Eyes: ${a.thrown} vs ${b?.thrown ?? "—"} thrown · ${a.broke} vs ${b?.broke ?? "—"} broke`,
      seconds: null,
    },
  ];
}

function endNote(Y: Side, T: Side, ys: Span, ts: Span, N: string): Note[] {
  const a = dragonFight(Y, ys);
  const b = dragonFight(T, ts);
  if (!a) {
    return [];
  }
  const out: Note[] = [
    {
      text: `Dragon: ${cycleName(a)} vs ${b ? cycleName(b) : "—"} · ${a.beds.length} vs ${b?.beds.length ?? "—"} beds · ${a.crystals} vs ${b?.crystals ?? "—"} crystals shot`,
      seconds: null,
    },
  ];
  for (const l of perchLines(a)) {
    out.push({ text: `You: ${l.text}`, seconds: null, at: { you: l.t } });
  }
  if (b) {
    for (const l of perchLines(b)) {
      out.push({ text: `${N}: ${l.text}`, seconds: null, at: { them: l.t } });
    }
  }
  const clock = (t: number | null) => (t === null ? "—" : fmtTime(t));
  out.push({
    text: `Free the End: ${clock(a.kill)} vs ${clock(b?.kill ?? null)}`,
    seconds: null,
    at: { you: a.kill ?? undefined, them: b?.kill ?? undefined },
  });
  out.push({
    text: `Finished: ${clock(a.done)} vs ${clock(b?.done ?? null)}${a.done === null ? " · you didn't finish" : ""}`,
    seconds: null,
    at: { you: a.done ?? undefined, them: b?.done ?? undefined },
  });
  return out;
}

/** All notes for a phase plus what the time went to for both of you */
export function phaseNotes(phase: string, Y: Side, T: Side, ys: Span, ts: Span, goals: LeaveGoals) {
  const N = T.run.name;
  const notes: Note[] = [];
  if (phase === "Bastion") {
    notes.push(...tradingNotes(Y, T, N, goals), ...angerNotes(Y));
  }
  if (phase === "Fortress") {
    notes.push(...rodsNote(Y, T));
  }
  if (phase === "Fortress to stronghold") {
    notes.push(...blindNote(Y, T));
  }
  if (phase === "Stronghold" || phase === "Fortress to stronghold") {
    notes.push(...strongholdNote(Y, T, ys, ts));
  }
  if (phase === "End") {
    notes.push(...endNote(Y, T, ys, ts, N));
  }
  notes.push(...deaths(Y, ys, "You"), ...deaths(T, ts, N));
  notes.push(...runMechanicNotes(phase, Y, T, ys, ts));
  notes.push(...statNotes(phase, Y, T, ys, ts));

  const cy = ys ? stepTotals(Y.steps, ys[0], ys[1]) : {};
  const ct = ts ? stepTotals(T.steps, ts[0], ts[1]) : {};
  const compare = (Object.keys(STEP_LABEL) as StepKind[])
    .map((k) => ({ kind: k, label: STEP_LABEL[k], you: cy[k] ?? 0, them: ct[k] ?? 0 }))
    .filter((c) => Math.max(c.you, c.them) >= 2)
    .sort((p, q) => Math.abs(q.you - q.them) - Math.abs(p.you - p.them));
  const inSpan = (s: Side, sp: Span) =>
    sp ? s.steps.filter((x) => x.t0 >= sp[0] && x.t0 < sp[1]) : [];
  return { notes, compare, steps: { you: inSpan(Y, ys), them: inSpan(T, ts) } };
}
