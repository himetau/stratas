// Race split into the race page phases, start and end for both of you and how the gap moved
// Pure so patterns can use it too, not just the graph
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

function shortSplitName(name: string): string {
  if (name === "Entered the Nether") return "Nether";
  if (name === "Entered Bastion") return "Bastion";
  if (name === "Left the Bastion") return "Left bastion";
  if (name === "Entered Fortress") return "Fortress";
  if (/Blaze Rods/i.test(name)) return "6 rods";
  if (name === "Blind Travelled") return "Blind";
  if (name === "Eye Spy") return "Stronghold";
  if (name === "Entered the End") return "End";
  if (name === "Defeated the Dragon") return "Finish";
  return name;
}

function segmentNaming(prevSplit: string, curSplit: string): { label: string; short: string; fallbackPhase: string } {
  if (curSplit === "Entered the Nether") return { label: "Overworld", short: "Overworld", fallbackPhase: "Overworld" };
  if (curSplit === "Entered Bastion") {
    return prevSplit === "Entered Fortress" || /Blaze Rods/i.test(prevSplit)
      ? { label: "Fortress to bastion", short: "To bastion", fallbackPhase: "Fortress" }
      : { label: "Nether travel", short: "Nether", fallbackPhase: "Nether travel" };
  }
  if (curSplit === "Left the Bastion") return { label: "Bastion", short: "Bastion", fallbackPhase: "Bastion" };
  if (curSplit === "Entered Fortress") {
    return prevSplit === "Left the Bastion"
      ? { label: "Bastion to fortress", short: "To fort", fallbackPhase: "Bastion to fortress" }
      : { label: "To fortress", short: "To fort", fallbackPhase: "Nether travel" };
  }
  // Fortress then blind, whichever of 6 rods or blind travel comes first
  if (/Blaze Rods/i.test(curSplit)) {
    return prevSplit === "Blind Travelled"
      ? { label: "Blind to 6 rods", short: "Blind", fallbackPhase: "Fortress to stronghold" }
      : { label: "Fortress (rods)", short: "Fortress", fallbackPhase: "Fortress to stronghold" };
  }
  if (curSplit === "Blind Travelled") {
    return prevSplit === "Entered Fortress"
      ? { label: "Fortress to blind", short: "Fortress", fallbackPhase: "Fortress to stronghold" }
      : prevSplit === "Left the Bastion"
        ? { label: "Bastion to blind", short: "Blind", fallbackPhase: "Bastion to blind" }
        : { label: "Out of the fortress", short: "Blind", fallbackPhase: "Fortress to stronghold" };
  }
  if (curSplit === "Eye Spy") return { label: "Blind to stronghold", short: "To stronghold", fallbackPhase: "Fortress to stronghold" };
  if (curSplit === "Entered the End") return { label: "Stronghold", short: "Stronghold", fallbackPhase: "Stronghold" };
  // "Finish" is the end of your run when they didn't kill the dragon, same stretch
  if (curSplit === "Defeated the Dragon" || curSplit === "Finish") return { label: "The End", short: "End", fallbackPhase: "End" };
  return { label: curSplit, short: curSplit, fallbackPhase: "End" };
}

function resolveReportPhase(a: RaceAnalysis, you0: number, you1: number, fallback: string): string | null {
  const reports = a.report ?? [];
  if (!reports.length) return null;
  const t0 = you0 * 20;
  const t1 = you1 * 20;
  let bestPhase: string | null = null;
  let bestOverlap = 0;
  for (const r of reports) {
    const steps = r.steps?.you ?? [];
    if (!steps.length) continue;
    const r0 = steps[0].t0;
    const r1 = steps.at(-1)!.t1;
    const overlap = Math.max(0, Math.min(t1, r1) - Math.max(t0, r0));
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestPhase = r.phase;
    }
  }
  if (bestPhase) return bestPhase;
  const exact = reports.find((r) => r.phase.toLowerCase() === fallback.toLowerCase());
  return exact ? exact.phase : reports[0]?.phase ?? null;
}

export function buildDeltaModel(a: RaceAnalysis): {
  segments: DeltaSegment[];
  curve: [number, number][];
  events: DeltaEventMarker[];
  xMax: number;
} {
  const anchors: { splitName: string; youSec: number; themSec: number; gapSec: number }[] = [
    { splitName: "Start", youSec: 0, themSec: 0, gapSec: 0 },
  ];

  for (const sp of a.splits ?? []) {
    if (sp.you !== null && sp.them !== null) {
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
  }

  const hasFinishSplit = anchors.some((x) => x.splitName === "Defeated the Dragon");
  const rawLastX = a.curve.at(-1)?.[0] ?? 0;
  const runEndSec = Math.max(a.you?.endTicks ? a.you.endTicks / 20 : 0, rawLastX, anchors.at(-1)!.youSec);
  if (!hasFinishSplit && runEndSec > anchors.at(-1)!.youSec + 2) {
    const endGap = Number.isFinite(a.finalGap) ? a.finalGap : (a.curve.at(-1)?.[1] ?? anchors.at(-1)!.gapSec);
    anchors.push({
      splitName: a.you?.finished ? "Finish" : "Run end",
      youSec: runEndSec,
      themSec: Math.max(anchors.at(-1)!.themSec, runEndSec - endGap),
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

  const segments: DeltaSegment[] = [];
  for (let i = 1; i < anchors.length; i++) {
    const p = anchors[i - 1];
    const q = anchors[i];
    const naming = segmentNaming(p.splitName, q.splitName);
    const reportPhase = resolveReportPhase(a, p.youSec, q.youSec, naming.fallbackPhase);
    segments.push({
      idx: i - 1,
      splitName: q.splitName,
      splitShort: shortSplitName(q.splitName),
      segLabel: naming.label,
      segShort: naming.short,
      reportPhase,
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

  // Gap curve anchored to splits, stays inside each segment's you and them bounds
  const curve: [number, number][] = [[0, 0]];
  for (const seg of segments) {
    const rawInSeg = (a.curve ?? []).filter(([y, g]) => {
      if (y <= seg.you0 + 1 || y >= seg.you1 - 1) return false;
      const t = y - g;
      return t >= seg.them0 - 1 && t <= seg.them1 + 1;
    });

    let lastY = seg.you0;
    let lastT = seg.them0;
    let lastG = seg.gap0;

    for (const [y, g] of rawInSeg) {
      const dtY = y - lastY;
      if (dtY < 1) continue;
      const t = y - g;
      // Their time has to go forward and stay in the segment
      if (t < lastT - 0.5 || t > seg.them1 + 0.5) continue;
      // Limit impossible 1 s DTW jumps in the same structure
      const maxSwing = dtY * 1.35 + 3;
      const clampedG = Math.max(lastG - maxSwing, Math.min(lastG + maxSwing, g));
      // Blend toward the segment end gap near seg.you1
      const progress = (y - seg.you0) / Math.max(1, seg.you1 - seg.you0);
      const linearG = seg.gap0 + progress * seg.segDelta;
      const blendedG = progress > 0.78 ? clampedG * (1 - (progress - 0.78) / 0.22) + linearG * ((progress - 0.78) / 0.22) : clampedG;
      curve.push([y, blendedG]);
      lastY = y;
      lastT = Math.max(lastT, y - blendedG);
      lastG = blendedG;
    }

    curve.push([seg.you1, seg.gap1]);
  }

  const gapAt = (youSec: number): number => {
    if (youSec <= 0) return 0;
    const last = curve.at(-1)!;
    if (youSec >= last[0]) return last[1];
    let lo = 0;
    let hi = curve.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (curve[mid][0] <= youSec) lo = mid;
      else hi = mid;
    }
    const [x0, y0] = curve[lo];
    const [x1, y1] = curve[hi];
    if (x1 <= x0) return y0;
    return y0 + ((youSec - x0) / (x1 - x0)) * (y1 - y0);
  };

  const events: DeltaEventMarker[] = [];
  for (const r of a.report ?? []) {
    for (const st of r.steps?.you ?? []) {
      if (st.kind === "death") {
        const ySec = st.t0 / 20;
        events.push({
          youSec: ySec,
          gapSec: gapAt(ySec),
          kind: "death",
          label: st.text,
          phase: r.phase,
        });
      }
    }
  }

  const xMax = Math.max(curve.at(-1)?.[0] ?? 60, 30);
  return { segments, curve, events, xMax };
}

