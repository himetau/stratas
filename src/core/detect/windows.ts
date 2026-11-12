import type { GapPoint } from "./align";

export interface GapWindow {
  from: GapPoint;
  to: GapPoint;
  jump: boolean;
}

/** A gap reversal of this many seconds ends a stretch. */
const TURN = 3;
/** A stretch whose gap changes less than this many seconds is not worth a finding. */
const MIN_CHANGE = 6;
/** Seconds with no confident match count as a jump, like a death or another route. */
const MAX_STEP = 20;

/** Cuts the gap curve into stretches where you lost or gained time. */
export function findWindows(pts: GapPoint[]): GapWindow[] {
  const out: GapWindow[] = [];
  if (pts.length < 2) {
    return out;
  }
  const addWindow = (a: GapPoint, b: GapPoint, jump = false) => {
    if (Math.abs(b[1] - a[1]) >= MIN_CHANGE && b[0] > a[0]) {
      out.push({ from: a, to: b, jump });
    }
  };
  let start = pts[0];
  let extreme = pts[0];
  let dir = 0;
  for (let k = 1; k < pts.length; k++) {
    const prev = pts[k - 1];
    const p = pts[k];
    if (p[0] - prev[0] > MAX_STEP) {
      addWindow(start, prev);
      addWindow(prev, p, true);
      start = p;
      extreme = p;
      dir = 0;
      continue;
    }
    const d = p[1] - extreme[1];
    if (dir === 0) {
      if (Math.abs(p[1] - start[1]) >= TURN) {
        dir = Math.sign(p[1] - start[1]);
        extreme = p;
      }
    } else if (dir * d > 0) {
      extreme = p;
    } else if (dir * d <= -TURN) {
      addWindow(start, extreme);
      start = extreme;
      extreme = p;
      dir = Math.sign(p[1] - start[1]);
    }
  }
  const last = pts.at(-1)!;
  addWindow(start, dir === 0 ? last : extreme);
  if (dir !== 0 && extreme !== last) {
    addWindow(extreme, last);
  }
  return out;
}
