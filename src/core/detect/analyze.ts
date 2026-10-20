// Race analysis, you vs them on the same seed in one replay
import type { Replay } from "../replay/decode";
import { alignRuns, type GapPoint } from "./align";
import { buildActivities } from "./activity";
import { explainWindow, type Finding } from "./explain";
import { Facts } from "./facts";
import { DEFAULT_LEAVE, phaseNotes, type LeaveGoals, type Note, type Side } from "./findings";
import { Run } from "./run";
import { buildSteps, type Step, type StepKind } from "./steps";
import { findWindows } from "./windows";
import { phaseWhy, type Part } from "./why";
import { dragonFight, type DragonFight } from "./end";
import { blazeBedBlasts, overworldCrafts, pearlsThrown, precrafts, tradeSummary, type Blast, type CraftScreen, type Precraft, type TradeItem } from "./stats";

/** From entering the End to the end of the run */
const endSpan = (r: Run): [number, number] | undefined => { const e = r.mark("end"); return e === undefined ? undefined : [e, r.end]; };

export { DEFAULT_LEAVE, type LeaveGoals } from "./findings";

export const ANALYSIS_VERSION = 44;

export interface RunnerInfo { uuid: string; name: string; elo: number | null; finished: boolean; endTicks: number; quit?: boolean }

export interface Claim {
  file: string;
  uuid: string;
  phase: string;
  line: string;
  claim: string;
  evidenceTicks: number[];
}

export interface RaceAnalysis {
  analysisVersion: number;
  createdAt: number;
  seed: { overworld: string; nether: string };
  you: RunnerInfo;
  them: RunnerInfo;
  /** Positive = you were behind at the end of the comparison */
  finalGap: number;
  matchedSeconds: number;
  totalSeconds: number;
  curve: GapPoint[];
  /** Ranked splits plus "Left the Bastion" */
  splits: { name: string; you: number | null; them: number | null }[];
  /** How much the gap changed in each phase */
  phases: { name: string; change: number }[];
  losses: Finding[];
  gains: Finding[];
  /** Per phase, exact time lost and what it went to */
  report: PhaseReport[];
  /** Each blaze rod each of you picked up: when it dropped and when you got it */
  rods?: { you: { dropped: number; got: number }[]; them: { dropped: number; got: number }[] };
  /** When each of you killed each blaze */
  blazeKills?: { you: number[]; them: number[] };
  /** Precrafts, pearls on the way to the fortress, blaze bed explosives and the bastion trade overview */
  stats?: { you: RunStats; them: RunStats };
  /** Dragon fight for each of you if you got to the End */
  end?: { you: DragonFight | null; them: DragonFight | null };
  /** Only when opts.debugClaims is set */
  claims?: Claim[];
}

export interface RunStats {
  precrafts: Precraft[];
  /** Crafting and furnace screens before the Nether, with what each made */
  owCrafts?: CraftScreen[];
  /** Pearl throws from leaving the bastion to entering the fortress */
  pearlsToFort: number[];
  blasts: Blast[];
  trades: {
    n: number;
    /** The trade that covered what you used later, null if none did or none were needed */
    needed: { n: number; t: number } | null;
    noneNeeded: boolean;
    got: Partial<Record<TradeItem, number>>;
    left: Partial<Record<TradeItem, number>>;
    leftWith: Partial<Record<TradeItem, number>>;
    used: Partial<Record<TradeItem, number>>;
    /** What each barter gave, in order (same order for everyone on the seed) */
    items: Record<string, number>[];
    /** Pickups from barter drops with your running total of that item */
    pickups: { t: number; item: TradeItem; total: number }[];
  } | null;
}

function runStats(s: Side): RunStats {
  const r = s.run, l = r.mark("bastion_left"), f = r.mark("fortress");
  const ts = tradeSummary(r);
  return {
    precrafts: precrafts(s),
    owCrafts: overworldCrafts(s),
    pearlsToFort: l !== undefined && f !== undefined && f > l ? pearlsThrown(r, l, f) : [],
    blasts: blazeBedBlasts(s),
    trades: ts && { n: ts.barters.length, needed: ts.needed, noneNeeded: ts.noneNeeded, got: ts.got, left: ts.left, leftWith: ts.leftWith, used: ts.used, items: ts.barters.map((b) => b.items), pickups: ts.pickups },
  };
}

export interface PhaseReport {
  phase: string;
  /** How much the gap changed here; + = you lost time */
  change: number | null;
  /** Your run ended inside this phase */
  unfinished: boolean;
  /** Their run ended in this phase (quit or replay stops) so there's nothing to compare */
  theirsEnded: boolean;
  /** Seconds each of you spent in the phase */
  you: number | null;
  them: number | null;
  /** The time diff split into parts, adds up to `change` */
  why: Part[];
  /** Plain facts about what happened */
  notes: Note[];
  /** Seconds each of you spent on each kind of step */
  compare: { kind: StepKind; label: string; you: number; them: number }[];
  /** Play-by-play */
  steps: { you: Step[]; them: Step[] };
}

const PHASE_ORDER = ["Overworld", "Nether travel", "Fortress", "Bastion", "Bastion to fortress", "Fortress to stronghold", "Bastion to blind", "After the bastion", "Stronghold", "End"];

/** Each phase's time span for one runner */
function phaseSpans(r: Run): Map<string, [number, number][]> {
  const out = new Map<string, [number, number][]>();
  const push = (name: string, a: number, b: number) => { if (b > a) out.set(name, [...(out.get(name) ?? []), [a, b]]); };
  push("Overworld", 0, r.marks[0]?.t ?? r.end);
  r.marks.forEach((m, i) => push(r.phaseAfter(i), m.t, r.marks[i + 1]?.t ?? r.end));
  return out;
}

function phaseChanges(you: Run, them: Run, finalGap: number) {
  const out: { name: string; change: number }[] = [];
  let prevGap = 0, phase = "Overworld";
  you.marks.forEach((m, i) => {
    const b = them.mark(m.key);
    if (b === undefined) return;
    const gap = (m.t - b) / 20;
    out.push({ name: phase, change: gap - prevGap });
    prevGap = gap; phase = you.phaseAfter(i);
  });
  if (phase !== "Finished") out.push({ name: phase, change: finalGap - prevGap });
  const merged: { name: string; change: number }[] = [];
  for (const p of out) { const last = merged.find((x) => x.name === p.name); if (last) last.change += p.change; else merged.push({ ...p }); }
  return merged;
}

function buildReport(phases: { name: string; change: number }[], Y: Side, T: Side, finalGap: number, goals: LeaveGoals): PhaseReport[] {
  const ys = phaseSpans(Y.run), ts = phaseSpans(T.run);
  const names = [...new Set([...phases.map((p) => p.name), ...ys.keys()])].filter((n) => n !== "Finished").sort((a, b) => PHASE_ORDER.indexOf(a) - PHASE_ORDER.indexOf(b));
  return names.map((phase) => {
    // A phase can come in pieces (fortress, blind, Eye Spy), take it whole
    const whole = (xs?: [number, number][]) => (xs?.length ? [xs[0][0], xs.at(-1)![1]] as [number, number] : undefined);
    const y = whole(ys.get(phase)), t = whole(ts.get(phase));
    // Unfinished last phase ends where the gap curve ends
    let tEnd = t;
    let change = phases.find((p) => p.name === phase)?.change ?? null;
    const len = (sp?: [number, number]) => (sp ? (sp[1] - sp[0]) / 20 : null);
    if (t && y && y[1] === Y.run.end && !Y.run.finished) {
      // Compare up to where they were when your run ended
      const cut = y[1] - finalGap * 20;
      tEnd = [t[0], Math.min(t[1], Math.max(t[0], cut))];
      // They did the whole phase faster than you spent in it, so you're at least that much slower
      if (cut >= t[1]) change = len(y)! > len(t)! ? len(y)! - len(t)! : null;
    }
    // They stopped here (quit or replay ended), nothing to compare
    const theirsCut = !!t && t[1] >= T.run.end && !T.run.finished && !(y && y[1] >= Y.run.end && !Y.run.finished);
    if (theirsCut) change = null;
    const r = phaseNotes(phase, Y, T, y, theirsCut ? undefined : tEnd, goals);
    return { phase, change, unfinished: !!y && y[1] === Y.run.end && !Y.run.finished, theirsEnded: theirsCut, you: len(y), them: len(t),
      why: theirsCut ? [] : phaseWhy(phase, Y, T, y, tEnd, change, goals), ...r };
  });
}

/** Where "6 Blaze Rods" happened between the splits */
function withRods(splits: RaceAnalysis["splits"], you: Run, them: Run): RaceAnalysis["splits"] {
  const y = you.rodsAt(ROD_GOAL), t = them.rodsAt(ROD_GOAL);
  if (y === null && t === null) return splits;
  const at = y ?? t!;
  const i = splits.findIndex((s) => (s.you ?? s.them ?? Infinity) > at);
  const row = { name: `${ROD_GOAL} Blaze Rods`, you: y, them: t };
  return i < 0 ? [...splits, row] : [...splits.slice(0, i), row, ...splits.slice(i)];
}
export const ROD_GOAL = 6;

export function analyzeRace(replay: Replay, youUuid: string, themUuid: string, opts: { leave?: LeaveGoals; debugClaims?: boolean; file?: string } = {}): RaceAnalysis {
  const mk = (uuid: string) => {
    const ev = replay.events.get(uuid);
    if (!ev) throw new Error(`no data for player ${uuid} in this replay`);
    const p = replay.meta.players.find((x) => x.uuid === uuid);
    return new Run(uuid, p?.nickname ?? uuid, ev, replay.timelines);
  };
  const you = mk(youUuid), them = mk(themUuid);
  const goals = opts.leave ?? DEFAULT_LEAVE;
  const side = (r: Run): Side => { const tl = buildActivities(r), facts = new Facts(r); return { run: r, tl, facts, steps: buildSteps(r, tl, facts) }; };
  const Y = side(you), T = side(them);
  const { points, matched, total } = alignRuns(you, them);
  const findings = findWindows(points).map((w) => explainWindow(Y, T, w));
  const both = you.finished && them.finished;
  const fin = (r: Run) => r.mark("finish") ?? r.end;
  const finalGap = both ? (fin(you) - fin(them)) / 20 : points.at(-1)![1];
  const info = (r: Run): RunnerInfo => ({
    uuid: r.uuid, name: r.name, finished: r.finished, endTicks: r.end, quit: r.quit,
    elo: (replay.meta.players.find((p) => p.uuid === r.uuid)?.eloRate as number | null | undefined) ?? null,
  });
  const phases = phaseChanges(you, them, finalGap);
  const keys = [...you.marks, ...them.marks].sort((a, b) => a.t - b.t).map((m) => m.key).filter((k, i, a) => a.indexOf(k) === i);
  const report = buildReport(phases, Y, T, finalGap, goals);
  let claims: Claim[] | undefined;
  if (opts.debugClaims) {
    const file = opts.file ?? String(replay.meta.matchId ?? "");
    claims = [];
    for (const p of report) {
      for (const w of p.why) {
        const ticks = [w.at?.you, w.at?.them].filter((t): t is number => t !== undefined);
        claims.push({ file, uuid: youUuid, phase: p.phase, line: `${w.label}: ${w.text}`, claim: `why:${w.key} (${w.seconds >= 0 ? "+" : ""}${w.seconds.toFixed(1)}s)`, evidenceTicks: ticks });
      }
      for (const n of p.notes) {
        const ticks = [n.at?.you, n.at?.them].filter((t): t is number => t !== undefined);
        claims.push({ file, uuid: youUuid, phase: p.phase, line: n.text, claim: `note (${n.seconds !== null ? (n.seconds >= 0 ? "+" : "") + n.seconds.toFixed(1) + "s" : "info"})`, evidenceTicks: ticks });
      }
      for (const s of p.steps.you) {
        claims.push({ file, uuid: youUuid, phase: p.phase, line: s.text, claim: `step:you:${s.kind}`, evidenceTicks: [s.t0, s.t1] });
      }
      for (const s of p.steps.them) {
        claims.push({ file, uuid: themUuid, phase: p.phase, line: s.text, claim: `step:them:${s.kind}`, evidenceTicks: [s.t0, s.t1] });
      }
    }
  }
  return {
    analysisVersion: ANALYSIS_VERSION,
    createdAt: Date.now(),
    seed: { overworld: replay.meta.overworldSeed, nether: replay.meta.netherSeed },
    you: info(you), them: info(them),
    finalGap, matchedSeconds: matched, totalSeconds: total, curve: points,
    rods: { you: you.rodTimes(), them: them.rodTimes() },
    stats: { you: runStats(Y), them: runStats(T) },
    blazeKills: { you: Y.facts.kills.filter((k) => k.entity === "blaze").map((k) => k.t), them: T.facts.kills.filter((k) => k.entity === "blaze").map((k) => k.t) },
    splits: withRods(keys.map((k) => ({ name: (you.marks.find((m) => m.key === k) ?? them.marks.find((m) => m.key === k))!.label, you: you.mark(k) ?? null, them: them.mark(k) ?? null })), you, them),
    phases,
    report,
    end: { you: dragonFight(Y, endSpan(you)), them: dragonFight(T, endSpan(them)) },
    losses: findings.filter((f) => f.kind === "loss").sort((a, b) => b.seconds - a.seconds),
    gains: findings.filter((f) => f.kind === "gain").sort((a, b) => b.seconds - a.seconds),
    ...(claims ? { claims } : {}),
  };
}
