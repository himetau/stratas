import {
  computeBandStats,
  extractSplitsFromTimeline,
  SPLIT_KEYS,
  type SplitRow,
} from "../seeds/atlas";
import type { Store } from "../store";
import { rankOf, TIER_THRESHOLDS } from "../tiers";
import { isFiniteNumber, meanRounded, medianRounded, normUuid } from "./stats";
import {
  RANKED_MATCH_TYPE,
  type Dimension,
  type MatchBreakdownRow,
  type MatchDetail,
  type MatchSplitsBreakdown,
  type MatchTimelineEvent,
  type RankedStats,
  type ScorecardDetail,
  type SplitProfile,
  type SplitSegmentKey,
  type SplitSegmentStat,
} from "./types";

const MS_PER_TICK = 50;

const SEGMENT_LABELS: Record<SplitSegmentKey, string> = {
  nether: "Entered the Nether",
  bastion: "Bastion",
  fortress: "Fortress",
  blind: "Blind",
  eye: "Stronghold",
  end: "Entered the End",
  finish: "Finish",
};

/** Min next rank games before we show its medians. */
const MIN_NEXT_SAMPLE = 15;

const BAND_HALF_WIDTH = 100;
const WORLD_BAND: [number, number] = [0, 10000];
/** Elo the next rank is found from when you have no Elo. */
const UNRATED_ELO = 1200;
const TOP_TIER_MAX_ELO = 4000;

const BREAKDOWN_MILESTONES = [
  { key: "nether", label: "Nether", types: ["story.enter_the_nether", "nether"] },
  { key: "bastion", label: "Bastion", types: ["nether.find_bastion", "bastion"] },
  { key: "fortress", label: "Fortress", types: ["nether.find_fortress", "fortress"] },
  { key: "rod", label: "First rod", types: ["nether.obtain_blaze_rod", "rod"] },
  { key: "blind", label: "Blind", types: ["projectelo.timeline.blind_travel", "blind"] },
  {
    key: "stronghold",
    label: "Stronghold",
    types: ["story.follow_ender_eye", "eye", "stronghold"],
  },
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

const clamp100 = (n: number): number =>
  Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : 0)));

const toMs = (ticks: number | null | undefined) =>
  isFiniteNumber(ticks) && ticks > 0 ? Math.round(ticks * MS_PER_TICK) : null;
const ticksToMs = (ticks: number) => Math.round(ticks * MS_PER_TICK);
const msToTicks = (ms: number | null) => (ms !== null ? ms / MS_PER_TICK : null);

const isValidTicks = (ticks: number | null): ticks is number =>
  ticks !== null && Number.isFinite(ticks) && ticks > 0;

const deltaOf = (a: number | null, b: number | null) => (a !== null && b !== null ? a - b : null);

const inBand = (rows: SplitRow[], [minElo, maxElo]: [number, number]) =>
  rows.filter((r) => r.elo !== null && r.elo >= minElo && r.elo <= maxElo);

function fasterFraction(yourTicks: number, sortedVals: number[]): number {
  let faster = 0;
  let equal = 0;
  for (const v of sortedVals) {
    if (v < yourTicks) {
      faster++;
    } else if (v === yourTicks) {
      equal++;
    }
  }
  return (faster + 0.5 * equal) / sortedVals.length;
}

/** 0-100, higher is faster than more of the values. Null if under 2 values. */
function percentileIn(ticks: number | null, sorted: number[]): number | null {
  if (!isValidTicks(ticks) || sorted.length < 2) {
    return null;
  }
  return clamp100(Math.round((1 - fasterFraction(ticks, sorted)) * 100));
}

/** Your percentile in a pool. A pool under 2 values is compared through its median instead. */
function poolPercentile(
  yourTicks: number | null,
  sortedPool: number[],
  poolMedianTicks: number | undefined,
): number | null {
  if (!isValidTicks(yourTicks)) {
    return null;
  }
  if (sortedPool.length >= 2) {
    return percentileIn(yourTicks, sortedPool);
  }
  const hasPoolMedian = poolMedianTicks !== undefined && Number.isFinite(poolMedianTicks);
  if (sortedPool.length === 0 && !hasPoolMedian) {
    return null;
  }
  const ref = poolMedianTicks ?? sortedPool[0];
  if (!ref || ref <= 0) {
    return null;
  }
  if (yourTicks === ref) {
    return 50;
  }
  return clamp100(Math.round(50 + ((ref - yourTicks) / ref) * 50));
}

function formatPctLabel(percentile: number | null): string {
  if (percentile === null || !Number.isFinite(percentile)) {
    return "—";
  }
  const rounded = clamp100(percentile);
  if (rounded >= 50) {
    return `Top ${Math.max(1, 100 - rounded)}%`;
  }
  return `Bottom ${Math.max(1, rounded)}%`;
}

function completionMs(m: MatchDetail, uuid: string): number | null {
  const comp = Array.isArray(m.completions)
    ? m.completions.find((c) => normUuid(c.uuid) === uuid)
    : undefined;
  return comp && isFiniteNumber(comp.time) && comp.time > 0 ? comp.time : null;
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

  const row = extractSplitsFromTimeline(matchInput, m.timelines ?? []).find(
    (r) => normUuid(r.uuid) === targetUuid,
  );
  if (!row) {
    return null;
  }

  if (row.finish === null) {
    const finishMs = completionMs(m, targetUuid);
    if (finishMs !== null) {
      row.finish = Math.round(finishMs / MS_PER_TICK);
    }
  }

  return row;
}

/** Sorted ticks for split i, either time to it or time since the previous split. */
function splitTicks(rows: SplitRow[], i: number, segment: boolean): number[] {
  const key = SPLIT_KEYS[i];
  const prev = i > 0 ? SPLIT_KEYS[i - 1] : null;
  return rows
    .map((r) => {
      const v = r[key];
      if (!isValidTicks(v)) {
        return null;
      }
      if (!segment || !prev) {
        return v;
      }
      const p = r[prev];
      return isValidTicks(p) && v > p ? v - p : null;
    })
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
}

function eloBand(elo: number | null): [number, number] {
  if (elo === null || !Number.isFinite(elo)) {
    return [1000, 1400];
  }
  const e = Math.round(elo);
  return [Math.max(0, e - BAND_HALF_WIDTH), e + BAND_HALF_WIDTH];
}

/** The whole Elo range of the tier above the one elo is in, null from the top tier. */
function nextTierBand(elo: number): [number, number] | null {
  const lo = TIER_THRESHOLDS.find((t) => t > elo);
  if (lo === undefined) {
    return null;
  }
  const nextLo = TIER_THRESHOLDS.find((t) => t > lo);
  return [lo, nextLo === undefined ? TOP_TIER_MAX_ELO : nextLo - 1];
}

/** The Elo ranges a profile compares against: yours (±100) and the whole next rank up. */
export function benchmarkBands(elo: number | null): [number, number][] {
  if (elo === null || !Number.isFinite(elo)) {
    return [eloBand(null)];
  }
  const next = nextTierBand(Math.round(elo));
  return next ? [eloBand(elo), next] : [eloBand(elo)];
}

/** `pool` is how many of your newest Ranked matches to take times from. */
export function analyzeSplitsProfile(
  store: Store,
  uuid: string,
  yourElo: number | null,
  details: MatchDetail[],
  pool = 50,
): SplitProfile {
  const targetUuid = normUuid(uuid);

  const yourRows = [...(details ?? [])]
    .filter((m) => m && m.type === RANKED_MATCH_TYPE && Array.isArray(m.timelines))
    .sort((a, b) => (b.date ?? 0) - (a.date ?? 0))
    .slice(0, pool)
    .map((m) => extractPlayerRow(m, targetUuid, yourElo))
    .filter((row): row is SplitRow => row !== null);

  // Your own games are in the same table as everyone's, and comparing you with yourself puts every
  // split at 50%, so the pools hold other players only.
  const othersInBand = (band: [number, number]) =>
    inBand(
      store.splitsForBand(band[0], band[1]).filter((r) => normUuid(r.uuid) !== targetUuid),
      band,
    );

  const worldPool = othersInBand(WORLD_BAND);
  const worldStats = computeBandStats(worldPool, WORLD_BAND);

  const hasElo = isFiniteNumber(yourElo);
  const band = eloBand(yourElo);
  const bandPool = othersInBand(band);
  const bandStats = computeBandStats(bandPool, band);
  const bandRange = `${band[0]}–${band[1]} Elo`;
  const bandLabel = hasElo ? `${rankOf(yourElo).name} (${bandRange})` : bandRange;

  const nextCandidate = nextTierBand(hasElo ? Math.round(yourElo) : UNRATED_ELO);
  const nextCandidatePool = nextCandidate ? othersInBand(nextCandidate) : [];
  const nextCandidateStats = nextCandidate
    ? computeBandStats(nextCandidatePool, nextCandidate)
    : null;
  const enoughNext = nextCandidateStats !== null && nextCandidateStats.count >= MIN_NEXT_SAMPLE;
  const nextBand = enoughNext ? nextCandidate : null;
  const nextPool = enoughNext ? nextCandidatePool : [];
  const nextStats = enoughNext ? nextCandidateStats : null;

  const segments: SplitSegmentStat[] = SPLIT_KEYS.map((key, i) => {
    const cumulative = splitTicks(yourRows, i, false).map(ticksToMs);
    const segment = splitTicks(yourRows, i, true).map(ticksToMs);
    const medianMs = medianRounded(cumulative);
    const segmentMedianMs = medianRounded(segment);
    const yourTicks = msToTicks(medianMs);

    const worldPercentile = poolPercentile(
      yourTicks,
      splitTicks(worldPool, i, false),
      worldStats.medians[key],
    );
    const bandCumulative = splitTicks(bandPool, i, false);
    const bandPercentile = poolPercentile(yourTicks, bandCumulative, bandStats.medians[key]);

    const targetTicks = nextStats?.medians[key];
    const targetMs = toMs(targetTicks);

    const bandSegment = splitTicks(bandPool, i, true);
    const nextSegmentMedian = medianRounded(splitTicks(nextPool, i, true));

    return {
      key,
      label: SEGMENT_LABELS[key],
      bestMs: cumulative[0] ?? null,
      averageMs: meanRounded(cumulative),
      medianMs,
      segmentBestMs: segment[0] ?? null,
      segmentAverageMs: meanRounded(segment),
      segmentMedianMs,
      count: cumulative.length,
      worldPercentile,
      worldPctLabel: formatPctLabel(worldPercentile),
      bandPercentile,
      bandPctLabel: formatPctLabel(bandPercentile),
      targetMs,
      targetDeltaMs: deltaOf(medianMs, targetMs),
      bandMedianMs: toMs(bandStats.medians[key]),
      targetPercentile: percentileIn(targetTicks ?? null, bandCumulative),
      segment: {
        bandMedianMs: toMs(medianRounded(bandSegment)),
        targetMs: toMs(nextSegmentMedian),
        percentile: percentileIn(msToTicks(segmentMedianMs), bandSegment),
        targetPercentile: percentileIn(nextSegmentMedian, bandSegment),
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
    analyzedMatches: yourRows.length,
    worldSampleCount: worldStats.count,
    band,
    bandLabel,
    bandSampleCount: bandStats.count,
    nextRankName: nextBand ? rankOf(nextBand[0]).name : null,
    nextBand,
    nextBandSampleCount: nextStats?.count ?? 0,
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

  const scorecard = Object.fromEntries(details.map((d) => [d.dimension, d.score])) as Record<
    Dimension,
    number
  >;

  return { scorecard, details };
}

/** Your finish time: the completion entry, else the time of a match you won without a forfeit. */
function finishMs(detail: MatchDetail, uuid: string): number | null {
  const completed = completionMs(detail, uuid);
  if (completed !== null) {
    return completed;
  }
  const result = detail.result;
  if (detail.forfeited || !result?.uuid || normUuid(result.uuid) !== uuid) {
    return null;
  }
  return isFiniteNumber(result.time) && result.time > 0 ? result.time : null;
}

function extractPlayerTimeline(
  detail: MatchDetail,
  targetUuid: string,
): { events: MatchTimelineEvent[]; milestoneMs: Map<string, number> } {
  const events: MatchTimelineEvent[] = [];
  const milestoneMs = new Map<string, number>();
  if (!targetUuid) {
    return { events, milestoneMs };
  }

  const sorted = [...(detail.timelines ?? [])].sort((a, b) => a.time - b.time);
  for (const entry of sorted) {
    if (normUuid(entry.uuid) !== targetUuid || !isFiniteNumber(entry.time) || entry.time < 0) {
      continue;
    }

    const milestone = BREAKDOWN_MILESTONES.find((m) =>
      (m.types as readonly string[]).includes(entry.type),
    );
    if (milestone) {
      if (!milestoneMs.has(milestone.key)) {
        milestoneMs.set(milestone.key, entry.time);
        events.push({
          key: milestone.key,
          label: milestone.label,
          ms: entry.time,
          milestone: true,
        });
      }
      continue;
    }

    const marker = NON_MILESTONE_MARKERS[entry.type];
    if (marker) {
      events.push({ key: marker.key, label: marker.label, ms: entry.time, milestone: false });
    }
  }

  if (!milestoneMs.has("finish")) {
    const ms = finishMs(detail, targetUuid);
    if (ms !== null) {
      milestoneMs.set("finish", ms);
      events.push({ key: "finish", label: "Finish", ms, milestone: true });
    }
  }

  events.sort((a, b) => a.ms - b.ms);
  return { events, milestoneMs };
}

/** Time since the previous reached milestone for each reached milestone, null when out of order. */
function segmentDurations(milestoneMs: Map<string, number>): Map<string, number | null> {
  const durations = new Map<string, number | null>();
  let prev = 0;
  for (const { key } of BREAKDOWN_MILESTONES) {
    const ms = milestoneMs.get(key);
    if (ms === undefined) {
      continue;
    }
    durations.set(key, ms >= prev ? ms - prev : null);
    prev = Math.max(prev, ms);
  }
  return durations;
}

export function buildMatchBreakdown(
  detail: MatchDetail,
  yourUuid: string,
  theirUuid: string,
): MatchSplitsBreakdown {
  const you = normUuid(yourUuid);
  let them = normUuid(theirUuid);
  if (!them && Array.isArray(detail.players)) {
    const opponent = detail.players.find((p) => normUuid(p.uuid) !== you);
    if (opponent) {
      them = normUuid(opponent.uuid);
    }
  }

  const { events: youEvents, milestoneMs: youMilestones } = extractPlayerTimeline(detail, you);
  const { events: themEvents, milestoneMs: themMilestones } = extractPlayerTimeline(detail, them);
  const youSegments = segmentDurations(youMilestones);
  const themSegments = segmentDurations(themMilestones);

  const timestamps: MatchBreakdownRow[] = [];
  const segments: MatchBreakdownRow[] = [];
  for (const { key, label } of BREAKDOWN_MILESTONES) {
    const youMs = youMilestones.get(key) ?? null;
    const themMs = themMilestones.get(key) ?? null;
    if (youMs === null && themMs === null) {
      continue;
    }
    timestamps.push({ key, label, youMs, themMs, deltaMs: deltaOf(youMs, themMs) });

    const youSegMs = youSegments.get(key) ?? null;
    const themSegMs = themSegments.get(key) ?? null;
    segments.push({
      key,
      label,
      youMs: youSegMs,
      themMs: themSegMs,
      deltaMs: deltaOf(youSegMs, themSegMs),
    });
  }

  return { youEvents, themEvents, timestamps, segments };
}
