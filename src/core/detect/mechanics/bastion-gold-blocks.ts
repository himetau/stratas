import type { Note, Side } from "../findings";
import { fmtTime } from "../names";
import type { Mechanic, Occurrence } from "./index";

export const bastionGoldBlocksMechanic: Mechanic = {
  key: "bastion_gold_blocks",
  phase: ["Bastion"],
  detect(s: Side, span?: [number, number]): Occurrence[] {
    const b = span?.[0] ?? s.run.mark("bastion");
    const l = span?.[1] ?? s.run.mark("bastion_left");
    if (b === undefined || l === undefined) return [];

    const mines = s.run.actions.filter(
      (a) => a.kind === "mine" && a.item === "gold_block" && a.t1 >= b && a.t0 <= l,
    );

    const invGains: { t0: number; t1: number; count: number }[] = [];
    const invTicks = [
      ...new Set(
        s.run.events
          .filter((e) => e.type === "INVENTORY_SLOT" && (e.slot ?? 99) <= 40 && e.t >= b && e.t <= l)
          .map((e) => e.t),
      ),
    ].sort((x, y) => x - y);

    let prev = s.run.invAt(b - 1).get("gold_block") ?? 0;
    for (const t of invTicks) {
      const cur = s.run.invAt(t).get("gold_block") ?? 0;
      if (cur > prev) invGains.push({ t0: t, t1: t, count: cur - prev });
      prev = cur;
    }

    if (invGains.length === 0) {
      for (const a of s.run.actions) {
        if (a.t0 < b || a.t0 > l) continue;
        if (a.kind === "pickup" && a.item === "gold_block" && (a.count ?? 1) > 0) {
          invGains.push({ t0: a.t0, t1: a.t1, count: a.count ?? 1 });
        } else if (a.kind === "chest" && (a.delta?.gold_block ?? 0) > 0) {
          invGains.push({ t0: a.t0, t1: a.t1, count: a.delta!.gold_block });
        }
      }
    }

    const minedCount = mines.length;
    const invCount = invGains.reduce((sum, g) => sum + g.count, 0);
    const total = Math.max(minedCount, invCount);
    if (total === 0) return [];

    if (mines.length > 0) {
      return mines.map((m, i) => ({
        t0: m.t0,
        t1: m.t1,
        value: i === 0 ? total - (mines.length - 1) : 1,
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
      if (!xs.length) return 0;
      if (typeof xs[0].meta?.total === "number") return xs[0].meta.total;
      return xs.reduce((sum, x) => sum + (x.value ?? 1), 0);
    };
    const yCount = countOf(y);
    const tCount = countOf(t);
    if (yCount === tCount) return null;
    const yFirst = y[0] !== undefined ? fmtTime(y[0].t0) : "—";
    const tFirst = t[0] !== undefined ? fmtTime(t[0].t0) : "—";
    return {
      text: `Gold blocks mined: ${yCount} vs ${tCount} (first at ${yFirst} vs ${tFirst})`,
      seconds: null,
      at: { you: y[0]?.t0, them: t[0]?.t0 },
    };
  },
};
