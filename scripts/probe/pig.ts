// Piglin states per second. npx tsx scripts/probe/pig.ts <file> <uuid> [from] [to]
import { fmtTime, loadReplay, parseBound, resolvePlayer } from "./_shared";

const [file, who, rawFrom, rawTo] = process.argv.slice(2);
if (!file) {
  console.error("Usage: npx tsx scripts/probe/pig.ts <file> <uuid> [from] [to]");
  process.exit(1);
}

const rep = loadReplay(file);
const { name, uuid, events, run } = resolvePlayer(rep, who);
const b = run.mark("bastion") ?? 0;
const l = run.mark("bastion_left") ?? run.end;
const from = parseBound(rawFrom, b, run.end, "seconds");
const to = parseBound(rawTo, Math.min(run.end, l + 40), run.end, "seconds");

console.log(`=== ${name} (${uuid}) piglins [${from}..${to}] (${fmtTime(from)}–${fmtTime(to)}) ===`);
const state = new Map<number, number>();
const pos = new Map<number, [number, number, number]>();
const type = new Map<number, string>();
let i = 0;
let thrown = 0, picked = 0, barters = 0, brk = 0;

for (; i < events.length && events[i].t < from; i++) {
  const e = events[i];
  if (e.type === "ENTITY_ADD") type.set(e.id!, e.entity!);
  if (e.pos && e.id !== undefined) pos.set(e.id, e.pos);
  if (e.type === "PIGLIN_STATE") state.set(e.id!, e.state!);
  if (e.type === "ENTITY_REMOVE") state.delete(e.id!);
}

for (let t = from; t <= to; t += 20) {
  for (; i < events.length && events[i].t <= t; i++) {
    const e = events[i];
    if (e.type === "ENTITY_ADD") type.set(e.id!, e.entity!);
    if (e.pos && e.id !== undefined) pos.set(e.id, e.pos);
    if (e.type === "PIGLIN_STATE") state.set(e.id!, e.state!);
    if (e.type === "ENTITY_REMOVE") state.delete(e.id!);
    if (e.type === "ITEM_ENTITY" && e.item === "gold_ingot") {
      const pp = run.posAt(e.t);
      if (Math.hypot(e.pos![0] - pp.x, e.pos![2] - pp.z) <= 3) thrown += e.count ?? 1;
    }
    if (e.type === "ITEM_PICKUP" && e.collector !== -2) picked++;
    if (e.type === "PIGLIN_BARTER") barters++;
    if (e.type === "BLOCK_BREAK") brk++;
  }
  const me = run.posAt(t);
  const near = [...state.entries()].filter(([id]) => {
    const q = pos.get(id);
    return q && Math.hypot(q[0] - me.x, q[2] - me.z) <= 16;
  });
  const c = (s: number) => near.filter(([, x]) => x === s).length;
  const gold = run.invAt(t).get("gold_ingot") ?? 0;
  const scr = run.actions.find((a) => ["chest", "inventory", "craft"].includes(a.kind) && a.t0 <= t && a.t1 >= t)?.kind ?? "";
  console.log(
    `${fmtTime(t).padStart(5)} (${String(t).padStart(5)}t) near=${String(near.length).padStart(2)} roam=${c(0)} seek=${c(1)} admire=${c(2)} angry=${c(3)} BARTER=${c(4)} aggro=${c(5) + c(6)} gold=${gold} thrown=${thrown} pick=${picked} barters=${barters} brk=${brk} ${scr}`
  );
  thrown = picked = barters = brk = 0;
}
