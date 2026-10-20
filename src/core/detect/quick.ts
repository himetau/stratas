// Quick race from Ranked's API splits, for when you've played a seed but the replays aren't here (yet)
// Same splits and phases as a full race, just no gap curve, reasons or play-by-play
import type { TimelineEntry } from "../replay/decode";
import { ANALYSIS_VERSION, PHASE_ORDER, phaseChanges, phaseSpans, type PhaseReport, type RaceAnalysis } from "./analyze";
import { Run } from "./run";

export interface QuickRunner { matchId: number; uuid: string; name: string; elo: number | null; timelines: TimelineEntry[]; seconds: number }

export function quickRace(you: QuickRunner, them: QuickRunner, seed: { overworld: string; nether: string }): RaceAnalysis {
  // Runs end at their last split, or when they reset or finished if that came later
  const run = (r: QuickRunner) => {
    const end: TimelineEntry = { uuid: r.uuid, time: r.seconds * 1000, type: "stratas.end" };
    return new Run(r.uuid, r.name, [], [...r.timelines.filter((e) => e.uuid === r.uuid), end]);
  };
  const y = run(you), t = run(them);
  // Gap at the end: finish times if both finished, otherwise at the last split you both reached
  const shared = y.marks.filter((m) => t.mark(m.key) !== undefined).at(-1);
  const finalGap = y.finished && t.finished ? (y.mark("finish")! - t.mark("finish")!) / 20 : shared ? (shared.t - t.mark(shared.key)!) / 20 : 0;
  const phases = phaseChanges(y, t, finalGap);
  const ys = phaseSpans(y), ts = phaseSpans(t);
  const whole = (xs?: [number, number][]) => (xs?.length ? (xs.at(-1)![1] - xs[0][0]) / 20 : null);
  const names = [...new Set([...phases.map((p) => p.name), ...ys.keys()])].filter((n) => n !== "Finished").sort((a, b) => PHASE_ORDER.indexOf(a) - PHASE_ORDER.indexOf(b));
  const report: PhaseReport[] = names.map((phase) => {
    const yEnd = ys.get(phase)?.at(-1)?.[1], tEnd = ts.get(phase)?.at(-1)?.[1];
    const unfinished = yEnd === y.end && !y.finished, theirsEnded = tEnd === t.end && !t.finished && !unfinished;
    // A phase only one of you got through says nothing about the gap
    const change = unfinished || theirsEnded ? null : phases.find((p) => p.name === phase)?.change ?? null;
    return { phase, change, unfinished, theirsEnded, you: whole(ys.get(phase)), them: whole(ts.get(phase)), why: [], notes: [], compare: [], steps: { you: [], them: [] } };
  });
  const keys = [...y.marks, ...t.marks].sort((a, b) => a.t - b.t).map((m) => m.key).filter((k, i, a) => a.indexOf(k) === i);
  const info = (r: Run, q: QuickRunner) => ({ uuid: q.uuid, name: q.name, elo: q.elo, finished: r.finished, endTicks: r.end });
  return {
    analysisVersion: ANALYSIS_VERSION,
    createdAt: Date.now(),
    seed,
    you: info(y, you), them: info(t, them),
    finalGap, matchedSeconds: 0, totalSeconds: y.end / 20, curve: [],
    splits: keys.map((k) => ({ name: (y.marks.find((m) => m.key === k) ?? t.marks.find((m) => m.key === k))!.label, you: y.mark(k) ?? null, them: t.mark(k) ?? null })),
    phases, report, losses: [], gains: [],
    quick: { yourMatch: you.matchId, theirMatch: them.matchId, ironPick: you.timelines.some((e) => e.uuid === you.uuid && e.type === "story.iron_tools") },
  };
}
