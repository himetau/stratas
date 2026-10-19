import type { Note, Side } from "../findings";
import type { Mechanic, Occurrence } from "./index";
import { fmtDur } from "../names";

const dur = (t: number) => fmtDur(t / 20);

export const fortressBlazesMechanic: Mechanic = {
  key: "fortress_blazes",
  phase: ["Fortress", "Fortress to stronghold"],
  detect(s: Side, span?: [number, number]): Occurrence[] {
    const fortress = s.run.mark("fortress");
    if (fortress === undefined) return [];
    const from = span ? Math.max(fortress, span[0]) : fortress;
    const to = span ? span[1] : s.run.end;

    const blazeKills = s.facts.kills.filter(
      (k) => k.entity === "blaze" && k.t >= from && k.t <= to,
    );
    const blazeHits = (s.run.actions ?? []).filter(
      (a) => a.kind === "hit" && a.what === "blaze" && a.t0 >= from && a.t0 <= to,
    );

    if (blazeKills.length === 0 && blazeHits.length === 0) return [];

    const rodPickups = (s.run.actions ?? []).filter(
      (a) => a.kind === "pickup" && a.item === "blaze_rod" && a.t0 >= from && a.t0 <= to,
    );
    let rods = rodPickups.reduce((sum, a) => sum + (a.count ?? 1), 0);
    if (rods === 0 && typeof s.run.rodsAt === "function") {
      let n = 0;
      while (n < 64) {
        const rt = s.run.rodsAt(n + 1);
        if (rt === null || rt > to) break;
        if (rt >= from) rods++;
        n++;
      }
    }

    const firstKill = blazeKills[0]?.t;
    const firstHit = blazeHits[0]?.t0;
    const t0 = firstKill ?? firstHit!;
    const firstKillAfterEnterTicks = t0 - fortress;

    const rods6 = typeof s.run.rodsAt === "function" ? s.run.rodsAt(6) : null;
    const validRods6 = rods6 !== null && rods6 >= from && rods6 <= to ? rods6 : null;
    const lastKill = blazeKills.at(-1)?.t;
    const lastHit = blazeHits.at(-1)?.t1;
    const t1 = Math.max(t0, lastKill ?? validRods6 ?? lastHit ?? t0);
    const kills = blazeKills.length;

    return [
      {
        t0,
        t1,
        value: firstKillAfterEnterTicks,
        text: `First blaze killed ${dur(firstKillAfterEnterTicks)} after entering fortress (${kills} blaze${kills === 1 ? "" : "s"} killed, ${rods} rod${rods === 1 ? "" : "s"})`,
        meta: {
          firstKillAfterEnterTicks,
          kills,
          rods,
        },
      },
    ];
  },
  compare(y: Occurrence[], t: Occurrence[]): Note | null {
    if (!y.length && !t.length) return null;
    const yo = y[0];
    const to = t[0];

    const yTicks =
      typeof yo?.meta?.firstKillAfterEnterTicks === "number"
        ? yo.meta.firstKillAfterEnterTicks
        : yo?.value;
    const tTicks =
      typeof to?.meta?.firstKillAfterEnterTicks === "number"
        ? to.meta.firstKillAfterEnterTicks
        : to?.value;

    const yPre = typeof yTicks === "number" ? dur(yTicks) : "—";
    const tPre = typeof tTicks === "number" ? dur(tTicks) : "—";
    const yKills = yo ? (typeof yo.meta?.kills === "number" ? yo.meta.kills : 0) : "—";
    const tKills = to ? (typeof to.meta?.kills === "number" ? to.meta.kills : 0) : "—";

    return {
      text: `First blaze killed ${yPre} vs ${tPre} after entering fortress (${yKills} vs ${tKills} blazes killed)`,
      seconds: null,
      at: { you: yo?.t0, them: to?.t0 },
    };
  },
};
