// Pearl flights in a range. npx tsx scripts/probe/pearl.ts <file> <uuid> [from] [to]
import { fmtTime, loadReplay, parseBound, resolvePlayer } from "./_shared";
import { pearlHangs } from "../../src/core/detect/bastion";

const [file, who, rawFrom, rawTo] = process.argv.slice(2);
if (!file) {
  console.error("Usage: npx tsx scripts/probe/pearl.ts <file> <uuid> [from] [to]");
  process.exit(1);
}

const rep = loadReplay(file);
const { name, uuid, events, run } = resolvePlayer(rep, who);
const from = parseBound(rawFrom, 0, run.end, "seconds");
const to = parseBound(rawTo, run.end, run.end, "seconds");

console.log(`=== ${name} (${uuid}) pearls [${from}..${to}] (${fmtTime(from)}–${fmtTime(to)}) ===`);
console.log(`  marks: ${run.marks.map((m) => `${m.key}@${fmtTime(m.t)}(${m.t}t)`).join(" | ")}`);

const pearls = new Map<number, { t: number; pos: [number, number, number]; last: [number, number, number]; lastT: number; moves: number }>();
for (const e of events) {
  if (e.type === "PROJECTILE" && e.entity === "ender_pearl" && e.pos) {
    pearls.set(e.id!, { t: e.t, pos: e.pos, last: e.pos, lastT: e.t, moves: 0 });
  } else if (e.id !== undefined && pearls.has(e.id) && e.pos) {
    const q = pearls.get(e.id)!;
    q.last = e.pos;
    q.lastT = e.t;
    q.moves++;
  }
  if (e.type === "ENTITY_REMOVE" && pearls.has(e.id!)) {
    const q = pearls.get(e.id!)!;
    pearls.delete(e.id!);
    if (q.t < from || q.t > to) continue;
    const a = run.posAt(q.t), b = run.posAt(e.t + 2);
    const jump = Math.hypot(b.x - a.x, b.z - a.z);
    console.log(
      `  thrown ${fmtTime(q.t)} (${q.t}t) [${run.phaseAt(q.t)}] -> removed @${fmtTime(e.t)} (${e.t}t, +${((e.t - q.t) / 20).toFixed(1)}s) | moves=${q.moves} | player moved ${jump.toFixed(0)}b (to ${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.z)}) | pearl last ${q.last.map(Math.round).join(",")}`
    );
  }
}
for (const [, q] of pearls) {
  if (q.t < from || q.t > to) continue;
  console.log(`  thrown ${fmtTime(q.t)} (${q.t}t) [${run.phaseAt(q.t)}] never removed, last move +${((q.lastT - q.t) / 20).toFixed(1)}s`);
}

const hangs = pearlHangs(run).filter((h) => h.thrown >= from && h.thrown <= to);
if (hangs.length) {
  console.log(`  pearlHangs detected:`, hangs.map((h) => `thrown ${fmtTime(h.thrown)}(${h.thrown}t) -> landed ${fmtTime(h.landed)}(${h.landed}t)`));
}
