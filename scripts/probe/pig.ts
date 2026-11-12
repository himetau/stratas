import type { ReplayEvent, Vec3 } from "../../src/core/replay/decode";
import { fmtTime, loadReplay, parseBound, probeArgs, resolvePlayer } from "./_shared";

const YOU = -2;
const SCREENS = ["chest", "inventory", "craft"];

const [file, who, rawFrom, rawTo] = probeArgs("scripts/probe/pig.ts <file> <uuid> [from] [to]");
const rep = loadReplay(file);
const { name, uuid, events, run } = resolvePlayer(rep, who);
const bastion = run.mark("bastion") ?? 0;
const bastionLeft = run.mark("bastion_left") ?? run.end;
const from = parseBound(rawFrom, bastion, run.end, "seconds");
const to = parseBound(rawTo, Math.min(run.end, bastionLeft + 40), run.end, "seconds");

console.log(`=== ${name} (${uuid}) piglins [${from}..${to}] (${fmtTime(from)}–${fmtTime(to)}) ===`);
const state = new Map<number, number>();
const pos = new Map<number, Vec3>();

function track(e: ReplayEvent) {
  if (e.pos && e.id !== undefined) {
    pos.set(e.id, e.pos);
  }
  if (e.type === "PIGLIN_STATE") {
    state.set(e.id!, e.state!);
  }
  if (e.type === "ENTITY_REMOVE") {
    state.delete(e.id!);
  }
}

let i = 0;
for (; i < events.length && events[i].t < from; i++) {
  track(events[i]);
}

for (let t = from; t <= to; t += 20) {
  let thrown = 0;
  let picked = 0;
  let barters = 0;
  let brk = 0;
  for (; i < events.length && events[i].t <= t; i++) {
    const e = events[i];
    track(e);
    if (e.type === "ITEM_ENTITY" && e.item === "gold_ingot") {
      const you = run.posAt(e.t);
      if (Math.hypot(e.pos![0] - you.x, e.pos![2] - you.z) <= 3) {
        thrown += e.count ?? 1;
      }
    }
    if (e.type === "ITEM_PICKUP" && e.collector !== YOU) {
      picked++;
    }
    if (e.type === "PIGLIN_BARTER") {
      barters++;
    }
    if (e.type === "BLOCK_BREAK") {
      brk++;
    }
  }
  const me = run.posAt(t);
  const near = [...state.entries()].filter(([id]) => {
    const p = pos.get(id);
    return p && Math.hypot(p[0] - me.x, p[2] - me.z) <= 16;
  });
  const inState = (s: number) => near.filter(([, x]) => x === s).length;
  const gold = run.invAt(t).get("gold_ingot") ?? 0;
  const screen =
    run.actions.find((a) => SCREENS.includes(a.kind) && a.t0 <= t && a.t1 >= t)?.kind ?? "";
  console.log(
    `${fmtTime(t).padStart(5)} (${String(t).padStart(5)}t) near=${String(near.length).padStart(2)} roam=${inState(0)} seek=${inState(1)} admire=${inState(2)} angry=${inState(3)} BARTER=${inState(4)} aggro=${inState(5) + inState(6)} gold=${gold} thrown=${thrown} pick=${picked} barters=${barters} brk=${brk} ${screen}`,
  );
}
