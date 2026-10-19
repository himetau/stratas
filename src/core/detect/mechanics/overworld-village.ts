import type { Note, Side } from "../findings";
import { fmtTime } from "../names";
import type { Mechanic, Occurrence } from "./index";

const isBed = (item?: string) => Boolean(item && (item === "bed" || item.endsWith("_bed")));

export const overworldVillageMechanic: Mechanic = {
  key: "overworld_village",
  phase: ["Overworld"],
  detect(s: Side, span?: [number, number]): Occurrence[] {
    const nether = s.run.mark("nether");
    const from = span ? span[0] : 0;
    const to = span ? span[1] : (nether ?? s.run.end);
    const inOverworld = (t: number, w?: number) =>
      t >= from && t <= to && (nether === undefined || t <= nether) && (w === undefined || w === 0);

    const golemKill = s.facts.kills.find(
      (k) => k.entity === "iron_golem" && inOverworld(k.t, s.run.posAt(k.t).w),
    );
    const golemTick = golemKill ? golemKill.t : null;
    const golemHits = s.run.actions.filter(
      (a) => a.kind === "hit" && a.what === "iron_golem" && inOverworld(a.t0, a.w),
    );

    const hayMined = s.run.actions.filter(
      (a) => a.kind === "mine" && a.item === "hay_block" && inOverworld(a.t0, a.w),
    );
    const hayPicked = s.run.actions.filter(
      (a) => a.kind === "pickup" && a.item === "hay_block" && inOverworld(a.t0, a.w),
    );
    const hayMinedCount = hayMined.reduce((sum, a) => sum + (a.count ?? 1), 0);
    const hayPickedCount = hayPicked.reduce((sum, a) => sum + (a.count ?? 1), 0);
    const hayCount = Math.max(hayMinedCount, hayPickedCount);

    const bedMined = s.run.actions.filter(
      (a) => a.kind === "mine" && isBed(a.item) && inOverworld(a.t0, a.w),
    );
    const bedPicked = s.run.actions.filter(
      (a) => a.kind === "pickup" && isBed(a.item) && inOverworld(a.t0, a.w),
    );
    const bedChests = s.run.actions.filter(
      (a) =>
        a.kind === "chest" &&
        inOverworld(a.t0, a.w) &&
        Object.entries(a.delta ?? {}).some(([k, n]) => isBed(k) && n > 0),
    );
    const bedMinedCount = bedMined.reduce((sum, a) => sum + (a.count ?? 1), 0);
    const bedPickedCount = bedPicked.reduce((sum, a) => sum + (a.count ?? 1), 0);
    const bedChestCount = bedChests.reduce(
      (sum, a) =>
        sum +
        Object.entries(a.delta ?? {})
          .filter(([k, n]) => isBed(k) && n > 0)
          .reduce((acc, [, n]) => acc + n, 0),
      0,
    );
    const beds = Math.max(bedMinedCount, bedPickedCount) + bedChestCount;

    if (golemTick === null && hayCount === 0 && beds === 0) return [];

    const starts: number[] = [];
    const ends: number[] = [];
    if (golemTick !== null) {
      starts.push(golemTick);
      ends.push(golemTick);
      for (const h of golemHits) {
        starts.push(h.t0);
        ends.push(h.t1);
      }
    }
    for (const a of [...hayMined, ...hayPicked, ...bedMined, ...bedPicked, ...bedChests]) {
      starts.push(a.t0);
      ends.push(a.t1);
    }

    const t0 = Math.min(...starts);
    const t1 = Math.max(...ends);
    const parts: string[] = [];
    if (golemTick !== null) parts.push(`iron golem at ${fmtTime(golemTick)}`);
    if (hayCount > 0) parts.push(`${hayCount} hay`);
    if (beds > 0) parts.push(`${beds} bed${beds === 1 ? "" : "s"}`);

    return [
      {
        t0,
        t1,
        value: t1 - t0,
        text: `${fmtTime(t0)} village (${parts.join(", ")})`,
        meta: { golemTick, hayCount, beds },
      },
    ];
  },
  compare(y: Occurrence[], t: Occurrence[]): Note | null {
    const golemOf = (xs: Occurrence[]): number | null => {
      for (const x of xs) {
        if (typeof x.meta?.golemTick === "number") return x.meta.golemTick;
      }
      return null;
    };
    const yg = golemOf(y);
    const tg = golemOf(t);
    if (yg === null && tg === null) return null;
    const yf = yg !== null ? fmtTime(yg) : "—";
    const tf = tg !== null ? fmtTime(tg) : "—";
    return {
      text: `Iron golem killed at ${yf} vs ${tf}`,
      seconds: null,
      at: { you: yg ?? undefined, them: tg ?? undefined },
    };
  },
};
