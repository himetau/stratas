import type { RaceAnalysis } from "./detect/analyze";
import { fmtSec } from "./detect/names";

export interface HabitTrend {
  phase: string;
  label: string;
  samples: { raceId: number; createdAt: number; seconds: number }[];
  /** Recent half median minus early half median, in seconds lost. Negative means improving. */
  deltaSeconds: number;
  recentMedian: number;
  earlyMedian: number;
  summary: string;
}

/** Returns the median of xs, or 0 when xs is empty. */
export function median(xs: number[]): number {
  if (!xs.length) {
    return 0;
  }
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeTrends(
  games: { id: number; createdAt: number; analysis: RaceAnalysis }[],
  minSamples = 4,
): HabitTrend[] {
  const ordered = [...games].sort((a, b) => a.createdAt - b.createdAt);
  const byKey = new Map<string, Pick<HabitTrend, "phase" | "label" | "samples">>();
  for (const g of ordered) {
    for (const p of g.analysis.report ?? []) {
      if (p.change === null) {
        continue;
      }
      for (const w of p.why ?? []) {
        const key = `${p.phase}|${w.label}`;
        const entry = byKey.get(key) ?? { phase: p.phase, label: w.label, samples: [] };
        entry.samples.push({ raceId: g.id, createdAt: g.createdAt, seconds: w.seconds });
        byKey.set(key, entry);
      }
    }
  }
  const out: HabitTrend[] = [];
  for (const { phase, label, samples } of byKey.values()) {
    if (samples.length < minSamples) {
      continue;
    }
    const mid = samples.length >> 1;
    const earlyMedian = median(samples.slice(0, mid).map((s) => s.seconds));
    const recentMedian = median(samples.slice(mid).map((s) => s.seconds));
    const deltaSeconds = recentMedian - earlyMedian;
    const summary = `${phase} · ${label.toLowerCase()}: ${fmtSec(deltaSeconds)} per game over your last ${samples.length}`;
    out.push({ phase, label, samples, deltaSeconds, recentMedian, earlyMedian, summary });
  }
  return out.sort((a, b) => Math.abs(b.deltaSeconds) - Math.abs(a.deltaSeconds));
}
