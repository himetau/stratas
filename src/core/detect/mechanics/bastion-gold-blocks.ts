import type { Note, Side } from "../findings";
import { fmtTime } from "../names";
import type { Mechanic, Occurrence } from "./index";

interface GoldGain {
  t0: number;
  t1: number;
  count: number;
}

/** Gold block increases seen in the player's own inventory slots */
function inventoryGoldGains(s: Side, from: number, to: number): GoldGain[] {
  const ticks = new Set<number>();
  for (const e of s.run.events) {
    if (e.type === "INVENTORY_SLOT" && (e.slot ?? 99) <= 40 && e.t >= from && e.t <= to) {
      ticks.add(e.t);
    }
  }
  const gains: GoldGain[] = [];
  let prev = s.run.invAt(from - 1).get("gold_block") ?? 0;
  for (const t of [...ticks].sort((x, y) => x - y)) {
    const cur = s.run.invAt(t).get("gold_block") ?? 0;
    if (cur > prev) {
      gains.push({ t0: t, t1: t, count: cur - prev });
    }
    prev = cur;
  }
  return gains;
}

/** Gold blocks picked up or taken from chests */
function actionGoldGains(s: Side, from: number, to: number): GoldGain[] {
  const gains: GoldGain[] = [];
  for (const a of s.run.actions) {
    if (a.t0 < from || a.t0 > to) {
      continue;
    }
    if (a.kind === "pickup" && a.item === "gold_block" && (a.count ?? 1) > 0) {
      gains.push({ t0: a.t0, t1: a.t1, count: a.count ?? 1 });
    } else if (a.kind === "chest" && (a.delta?.gold_block ?? 0) > 0) {
      gains.push({ t0: a.t0, t1: a.t1, count: a.delta!.gold_block });
    }
  }
  return gains;
}

export const bastionGoldBlocksMechanic: Mechanic = {
  key: "bastion_gold_blocks",
  phase: ["Bastion"],
  detect(s: Side, span?: [number, number]): Occurrence[] {
    const b = span?.[0] ?? s.run.mark("bastion");
    const l = span?.[1] ?? s.run.mark("bastion_left");
    if (b === undefined || l === undefined) {
      return [];
    }

    const mines = s.run.actions.filter(
      (a) => a.kind === "mine" && a.item === "gold_block" && a.t1 >= b && a.t0 <= l,
    );
    const inventoryGains = inventoryGoldGains(s, b, l);
    const invGains = inventoryGains.length ? inventoryGains : actionGoldGains(s, b, l);

    const minedCount = mines.length;
    const invCount = invGains.reduce((sum, g) => sum + g.count, 0);
    const total = Math.max(minedCount, invCount);
    if (total === 0) {
      return [];
    }

    if (minedCount > 0) {
      return mines.map((m, i) => ({
        t0: m.t0,
        t1: m.t1,
        value: i === 0 ? total - (minedCount - 1) : 1,
        text: `${fmtTime(m.t0)} mined gold block (${i + 1}/${total})`,
        meta: { index: i + 1, total, mined: minedCount, acquired: total },
      }));
    }

    return invGains.map((g, i) => ({
      t0: g.t0,
      t1: g.t1,
      value: g.count,
      text: `${fmtTime(g.t0)} acquired ${g.count} gold block${g.count === 1 ? "" : "s"}`,
      meta: { index: i + 1, total, mined: 0, acquired: total },
    }));
  },
  compare(y: Occurrence[], t: Occurrence[]): Note | null {
    const countOf = (xs: Occurrence[]): number => {
      if (!xs.length) {
        return 0;
      }
      if (typeof xs[0].meta?.total === "number") {
        return xs[0].meta.total;
      }
      return xs.reduce((sum, x) => sum + (x.value ?? 1), 0);
    };
    const yCount = countOf(y);
    const tCount = countOf(t);
    if (yCount === tCount) {
      return null;
    }
    const yFirst = y[0] !== undefined ? fmtTime(y[0].t0) : "—";
    const tFirst = t[0] !== undefined ? fmtTime(t[0].t0) : "—";
    return {
      text: `Gold blocks: ${yCount} vs ${tCount} (first at ${yFirst} vs ${tFirst})`,
      seconds: null,
      at: { you: y[0]?.t0, them: t[0]?.t0 },
    };
  },
};
