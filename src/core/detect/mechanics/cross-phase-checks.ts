import { ACTIVITIES, countActivities } from "../activity";
import type { Note, Side, Span } from "../findings";
import { fmtTime } from "../names";
import type { Mechanic, Occurrence } from "./index";

const PIE_INDEX = ACTIVITIES.indexOf("pie");
const FIRE_RES_DURATION = 3600;

export const pieChartMechanic: Mechanic = {
  key: "pie_chart",
  phase: ["*"],
  detect(s: Side, span?: [number, number]): Occurrence[] {
    const [t0, t1] = span ?? [0, s.run.end];
    const sec = countActivities(s.tl, t0, t1).pie;
    if (sec <= 0) return [];

    const a = Math.max(0, Math.round(t0));
    const b = Math.min(s.tl.act.length, Math.round(t1));
    let firstT = a;
    let lastT = b;
    for (let t = a; t < b; t++) {
      if (s.tl.act[t] === PIE_INDEX) {
        firstT = t;
        break;
      }
    }
    for (let t = b - 1; t >= a; t--) {
      if (s.tl.act[t] === PIE_INDEX) {
        lastT = t + 1;
        break;
      }
    }

    return [
      {
        t0: firstT,
        t1: lastT,
        value: sec,
        text: `Pie chart: ${Math.round(sec)} s`,
        meta: { seconds: sec },
      },
    ];
  },
  compare(y: Occurrence[], t: Occurrence[], Y?: Side, T?: Side, ys?: Span, ts?: Span): Note | null {
    const secOf = (xs: Occurrence[], side?: Side, sp?: Span): number => {
      if (xs.length > 0) {
        return xs.reduce(
          (sum, x) => sum + (typeof x.meta?.seconds === "number" ? x.meta.seconds : (x.value ?? 0)),
          0,
        );
      }
      if (side && sp) return countActivities(side.tl, sp[0], sp[1]).pie;
      return 0;
    };

    const ySec = secOf(y, Y, ys);
    const tSec = secOf(t, T, ts);
    if (ySec < 3 && tSec < 3) return null;

    return {
      text: `Pie chart: ${Math.round(ySec)} s vs ${Math.round(tSec)} s`,
      seconds: null,
      at: { you: y[0]?.t0, them: t[0]?.t0 },
    };
  },
};

export const fireResMechanic: Mechanic = {
  key: "fire_res",
  phase: ["Bastion", "Bastion to fortress", "Fortress to stronghold"],
  detect(s: Side, span?: [number, number]): Occurrence[] {
    const [t0, t1] = span ?? [0, s.run.end];
    const fireResTicks = s.facts.fireRes.filter((t) => t >= t0 && t <= t1);
    const deaths = s.tl?.deaths ?? [];

    const isFireResActive = (t: number) =>
      s.facts.fireRes.some(
        (ft) =>
          ft <= t &&
          t - ft <= FIRE_RES_DURATION &&
          !deaths.some((d) => d.t >= ft && d.t <= t),
      );

    const burnHits = s.facts.hurt.filter(
      (h) =>
        h.t >= t0 &&
        h.t <= t1 &&
        h.by === null && // Not a mob, so lava, fire or a fall. The replay doesn't say which
        !isFireResActive(h.t),
    );

    if (fireResTicks.length === 0 && burnHits.length === 0) return [];

    const firstFireRes = fireResTicks[0] ?? null;
    const firstBurn = burnHits[0]?.t ?? null;
    const startT =
      firstFireRes !== null && firstBurn !== null
        ? Math.min(firstFireRes, firstBurn)
        : (firstFireRes ?? firstBurn ?? t0);
    const endT = Math.max(
      fireResTicks.at(-1) ?? startT,
      burnHits.at(-1)?.t ?? startT,
    );
    const hasFireRes = fireResTicks.length > 0;
    const burnCount = burnHits.length;

    const text = hasFireRes
      ? `Fire resistance at ${fmtTime(firstFireRes!)}${burnCount > 0 ? ` (${burnCount} non-mob hit${burnCount === 1 ? "" : "s"} without fire res)` : ""}`
      : `No fire resistance (${burnCount} non-mob hit${burnCount === 1 ? "" : "s"})`;

    return [
      {
        t0: startT,
        t1: endT,
        value: burnCount > 0 ? burnCount : fireResTicks.length,
        text,
        meta: {
          hasFireRes,
          fireResAt: firstFireRes,
          fireResCount: fireResTicks.length,
          burnHits: burnCount,
          damageTicks: burnCount,
          unprotectedHits: burnCount,
        },
      },
    ];
  },
  compare(y: Occurrence[], t: Occurrence[]): Note | null {
    if (!y.length && !t.length) return null;

    const infoOf = (xs: Occurrence[]) => {
      const o = xs[0];
      if (!o) return { hasFireRes: false, fireResAt: null as number | null, burnHits: 0 };
      const hasFireRes = Boolean(
        o.meta?.hasFireRes ?? (typeof o.meta?.fireResAt === "number" || (Number(o.meta?.fireResCount ?? 0) > 0)),
      );
      const fireResAt = typeof o.meta?.fireResAt === "number" ? o.meta.fireResAt : (hasFireRes ? o.t0 : null);
      const burnHits =
        typeof o.meta?.burnHits === "number"
          ? o.meta.burnHits
          : typeof o.meta?.damageTicks === "number"
            ? o.meta.damageTicks
            : hasFireRes
              ? 0
              : (o.value ?? 0);
      return { hasFireRes, fireResAt, burnHits };
    };

    const yi = infoOf(y);
    const ti = infoOf(t);

    if (yi.hasFireRes && ti.hasFireRes && yi.burnHits === 0 && ti.burnHits === 0) return null;

    const fmtSide = (info: { hasFireRes: boolean; fireResAt: number | null; burnHits: number }) => {
      if (info.hasFireRes) {
        const when = info.fireResAt !== null ? fmtTime(info.fireResAt) : "active";
        return info.burnHits > 0
          ? `${when} (${info.burnHits} lava/fire damage tick${info.burnHits === 1 ? "" : "s"} without fire res)`
          : `${when} (0 lava/fire damage)`;
      }
      return info.burnHits > 0
        ? `none (${info.burnHits} lava/fire damage tick${info.burnHits === 1 ? "" : "s"})`
        : "none";
    };

    return {
      text: `Fire resistance: ${fmtSide(yi)} vs ${fmtSide(ti)}`,
      seconds: null,
      at: { you: y[0]?.t0, them: t[0]?.t0 },
    };
  },
};
