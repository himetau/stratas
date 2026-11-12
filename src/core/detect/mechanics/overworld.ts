import type { Side } from "../findings";
import type { Action } from "../run";

export interface OverworldWindow {
  from: number;
  to: number;
  contains(t: number, w?: number): boolean;
}

/** Ticks of the span, or the whole run, that come before entering the Nether */
export function overworldWindow(s: Side, span?: [number, number]): OverworldWindow {
  const nether = s.run.mark("nether");
  const from = span ? span[0] : 0;
  let to: number;
  if (span) {
    to = nether === undefined ? span[1] : Math.min(span[1], nether);
  } else {
    to = nether ?? s.run.end;
  }
  return {
    from,
    to,
    contains: (t, w) => t >= from && t <= to && (w === undefined || w === 0),
  };
}

export function actionPos(s: Side, a: Action): readonly [number, number, number] {
  if (a.at) {
    return a.at;
  }
  const p = s.run.posAt(a.t0);
  return [p.x, p.y, p.z];
}

export const isBed = (item?: string) => Boolean(item && (item === "bed" || item.endsWith("_bed")));

export const sumCounts = (actions: Action[]) => actions.reduce((sum, a) => sum + (a.count ?? 1), 0);
