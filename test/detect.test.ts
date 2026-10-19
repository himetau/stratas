import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { decodeRrf } from "../src/core/replay/decode";
import { analyzeRace } from "../src/core/detect/analyze";
import { findWindows } from "../src/core/detect/windows";

const CHAVRON = new Uint8Array(readFileSync(new URL("./fixtures/chavron-14182329.rrf", import.meta.url)));
const ME = "fba98cacdc6a495eba271ee046dcbba9";
const CHAV = "e1b919fe90b044b484ff93979e8308a4";

describe("race analysis (you vs Chavron)", () => {
  const a = analyzeRace(decodeRrf(CHAVRON), ME, CHAV);

  it("aligns most of the run by place", () => {
    expect(a.matchedSeconds / a.totalSeconds).toBeGreaterThan(0.5);
    expect(a.curve[0]).toEqual([0, 0]);
  });

  it("windows net out to the final gap", () => {
    const net = a.losses.reduce((s, f) => s + f.seconds, 0) - a.gains.reduce((s, f) => s + f.seconds, 0);
    const last = a.curve.at(-1)![1];
    expect(Math.abs(net - last)).toBeLessThanOrEqual(12); // Stretches under 6s aren't findings
  });

  it("each finding's causes add up to its seconds", () => {
    for (const f of [...a.losses, ...a.gains]) {
      const sign = f.kind === "loss" ? 1 : -1;
      const sum = f.causes.reduce((s, c) => s + c.seconds, 0);
      expect(Math.abs(sum - sign * f.seconds)).toBeLessThanOrEqual(2 * 6); // Causes under 2s are hidden
    }
  });

  it("finds the death and the bastion as the biggest losses", () => {
    const keys = a.losses.slice(0, 3).flatMap((f) => f.causes.map((c) => c.key));
    expect(keys).toContain("dead");
    expect(a.losses.some((f) => f.phase === "Bastion")).toBe(true);
    expect(a.losses[0].watch.alignFrom).toBeTruthy();
  });

  it("explains the early crafting loss with what was crafted", () => {
    const early = a.losses.find((f) => f.phase === "Overworld");
    expect(early?.causes.find((c) => c.key === "craft")?.text).toMatch(/^Crafting: you \d+ s, Chavron \d+ s/);
  });
});

describe("phases", () => {
  const a = analyzeRace(decodeRrf(CHAVRON), ME, CHAV);
  it("phase changes add up to the final gap", () => {
    expect(Math.abs(a.phases.reduce((s, p) => s + p.change, 0) - a.finalGap)).toBeLessThan(0.01);
    expect(a.phases[0].name).toBe("Overworld");
    expect(a.phases.map((p) => p.name)).toContain("Bastion to fortress");
  });
});

describe("phase report", () => {
  const a = analyzeRace(decodeRrf(CHAVRON), ME, CHAV);
  const phase = (n: string) => a.report.find((p) => p.phase === n)!;
  const note = (n: string, re: RegExp) => phase(n).notes.find((x) => re.test(x.text))?.text;
  const why = (n: string, key: string) => phase(n).why.find((w) => w.key === key);
  it("splits the bastion into what sets its length, adding up to the difference", () => {
    const b = phase("Bastion");
    expect(Math.abs(b.why.reduce((s, w) => s + w.seconds, 0) - b.change!)).toBeLessThan(2);
    expect(b.why.map((w) => w.key).sort()).toEqual(["after", "pre", "trading"]);
    expect(why("Bastion", "trading")?.text).toBe("3:04 vs 2:19 · 5 vs 9 piglins at once · 7 piglins stuck on gold 3:45–5:29 · no piglin trading 33 s vs 1:13 · 123 vs 102 trades (obsidian from chests or mining 4 vs 14)");
    expect(why("Bastion", "trading")!.seconds).toBeCloseTo(45, 0);
    expect(why("Bastion", "after")?.text).toMatch(/^19 s vs 11 s · yours: moving 12 s/);
    expect(note("Bastion", /^While trading/)).toMatch(/^While trading: moving 1:06 · waiting 44 s/);
    // Same gold throws and barters, every piglin there trading
    expect(note("Bastion", /^Could have left/)).toMatch(/^Could have left: ~5:\d\d with all 12 piglins trading · ~4:\d\d plus Chavron's chest \(10 obsidian\) \(you left 6:33\)$/);
    expect(note("Bastion", /gilded/)).toBe("16 piglins angry (mined gilded blackstone) · no trades till 3:51");
  });
  it("treats the fortress and the way to the stronghold as one stretch", () => {
    expect(a.report.map((p) => p.phase)).toContain("Fortress to stronghold");
    expect(note("Fortress to stronghold", /^Blinded/)).toBe("Blinded with 4 vs 8 rods (8 vs 14 eyes) · back in the nether 11:04–12:27");
  });
  it("says what a death cost", () => {
    expect(note("Bastion to fortress", /^Died/)).toBe("Died (fell 16 blocks) · lost 128 string, 46 fire charges, 27 pearls, 24 crying obsidian · back 1:16 later");
  });
  it("builds a play-by-play from what the replay records", () => {
    const ow = phase("Overworld");
    expect(ow.steps.you.some((s) => s.text === "Looted a chest" && /^4 iron/.test(s.detail ?? ""))).toBe(true);
    expect(ow.steps.you.some((s) => s.kind === "portal" && s.detail === "5 lava, 4 water")).toBe(true);
    expect(phase("Bastion").steps.them.filter((s) => s.kind === "trade").map((s) => s.text)).toContainEqual(expect.stringMatching(/^54 trades from 15 piglins$/));
  });
});

describe("leaving the bastion", () => {
  it("counts standing still at the trade spot as still being there", () => {
    // Ranked records no position while you stand still. nei1019 stood at the trade spot 5:25-5:40
    const NEI = new Uint8Array(readFileSync(new URL("./fixtures/nei1019-14232012.rrf", import.meta.url)));
    const a = analyzeRace(decodeRrf(NEI), ME, "16a45c3e54c84de3ac259b960342062b");
    const left = a.splits.find((s) => s.name === "Left the Bastion")!;
    expect(Math.round(left.you! / 20)).toBe(344);
    expect(Math.round(left.them! / 20)).toBe(340);
  });
});

describe("leaving the bastion by pearl", () => {
  it("counts the throw, not the landing, so pearling out and walking out compare fairly", () => {
    // Pearl thrown at 5:04 lands at 5:10, blocks were placed at the spot while it flew
    const D = new Uint8Array(readFileSync(new URL("./fixtures/ruper-race.rrf", import.meta.url)));
    const a = analyzeRace(decodeRrf(D), ME, "eb4fc9846c3644709091b177a5f18c28");
    const left = a.splits.find((s) => s.name === "Left the Bastion")!;
    expect(Math.round(left.you! / 20)).toBe(304);
    expect(Math.round(left.them! / 20)).toBe(324);
    // Who got 6 rods first. Counts pickups since rods get crafted away
    const rods = a.splits.find((s) => s.name === "6 Blaze Rods")!;
    expect([Math.round(rods.you! / 20), Math.round(rods.them! / 20)]).toEqual([466, 548]);
    // Fortress to stronghold split at its milestones in time order, ends at eye spy
    const f = a.report.find((p) => p.phase === "Fortress to stronghold")!;
    expect(f.why.map((w) => [w.label, Math.round(w.seconds)])).toEqual([["6 rods", -68], ["To the stronghold", 18]]);
    // Inside the stronghold is its own phase
    const sh = a.report.find((p) => p.phase === "Stronghold")!;
    expect(Math.round(sh.change!)).toBe(12);
  });
});

describe("windows", () => {
  it("splits a rise and a fall", () => {
    const w = findWindows([[0, 0], [10, 5], [20, 12], [30, 4], [40, -6]]);
    expect(w.map((x) => [x.from[1], x.to[1]])).toEqual([[0, 12], [12, -6]]);
  });
  it("treats a long unmatched stretch as its own window", () => {
    const w = findWindows([[0, 0], [10, 1], [100, 40], [110, 41]]);
    expect(w.some((x) => x.jump && x.to[1] - x.from[1] === 39)).toBe(true);
  });
});
