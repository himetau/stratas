import type { Note, Side } from "../findings";
import { fmtDur, fmtTime } from "../names";
import type { Mechanic, Occurrence } from "./index";

const dur = (t: number) => fmtDur(t / 20);

export const strongholdNavigationMechanic: Mechanic = {
  key: "stronghold_nav",
  phase: ["Stronghold", "Fortress to stronghold"],
  detect(s: Side, span?: [number, number]): Occurrence[] {
    const eye = s.run.mark("eye");
    const end = s.run.mark("end");
    if (eye === undefined || end === undefined || end <= eye) return [];
    if (span && (eye < span[0] || eye > span[1])) return [];
    const duration = end - eye;
    const distance = Math.round(s.run.path(eye, end));
    const firstEye =
      s.facts.eyes.find((e) => (span ? e.t0 >= span[0] : true) && e.t0 <= eye)?.t0 ??
      s.facts.eyes.find((e) => e.t0 <= eye)?.t0 ??
      null;
    const toEye = firstEye !== null ? eye - firstEye : null;
    return [
      {
        t0: eye,
        t1: end,
        value: duration,
        text: `${fmtTime(eye)} in the stronghold: ${dur(duration)} (${distance} blocks)${toEye !== null ? ` · first eye to stronghold ${dur(toEye)}` : ""}`,
        meta: {
          eye,
          end,
          duration,
          distance,
          firstEye,
          toEye,
        },
      },
    ];
  },
  compare(y: Occurrence[], t: Occurrence[]): Note | null {
    if (!y.length || !t.length) return null;
    const yo = y[0];
    const to = t[0];
    const yTicks = yo.value ?? yo.t1 - yo.t0;
    const tTicks = to.value ?? to.t1 - to.t0;
    const yDist = Math.round(Number(yo.meta?.distance ?? 0));
    const tDist = Math.round(Number(to.meta?.distance ?? 0));
    if (Math.abs(yTicks - tTicks) < 80 && Math.abs(yDist - tDist) < 20) return null;
    return {
      text: `In the stronghold: ${dur(yTicks)} (${yDist} blocks) vs ${dur(tTicks)} (${tDist} blocks)`,
      seconds: null,
      at: { you: yo.t0, them: to.t0 },
    };
  },
};
