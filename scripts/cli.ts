// CLI into the core for testing and quick checks
//   node dist/cli.cjs analyze <replay.rrf> <you> [them]
//   node dist/cli.cjs race <your.rrf> <you> <their.rrf> <them> [out.rrf]
//   node dist/cli.cjs seed <replay.rrf>
import { readFileSync, writeFileSync } from "node:fs";
import { decodeRrf, readRrf, type ReplayMeta } from "../src/core/replay/decode";
import { mergeRunners } from "../src/core/replay/merge";
import { analyzeRace, type RaceAnalysis } from "../src/core/detect/analyze";
import { fmtTime } from "../src/core/detect/names";

const uuidOf = (meta: ReplayMeta, name: string) => {
  const p = meta.players.find((x) => x.nickname.toLowerCase() === name.toLowerCase() || x.uuid === name);
  if (!p) throw new Error(`${name} is not in this replay (${meta.players.map((x) => x.nickname).join(", ")})`);
  return p.uuid;
};

export function printAnalysis(a: RaceAnalysis) {
  console.log(`${a.you.name} vs ${a.them.name}: ${a.finalGap >= 0 ? `${Math.round(a.finalGap)} s behind` : `${Math.round(-a.finalGap)} s ahead`} ` +
    `(${a.matchedSeconds}/${a.totalSeconds} s matched by place)`);
  console.log("splits:", a.splits.map((s) => `${s.name} ${s.you !== null ? fmtTime(s.you) : "—"}/${s.them !== null ? fmtTime(s.them) : "—"}`).join(" | "));
  for (const [title, list] of [["WHERE YOU LOST TIME", a.losses], ["WHERE YOU GAINED TIME", a.gains]] as const) {
    console.log(`\n== ${title}`);
    for (const f of list) {
      console.log(`\n${f.headline}${f.jump ? "  [no shared path]" : ""}`);
      console.log(`   you ${fmtTime(f.you[0])}–${fmtTime(f.you[1])} | them ${fmtTime(f.them[0])}–${fmtTime(f.them[1])} | ` +
        `Align Splits: ${f.watch.alignFrom} → ${f.watch.alignTo}; ${f.watch.camera}`);
      for (const c of f.causes) console.log(`   ${c.seconds >= 0 ? "+" : "−"}${Math.abs(Math.round(c.seconds)).toString().padStart(3)} s  ${c.text}`);
      for (const n of f.notes) console.log(`          · ${n}`);
    }
  }
}

function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "analyze") {
    const r = decodeRrf(new Uint8Array(readFileSync(args[0])));
    const you = uuidOf(r.meta, args[1]);
    const them = args[2] ? uuidOf(r.meta, args[2]) : r.meta.players.find((p) => p.uuid !== you)!.uuid;
    const t = performance.now();
    const a = analyzeRace(r, you, them);
    printAnalysis(a);
    console.log(`\n(${Math.round(performance.now() - t)} ms)`);
  } else if (cmd === "race") {
    const [yf, yn, tf, tn, out = "race.rrf"] = args;
    const yb = new Uint8Array(readFileSync(yf)), tb = new Uint8Array(readFileSync(tf));
    const m = mergeRunners([{ bytes: yb, uuid: uuidOf(readRrf(yb).meta, yn) }, { bytes: tb, uuid: uuidOf(readRrf(tb).meta, tn) }]);
    writeFileSync(out, m.bytes);
    console.log(`wrote ${out}`);
  } else if (cmd === "seed") {
    const { meta } = readRrf(new Uint8Array(readFileSync(args[0])));
    console.log(`overworld ${meta.overworldSeed}\nnether    ${meta.netherSeed}`);
  } else {
    console.log("usage: analyze <rrf> <you> [them] | race <your.rrf> <you> <their.rrf> <them> [out] | seed <rrf>");
    process.exit(1);
  }
}

main();
