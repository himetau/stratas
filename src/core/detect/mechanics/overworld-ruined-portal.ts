import type { Note, Side } from "../findings";
import { fmtDur, fmtTime } from "../names";
import type { Mechanic, Occurrence } from "./index";

const dur = (t: number) => fmtDur(t / 20);

export const overworldRuinedPortalMechanic: Mechanic = {
  key: "overworld_ruined_portal",
  phase: ["Overworld"],
  detect(s: Side, span?: [number, number]): Occurrence[] {
    const nether = s.run.mark("nether");
    if (nether === undefined) return [];
    const from = span ? span[0] : 0;
    const to = span ? Math.min(span[1], nether) : nether;
    const inOverworld = (t: number, w?: number) =>
      t >= from && t <= to && t < nether && (w === undefined || w === 0);

    const lavaEmpties = s.facts.buckets.filter(
      (b) => b.op === "empty" && b.fluid === "lava" && inOverworld(b.t, s.run.posAt(b.t).w),
    ).length;
    if (lavaEmpties >= 6) return [];

    const obbyPlaces = s.run.actions.filter(
      (a) => a.kind === "place" && a.what === "obsidian" && inOverworld(a.t0, a.w),
    );
    if (obbyPlaces.length < 1) return [];

    const cryingMines = s.run.actions.filter(
      (a) =>
        a.kind === "mine" &&
        (a.item === "crying_obsidian" || a.what === "crying_obsidian") &&
        inOverworld(a.t0, a.w),
    );

    const obbyPlaced = obbyPlaces.length;
    const cryingMined = cryingMines.length;
    const t0 = Math.min(...obbyPlaces.map((a) => a.t0), ...cryingMines.map((a) => a.t0));
    const t1 = nether;
    const value = t1 - t0;

    return [
      {
        t0,
        t1,
        value,
        text: `Ruined portal frame at ${fmtTime(t0)}: ${dur(value)} (${obbyPlaced} obsidian placed${cryingMined ? `, ${cryingMined} crying obsidian mined` : ""})`,
        meta: { obbyPlaced, cryingMined },
      },
    ];
  },
  compare(y: Occurrence[], t: Occurrence[]): Note | null {
    if (!y.length || !t.length) return null;
    const yDurTicks = y[0].t1 - y[0].t0;
    const tDurTicks = t[0].t1 - t[0].t0;
    if (Math.abs(yDurTicks - tDurTicks) < 40) return null;
    const yObby = Number(y[0].meta?.obbyPlaced ?? 0);
    const tObby = Number(t[0].meta?.obbyPlaced ?? 0);
    return {
      text: `Ruined portal frame: ${dur(yDurTicks)} (${yObby} obsidian placed) vs ${dur(tDurTicks)} (${tObby} placed)`,
      seconds: null,
      at: { you: y[0].t0, them: t[0].t0 },
    };
  },
};
