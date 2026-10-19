import type { Note, Side } from "../findings";
import { fmtTime } from "../names";
import type { Mechanic, Occurrence } from "./index";

const OVERWORLD_PICKAXES = ["iron_pickaxe", "diamond_pickaxe", "golden_pickaxe"] as const;

export const overworldIronPickaxeMechanic: Mechanic = {
  key: "overworld_iron_pickaxe",
  phase: ["Overworld"],
  detect(s: Side, span?: [number, number]): Occurrence[] {
    const nether = s.run.mark("nether");
    const from = span ? span[0] : 0;
    const to = span ? (nether !== undefined ? Math.min(span[1], nether) : span[1]) : (nether ?? s.run.end);

    let bestT: number | null = null;
    let bestItem: string = "iron_pickaxe";
    for (const item of OVERWORLD_PICKAXES) {
      const t = s.run.firstReach(item, 1, from, to);
      if (t !== null && (bestT === null || t < bestT)) {
        bestT = t;
        bestItem = item;
      }
    }

    if (bestT === null) return [];
    return [
      {
        t0: bestT,
        t1: bestT,
        value: bestT,
        text: `Iron pickaxe at ${fmtTime(bestT)}`,
        meta: { item: bestItem },
      },
    ];
  },
  compare(y: Occurrence[], t: Occurrence[]): Note | null {
    if (!y.length || !t.length) return null;
    if (Math.abs(y[0].t0 - t[0].t0) < 100) return null;
    return {
      text: `Iron pickaxe at ${fmtTime(y[0].t0)} vs ${fmtTime(t[0].t0)}`,
      seconds: null,
      at: { you: y[0].t0, them: t[0].t0 },
    };
  },
};
