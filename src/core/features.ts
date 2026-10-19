// Habit trends over time
import type { RaceAnalysis } from "./detect/analyze";
import { fmtSec } from "./detect/names";

export interface HabitTrend {
  phase: string;
  label: string;
  samples: { raceId: number; createdAt: number; seconds: number }[];
  /** Recent half median minus early half median, seconds lost. Negative means improving */
  deltaSeconds: number;
  recentMedian: number;
  earlyMedian: number;
  summary: string;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function computeTrends(
  games: { id: number; createdAt: number; analysis: RaceAnalysis }[],
  minSamples = 4,
): HabitTrend[] {
  const ordered = [...games].sort((a, b) => a.createdAt - b.createdAt);
  const byKey = new Map<string, { phase: string; label: string; samples: { raceId: number; createdAt: number; seconds: number }[] }>();
  for (const g of ordered) {
    for (const p of g.analysis.report ?? []) {
      if (p.change === null) continue;
      for (const w of p.why ?? []) {
        const k = `${p.phase}|${w.label}`;
        const entry = byKey.get(k) ?? { phase: p.phase, label: w.label, samples: [] };
        entry.samples.push({ raceId: g.id, createdAt: g.createdAt, seconds: w.seconds });
        byKey.set(k, entry);
      }
    }
  }
  const out: HabitTrend[] = [];
  for (const { phase, label, samples } of byKey.values()) {
    if (samples.length < minSamples) continue;
    const mid = samples.length >> 1;
    const early = samples.slice(0, mid).map((s) => s.seconds);
    const recent = samples.slice(mid).map((s) => s.seconds);
    const earlyMedian = median(early);
    const recentMedian = median(recent);
    const deltaSeconds = recentMedian - earlyMedian;
    const summary = `${phase} · ${label.toLowerCase()}: ${fmtSec(deltaSeconds)} per game over your last ${samples.length}`;
    out.push({ phase, label, samples, deltaSeconds, recentMedian, earlyMedian, summary });
  }
  return out.sort((a, b) => Math.abs(b.deltaSeconds) - Math.abs(a.deltaSeconds));
}
