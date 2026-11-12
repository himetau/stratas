import type { Run, TrackPoint } from "./run";

const MAX_DISTANCE_COST = 40;
const OTHER_DIMENSION_COST = 200;
/** Only path points this close go into the gap curve */
const MATCH_BLOCKS = 8;

const MOVE_DIAGONAL = 0;
const MOVE_UP = 1;
const MOVE_LEFT = 2;

/** [your second, gap in seconds], they were where you are `gap` seconds earlier */
export type GapPoint = [number, number];

function samplesPerSecond(r: Run): TrackPoint[] {
  const out: TrackPoint[] = [];
  for (let t = 0; t <= r.end; t += 20) {
    out.push(r.posAt(t));
  }
  return out;
}

function cost(a: TrackPoint, b: TrackPoint) {
  if (a.w !== b.w) {
    return OTHER_DIMENSION_COST;
  }
  return Math.min(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), MAX_DISTANCE_COST);
}

/** Lines up two runs on the same seed with DTW over their positions at 1 Hz */
export function alignRuns(
  you: Run,
  them: Run,
): { points: GapPoint[]; matched: number; total: number } {
  const A = samplesPerSecond(you);
  const B = samplesPerSecond(them);
  const n = A.length;
  const m = B.length;
  const W = m + 1;
  const D = new Float64Array((n + 1) * W).fill(Infinity);
  const P = new Uint8Array((n + 1) * W);
  D[0] = 0;
  for (let i = 1; i <= n; i++) {
    const a = A[i - 1];
    for (let j = 1; j <= m; j++) {
      const diag = D[(i - 1) * W + j - 1];
      const up = D[(i - 1) * W + j];
      const left = D[i * W + j - 1];
      let best = diag;
      let move = MOVE_DIAGONAL;
      if (up < best) {
        best = up;
        move = MOVE_UP;
      }
      if (left < best) {
        best = left;
        move = MOVE_LEFT;
      }
      D[i * W + j] = best + cost(a, B[j - 1]);
      P[i * W + j] = move;
    }
  }

  // The path ends on the last sample of either run, because an unfinished run can cover only part of the other.
  let bi = n;
  let bj = m;
  let bestScore = Infinity;
  for (let j = 1; j <= m; j++) {
    const s = D[n * W + j] / (n + j);
    if (s < bestScore) {
      bestScore = s;
      bi = n;
      bj = j;
    }
  }
  for (let i = 1; i <= n; i++) {
    const s = D[i * W + m] / (i + m);
    if (s < bestScore) {
      bestScore = s;
      bi = i;
      bj = m;
    }
  }

  const path: [number, number][] = [];
  let i = bi;
  let j = bj;
  while (i > 0 && j > 0) {
    path.push([i - 1, j - 1]);
    const move = P[i * W + j];
    if (move === MOVE_DIAGONAL) {
      i--;
      j--;
    } else if (move === MOVE_UP) {
      i--;
    } else {
      j--;
    }
  }
  path.reverse();

  const first = new Map<number, number>();
  for (const [a, b] of path) {
    if (!first.has(a) && cost(A[a], B[b]) < MATCH_BLOCKS) {
      first.set(a, b);
    }
  }
  const points: GapPoint[] = [...first].sort((x, y) => x[0] - y[0]).map(([a, b]) => [a, a - b]);
  if (!points.length || points[0][0] !== 0) {
    points.unshift([0, 0]);
  }
  return { points, matched: first.size, total: n };
}
