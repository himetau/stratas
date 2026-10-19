// Inventory diffs in a range. npx tsx scripts/probe/inv.ts <file> <uuid> [from] [to]
import { fmtTime, loadReplay, parseBound, resolvePlayer } from "./_shared";

const [file, who, rawFrom, rawTo] = process.argv.slice(2);
if (!file) {
  console.error("Usage: npx tsx scripts/probe/inv.ts <file> <uuid> [from] [to]");
  process.exit(1);
}

const rep = loadReplay(file);
const { name, uuid, run } = resolvePlayer(rep, who);
const from = parseBound(rawFrom, 0, run.end, "seconds");
const to = parseBound(rawTo, run.end, run.end, "seconds");

console.log(`=== ${name} (${uuid}) inventory diffs [${from}..${to}] (${fmtTime(from)}–${fmtTime(to)}) ===`);
let prev = run.invAt(from);
if (from > 0) {
  const init = [...prev.entries()].filter(([, n]) => n > 0).map(([k, n]) => `${k}x${n}`);
  console.log(`  start @${fmtTime(from)} (${from}t): ${init.join(", ") || "(empty)"}`);
}

for (let t = from; t <= to; t += 10) {
  const c = run.invAt(t);
  const d: string[] = [];
  for (const k of new Set([...prev.keys(), ...c.keys()])) {
    const x = (c.get(k) ?? 0) - (prev.get(k) ?? 0);
    if (x) d.push(`${x > 0 ? "+" : ""}${x} ${k}`);
  }
  if (d.length) {
    const pp = run.posAt(t);
    console.log(`${fmtTime(t).padStart(5)} (${String(t).padStart(5)}t, ${(t / 20).toFixed(1)}s) [w${pp.w}] ${d.join(", ")}`);
  }
  prev = c;
}

console.log("\n--- Screens & Actions ---");
for (const a of run.actions.filter((a) => a.t1 >= from && a.t0 <= to && !["pickup", "damage", "hit", "mine", "place", "barter"].includes(a.kind))) {
  console.log(`  act ${fmtTime(a.t0)}–${fmtTime(a.t1)} (${a.t0}..${a.t1}) ${a.kind} ${a.what ?? ""} ${Object.keys(a.delta ?? {}).length ? JSON.stringify(a.delta) : ""}`);
}
for (const s of run.splitList.filter((s) => s.t >= from && s.t <= to)) {
  console.log(`  split ${fmtTime(s.t)} (${s.t}t) ${s.type}`);
}
