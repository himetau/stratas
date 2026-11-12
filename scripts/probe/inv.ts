import { fmtTime, loadReplay, parseBound, probeArgs, resolvePlayer } from "./_shared";

const HIDDEN_ACTIONS = ["pickup", "damage", "hit", "mine", "place", "barter"];

const [file, who, rawFrom, rawTo] = probeArgs("scripts/probe/inv.ts <file> <uuid> [from] [to]");
const rep = loadReplay(file);
const { name, uuid, run } = resolvePlayer(rep, who);
const from = parseBound(rawFrom, 0, run.end, "seconds");
const to = parseBound(rawTo, run.end, run.end, "seconds");

console.log(
  `=== ${name} (${uuid}) inventory diffs [${from}..${to}] (${fmtTime(from)}–${fmtTime(to)}) ===`,
);
let prev = run.invAt(from);
if (from > 0) {
  const start = [...prev.entries()].filter(([, n]) => n > 0).map(([item, n]) => `${item}x${n}`);
  console.log(`  start @${fmtTime(from)} (${from}t): ${start.join(", ") || "(empty)"}`);
}

for (let t = from; t <= to; t += 10) {
  const inv = run.invAt(t);
  const changes: string[] = [];
  for (const item of new Set([...prev.keys(), ...inv.keys()])) {
    const diff = (inv.get(item) ?? 0) - (prev.get(item) ?? 0);
    if (diff) {
      changes.push(`${diff > 0 ? "+" : ""}${diff} ${item}`);
    }
  }
  if (changes.length) {
    const pos = run.posAt(t);
    console.log(
      `${fmtTime(t).padStart(5)} (${String(t).padStart(5)}t, ${(t / 20).toFixed(1)}s) [w${pos.w}] ${changes.join(", ")}`,
    );
  }
  prev = inv;
}

console.log("\n--- Screens & Actions ---");
for (const a of run.actions) {
  if (a.t1 < from || a.t0 > to || HIDDEN_ACTIONS.includes(a.kind)) {
    continue;
  }
  const delta = Object.keys(a.delta ?? {}).length ? JSON.stringify(a.delta) : "";
  console.log(
    `  act ${fmtTime(a.t0)}–${fmtTime(a.t1)} (${a.t0}..${a.t1}) ${a.kind} ${a.what ?? ""} ${delta}`,
  );
}
for (const s of run.splitList) {
  if (s.t >= from && s.t <= to) {
    console.log(`  split ${fmtTime(s.t)} (${s.t}t) ${s.type}`);
  }
}
