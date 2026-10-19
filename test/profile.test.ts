import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { decodeRrf } from "../src/core/replay/decode";
import { analyzeRace } from "../src/core/detect/analyze";
import { Store } from "../src/core/store";
import { Service } from "../src/core/service";
import type { Api } from "../src/core/seeds/api";
import { fetchProfile } from "../src/core/profile/fetch";
import { analyzeRanked, eloWinChance } from "../src/core/profile/stats";
import { analyzeSplitsProfile, buildMatchBreakdown, buildScorecard } from "../src/core/profile/splits";
import { analyzeReplayTrends } from "../src/core/profile/replays";
import { buildProfileInsights } from "../src/core/profile/insights";
import type { ApiUserFull, MatchDetail, UserSeasonSummary } from "../src/core/profile/types";

const ME = "fba98cacdc6a495eba271ee046dcbba9";
const CHAV = "e1b919fe90b044b484ff93979e8308a4";

/** Enough Emerald II games (1300-1399) to show next rank medians. Nether 1650 ticks = 82.5s */
const emeraldTwo = Array.from({ length: 15 }, (_, i) => ({
  matchId: 900 + i, uuid: `e2-${i}`, elo: 1310 + i * 5, won: true, seedType: "VILLAGE", bastionType: "STABLES",
  nether: 1650, bastion: 2500, fortress: 5400, blind: 8000, eye: 9200, end: 10000, finish: 11800,
}));

const userFixture = JSON.parse(
  readFileSync(new URL("./fixtures/api/user-cyoshi.json", import.meta.url), "utf8"),
) as ApiUserFull;
const seasonsFixture = JSON.parse(
  readFileSync(new URL("./fixtures/api/seasons-cyoshi.json", import.meta.url), "utf8"),
) as UserSeasonSummary;
const matchesFixture = JSON.parse(
  readFileSync(new URL("./fixtures/api/matches-cyoshi.json", import.meta.url), "utf8"),
) as MatchDetail[];
const detailsFixture = JSON.parse(
  readFileSync(new URL("./fixtures/api/match-details.json", import.meta.url), "utf8"),
) as MatchDetail[];

describe("profile stats engine (analyzeRanked & eloWinChance)", () => {
  it("computes exact win/loss counts, streaks, eloRate+change history, vsHigher/vsLower, sessions, and rivals", () => {
    expect(eloWinChance(1300, 1300)).toBe(50);
    expect(eloWinChance(1500, 1300)).toBeGreaterThan(70);
    expect(eloWinChance(null, 1300)).toBeNull();

    // No user.statistics so headline totals come from the match window
    const { stats: winStats, eloHistory, breakdowns } = analyzeRanked(ME, matchesFixture, detailsFixture, null);
    expect(winStats.windowPlayed).toBe(8);
    expect(winStats.windowWins).toBe(4);
    expect(winStats.windowLosses).toBe(3);
    expect(winStats.windowDraws).toBe(1);
    expect(winStats.played).toBe(8);
    expect(winStats.wins).toBe(4);
    expect(winStats.losses).toBe(3);
    expect(winStats.draws).toBe(1);
    expect(winStats.currentStreak).toBe(2); // Won the 2 newest games
    expect(winStats.bestWinStreak).toBe(2);

    // Elo history is oldest to newest, pre-match eloRate + change
    expect(eloHistory.length).toBe(8);
    expect(eloHistory[0]).toEqual({
      matchId: 14182329,
      date: 1792056173,
      elo: 1271 - 19,
      change: -19,
    });
    expect(eloHistory.at(-1)).toEqual({
      matchId: 14235001,
      date: 1792241000,
      elo: 1266 + 22,
      change: 22,
    });

    expect(winStats.netElo).toBe(22 + 20 - 19 - 21 + 18 + 16 + 0 - 19);
    expect(winStats.biggestGain).toBe(22);
    expect(winStats.bestGainMatchId).toBe(14235001);
    expect(winStats.biggestLoss).toBe(-21);
    expect(winStats.worstLossMatchId).toBe(14234287);

    // Win times skip forfeit wins (14233921 was a forfeit win at 313261ms)
    expect(winStats.completionTimesMs).toEqual([665000, 710000, 742000]);
    expect(winStats.bestTimeMs).toBe(665000);
    expect(winStats.medianWinMs).toBe(710000);
    expect(winStats.histogram.reduce((s, b) => s + b.count, 0)).toBe(3);

    // death_spawnpoint isn't a real death
    expect(winStats.deaths.matches).toBe(3);
    expect(winStats.deaths.total).toBe(1); // Only 14182329 has projectelo.timeline.death

    // user.statistics totals override the window counts
    const { stats: fullStats } = analyzeRanked(ME, matchesFixture, detailsFixture, userFixture);
    expect(fullStats.played).toBe(250);
    expect(fullStats.wins).toBe(130);
    expect(fullStats.losses).toBe(115);
    expect(fullStats.bestWinStreak).toBe(6);
    expect(fullStats.bestTimeMs).toBe(624925);

    expect(breakdowns.length).toBe(2);
    expect(winStats.sessions.length).toBeGreaterThan(0);
    expect(winStats.currentSessionGames).toBe(2); // 14234900 and 14235001 are 15 min apart
    const chavRival = winStats.rivals.find((r) => r.nickname === "Chavron")!;
    expect(chavRival.played).toBe(3);
    expect(chavRival.wins).toBe(1);
    expect(chavRival.losses).toBe(1);
    expect(chavRival.draws).toBe(1);
  });
});

describe("splits, percentiles, scorecard, and match breakdown", () => {
  it("computes percentiles against the splits table and builds next-tier targets", () => {
    const store = new Store(":memory:");
    for (const d of detailsFixture) store.putMatchDetail(d);

    // Seed benchmark splits across Elo bands (1200-1600)
    store.putSplits(emeraldTwo);
    store.putSplits([
      { matchId: 1, uuid: "p1", elo: 1250, won: true, seedType: "VILLAGE", bastionType: "STABLES", nether: 2200, bastion: 3400, fortress: 7200, blind: 10200, eye: 11600, end: 12600, finish: 14800 },
      { matchId: 2, uuid: "p2", elo: 1290, won: true, seedType: "VILLAGE", bastionType: "STABLES", nether: 2000, bastion: 3100, fortress: 6800, blind: 9600, eye: 11000, end: 12000, finish: 14000 },
      { matchId: 3, uuid: "p3", elo: 1420, won: true, seedType: "VILLAGE", bastionType: "STABLES", nether: 1700, bastion: 2600, fortress: 5600, blind: 8200, eye: 9400, end: 10300, finish: 12200 },
      { matchId: 4, uuid: "p4", elo: 1460, won: true, seedType: "SHIPWRECK", bastionType: "HOUSING", nether: 1650, bastion: 2500, fortress: 5400, blind: 8000, eye: 9200, end: 10000, finish: 11800 },
      { matchId: 5, uuid: "p5", elo: 1510, won: true, seedType: "VILLAGE", bastionType: "STABLES", nether: 1550, bastion: 2400, fortress: 5100, blind: 7600, eye: 8800, end: 9600, finish: 11400 },
    ]);

    const splits = analyzeSplitsProfile(store, ME, 1288, detailsFixture);
    expect(splits.analyzedMatches).toBe(3);
    expect(splits.segments.length).toBe(7);

    const nether = splits.segments.find((s) => s.key === "nether")!;
    expect(nether.bestMs).toBe(95000);
    expect(nether.medianMs).toBe(110000);
    expect(nether.worldPercentile).not.toBeNull();
    expect(nether.bandPercentile).not.toBeNull();
    expect(nether.targetMs).toBe(82500); // Median of the Emerald II games
    expect(splits.nextRankName).toBe("Emerald II");
    expect(nether.targetDeltaMs).toBe(110000 - 82500);

    const { stats } = analyzeRanked(ME, matchesFixture, detailsFixture, userFixture);
    const { scorecard, details } = buildScorecard(stats, splits);
    expect(details.length).toBe(7);
    expect(scorecard.winrate).toBeGreaterThan(0);
    expect(scorecard.survival).toBeGreaterThan(50);

    const bd = buildMatchBreakdown(detailsFixture[0], ME, CHAV);
    expect(bd.timestamps.length).toBeGreaterThanOrEqual(7);
    expect(bd.segments.length).toBeGreaterThanOrEqual(6);
    const finRow = bd.timestamps.find((r) => r.key === "finish")!;
    expect(finRow.youMs).toBe(665000);
    expect(finRow.themMs).toBe(698000);
    expect(finRow.deltaMs).toBe(-33000);
  });

  it("leaves out the next rank when the index has too few of its games", () => {
    const store = new Store(":memory:");
    store.putSplits(emeraldTwo.slice(0, 5));
    const splits = analyzeSplitsProfile(store, ME, 1288, detailsFixture);
    expect(splits.nextRankName).toBeNull();
    expect(splits.segments.every((s) => s.targetMs === null)).toBe(true);
  });
});

describe("replay trends & insights over corpus fixtures", () => {
  it("aggregates RaceAnalysis rows into phase losses, top causes, mechanics, trends, drills, and insights", () => {
    const store = new Store(":memory:");
    for (const d of detailsFixture) store.putMatchDetail(d);
    store.putSplits(emeraldTwo);
    store.putSplits([
      { matchId: 3, uuid: "p3", elo: 1420, won: true, seedType: "VILLAGE", bastionType: "STABLES", nether: 1700, bastion: 2600, fortress: 5600, blind: 8200, eye: 9400, end: 10300, finish: 12200 },
      { matchId: 4, uuid: "p4", elo: 1460, won: true, seedType: "SHIPWRECK", bastionType: "HOUSING", nether: 1650, bastion: 2500, fortress: 5400, blind: 8000, eye: 9200, end: 10000, finish: 11800 },
    ]);

    const corpusFiles: [string, string, number][] = [
      ["14182329.rrf", "e1b919fe90b044b484ff93979e8308a4", 14182329],
      ["14232012.rrf", "16a45c3e54c84de3ac259b960342062b", 14232012],
      ["14234287.rrf", "6174765b71584d18af894692b2704ae8", 14234287],
      ["vs-ruper.rrf", "eb4fc9846c3644709091b177a5f18c28", 14234900],
    ];

    corpusFiles.forEach(([file, oppUuid, matchId], i) => {
      const rep = decodeRrf(new Uint8Array(readFileSync(new URL(`./fixtures/corpus/${file}`, import.meta.url))));
      const a = analyzeRace(rep, ME, oppUuid);
      store.putRace({
        key: `match|${matchId}|${oppUuid}`,
        your_file: file,
        your_uuid: ME,
        their_file: file,
        their_uuid: oppUuid,
        their_name: a.them.name,
        their_elo: a.them.elo ?? 1350,
        tier: null,
        race_file: file,
        created_at: 1000 + i * 100,
        final_gap: a.finalGap,
        seed_type: "village / stables",
        analysis: JSON.stringify(a),
        error: null,
      });
    });

    const replays = analyzeReplayTrends(store.races());

    expect(replays.analyzedMatches).toBe(4);
    expect(replays.phases.length).toBeGreaterThan(0);
    expect(replays.phases[0].history.length).toBeGreaterThanOrEqual(2);
    expect(replays.topCauses.length).toBeGreaterThan(0);
    expect(replays.mechanics.length).toBeGreaterThan(0);

    const { stats } = analyzeRanked(ME, matchesFixture, detailsFixture, userFixture);
    const splits = analyzeSplitsProfile(store, ME, 1288, detailsFixture);
    const { details: scorecardDetails } = buildScorecard(stats, splits);
    const insights = buildProfileInsights({
      stats,
      splits,
      replays,
      scorecardDetails,
      matches: [],
    });

    expect(insights.length).toBeGreaterThan(2);
    expect(insights.some((x) => x.kind === "weakness" && x.raceId != null)).toBe(true);
    expect(insights.some((x) => x.kind === "goal" && (x.targets?.length ?? 0) > 0)).toBe(true);
  });
});

describe("Service.profile() offline & match_detail cache budget", () => {
  it("loads complete ProfileData offline from cached snapshot and avoids repeat match detail fetches", async () => {
    const svc = new Service(":memory:", { offline: true });
    svc.store.set("settings", { nickname: "cyoshi", uuid: ME });

    let detailCalls = 0;
    const mockApi = {
      remaining: () => 400,
      user: async () => userFixture,
      seasons: async () => seasonsFixture,
      userMatchesPage: async () => matchesFixture,
      match: async (id: number) => {
        detailCalls++;
        return detailsFixture.find((d) => d.id === id) ?? { ...matchesFixture.find((m) => m.id === id)!, timelines: [] };
      },
    } as unknown as Api;

    // First fetch fills the match_detail cache and snapshot
    const raw1 = await fetchProfile(svc.store, mockApi, ME);
    expect(raw1.matches.length).toBe(8);
    expect(detailCalls).toBe(8);
    expect(raw1.partial).toBe(false);

    // Second fetch has everything cached so no new detail calls
    detailCalls = 0;
    const raw2 = await fetchProfile(svc.store, mockApi, ME);
    expect(detailCalls).toBe(0);
    expect(raw2.details.length).toBe(8);

    // Offline Service.profile() reads from the snapshot and SQLite
    const prof = await svc.profile();
    expect(prof.user?.nickname).toBe("cyoshi");
    expect(prof.user?.availableSeasons).toEqual([12, 11, 10, 9]);
    expect(prof.eloHistory.length).toBe(8);
    expect(prof.matches.length).toBe(8);
    expect(prof.matches[0].winChance).not.toBeNull();

    const detail = await svc.profileMatch(14182329);
    expect(detail?.id).toBe(14182329);
    expect(detail?.timelines?.length).toBeGreaterThan(10);
    svc.stop();
  });
});
