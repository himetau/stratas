import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { decodeRrf } from "../src/core/replay/decode";
import { analyzeRace } from "../src/core/detect/analyze";

const NEI = new Uint8Array(readFileSync(new URL("./fixtures/nei1019-14232012.rrf", import.meta.url)));
const ME = "fba98cacdc6a495eba271ee046dcbba9", THEM = "16a45c3e54c84de3ac259b960342062b";

describe("run stats (you vs nei1019)", () => {
  const a = analyzeRace(decodeRrf(NEI), ME, THEM);
  const you = a.stats!.you;
  const notes = (phase: string) => a.report.find((p) => p.phase === phase)!.notes.map((n) => n.text);

  it("finds the fort precraft and what it made", () => {
    expect(you.precrafts.map((p) => p.kind)).toEqual(["fort"]);
    expect(you.precrafts[0].items).toMatchObject({ white_bed: 8, respawn_anchor: 4, bow: 1 });
  });

  it("counts pearls on the way to the fortress and the TNT set off for the blaze bed", () => {
    expect(you.pearlsToFort).toHaveLength(2);
    expect(you.blasts.map((b) => b.what)).toEqual(["tnt", "tnt", "tnt"]);
    expect(notes("Fortress to stronghold")).toContain("Blaze bed: 3 TNT vs 4 TNT");
  });

  it("counts barter drops picked up, including merged stacks and a stack taken in part", () => {
    // 21 from pickups (one merged stack of 14), 11 + 1 taken from a stack that didn't fit, 7 left out of reach
    expect(you.trades!.got.ender_pearl).toBe(33);
    expect(you.trades!.left.ender_pearl).toBe(9);
    expect(you.trades!.n).toBe(124);
  });

  it("finds the trade that covered what you used after the bastion", () => {
    const t = you.trades!;
    expect(t.needed && t.needed.n).toBeLessThan(t.n);
    expect(t.used.ender_pearl).toBe(11);
  });

  it("names food in the play-by-play and counts overworld wood", () => {
    expect(notes("Overworld")).toContain("Wood: 11 logs, 0 leaves vs 12 logs, 0 leaves");
    expect(a.report.flatMap((p) => p.steps.you).filter((s) => s.kind === "eat").every((s) => s.text !== "Ate")).toBe(true);
  });
});
