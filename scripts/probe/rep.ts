// Full phase report for a replay. npx tsx scripts/probe/rep.ts <file> <uuid> [from|them] [to]
import { analyzeRace } from "../../src/core/detect/analyze";
import { fmtTime, loadReplay, parseBound, resolvePlayer } from "./_shared";

const [file, who, arg3, arg4] = process.argv.slice(2);
if (!file) {
  console.error("Usage: npx tsx scripts/probe/rep.ts <file> <uuid> [from|them] [to]");
  process.exit(1);
}

const rep = loadReplay(file);
const you = resolvePlayer(rep, who);
const allUuids = [...rep.events.keys()];
let themUuid = allUuids.find((u) => u !== you.uuid) ?? you.uuid;
let fromTick = 0;
let toTick = Infinity;

if (arg3) {
  try {
    const maybeThem = resolvePlayer(rep, arg3);
    if (maybeThem.uuid !== you.uuid || allUuids.length === 1) {
      themUuid = maybeThem.uuid;
    }
  } catch {
    fromTick = parseBound(arg3, 0, you.run.end, "ticks");
    toTick = parseBound(arg4, you.run.end, you.run.end, "ticks");
  }
}

const a = analyzeRace(rep, you.uuid, themUuid, { debugClaims: Boolean(process.env.CLAIMS), file });
console.log(`=== ${a.you.name} (${a.you.uuid}) vs ${a.them.name} (${a.them.uuid}) · finalGap ${a.finalGap >= 0 ? "+" : ""}${a.finalGap.toFixed(1)}s ===`);
console.log("Splits:", a.splits.map((s) => `${s.name}: ${s.you !== null ? fmtTime(s.you) : "—"} vs ${s.them !== null ? fmtTime(s.them) : "—"}`).join(" | "));

for (const p of a.report) {
  const sp = you.run.marks;
  void sp;
  console.log(`\n### ${p.phase}  change ${p.change !== null ? (p.change >= 0 ? "+" : "") + p.change.toFixed(1) : "—"}  you ${p.you !== null ? p.you.toFixed(1) + "s" : "—"}  them ${p.them !== null ? p.them.toFixed(1) + "s" : "—"}${p.unfinished ? " [unfinished]" : ""}${p.theirsEnded ? " [theirsEnded]" : ""}`);
  for (const w of p.why) {
    console.log(`  {${w.seconds.toFixed(0).padStart(4)}} ${w.label} [${w.at?.you != null ? fmtTime(w.at.you) : "-"} / ${w.at?.them != null ? fmtTime(w.at.them) : "-"}]: ${w.text}`);
  }
  for (const n of p.notes) {
    console.log(`  [${n.seconds === null ? "  " : n.seconds.toFixed(0).padStart(2)}] ${n.text}${n.at?.you != null || n.at?.them != null ? ` @(${n.at?.you != null ? fmtTime(n.at.you) : "-"}/${n.at?.them != null ? fmtTime(n.at.them) : "-"})` : ""}`);
  }
  if (process.env.STEPS || fromTick > 0 || toTick < Infinity) {
    for (const s of p.steps.you.filter((x) => x.t1 >= fromTick && x.t0 <= toTick)) {
      console.log(`    Y ${fmtTime(s.t0)}–${fmtTime(s.t1)} (${s.t0}..${s.t1}) [${s.kind}] ${s.text}`);
    }
    for (const s of p.steps.them.filter((x) => x.t1 >= fromTick && x.t0 <= toTick)) {
      console.log(`    T ${fmtTime(s.t0)}–${fmtTime(s.t1)} (${s.t0}..${s.t1}) [${s.kind}] ${s.text}`);
    }
  }
}

if (process.env.CLAIMS && a.claims) {
  console.log(`\n=== Claims (${a.claims.length}) ===`);
  for (const c of a.claims) {
    console.log(`  [${c.phase}] ${c.line} :: ${c.claim} (ticks: ${c.evidenceTicks.slice(0, 8).join(",")})`);
  }
}
