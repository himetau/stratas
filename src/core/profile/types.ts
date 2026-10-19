// All the Ranked profile types
import type { ApiMatch, ApiUser } from "../seeds/api";
import type { AtlasSplitKey } from "../seeds/atlas";
import type { HabitTrend } from "../features";
import type { MyGame } from "../service";

export interface SeasonResultEntry {
  last: { eloRate: number | null; eloRank: number | null; phasePoint?: number; percentile?: number };
  highest?: number | null;
  lowest?: number | null;
  phaseHighest?: number | null;
  phases?: { phase: number; eloRate: number | null; eloRank: number | null; point?: number }[];
}

export interface UserSeasonSummary {
  uuid: string;
  nickname: string;
  roleType?: number;
  eloRate: number | null;
  eloRank: number | null;
  country?: string | null;
  seasonResults?: Record<string, SeasonResultEntry>;
}

export interface UserStatBucket {
  ranked?: number | null;
  casual?: number | null;
}

export interface UserStatGroup {
  bestTime?: UserStatBucket;
  highestWinStreak?: UserStatBucket;
  currentWinStreak?: UserStatBucket;
  playedMatches?: UserStatBucket;
  playtime?: UserStatBucket;
  completionTime?: UserStatBucket;
  forfeits?: UserStatBucket;
  completions?: UserStatBucket;
  wins?: UserStatBucket;
  loses?: UserStatBucket;
  losses?: UserStatBucket;
}

export interface ApiUserFull extends ApiUser {
  roleType?: number;
  country?: string | null;
  season?: number;
  timestamp?: {
    firstOnline?: number;
    lastOnline?: number;
    lastRanked?: number;
    nextDecay?: number | null;
  };
  statistics?: {
    season?: UserStatGroup;
    total?: UserStatGroup;
  };
  seasonResult?: SeasonResultEntry | null;
  seasonResults?: Record<string, SeasonResultEntry>;
}

export interface MatchChange {
  uuid: string;
  change: number | null;
  eloRate: number | null;
}

export interface MatchDetail extends ApiMatch {
  season?: number;
  category?: string;
  gameMode?: string;
  changes?: MatchChange[];
  timelines?: { uuid: string; time: number; type: string }[];
  completions?: { uuid: string; time: number }[];
}

export interface ProfileUser {
  uuid: string;
  nickname: string;
  roleType?: number;
  elo: number | null;
  rank: { key: string; name: string };
  globalRank: number | null;
  country: string | null;
  nextDecay: number | null;
  season: number | undefined;
  availableSeasons: number[];
  seasonResults: Record<string, SeasonResultEntry>;
}

export interface EloPoint {
  date: number;
  elo: number;
  change: number;
  matchId: number;
}

export interface HistogramBin {
  label: string;
  minMs: number;
  maxMs: number;
  count: number;
}

export interface SessionBucket {
  label: string;
  gameRange: string;
  played: number;
  decided: number;
  wins: number;
  winRate: number;
  netElo: number;
}

export interface HeadToHeadEntry {
  uuid: string;
  nickname: string;
  elo: number | null;
  played: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  netElo: number;
  lastPlayed: number;
}

export interface RankedStats {
  // Headline totals, from user.statistics if we have it, else the match window
  played: number;
  wins: number;
  losses: number;
  draws: number;
  decided: number;
  winRate: number;
  currentStreak: number;
  bestWinStreak: number;
  bestTimeMs: number | null;
  // Match window stats (up to 100 recent matches)
  windowPlayed: number;
  windowWins: number;
  windowLosses: number;
  windowDraws: number;
  netElo: number;
  biggestGain: number;
  biggestLoss: number;
  bestGainMatchId: number | null;
  worstLossMatchId: number | null;
  averageWinMs: number | null;
  medianWinMs: number | null;
  completionTimesMs: number[];
  histogram: HistogramBin[];
  recentWinRate: number;
  recentSample: number;
  vsHigher: { decided: number; wins: number; winRate: number };
  vsLower: { decided: number; wins: number; winRate: number };
  forfeitRate: number;
  forfeits: { yours: number; theirs: number };
  deaths: { total: number; matches: number; perMatch: number };
  // "More" stats
  sessions: SessionBucket[];
  currentSessionGames: number;
  currentSessionNetElo: number;
  rivals: HeadToHeadEntry[];
}

export type SplitSegmentKey = AtlasSplitKey;

export interface SplitSegmentStat {
  key: SplitSegmentKey;
  label: string;
  // Cumulative milestone times (ms)
  bestMs: number | null;
  averageMs: number | null;
  medianMs: number | null;
  // Segment duration, ms since the previous milestone
  segmentBestMs: number | null;
  segmentAverageMs: number | null;
  segmentMedianMs: number | null;
  count: number;
  // Percentiles 0-100, higher is faster than more of the pool
  worldPercentile: number | null;
  worldPctLabel: string;
  bandPercentile: number | null;
  bandPctLabel: string;
  // Target is the median cumulative ms of the band above
  targetMs: number | null;
  targetDeltaMs: number | null; // Your medianMs - targetMs, positive means you need to cut time
  /** Median time to this split in your Elo band */
  bandMedianMs: number | null;
  /** Where the next rank's median sits in your Elo band, 0-100 higher is faster */
  targetPercentile: number | null;
  /** Same comparisons but for just this segment (since the previous split) */
  segment: { bandMedianMs: number | null; targetMs: number | null; percentile: number | null; targetPercentile: number | null };
}

export interface SplitProfile {
  segments: SplitSegmentStat[];
  analyzedMatches: number;
  worldSampleCount: number;
  band: [number, number];
  bandLabel: string;
  bandSampleCount: number;
  nextRankName: string | null;
  nextBand: [number, number] | null;
  nextBandSampleCount: number;
  speedScore: number | null;
}

export type Dimension = "winrate" | "clutch" | "closing" | "form" | "finishing" | "speed" | "survival";

export interface ScorecardDetail {
  dimension: Dimension;
  label: string;
  score: number;
  detail: string;
  sample: number;
}

export interface TypeStatRow {
  key: string;
  label: string;
  count: number;
  decided: number;
  wins: number;
  winRate: number | null;
  bestMs: number | null;
  averageMs: number | null;
  medianMs: number | null;
  timeSample: number;
}

export interface TypeBreakdown {
  dimension: "overworld" | "bastion";
  title: string;
  splitLabel: string;
  rows: TypeStatRow[];
}

export interface ProfileMatch extends MyGame {
  eloRate: number | null; // Your pre-match Elo
  eloAfter: number | null; // Your post-match Elo (eloRate + change)
  change: number | null; // Your Elo change
  opponentEloAfter: number | null;
  opponentChange: number | null;
  bastionType: string | null;
  rawSeedType: string | null;
  hasDetail: boolean;
  winChance: number | null; // 0-100 Elo win expectation vs opponent
}

export interface PhaseLossStat {
  phase: string;
  races: number;
  averageLostSeconds: number;
  medianLostSeconds: number;
  totalLostSeconds: number;
  history: number[]; // Per match change, oldest first, for sparklines
  worstRaceId: number | null;
  worstLossSeconds: number | null;
}

export interface CauseLossStat {
  key: string;
  phase: string;
  label: string;
  occurrences: number;
  totalSeconds: number;
  averageSeconds: number;
  medianSeconds: number;
  worstRaceId: number;
  worstOpponent: string;
  worstSeconds: number;
  worstAtTick?: number;
  worstText: string;
}

export interface MechanicFreqStat {
  key: string;
  phase: string;
  label: string;
  fires: number;
  totalMatches: number;
  rate: number; // 0-100%
  totalSeconds: number;
  sampleText: string;
  raceId: number | null;
}

export interface ReplayTrends {
  analyzedMatches: number;
  phases: PhaseLossStat[];
  topCauses: CauseLossStat[];
  mechanics: MechanicFreqStat[];
  trends: HabitTrend[];
}

export interface GoalTarget {
  key: SplitSegmentKey;
  label: string;
  yourMedianMs: number;
  targetMedianMs: number;
  secondsToCut: number; // Positive means seconds you need to save
}

export interface Insight {
  kind: "strength" | "weakness" | "note" | "goal";
  label: string;
  detail: string;
  raceId?: number | null;
  matchId?: number | null;
  secondsToCut?: number | null;
  targets?: GoalTarget[];
}

export interface MatchTimelineEvent {
  key: string;
  label: string;
  ms: number;
  milestone: boolean;
}

export interface MatchBreakdownRow {
  key: string;
  label: string;
  youMs: number | null;
  themMs: number | null;
  /** youMs - themMs, negative means you're ahead */
  deltaMs: number | null;
}

export interface MatchSplitsBreakdown {
  youEvents: MatchTimelineEvent[];
  themEvents: MatchTimelineEvent[];
  timestamps: MatchBreakdownRow[];
  segments: MatchBreakdownRow[];
}

export interface ProfileData {
  user: ProfileUser | null;
  stats: RankedStats;
  eloHistory: EloPoint[];
  splits: SplitProfile;
  scorecard: Record<Dimension, number>;
  scorecardDetails: ScorecardDetail[];
  breakdowns: TypeBreakdown[];
  matches: ProfileMatch[];
  replays: ReplayTrends;
  insights: Insight[];
  fetchedAt: number | null;
  partial: boolean;
  offline: boolean;
}
