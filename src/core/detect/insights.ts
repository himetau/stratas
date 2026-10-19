// Data for the patterns page from all your analysed races. Usual run per phase, habits that cost time,
// ends, deaths, best phase times and seed types you lose on most
import type { RaceAnalysis } from "./analyze";
import { cycleName } from "./end";
import { buildDeltaModel } from "./segments";

export interface InsightRace { id: number; name: string; createdAt: number; finalGap: number; seedType: string | null; analysis: RaceAnalysis }

export interface PhaseUsual { name: string; usual: number; you: number; them: number; races: number; lostIn: number }
export interface Habit {
  key: string; phase: string; title: string;
  /** Usual cost in seconds when it happens */
  usual: number;
  hits: number; outOf: number;
  /** Recent races where this could happen, oldest first. True = it cost you */
  dots: boolean[];
  trend: "better" | "worse" | "steady" | null;
  /** Clearest example to watch */
  example: { raceId: number; name: string; at: number | null; text: string };
}
export interface Insights {
  races: number; finished: number;
  /** Median gap at the end of finished races, + is behind */
  usual: number | null;
  recent: { id: number; name: string; gap: number; createdAt: number }[];
  phases: PhaseUsual[];
  habits: Habit[];
  end: { ends: number; zero: number; oneCycle: number; failed: number; notKilled: number; usualFight: number | null } | null;
  deaths: { races: number; deaths: number; seconds: number; resets: number };
  best: { name: string; you: number; raceId: number; vs: string }[];
  seeds: { kind: "overworld" | "bastion"; type: string; usual: number; races: number }[];
}

/** Causes that count as a habit. Anything not here (aiming a bow, idle etc) isn't one */
const HABITS: Record<string, { phase: string; title: string }> = {
  "Overworld|step:travel": { phase: "Overworld", title: "Slower through the overworld" },
  "Overworld|step:craft": { phase: "Overworld", title: "Crafting takes longer" },
  "Overworld|step:mine": { phase: "Overworld", title: "Mining takes longer" },
  "Overworld|step:portal": { phase: "Overworld", title: "Building the nether portal" },
  "Nether travel|route": { phase: "Nether", title: "Longer way to the bastion" },
  "Nether travel|speed": { phase: "Nether", title: "Slower way to the bastion" },
  "Bastion|pre": { phase: "Bastion", title: "Slow to start trading" },
  "Bastion|trading": { phase: "Bastion", title: "Trading takes longer" },
  "Bastion|after": { phase: "Bastion", title: "Slow to leave after trading" },
  "Bastion to fortress|route": { phase: "To fortress", title: "Longer way to the fortress" },
  "Bastion to fortress|speed": { phase: "To fortress", title: "Slower way to the fortress" },
  "Bastion to fortress|stop:Menus": { phase: "To fortress", title: "Menus on the way to the fortress" },
  "Fortress to stronghold|rods": { phase: "Fortress", title: "Getting rods takes longer" },
  "Fortress to stronghold|step:portal": { phase: "Blind", title: "Building the blind portal" },
  "Fortress to stronghold|to_stronghold": { phase: "To stronghold", title: "Longer trip to the stronghold" },
  "Stronghold|step:travel": { phase: "Stronghold", title: "Finding the portal room" },
  "End|end_kill": { phase: "End", title: "Killing the dragon takes longer" },
};
const MIN_LOSS = 5;

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/** Race page phase names with the fortress parts and similar folded together */
const SHORT: Record<string, string> = { "To Fort": "To fortress", "To Bastion": "To bastion", "Run End": "" };
const phaseName = (segShort: string) => SHORT[segShort] ?? segShort.charAt(0).toUpperCase() + segShort.slice(1).toLowerCase();

export function buildInsights(all: InsightRace[]): Insights {
  const races = [...all].filter((r) => r.analysis?.report).sort((a, b) => a.createdAt - b.createdAt);
  const finished = races.filter((r) => r.analysis.you.finished && r.analysis.them.finished);

  // ---- usual run, phase by phase in order
  const per = new Map<string, { you: number[]; them: number[]; delta: number[]; order: number; runs: { you: number; raceId: number; vs: string }[] }>();
  for (const r of races) {
    const merged: { name: string; you: number; them: number; delta: number }[] = [];
    for (const s of buildDeltaModel(r.analysis).segments) {
      const name = phaseName(s.segShort);
      if (!name) continue;
      const last = merged.at(-1);
      if (last && last.name === name) { last.you += s.youDur; last.them += s.themDur; last.delta += s.segDelta; }
      else merged.push({ name, you: s.youDur, them: s.themDur, delta: s.segDelta });
    }
    merged.forEach((m, i) => {
      const x = per.get(m.name) ?? { you: [], them: [], delta: [], order: i, runs: [] };
      x.you.push(m.you); x.them.push(m.them); x.delta.push(m.delta); x.order = Math.max(x.order, i);
      x.runs.push({ you: m.you, raceId: r.id, vs: r.name });
      per.set(m.name, x);
    });
  }
  const ORDER = ["Overworld", "Nether", "Bastion", "To fortress", "Fortress", "Blind", "To stronghold", "Stronghold", "End"];
  const rank = (n: string) => (ORDER.includes(n) ? ORDER.indexOf(n) : 50 + (per.get(n)?.order ?? 0));
  const names = [...per.keys()].filter((n) => per.get(n)!.delta.length >= 2).sort((a, b) => rank(a) - rank(b));
  const phases: PhaseUsual[] = names.map((n) => {
    const x = per.get(n)!;
    return { name: n, usual: median(x.delta), you: median(x.you), them: median(x.them), races: x.delta.length, lostIn: x.delta.filter((d) => d > 2).length };
  });
  // Best time per phase. A phase cut short (death, other route) isn't a real best so only count times at least half your usual
  const best = names.map((n) => {
    const runs = per.get(n)!.runs, usual = median(runs.map((x) => x.you));
    const ok = runs.filter((x) => x.you >= usual * 0.5);
    return ok.length ? { name: n, ...ok.reduce((m, x) => (x.you < m.you ? x : m)) } : null;
  }).filter((b): b is NonNullable<typeof b> => !!b);

  // ---- habits, a cause that cost 5+ s in at least a third of the races where it could happen
  const seen = new Map<string, { raceId: number; seconds: number; at: number | null; text: string; name: string }[]>();
  for (const r of races) for (const p of r.analysis.report) {
    if (p.change === null) continue;
    for (const w of p.why ?? []) {
      const k = `${p.phase}|${w.key}`;
      if (!HABITS[k]) continue;
      seen.set(k, [...(seen.get(k) ?? []), { raceId: r.id, seconds: w.seconds, at: w.at?.you ?? null, text: w.text, name: r.name }]);
    }
  }
  const habits: Habit[] = [];
  for (const [k, xs] of seen) {
    const lost = xs.filter((x) => x.seconds >= MIN_LOSS);
    if (lost.length < 2 || lost.length < xs.length / 3) continue;
    const worst = lost.reduce((m, x) => (x.seconds > m.seconds ? x : m));
    // Better or worse, newer races vs older ones
    const half = Math.floor(xs.length / 2), older = median(xs.slice(0, half).map((x) => Math.max(0, x.seconds))), newer = median(xs.slice(half).map((x) => Math.max(0, x.seconds)));
    const trend = xs.length < 4 ? null : newer < older * 0.7 - 2 ? "better" : newer > older * 1.3 + 2 ? "worse" : "steady";
    habits.push({ key: k, ...HABITS[k], usual: median(lost.map((x) => x.seconds)), hits: lost.length, outOf: xs.length,
      dots: xs.slice(-8).map((x) => x.seconds >= MIN_LOSS), trend,
      example: { raceId: worst.raceId, name: worst.name, at: worst.at, text: worst.text.replace(/ · /g, ", ") } });
  }
  // Cost per race = how often * how much
  habits.sort((a, b) => (b.hits / b.outOf) * b.usual - (a.hits / a.outOf) * a.usual);

  // ---- the end, zero cycles, one cycles, failed cycles
  const fights = races.map((r) => r.analysis.end?.you).filter((f): f is NonNullable<typeof f> => !!f);
  const killed = fights.filter((f) => f.kill !== null);
  const end = fights.length ? {
    ends: fights.length,
    zero: fights.filter((f) => f.zero).length,
    oneCycle: fights.filter((f) => cycleName(f) === "one cycle").length,
    // Zero cycle try the dragon survived, or a bedded perch it flew off from
    failed: fights.filter((f) => (f.zeroBeds > 0 && !f.zero) || f.perches.some((p) => !p.killed && p.beds > 0)).length,
    notKilled: fights.length - killed.length,
    usualFight: killed.length ? median(killed.map((f) => (f.kill! - f.start) / 20)) : null,
  } : null;

  // ---- deaths, not counting death resets (on purpose)
  let deaths = 0, deadFor = 0, resets = 0;
  const raceSet = new Set<number>();
  for (const r of races) for (const p of r.analysis.report) for (const s of p.steps?.you ?? []) {
    if (s.kind !== "death") continue;
    if (s.text === "Died") { deaths++; deadFor += (s.t1 - s.t0) / 20; raceSet.add(r.id); } else resets++;
  }

  // ---- seed types you lose most on
  const bySeed = new Map<string, number[]>();
  for (const r of races) {
    const [ow, bastion] = (r.seedType ?? "").toLowerCase().split(" / ").map((x) => x.trim().replace(/_/g, " "));
    if (ow) bySeed.set(`overworld|${ow}`, [...(bySeed.get(`overworld|${ow}`) ?? []), r.finalGap]);
    if (bastion) bySeed.set(`bastion|${bastion}`, [...(bySeed.get(`bastion|${bastion}`) ?? []), r.finalGap]);
  }
  const seeds = [...bySeed].filter(([, g]) => g.length >= 2)
    .map(([k, g]) => ({ kind: k.split("|")[0] as "overworld" | "bastion", type: k.split("|")[1], usual: median(g), races: g.length }))
    .sort((a, b) => b.usual - a.usual);

  return {
    races: races.length, finished: finished.length,
    usual: finished.length ? median(finished.map((r) => r.finalGap)) : null,
    recent: races.slice(-14).map((r) => ({ id: r.id, name: r.name, gap: r.finalGap, createdAt: r.createdAt })),
    phases, habits, end, deaths: { races: raceSet.size, deaths, seconds: deadFor, resets }, best, seeds,
  };
}
