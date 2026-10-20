// Profile insights. Strengths, weaknesses, notes and rank up goals
import type {
  GoalTarget,
  Insight,
  ProfileMatch,
  RankedStats,
  ReplayTrends,
  ScorecardDetail,
  SplitProfile,
  SplitSegmentStat,
} from "./types";

function fmtMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function matchIdForRace(
  matches: ProfileMatch[],
  raceId: number | null | undefined,
  fallbackMatchId: number | null,
): number | null {
  if (raceId !== null && raceId !== undefined) {
    const found = matches.find((m) => m.raceId === raceId);
    if (found) return found.id;
  }
  return fallbackMatchId;
}

function raceIdForMatch(
  matches: ProfileMatch[],
  matchId: number | null | undefined,
  fallbackRaceId: number | null,
): number | null {
  if (matchId !== null && matchId !== undefined) {
    const found = matches.find((m) => m.id === matchId);
    if (found && found.raceId !== null) return found.raceId;
  }
  return fallbackRaceId;
}

export function buildProfileInsights(input: {
  stats: RankedStats;
  splits: SplitProfile;
  replays: ReplayTrends;
  scorecardDetails: ScorecardDetail[];
  matches: ProfileMatch[];
}): Insight[] {
  const { stats, splits, replays, matches } = input;
  const insights: Insight[] = [];

  const defaultMatchId =
    matches[0]?.id ?? stats.bestGainMatchId ?? stats.worstLossMatchId ?? null;
  const defaultRaceId =
    matches.find((m) => m.raceId !== null)?.raceId ??
    replays.phases.find((p) => p.worstRaceId !== null)?.worstRaceId ??
    replays.topCauses[0]?.worstRaceId ??
    null;

  // 1. Phase and cause insights from replays
  if (replays.phases.length > 0) {
    const phasesByLoss = [...replays.phases].sort(
      (a, b) => b.averageLostSeconds - a.averageLostSeconds,
    );
    const worstPhase = phasesByLoss[0];
    if (worstPhase && worstPhase.averageLostSeconds >= 3) {
      const raceId = worstPhase.worstRaceId ?? defaultRaceId;
      insights.push({
        kind: "weakness",
        label: `Worst phase: ${worstPhase.phase}`,
        detail: `Losing ${Math.round(worstPhase.averageLostSeconds)} s per game across ${worstPhase.races} game${worstPhase.races === 1 ? "" : "s"}`,
        raceId,
        matchId: matchIdForRace(matches, raceId, defaultMatchId),
      });
    }

    const bestPhase = phasesByLoss.at(-1);
    if (bestPhase && bestPhase.averageLostSeconds <= -3) {
      const raceId = bestPhase.worstRaceId ?? defaultRaceId;
      insights.push({
        kind: "strength",
        label: `Strongest phase: ${bestPhase.phase}`,
        detail: `Gaining ${Math.round(Math.abs(bestPhase.averageLostSeconds))} s per game across ${bestPhase.races} game${bestPhase.races === 1 ? "" : "s"}`,
        raceId,
        matchId: matchIdForRace(matches, raceId, defaultMatchId),
      });
    }
  }

  if (replays.topCauses.length > 0) {
    const topCause = replays.topCauses[0];
    const raceId = topCause.worstRaceId ?? defaultRaceId;
    insights.push({
      kind: "weakness",
      label: `${topCause.phase} · ${topCause.label}`,
      detail: `${Math.round(topCause.totalSeconds)} s lost (${Math.round(topCause.averageSeconds)} s on average, ${topCause.occurrences} time${topCause.occurrences === 1 ? "" : "s"}, worst vs ${topCause.worstOpponent})`,
      raceId,
      matchId: matchIdForRace(matches, raceId, defaultMatchId),
    });
  }

  if (replays.trends.length > 0) {
    const improvingTrend = [...replays.trends]
      .filter((t) => t.deltaSeconds <= -4)
      .sort((a, b) => a.deltaSeconds - b.deltaSeconds)[0];
    if (improvingTrend) {
      const raceId = improvingTrend.samples.at(-1)?.raceId ?? defaultRaceId;
      insights.push({
        kind: "strength",
        label: `Improving: ${improvingTrend.phase} · ${improvingTrend.label}`,
        detail: `Saving ${Math.round(Math.abs(improvingTrend.deltaSeconds))} s per game over the last ${improvingTrend.samples.length} games`,
        raceId,
        matchId: matchIdForRace(matches, raceId, defaultMatchId),
      });
    }

    const worseningTrend = [...replays.trends]
      .filter((t) => t.deltaSeconds >= 4)
      .sort((a, b) => b.deltaSeconds - a.deltaSeconds)[0];
    if (worseningTrend) {
      const raceId = worseningTrend.samples.at(-1)?.raceId ?? defaultRaceId;
      insights.push({
        kind: "weakness",
        label: `Worsening: ${worseningTrend.phase} · ${worseningTrend.label}`,
        detail: `Losing ${Math.round(worseningTrend.deltaSeconds)} s per game over the last ${worseningTrend.samples.length} games`,
        raceId,
        matchId: matchIdForRace(matches, raceId, defaultMatchId),
      });
    }
  }

  // 2. Split percentiles
  const getPct = (s: SplitSegmentStat): number =>
    (s.worldPercentile ?? s.bandPercentile) as number;
  const getPctLabel = (s: SplitSegmentStat): string =>
    s.worldPercentile !== null ? s.worldPctLabel : s.bandPctLabel;

  const rankedSegments = splits.segments
    .filter((s) => s.worldPercentile !== null || s.bandPercentile !== null)
    .sort((a, b) => getPct(b) - getPct(a));

  if (rankedSegments.length > 0) {
    const best = rankedSegments[0];
    const worst = rankedSegments.at(-1)!;
    if (getPct(best) >= 60) {
      insights.push({
        kind: "strength",
        label: `Best split: ${best.label}`,
        detail: `${getPctLabel(best)} (${fmtMs(best.medianMs)} median)`,
        matchId: defaultMatchId,
        raceId: defaultRaceId,
      });
    }
    if (
      getPct(worst) <= 45 &&
      (rankedSegments.length === 1 ? getPct(best) < 60 : worst.key !== best.key)
    ) {
      insights.push({
        kind: "weakness",
        label: `Weakest split: ${worst.label}`,
        detail: `${getPctLabel(worst)} (${fmtMs(worst.medianMs)} median)`,
        matchId: defaultMatchId,
        raceId: defaultRaceId,
      });
    }
  }

  // 3. Ranked stats, streaks and form
  const latestMatchId = matches[0]?.id ?? defaultMatchId;
  const latestRaceId = matches[0]?.raceId ?? defaultRaceId;

  if (stats.currentStreak >= 3) {
    insights.push({
      kind: "strength",
      label: "On a heater",
      detail: `${stats.currentStreak}-game win streak`,
      matchId: latestMatchId,
      raceId: latestRaceId,
    });
  } else if (stats.currentStreak <= -3) {
    insights.push({
      kind: "weakness",
      label: "Cold streak",
      detail: `${Math.abs(stats.currentStreak)} losses in a row`,
      matchId: latestMatchId,
      raceId: latestRaceId,
    });
  }

  const last8Decided = matches.filter((m) => m.won !== null).slice(0, 8);
  const last8Wins = last8Decided.filter((m) => m.won === true).length;
  const last8Losses = last8Decided.filter((m) => m.won === false).length;
  if (last8Losses >= 6) {
    insights.push({
      kind: "weakness",
      label: "Cold streak",
      detail: `${last8Wins} W, ${last8Losses} L in the last ${last8Wins + last8Losses}`,
      matchId: latestMatchId,
      raceId: latestRaceId,
    });
  }

  if (stats.vsHigher.decided >= 3) {
    if (stats.vsHigher.winRate >= 50) {
      const matchId = stats.bestGainMatchId ?? latestMatchId;
      insights.push({
        kind: "strength",
        label: "Punches up",
        detail: `${stats.vsHigher.winRate}% vs higher Elo (${stats.vsHigher.wins}/${stats.vsHigher.decided})`,
        matchId,
        raceId: raceIdForMatch(matches, matchId, defaultRaceId),
      });
    } else if (stats.vsHigher.winRate <= 30) {
      const matchId = stats.worstLossMatchId ?? latestMatchId;
      insights.push({
        kind: "weakness",
        label: "Struggles vs stronger",
        detail: `${stats.vsHigher.winRate}% vs higher Elo (${stats.vsHigher.wins}/${stats.vsHigher.decided})`,
        matchId,
        raceId: raceIdForMatch(matches, matchId, defaultRaceId),
      });
    }
  }

  if (stats.vsLower.decided >= 3 && stats.vsLower.winRate < 50) {
    const matchId = stats.worstLossMatchId ?? latestMatchId;
    insights.push({
      kind: "weakness",
      label: "Drops winnable games",
      detail: `${stats.vsLower.winRate}% vs lower Elo (${stats.vsLower.wins}/${stats.vsLower.decided})`,
      matchId,
      raceId: raceIdForMatch(matches, matchId, defaultRaceId),
    });
  }

  if (stats.forfeitRate >= 20) {
    const ffMatch = matches.find((m) => m.forfeited && m.won === false);
    const matchId = ffMatch?.id ?? latestMatchId;
    insights.push({
      kind: "weakness",
      label: "High forfeit rate",
      detail: `${stats.forfeitRate}% of decided games (${stats.forfeits.yours} forfeit${stats.forfeits.yours === 1 ? "" : "s"})`,
      matchId,
      raceId: ffMatch?.raceId ?? raceIdForMatch(matches, matchId, defaultRaceId),
    });
  }

  if (stats.deaths.matches >= 3 && stats.deaths.perMatch >= 0.35) {
    insights.push({
      kind: "weakness",
      label: "Dies too often",
      detail: `${stats.deaths.total} deaths in ${stats.deaths.matches} games (${stats.deaths.perMatch.toFixed(2)} per game)`,
      matchId: defaultMatchId,
      raceId: defaultRaceId,
    });
  }

  const earlySession =
    stats.sessions.find((s) => s.label === "Game 1–2" || s.label === "Game 1-2") ??
    stats.sessions[0];
  if (earlySession && earlySession.decided > 0) {
    const lateCandidates = stats.sessions
      .filter(
        (s) =>
          s !== earlySession &&
          (s.label === "Game 6–8" ||
            s.label === "Game 6-8" ||
            s.label === "Game 9+" ||
            stats.sessions.indexOf(s) >= 2),
      )
      .reverse();
    const lateSession = lateCandidates.find(
      (s) => s.decided >= 3 && earlySession.winRate - s.winRate >= 20,
    );
    if (lateSession) {
      insights.push({
        kind: "weakness",
        label: "Late-session tilt",
        detail: `${lateSession.winRate}% win rate in ${lateSession.label.toLowerCase()} vs ${earlySession.winRate}% in ${earlySession.label.toLowerCase()}`,
        matchId: defaultMatchId,
        raceId: defaultRaceId,
      });
    }
  }

  // 4. Goal card (rank up targets)
  const targets: GoalTarget[] = splits.segments
    .filter(
      (
        s,
      ): s is SplitSegmentStat & {
        medianMs: number;
        targetMs: number;
        targetDeltaMs: number;
      } =>
        s.medianMs !== null &&
        s.targetMs !== null &&
        s.targetDeltaMs !== null &&
        s.targetDeltaMs > 1000,
    )
    .map((s) => ({
      key: s.key,
      label: s.label,
      yourMedianMs: s.medianMs,
      targetMedianMs: s.targetMs,
      secondsToCut: Math.round(s.targetDeltaMs / 1000),
    }))
    .filter((t) => t.secondsToCut > 0)
    .sort((a, b) => b.secondsToCut - a.secondsToCut);

  if (targets.length > 0) {
    const biggest = targets[0];
    const finishTarget = targets.find((t) => t.key === "finish");
    const secondsToCut = finishTarget?.secondsToCut ?? biggest.secondsToCut;
    const goalRaceId =
      replays.phases[0]?.worstRaceId ??
      matches.find((m) => m.raceId !== null)?.raceId ??
      defaultRaceId;
    const goalMatchId =
      matches[0]?.id ?? matchIdForRace(matches, goalRaceId, defaultMatchId);

    insights.push({
      kind: "goal",
      label: `${splits.nextRankName ?? "Next tier"}${splits.nextBand ? ` (${splits.nextBand[0]}–${splits.nextBand[1]} Elo)` : ""}`,
      detail: `Cut ${biggest.secondsToCut} s from ${biggest.label} (${targets.map((t) => `${t.label} −${t.secondsToCut} s`).join(", ")})`,
      secondsToCut,
      targets,
      raceId: goalRaceId,
      matchId: goalMatchId,
    });
  }

  // 5. Fallback if nothing else came out
  if (insights.length === 0) {
    insights.push({
      kind: "note",
      label: "Getting started",
      detail: "Play ranked games or download replays to build highlights",
      matchId: defaultMatchId,
      raceId: defaultRaceId,
    });
  }

  return insights;
}
