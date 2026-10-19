import type { Note, Side } from "../findings";
import { fmtTime } from "../names";
import type { Action } from "../run";
import type { Mechanic, Occurrence } from "./index";

const SHIPWRECK_LOOT = new Set([
  "iron_nugget",
  "gold_nugget",
  "lapis_lazuli",
  "emerald",
  "suspicious_stew",
  "carrot",
  "potato",
  "wheat",
  "paper",
  "feather",
]);

const VILLAGE_OR_TEMPLE_CHEST_ITEMS = new Set([
  "bread",
  "apple",
  "iron_pickaxe",
  "iron_sword",
  "iron_axe",
  "iron_shovel",
  "iron_helmet",
  "iron_chestplate",
  "iron_leggings",
  "iron_boots",
  "saddle",
  "gunpowder",
  "bone",
  "rotten_flesh",
  "golden_apple",
  "enchanted_golden_apple",
  "enchanted_book",
  "iron_horse_armor",
  "golden_horse_armor",
  "diamond_horse_armor",
  "cooked_cod",
  "cooked_salmon",
  "heart_of_the_sea",
  "prismarine_crystals",
  "obsidian",
  "crying_obsidian",
  "flint_and_steel",
  "fire_charge",
  "golden_axe",
  "golden_sword",
  "golden_pickaxe",
  "golden_shovel",
  "golden_hoe",
  "golden_helmet",
  "golden_chestplate",
  "golden_leggings",
  "golden_boots",
  "gold_block",
  "glistering_melon_slice",
  "light_weighted_pressure_plate",
]);

const isBed = (item?: string) => Boolean(item && (item === "bed" || item.endsWith("_bed")));

const isShipwreckLoot = (item: string) =>
  SHIPWRECK_LOOT.has(item) || item.startsWith("leather_");

const isVillageOrTempleItem = (item?: string) =>
  Boolean(
    item &&
      (isBed(item) ||
        item === "hay_block" ||
        item === "bell" ||
        item === "tnt" ||
        item === "stone_pressure_plate" ||
        item.includes("sandstone") ||
        VILLAGE_OR_TEMPLE_CHEST_ITEMS.has(item)),
  );

function isOpenedUnderwater(s: Side, a: Action): boolean {
  for (const e of s.run.events ?? []) {
    if (e.t < a.t0 - 80) continue;
    if (e.t > a.t1 + 40) break;
    if (e.type === "STATS" && e.air !== undefined && e.air >= 0 && e.air < 300) return true;
    if (e.type === "POSE" && e.pose === 3) return true;
  }
  if (a.at && a.at[1] > 0 && a.at[1] < 58) return true;
  if ((s.run.track?.length ?? 0) > 0 && typeof s.run.posAt === "function") {
    const p = s.run.posAt(a.t0);
    if (p.w === 0 && p.y > 0 && p.y < 58) return true;
  }
  return false;
}

function hasShipwreckLoot(s: Side, a: Action): boolean {
  for (const [k, n] of Object.entries(a.delta ?? {})) {
    if (n > 0 && isShipwreckLoot(k)) return true;
  }
  for (const e of s.run.events ?? []) {
    if (e.t < a.t0) continue;
    if (e.t > a.t1) break;
    if (e.type === "INVENTORY_SLOT" && (e.slot ?? 0) > 40 && e.item && isShipwreckLoot(e.item)) {
      return true;
    }
  }
  return false;
}

function hasNonShipwreckChestItems(a: Action): boolean {
  for (const [k, n] of Object.entries(a.delta ?? {})) {
    if (n > 0 && isVillageOrTempleItem(k)) return true;
  }
  return false;
}

export const overworldShipwreckMechanic: Mechanic = {
  key: "overworld_shipwreck",
  phase: ["Overworld"],
  detect(s: Side, span?: [number, number]): Occurrence[] {
    const nether = typeof s.run.mark === "function" ? s.run.mark("nether") : undefined;
    const from = span ? span[0] : 0;
    const to = span ? (nether !== undefined ? Math.min(span[1], nether) : span[1]) : (nether ?? s.run.end);
    const inOverworld = (t: number, w?: number) =>
      t >= from && t <= to && (nether === undefined || t <= nether) && (w === undefined || w === 0);

    const actions = s.run.actions ?? [];
    const hasGolem =
      (s.facts?.kills ?? []).some(
        (k) =>
          k.entity === "iron_golem" &&
          inOverworld(k.t, typeof s.run.posAt === "function" ? s.run.posAt(k.t).w : 0),
      ) || actions.some((a) => a.kind === "hit" && a.what === "iron_golem" && inOverworld(a.t0, a.w));
    if (hasGolem) return [];

    const hasVillageOrTempleActions = actions.some((a) => {
      if (!inOverworld(a.t0, a.w)) return false;
      if (a.kind === "mine" || a.kind === "pickup") {
        return isVillageOrTempleItem(a.item) || isVillageOrTempleItem(a.what);
      }
      if (a.kind === "chest") {
        return hasNonShipwreckChestItems(a);
      }
      return false;
    });
    if (hasVillageOrTempleActions) return [];

    const shipwreckChests = actions
      .filter(
        (a) =>
          a.kind === "chest" &&
          inOverworld(a.t0, a.w) &&
          !hasNonShipwreckChestItems(a) &&
          (isOpenedUnderwater(s, a) || hasShipwreckLoot(s, a)),
      )
      .sort((a, b) => a.t0 - b.t0);

    if (!shipwreckChests.length) return [];

    const t0 = shipwreckChests[0].t0;
    const t1 = Math.max(...shipwreckChests.map((c) => c.t1));
    const chests = shipwreckChests.length;
    const ironIngots = shipwreckChests.reduce((sum, c) => sum + Math.max(0, c.delta?.iron_ingot ?? 0), 0);
    const ironNuggets = shipwreckChests.reduce((sum, c) => sum + Math.max(0, c.delta?.iron_nugget ?? 0), 0);
    const iron = ironIngots > 0 ? ironIngots : Math.floor(ironNuggets / 9);

    return [
      {
        t0,
        t1,
        value: t1 - t0,
        text: `Shipwreck at ${fmtTime(t0)}–${fmtTime(t1)} (${chests} chest${chests === 1 ? "" : "s"}, ${iron} iron)`,
        meta: { chests, iron },
      },
    ];
  },
  compare(y: Occurrence[], t: Occurrence[]): Note | null {
    if (!y.length || !t.length) return null;
    const yo = y[0];
    const to = t[0];
    const yChests = typeof yo.meta?.chests === "number" ? yo.meta.chests : y.length;
    const tChests = typeof to.meta?.chests === "number" ? to.meta.chests : t.length;
    if (yChests < 1 || tChests < 1) return null;

    const yDur = yo.t1 - yo.t0;
    const tDur = to.t1 - to.t0;
    const timingDiffers =
      Math.abs(yo.t0 - to.t0) >= 60 ||
      Math.abs(yo.t1 - to.t1) >= 60 ||
      Math.abs(yDur - tDur) >= 60;

    if (yChests === tChests && !timingDiffers) return null;

    const yIron = typeof yo.meta?.iron === "number" ? yo.meta.iron : 0;
    const tIron = typeof to.meta?.iron === "number" ? to.meta.iron : 0;

    return {
      text: `Shipwreck: ${yChests} chest${yChests === 1 ? "" : "s"} (${fmtTime(yo.t0)}–${fmtTime(yo.t1)}, ${yIron} iron) vs ${tChests} chest${tChests === 1 ? "" : "s"} (${fmtTime(to.t0)}–${fmtTime(to.t1)}, ${tIron} iron)`,
      seconds: null,
      at: { you: yo.t0, them: to.t0 },
    };
  },
};
