import { median } from "../features";
import {
  RANKED_MATCH_TYPE,
  type ApiUserFull,
  type EloPoint,
  type HeadToHeadEntry,
  type HistogramBin,
  type MatchChange,
  type MatchDetail,
  type RankedStats,
  type SessionBucket,
  type TypeBreakdown,
  type TypeStatRow,
} from "./types";

const HISTOGRAM_BIN_MS = 30_000;
const SESSION_GAP_SECONDS = 30 * 60;
const RECENT_FORM_GAMES = 20;
const MAX_RIVALS = 10;
const DEATH_EVENT = "projectelo.timeline.death";

const SESSION_BUCKETS = [
  { label: "Game 1–2", gameRange: "1-2", lastGame: 2 },
  { label: "Game 3–5", gameRange: "3-5", lastGame: 5 },
  { label: "Game 6–8", gameRange: "6-8", lastGame: 8 },
  { label: "Game 9+", gameRange: "9+", lastGame: Infinity },
];

interface BreakdownSpec {
  dimension: TypeBreakdown["dimension"];
  title: string;
  splitLabel: string;
  canonicalKeys: readonly string[];
  /** Timeline event whose earliest time is the split time for this breakdown. */
  splitEvent: string;
  typeOf: (m: MatchDetail) => string | null | undefined;
}

const OVERWORLD_BREAKDOWN: BreakdownSpec = {
  dimension: "overworld",
  title: "Overworld seed type",
  splitLabel: "Entered the Nether",
  canonicalKeys: ["VILLAGE", "SHIPWRECK", "RUINED_PORTAL", "DESERT_TEMPLE", "BURIED_TREASURE"],
  splitEvent: "story.enter_the_nether",
  typeOf: (m) => m.seedType ?? m.seed?.overworld,
};

const BASTION_BREAKDOWN: BreakdownSpec = {
  dimension: "bastion",
  title: "Bastion type",
  splitLabel: "Entered Bastion",
  canonicalKeys: ["HOUSING", "TREASURE", "STABLES", "BRIDGE"],
  splitEvent: "nether.find_bastion",
  typeOf: (m) => m.bastionType ?? m.seed?.nether,
};

type MatchOutcome = "win" | "loss" | "draw";

export const normUuid = (u: string | null | undefined): string =>
  (u ?? "").replace(/-/g, "").toLowerCase();

export const isFiniteNumber = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);

const normTypeKey = (s: string | null | undefined): string | null => {
  if (!s) {
    return null;
  }
  const cleaned = s.trim().toUpperCase().replace(/\s+/g, "_");
  return cleaned.length > 0 ? cleaned : null;
};

const formatTypeLabel = (key: string): string =>
  key
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round2 = (n: number): number => Math.round(n * 100) / 100;

const pct = (wins: number, decided: number): number =>
  decided > 0 ? round1((wins / decided) * 100) : 0;

const fmtMs = (ms: number): string => {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};

export const meanRounded = (values: number[]): number | null => {
  if (values.length === 0) {
    return null;
  }
  const sum = values.reduce((acc, v) => acc + v, 0);
  return Math.round(sum / values.length);
};

export const medianRounded = (values: number[]): number | null =>
  values.length === 0 ? null : Math.round(median(values));

const matchOutcome = (m: MatchDetail, me: string): MatchOutcome => {
  const winner = m.result?.uuid ? normUuid(m.result.uuid) : "";
  if (!winner) {
    return "draw";
  }
  return winner === me ? "win" : "loss";
};

const inSeason = (m: MatchDetail, season: number | undefined) =>
  season === undefined || m.season === undefined || m.season === season;

const myChange = (m: MatchDetail, me: string): MatchChange | undefined =>
  m.changes?.find((c) => normUuid(c.uuid) === me);

/** Your Elo change in a match, 0 when the API has none. */
function eloChange(m: MatchDetail, me: string): number {
  const change = myChange(m, me)?.change;
  return isFiniteNumber(change) ? change : 0;
}

/** Your completion time in a match you won without a forfeit, else null. */
function winTimeMs(m: MatchDetail, outcome: MatchOutcome): number | null {
  const time = m.result?.time;
  return outcome === "win" && !m.forfeited && isFiniteNumber(time) && time > 0 ? time : null;
}

/** Your opponent's pre-match Elo minus yours, null when either is unknown. */
function eloGap(m: MatchDetail, me: string): number | null {
  const myRate =
    myChange(m, me)?.eloRate ?? m.players?.find((p) => normUuid(p.uuid) === me)?.eloRate ?? null;
  const theirRate =
    m.changes?.find((c) => normUuid(c.uuid) !== me)?.eloRate ??
    m.players?.find((p) => normUuid(p.uuid) !== me)?.eloRate ??
    null;
  return isFiniteNumber(myRate) && isFiniteNumber(theirRate) ? theirRate - myRate : null;
}

function countDecided(acc: { decided: number; wins: number }, outcome: MatchOutcome): void {
  if (outcome === "draw") {
    return;
  }
  acc.decided++;
  if (outcome === "win") {
    acc.wins++;
  }
}

export function eloWinChance(yourElo: number | null, theirElo: number | null): number | null {
  if (!isFiniteNumber(yourElo) || !isFiniteNumber(theirElo)) {
    return null;
  }
  const expected = 1 / (1 + 10 ** ((theirElo - yourElo) / 400));
  return round1(expected * 100);
}

function buildHistogram(timesMs: number[]): HistogramBin[] {
  if (timesMs.length === 0) {
    return [];
  }
  const startLo = Math.floor(Math.min(...timesMs) / HISTOGRAM_BIN_MS) * HISTOGRAM_BIN_MS;
  const endLo = Math.floor(Math.max(...timesMs) / HISTOGRAM_BIN_MS) * HISTOGRAM_BIN_MS;

  const bins: HistogramBin[] = [];
  for (let lo = startLo; lo <= endLo; lo += HISTOGRAM_BIN_MS) {
    bins.push({ label: fmtMs(lo), minMs: lo, maxMs: lo + HISTOGRAM_BIN_MS, count: 0 });
  }

  for (const t of timesMs) {
    const idx = Math.floor((t - startLo) / HISTOGRAM_BIN_MS);
    if (idx >= 0 && idx < bins.length) {
      bins[idx].count++;
    }
  }

  return bins;
}

function analyzeSessions(
  chronological: MatchDetail[],
  me: string,
): {
  sessions: SessionBucket[];
  currentSessionGames: number;
  currentSessionNetElo: number;
} {
  const buckets: SessionBucket[] = SESSION_BUCKETS.map(({ label, gameRange }) => ({
    label,
    gameRange,
    played: 0,
    decided: 0,
    wins: 0,
    winRate: 0,
    netElo: 0,
  }));

  let prevDate: number | null = null;
  let currentSessionGames = 0;
  let currentSessionNetElo = 0;

  for (const m of chronological) {
    if (prevDate === null || m.date - prevDate > SESSION_GAP_SECONDS) {
      currentSessionGames = 0;
      currentSessionNetElo = 0;
    }
    prevDate = m.date;

    const change = eloChange(m, me);
    currentSessionGames++;
    currentSessionNetElo += change;

    const bucket = buckets[SESSION_BUCKETS.findIndex((b) => currentSessionGames <= b.lastGame)];
    bucket.played++;
    countDecided(bucket, matchOutcome(m, me));
    bucket.netElo += change;
  }

  for (const b of buckets) {
    b.winRate = pct(b.wins, b.decided);
  }

  return {
    sessions: buckets.filter((b) => b.played > 0),
    currentSessionGames,
    currentSessionNetElo,
  };
}

function opponentElo(
  m: MatchDetail,
  opponentKey: string,
  opponentListedElo: number | null,
): number | null {
  const entry = m.changes?.find((c) => normUuid(c.uuid) === opponentKey);
  const rate = entry?.eloRate;
  if (isFiniteNumber(rate)) {
    const change = entry?.change;
    return rate + (isFiniteNumber(change) ? change : 0);
  }
  return isFiniteNumber(opponentListedElo) ? opponentListedElo : null;
}

function analyzeRivals(listNewestFirst: MatchDetail[], me: string): HeadToHeadEntry[] {
  const byOpponent = new Map<string, HeadToHeadEntry>();

  for (const m of listNewestFirst) {
    const opponent = m.players?.find((p) => normUuid(p.uuid) !== me);
    const opponentKey = normUuid(opponent?.uuid);
    if (!opponent || !opponentKey) {
      continue;
    }

    const elo = opponentElo(m, opponentKey, opponent.eloRate);
    let entry = byOpponent.get(opponentKey);
    if (!entry) {
      entry = {
        uuid: opponent.uuid,
        nickname: opponent.nickname || opponent.uuid,
        elo,
        played: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        winRate: 0,
        netElo: 0,
        lastPlayed: m.date,
      };
      byOpponent.set(opponentKey, entry);
    } else {
      if (entry.elo === null && elo !== null) {
        entry.elo = elo;
      }
      if (!entry.nickname && opponent.nickname) {
        entry.nickname = opponent.nickname;
      }
      if (m.date > entry.lastPlayed) {
        entry.lastPlayed = m.date;
      }
    }

    entry.played++;
    const outcome = matchOutcome(m, me);
    if (outcome === "win") {
      entry.wins++;
    } else if (outcome === "loss") {
      entry.losses++;
    } else {
      entry.draws++;
    }
    entry.netElo += eloChange(m, me);
  }

  const rivals = Array.from(byOpponent.values()).map((r) => ({
    ...r,
    winRate: pct(r.wins, r.wins + r.losses),
  }));

  rivals.sort((a, b) => b.played - a.played || b.lastPlayed - a.lastPlayed);
  return rivals.slice(0, MAX_RIVALS);
}

/** Your earliest time for a timeline event in a match, null if you never reached it. */
function earliestEventMs(d: MatchDetail, me: string, type: string): number | null {
  if (!Array.isArray(d.timelines)) {
    return null;
  }
  let earliest: number | null = null;
  for (const e of d.timelines) {
    if (normUuid(e.uuid) !== me || e.type !== type || !isFiniteNumber(e.time) || e.time <= 0) {
      continue;
    }
    if (earliest === null || e.time < earliest) {
      earliest = e.time;
    }
  }
  return earliest;
}

interface TypeAcc {
  key: string;
  count: number;
  decided: number;
  wins: number;
  splitTimesMs: number[];
  winTimesMs: number[];
}

const emptyTypeAcc = (key: string): TypeAcc => ({
  key,
  count: 0,
  decided: 0,
  wins: 0,
  splitTimesMs: [],
  winTimesMs: [],
});

function typeStatRow(acc: TypeAcc): TypeStatRow {
  const times = acc.splitTimesMs.length > 0 ? acc.splitTimesMs : acc.winTimesMs;
  return {
    key: acc.key,
    label: formatTypeLabel(acc.key),
    count: acc.count,
    decided: acc.decided,
    wins: acc.wins,
    winRate: acc.decided > 0 ? pct(acc.wins, acc.decided) : null,
    bestMs: times.length > 0 ? Math.min(...times) : null,
    averageMs: meanRounded(times),
    medianMs: medianRounded(times),
    timeSample: times.length,
  };
}

/** Win rate and split times per seed or bastion type.
 *  Details missing from `list` add split times only. */
function buildTypeBreakdown(
  spec: BreakdownSpec,
  list: MatchDetail[],
  detailMap: Map<number, MatchDetail>,
  extraDetails: MatchDetail[],
  me: string,
): TypeBreakdown {
  const accs = new Map(spec.canonicalKeys.map((k) => [k, emptyTypeAcc(k)]));
  const accFor = (key: string): TypeAcc => {
    let acc = accs.get(key);
    if (!acc) {
      acc = emptyTypeAcc(key);
      accs.set(key, acc);
    }
    return acc;
  };

  const idsWithTimeline = new Set<number>();
  for (const m of list) {
    const detail = detailMap.get(m.id);
    const key = normTypeKey(spec.typeOf(m) ?? (detail ? spec.typeOf(detail) : null));
    if (!key) {
      continue;
    }

    const acc = accFor(key);
    acc.count++;
    const outcome = matchOutcome(m, me);
    countDecided(acc, outcome);
    const winMs = winTimeMs(m, outcome);
    if (winMs !== null) {
      acc.winTimesMs.push(winMs);
    }

    const timelineSource = detail ?? (Array.isArray(m.timelines) ? m : null);
    if (!timelineSource) {
      continue;
    }
    idsWithTimeline.add(m.id);
    const splitMs = earliestEventMs(timelineSource, me, spec.splitEvent);
    if (splitMs !== null) {
      acc.splitTimesMs.push(splitMs);
    }
  }

  for (const d of extraDetails) {
    if (idsWithTimeline.has(d.id)) {
      continue;
    }
    const key = normTypeKey(spec.typeOf(d));
    if (!key) {
      continue;
    }
    const splitMs = earliestEventMs(d, me, spec.splitEvent);
    if (splitMs !== null) {
      accFor(key).splitTimesMs.push(splitMs);
    }
  }

  const canonicalIndex = new Map(spec.canonicalKeys.map((k, idx) => [k, idx]));
  const orderOf = (key: string) => canonicalIndex.get(key) ?? 999;
  const rows = Array.from(accs.values()).map(typeStatRow);
  rows.sort((a, b) => b.count - a.count || orderOf(a.key) - orderOf(b.key));

  return { dimension: spec.dimension, title: spec.title, splitLabel: spec.splitLabel, rows };
}

/** Your current streak over decided games, newest first. Positive counts wins, negative losses. */
function currentStreak(decidedNewestFirst: MatchOutcome[]): number {
  const first = decidedNewestFirst[0];
  if (first === undefined) {
    return 0;
  }
  let run = 0;
  for (const o of decidedNewestFirst) {
    if (o !== first) {
      break;
    }
    run++;
  }
  return first === "win" ? run : -run;
}

function longestWinStreak(decided: MatchOutcome[]): number {
  let best = 0;
  let run = 0;
  for (const o of decided) {
    run = o === "win" ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

function buildEloHistory(chronological: MatchDetail[], me: string): EloPoint[] {
  const points: EloPoint[] = [];
  for (const m of chronological) {
    const mine = myChange(m, me);
    if (!mine || !isFiniteNumber(mine.eloRate)) {
      continue;
    }
    const change = isFiniteNumber(mine.change) ? mine.change : 0;
    points.push({ date: m.date, elo: mine.eloRate + change, change, matchId: m.id });
  }
  return points;
}

/** Ranked details from the season that have timelines, first copy of each ID only. */
function rankedDetailsWithTimelines(
  details: MatchDetail[],
  season: number | undefined,
): { list: MatchDetail[]; byId: Map<number, MatchDetail> } {
  const list: MatchDetail[] = [];
  const byId = new Map<number, MatchDetail>();
  for (const d of details) {
    if (!d || (d.type !== undefined && d.type !== RANKED_MATCH_TYPE)) {
      continue;
    }
    if (!inSeason(d, season) || !Array.isArray(d.timelines)) {
      continue;
    }
    if (typeof d.id === "number") {
      if (byId.has(d.id)) {
        continue;
      }
      byId.set(d.id, d);
    }
    list.push(d);
  }
  return { list, byId };
}

function countDeaths(detailsWithTimelines: MatchDetail[], me: string): RankedStats["deaths"] {
  let total = 0;
  for (const d of detailsWithTimelines) {
    for (const e of d.timelines ?? []) {
      if (normUuid(e.uuid) === me && e.type === DEATH_EVENT) {
        total++;
      }
    }
  }
  const matches = detailsWithTimelines.length;
  return { total, matches, perMatch: matches > 0 ? round2(total / matches) : 0 };
}

type HeadlineTotals = Pick<
  RankedStats,
  | "played"
  | "wins"
  | "losses"
  | "draws"
  | "decided"
  | "winRate"
  | "currentStreak"
  | "bestWinStreak"
  | "bestTimeMs"
>;

/** Headline totals from user.statistics when it has played games, else from the match window. */
function headlineTotals(user: ApiUserFull | null, window: HeadlineTotals): HeadlineTotals {
  const s = user?.statistics?.season ?? user?.statistics?.total;
  const statPlayed = s?.playedMatches?.ranked;
  const statWins = s?.wins?.ranked;
  const statLosses = s?.loses?.ranked ?? s?.losses?.ranked;
  const statStreak = s?.currentWinStreak?.ranked ?? 0;
  const bestWinStreak = Math.max(s?.highestWinStreak?.ranked ?? 0, window.bestWinStreak);
  const bestTimes = [s?.bestTime?.ranked, window.bestTimeMs].filter(
    (t): t is number => typeof t === "number" && t > 0,
  );
  const bestTimeMs = bestTimes.length > 0 ? Math.min(...bestTimes) : null;

  const hasStatPlayed = typeof statPlayed === "number" && statPlayed > 0;
  if (!hasStatPlayed) {
    return {
      ...window,
      currentStreak: window.currentStreak !== 0 ? window.currentStreak : statStreak,
      bestWinStreak,
      bestTimeMs,
    };
  }

  const wins = typeof statWins === "number" ? statWins : window.wins;
  const losses = typeof statLosses === "number" ? statLosses : window.losses;
  const decided = wins + losses;
  let currentStreak = statStreak;
  if (window.currentStreak < 0) {
    currentStreak = window.currentStreak;
  } else if (window.currentStreak > 0) {
    currentStreak = Math.max(window.currentStreak, statStreak);
  }
  return {
    played: statPlayed,
    wins,
    losses,
    draws: Math.max(0, statPlayed - decided),
    decided,
    winRate: pct(wins, decided),
    currentStreak,
    bestWinStreak,
    bestTimeMs,
  };
}

export function analyzeRanked(
  uuid: string,
  matches: MatchDetail[],
  details: MatchDetail[] = [],
  user: ApiUserFull | null = null,
  season?: number,
): { stats: RankedStats; eloHistory: EloPoint[]; breakdowns: TypeBreakdown[] } {
  const me = normUuid(uuid);

  const list = [...(matches ?? [])]
    .filter(
      (m): m is MatchDetail => Boolean(m) && m.type === RANKED_MATCH_TYPE && inSeason(m, season),
    )
    .sort((a, b) => b.date - a.date || b.id - a.id);

  let windowWins = 0;
  let windowLosses = 0;
  let windowDraws = 0;
  const decidedSeq: MatchOutcome[] = [];

  let netElo = 0;
  let biggestGain = 0;
  let biggestLoss = 0;
  let bestGainMatchId: number | null = null;
  let worstLossMatchId: number | null = null;

  const completionTimesMs: number[] = [];
  const vsHigherCounts = { decided: 0, wins: 0 };
  const vsLowerCounts = { decided: 0, wins: 0 };
  const forfeits = { yours: 0, theirs: 0 };

  for (const m of list) {
    const outcome = matchOutcome(m, me);
    if (outcome === "win") {
      windowWins++;
    } else if (outcome === "loss") {
      windowLosses++;
    } else {
      windowDraws++;
    }
    if (outcome !== "draw") {
      decidedSeq.push(outcome);
    }

    if (m.forfeited && outcome === "loss") {
      forfeits.yours++;
    } else if (m.forfeited && outcome === "win") {
      forfeits.theirs++;
    }

    const change = myChange(m, me)?.change;
    if (isFiniteNumber(change)) {
      netElo += change;
      if (change > biggestGain) {
        biggestGain = change;
        bestGainMatchId = m.id;
      }
      if (change < biggestLoss) {
        biggestLoss = change;
        worstLossMatchId = m.id;
      }
    }

    const winMs = winTimeMs(m, outcome);
    if (winMs !== null) {
      completionTimesMs.push(winMs);
    }

    const gap = outcome === "draw" ? null : eloGap(m, me);
    if (gap !== null && gap > 0) {
      countDecided(vsHigherCounts, outcome);
    } else if (gap !== null && gap < 0) {
      countDecided(vsLowerCounts, outcome);
    }
  }

  const windowDecided = windowWins + windowLosses;
  const recentSample = Math.min(RECENT_FORM_GAMES, decidedSeq.length);
  const recentWins = decidedSeq.slice(0, recentSample).filter((o) => o === "win").length;
  const { list: detailsWithTimelines, byId: detailMap } = rankedDetailsWithTimelines(
    details ?? [],
    season,
  );
  const chronological = [...list].reverse();

  const totals = headlineTotals(user, {
    played: list.length,
    wins: windowWins,
    losses: windowLosses,
    draws: windowDraws,
    decided: windowDecided,
    winRate: pct(windowWins, windowDecided),
    currentStreak: currentStreak(decidedSeq),
    bestWinStreak: longestWinStreak(decidedSeq),
    bestTimeMs: completionTimesMs.length > 0 ? Math.min(...completionTimesMs) : null,
  });

  const stats: RankedStats = {
    ...totals,
    windowPlayed: list.length,
    windowWins,
    windowLosses,
    windowDraws,
    netElo,
    biggestGain,
    biggestLoss,
    bestGainMatchId,
    worstLossMatchId,
    averageWinMs: meanRounded(completionTimesMs),
    medianWinMs: medianRounded(completionTimesMs),
    completionTimesMs,
    histogram: buildHistogram(completionTimesMs),
    recentWinRate: pct(recentWins, recentSample),
    recentSample,
    vsHigher: { ...vsHigherCounts, winRate: pct(vsHigherCounts.wins, vsHigherCounts.decided) },
    vsLower: { ...vsLowerCounts, winRate: pct(vsLowerCounts.wins, vsLowerCounts.decided) },
    forfeitRate: windowDecided > 0 ? round1((forfeits.yours / windowDecided) * 100) : 0,
    forfeits,
    deaths: countDeaths(detailsWithTimelines, me),
    ...analyzeSessions(chronological, me),
    rivals: analyzeRivals(list, me),
  };

  const breakdowns = [OVERWORLD_BREAKDOWN, BASTION_BREAKDOWN].map((spec) =>
    buildTypeBreakdown(spec, list, detailMap, detailsWithTimelines, me),
  );

  return { stats, eloHistory: buildEloHistory(chronological, me), breakdowns };
}
