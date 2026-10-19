import { pearlHangs } from "../bastion";
import type { Note, Side } from "../findings";
import { fmtDur, fmtTime } from "../names";
import type { Mechanic, Occurrence } from "./index";

const dur = (t: number) => fmtDur(t / 20);

export const pearlHangsMechanic: Mechanic = {
  key: "pearl_hangs",
  phase: ["Bastion", "Nether travel", "Bastion to fortress", "Fortress to stronghold"],
  detect(s: Side, span?: [number, number]): Occurrence[] {
    return pearlHangs(s.run)
      .filter((h) => !span || (h.thrown >= span[0] && h.thrown <= span[1]) || (h.landed >= span[0] && h.landed <= span[1]))
      .map((h) => ({
        t0: h.thrown,
        t1: h.landed,
        value: h.landed - h.thrown,
        text: `Pearl hang: thrown ${fmtTime(h.thrown)}, landed ${fmtTime(h.landed)} (${dur(h.landed - h.thrown)})`,
        meta: { thrown: h.thrown, landed: h.landed },
      }));
  },
  compare(y: Occurrence[], t: Occurrence[]): Note | null {
    if (!y[0] && !t[0]) return null;
    const one = (h: Occurrence | undefined) => (h ? `${dur(h.t1 - h.t0)} at ${fmtTime(h.t0)}` : "none");
    return {
      text: `Pearl hang: you ${one(y[0])}, them ${one(t[0])}`,
      seconds: null,
      at: { you: y[0]?.t0, them: t[0]?.t0 },
    };
  },
};
