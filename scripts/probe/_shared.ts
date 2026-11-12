import { readFileSync } from "node:fs";
import { decodeRrf, type Replay, type ReplayEvent } from "../../src/core/replay/decode";
import { Run } from "../../src/core/detect/run";
import { fmtTime } from "../../src/core/detect/names";

export { fmtTime };

/** Returns the command line arguments, or exits with the usage line when the replay file is missing. */
export function probeArgs(usage: string): string[] {
  const args = process.argv.slice(2);
  if (!args[0]) {
    console.error(`Usage: npx tsx ${usage}`);
    process.exit(1);
  }
  return args;
}

export function loadReplay(file: string): Replay {
  return decodeRrf(new Uint8Array(readFileSync(file)));
}

export function resolvePlayer(
  rep: Replay,
  query?: string,
): { uuid: string; name: string; events: ReplayEvent[]; run: Run } {
  const players = [...rep.events.entries()].map(([uuid, events]) => {
    const name = rep.meta.players.find((p) => p.uuid === uuid)?.nickname ?? uuid;
    return { uuid, name, events };
  });
  if (!players.length) {
    throw new Error("No players in replay");
  }
  const player = query ? findPlayer(players, query) : players[0];
  return { ...player, run: new Run(player.uuid, player.name, player.events, rep.timelines) };
}

function findPlayer<P extends { uuid: string; name: string }>(players: P[], query: string): P {
  const q = query.toLowerCase();
  const match =
    players.find((p) => p.uuid.toLowerCase() === q) ??
    players.find((p) => p.name.toLowerCase() === q) ??
    players.find((p) => p.uuid.toLowerCase().startsWith(q)) ??
    players.find((p) => p.name.toLowerCase().startsWith(q));
  if (!match) {
    const available = players.map((p) => `${p.name} (${p.uuid})`).join(", ");
    throw new Error(`Player "${query}" not found. Available: ${available}`);
  }
  return match;
}

/** Converts a time bound to ticks: "3:20", "200s" and "4000t" are all 4000.
 *  A plain number uses defaultUnit, but in seconds mode a number past the run end plus 30 s counts as ticks. */
export function parseBound(
  raw: string | undefined,
  fallback: number,
  runEndTicks: number,
  defaultUnit: "ticks" | "seconds" = "ticks",
): number {
  if (!raw || raw === "-" || raw === "end") {
    return fallback;
  }
  const s = raw.trim().toLowerCase();
  if (s.includes(":")) {
    const [minutes, seconds] = s.split(":").map(Number);
    return Math.round((minutes * 60 + (seconds || 0)) * 20);
  }
  if (s.endsWith("t")) {
    return Math.round(Number(s.slice(0, -1)));
  }
  if (s.endsWith("s")) {
    return Math.round(Number(s.slice(0, -1)) * 20);
  }
  const n = Number(s);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  if (defaultUnit === "seconds" && n <= runEndTicks / 20 + 30) {
    return Math.round(n * 20);
  }
  return Math.round(n);
}
