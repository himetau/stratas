import type { TimelineEntry } from "../replay/decode";
import {
  ANALYSIS_VERSION,
  PHASE_ORDER,
  phaseChanges,
  phaseSpans,
  type PhaseReport,
  type RaceAnalysis,
} from "./analyze";
import { Run } from "./run";

export interface QuickRunner {
  matchId: number;
  uuid: string;
  name: string;
  elo: number | null;
  timelines: TimelineEntry[];
  seconds: number;
}

/** Run from Ranked's API splits, ending at the last split or when they reset or finished if later */
function splitsRun(r: QuickRunner): Run {
  const end: TimelineEntry = { uuid: r.uuid, time: r.seconds * 1000, type: "stratas.end" };
  return new Run(r.uuid, r.name, [], [...r.timelines.filter((e) => e.uuid === r.uuid), end]);
}

/** Finish time gap if both finished, otherwise the gap at the last split you both reached */
function endGap(y: Run, t: Run): number {
  if (y.finished && t.finished) {
    return (y.mark("finish")! - t.mark("finish")!) / 20;
  }
  const shared = y.marks.filter((m) => t.mark(m.key) !== undefined).at(-1);
  return shared ? (shared.t - t.mark(shared.key)!) / 20 : 0;
}

/** Seconds from the start of the first span to the end of the last */
const spannedSeconds = (spans?: [number, number][]) =>
  spans?.length ? (spans.at(-1)![1] - spans[0][0]) / 20 : null;

/** Race from Ranked's API splits alone: same splits and phases as a full race, no gap curve or reasons */
export function quickRace(
  you: QuickRunner,
  them: QuickRunner,
  seed: { overworld: string; nether: string },
): RaceAnalysis {
  const y = splitsRun(you);
  const t = splitsRun(them);
  const finalGap = endGap(y, t);
  const phases = phaseChanges(y, t, finalGap);
  const ys = phaseSpans(y);
  const ts = phaseSpans(t);
  const names = [...new Set([...phases.map((p) => p.name), ...ys.keys()])]
    .filter((n) => n !== "Finished")
    .sort((a, b) => PHASE_ORDER.indexOf(a) - PHASE_ORDER.indexOf(b));
  const report: PhaseReport[] = names.map((phase) => {
    const yEnd = ys.get(phase)?.at(-1)?.[1];
    const tEnd = ts.get(phase)?.at(-1)?.[1];
    const unfinished = yEnd === y.end && !y.finished;
    const theirsEnded = tEnd === t.end && !t.finished && !unfinished;
    // A phase only one of you got through says nothing about the gap
    const change =
      unfinished || theirsEnded ? null : (phases.find((p) => p.name === phase)?.change ?? null);
    return {
      phase,
      change,
      unfinished,
      theirsEnded,
      you: spannedSeconds(ys.get(phase)),
      them: spannedSeconds(ts.get(phase)),
      why: [],
      notes: [],
      compare: [],
      steps: { you: [], them: [] },
    };
  });
  const keys = new Set([...y.marks, ...t.marks].sort((a, b) => a.t - b.t).map((m) => m.key));
  const info = (r: Run, q: QuickRunner) => ({
    uuid: q.uuid,
    name: q.name,
    elo: q.elo,
    finished: r.finished,
    endTicks: r.end,
  });
  return {
    analysisVersion: ANALYSIS_VERSION,
    createdAt: Date.now(),
    seed,
    you: info(y, you),
    them: info(t, them),
    finalGap,
    matchedSeconds: 0,
    totalSeconds: y.end / 20,
    curve: [],
    splits: [...keys].map((k) => ({
      name: (y.marks.find((m) => m.key === k) ?? t.marks.find((m) => m.key === k))!.label,
      you: y.mark(k) ?? null,
      them: t.mark(k) ?? null,
    })),
    phases,
    report,
    losses: [],
    gains: [],
    quick: {
      yourMatch: you.matchId,
      theirMatch: them.matchId,
      ironPick: you.timelines.some((e) => e.uuid === you.uuid && e.type === "story.iron_tools"),
    },
  };
}
