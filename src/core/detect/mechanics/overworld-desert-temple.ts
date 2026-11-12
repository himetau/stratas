import type { Note, Side } from "../findings";
import { fmtDur, fmtTime } from "../names";
import type { Action } from "../run";
import type { Mechanic, Occurrence } from "./index";
import { actionPos, overworldWindow, sumCounts, type OverworldWindow } from "./overworld";

const TEMPLE_LOOT = new Set([
  "gunpowder",
  "bone",
  "rotten_flesh",
  "golden_apple",
  "enchanted_golden_apple",
  "enchanted_book",
]);
const CHEST_GROUP_GAP_TICKS = 600;
const TEMPLE_WINDOW_TICKS = 400;

const isTempleBlock = (item?: string) =>
  Boolean(
    item && (item === "tnt" || item === "stone_pressure_plate" || item.includes("sandstone")),
  );

const hasTempleLoot = (delta: Record<string, number>) =>
  Object.entries(delta).some(([k, n]) => TEMPLE_LOOT.has(k) && n > 0);

const dur = (t: number) => fmtDur(t / 20);

/** The temple pit blown up with TNT and looted without opening two chests */
function detectTntLooted(s: Side, win: OverworldWindow, chestCount: number): Occurrence[] {
  const tntActs = s.run.actions.filter(
    (a) =>
      win.contains(a.t0, a.w) &&
      ((a.kind === "mine" && isTempleBlock(a.item)) ||
        (a.kind === "pickup" && (a.item === "tnt" || TEMPLE_LOOT.has(a.item ?? "")))),
  );
  const owExplosions = s.facts.explosions.filter((x) => x.w === 0 && win.contains(x.t, 0));
  // A zombie drop or a creeper isn't a temple. Need TNT and sandstone both
  const hasTnt = tntActs.some((a) => a.item === "tnt") || owExplosions.length > 0;
  const hasSand = tntActs.some((a) => a.kind === "mine" && a.item?.includes("sandstone"));
  if (!hasTnt || !hasSand) {
    return [];
  }
  const t0 = Math.min(...tntActs.map((a) => a.t0), ...owExplosions.map((x) => x.t));
  const t1 = Math.max(...tntActs.map((a) => a.t1), ...owExplosions.map((x) => x.t));
  const tntPickups = s.run.actions.filter(
    (a) => a.kind === "pickup" && a.item === "tnt" && win.contains(a.t0, a.w),
  );
  const tnt = Math.max(sumCounts(tntPickups), s.run.invAt(win.to).get("tnt") ?? 0);
  return [
    {
      t0,
      t1,
      value: t1 - t0,
      text: `Temple chests at ${fmtTime(t0)}: ${dur(t1 - t0)} (TNT-looted, ${tnt} TNT)`,
      meta: { chests: chestCount, tnt },
    },
  ];
}

function isNearChest(s: Side, a: Action, b: Action): boolean {
  const pa = actionPos(s, a);
  const pb = actionPos(s, b);
  return Math.hypot(pa[0] - pb[0], pa[2] - pb[2]) <= 8 && Math.abs(pa[1] - pb[1]) <= 3;
}

/** Chests opened close in time, within 8 blocks of each other at similar y */
function groupChests(s: Side, chests: Action[]): Action[][] {
  const groups: Action[][] = [];
  for (const c of chests) {
    const g = groups.find(
      (grp) =>
        c.t0 - grp[grp.length - 1].t1 <= CHEST_GROUP_GAP_TICKS &&
        grp.some((x) => isNearChest(s, c, x)),
    );
    if (g) {
      g.push(c);
    } else {
      groups.push([c]);
    }
  }
  return groups;
}

function templeFromChestGroup(s: Side, win: OverworldWindow, grp: Action[]): Occurrence | null {
  const firstChestT0 = grp[0].t0;
  const lastChestT1 = Math.max(...grp.map((c) => c.t1));
  const winStart = Math.max(win.from, firstChestT0 - TEMPLE_WINDOW_TICKS);
  const winEnd = Math.min(win.to, lastChestT1 + TEMPLE_WINDOW_TICKS);
  const nearby = s.run.actions.filter(
    (a) => win.contains(a.t0, a.w) && a.t0 >= winStart && a.t0 <= winEnd,
  );

  const templeMines = nearby.filter(
    (a) =>
      (a.kind === "mine" && (isTempleBlock(a.item) || isTempleBlock(a.what))) ||
      (a.kind === "pickup" && (a.item === "tnt" || a.item === "stone_pressure_plate")),
  );
  const lootFound =
    grp.some((c) => hasTempleLoot(c.delta ?? {})) ||
    hasTempleLoot(s.run.invDelta(firstChestT0, lastChestT1));
  if (!templeMines.length && !lootFound) {
    return null;
  }

  const preMines = templeMines.filter((m) => m.t0 <= lastChestT1);
  const t0 = Math.min(firstChestT0, ...preMines.map((m) => m.t0));
  const t1 = lastChestT1;

  const tntMined = sumCounts(
    nearby.filter((a) => a.kind === "mine" && (a.item === "tnt" || a.what === "tnt")),
  );
  const tntPicked = sumCounts(nearby.filter((a) => a.kind === "pickup" && a.item === "tnt"));
  const tntFromChests = grp.reduce((sum, c) => sum + Math.max(0, c.delta?.tnt ?? 0), 0);
  const tntInvDelta = Math.max(
    0,
    (s.run.invAt(winEnd).get("tnt") ?? 0) - (s.run.invAt(Math.max(0, t0 - 1)).get("tnt") ?? 0),
  );

  const chestCount = grp.length;
  const tnt = Math.max(tntMined, tntPicked, tntFromChests, tntInvDelta);
  const value = t1 - t0;
  return {
    t0,
    t1,
    value,
    text: `Temple chests at ${fmtTime(t0)}: ${dur(value)} (${chestCount} chests, ${tnt} TNT)`,
    meta: { chests: chestCount, tnt },
  };
}

export const overworldDesertTempleMechanic: Mechanic = {
  key: "overworld_desert_temple",
  phase: ["Overworld"],
  detect(s: Side, span?: [number, number]): Occurrence[] {
    const win = overworldWindow(s, span);
    const chests = s.run.actions
      .filter((a) => a.kind === "chest" && win.contains(a.t0, a.w))
      .sort((a, b) => a.t0 - b.t0);
    if (chests.length < 2) {
      return detectTntLooted(s, win, chests.length);
    }

    const out: Occurrence[] = [];
    for (const grp of groupChests(s, chests)) {
      if (grp.length < 2) {
        continue;
      }
      const temple = templeFromChestGroup(s, win, grp);
      if (temple) {
        out.push(temple);
      }
    }
    return out;
  },
  compare(y: Occurrence[], t: Occurrence[]): Note | null {
    if (!y.length || !t.length) {
      return null;
    }
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
