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

/** Links from an insight to the match and replay it points at. */
interface InsightLinks {
  matches: ProfileMatch[];
  defaultMatchId: number | null;
  defaultRaceId: number | null;
  latestRaceId: number | null;
}

type InsightLink = Pick<Insight, "matchId" | "raceId">;

function fmtMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) {
    return "—";
  }
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function matchIdForRace(
  matches: ProfileMatch[],
  raceId: number | null | undefined,
  fallbackMatchId: number | null,
): number | null {
  if (raceId === null || raceId === undefined) {
    return fallbackMatchId;
  }
  return matches.find((m) => m.raceId === raceId)?.id ?? fallbackMatchId;
}

function raceIdForMatch(
  matches: ProfileMatch[],
  matchId: number | null | undefined,
  fallbackRaceId: number | null,
): number | null {
  if (matchId === null || matchId === undefined) {
    return fallbackRaceId;
  }
  return matches.find((m) => m.id === matchId)?.raceId ?? fallbackRaceId;
}

/** Links a replay, falling back to the default one, and the match it belongs to. */
function linkRace(links: InsightLinks, raceId: number | null | undefined): InsightLink {
  const id = raceId ?? links.defaultRaceId;
  return { raceId: id, matchId: matchIdForRace(links.matches, id, links.defaultMatchId) };
}

/** Links a match and its replay. */
function linkMatch(links: InsightLinks, matchId: number | null): InsightLink {
  return { matchId, raceId: raceIdForMatch(links.matches, matchId, links.defaultRaceId) };
}

const linkDefault = (links: InsightLinks): InsightLink => ({
  matchId: links.defaultMatchId,
  raceId: links.defaultRaceId,
});

const linkLatest = (links: InsightLinks): InsightLink => ({
  matchId: links.defaultMatchId,
  raceId: links.latestRaceId,
});

function replayInsights(replays: ReplayTrends, links: InsightLinks): Insight[] {
  const insights: Insight[] = [];

  const phasesByLoss = [...replays.phases].sort(
    (a, b) => b.averageLostSeconds - a.averageLostSeconds,
  );
  const worstPhase = phasesByLoss[0];
  if (worstPhase && worstPhase.averageLostSeconds >= 3) {
    insights.push({
      kind: "weakness",
      label: `Worst phase: ${worstPhase.phase}`,
      detail: `Losing ${Math.round(worstPhase.averageLostSeconds)} s per game across ${plural(worstPhase.races, "game")}`,
      ...linkRace(links, worstPhase.worstRaceId),
    });
  }
  const bestPhase = phasesByLoss.at(-1);
  if (bestPhase && bestPhase.averageLostSeconds <= -3) {
    insights.push({
      kind: "strength",
      label: `Strongest phase: ${bestPhase.phase}`,
      detail: `Gaining ${Math.round(Math.abs(bestPhase.averageLostSeconds))} s per game across ${plural(bestPhase.races, "game")}`,
      ...linkRace(links, bestPhase.worstRaceId),
    });
  }

  const topCause = replays.topCauses[0];
  if (topCause) {
    insights.push({
      kind: "weakness",
      label: `${topCause.phase} · ${topCause.label}`,
      detail: `${Math.round(topCause.totalSeconds)} s lost (${Math.round(topCause.averageSeconds)} s on average, ${plural(topCause.occurrences, "time")}, worst vs ${topCause.worstOpponent})`,
      ...linkRace(links, topCause.worstRaceId),
    });
  }

  const improving = replays.trends
    .filter((t) => t.deltaSeconds <= -4)
    .sort((a, b) => a.deltaSeconds - b.deltaSeconds)[0];
  if (improving) {
    insights.push({
      kind: "strength",
      label: `Improving: ${improving.phase} · ${improving.label}`,
      detail: `Saving ${Math.round(Math.abs(improving.deltaSeconds))} s per game over the last ${improving.samples.length} games`,
      ...linkRace(links, improving.samples.at(-1)?.raceId),
    });
  }
  const worsening = replays.trends
    .filter((t) => t.deltaSeconds >= 4)
    .sort((a, b) => b.deltaSeconds - a.deltaSeconds)[0];
  if (worsening) {
    insights.push({
      kind: "weakness",
      label: `Worsening: ${worsening.phase} · ${worsening.label}`,
      detail: `Losing ${Math.round(worsening.deltaSeconds)} s per game over the last ${worsening.samples.length} games`,
      ...linkRace(links, worsening.samples.at(-1)?.raceId),
    });
  }

  return insights;
}

function splitInsights(splits: SplitProfile, links: InsightLinks): Insight[] {
  const pctOf = (s: SplitSegmentStat): number => (s.worldPercentile ?? s.bandPercentile) as number;
  const pctLabelOf = (s: SplitSegmentStat): string =>
    s.worldPercentile !== null ? s.worldPctLabel : s.bandPctLabel;

  const ranked = splits.segments
    .filter((s) => s.worldPercentile !== null || s.bandPercentile !== null)
    .sort((a, b) => pctOf(b) - pctOf(a));
  if (ranked.length === 0) {
    return [];
  }

  const insights: Insight[] = [];
  const best = ranked[0];
  const worst = ranked.at(-1)!;
  if (pctOf(best) >= 60) {
    insights.push({
      kind: "strength",
      label: `Best split: ${best.label}`,
      detail: `${pctLabelOf(best)} (${fmtMs(best.medianMs)} median)`,
      ...linkDefault(links),
    });
  }
  const worstIsDistinct = ranked.length === 1 ? pctOf(best) < 60 : worst.key !== best.key;
  if (pctOf(worst) <= 45 && worstIsDistinct) {
    insights.push({
      kind: "weakness",
      label: `Weakest split: ${worst.label}`,
      detail: `${pctLabelOf(worst)} (${fmtMs(worst.medianMs)} median)`,
      ...linkDefault(links),
    });
  }
  return insights;
}

function formInsights(stats: RankedStats, links: InsightLinks): Insight[] {
  const insights: Insight[] = [];

  if (stats.currentStreak >= 3) {
    insights.push({
      kind: "strength",
      label: "On a heater",
      detail: `${stats.currentStreak}-game win streak`,
      ...linkLatest(links),
    });
  } else if (stats.currentStreak <= -3) {
    insights.push({
      kind: "weakness",
      label: "Cold streak",
      detail: `${Math.abs(stats.currentStreak)} losses in a row`,
      ...linkLatest(links),
    });
  }

  const last8Decided = links.matches.filter((m) => m.won !== null).slice(0, 8);
  const last8Wins = last8Decided.filter((m) => m.won === true).length;
  const last8Losses = last8Decided.filter((m) => m.won === false).length;
  if (last8Losses >= 6) {
    insights.push({
      kind: "weakness",
      label: "Cold streak",
      detail: `${last8Wins} W, ${last8Losses} L in the last ${last8Wins + last8Losses}`,
      ...linkLatest(links),
    });
  }

  return insights;
}

function matchupInsights(stats: RankedStats, links: InsightLinks): Insight[] {
  const insights: Insight[] = [];
  const { vsHigher, vsLower } = stats;

  if (vsHigher.decided >= 3 && vsHigher.winRate >= 50) {
    insights.push({
      kind: "strength",
      label: "Punches up",
      detail: `${vsHigher.winRate}% vs higher Elo (${vsHigher.wins}/${vsHigher.decided})`,
      ...linkMatch(links, stats.bestGainMatchId ?? links.defaultMatchId),
    });
  } else if (vsHigher.decided >= 3 && vsHigher.winRate <= 30) {
    insights.push({
      kind: "weakness",
      label: "Struggles vs stronger",
      detail: `${vsHigher.winRate}% vs higher Elo (${vsHigher.wins}/${vsHigher.decided})`,
      ...linkMatch(links, stats.worstLossMatchId ?? links.defaultMatchId),
    });
  }

  if (vsLower.decided >= 3 && vsLower.winRate < 50) {
    insights.push({
      kind: "weakness",
      label: "Drops winnable games",
      detail: `${vsLower.winRate}% vs lower Elo (${vsLower.wins}/${vsLower.decided})`,
      ...linkMatch(links, stats.worstLossMatchId ?? links.defaultMatchId),
    });
  }

  return insights;
}

function habitInsights(stats: RankedStats, links: InsightLinks): Insight[] {
  const insights: Insight[] = [];

  if (stats.forfeitRate >= 20) {
    const forfeitLoss = links.matches.find((m) => m.forfeited && m.won === false);
    const link = linkMatch(links, forfeitLoss?.id ?? links.defaultMatchId);
    insights.push({
      kind: "weakness",
      label: "High forfeit rate",
      detail: `${stats.forfeitRate}% of decided games (${plural(stats.forfeits.yours, "forfeit")})`,
      matchId: link.matchId,
      raceId: forfeitLoss?.raceId ?? link.raceId,
    });
  }

  if (stats.deaths.matches >= 3 && stats.deaths.perMatch >= 0.35) {
    insights.push({
      kind: "weakness",
      label: "Dies too often",
      detail: `${stats.deaths.total} deaths in ${stats.deaths.matches} games (${stats.deaths.perMatch.toFixed(2)} per game)`,
      ...linkDefault(links),
    });
  }

  return insights;
}

function sessionTiltInsight(stats: RankedStats, links: InsightLinks): Insight | null {
  const { sessions } = stats;
  const earlySession = sessions.find((s) => s.label === "Game 1–2") ?? sessions[0];
  if (!earlySession || earlySession.decided <= 0) {
    return null;
  }
  const lateSession = sessions
    .filter(
      (s) =>
        s !== earlySession &&
        (s.label === "Game 6–8" || s.label === "Game 9+" || sessions.indexOf(s) >= 2),
    )
    .reverse()
    .find((s) => s.decided >= 3 && earlySession.winRate - s.winRate >= 20);
  if (!lateSession) {
    return null;
  }
  return {
    kind: "weakness",
    label: "Late-session tilt",
    detail: `${lateSession.winRate}% win rate in ${lateSession.label.toLowerCase()} vs ${earlySession.winRate}% in ${earlySession.label.toLowerCase()}`,
    ...linkDefault(links),
  };
}

/** Rank up goal: the splits whose median is over a second slower than the next rank's. */
function goalInsight(
  splits: SplitProfile,
  replays: ReplayTrends,
  links: InsightLinks,
): Insight | null {
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
    .sort((a, b) => b.secondsToCut - a.secondsToCut);
  if (targets.length === 0) {
    return null;
  }

  const biggest = targets[0];
  const finishTarget = targets.find((t) => t.key === "finish");
  const nextBandRange = splits.nextBand ? ` (${splits.nextBand[0]}–${splits.nextBand[1]} Elo)` : "";
  return {
    kind: "goal",
    label: `${splits.nextRankName ?? "Next tier"}${nextBandRange}`,
    detail: `Cut ${biggest.secondsToCut} s from ${biggest.label} (${targets.map((t) => `${t.label} −${t.secondsToCut} s`).join(", ")})`,
    secondsToCut: finishTarget?.secondsToCut ?? biggest.secondsToCut,
    targets,
    raceId:
      replays.phases[0]?.worstRaceId ??
      links.matches.find((m) => m.raceId !== null)?.raceId ??
      links.defaultRaceId,
    matchId: links.defaultMatchId,
  };
}

export function buildProfileInsights(input: {
  stats: RankedStats;
  splits: SplitProfile;
  replays: ReplayTrends;
  scorecardDetails: ScorecardDetail[];
  matches: ProfileMatch[];
}): Insight[] {
  const { stats, splits, replays, matches } = input;
  const defaultRaceId =
    matches.find((m) => m.raceId !== null)?.raceId ??
    replays.phases.find((p) => p.worstRaceId !== null)?.worstRaceId ??
    replays.topCauses[0]?.worstRaceId ??
    null;
  const links: InsightLinks = {
    matches,
    defaultMatchId: matches[0]?.id ?? stats.bestGainMatchId ?? stats.worstLossMatchId ?? null,
    defaultRaceId,
    latestRaceId: matches[0]?.raceId ?? defaultRaceId,
  };

  const insights: Insight[] = [
    ...replayInsights(replays, links),
    ...splitInsights(splits, links),
    ...formInsights(stats, links),
    ...matchupInsights(stats, links),
    ...habitInsights(stats, links),
  ];
  const tilt = sessionTiltInsight(stats, links);
  if (tilt) {
    insights.push(tilt);
  }
  const goal = goalInsight(splits, replays, links);
  if (goal) {
    insights.push(goal);
  }

  if (insights.length === 0) {
    insights.push({
      kind: "note",
      label: "Getting started",
      detail: "Play ranked games or download replays to build highlights",
      ...linkDefault(links),
    });
  }
  return insights;
}
