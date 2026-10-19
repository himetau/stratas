// Cuts the gap curve into stretches where you lost or gained time
import type { GapPoint } from "./align";

export interface GapWindow { from: GapPoint; to: GapPoint; jump: boolean }

const TURN = 3;       // A reversal this big (s) ends a stretch
const MIN_CHANGE = 6; // Stretches smaller than this (s) aren't worth a finding
const MAX_STEP = 20;  // Seconds with no confident match = a jump (death, other route)

export function findWindows(pts: GapPoint[]): GapWindow[] {
  const out: GapWindow[] = [];
  if (pts.length < 2) return out;
  const close = (a: GapPoint, b: GapPoint, jump = false) => {
    if (Math.abs(b[1] - a[1]) >= MIN_CHANGE && b[0] > a[0]) out.push({ from: a, to: b, jump });
  };
  let start = pts[0], ext = pts[0], dir = 0;
  for (let k = 1; k < pts.length; k++) {
    const prev = pts[k - 1], p = pts[k];
    if (p[0] - prev[0] > MAX_STEP) {
      close(start, prev);
      close(prev, p, true);
      start = ext = p; dir = 0;
      continue;
    }
    const d = p[1] - ext[1];
    if (dir === 0) {
      if (Math.abs(p[1] - start[1]) >= TURN) { dir = Math.sign(p[1] - start[1]); ext = p; }
    } else if (dir * d > 0) {
      ext = p;
    } else if (dir * d <= -TURN) {
      close(start, ext);
      start = ext; ext = p; dir = Math.sign(p[1] - start[1]);
    }
  }
  close(start, dir === 0 ? pts.at(-1)! : ext);
  if (dir !== 0 && ext !== pts.at(-1)) close(ext, pts.at(-1)!);
  return out;
}
