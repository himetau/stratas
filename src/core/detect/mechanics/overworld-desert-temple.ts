import type { Note, Side } from "../findings";
import { fmtDur, fmtTime } from "../names";
import type { Action } from "../run";
import type { Mechanic, Occurrence } from "./index";

const TEMPLE_LOOT = new Set([
  "gunpowder",
  "bone",
  "rotten_flesh",
  "golden_apple",
  "enchanted_golden_apple",
  "enchanted_book",
]);

const isTempleBlock = (item?: string) =>
  Boolean(
    item &&
      (item === "tnt" ||
        item === "stone_pressure_plate" ||
        item.includes("sandstone")),
  );

const dur = (t: number) => fmtDur(t / 20);

export const overworldDesertTempleMechanic: Mechanic = {
  key: "overworld_desert_temple",
  phase: ["Overworld"],
  detect(s: Side, span?: [number, number]): Occurrence[] {
    const nether = s.run.mark("nether");
    const from = span ? span[0] : 0;
    const to = span ? (nether !== undefined ? Math.min(span[1], nether) : span[1]) : (nether ?? s.run.end);
    const inOverworld = (t: number, w?: number) =>
      t >= from && t <= to && (nether === undefined || t <= nether) && (w === undefined || w === 0);

    const chests = s.run.actions
      .filter((a) => a.kind === "chest" && inOverworld(a.t0, a.w))
      .sort((a, b) => a.t0 - b.t0);
    if (chests.length < 2) {
      // Blew up the temple pit, TNT mined or exploded in the Overworld plus temple loot pickups
      const tntActs = s.run.actions.filter(
        (a) =>
          inOverworld(a.t0, a.w) &&
          ((a.kind === "mine" && isTempleBlock(a.item)) ||
            (a.kind === "pickup" && (a.item === "tnt" || TEMPLE_LOOT.has(a.item ?? "")))),
      );
      const owExplosions = s.facts.explosions.filter((x) => x.w === 0 && inOverworld(x.t, 0));
      // A zombie drop or a creeper isn't a temple. Need TNT and sandstone both
      const hasTnt = tntActs.some((a) => a.item === "tnt") || owExplosions.length > 0;
      const hasSand = tntActs.some((a) => a.kind === "mine" && a.item?.includes("sandstone"));
      if (!hasTnt || !hasSand) return [];
      const t0 = Math.min(...tntActs.map((a) => a.t0), ...owExplosions.map((x) => x.t));
      const t1 = Math.max(...tntActs.map((a) => a.t1), ...owExplosions.map((x) => x.t));
      const tnt = Math.max(
        s.run.actions
          .filter((a) => a.kind === "pickup" && a.item === "tnt" && inOverworld(a.t0, a.w))
          .reduce((sum, a) => sum + (a.count ?? 1), 0),
        s.run.invAt(to).get("tnt") ?? 0,
      );
      return [
        {
          t0,
          t1,
          value: t1 - t0,
          text: `Temple chests at ${fmtTime(t0)}: ${dur(t1 - t0)} (TNT-looted, ${tnt} TNT)`,
          meta: { chests: chests.length, tnt },
        },
      ];
    }

    const posOf = (a: Action): [number, number, number] => {
      if (a.at) return [a.at[0], a.at[1], a.at[2]];
      const p = s.run.posAt(a.t0);
      return [p.x, p.y, p.z];
    };

    const nearChest = (a: Action, b: Action) => {
      const pa = posOf(a);
      const pb = posOf(b);
      return Math.hypot(pa[0] - pb[0], pa[2] - pb[2]) <= 8 && Math.abs(pa[1] - pb[1]) <= 3;
    };

    // Group chests within 8 blocks of each other at similar y
    const groups: Action[][] = [];
    for (const c of chests) {
      const g = groups.find(
        (grp) => c.t0 - grp[grp.length - 1].t1 <= 600 && grp.some((x) => nearChest(c, x)),
      );
      if (g) g.push(c);
      else groups.push([c]);
    }

    const out: Occurrence[] = [];
    for (const grp of groups) {
      if (grp.length < 2) continue;
      const firstChestT0 = grp[0].t0;
      const lastChestT1 = Math.max(...grp.map((c) => c.t1));
      const winStart = Math.max(from, firstChestT0 - 400);
      const winEnd = Math.min(to, lastChestT1 + 400);

      const templeMines = s.run.actions.filter(
        (a) =>
          inOverworld(a.t0, a.w) &&
          a.t0 >= winStart &&
          a.t0 <= winEnd &&
          ((a.kind === "mine" && (isTempleBlock(a.item) || isTempleBlock(a.what))) ||
            (a.kind === "pickup" && (a.item === "tnt" || a.item === "stone_pressure_plate"))),
      );

      const hasTempleLoot =
        grp.some((c) =>
          Object.entries(c.delta ?? {}).some(([k, n]) => TEMPLE_LOOT.has(k) && n > 0),
        ) ||
        Object.entries(s.run.invDelta(firstChestT0, lastChestT1)).some(
          ([k, n]) => TEMPLE_LOOT.has(k) && n > 0,
        );

      if (!templeMines.length && !hasTempleLoot) continue;

      const preMines = templeMines.filter((m) => m.t0 <= lastChestT1);
      const t0 = preMines.length
        ? Math.min(firstChestT0, ...preMines.map((m) => m.t0))
        : firstChestT0;
      const t1 = lastChestT1;

      const tntMined = s.run.actions
        .filter(
          (a) =>
            a.kind === "mine" &&
            (a.item === "tnt" || a.what === "tnt") &&
            inOverworld(a.t0, a.w) &&
            a.t0 >= winStart &&
            a.t0 <= winEnd,
        )
        .reduce((sum, a) => sum + (a.count ?? 1), 0);

      const tntPicked = s.run.actions
        .filter(
          (a) =>
            a.kind === "pickup" &&
            a.item === "tnt" &&
            inOverworld(a.t0, a.w) &&
            a.t0 >= winStart &&
            a.t0 <= winEnd,
        )
        .reduce((sum, a) => sum + (a.count ?? 1), 0);

      const tntFromChests = grp.reduce((sum, c) => sum + Math.max(0, c.delta?.tnt ?? 0), 0);
      const tntInvDelta = Math.max(
        0,
        (s.run.invAt(winEnd).get("tnt") ?? 0) - (s.run.invAt(Math.max(0, t0 - 1)).get("tnt") ?? 0),
      );

      const chestCount = grp.length;
      const tnt = Math.max(tntMined, tntPicked, tntFromChests, tntInvDelta);
      const value = t1 - t0;

      out.push({
        t0,
        t1,
        value,
        text: `Temple chests at ${fmtTime(t0)}: ${dur(value)} (${chestCount} chests, ${tnt} TNT)`,
        meta: { chests: chestCount, tnt },
      });
    }

    return out;
  },
  compare(y: Occurrence[], t: Occurrence[]): Note | null {
    if (!y.length || !t.length) return null;
    const yo = y[0];
    const to = t[0];
    const yDur = dur(yo.value ?? yo.t1 - yo.t0);
    const tDur = dur(to.value ?? to.t1 - to.t0);
    const yChests = Number(yo.meta?.chests ?? 0);
    const yTnt = Number(yo.meta?.tnt ?? 0);
    const tChests = Number(to.meta?.chests ?? 0);
    const tTnt = Number(to.meta?.tnt ?? 0);

    return {
      text: `Temple chests: ${yDur} (${yChests} chests, ${yTnt} TNT) vs ${tDur} (${tChests} chests, ${tTnt} TNT)`,
      seconds: null,
      at: { you: yo.t0, them: to.t0 },
    };
  },
};
