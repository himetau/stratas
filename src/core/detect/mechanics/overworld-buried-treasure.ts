import type { Note, Side } from "../findings";
import { fmtTime } from "../names";
import type { Action } from "../run";
import type { Mechanic, Occurrence } from "./index";

const BT_SIGNATURE_ITEMS = ["heart_of_the_sea", "cooked_cod", "cooked_salmon", "tnt"] as const;
const BT_INGOT_ITEMS = ["iron_ingot", "gold_ingot"] as const;
const DIG_BLOCK_RE = /sand|gravel|flint|stone|cobble|dirt|andesite|diorite|granite/i;

function isBuriedTreasureChest(a: Action): boolean {
  if (a.kind !== "chest" || a.w !== 0 || !a.delta) return false;
  const d = a.delta;
  const hasSig = BT_SIGNATURE_ITEMS.some((k) => (d[k] ?? 0) > 0);
  const hasIngot = BT_INGOT_ITEMS.some((k) => (d[k] ?? 0) > 0);
  return hasSig && hasIngot;
}

function isDigBlock(a: Action): boolean {
  const item = a.item ?? a.what;
  return !item || DIG_BLOCK_RE.test(item);
}

function posOf(s: Side, a: Action): readonly [number, number, number] {
  if (a.at) return a.at;
  const p = s.run.posAt(a.t0);
  return [p.x, p.y, p.z];
}

export const overworldBuriedTreasureMechanic: Mechanic = {
  key: "overworld_buried_treasure",
  phase: ["Overworld"],
  detect(s: Side, span?: [number, number]): Occurrence[] {
    const nether = s.run.mark("nether");
    const from = span ? span[0] : 0;
    const to = span ? span[1] : (nether ?? s.run.end);

    const chest = s.run.actions.find(
      (a) => a.t0 >= from && a.t0 <= to && isBuriedTreasureChest(a),
    );
    if (!chest) return [];

    const chestPos = posOf(s, chest);
    const digs = s.run.actions.filter((a) => {
      if (a.kind !== "mine" || a.w !== 0) return false;
      if (a.t0 < from || a.t0 > chest.t0) return false;
      if (!isDigBlock(a)) return false;
      const mp = posOf(s, a);
      return Math.hypot(mp[0] - chestPos[0], mp[1] - chestPos[1], mp[2] - chestPos[2]) <= 12;
    });

    const t0 = digs[0]?.t0 ?? chest.t0;
    const t1 = chest.t1;
    const count = digs.length;

    return [
      {
        t0,
        t1,
        value: count,
        text: `Buried treasure opened at ${fmtTime(chest.t0)} (${count} blocks dug)`,
        meta: { digs: count, chestOpen: chest.t0 },
      },
    ];
  },
  compare(y: Occurrence[], t: Occurrence[]): Note | null {
    if (!y.length || !t.length) return null;
    const yo = y[0];
    const to = t[0];
    const yDigs = yo.value ?? Number(yo.meta?.digs ?? 0);
    const tDigs = to.value ?? Number(to.meta?.digs ?? 0);
    return {
      text: `Buried treasure opened at ${fmtTime(yo.t0)} vs ${fmtTime(to.t0)} (${yDigs} vs ${tDigs} blocks dug)`,
      seconds: null,
      at: { you: yo.t0, them: to.t0 },
    };
  },
};
