// Split analysis, the scorecard, and per match split breakdowns
import {
  computeBandStats,
  extractSplitsFromTimeline,
  SPLIT_KEYS,
  type SplitRow,
} from "../seeds/atlas";
import type { Store } from "../store";
import { rankOf } from "../tiers";
import type {
  Dimension,
  MatchBreakdownRow,
  MatchDetail,
  MatchSplitsBreakdown,
  MatchTimelineEvent,
  RankedStats,
  ScorecardDetail,
  SplitProfile,
  SplitSegmentKey,
  SplitSegmentStat,
} from "./types";

const SEGMENT_LABELS: Record<SplitSegmentKey, string> = {
  nether: "Entered the Nether",
  bastion: "Bastion",
  fortress: "Fortress",
  blind: "Blind",
  eye: "Stronghold",
  end: "Entered the End",
  finish: "Finish",
};

/** Min next rank games before we show its medians */
const MIN_NEXT_SAMPLE = 15;

const TIER_THRESHOLDS = [
  0, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1650, 1800, 2000,
] as const;

const BREAKDOWN_MILESTONES = [
  { key: "nether", label: "Nether", types: ["story.enter_the_nether", "nether"] },
  { key: "bastion", label: "Bastion", types: ["nether.find_bastion", "bastion"] },
  { key: "fortress", label: "Fortress", types: ["nether.find_fortress", "fortress"] },
  { key: "rod", label: "First rod", types: ["nether.obtain_blaze_rod", "rod"] },
  { key: "blind", label: "Blind", types: ["projectelo.timeline.blind_travel", "blind"] },
  { key: "stronghold", label: "Stronghold", types: ["story.follow_ender_eye", "eye", "stronghold"] },
  { key: "end", label: "End", types: ["story.enter_the_end", "end"] },
  {
    key: "finish",
    label: "Finish",
    types: ["projectelo.timeline.dragon_death", "end.kill_dragon", "finish"],
  },
] as const;

const NON_MILESTONE_MARKERS: Record<string, { key: string; label: string }> = {
  "projectelo.timeline.death": { key: "death", label: "Death" },
  death: { key: "death", label: "Death" },
  "projectelo.timeline.reset": { key: "reset", label: "Reset" },
  reset: { key: "reset", label: "Reset" },
};

const normUuid = (u: string | null | undefined): string =>
  (u ?? "").replace(/-/g, "").toLowerCase();

const clamp100 = (n: number): number =>
  Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : 0)));

function meanMs(values: number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((acc, v) => acc + v, 0);
  return Math.round(total / values.length);
}

function medianMs(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return Math.round(sorted[mid]);
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function fasterFraction(yourTicks: number, sortedVals: number[]): number {
  let faster = 0;
  let equal = 0;
  for (const v of sortedVals) {
    if (v < yourTicks) faster++;
    else if (v === yourTicks) equal++;
  }
  return (faster + 0.5 * equal) / sortedVals.length;
}

function computePoolPercentile(
  yourTicks: number | null,
  rows: SplitRow[],
  band: [number, number],
  key: SplitSegmentKey,
  statsMedianTicks: number | undefined,
): number | null {
  if (yourTicks === null || !Number.isFinite(yourTicks) || yourTicks <= 0) return null;

  const [minElo, maxElo] = band;
  const vals = rows
    .filter((r) => r.elo !== null && r.elo >= minElo && r.elo <= maxElo)
    .map((r) => r[key])
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);

  if (vals.length >= 2) {
    return clamp100(Math.round((1 - fasterFraction(yourTicks, vals)) * 100));
  }

  if (vals.length === 1 || (statsMedianTicks !== undefined && Number.isFinite(statsMedianTicks))) {
    const ref = statsMedianTicks ?? vals[0];
    if (!ref || ref <= 0) return null;
    if (yourTicks === ref) return 50;
    const diffRatio = (ref - yourTicks) / ref;
    return clamp100(Math.round(50 + diffRatio * 50));
  }

  return null;
}

function formatPctLabel(percentile: number | null): string {
  if (percentile === null || !Number.isFinite(percentile)) return "—";
  const rounded = clamp100(percentile);
  if (rounded >= 50) {
    const topX = Math.max(1, 100 - rounded);
    return `Top ${topX}%`;
  }
  const bottomY = Math.max(1, rounded);
  return `Bottom ${bottomY}%`;
}

function extractPlayerRow(
  m: MatchDetail,
  targetUuid: string,
  fallbackElo: number | null,
): SplitRow | null {
  const players = m.players ?? [];
  const hasPlayer = players.some((p) => normUuid(p.uuid) === targetUuid);
  const matchInput: MatchDetail = hasPlayer
    ? m
    : {
        ...m,
        players: [...players, { uuid: targetUuid, nickname: "", eloRate: fallbackElo }],
      };

  const rows = extractSplitsFromTimeline(matchInput, m.timelines ?? []);
  const row = rows.find((r) => normUuid(r.uuid) === targetUuid) ?? null;
  if (!row) return null;

  if (row.finish === null && Array.isArray(m.completions)) {
    const comp = m.completions.find((c) => normUuid(c.uuid) === targetUuid);
    if (comp && typeof comp.time === "number" && Number.isFinite(comp.time) && comp.time > 0) {
      row.finish = Math.round(comp.time / 50);
    }
  }

  return row;
}

/** Sorted values for one split, either time to it or time since the previous split */
function rowValues(rows: SplitRow[], band: [number, number], i: number, segment: boolean): number[] {
  const key = SPLIT_KEYS[i], prev = i > 0 ? SPLIT_KEYS[i - 1] : null;
  return rows
    .filter((r) => r.elo !== null && r.elo >= band[0] && r.elo <= band[1])
    .map((r) => {
      const v = r[key];
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
      if (!segment || !prev) return v;
      const p = r[prev];
      return typeof p === "number" && Number.isFinite(p) && p > 0 && v > p ? v - p : null;
    })
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
}

/** 0-100, higher is faster than more of the values. Null if under 2 values */
function percentileIn(ticks: number | null, sorted: number[]): number | null {
  if (ticks === null || !Number.isFinite(ticks) || ticks <= 0 || sorted.length < 2) return null;
  return clamp100(Math.round((1 - fasterFraction(ticks, sorted)) * 100));
}

const toMs = (ticks: number | null | undefined) => (typeof ticks === "number" && Number.isFinite(ticks) && ticks > 0 ? Math.round(ticks * 50) : null);
const medianTicks = (sorted: number[]) => (sorted.length ? medianMs(sorted) : null);

/** `pool` is how many of your newest Ranked matches to take times from */
export function analyzeSplitsProfile(
  store: Store,
  uuid: string,
  yourElo: number | null,
  details: MatchDetail[],
  pool = 50,
): SplitProfile {
  const targetUuid = normUuid(uuid);

  const cumulativeByKey: Record<SplitSegmentKey, number[]> = {
    nether: [],
    bastion: [],
    fortress: [],
    blind: [],
    eye: [],
    end: [],
    finish: [],
  };

  const segmentByKey: Record<SplitSegmentKey, number[]> = {
    nether: [],
    bastion: [],
    fortress: [],
    blind: [],
    eye: [],
    end: [],
    finish: [],
  };

  let analyzedMatches = 0;

  const newest = [...(details ?? [])].filter((m) => m && m.type === 2 && Array.isArray(m.timelines)).sort((a, b) => (b.date ?? 0) - (a.date ?? 0)).slice(0, pool);
  for (const m of newest) {
    const row = extractPlayerRow(m, targetUuid, yourElo);
    if (!row) continue;

    analyzedMatches++;

    for (let i = 0; i < SPLIT_KEYS.length; i++) {
      const key = SPLIT_KEYS[i];
      const ticks = row[key];
      if (ticks !== null && Number.isFinite(ticks) && ticks > 0) {
        cumulativeByKey[key].push(Math.round(ticks * 50));

        if (i === 0) {
          segmentByKey[key].push(Math.round(ticks * 50));
        } else {
          const prevKey = SPLIT_KEYS[i - 1];
          const prevTicks = row[prevKey];
          if (
            prevTicks !== null &&
            Number.isFinite(prevTicks) &&
            prevTicks > 0 &&
            ticks > prevTicks
          ) {
            segmentByKey[key].push(Math.round((ticks - prevTicks) * 50));
          }
        }
      }
    }
  }

  // World pool
  const worldBand: [number, number] = [0, 10000];
  const worldRows = store.splitsForBand(worldBand[0], worldBand[1]);
  const worldStats = computeBandStats(worldRows, worldBand);

  // Your Elo band
  const hasElo = typeof yourElo === "number" && Number.isFinite(yourElo);
  const band: [number, number] = hasElo
    ? [Math.max(0, Math.round(yourElo - 100)), Math.round(yourElo + 100)]
    : [1000, 1400];
  const bandRows = store.splitsForBand(band[0], band[1]);
  const bandStats = computeBandStats(bandRows, band);
  const currentRank = rankOf(hasElo ? yourElo : null);
  const bandLabel = hasElo
    ? `${currentRank.name} (${band[0]}–${band[1]} Elo)`
    : `${band[0]}–${band[1]} Elo`;

  // Next rank up, its whole Elo range (Emerald II is 1300-1399). Only if the index has
  // enough of its games for a median worth comparing to
  const effectiveElo = hasElo ? Math.round(yourElo) : 1200;
  const nextLo = TIER_THRESHOLDS.find((t) => t > effectiveElo) ?? null;
  const nextHi = nextLo === null ? null : (TIER_THRESHOLDS.find((t) => t > nextLo) ?? 4001) - 1;
  const nextCandidate: [number, number] | null = nextLo !== null && nextHi !== null ? [nextLo, nextHi] : null;
  const nextCandidateRows = nextCandidate ? store.splitsForBand(nextCandidate[0], nextCandidate[1]) : [];
  const enoughNext = nextCandidate !== null && computeBandStats(nextCandidateRows, nextCandidate).count >= MIN_NEXT_SAMPLE;
  const nextBand = enoughNext ? nextCandidate : null;
  const nextRankName = nextBand ? rankOf(nextBand[0]).name : null;
  const nextRows = nextBand ? nextCandidateRows : [];
  const nextBandRange: [number, number] = nextBand ?? [0, 0];
  const nextBandStats = computeBandStats(nextRows, nextBandRange);
  const segments: SplitSegmentStat[] = SPLIT_KEYS.map((key, i) => {
    const cumVals = cumulativeByKey[key];
    const segVals = segmentByKey[key];

    const best = cumVals.length > 0 ? Math.min(...cumVals) : null;
    const avg = meanMs(cumVals);
    const med = medianMs(cumVals);

    const segBest = segVals.length > 0 ? Math.min(...segVals) : null;
    const segAvg = meanMs(segVals);
    const segMed = medianMs(segVals);

    const yourTicks = med !== null ? med / 50 : null;

    const worldPercentile = computePoolPercentile(
      yourTicks,
      worldRows,
      worldBand,
      key,
      worldStats.medians[key],
    );
    const bandPercentile = computePoolPercentile(
      yourTicks,
      bandRows,
      band,
      key,
      bandStats.medians[key],
    );

    const targetTicks = nextBand ? nextBandStats.medians[key] : undefined;
    const targetMs =
      typeof targetTicks === "number" && Number.isFinite(targetTicks) && targetTicks > 0
        ? Math.round(targetTicks * 50)
        : null;
    const targetDeltaMs = med !== null && targetMs !== null ? med - targetMs : null;

    const bandCum = rowValues(bandRows, band, i, false), bandSeg = rowValues(bandRows, band, i, true);
    const nextSeg = rowValues(nextRows, nextBandRange, i, true);
    const nextSegMed = medianTicks(nextSeg);

    return {
      key,
      label: SEGMENT_LABELS[key],
      bestMs: best,
      averageMs: avg,
      medianMs: med,
      segmentBestMs: segBest,
      segmentAverageMs: segAvg,
      segmentMedianMs: segMed,
      count: cumVals.length,
      worldPercentile,
      worldPctLabel: formatPctLabel(worldPercentile),
      bandPercentile,
      bandPctLabel: formatPctLabel(bandPercentile),
      targetMs,
      targetDeltaMs,
      bandMedianMs: toMs(bandStats.medians[key]),
      targetPercentile: percentileIn(targetTicks ?? null, bandCum),
      segment: {
        bandMedianMs: toMs(medianTicks(bandSeg)),
        targetMs: toMs(nextSegMed),
        percentile: percentileIn(segMed !== null ? segMed / 50 : null, bandSeg),
        targetPercentile: percentileIn(nextSegMed, bandSeg),
      },
    };
  });

  const segmentPcts = segments
    .map((s) => s.worldPercentile ?? s.bandPercentile)
    .filter((p): p is number => p !== null && Number.isFinite(p));

  const speedScore =
    segmentPcts.length >= 2
      ? clamp100(segmentPcts.reduce((acc, p) => acc + p, 0) / segmentPcts.length)
      : null;

  return {
    segments,
    analyzedMatches,
    worldSampleCount: worldStats.count,
    band,
    bandLabel,
    bandSampleCount: bandStats.count,
    nextRankName,
    nextBand,
    nextBandSampleCount: nextBandStats.count,
    speedScore,
  };
}

export function buildScorecard(
  stats: RankedStats,
  splits: SplitProfile,
): { scorecard: Record<Dimension, number>; details: ScorecardDetail[] } {
  const details: ScorecardDetail[] = [
    {
      dimension: "winrate",
      label: "Win rate",
      score: clamp100(stats.winRate),
      detail: `${stats.winRate}% over ${stats.decided} games`,
      sample: stats.decided,
    },
    {
      dimension: "clutch",
      label: "Clutch",
      score: clamp100(stats.vsHigher.winRate),
      detail: `${stats.vsHigher.winRate}% vs stronger (${stats.vsHigher.decided})`,
      sample: stats.vsHigher.decided,
    },
    {
      dimension: "closing",
      label: "Closing",
      score: clamp100(stats.vsLower.winRate),
      detail: `${stats.vsLower.winRate}% vs weaker (${stats.vsLower.decided})`,
      sample: stats.vsLower.decided,
    },
    {
      dimension: "form",
      label: "Form",
      score: clamp100(stats.recentWinRate),
      detail: `${stats.recentWinRate}% over the last ${stats.recentSample}`,
      sample: stats.recentSample,
    },
    {
      dimension: "finishing",
      label: "Finishing",
      score: clamp100(100 - stats.forfeitRate),
      detail: `Forfeited ${stats.forfeitRate}% of games`,
      sample: stats.windowWins + stats.windowLosses,
    },
    {
      dimension: "speed",
      label: "Speed",
      score: clamp100(splits.speedScore ?? 50),
      detail:
        splits.speedScore != null
          ? `Faster than ~${splits.speedScore}% of runs`
          : "No split baseline yet",
      sample: splits.analyzedMatches,
    },
    {
      dimension: "survival",
      label: "Survival",
      score: clamp100(100 - stats.deaths.perMatch * 70),
      detail: `${stats.deaths.total} death${stats.deaths.total === 1 ? "" : "s"} in ${stats.deaths.matches} games`,
      sample: stats.deaths.matches,
    },
  ];

  const scorecard: Record<Dimension, number> = {
    winrate: details[0].score,
    clutch: details[1].score,
    closing: details[2].score,
    form: details[3].score,
    finishing: details[4].score,
    speed: details[5].score,
    survival: details[6].score,
  };

  return { scorecard, details };
}

function extractPlayerTimeline(
  detail: MatchDetail,
  targetUuid: string,
): { events: MatchTimelineEvent[]; milestoneMs: Map<string, number> } {
  const events: MatchTimelineEvent[] = [];
  const milestoneMs = new Map<string, number>();
  if (!targetUuid) return { events, milestoneMs };

  const sorted = [...(detail.timelines ?? [])].sort((a, b) => a.time - b.time);

  for (const entry of sorted) {
    if (normUuid(entry.uuid) !== targetUuid) continue;
    if (typeof entry.time !== "number" || !Number.isFinite(entry.time) || entry.time < 0) continue;

    const milestoneSpec = BREAKDOWN_MILESTONES.find((m) =>
      (m.types as readonly string[]).includes(entry.type),
    );
    if (milestoneSpec) {
      if (!milestoneMs.has(milestoneSpec.key)) {
        milestoneMs.set(milestoneSpec.key, entry.time);
        events.push({
          key: milestoneSpec.key,
          label: milestoneSpec.label,
          ms: entry.time,
          milestone: true,
        });
      }
      continue;
    }

    const marker = NON_MILESTONE_MARKERS[entry.type];
    if (marker) {
      events.push({
        key: marker.key,
        label: marker.label,
        ms: entry.time,
        milestone: false,
      });
    }
  }

  if (!milestoneMs.has("finish")) {
    let finishMs: number | null = null;
    if (Array.isArray(detail.completions)) {
      const comp = detail.completions.find((c) => normUuid(c.uuid) === targetUuid);
      if (comp && typeof comp.time === "number" && Number.isFinite(comp.time) && comp.time > 0) {
        finishMs = comp.time;
      }
    }
    if (
      finishMs === null &&
      !detail.forfeited &&
      detail.result?.uuid &&
      normUuid(detail.result.uuid) === targetUuid &&
      typeof detail.result.time === "number" &&
      Number.isFinite(detail.result.time) &&
      detail.result.time > 0
    ) {
      finishMs = detail.result.time;
    }

    if (finishMs !== null) {
      milestoneMs.set("finish", finishMs);
      events.push({
        key: "finish",
        label: "Finish",
        ms: finishMs,
        milestone: true,
      });
    }
  }

  events.sort((a, b) => a.ms - b.ms);
  return { events, milestoneMs };
}

export function buildMatchBreakdown(
  detail: MatchDetail,
  yourUuid: string,
  theirUuid: string,
): MatchSplitsBreakdown {
  const you = normUuid(yourUuid);
  let them = normUuid(theirUuid);
  if (!them && Array.isArray(detail.players)) {
    const opp = detail.players.find((p) => normUuid(p.uuid) !== you);
    if (opp) them = normUuid(opp.uuid);
  }

  const { events: youEvents, milestoneMs: youMilestones } = extractPlayerTimeline(detail, you);
  const { events: themEvents, milestoneMs: themMilestones } = extractPlayerTimeline(detail, them);

  const timestamps: MatchBreakdownRow[] = [];
  const segments: MatchBreakdownRow[] = [];

  let prevYouMs = 0;
  let prevThemMs = 0;

  for (const m of BREAKDOWN_MILESTONES) {
    const youMs = youMilestones.get(m.key) ?? null;
    const themMs = themMilestones.get(m.key) ?? null;
    if (youMs === null && themMs === null) continue;

    const deltaMs = youMs !== null && themMs !== null ? youMs - themMs : null;
    timestamps.push({
      key: m.key,
      label: m.label,
      youMs,
      themMs,
      deltaMs,
    });

    let youSegMs: number | null = null;
    if (youMs !== null) {
      if (youMs >= prevYouMs) {
        youSegMs = youMs - prevYouMs;
      }
      if (youMs > prevYouMs) {
        prevYouMs = youMs;
      }
    }

    let themSegMs: number | null = null;
    if (themMs !== null) {
      if (themMs >= prevThemMs) {
        themSegMs = themMs - prevThemMs;
      }
      if (themMs > prevThemMs) {
        prevThemMs = themMs;
      }
    }

    const segDeltaMs = youSegMs !== null && themSegMs !== null ? youSegMs - themSegMs : null;
    segments.push({
      key: m.key,
      label: m.label,
      youMs: youSegMs,
      themMs: themSegMs,
      deltaMs: segDeltaMs,
    });
  }

  return {
    youEvents,
    themEvents,
    timestamps,
    segments,
  };
}

