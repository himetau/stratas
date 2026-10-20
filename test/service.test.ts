import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { mergeRunners } from "../src/core/replay/merge";
import { Service } from "../src/core/service";

const CHAVRON = new Uint8Array(readFileSync(new URL("./fixtures/chavron-14182329.rrf", import.meta.url)));
const ME = "fba98cacdc6a495eba271ee046dcbba9";
const CHAV = "e1b919fe90b044b484ff93979e8308a4";

/** Single runner replay, like one from somewhere else */
function solo(uuid: string, patch: Record<string, unknown>) {
  const files = unzipSync(mergeRunners([{ bytes: CHAVRON, uuid }]).bytes);
  const meta = { ...JSON.parse(strFromU8(files["meta.json"])), ...patch };
  return zipSync({ ...files, "meta.json": strToU8(JSON.stringify(meta)) });
}

describe("service: the whole loop on a fake Ranked folder", () => {
  const root = mkdtempSync(join(tmpdir(), "stratas-"));
  const mc = join(root, "minecraft");
  mkdirSync(join(mc, "mods"), { recursive: true });
  writeFileSync(join(mc, "mods", "mcsrranked-6.0.3.jar"), "");
  mkdirSync(join(mc, "mcsrranked", "replay"), { recursive: true });
  mkdirSync(join(mc, "mcsrranked", "temp-replay"), { recursive: true });
  const svc = new Service(":memory:", { offline: true, poolDir: join(root, "games") });
  svc.store.set("settings", { nickname: "cyoshi", uuid: ME, instancePath: root });
  afterAll(() => { svc.stop(); rmSync(root, { recursive: true, force: true }); });

  it("downloaded run -> seeds -> your private-room run -> quick splits -> race file + analysis", async () => {
    svc.start();
    svc.store.enqueue({ match_id: 14182329, player_uuid: CHAV, player_name: "Chavron", opponent_name: "cyoshi", date: Math.floor(Date.now() / 1000),
      time: 785002, seed_type: "VILLAGE", bastion_type: "STABLES", elo: 1390, tier: "next", reason: "test" });

    // 1. Download their replay in Ranked (lands in My Replays under the name you typed)
    writeFileSync(join(mc, "mcsrranked", "replay", "chav.rrf"), solo(CHAV, { matchId: 14182329 }));
    svc.rescanLibrary();
    const q = svc.store.queueRow(14182329)!;
    expect(q.status).toBe("downloaded");
    expect(q.overworld_seed).toBe("-3566570342730286256");
    expect(q.nether_seed).toBe("198406064683359");

    // 2. Copy the seed and play it solo in a private room. Ranked's API has the splits right away
    svc.practicing(14182329);
    const notes: { id: number | null; title: string; body: string }[] = [];
    svc.on("newGame", (n) => notes.push(n));
    const splits = (uuid: string, ms: [string, number][]) => ms.map(([type, time]) => ({ uuid, type, time }));
    const now = Math.floor(Date.now() / 1000);
    const detail = (id: number, uuid: string, name: string, time: number, timelines: { uuid: string; type: string; time: number }[]) => ({
      id, type: id === 14182329 ? 2 : 3, date: now + 5, seed: null, seedType: null, bastionType: null, players: [{ uuid, nickname: name, eloRate: null, eloRank: null }],
      result: { uuid, time }, forfeited: false, timelines, completions: [{ uuid, time }], changes: [] });
    svc.store.putMatchDetail(detail(99999999, ME, "cyoshi", 950000, splits(ME, [["story.enter_the_nether", 120000], ["story.iron_tools", 60000], ["nether.find_bastion", 170000], ["projectelo.timeline.dragon_death", 950000]])) as never);
    svc.store.putMatchDetail(detail(14182329, CHAV, "Chavron", 785002, splits(CHAV, [["story.enter_the_nether", 100000], ["nether.find_bastion", 140000], ["projectelo.timeline.dragon_death", 785002]])) as never);
    svc.store.set("myPrivate", [{ id: 99999999, type: 3, date: now + 5, seedType: null, bastionType: null, players: [{ uuid: ME, nickname: "cyoshi" }], result: { uuid: ME, time: 950000 }, forfeited: false }]);
    await (svc as unknown as { quickRaces(): Promise<void> }).quickRaces();
    const quick = svc.state().races.find((r) => r.quick)!;
    expect(quick.theirName).toBe("Chavron");
    expect(quick.finalGap).toBeCloseTo((950000 - 785002) / 1000, 1);
    expect(svc.race(quick.id)!.analysis!.splits.map((s) => s.name)).toEqual(["Entered the Nether", "Entered Bastion", "Defeated the Dragon"]);
    expect(svc.store.queueRow(14182329)!.status).toBe("raced");
    expect(notes.map((n) => n.title)).toEqual(["vs Chavron · splits"]);

    // 3. Ranked saves your replay, the full race replaces the quick one
    writeFileSync(join(mc, "mcsrranked", "temp-replay", "99999999.rrf"), solo(ME, { matchId: 99999999, matchType: 3 }));
    svc.rescanLibrary();
    expect(svc.state().races.some((r) => r.quick)).toBe(false);

    const st = svc.state();
    const race = st.races.find((r) => r.kind === "race")!;
    expect(race.error).toBeNull();
    expect(race.theirName).toBe("Chavron");
    expect(race.tier).toBe("next");
    expect(Math.round(race.finalGap)).toBe(159);
    expect(svc.store.queueRow(14182329)!.status).toBe("raced");
    expect(readdirSync(join(mc, "mcsrranked", "replay")).some((f) => f.startsWith("vs Chavron "))).toBe(true);
    expect(st.gate.status).toBe("ok");
    expect(svc.race(race.id)!.analysis!.losses.length).toBeGreaterThan(3);
  });

  it("pops up a ranked game you just played and keeps the newest ones", () => {
    const games: { id: number; title: string }[] = [];
    svc.on("newGame", (g) => games.push(g));
    svc.store.set("settings", { ...svc.settings(), poolSize: 2 });
    /** Your Ranked game, both players in one replay, played `ago` ms ago */
    const game = (id: number, ago: number) => {
      const files = unzipSync(CHAVRON);
      const meta = { ...JSON.parse(strFromU8(files["meta.json"])), matchId: id, matchType: 2, date: Date.now() - ago };
      return zipSync({ ...files, "meta.json": strToU8(JSON.stringify(meta)) });
    };
    const temp = join(mc, "mcsrranked", "temp-replay");
    writeFileSync(join(temp, "20000001.rrf"), game(20000001, 3 * 3600_000));
    writeFileSync(join(temp, "20000002.rrf"), game(20000002, 2 * 3600_000));
    svc.rescanLibrary();
    expect(games).toEqual([]); // Games from before Stratas started don't pop up
    writeFileSync(join(temp, "20000003.rrf"), game(20000003, 60_000));
    svc.rescanLibrary();
    expect(games.map((g) => g.title)).toEqual([expect.stringMatching(/^vs Chavron · \+2:39$/)]);
    // Games stay in games/ forever, no poolSize eviction
    const pooled = readdirSync(join(root, "games")).sort();
    expect(pooled).toEqual(expect.arrayContaining(["20000001.rrf", "20000002.rrf", "20000003.rrf"]));
    const keys = svc.store.races().map((r) => r.key);
    expect(keys.some((k) => k.startsWith("match|20000001|"))).toBe(true);
    expect(keys.some((k) => k.startsWith("match|20000002|"))).toBe(true);
    expect(keys.some((k) => k.startsWith("match|20000003|"))).toBe(true);
  });

  it("treats a replay you named \"vs someone\" as your game, not a Stratas race file", () => {
    const files = unzipSync(CHAVRON);
    const meta = { ...JSON.parse(strFromU8(files["meta.json"])), matchId: 20000009, matchType: 2, date: Date.now() };
    writeFileSync(join(mc, "mcsrranked", "replay", "vs nei1019V.rrf"), zipSync({ ...files, "meta.json": strToU8(JSON.stringify(meta)) }));
    svc.rescanLibrary();
    expect(svc.store.run(join(mc, "mcsrranked", "replay", "vs nei1019V.rrf"))!.kind).toBe("ranked");
    expect(svc.store.races().some((r) => r.key.startsWith("match|20000009|"))).toBe(true);
  });
});
