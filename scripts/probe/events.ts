import type { ReplayEvent } from "../../src/core/replay/decode";
import { fmtTime, loadReplay, parseBound, probeArgs, resolvePlayer } from "./_shared";

const PIG_STATES = [
  "ROAMING",
  "SEEKING",
  "ADMIRING",
  "ANGRY",
  "BARTERING",
  "AGGRO_LIGHT",
  "AGGRO_HEAVY",
];
const MOVEMENT_EVENTS = new Set(["PLAYER_LOOK", "ENTITY_LOOK", "ENTITY_MOVE", "ENTITY_POS"]);
const YOU = -2;

const [file, who, rawFrom, rawTo] = probeArgs("scripts/probe/events.ts <file> <uuid> [from] [to]");
const rep = loadReplay(file);
const { name, uuid, events, run } = resolvePlayer(rep, who);
const from = parseBound(rawFrom, 0, run.end, "ticks");
const to = parseBound(rawTo, run.end, run.end, "ticks");

console.log(`=== ${name} (${uuid}) events [${from}..${to}] (${fmtTime(from)}–${fmtTime(to)}) ===`);
const entityTypes = new Map<number, string>();
const itemTypes = new Map<number, string>();
const slots = new Map<number, string>();

const fmtPos = (pos: number[] | undefined) => pos?.map((v) => v.toFixed(1)).join(",");
const entityLabel = (id: number | undefined) =>
  id === YOU ? "YOU(-2)" : `${entityTypes.get(id!) ?? "?"}(${id})`;

function blockDetail(e: ReplayEvent): string {
  if (e.block) {
    return `block=${e.block} ev=${e.blockEvent}`;
  }
  if (e.progress !== undefined) {
    return `prog=${e.progress}`;
  }
  return "";
}

for (const e of events) {
  if (e.type === "ENTITY_ADD" || e.type === "PROJECTILE") {
    entityTypes.set(e.id!, e.entity!);
  }
  if (e.type === "ITEM_ENTITY") {
    itemTypes.set(e.id!, `${e.item}x${e.count ?? 1}`);
  }
  if (e.type === "INVENTORY_SLOT" && e.slot! <= 40) {
    slots.set(e.slot!, `${e.item}x${e.count}`);
  }
  if (e.t < from || e.t > to) {
    continue;
  }
  if (!process.env.ALL && MOVEMENT_EVENTS.has(e.type)) {
    continue;
  }

  const p = run.posAt(e.t);
  const head = `${String(e.t).padStart(6)} ${fmtTime(e.t).padStart(5)} (s=${(e.t / 20).toFixed(1)}) [w${p.w} ${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}]`;
  switch (e.type) {
    case "PLAYER_POSITION":
    case "PLAYER_POSITION_DELTA":
    case "PLAYER_POS":
    case "PLAYER_POS_DELTA":
    case "PLAYER_SPAWN":
      if (process.env.POS) {
        console.log(`${head} ${e.type} -> ${fmtPos(e.pos)}`);
      }
      break;
    case "PIGLIN_STATE":
      console.log(
        `${head} PIGLIN_STATE id=${e.id} ${PIG_STATES[e.state!] ?? e.state} (${e.state})`,
      );
      break;
    case "PIGLIN_BARTER":
      console.log(`${head} PIGLIN_BARTER id=${e.id} items=${JSON.stringify(e.items)}`);
      break;
    case "ITEM_ENTITY": {
      const dist = e.pos ? Math.hypot(e.pos[0] - p.x, e.pos[2] - p.z).toFixed(1) : "?";
      console.log(
        `${head} ITEM_ENTITY id=${e.id} ${e.item}x${e.count ?? 1} pos=${fmtPos(e.pos)} dist=${dist}`,
      );
      break;
    }
    case "ITEM_PICKUP": {
      const collector = e.collector === YOU ? "YOU(-2)" : e.collector;
      console.log(
        `${head} ITEM_PICKUP id=${e.id} (${itemTypes.get(e.id!) ?? "?"}) collector=${collector} count=${e.count}`,
      );
      break;
    }
    case "INVENTORY_SLOT":
      console.log(`${head} INVENTORY_SLOT slot=${e.slot} ${e.item}x${e.count}`);
      break;
    case "CONTAINER":
      console.log(
        `${head} CONTAINER ${e.container} slots=${e.slots} pos=${JSON.stringify(e.positions)}`,
      );
      break;
    case "BLOCK_BREAK":
    case "BLOCK_REMOVE":
    case "BLOCK_UPDATE":
    case "BLOCK_PROGRESS":
      console.log(`${head} ${e.type} at=${e.at?.join(",")} ${blockDetail(e)}`);
      break;
    case "ENTITY_ADD":
    case "PROJECTILE":
      console.log(`${head} ${e.type} id=${e.id} entity=${e.entity} pos=${fmtPos(e.pos)}`);
      break;
    case "ENTITY_DAMAGE":
      console.log(
        `${head} ENTITY_DAMAGE hurt=${entityLabel(e.id)} attacker=${entityLabel(e.attacker)}`,
      );
      break;
    case "ENTITY_REMOVE":
      console.log(
        `${head} ENTITY_REMOVE id=${e.id} (${entityTypes.get(e.id!) ?? itemTypes.get(e.id!) ?? "?"}) killed=${e.killed}`,
      );
      break;
    case "STATS":
      console.log(`${head} STATS hp=${e.health} food=${e.food} air=${e.air} abs=${e.absorption}`);
      break;
    case "HELD_SLOT":
      console.log(`${head} HELD_SLOT slot=${e.slot} (${slots.get(e.slot!) ?? "air"})`);
      break;
    case "USE":
      console.log(`${head} USE hand=${e.hand} finished=${e.finished}`);
      break;
    case "PIE_CHART":
      console.log(`${head} PIE_CHART ${e.pie?.[0]?.[0] ?? ""}`);
      break;
    default:
      console.log(`${head} ${e.type} ${JSON.stringify(e)}`);
  }
}
