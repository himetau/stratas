// Mechanic registry. Each mechanic is its own file here and gets added to MECHANICS
import type { Note, Side, Span } from "../findings";
import { overworldLavaPortalMechanic } from "./overworld-lava-portal";
import { overworldRuinedPortalMechanic } from "./overworld-ruined-portal";
import { overworldBuriedTreasureMechanic } from "./overworld-buried-treasure";
import { overworldShipwreckMechanic } from "./overworld-shipwreck";
import { overworldVillageMechanic } from "./overworld-village";
import { overworldDesertTempleMechanic } from "./overworld-desert-temple";
import { overworldIronPickaxeMechanic } from "./overworld-tools";
import { netherBridgingMechanic } from "./nether-travel-bridging";
import { bastionGoldBlocksMechanic } from "./bastion-gold-blocks";
import { bastionCraftOverlapMechanic } from "./bastion-craft-overlap";
import { pearlHangsMechanic } from "./pearl-hangs";
import { fortressBlazesMechanic } from "./fortress-blazes";
import { strongholdNavigationMechanic } from "./stronghold-navigation";
import { pieChartMechanic, fireResMechanic } from "./cross-phase-checks";

export interface Occurrence {
  t0: number;
  t1: number;
  /** Main measured value (ticks, count, distance, damage) */
  value?: number;
  /** One line fact with timestamp */
  text?: string;
  /** Extra fields for comparing */
  meta?: Record<string, number | string | boolean | null>;
}

export interface Mechanic {
  key: string;
  phase: string[];
  detect(s: Side, span?: [number, number]): Occurrence[];
  compare?(y: Occurrence[], t: Occurrence[], Y?: Side, T?: Side, ys?: Span, ts?: Span): Note | null;
}

export const MECHANICS: Mechanic[] = [
  overworldLavaPortalMechanic,
  overworldRuinedPortalMechanic,
  overworldBuriedTreasureMechanic,
  overworldShipwreckMechanic,
  overworldVillageMechanic,
  overworldDesertTempleMechanic,
  overworldIronPickaxeMechanic,
  netherBridgingMechanic,
  bastionGoldBlocksMechanic,
  bastionCraftOverlapMechanic,
  pearlHangsMechanic,
  fortressBlazesMechanic,
  strongholdNavigationMechanic,
  pieChartMechanic,
  fireResMechanic,
];

/** Runs all mechanics for a phase and returns notes */
export function runMechanicNotes(phase: string, Y: Side, T: Side, ys: Span, ts: Span): Note[] {
  const out: Note[] = [];
  for (const m of MECHANICS) {
    if (!m.phase.includes(phase) && !m.phase.includes("*")) continue;
    if (!m.compare) continue;
    const yo = m.detect(Y, ys);
    const to = ts ? m.detect(T, ts) : [];
    if (!yo.length && !to.length) continue;
    const res = m.compare(yo, to, Y, T, ys, ts);
    if (res) out.push(res);
  }
  return out;
}

