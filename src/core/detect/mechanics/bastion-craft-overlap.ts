import { SAMPLE } from "../facts";
import type { Note, Side } from "../findings";
import { fmtTime } from "../names";
import type { Mechanic, Occurrence } from "./index";

const BASTION_CRAFT_ITEM = /^(white_wool|.*_bed|glowstone|respawn_anchor|fire_charge|gold_ingot)$/;

function producedBastionItem(delta?: Record<string, number>): boolean {
  if (!delta) return false;
  return Object.entries(delta).some(([item, count]) => count > 0 && BASTION_CRAFT_ITEM.test(item));
}

export const bastionCraftOverlapMechanic: Mechanic = {
  key: "bastion_craft_overlap",
  phase: ["Bastion"],
  detect(s: Side, span?: [number, number]): Occurrence[] {
    const b = s.run.mark("bastion") ?? span?.[0];
    const l = s.run.mark("bastion_left") ?? span?.[1];
    if (b === undefined || l === undefined || l <= b) return [];

    const crafts = s.run.actions.filter(
      (a) =>
        (a.kind === "craft" || a.kind === "inventory") &&
        a.t1 > b &&
        a.t0 < l &&
        producedBastionItem(a.delta),
    );
    if (!crafts.length) return [];

    const samples =
      typeof s.facts.samples === "function"
        ? s.facts.samples(b, l)
        : (s.facts.pigs ?? []).filter((p) => p.t >= b && p.t < l);

    // Active barter intervals from samples with barter > 0
    const activeRanges: [number, number][] = [];
    let lastActiveEnd = -1;
    for (let i = 0; i < samples.length; i++) {
      const cur = samples[i];
      if (cur.barter <= 0) continue;
      const start = i === 0 && cur.t > b && cur.t - b <= SAMPLE ? b : cur.t;
      let end: number;
      if (i + 1 < samples.length) {
        end = samples[i + 1].t;
      } else {
        const coveringCraft = crafts.filter((c) => c.t0 <= cur.t && c.t1 > cur.t);
        end = coveringCraft.length
          ? Math.max(cur.t + SAMPLE, ...coveringCraft.map((c) => Math.min(l, c.t1)))
          : cur.t + SAMPLE;
      }
      activeRanges.push([start, end]);
      if (end > lastActiveEnd) lastActiveEnd = end;
    }

    let tradeEnd: number;
    if (lastActiveEnd >= 0) {
      tradeEnd = lastActiveEnd;
    } else {
      const barters = s.run.actions.filter((a) => a.kind === "barter" && a.t0 >= b && a.t0 <= l);
      tradeEnd = barters.length ? barters.at(-1)!.t1 : b;
    }

    const isBarteringAt = (t: number): boolean => {
      for (const [r0, r1] of activeRanges) {
        if (t >= r0 && t < r1) return true;
      }
      return false;
    };

    let duringTicks = 0;
    let afterTicks = 0;
    let firstAfterT: number | null = null;
    let lastAfterT: number | null = null;

    const seenTick = new Set<number>();
    for (const c of crafts) {
      const c0 = Math.max(b, c.t0);
      const c1 = Math.min(l, c.t1);
      for (let t = c0; t < c1; t++) {
        if (seenTick.has(t)) continue;
        seenTick.add(t);
        if (isBarteringAt(t)) {
          duringTicks++;
        } else if (t >= tradeEnd) {
          afterTicks++;
          if (firstAfterT === null || t < firstAfterT) firstAfterT = t;
          if (lastAfterT === null || t + 1 > lastAfterT) lastAfterT = t + 1;
        }
      }
    }

    const t0 = firstAfterT ?? Math.max(b, crafts[0].t0);
    const t1 = lastAfterT ?? Math.min(l, crafts.at(-1)!.t1);
    const duringSec = Math.round(duringTicks / 20);
    const afterSec = Math.round(afterTicks / 20);

    return [
      {
        t0,
        t1,
        value: afterTicks,
        text: `${fmtTime(t0)} bastion crafting: ${duringSec} s while trading, ${afterSec} s after trades`,
        meta: {
          duringTicks,
          afterTicks,
          during: duringTicks,
          after: afterTicks,
          barterTicks: duringTicks,
          overlapTicks: duringTicks,
          postTradeTicks: afterTicks,
          totalTicks: duringTicks + afterTicks,
          crafts: crafts.length,
        },
      },
    ];
  },
  compare(y: Occurrence[], t: Occurrence[]): Note | null {
    const afterTicksOf = (xs: Occurrence[]): number =>
      xs.reduce((sum, x) => {
        if (typeof x.meta?.afterTicks === "number") return sum + x.meta.afterTicks;
        if (typeof x.meta?.after === "number") return sum + x.meta.after;
        if (typeof x.meta?.postTradeTicks === "number") return sum + x.meta.postTradeTicks;
        if (typeof x.value === "number") return sum + x.value;
        return sum + Math.max(0, x.t1 - x.t0);
      }, 0);

    const yAfter = afterTicksOf(y);
    const tAfter = afterTicksOf(t);
    if (yAfter - tAfter < 60) return null;

    const ySec = Math.round(yAfter / 20);
    const tSec = Math.round(tAfter / 20);

    return {
      text: `Crafting after trades: ${ySec} s vs ${tSec} s`,
      seconds: null,
      at: { you: y[0]?.t0, them: t[0]?.t0 },
    };
  },
};
