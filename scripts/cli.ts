import { readFileSync, writeFileSync } from "node:fs";
import { decodeRrf, readRrf, type ReplayMeta } from "../src/core/replay/decode";
import { mergeRunners } from "../src/core/replay/merge";
import { repairReplay } from "../src/core/replay/size";
import { analyzeRace, type RaceAnalysis } from "../src/core/detect/analyze";
import { fmtTime } from "../src/core/detect/names";

const USAGE =
  "usage: analyze <rrf> <you> [them] | race <your.rrf> <you> <their.rrf> <them> [out] | repair <mixed.rrf> <original.rrf> <out.rrf> | seed <rrf>";

function readBytes(file: string): Uint8Array {
  return new Uint8Array(readFileSync(file));
}

function uuidOf(meta: ReplayMeta, name: string): string {
  const player = meta.players.find(
    (p) => p.nickname.toLowerCase() === name.toLowerCase() || p.uuid === name,
  );
  if (!player) {
    const names = meta.players.map((p) => p.nickname).join(", ");
    throw new Error(`${name} is not in this replay (${names})`);
  }
  return player.uuid;
}

function timeOrDash(ticks: number | null): string {
  return ticks !== null ? fmtTime(ticks) : "—";
}

function gapText(finalGap: number): string {
  if (finalGap >= 0) {
    return `${Math.round(finalGap)} s behind`;
  }
  return `${Math.round(-finalGap)} s ahead`;
}

function printAnalysis(a: RaceAnalysis) {
  console.log(
    `${a.you.name} vs ${a.them.name}: ${gapText(a.finalGap)} ` +
      `(${a.matchedSeconds}/${a.totalSeconds} s matched by place)`,
  );
  const splits = a.splits.map((s) => `${s.name} ${timeOrDash(s.you)}/${timeOrDash(s.them)}`);
  console.log("splits:", splits.join(" | "));
  for (const [title, findings] of [
    ["WHERE YOU LOST TIME", a.losses],
    ["WHERE YOU GAINED TIME", a.gains],
  ] as const) {
    console.log(`\n== ${title}`);
    for (const f of findings) {
      console.log(`\n${f.headline}${f.jump ? "  [no shared path]" : ""}`);
      console.log(
        `   you ${fmtTime(f.you[0])}–${fmtTime(f.you[1])} | them ${fmtTime(f.them[0])}–${fmtTime(f.them[1])} | ` +
          `Align Splits: ${f.watch.alignFrom} → ${f.watch.alignTo}; ${f.watch.camera}`,
      );
      for (const c of f.causes) {
        const sign = c.seconds >= 0 ? "+" : "−";
        const seconds = Math.abs(Math.round(c.seconds)).toString().padStart(3);
        console.log(`   ${sign}${seconds} s  ${c.text}`);
      }
      for (const n of f.notes) {
        console.log(`          · ${n}`);
      }
    }
  }
}

function analyzeCommand([file, youName, themName]: string[]) {
  const replay = decodeRrf(readBytes(file));
  const you = uuidOf(replay.meta, youName);
  const them = themName
    ? uuidOf(replay.meta, themName)
    : replay.meta.players.find((p) => p.uuid !== you)?.uuid;
  if (!them) {
    throw new Error("this replay has no other player to compare with");
  }
  const started = performance.now();
  printAnalysis(analyzeRace(replay, you, them));
  console.log(`\n(${Math.round(performance.now() - started)} ms)`);
}

function raceCommand([yourFile, youName, theirFile, themName, out = "race.rrf"]: string[]) {
  const yours = readBytes(yourFile);
  const theirs = readBytes(theirFile);
  const merged = mergeRunners(
    [
      { bytes: yours, uuid: uuidOf(readRrf(yours).meta, youName) },
      { bytes: theirs, uuid: uuidOf(readRrf(theirs).meta, themName) },
    ],
    { matchSourceSize: true },
  );
  writeFileSync(out, merged.bytes);
  console.log(`wrote ${out}`);
}

function repairCommand([mixed, original, out]: string[]) {
  if (!mixed || !original || !out) {
    throw new Error("usage: repair <mixed.rrf> <original.rrf> <out.rrf>");
  }
  const bytes = repairReplay(readBytes(mixed), readBytes(original));
  // decodeRrf throws on records it cannot decode, so a broken replay is never written.
  decodeRrf(bytes);
  writeFileSync(out, bytes, { flag: "wx" });
  console.log(`wrote ${out} (replay.rpd: ${readRrf(bytes).rpd.length} bytes)`);
}

function seedCommand([file]: string[]) {
  const { meta } = readRrf(readBytes(file));
  console.log(`overworld ${meta.overworldSeed}\nnether    ${meta.netherSeed}`);
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "analyze":
      analyzeCommand(args);
      break;
    case "race":
      raceCommand(args);
      break;
    case "repair":
      repairCommand(args);
      break;
    case "seed":
      seedCommand(args);
      break;
    default:
      console.log(USAGE);
      process.exit(1);
  }
}

main();
