import type { Note, Side } from "../findings";
import { fmtTime } from "../names";
import type { Mechanic, Occurrence } from "./index";
import { overworldWindow } from "./overworld";

const OVERWORLD_PICKAXES = ["iron_pickaxe", "diamond_pickaxe", "golden_pickaxe"] as const;

const PICKAXE_NAME: Record<string, string> = {
  iron_pickaxe: "Iron pickaxe",
  diamond_pickaxe: "Diamond pickaxe",
  golden_pickaxe: "Golden pickaxe",
};

const pickaxeOf = (o: Occurrence) => PICKAXE_NAME[String(o.meta?.item)] ?? "Pickaxe";

export const overworldIronPickaxeMechanic: Mechanic = {
  key: "overworld_iron_pickaxe",
  phase: ["Overworld"],
  detect(s: Side, span?: [number, number]): Occurrence[] {
    const { from, to } = overworldWindow(s, span);
    let bestT: number | null = null;
    let bestItem = "iron_pickaxe";
    for (const item of OVERWORLD_PICKAXES) {
      const t = s.run.firstReach(item, 1, from, to);
      if (t !== null && (bestT === null || t < bestT)) {
        bestT = t;
        bestItem = item;
      }
    }

    if (bestT === null) {
      return [];
    }
    return [
      {
        t0: bestT,
        t1: bestT,
        value: bestT,
        text: `${PICKAXE_NAME[bestItem]} at ${fmtTime(bestT)}`,
        meta: { item: bestItem },
      },
    ];
  },
  compare(y: Occurrence[], t: Occurrence[]): Note | null {
    if (!y.length || !t.length) {
      return null;
    }
    if (Math.abs(y[0].t0 - t[0].t0) < 100) {
      return null;
    }
    const yours = pickaxeOf(y[0]);
    const theirs = pickaxeOf(t[0]);
    const theirsText = theirs === yours ? "" : `${theirs.toLowerCase()} at `;
    return {
      text: `${yours} at ${fmtTime(y[0].t0)} vs ${theirsText}${fmtTime(t[0].t0)}`,
      seconds: null,
      at: { you: y[0].t0, them: t[0].t0 },
    };
  },
};
