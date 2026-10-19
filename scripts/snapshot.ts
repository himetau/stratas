// Builds src/ui/dev/snapshot.json from the test fixtures (fake Ranked folder, offline)
// so the UI can be worked on in a normal browser
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { mergeRunners } from "../src/core/replay/merge";
import { Service } from "../src/core/service";
import type { ApiUserFull, MatchDetail, UserSeasonSummary } from "../src/core/profile/types";

const CHAVRON = new Uint8Array(readFileSync("test/fixtures/chavron-14182329.rrf"));
const ME = "fba98cacdc6a495eba271ee046dcbba9", CHAV = "e1b919fe90b044b484ff93979e8308a4";
const solo = (uuid: string, patch: Record<string, unknown>) => {
  const f = unzipSync(mergeRunners([{ bytes: CHAVRON, uuid }]).bytes);
  return zipSync({ ...f, "meta.json": strToU8(JSON.stringify({ ...JSON.parse(strFromU8(f["meta.json"])), ...patch })) });
};

const root = mkdtempSync(join(tmpdir(), "stratas-snap-"));
const mc = join(root, "minecraft");
for (const d of ["mods", "mcsrranked/replay", "mcsrranked/temp-replay"]) mkdirSync(join(mc, d), { recursive: true });
writeFileSync(join(mc, "mods", "mcsrranked-6.0.3.jar"), "");
const svc = new Service(":memory:", { offline: true });
svc.store.set("settings", { nickname: "cyoshi", uuid: ME, instancePath: root });

const userFixture = JSON.parse(readFileSync("test/fixtures/api/user-cyoshi.json", "utf8")) as ApiUserFull;
const seasonsFixture = JSON.parse(readFileSync("test/fixtures/api/seasons-cyoshi.json", "utf8")) as UserSeasonSummary;
const matchesFixture = JSON.parse(readFileSync("test/fixtures/api/matches-cyoshi.json", "utf8")) as MatchDetail[];
const detailsFixture = JSON.parse(readFileSync("test/fixtures/api/match-details.json", "utf8")) as MatchDetail[];

svc.store.putMatches(matchesFixture);
for (const d of detailsFixture) svc.store.putMatchDetail(d);
svc.store.set("myGames", matchesFixture);
svc.store.set("profile:current", {
  user: userFixture,
  seasons: seasonsFixture,
  matches: matchesFixture,
  details: detailsFixture,
  partial: false,
  fetchedAt: Date.now(),
  apiCallsMade: 0,
});
svc.store.putSplits([
  { matchId: 1, uuid: "p1", elo: 1180, won: true, seedType: "VILLAGE", bastionType: "STABLES", nether: 2400, bastion: 3700, fortress: 7600, blind: 10800, eye: 12200, end: 13200, finish: 15400 },
  { matchId: 2, uuid: "p2", elo: 1250, won: true, seedType: "VILLAGE", bastionType: "STABLES", nether: 2200, bastion: 3400, fortress: 7200, blind: 10200, eye: 11600, end: 12600, finish: 14800 },
  { matchId: 3, uuid: "p3", elo: 1290, won: true, seedType: "VILLAGE", bastionType: "STABLES", nether: 2000, bastion: 3100, fortress: 6800, blind: 9600, eye: 11000, end: 12000, finish: 14000 },
  { matchId: 4, uuid: "p4", elo: 1420, won: true, seedType: "VILLAGE", bastionType: "STABLES", nether: 1700, bastion: 2600, fortress: 5600, blind: 8200, eye: 9400, end: 10300, finish: 12200 },
  { matchId: 5, uuid: "p5", elo: 1460, won: true, seedType: "SHIPWRECK", bastionType: "HOUSING", nether: 1650, bastion: 2500, fortress: 5400, blind: 8000, eye: 9200, end: 10000, finish: 11800 },
  { matchId: 6, uuid: "p6", elo: 1520, won: true, seedType: "VILLAGE", bastionType: "STABLES", nether: 1550, bastion: 2400, fortress: 5100, blind: 7600, eye: 8800, end: 9600, finish: 11400 },
]);

svc.start();
const now = Math.floor(Date.now() / 1000);
const q = (id: number, name: string, tier: string, elo: number, st: string, bt: string) => svc.store.enqueue({
  match_id: id, player_uuid: `uuid-${id}`, player_name: name, opponent_name: "someone", date: now - 3600, time: 700000, seed_type: st, bastion_type: bt, elo, tier, reason: `${tier}: ${name}, ${elo} Elo, 11:40 on ${st.toLowerCase()} / ${bt.toLowerCase()}. Close to the usual time for that Elo.` });
q(14182329, "Chavron", "next", 1390, "VILLAGE", "STABLES");
q(14215217, "Captain_Ammy", "next", 1443, "BURIED_TREASURE", "STABLES");
q(14214980, "Liqhtman", "stretch", 1535, "VILLAGE", "BRIDGE");
writeFileSync(join(mc, "mcsrranked/replay/chav.rrf"), solo(CHAV, { matchId: 14182329 }));
writeFileSync(join(mc, "mcsrranked/temp-replay/99999999.rrf"), solo(ME, { matchId: 99999999, matchType: 3 }));
writeFileSync(join(mc, "mcsrranked/temp-replay/14182329.rrf"), CHAVRON);
copyFileSync("test/fixtures/corpus/14232012.rrf", join(mc, "mcsrranked/temp-replay/14232012.rrf"));
copyFileSync("test/fixtures/corpus/14234287.rrf", join(mc, "mcsrranked/temp-replay/14234287.rrf"));
svc.rescanLibrary();
const state = svc.state();
state.you = { elo: 1288, rank: 2538, checkedAt: Date.now() };
state.tiers = { next: [1400, 1550], stretch: [1700, 2000], ceiling: [2100, 4000] }; // tierBands(1288) with no shift
state.index = { matches: 1834, scanning: false, error: null, apiLeft: 401 };
const races = Object.fromEntries(state.races.map((r) => [r.id, svc.race(r.id)]));
void (async () => {
  const profile = await svc.profile();
  profile.offline = false;
  const matchDetails = Object.fromEntries(detailsFixture.map((d) => [d.id, d]));
  mkdirSync("src/ui/dev", { recursive: true });
  writeFileSync("src/ui/dev/snapshot.json", JSON.stringify({ state, races, profile, matchDetails }));
  svc.stop();
  rmSync(root, { recursive: true, force: true });
  console.log(`snapshot: ${state.races.length} races, ${state.queue.length} queued, ${profile.matches.length} profile matches`);
})();
