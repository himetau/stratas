import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { quickRace } from "../src/core/detect/quick";
import type { MatchDetail } from "../src/core/profile/types";

const details = JSON.parse(readFileSync(new URL("./fixtures/api/match-details.json", import.meta.url), "utf8")) as MatchDetail[];
const ME = "fba98cacdc6a495eba271ee046dcbba9";

describe("quick race from API splits", () => {
  // Each player's splits from one match stand in for two separate runs on the seed
  const m = details[0];
  const them = m.players.find((p) => p.uuid !== ME)!;
  const tl = m.timelines ?? [];
  const runner = (uuid: string, name: string) => ({
    matchId: m.id, uuid, name, elo: null, timelines: tl.filter((e) => e.uuid === uuid),
    seconds: (m.completions?.find((c) => c.uuid === uuid)?.time ?? tl.filter((e) => e.uuid === uuid).at(-1)!.time) / 1000,
  });
  const a = quickRace(runner(ME, "cyoshi"), runner(them.uuid, them.nickname), { overworld: "1", nether: "2" });

  it("has the splits you both reached, in ticks, and no bastion exit", () => {
    const nether = a.splits.find((s) => s.name === "Entered the Nether")!;
    expect(nether).toEqual({ name: "Entered the Nether", you: 95000 / 50, them: 102000 / 50 });
    expect(a.splits.some((s) => s.name === "Left the Bastion")).toBe(false);
  });

  it("adds up phase changes to the final gap", () => {
    const sum = a.report.reduce((t, p) => t + (p.change ?? 0), 0);
    if (a.report.every((p) => p.change !== null)) expect(sum).toBeCloseTo(a.finalGap, 5);
    for (const p of a.report) expect(p.you === null || p.you >= 0).toBe(true);
    expect(a.curve).toEqual([]);
    expect(a.quick?.yourMatch).toBe(m.id);
    expect(a.quick?.ironPick).toBe(m.timelines!.some((e) => e.uuid === ME && e.type === "story.iron_tools"));
  });
});
