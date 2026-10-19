import type { Note, Side } from "../findings";
import { fmtTime } from "../names";
import type { Mechanic, Occurrence } from "./index";

export const overworldLavaPortalMechanic: Mechanic = {
  key: "overworld_lava_portal",
  phase: ["Overworld"],
  detect(s: Side, span?: [number, number]): Occurrence[] {
    const nether = s.run.mark("nether");
    const ops = s.facts.buckets.filter((b) => {
      if (nether !== undefined && b.t >= nether) return false;
      if (span && (b.t < span[0] || b.t > span[1])) return false;
      return true;
    });
    const lavaEmptied = ops.filter((b) => b.op === "empty" && b.fluid === "lava").length;
    if (lavaEmptied < 1) return [];
    const waterEmptied = ops.filter((b) => b.op === "empty" && b.fluid === "water").length;
    const totalOps = ops.length;
    const t0 = ops[0].t;
    const t1 = nether ?? ops[ops.length - 1].t;
    const value = t1 - t0;
    return [
      {
        t0,
        t1,
        value,
        text: `Lava portal build at ${fmtTime(t0)}: ${fmtTime(value)} (${lavaEmptied} lava, ${waterEmptied} water)`,
        meta: { lavaEmptied, waterEmptied, totalOps },
      },
    ];
  },
  compare(y: Occurrence[], t: Occurrence[]): Note | null {
    if (!y.length || !t.length) return null;
    const yo = y[0];
    const to = t[0];
    const yDur = yo.value ?? yo.t1 - yo.t0;
    const tDur = to.value ?? to.t1 - to.t0;
    const yLava = Number(yo.meta?.lavaEmptied ?? 0);
    const yWater = Number(yo.meta?.waterEmptied ?? 0);
    const yTotal = Number(yo.meta?.totalOps ?? 0);
    const tLava = Number(to.meta?.lavaEmptied ?? 0);
    const tWater = Number(to.meta?.waterEmptied ?? 0);
    const tTotal = Number(to.meta?.totalOps ?? 0);

    const durDiffers = Math.abs(yDur - tDur) >= 60;
    const opsDiffer = yLava !== tLava || yWater !== tWater || yTotal !== tTotal;
    if (!durDiffers && !opsDiffer) return null;

    return {
      text: `Lava portal build: ${fmtTime(yDur)} (${yLava} lava, ${yWater} water) vs ${fmtTime(tDur)} (${tLava} lava, ${tWater} water)`,
      seconds: null,
      at: { you: yo.t0, them: to.t0 },
    };
  },
};
