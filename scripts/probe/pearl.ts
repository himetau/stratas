import { fmtTime, loadReplay, parseBound, probeArgs, resolvePlayer } from "./_shared";
import { pearlHangs } from "../../src/core/detect/bastion";
import type { Vec3 } from "../../src/core/replay/decode";

type PearlFlight = { t: number; pos: Vec3; last: Vec3; lastT: number; moves: number };

const [file, who, rawFrom, rawTo] = probeArgs("scripts/probe/pearl.ts <file> <uuid> [from] [to]");
const rep = loadReplay(file);
const { name, uuid, events, run } = resolvePlayer(rep, who);
const from = parseBound(rawFrom, 0, run.end, "seconds");
const to = parseBound(rawTo, run.end, run.end, "seconds");
const inRange = (t: number) => t >= from && t <= to;

console.log(`=== ${name} (${uuid}) pearls [${from}..${to}] (${fmtTime(from)}–${fmtTime(to)}) ===`);
console.log(`  marks: ${run.marks.map((m) => `${m.key}@${fmtTime(m.t)}(${m.t}t)`).join(" | ")}`);

const pearls = new Map<number, PearlFlight>();
for (const e of events) {
  if (e.type === "PROJECTILE" && e.entity === "ender_pearl" && e.pos) {
    pearls.set(e.id!, { t: e.t, pos: e.pos, last: e.pos, lastT: e.t, moves: 0 });
  } else if (e.id !== undefined && pearls.has(e.id) && e.pos) {
    const pearl = pearls.get(e.id)!;
    pearl.last = e.pos;
    pearl.lastT = e.t;
    pearl.moves++;
  }
  if (e.type !== "ENTITY_REMOVE" || !pearls.has(e.id!)) {
    continue;
  }
  const pearl = pearls.get(e.id!)!;
  pearls.delete(e.id!);
  if (!inRange(pearl.t)) {
    continue;
  }
  const thrownAt = run.posAt(pearl.t);
  const landedAt = run.posAt(e.t + 2);
  const jump = Math.hypot(landedAt.x - thrownAt.x, landedAt.z - thrownAt.z);
  console.log(
    `  thrown ${fmtTime(pearl.t)} (${pearl.t}t) [${run.phaseAt(pearl.t)}] -> removed @${fmtTime(e.t)} (${e.t}t, +${((e.t - pearl.t) / 20).toFixed(1)}s) | moves=${pearl.moves} | player moved ${jump.toFixed(0)}b (to ${Math.round(landedAt.x)},${Math.round(landedAt.y)},${Math.round(landedAt.z)}) | pearl last ${pearl.last.map(Math.round).join(",")}`,
  );
}
for (const pearl of pearls.values()) {
  if (!inRange(pearl.t)) {
    continue;
  }
  console.log(
    `  thrown ${fmtTime(pearl.t)} (${pearl.t}t) [${run.phaseAt(pearl.t)}] never removed, last move +${((pearl.lastT - pearl.t) / 20).toFixed(1)}s`,
  );
}

const hangs = pearlHangs(run).filter((h) => inRange(h.thrown));
if (hangs.length) {
  console.log(
    `  pearlHangs detected:`,
    hangs.map(
      (h) =>
        `thrown ${fmtTime(h.thrown)}(${h.thrown}t) -> landed ${fmtTime(h.landed)}(${h.landed}t)`,
    ),
  );
}
