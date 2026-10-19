// Ranked stats, Elo history, win chance, seed and bastion type breakdowns
import type {
  ApiUserFull,
  EloPoint,
  HeadToHeadEntry,
  HistogramBin,
  MatchDetail,
  RankedStats,
  SessionBucket,
  TypeBreakdown,
  TypeStatRow,
} from "./types";

const OVERWORLD_TYPES = [
  "VILLAGE",
  "SHIPWRECK",
  "RUINED_PORTAL",
  "DESERT_TEMPLE",
  "BURIED_TREASURE",
] as const;

const BASTION_TYPES = ["HOUSING", "TREASURE", "STABLES", "BRIDGE"] as const;

const HISTOGRAM_BIN_MS = 30_000;
const SESSION_GAP_SECONDS = 30 * 60;

type MatchOutcome = "win" | "loss" | "draw";

const normUuid = (u: string | null | undefined): string =>
  (u ?? "").replace(/-/g, "").toLowerCase();

const normTypeKey = (s: string | null | undefined): string | null => {
  if (!s) return null;
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

const meanRounded = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return Math.round(sum / values.length);
};

const medianRounded = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return Math.round(sorted[mid]);
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

const matchOutcome = (m: MatchDetail, me: string): MatchOutcome => {
  const winner = m.result?.uuid ? normUuid(m.result.uuid) : "";
  if (!winner) return "draw";
  return winner === me ? "win" : "loss";
};

export function eloWinChance(yourElo: number | null, theirElo: number | null): number | null {
  if (
    yourElo == null ||
    theirElo == null ||
    !Number.isFinite(yourElo) ||
    !Number.isFinite(theirElo)
  ) {
    return null;
  }
  const expected = 1 / (1 + 10 ** ((theirElo - yourElo) / 400));
  return round1(expected * 100);
}

function buildHistogram(timesMs: number[]): HistogramBin[] {
  if (timesMs.length === 0) return [];
  const min = Math.min(...timesMs);
  const max = Math.max(...timesMs);
  const startLo = Math.floor(min / HISTOGRAM_BIN_MS) * HISTOGRAM_BIN_MS;
  const endLo = Math.floor(max / HISTOGRAM_BIN_MS) * HISTOGRAM_BIN_MS;

  const bins: HistogramBin[] = [];
  for (let lo = startLo; lo <= endLo; lo += HISTOGRAM_BIN_MS) {
    bins.push({
      label: fmtMs(lo),
      minMs: lo,
      maxMs: lo + HISTOGRAM_BIN_MS,
      count: 0,
    });
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
  if (chronological.length === 0) {
    return { sessions: [], currentSessionGames: 0, currentSessionNetElo: 0 };
  }

  const buckets: SessionBucket[] = [
    { label: "Game 1–2", gameRange: "1-2", played: 0, decided: 0, wins: 0, winRate: 0, netElo: 0 },
    { label: "Game 3–5", gameRange: "3-5", played: 0, decided: 0, wins: 0, winRate: 0, netElo: 0 },
    { label: "Game 6–8", gameRange: "6-8", played: 0, decided: 0, wins: 0, winRate: 0, netElo: 0 },
    { label: "Game 9+", gameRange: "9+", played: 0, decided: 0, wins: 0, winRate: 0, netElo: 0 },
  ];

  let gameNumInSession = 0;
  let prevDate: number | null = null;
  let currentSessionGames = 0;
  let currentSessionNetElo = 0;

  for (const m of chronological) {
    if (prevDate === null || m.date - prevDate > SESSION_GAP_SECONDS) {
      gameNumInSession = 1;
      currentSessionGames = 0;
      currentSessionNetElo = 0;
    } else {
      gameNumInSession++;
    }
    prevDate = m.date;

    const outcome = matchOutcome(m, me);
    const mine = m.changes?.find((c) => normUuid(c.uuid) === me);
    const change =
      typeof mine?.change === "number" && Number.isFinite(mine.change) ? mine.change : 0;

    currentSessionGames++;
    currentSessionNetElo += change;

    const bucketIdx =
      gameNumInSession <= 2
        ? 0
        : gameNumInSession <= 5
          ? 1
          : gameNumInSession <= 8
            ? 2
            : 3;

    const b = buckets[bucketIdx];
    b.played++;
    if (outcome === "win" || outcome === "loss") {
      b.decided++;
      if (outcome === "win") b.wins++;
    }
    b.netElo += change;
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

function analyzeRivals(listNewestFirst: MatchDetail[], me: string): HeadToHeadEntry[] {
  const byOpponent = new Map<string, HeadToHeadEntry>();

  for (const m of listNewestFirst) {
    const oppPlayer = m.players?.find((p) => normUuid(p.uuid) !== me);
    if (!oppPlayer || !oppPlayer.uuid) continue;
    const oppKey = normUuid(oppPlayer.uuid);
    if (!oppKey) continue;

    const outcome = matchOutcome(m, me);
    const mine = m.changes?.find((c) => normUuid(c.uuid) === me);
    const oppChange = m.changes?.find((c) => normUuid(c.uuid) === oppKey);

    const myChange =
      typeof mine?.change === "number" && Number.isFinite(mine.change) ? mine.change : 0;

    let oppElo: number | null = null;
    if (typeof oppChange?.eloRate === "number" && Number.isFinite(oppChange.eloRate)) {
      const c =
        typeof oppChange.change === "number" && Number.isFinite(oppChange.change)
          ? oppChange.change
          : 0;
      oppElo = oppChange.eloRate + c;
    } else if (typeof oppPlayer.eloRate === "number" && Number.isFinite(oppPlayer.eloRate)) {
      oppElo = oppPlayer.eloRate;
    }

    let entry = byOpponent.get(oppKey);
    if (!entry) {
      entry = {
        uuid: oppPlayer.uuid,
        nickname: oppPlayer.nickname || oppPlayer.uuid,
        elo: oppElo,
        played: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        winRate: 0,
        netElo: 0,
        lastPlayed: m.date,
      };
      byOpponent.set(oppKey, entry);
    } else {
      if (entry.elo === null && oppElo !== null) entry.elo = oppElo;
      if (!entry.nickname && oppPlayer.nickname) entry.nickname = oppPlayer.nickname;
      if (m.date > entry.lastPlayed) entry.lastPlayed = m.date;
    }

    entry.played++;
    if (outcome === "win") entry.wins++;
    else if (outcome === "loss") entry.losses++;
    else entry.draws++;
    entry.netElo += myChange;
  }

  const rivals = Array.from(byOpponent.values()).map((r) => ({
    ...r,
    winRate: pct(r.wins, r.wins + r.losses),
  }));

  rivals.sort((a, b) => b.played - a.played || b.lastPlayed - a.lastPlayed);
  return rivals.slice(0, 10);
}

function buildTypeBreakdown(
  dimension: "overworld" | "bastion",
  title: string,
  defaultSplitLabel: string,
  canonicalKeys: readonly string[],
  timelineEvent: string,
  getType: (m: MatchDetail) => string | null | undefined,
  list: MatchDetail[],
  detailMap: Map<number, MatchDetail>,
  extraDetails: MatchDetail[],
  me: string,
): TypeBreakdown {
  interface Acc {
    key: string;
    count: number;
    decided: number;
    wins: number;
    splitTimesMs: number[];
    winTimesMs: number[];
  }

  const accMap = new Map<string, Acc>();
  for (const k of canonicalKeys) {
    accMap.set(k, {
      key: k,
      count: 0,
      decided: 0,
      wins: 0,
      splitTimesMs: [],
      winTimesMs: [],
    });
  }

  const ensureAcc = (key: string): Acc => {
    let acc = accMap.get(key);
    if (!acc) {
      acc = { key, count: 0, decided: 0, wins: 0, splitTimesMs: [], winTimesMs: [] };
      accMap.set(key, acc);
    }
    return acc;
  };

  const extractSplitTime = (d: MatchDetail): number | null => {
    if (!Array.isArray(d.timelines)) return null;
    let earliest: number | null = null;
    for (const e of d.timelines) {
      if (normUuid(e.uuid) !== me) continue;
      if (e.type !== timelineEvent) continue;
      if (typeof e.time === "number" && Number.isFinite(e.time) && e.time > 0) {
        if (earliest === null || e.time < earliest) {
          earliest = e.time;
        }
      }
    }
    return earliest;
  };

  const processedDetailIds = new Set<number>();

  for (const m of list) {
    const detail = detailMap.get(m.id);
    const rawType = getType(m) ?? (detail ? getType(detail) : null);
    const key = normTypeKey(rawType);
    if (!key) continue;

    const acc = ensureAcc(key);
    acc.count++;

    const outcome = matchOutcome(m, me);
    if (outcome === "win" || outcome === "loss") {
      acc.decided++;
      if (outcome === "win") acc.wins++;
    }

    if (
      outcome === "win" &&
      !m.forfeited &&
      typeof m.result?.time === "number" &&
      Number.isFinite(m.result.time) &&
      m.result.time > 0
    ) {
      acc.winTimesMs.push(m.result.time);
    }

    const timelineSource = detail ?? (Array.isArray(m.timelines) ? m : null);
    if (timelineSource) {
      processedDetailIds.add(m.id);
      const splitMs = extractSplitTime(timelineSource);
      if (splitMs !== null) {
        acc.splitTimesMs.push(splitMs);
      }
    }
  }

  // Also take split times from `details` for matches that weren't in `list`
  for (const d of extraDetails) {
    if (processedDetailIds.has(d.id)) continue;
    const key = normTypeKey(getType(d));
    if (!key) continue;
    const splitMs = extractSplitTime(d);
    if (splitMs !== null) {
      ensureAcc(key).splitTimesMs.push(splitMs);
    }
  }

  const canonicalIndex = new Map<string, number>(canonicalKeys.map((k, idx) => [k, idx]));

  const rows: TypeStatRow[] = Array.from(accMap.values()).map((acc) => {
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
  });

  rows.sort((a, b) => {
    const aActive = a.count > 0 ? 1 : 0;
    const bActive = b.count > 0 ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    if (a.count !== b.count) return b.count - a.count;
    const aIdx = canonicalIndex.get(a.key) ?? 999;
    const bIdx = canonicalIndex.get(b.key) ?? 999;
    return aIdx - bIdx;
  });

  return {
    dimension,
    title,
    splitLabel: defaultSplitLabel,
    rows,
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
      (m): m is MatchDetail =>
        Boolean(m) &&
        m.type === 2 &&
        (season === undefined || m.season === undefined || m.season === season),
    )
    .sort((a, b) => b.date - a.date || b.id - a.id);

  let windowWins = 0;
  let windowLosses = 0;
  let windowDraws = 0;
  const decidedSeq: ("win" | "loss")[] = [];

  let netElo = 0;
  let biggestGain = 0;
  let biggestLoss = 0;
  let bestGainMatchId: number | null = null;
  let worstLossMatchId: number | null = null;

  const completionTimesMs: number[] = [];

  let vsHigherDecided = 0;
  let vsHigherWins = 0;
  let vsLowerDecided = 0;
  let vsLowerWins = 0;

  const forfeits = { yours: 0, theirs: 0 };

  for (const m of list) {
    const outcome = matchOutcome(m, me);
    if (outcome === "win") {
      windowWins++;
      decidedSeq.push("win");
    } else if (outcome === "loss") {
      windowLosses++;
      decidedSeq.push("loss");
    } else {
      windowDraws++;
    }

    if (m.forfeited) {
      if (outcome === "loss") forfeits.yours++;
      else if (outcome === "win") forfeits.theirs++;
    }

    const mine = m.changes?.find((c) => normUuid(c.uuid) === me);
    const change =
      typeof mine?.change === "number" && Number.isFinite(mine.change) ? mine.change : null;

    if (change !== null) {
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

    if (
      outcome === "win" &&
      !m.forfeited &&
      typeof m.result?.time === "number" &&
      Number.isFinite(m.result.time) &&
      m.result.time > 0
    ) {
      completionTimesMs.push(m.result.time);
    }

    if (outcome === "win" || outcome === "loss") {
      const mePlayer = m.players?.find((p) => normUuid(p.uuid) === me);
      const oppPlayer = m.players?.find((p) => normUuid(p.uuid) !== me);
      const oppChange = m.changes?.find((c) => normUuid(c.uuid) !== me);

      const myRate = mine?.eloRate ?? mePlayer?.eloRate ?? null;
      const oppRate = oppChange?.eloRate ?? oppPlayer?.eloRate ?? null;

      if (
        typeof myRate === "number" &&
        Number.isFinite(myRate) &&
        typeof oppRate === "number" &&
        Number.isFinite(oppRate)
      ) {
        if (oppRate > myRate) {
          vsHigherDecided++;
          if (outcome === "win") vsHigherWins++;
        } else if (oppRate < myRate) {
          vsLowerDecided++;
          if (outcome === "win") vsLowerWins++;
        }
      }
    }
  }

  // Streaks over decided games in the window, draws don't extend or reset them
  let windowCurStreak = 0;
  if (decidedSeq.length > 0) {
    const first = decidedSeq[0];
    let run = 0;
    for (const o of decidedSeq) {
      if (o === first) run++;
      else break;
    }
    windowCurStreak = first === "win" ? run : -run;
  }

  let windowBestWinStreak = 0;
  {
    let run = 0;
    for (const o of decidedSeq) {
      if (o === "win") {
        run++;
        if (run > windowBestWinStreak) windowBestWinStreak = run;
      } else {
        run = 0;
      }
    }
  }

  // Oldest first for eloHistory and sessions
  const chronological = [...list].reverse();
  const eloHistory: EloPoint[] = [];
  for (const m of chronological) {
    const mine = m.changes?.find((c) => normUuid(c.uuid) === me);
    if (mine && typeof mine.eloRate === "number" && Number.isFinite(mine.eloRate)) {
      const change =
        typeof mine.change === "number" && Number.isFinite(mine.change) ? mine.change : 0;
      eloHistory.push({
        date: m.date,
        elo: mine.eloRate + change,
        change,
        matchId: m.id,
      });
    }
  }

  const windowPlayed = list.length;
  const windowDecided = windowWins + windowLosses;
  const windowBest = completionTimesMs.length > 0 ? Math.min(...completionTimesMs) : null;
  const averageWinMs = meanRounded(completionTimesMs);
  const medianWinMs = medianRounded(completionTimesMs);
  const histogram = buildHistogram(completionTimesMs);

  const recentSample = Math.min(20, decidedSeq.length);
  const recentWins = decidedSeq.slice(0, recentSample).filter((o) => o === "win").length;
  const recentWinRate = pct(recentWins, recentSample);

  const vsHigher = {
    decided: vsHigherDecided,
    wins: vsHigherWins,
    winRate: pct(vsHigherWins, vsHigherDecided),
  };
  const vsLower = {
    decided: vsLowerDecided,
    wins: vsLowerWins,
    winRate: pct(vsLowerWins, vsLowerDecided),
  };

  const forfeitRate = windowDecided > 0 ? round1((forfeits.yours / windowDecided) * 100) : 0;

  // Deaths from Ranked details that have timelines
  const detailsWithTimelines: MatchDetail[] = [];
  const detailMap = new Map<number, MatchDetail>();
  for (const d of details ?? []) {
    if (!d || (d.type !== undefined && d.type !== 2)) continue;
    if (season !== undefined && d.season !== undefined && d.season !== season) continue;
    if (!Array.isArray(d.timelines)) continue;
    if (typeof d.id === "number" && detailMap.has(d.id)) continue;
    if (typeof d.id === "number") detailMap.set(d.id, d);
    detailsWithTimelines.push(d);
  }

  let totalDeaths = 0;
  for (const d of detailsWithTimelines) {
    for (const e of d.timelines ?? []) {
      if (normUuid(e.uuid) === me && e.type === "projectelo.timeline.death") {
        totalDeaths++;
      }
    }
  }
  const deathMatches = detailsWithTimelines.length;
  const deaths = {
    total: totalDeaths,
    matches: deathMatches,
    perMatch: deathMatches > 0 ? round2(totalDeaths / deathMatches) : 0,
  };

  // Headline totals from user.statistics if we have it, else the match window
  const s = user?.statistics?.season ?? user?.statistics?.total;
  const sWins = s?.wins?.ranked ?? undefined;
  const sLoses = (s?.loses?.ranked ?? s?.losses?.ranked) ?? undefined;
  const sPlayed = s?.playedMatches?.ranked ?? undefined;
  const sCurStreak = s?.currentWinStreak?.ranked ?? undefined;
  const sBestStreak = s?.highestWinStreak?.ranked ?? undefined;
  const sBestTime = s?.bestTime?.ranked ?? undefined;

  let played: number;
  let wins: number;
  let losses: number;
  let draws: number;
  let decided: number;
  let winRate: number;
  let currentStreak: number;
  let bestWinStreak: number;
  let bestTimeMs: number | null;

  if (typeof sPlayed === "number" && sPlayed > 0) {
    wins = typeof sWins === "number" ? sWins : windowWins;
    losses = typeof sLoses === "number" ? sLoses : windowLosses;
    played = sPlayed;
    decided = wins + losses;
    draws = Math.max(0, played - decided);
    winRate = pct(wins, decided);
    currentStreak =
      windowCurStreak < 0
        ? windowCurStreak
        : windowCurStreak > 0
          ? Math.max(windowCurStreak, sCurStreak ?? 0)
          : (sCurStreak ?? 0);
    bestWinStreak = Math.max(sBestStreak ?? 0, windowBestWinStreak);
    bestTimeMs =
      typeof sBestTime === "number" && sBestTime > 0
        ? windowBest !== null
          ? Math.min(sBestTime, windowBest)
          : sBestTime
        : windowBest;
  } else {
    played = windowPlayed;
    wins = windowWins;
    losses = windowLosses;
    draws = windowDraws;
    decided = windowDecided;
    winRate = pct(wins, decided);
    currentStreak = windowCurStreak !== 0 ? windowCurStreak : (sCurStreak ?? 0);
    bestWinStreak = Math.max(sBestStreak ?? 0, windowBestWinStreak);
    bestTimeMs =
      typeof sBestTime === "number" && sBestTime > 0
        ? windowBest !== null
          ? Math.min(sBestTime, windowBest)
          : sBestTime
        : windowBest;
  }

  const { sessions, currentSessionGames, currentSessionNetElo } = analyzeSessions(
    chronological,
    me,
  );
  const rivals = analyzeRivals(list, me);

  const breakdowns: TypeBreakdown[] = [
    buildTypeBreakdown(
      "overworld",
      "Overworld Seed Type",
      "Nether Enter",
      OVERWORLD_TYPES,
      "story.enter_the_nether",
      (m) => m.seedType ?? m.seed?.overworld,
      list,
      detailMap,
      detailsWithTimelines,
      me,
    ),
    buildTypeBreakdown(
      "bastion",
      "Bastion Type",
      "Bastion Enter",
      BASTION_TYPES,
      "nether.find_bastion",
      (m) => m.bastionType ?? m.seed?.nether,
      list,
      detailMap,
      detailsWithTimelines,
      me,
    ),
  ];

  const stats: RankedStats = {
    played,
    wins,
    losses,
    draws,
    decided,
    winRate,
    currentStreak,
    bestWinStreak,
    bestTimeMs,
    windowPlayed,
    windowWins,
    windowLosses,
    windowDraws,
    netElo,
    biggestGain,
    biggestLoss,
    bestGainMatchId,
    worstLossMatchId,
    averageWinMs,
    medianWinMs,
    completionTimesMs,
    histogram,
    recentWinRate,
    recentSample,
    vsHigher,
    vsLower,
    forfeitRate,
    forfeits,
    deaths,
    sessions,
    currentSessionGames,
    currentSessionNetElo,
    rivals,
  };

  return { stats, eloHistory, breakdowns };
}

