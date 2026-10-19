// Shared helpers for the scripts/probe/*.ts scripts
import { readFileSync } from "node:fs";
import { decodeRrf, type Replay, type ReplayEvent } from "../../src/core/replay/decode";
import { Run } from "../../src/core/detect/run";
import { fmtTime } from "../../src/core/detect/names";

export { fmtTime };

export function loadReplay(file: string): Replay {
  return decodeRrf(new Uint8Array(readFileSync(file)));
}

export function resolvePlayer(rep: Replay, query?: string): { uuid: string; name: string; events: ReplayEvent[]; run: Run } {
  const entries = [...rep.events.entries()].map(([uuid, events]) => {
    const p = rep.meta.players.find((x) => x.uuid === uuid);
    const name = p?.nickname ?? uuid;
    return { uuid, name, events };
  });
  if (!entries.length) throw new Error("No players in replay");
  if (!query) {
    const e = entries[0];
    return { ...e, run: new Run(e.uuid, e.name, e.events, rep.timelines) };
  }
  const q = query.toLowerCase();
  const match =
    entries.find((e) => e.uuid.toLowerCase() === q) ??
    entries.find((e) => e.name.toLowerCase() === q) ??
    entries.find((e) => e.uuid.toLowerCase().startsWith(q)) ??
    entries.find((e) => e.name.toLowerCase().startsWith(q));
  if (!match) {
    throw new Error(`Player "${query}" not found. Available: ${entries.map((e) => `${e.name} (${e.uuid})`).join(", ")}`);
  }
  return { ...match, run: new Run(match.uuid, match.name, match.events, rep.timelines) };
}

/** Time bound to ticks. "3:20", "200s" and "4000t" are all 4000. Plain numbers use defaultUnit,
 * except in seconds mode anything past the run end (+30s) is taken as ticks */
export function parseBound(raw: string | undefined, fallback: number, runEndTicks: number, defaultUnit: "ticks" | "seconds" = "ticks"): number {
  if (!raw || raw === "-" || raw === "end") return fallback;
  const s = raw.trim().toLowerCase();
  if (s.includes(":")) {
    const [m, sec] = s.split(":").map(Number);
    return Math.round((m * 60 + (sec || 0)) * 20);
  }
  if (s.endsWith("t")) return Math.round(Number(s.slice(0, -1)));
  if (s.endsWith("s")) return Math.round(Number(s.slice(0, -1)) * 20);
  const n = Number(s);
  if (!Number.isFinite(n)) return fallback;
  if (defaultUnit === "seconds") {
    return n > runEndTicks / 20 + 30 ? Math.round(n) : Math.round(n * 20);
  }
  return Math.round(n);
}
