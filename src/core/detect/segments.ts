import type { RaceAnalysis } from "./analyze";

export interface DeltaSegment {
  idx: number;
  splitName: string;
  splitShort: string;
  segLabel: string;
  segShort: string;
  reportPhase: string | null;
  you0: number;
  you1: number;
  them0: number;
  them1: number;
  youDur: number;
  themDur: number;
  gap0: number;
  gap1: number;
  segDelta: number;
}

export interface DeltaEventMarker {
  youSec: number;
  gapSec: number;
  kind: "death" | "loss";
  label: string;
  phase: string | null;
}

const isRodsSplit = (name: string) => /Blaze Rods/i.test(name);

const SHORT_SPLIT_NAME = new Map([
  ["Entered the Nether", "Nether"],
  ["Entered Bastion", "Bastion"],
  ["Left the Bastion", "Left bastion"],
  ["Entered Fortress", "Fortress"],
  ["Blind Travelled", "Blind"],
  ["Eye Spy", "Stronghold"],
  ["Entered the End", "End"],
  ["Defeated the Dragon", "Finish"],
]);

function shortSplitName(name: string): string {
  if (isRodsSplit(name)) {
    return "6 rods";
  }
  return SHORT_SPLIT_NAME.get(name) ?? name;
}

interface SegmentNaming {
  label: string;
  short: string;
  fallbackPhase: string;
}

function segmentNaming(prevSplit: string, curSplit: string): SegmentNaming {
  if (curSplit === "Entered the Nether") {
    return { label: "Overworld", short: "Overworld", fallbackPhase: "Overworld" };
  }
  if (curSplit === "Entered Bastion") {
    if (prevSplit === "Entered Fortress" || isRodsSplit(prevSplit)) {
      return { label: "Fortress to bastion", short: "To bastion", fallbackPhase: "Fortress" };
    }
    return { label: "Nether travel", short: "Nether", fallbackPhase: "Nether travel" };
  }
  if (curSplit === "Left the Bastion") {
    return { label: "Bastion", short: "Bastion", fallbackPhase: "Bastion" };
  }
  if (curSplit === "Entered Fortress") {
    if (prevSplit === "Left the Bastion") {
      return {
        label: "Bastion to fortress",
        short: "To fort",
        fallbackPhase: "Bastion to fortress",
      };
    }
    // Races from Ranked's splits alone have no "Left the Bastion", so the bastion runs till the fortress.
    if (prevSplit === "Entered Bastion") {
      return { label: "Bastion", short: "Bastion", fallbackPhase: "Bastion" };
    }
    return { label: "To fortress", short: "To fort", fallbackPhase: "Nether travel" };
  }
  // The fortress segment ends at whichever of 6 rods or blind travel comes first.
  if (isRodsSplit(curSplit)) {
    if (prevSplit === "Blind Travelled") {
      return { label: "Blind to 6 rods", short: "Blind", fallbackPhase: "Fortress to stronghold" };
    }
    return { label: "Fortress (rods)", short: "Fortress", fallbackPhase: "Fortress to stronghold" };
  }
  if (curSplit === "Blind Travelled") {
    if (prevSplit === "Entered Fortress") {
      return {
        label: "Fortress to blind",
        short: "Fortress",
        fallbackPhase: "Fortress to stronghold",
      };
    }
    if (prevSplit === "Left the Bastion") {
      return { label: "Bastion to blind", short: "Blind", fallbackPhase: "Bastion to blind" };
    }
    if (prevSplit === "Entered Bastion") {
      return { label: "Bastion", short: "Bastion", fallbackPhase: "Bastion" };
    }
    return {
      label: "Out of the fortress",
      short: "Blind",
      fallbackPhase: "Fortress to stronghold",
    };
  }
  if (curSplit === "Eye Spy") {
    return {
      label: "Blind to stronghold",
      short: "To stronghold",
      fallbackPhase: "Fortress to stronghold",
    };
  }
  if (curSplit === "Entered the End") {
    return { label: "Stronghold", short: "Stronghold", fallbackPhase: "Stronghold" };
  }
  // "Finish" ends your run when they didn't kill the dragon, so it is the same stretch.
  if (curSplit === "Defeated the Dragon" || curSplit === "Finish") {
    return { label: "The End", short: "End", fallbackPhase: "End" };
  }
  return { label: curSplit, short: curSplit, fallbackPhase: "End" };
}

function resolveReportPhase(
  a: RaceAnalysis,
  you0: number,
  you1: number,
  fallback: string,
): string | null {
  const reports = a.report ?? [];
  if (!reports.length) {
    return null;
  }
  const t0 = you0 * 20;
  const t1 = you1 * 20;
  let bestPhase: string | null = null;
  let bestOverlap = 0;
  for (const r of reports) {
    const steps = r.steps?.you ?? [];
    if (!steps.length) {
      continue;
    }
    const r0 = steps[0].t0;
    const r1 = steps.at(-1)!.t1;
    const overlap = Math.max(0, Math.min(t1, r1) - Math.max(t0, r0));
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestPhase = r.phase;
    }
  }
  if (bestPhase) {
    return bestPhase;
  }
  // A segment no report overlaps, like the bit after your last split in a race from Ranked's
  // splits, keeps its own name.
  const exact = reports.find((r) => r.phase.toLowerCase() === fallback.toLowerCase());
  return exact ? exact.phase : null;
}

interface Anchor {
  splitName: string;
  youSec: number;
  themSec: number;
  gapSec: number;
}

/** Split times both of you reached in order, plus the end of your run */
function buildAnchors(a: RaceAnalysis): Anchor[] {
  const anchors: Anchor[] = [{ splitName: "Start", youSec: 0, themSec: 0, gapSec: 0 }];
  for (const sp of a.splits ?? []) {
    if (sp.you === null || sp.them === null) {
      continue;
    }
    const y = sp.you / 20;
    const t = sp.them / 20;
    const prev = anchors.at(-1)!;
    if (y > prev.youSec + 0.2 && t >= prev.themSec - 0.2) {
      anchors.push({
        splitName: sp.name,
        youSec: y,
        themSec: Math.max(prev.themSec, t),
        gapSec: (sp.you - sp.them) / 20,
      });
    }
  }

  const last = anchors.at(-1)!;
  const hasFinishSplit = anchors.some((x) => x.splitName === "Defeated the Dragon");
  const runEndSec = Math.max(
    a.you?.endTicks ? a.you.endTicks / 20 : 0,
    a.curve.at(-1)?.[0] ?? 0,
    last.youSec,
  );
  if (!hasFinishSplit && runEndSec > last.youSec + 2) {
    const endGap = Number.isFinite(a.finalGap) ? a.finalGap : (a.curve.at(-1)?.[1] ?? last.gapSec);
    anchors.push({
      splitName: a.you?.finished ? "Finish" : "Run end",
      youSec: runEndSec,
      themSec: Math.max(last.themSec, runEndSec - endGap),
      gapSec: endGap,
    });
  } else if (anchors.length === 1) {
    const fallbackX = Math.max(60, runEndSec);
    const endGap = Number.isFinite(a.finalGap) ? a.finalGap : 0;
    anchors.push({
      splitName: "Run end",
      youSec: fallbackX,
      themSec: Math.max(0, fallbackX - endGap),
      gapSec: endGap,
    });
  }
  return anchors;
}

function buildSegments(a: RaceAnalysis, anchors: Anchor[]): DeltaSegment[] {
  const segments: DeltaSegment[] = [];
  for (let i = 1; i < anchors.length; i++) {
    const p = anchors[i - 1];
    const q = anchors[i];
    const naming = segmentNaming(p.splitName, q.splitName);
    segments.push({
      idx: i - 1,
      splitName: q.splitName,
      splitShort: shortSplitName(q.splitName),
      segLabel: naming.label,
      segShort: naming.short,
      reportPhase: resolveReportPhase(a, p.youSec, q.youSec, naming.fallbackPhase),
      you0: p.youSec,
      you1: q.youSec,
      them0: p.themSec,
      them1: q.themSec,
      youDur: q.youSec - p.youSec,
      themDur: q.themSec - p.themSec,
      gap0: p.gapSec,
      gap1: q.gapSec,
      segDelta: q.gapSec - p.gapSec,
    });
  }
  return segments;
}

/** Share of a segment after which the curve blends toward the segment's end gap */
const BLEND_FROM = 0.78;
const BLEND_LENGTH = 0.22;

/** Gap curve anchored to splits, staying inside each segment's you and them bounds */
function buildCurve(a: RaceAnalysis, segments: DeltaSegment[]): [number, number][] {
  const curve: [number, number][] = [[0, 0]];
  for (const seg of segments) {
    const rawInSeg = a.curve.filter(([y, g]) => {
      if (y <= seg.you0 + 1 || y >= seg.you1 - 1) {
        return false;
      }
      const t = y - g;
      return t >= seg.them0 - 1 && t <= seg.them1 + 1;
    });

    let lastY = seg.you0;
    let lastT = seg.them0;
    let lastG = seg.gap0;

    for (const [y, g] of rawInSeg) {
      const dtY = y - lastY;
      if (dtY < 1) {
        continue;
      }
      const t = y - g;
      // Their time has to go forward and stay in the segment.
      if (t < lastT - 0.5 || t > seg.them1 + 0.5) {
        continue;
      }
      // DTW can match 1 s jumps that are impossible within one structure.
      const maxSwing = dtY * 1.35 + 3;
      const clampedG = Math.max(lastG - maxSwing, Math.min(lastG + maxSwing, g));
      const progress = (y - seg.you0) / Math.max(1, seg.you1 - seg.you0);
      const linearG = seg.gap0 + progress * seg.segDelta;
      let blendedG = clampedG;
      if (progress > BLEND_FROM) {
        const w = (progress - BLEND_FROM) / BLEND_LENGTH;
        blendedG = clampedG * (1 - w) + linearG * w;
      }
      curve.push([y, blendedG]);
      lastY = y;
      lastT = Math.max(lastT, y - blendedG);
      lastG = blendedG;
    }

    curve.push([seg.you1, seg.gap1]);
  }
  return curve;
}

/** Gap at your time on the curve, linear between points */
function gapAt(curve: [number, number][], youSec: number): number {
  if (youSec <= 0) {
    return 0;
  }
  const last = curve.at(-1)!;
  if (youSec >= last[0]) {
    return last[1];
  }
  let lo = 0;
  let hi = curve.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (curve[mid][0] <= youSec) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const [x0, y0] = curve[lo];
  const [x1, y1] = curve[hi];
  if (x1 <= x0) {
    return y0;
  }
  return y0 + ((youSec - x0) / (x1 - x0)) * (y1 - y0);
}

function deathMarkers(a: RaceAnalysis, curve: [number, number][]): DeltaEventMarker[] {
  const events: DeltaEventMarker[] = [];
  for (const r of a.report ?? []) {
    for (const st of r.steps?.you ?? []) {
      if (st.kind !== "death") {
        continue;
      }
      const youSec = st.t0 / 20;
      events.push({
        youSec,
        gapSec: gapAt(curve, youSec),
        kind: "death",
        label: st.text,
        phase: r.phase,
      });
    }
  }
  return events;
}

/** Race split into the race page segments, with start, end and gap for both of you */
export function buildDeltaModel(a: RaceAnalysis): {
  segments: DeltaSegment[];
  curve: [number, number][];
  events: DeltaEventMarker[];
  xMax: number;
} {
  const segments = buildSegments(a, buildAnchors(a));
  const curve = buildCurve(a, segments);
  const events = deathMarkers(a, curve);
  const xMax = Math.max(curve.at(-1)?.[0] ?? 60, 30);
  return { segments, curve, events, xMax };
}
