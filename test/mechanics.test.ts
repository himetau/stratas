import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { decodeRrf } from "../src/core/replay/decode";
import { analyzeRace } from "../src/core/detect/analyze";
import { buildActivities } from "../src/core/detect/activity";
import { Facts } from "../src/core/detect/facts";
import { Run } from "../src/core/detect/run";
import { buildSteps } from "../src/core/detect/steps";
import { pearlHangs } from "../src/core/detect/bastion";
import { MECHANICS } from "../src/core/detect/mechanics";
import { computeBandStats, extractSplitsFromTimeline } from "../src/core/seeds/atlas";
import { computeTrends } from "../src/core/features";
import { Store } from "../src/core/store";
import type { Side } from "../src/core/detect/findings";

const corpus = (name: string) => decodeRrf(new Uint8Array(readFileSync(new URL(`./fixtures/corpus/${name}`, import.meta.url))));
const makeSide = (rep: ReturnType<typeof decodeRrf>, uuid: string): Side => {
  const p = rep.meta.players.find((x) => x.uuid === uuid);
  const run = new Run(uuid, p?.nickname ?? uuid, rep.events.get(uuid)!, rep.timelines);
  const tl = buildActivities(run);
  const facts = new Facts(run);
  const steps = buildSteps(run, tl, facts);
  return { run, tl, facts, steps };
};

const ME = "fba98cacdc6a495eba271ee046dcbba9";

describe("corpus manifest & claims", () => {
  const manifest = JSON.parse(readFileSync(new URL("./fixtures/corpus/manifest.json", import.meta.url), "utf8"));

  it("has at least 12 runs in the v40+ corpus", () => {
    expect(manifest.runCount).toBeGreaterThanOrEqual(12);
    expect(manifest.files.length).toBe(11);
  });

  it("emits structured claims behind debugClaims", () => {
    const rep = corpus("14182329.rrf");
    const a = analyzeRace(rep, ME, "e1b919fe90b044b484ff93979e8308a4", { debugClaims: true, file: "14182329.rrf" });
    expect(a.claims).toBeDefined();
    expect(a.claims!.length).toBeGreaterThan(20);
    expect(a.claims![0]).toMatchObject({ file: "14182329.rrf", uuid: ME });
  });
});

describe("mechanic detectors on corpus runs", () => {
  it("registers all 15 mechanics and detects occurrences on corpus replays", () => {
    expect(MECHANICS.length).toBeGreaterThanOrEqual(15);
    const r1418 = corpus("14182329.rrf");
    const r1423 = corpus("14232012.rrf");
    const r14234 = corpus("14234287.rrf");
    const rRuper = corpus("vs-ruper.rrf");
    const rAmmy = corpus("ref-ammy-14215217.rrf");

    const sCyoshi1418 = makeSide(r1418, ME);
    const sChav1418 = makeSide(r1418, "e1b919fe90b044b484ff93979e8308a4");
    const sCyoshi1423 = makeSide(r1423, ME);
    const sCyoshi14234 = makeSide(r14234, ME);
    const sCyoshiRuper = makeSide(rRuper, ME);
    const sSeedoose = makeSide(rAmmy, "e0007fa8bc5f419bb88a5fc6566309bd");

    const findMech = (k: string) => MECHANICS.find((m) => m.key === k)!;

    expect(findMech("overworld_lava_portal").detect(sCyoshi1418).length).toBeGreaterThan(0);
    expect(findMech("overworld_ruined_portal").detect(sCyoshi14234).length).toBeGreaterThan(0);
    expect(findMech("overworld_buried_treasure").detect(sSeedoose).length).toBeGreaterThan(0);
    expect(findMech("overworld_shipwreck").detect(sCyoshiRuper).length).toBeGreaterThan(0);
    expect(findMech("overworld_village").detect(sCyoshi1418).length).toBeGreaterThan(0);
    expect(findMech("overworld_desert_temple").detect(sCyoshi1423).length).toBeGreaterThan(0);
    expect(findMech("overworld_iron_pickaxe").detect(sCyoshi1418).length).toBeGreaterThan(0);
    expect(findMech("bastion_gold_blocks").detect(sCyoshi1418).length).toBeGreaterThan(0);
    expect(findMech("bastion_craft_overlap").detect(sCyoshi1418).length).toBeGreaterThan(0);
    expect(findMech("fortress_blazes").detect(sChav1418).length).toBeGreaterThan(0);
    expect(findMech("stronghold_nav").detect(sChav1418).length).toBeGreaterThan(0);
  });
});

describe("audit swarm bug regressions (Track B & Track H)", () => {
  it("detects chunk-unload pearl hangs in corpus replays", () => {
    const r1423 = corpus("14232012.rrf");
    const cyoshi = makeSide(r1423, ME).run;
    const hangs = pearlHangs(cyoshi);
    expect(hangs.length).toBeGreaterThanOrEqual(2);
    expect(hangs[0]).toEqual({ thrown: 6662, landed: 6883 });
  });

  it("does not rewind treasure bastion exit before final pearl pickups on hang pearl", () => {
    const rKarlo = corpus("vs-karlo585.rrf");
    const a = analyzeRace(rKarlo, ME, "9082a76b973d4407a23691c388b36530");
    const left = a.splits.find((s) => s.name === "Left the Bastion")!;
    // cyoshi threw a hang pearl at 5:07 (6142t) and kept collecting trades until 6247t before leaving at 5:14 (6284t)
    expect(Math.round(left.you! / 20)).toBe(314);
  });

  it("does not truncate bastion phase when a runner dies inside the bastion and returns to trade", () => {
    const rRuper = corpus("ref-ruper-14240580.rrf");
    const sports = makeSide(rRuper, "7b088c82e25249bfae8e82d24ed3cd92").run;
    // sportsguyyyy died at 3396t before trading, came back and traded until ~6807t
    expect(sports.mark("bastion_left")!).toBeGreaterThan(6800);
  });

  it("does not charge stale Overworld leaf decay or End bed explosions as mining", () => {
    const r1423 = corpus("14232012.rrf");
    const a1423 = analyzeRace(r1423, ME, "16a45c3e54c84de3ac259b960342062b");
    const nt = a1423.report.find((p) => p.phase === "Nether travel")!;
    expect(nt.why.some((w) => w.label === "Mining on the way")).toBe(false);

    const rRuper = corpus("vs-ruper.rrf");
    const aRuper = analyzeRace(rRuper, ME, "eb4fc9846c3644709091b177a5f18c28");
    const end = aRuper.report.find((p) => p.phase === "End")!;
    expect(end.why.find((w) => w.label === "Mining")?.seconds ?? 0).toBeLessThan(10);
  });

  it("splits block placement clusters across pearl teleports and dimension changes", () => {
    const rRuper = corpus("vs-ruper.rrf");
    const aRuper = analyzeRace(rRuper, ME, "eb4fc9846c3644709091b177a5f18c28");
    const b2f = aRuper.report.find((p) => p.phase === "Bastion to fortress")!;
    expect(b2f.steps.you.some((s) => /Bridged 88 blocks/.test(s.text))).toBe(false);
  });

  it("does not count ender_eye loss on Overworld death as portal frame fills", () => {
    const rAmmy = corpus("ref-ammy-14215217.rrf");
    const seedoose = makeSide(rAmmy, "e0007fa8bc5f419bb88a5fc6566309bd");
    const ammy = makeSide(rAmmy, "6504ac9e57c14216871a5b220bac7a21");
    expect(seedoose.facts.framesFilled.length).toBe(0);
    expect(ammy.facts.framesFilled.length).toBeLessThanOrEqual(12);
  });
});

describe("Elo benchmark atlas & Track F features", () => {
  it("computes Elo band split medians", () => {
    const store = new Store(":memory:");
    const rows = extractSplitsFromTimeline(
      {
        id: 1, type: 2, date: 1000, seedType: "VILLAGE", bastionType: "STABLES",
        players: [{ uuid: "u1", nickname: "p1", eloRate: 1550 }],
        result: { uuid: "u1", time: 600_000 }, forfeited: false,
      },
      [
        { uuid: "u1", type: "story.enter_the_nether", time: 90_000 },
        { uuid: "u1", type: "nether.find_bastion", time: 120_000 },
        { uuid: "u1", type: "nether.find_fortress", time: 260_000 },
      ],
    );
    store.putSplits([
      ...rows,
      { ...rows[0], matchId: 2, uuid: "u2", fortress: 5000 },
      { ...rows[0], matchId: 3, uuid: "u3", fortress: 5400 },
    ]);
    const stats = computeBandStats(store.splitsForBand(1500, 1700, null, "STABLES"), [1500, 1700], null, "STABLES");
    expect(stats.count).toBe(3);
    expect(stats.medians.fortress).toBe(5200);
  });

  it("computes trends", () => {
    const r = corpus("vs-ruper.rrf");
    const a = analyzeRace(r, ME, "eb4fc9846c3644709091b177a5f18c28");
    const trends = computeTrends([
      { id: 1, createdAt: 1, analysis: a },
      { id: 2, createdAt: 2, analysis: a },
      { id: 3, createdAt: 3, analysis: a },
      { id: 4, createdAt: 4, analysis: a },
    ]);
    expect(trends.length).toBeGreaterThan(0);
  });
});
