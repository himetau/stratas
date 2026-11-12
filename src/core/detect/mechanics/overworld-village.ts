import type { Note, Side } from "../findings";
import { fmtTime } from "../names";
import type { Mechanic, Occurrence } from "./index";
import { isBed, overworldWindow, sumCounts } from "./overworld";

const positiveBedCount = (delta: Record<string, number> = {}) =>
  Object.entries(delta)
    .filter(([k, n]) => isBed(k) && n > 0)
    .reduce((sum, [, n]) => sum + n, 0);

export const overworldVillageMechanic: Mechanic = {
  key: "overworld_village",
  phase: ["Overworld"],
  detect(s: Side, span?: [number, number]): Occurrence[] {
    const win = overworldWindow(s, span);
    const overworldActions = s.run.actions.filter((a) => win.contains(a.t0, a.w));

    const golemKill = s.facts.kills.find(
      (k) => k.entity === "iron_golem" && win.contains(k.t, s.run.posAt(k.t).w),
    );
    const golemTick = golemKill ? golemKill.t : null;
    const golemHits = overworldActions.filter((a) => a.kind === "hit" && a.what === "iron_golem");

    const hayMined = overworldActions.filter((a) => a.kind === "mine" && a.item === "hay_block");
    const hayPicked = overworldActions.filter((a) => a.kind === "pickup" && a.item === "hay_block");
    const hayCount = Math.max(sumCounts(hayMined), sumCounts(hayPicked));

    const bedMined = overworldActions.filter((a) => a.kind === "mine" && isBed(a.item));
    const bedPicked = overworldActions.filter((a) => a.kind === "pickup" && isBed(a.item));
    const bedChests = overworldActions.filter(
      (a) => a.kind === "chest" && positiveBedCount(a.delta) > 0,
    );
    const bedChestCount = bedChests.reduce((sum, a) => sum + positiveBedCount(a.delta), 0);
    const beds = Math.max(sumCounts(bedMined), sumCounts(bedPicked)) + bedChestCount;

    if (golemTick === null && hayCount === 0 && beds === 0) {
      return [];
    }

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
    if (golemTick !== null) {
      parts.push(`iron golem at ${fmtTime(golemTick)}`);
    }
    if (hayCount > 0) {
      parts.push(`${hayCount} hay`);
    }
    if (beds > 0) {
      parts.push(`${beds} bed${beds === 1 ? "" : "s"}`);
    }

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
        if (typeof x.meta?.golemTick === "number") {
          return x.meta.golemTick;
        }
      }
      return null;
    };
    const yg = golemOf(y);
    const tg = golemOf(t);
    if (yg === null && tg === null) {
      return null;
    }
    const yf = yg !== null ? fmtTime(yg) : "—";
    const tf = tg !== null ? fmtTime(tg) : "—";
    return {
      text: `Iron golem killed at ${yf} vs ${tf}`,
      seconds: null,
      at: { you: yg ?? undefined, them: tg ?? undefined },
    };
  },
};
