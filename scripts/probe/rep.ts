import { analyzeRace } from "../../src/core/detect/analyze";
import { fmtTime, loadReplay, parseBound, probeArgs, resolvePlayer } from "./_shared";

const [file, who, arg3, arg4] = probeArgs("scripts/probe/rep.ts <file> <uuid> [from|them] [to]");
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

const timeOr = (ticks: number | null | undefined, missing: string) =>
  ticks != null ? fmtTime(ticks) : missing;
const secondsOrDash = (seconds: number | null) =>
  seconds !== null ? `${seconds.toFixed(1)}s` : "—";
const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;

const a = analyzeRace(rep, you.uuid, themUuid, { debugClaims: Boolean(process.env.CLAIMS), file });
console.log(
  `=== ${a.you.name} (${a.you.uuid}) vs ${a.them.name} (${a.them.uuid}) · finalGap ${signed(a.finalGap)}s ===`,
);
const splits = a.splits.map((s) => `${s.name}: ${timeOr(s.you, "—")} vs ${timeOr(s.them, "—")}`);
console.log("Splits:", splits.join(" | "));

const showSteps = process.env.STEPS || fromTick > 0 || toTick < Infinity;
for (const p of a.report) {
  const change = p.change !== null ? signed(p.change) : "—";
  const flags = `${p.unfinished ? " [unfinished]" : ""}${p.theirsEnded ? " [theirsEnded]" : ""}`;
  console.log(
    `\n### ${p.phase}  change ${change}  you ${secondsOrDash(p.you)}  them ${secondsOrDash(p.them)}${flags}`,
  );
  for (const w of p.why) {
    console.log(
      `  {${w.seconds.toFixed(0).padStart(4)}} ${w.label} [${timeOr(w.at?.you, "-")} / ${timeOr(w.at?.them, "-")}]: ${w.text}`,
    );
  }
  for (const n of p.notes) {
    const seconds = n.seconds === null ? "  " : n.seconds.toFixed(0).padStart(2);
    const at =
      n.at?.you != null || n.at?.them != null
        ? ` @(${timeOr(n.at?.you, "-")}/${timeOr(n.at?.them, "-")})`
        : "";
    console.log(`  [${seconds}] ${n.text}${at}`);
  }
  if (!showSteps) {
    continue;
  }
  for (const [side, steps] of [
    ["Y", p.steps.you],
    ["T", p.steps.them],
  ] as const) {
    for (const s of steps.filter((x) => x.t1 >= fromTick && x.t0 <= toTick)) {
      console.log(
        `    ${side} ${fmtTime(s.t0)}–${fmtTime(s.t1)} (${s.t0}..${s.t1}) [${s.kind}] ${s.text}`,
      );
    }
  }
}

if (process.env.CLAIMS && a.claims) {
  console.log(`\n=== Claims (${a.claims.length}) ===`);
  for (const c of a.claims) {
    console.log(
      `  [${c.phase}] ${c.line} :: ${c.claim} (ticks: ${c.evidenceTicks.slice(0, 8).join(",")})`,
    );
  }
}
