// Raw events in a tick range. npx tsx scripts/probe/events.ts <file> <uuid> [from] [to]
import { fmtTime, loadReplay, parseBound, resolvePlayer } from "./_shared";

const [file, who, rawFrom, rawTo] = process.argv.slice(2);
if (!file) {
  console.error("Usage: npx tsx scripts/probe/events.ts <file> <uuid> [from] [to]");
  process.exit(1);
}

const rep = loadReplay(file);
const { name, uuid, events, run } = resolvePlayer(rep, who);
const from = parseBound(rawFrom, 0, run.end, "ticks");
const to = parseBound(rawTo, run.end, run.end, "ticks");

console.log(`=== ${name} (${uuid}) events [${from}..${to}] (${fmtTime(from)}–${fmtTime(to)}) ===`);
const entityTypes = new Map<number, string>();
const itemTypes = new Map<number, string>();
const slots = new Map<number, string>();
const PIG_STATES = ["ROAMING", "SEEKING", "ADMIRING", "ANGRY", "BARTERING", "AGGRO_LIGHT", "AGGRO_HEAVY"];

for (const e of events) {
  if (e.type === "ENTITY_ADD" || e.type === "PROJECTILE") entityTypes.set(e.id!, e.entity!);
  if (e.type === "ITEM_ENTITY") itemTypes.set(e.id!, `${e.item}x${e.count ?? 1}`);
  if (e.type === "INVENTORY_SLOT" && e.slot! <= 40) slots.set(e.slot!, `${e.item}x${e.count}`);
  if (e.t < from || e.t > to) continue;
  if (!process.env.ALL && (e.type === "PLAYER_LOOK" || e.type === "ENTITY_LOOK" || e.type === "ENTITY_MOVE" || e.type === "ENTITY_POS")) continue;

  const p = run.posAt(e.t);
  const head = `${String(e.t).padStart(6)} ${fmtTime(e.t).padStart(5)} (s=${(e.t / 20).toFixed(1)}) [w${p.w} ${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}]`;
  switch (e.type) {
    case "PLAYER_POSITION":
    case "PLAYER_POSITION_DELTA":
    case "PLAYER_POS":
    case "PLAYER_POS_DELTA":
    case "PLAYER_SPAWN":
      if (process.env.POS) console.log(`${head} ${e.type} -> ${e.pos?.map((v) => v.toFixed(1)).join(",")}`);
      break;
    case "PIGLIN_STATE":
      console.log(`${head} PIGLIN_STATE id=${e.id} ${PIG_STATES[e.state!] ?? e.state} (${e.state})`);
      break;
    case "PIGLIN_BARTER":
      console.log(`${head} PIGLIN_BARTER id=${e.id} items=${JSON.stringify(e.items)}`);
      break;
    case "ITEM_ENTITY":
      console.log(`${head} ITEM_ENTITY id=${e.id} ${e.item}x${e.count ?? 1} pos=${e.pos?.map((v) => v.toFixed(1)).join(",")} dist=${e.pos ? Math.hypot(e.pos[0] - p.x, e.pos[2] - p.z).toFixed(1) : "?"}`);
      break;
    case "ITEM_PICKUP":
      console.log(`${head} ITEM_PICKUP id=${e.id} (${itemTypes.get(e.id!) ?? "?"}) collector=${e.collector === -2 ? "YOU(-2)" : e.collector} count=${e.count}`);
      break;
    case "INVENTORY_SLOT":
      console.log(`${head} INVENTORY_SLOT slot=${e.slot} ${e.item}x${e.count}`);
      break;
    case "CONTAINER":
      console.log(`${head} CONTAINER ${e.container} slots=${e.slots} pos=${JSON.stringify(e.positions)}`);
      break;
    case "BLOCK_BREAK":
    case "BLOCK_REMOVE":
    case "BLOCK_UPDATE":
    case "BLOCK_PROGRESS":
      console.log(`${head} ${e.type} at=${e.at?.join(",")} ${e.block ? `block=${e.block} ev=${e.blockEvent}` : e.progress !== undefined ? `prog=${e.progress}` : ""}`);
      break;
    case "ENTITY_ADD":
    case "PROJECTILE":
      console.log(`${head} ${e.type} id=${e.id} entity=${e.entity} pos=${e.pos?.map((v) => v.toFixed(1)).join(",")}`);
      break;
    case "ENTITY_DAMAGE":
      console.log(`${head} ENTITY_DAMAGE hurt=${e.id === -2 ? "YOU(-2)" : `${entityTypes.get(e.id!) ?? "?"}(${e.id})`} attacker=${e.attacker === -2 ? "YOU(-2)" : `${entityTypes.get(e.attacker!) ?? "?"}(${e.attacker})`}`);
      break;
    case "ENTITY_REMOVE":
      console.log(`${head} ENTITY_REMOVE id=${e.id} (${entityTypes.get(e.id!) ?? itemTypes.get(e.id!) ?? "?"}) killed=${e.killed}`);
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
