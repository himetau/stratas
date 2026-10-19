import type { Note, Side } from "../findings";
import { fmtTime } from "../names";
import type { Mechanic, Occurrence } from "./index";

export const netherBridgingMechanic: Mechanic = {
  key: "nether_bridging",
  phase: ["Nether travel", "Bastion to fortress", "Bastion to blind", "After the bastion"],
  detect(s: Side, span?: [number, number]): Occurrence[] {
    const [t0, t1] = span ?? [0, s.run.end];
    const places = s.run.actions.filter((a) => a.kind === "place" && a.t0 >= t0 && a.t0 < t1);
    const pearls = s.run.actions.filter((a) => a.kind === "pearl" && a.t0 >= t0 && a.t0 < t1);
    const blocks = places.length;
    const pearlCount = pearls.length;
    if (blocks === 0 && pearlCount === 0) return [];
    const firstT = places[0]?.t0 ?? pearls[0]?.t0 ?? t0;
    const lastT = places.at(-1)?.t1 ?? pearls.at(-1)?.t1 ?? firstT;
    return [
      {
        t0: firstT,
        t1: lastT,
        value: blocks,
        text: `${fmtTime(firstT)} placed ${blocks} block${blocks === 1 ? "" : "s"}${pearlCount ? `, ${pearlCount} pearl${pearlCount === 1 ? "" : "s"}` : ""}`,
        meta: { blocks, pearls: pearlCount },
      },
    ];
  },
  compare(y: Occurrence[], t: Occurrence[]): Note | null {
    const blocksOf = (xs: Occurrence[]) =>
      xs.reduce((sum, x) => sum + (typeof x.meta?.blocks === "number" ? x.meta.blocks : (x.value ?? 1)), 0);
    const yBlocks = blocksOf(y);
    const tBlocks = blocksOf(t);
    if (Math.abs(yBlocks - tBlocks) < 10) return null;
    return {
      text: `Blocks placed on the way: ${yBlocks} vs ${tBlocks}`,
      seconds: null,
      at: { you: y[0]?.t0, them: t[0]?.t0 },
    };
  },
};
