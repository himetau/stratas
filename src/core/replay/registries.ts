// Vanilla 1.16.1 registry ids -> names, from the MC data generator (net.minecraft.data.Main --reports)
// Compacted into data/registries-1.16.1.json
import data from "../../../data/registries-1.16.1.json";

const runs = data.blockStateRuns as [number, string | null][];
const runStarts = runs.map((r) => r[0]);

export const WORLDS = ["overworld", "nether", "end"] as const;
export type WorldName = (typeof WORLDS)[number];

export const itemName = (id: number): string => data.items[id] ?? `item#${id}`;
export const entityName = (id: number): string => data.entities[id] ?? `entity#${id}`;
/** Replay effect ids are vanilla raw ids, which start at 1 (speed) */
export const effectName = (id: number): string => data.effects[id - 1] ?? `effect#${id}`;
export const menuName = (id: number): string => data.menus[id] ?? `menu#${id}`;

const BLOCK_NAMES = new Set(runs.map((r) => r[1]).filter(Boolean) as string[]);
export const isBlock = (name: string) => BLOCK_NAMES.has(name);

/** Block state id -> block name, states of one block are contiguous */
export function blockName(stateId: number): string {
  let lo = 0, hi = runStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (runStarts[mid] <= stateId) lo = mid; else hi = mid - 1;
  }
  return runs[lo]?.[1] ?? `block#${stateId}`;
}
