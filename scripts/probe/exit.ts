import { fmtTime, loadReplay, parseBound, probeArgs, resolvePlayer } from "./_shared";

const [file, who, rawFrom, rawTo] = probeArgs("scripts/probe/exit.ts <file> <uuid> [from] [to]");
const rep = loadReplay(file);
const { name, uuid, run } = resolvePlayer(rep, who);
const bastionLeft = run.mark("bastion_left") ?? run.end;
const from = parseBound(rawFrom, Math.max(0, bastionLeft - 600), run.end, "seconds");
const to = parseBound(rawTo, Math.min(run.end, bastionLeft + 400), run.end, "seconds");

console.log(
  `=== ${name} (${uuid}) positions & actions [${from}..${to}] (${fmtTime(from)}–${fmtTime(to)}) ===`,
);
console.log(`  marks: ${run.marks.map((m) => `${m.key}@${fmtTime(m.t)}(${m.t}t)`).join(" | ")}`);

for (let t = from; t <= to; t += 20) {
  const pos = run.posAt(t);
  const moved = run.slice(t, t + 19).length;
  const actions = run.actions
    .filter((a) => a.t0 >= t && a.t0 < t + 20 && a.kind !== "damage")
    .map((a) => {
      const detail = a.item || a.what;
      return detail ? `${a.kind}:${detail}` : a.kind;
    });
  console.log(
    `  ${fmtTime(t).padStart(5)} (${String(t).padStart(5)}t) [w${pos.w}] ${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)} (pts=${moved}) ${actions.join(" ")}`,
  );
}
