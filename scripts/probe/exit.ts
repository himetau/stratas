// Positions and actions per second. npx tsx scripts/probe/exit.ts <file> <uuid> [from] [to]
import { fmtTime, loadReplay, parseBound, resolvePlayer } from "./_shared";

const [file, who, rawFrom, rawTo] = process.argv.slice(2);
if (!file) {
  console.error("Usage: npx tsx scripts/probe/exit.ts <file> <uuid> [from] [to]");
  process.exit(1);
}

const rep = loadReplay(file);
const { name, uuid, run } = resolvePlayer(rep, who);
const b = run.mark("bastion") ?? 0;
const l = run.mark("bastion_left") ?? run.end;
const from = parseBound(rawFrom, Math.max(0, l - 600), run.end, "seconds");
const to = parseBound(rawTo, Math.min(run.end, l + 400), run.end, "seconds");

console.log(`=== ${name} (${uuid}) positions & actions [${from}..${to}] (${fmtTime(from)}–${fmtTime(to)}) ===`);
console.log(`  marks: ${run.marks.map((m) => `${m.key}@${fmtTime(m.t)}(${m.t}t)`).join(" | ")}`);
void b;

for (let t = from; t <= to; t += 20) {
  const q = run.posAt(t);
  const moved = run.slice(t, t + 19).length;
  const acts = run.actions
    .filter((x) => x.t0 >= t && x.t0 < t + 20 && x.kind !== "damage")
    .map((x) => `${x.kind}${x.item ? ":" + x.item : x.what ? ":" + x.what : ""}`);
  console.log(`  ${fmtTime(t).padStart(5)} (${String(t).padStart(5)}t) [w${q.w}] ${Math.round(q.x)},${Math.round(q.y)},${Math.round(q.z)} (pts=${moved}) ${acts.join(" ")}`);
}
