// Lines up two runs on the same seed with DTW over positions at 1 Hz. Distance cost is capped so different routes
// don't wreck the rest, other dimension costs extra. Only matches within MATCH_BLOCKS go into the gap curve
import type { Run, TrackPoint } from "./run";

const CAP = 40;
const DIM_PENALTY = 200;
export const MATCH_BLOCKS = 8;

/** [your second, gap in seconds], they were where you are `gap` seconds earlier */
export type GapPoint = [number, number];

function samples(r: Run): TrackPoint[] {
  const out: TrackPoint[] = [];
  for (let t = 0; t <= r.end; t += 20) out.push(r.posAt(t));
  return out;
}

function cost(a: TrackPoint, b: TrackPoint) {
  if (a.w !== b.w) return DIM_PENALTY;
  return Math.min(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), CAP);
}

export function alignRuns(you: Run, them: Run): { points: GapPoint[]; matched: number; total: number } {
  const A = samples(you), B = samples(them);
  const n = A.length, m = B.length;
  const W = m + 1;
  const D = new Float64Array((n + 1) * W).fill(Infinity);
  const P = new Uint8Array((n + 1) * W);
  D[0] = 0;
  for (let i = 1; i <= n; i++) {
    const a = A[i - 1];
    for (let j = 1; j <= m; j++) {
      const diag = D[(i - 1) * W + j - 1], up = D[(i - 1) * W + j], left = D[i * W + j - 1];
      let best = diag, mv = 0;
      if (up < best) { best = up; mv = 1; }
      if (left < best) { best = left; mv = 2; }
      D[i * W + j] = best + cost(a, B[j - 1]);
      P[i * W + j] = mv;
    }
  }
  // Open end, the slower or unfinished run might only cover part of the other
  let bi = n, bj = m, bestScore = Infinity;
  for (let j = 1; j <= m; j++) { const s = D[n * W + j] / (n + j); if (s < bestScore) { bestScore = s; bi = n; bj = j; } }
  for (let i = 1; i <= n; i++) { const s = D[i * W + m] / (i + m); if (s < bestScore) { bestScore = s; bi = i; bj = m; } }
  const path: [number, number][] = [];
  let i = bi, j = bj;
  while (i > 0 && j > 0) {
    path.push([i - 1, j - 1]);
    const mv = P[i * W + j];
    if (mv === 0) { i--; j--; } else if (mv === 1) i--; else j--;
  }
  path.reverse();
  const first = new Map<number, number>();
  for (const [a, b] of path) if (!first.has(a) && cost(A[a], B[b]) < MATCH_BLOCKS) first.set(a, b);
  const points: GapPoint[] = [...first].sort((x, y) => x[0] - y[0]).map(([a, b]) => [a, a - b]);
  if (!points.length || points[0][0] !== 0) points.unshift([0, 0]);
  return { points, matched: first.size, total: n };
}
