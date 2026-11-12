import type { RaceAnalysis } from "../detect/analyze";
import type { Note } from "../detect/findings";
import type { Part } from "../detect/why";
import { computeTrends, median } from "../features";
import type { RaceRow } from "../store";
import type { CauseLossStat, MechanicFreqStat, PhaseLossStat, ReplayTrends } from "./types";

const CANONICAL_PHASE_ORDER = [
  "Overworld",
  "Nether travel",
  "Bastion",
  "Bastion to fortress",
  "Fortress",
  "Fortress to stronghold",
  "Bastion to blind",
  "After the bastion",
  "Stronghold",
  "End",
] as const;

const MAX_TOP_CAUSES = 12;

interface AnalyzedRace {
  row: RaceRow;
  analysis: RaceAnalysis;
}

interface MechanicClassification {
  key: string;
  label: string;
  phase: string;
}

interface MechanicMatcher {
  key: string;
  label: string;
  phases?: string[];
  match: (text: string) => boolean;
}

const MECHANIC_MATCHERS: MechanicMatcher[] = [
  // These match notes from the mechanics registered in src/core/detect/mechanics/index.ts.
  {
    key: "overworld_lava_portal",
    label: "Lava portal build",
    phases: ["Overworld"],
    match: (t) => /^lava portal build\b/i.test(t),
  },
  {
    key: "overworld_ruined_portal",
    label: "Ruined portal frame",
    phases: ["Overworld"],
    match: (t) => /^ruined portal frame\b/i.test(t),
  },
  {
    key: "overworld_buried_treasure",
    label: "Buried treasure",
    phases: ["Overworld"],
    match: (t) => /^buried treasure\b/i.test(t),
  },
  {
    key: "overworld_shipwreck",
    label: "Shipwreck",
    phases: ["Overworld"],
    match: (t) => /^shipwreck\b/i.test(t),
  },
  {
    key: "overworld_village",
    label: "Village / iron golem",
    phases: ["Overworld"],
    match: (t) => /^iron golem killed\b|\bvillage\b/i.test(t),
  },
  {
    key: "overworld_desert_temple",
    label: "Desert temple",
    phases: ["Overworld"],
    match: (t) => /^temple chests\b|\bdesert temple\b/i.test(t),
  },
  {
    key: "overworld_iron_pickaxe",
    label: "Pickaxe timing",
    phases: ["Overworld"],
    match: (t) => /^(iron|golden|diamond) pickaxe\b/i.test(t),
  },
  {
    key: "nether_bridging",
    label: "Blocks placed on the way",
    match: (t) => /^blocks placed on the way\b/i.test(t),
  },
  {
    key: "bastion_gold_blocks",
    label: "Gold blocks",
    phases: ["Bastion"],
    match: (t) =>
      /^gold blocks(?: mined)?:|\bmined gold block\b|\bacquired \d+ gold block/i.test(t),
  },
  {
    key: "pearl_hangs",
    label: "Pearl hang",
    match: (t) => /^pearl hang:/i.test(t),
  },
  {
    key: "stronghold_nav",
    label: "Stronghold navigation",
    phases: ["Stronghold", "Fortress to stronghold"],
    match: (t) => /\bin the stronghold:/i.test(t),
  },
  // These match the phase notes from src/core/detect/findings.ts.
  {
    key: "death_you",
    label: "Death",
    match: (t) => /^died\b/i.test(t),
  },
  {
    key: "death_them",
    label: "Opponent death",
    match: (t) => /^.+ died\s*\(/i.test(t) && !/^died\b/i.test(t),
  },
  {
    key: "bastion_piglins_angry",
    label: "Piglins angry",
    phases: ["Bastion"],
    match: (t) => /piglins angry/i.test(t),
  },
  {
    key: "bastion_leave_potential",
    label: "Bastion leave potential",
    phases: ["Bastion"],
    match: (t) => /^could have left:/i.test(t),
  },
  {
    key: "bastion_while_trading",
    label: "Activity while trading",
    phases: ["Bastion"],
    match: (t) => /^while trading:/i.test(t),
  },
  {
    key: "fortress_rods",
    label: "6 blaze rods",
    phases: ["Fortress", "Fortress to stronghold"],
    match: (t) => /^6 rods:/i.test(t),
  },
  {
    key: "blind_rods",
    label: "Blind rod / eye count",
    phases: ["Fortress to stronghold"],
    match: (t) => /^blinded with\b/i.test(t),
  },
  {
    key: "stronghold_eyes",
    label: "Eyes thrown / broken",
    phases: ["Stronghold", "Fortress to stronghold"],
    match: (t) => /^eyes:/i.test(t),
  },
  {
    key: "end_beds",
    label: "End beds used",
    phases: ["End"],
    match: (t) => /^dragon:/i.test(t),
  },
];

const round1 = (n: number): number => Math.round(n * 10) / 10;

const sum = (xs: number[]): number => xs.reduce((acc, v) => acc + v, 0);

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

function isMatchRaceRow(r: RaceRow): boolean {
  return r.your_file === r.their_file || r.key.startsWith("match|");
}

function parseAnalyzedRace(row: RaceRow): AnalyzedRace | null {
  if (row.error || !row.analysis) {
    return null;
  }
  try {
    const analysis = JSON.parse(row.analysis) as RaceAnalysis;
    if (!analysis || !Array.isArray(analysis.report)) {
      return null;
    }
    return { row, analysis };
  } catch {
    return null;
  }
}

function phaseOrderIndex(phase: string): number {
  const idx = CANONICAL_PHASE_ORDER.indexOf(phase as (typeof CANONICAL_PHASE_ORDER)[number]);
  return idx >= 0 ? idx : CANONICAL_PHASE_ORDER.length;
}

/** Groups a note no matcher knows by its text with times and counts stripped. */
function genericNoteClass(phase: string, text: string): MechanicClassification {
  const colonIdx = text.indexOf(":");
  const head =
    colonIdx > 0 && colonIdx <= 36 && !/^\d+:\d\d/.test(text) ? text.slice(0, colonIdx) : text;
  const cleaned = head
    .replace(/\b\d+:\d\d(?:–\d+:\d\d)?\b/g, "")
    .replace(
      /\b\d+(?:\.\d+)?\s*(?:s|blocks?|chests?|rods?|eyes?|beds?|trades?|piglins?|times?|tnt|iron|lava|water)\b/gi,
      "",
    )
    .replace(/\b\d+\b/g, "")
    .replace(/[()·,~—–-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const labelBase = cleaned || "Other note";
  return {
    key: `note_${slugify(phase)}_${slugify(labelBase) || "other"}`,
    label: labelBase.charAt(0).toUpperCase() + labelBase.slice(1),
    phase,
  };
}

function classifyNote(phase: string, note: Note): MechanicClassification | null {
  const text = (note.text ?? "").trim();
  if (!text) {
    return null;
  }
  // A note can land in the phase next to the one its matcher lists, so any phase matches second.
  const matcher =
    MECHANIC_MATCHERS.find((m) => (!m.phases || m.phases.includes(phase)) && m.match(text)) ??
    MECHANIC_MATCHERS.find((m) => m.match(text));
  if (matcher) {
    return { key: matcher.key, label: matcher.label, phase };
  }
  return genericNoteClass(phase, text);
}

function classifyWhyMechanic(
  phase: string,
  w: Part,
): { key: string; label: string; text: string } | null {
  const knownMechanic = MECHANIC_MATCHERS.find((m) => m.key === w.key);
  if (knownMechanic) {
    return { key: knownMechanic.key, label: knownMechanic.label, text: w.text };
  }
  if (w.key === "back" && w.seconds > 0) {
    return { key: "stronghold_backtrack", label: "Back in the Nether after blind", text: w.text };
  }
  if (w.key === "stop:Pie chart" && w.seconds > 0) {
    return { key: "pie_chart", label: "Pie chart usage", text: `${w.label}: ${w.text}` };
  }
  if (phase !== "Bastion" || w.key !== "trading") {
    return null;
  }
  if (/\d+\s+stuck\b/i.test(w.text)) {
    return { key: "bastion_piglins_stuck", label: "Piglins stuck on gold", text: w.text };
  }
  if (/no piglin trading/i.test(w.text) && w.seconds > 0) {
    return { key: "bastion_trade_stall", label: "Bastion trade stall", text: w.text };
  }
  return null;
}

/** Analysed Ranked matches oldest first, or every analysed race when there are no matches. */
function selectAnalyzedRaces(races: RaceRow[]): AnalyzedRace[] {
  const allParsed = races.map(parseAnalyzedRace).filter((x): x is AnalyzedRace => x !== null);
  const matchParsed = allParsed.filter((x) => isMatchRaceRow(x.row));
  return (matchParsed.length > 0 ? matchParsed : allParsed).sort(
    (a, b) => a.row.created_at - b.row.created_at || a.row.id - b.row.id,
  );
}

function phaseLosses(analyzed: AnalyzedRace[]): PhaseLossStat[] {
  const buckets = new Map<
    string,
    { changes: number[]; worstRaceId: number | null; worstLossSeconds: number | null }
  >();

  for (const { row, analysis } of analyzed) {
    for (const p of analysis.report ?? []) {
      if (typeof p.change !== "number" || !Number.isFinite(p.change)) {
        continue;
      }
      const bucket = buckets.get(p.phase) ?? {
        changes: [],
        worstRaceId: null,
        worstLossSeconds: null,
      };
      bucket.changes.push(round1(p.change));
      if (
        p.change > 0 &&
        (bucket.worstLossSeconds === null || p.change > bucket.worstLossSeconds)
      ) {
        bucket.worstLossSeconds = p.change;
        bucket.worstRaceId = row.id;
      }
      buckets.set(p.phase, bucket);
    }
  }

  const phases: PhaseLossStat[] = [...buckets].map(([phase, bucket]) => {
    const total = sum(bucket.changes);
    return {
      phase,
      races: bucket.changes.length,
      averageLostSeconds: round1(total / bucket.changes.length),
      medianLostSeconds: round1(median(bucket.changes)),
      totalLostSeconds: round1(total),
      history: bucket.changes,
      worstRaceId: bucket.worstRaceId,
      worstLossSeconds: bucket.worstLossSeconds !== null ? round1(bucket.worstLossSeconds) : null,
    };
  });

  return phases.sort(
    (a, b) =>
      b.averageLostSeconds - a.averageLostSeconds ||
      phaseOrderIndex(a.phase) - phaseOrderIndex(b.phase),
  );
}

/** The `why` causes that cost the most seconds in total. */
function topCauses(analyzed: AnalyzedRace[]): CauseLossStat[] {
  const buckets = new Map<
    string,
    {
      phase: string;
      label: string;
      losses: number[];
      worstRaceId: number;
      worstOpponent: string;
      worstSeconds: number;
      worstAtTick: number | undefined;
      worstText: string;
    }
  >();

  for (const { row, analysis } of analyzed) {
    for (const p of analysis.report ?? []) {
      for (const w of p.why ?? []) {
        if (w.key === "step:other" || w.key === "rest") {
          continue;
        }
        if (typeof w.seconds !== "number" || !Number.isFinite(w.seconds) || w.seconds <= 0) {
          continue;
        }
        const key = `${p.phase}|${w.label}`;
        const worst = {
          worstRaceId: row.id,
          worstOpponent: row.their_name,
          worstSeconds: w.seconds,
          worstAtTick: w.at?.you ?? w.at?.them,
          worstText: w.text,
        };
        const existing = buckets.get(key);
        if (!existing) {
          buckets.set(key, { phase: p.phase, label: w.label, losses: [w.seconds], ...worst });
          continue;
        }
        existing.losses.push(w.seconds);
        if (w.seconds > existing.worstSeconds) {
          Object.assign(existing, worst);
        }
      }
    }
  }

  return [...buckets]
    .map(([key, c]) => {
      const total = sum(c.losses);
      return {
        key,
        phase: c.phase,
        label: c.label,
        occurrences: c.losses.length,
        totalSeconds: round1(total),
        averageSeconds: round1(total / c.losses.length),
        medianSeconds: round1(median(c.losses)),
        worstRaceId: c.worstRaceId,
        worstOpponent: c.worstOpponent,
        worstSeconds: round1(c.worstSeconds),
        ...(c.worstAtTick !== undefined ? { worstAtTick: c.worstAtTick } : {}),
        worstText: c.worstText,
      };
    })
    .sort(
      (a, b) =>
        b.totalSeconds - a.totalSeconds ||
        b.occurrences - a.occurrences ||
        b.averageSeconds - a.averageSeconds,
    )
    .slice(0, MAX_TOP_CAUSES);
}

/** How often each mechanic fires, from phase notes, `why` parts and note claims. */
function mechanicFrequencies(analyzed: AnalyzedRace[]): MechanicFreqStat[] {
  const buckets = new Map<
    string,
    MechanicClassification & {
      raceIds: Set<number>;
      totalSeconds: number;
      sampleSeconds: number;
      sampleText: string;
      raceId: number | null;
    }
  >();

  const record = (
    raceId: number,
    mechanic: MechanicClassification,
    seconds: number,
    text: string,
    addSeconds: boolean,
  ) => {
    const lossSec = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    const existing = buckets.get(mechanic.key);
    if (!existing) {
      buckets.set(mechanic.key, {
        ...mechanic,
        raceIds: new Set([raceId]),
        totalSeconds: addSeconds ? lossSec : 0,
        sampleSeconds: lossSec,
        sampleText: text,
        raceId,
      });
      return;
    }
    existing.raceIds.add(raceId);
    if (addSeconds) {
      existing.totalSeconds += lossSec;
    }
    if (lossSec >= existing.sampleSeconds) {
      existing.sampleSeconds = lossSec;
      existing.sampleText = text;
      existing.raceId = raceId;
      existing.phase = mechanic.phase;
    }
  };

  for (const { row, analysis } of analyzed) {
    const notedKeys = new Set<string>();
    for (const p of analysis.report ?? []) {
      for (const n of p.notes ?? []) {
        const mechanic = classifyNote(p.phase, n);
        if (!mechanic) {
          continue;
        }
        record(row.id, mechanic, n.seconds ?? 0, n.text, true);
        notedKeys.add(mechanic.key);
      }
    }
    for (const p of analysis.report ?? []) {
      for (const w of p.why ?? []) {
        const mechanic = classifyWhyMechanic(p.phase, w);
        if (!mechanic) {
          continue;
        }
        const { key, label, text } = mechanic;
        record(row.id, { key, label, phase: p.phase }, w.seconds, text, !notedKeys.has(key));
        notedKeys.add(key);
      }
    }
    for (const c of analysis.claims ?? []) {
      if (!c.claim.startsWith("note")) {
        continue;
      }
      const mechanic = classifyNote(c.phase, { text: c.line, seconds: null });
      if (!mechanic || notedKeys.has(mechanic.key)) {
        continue;
      }
      record(row.id, mechanic, 0, c.line, false);
      notedKeys.add(mechanic.key);
    }
  }

  const analyzedMatches = analyzed.length;
  return [...buckets.values()]
    .map((m) => {
      const fires = m.raceIds.size;
      return {
        key: m.key,
        phase: m.phase,
        label: m.label,
        fires,
        totalMatches: analyzedMatches,
        rate: analyzedMatches > 0 ? Math.round((fires / analyzedMatches) * 100) : 0,
        totalSeconds: round1(m.totalSeconds),
        sampleText: m.sampleText,
        raceId: m.raceId,
      };
    })
    .sort(
      (a, b) =>
        b.fires - a.fires ||
        b.totalSeconds - a.totalSeconds ||
        phaseOrderIndex(a.phase) - phaseOrderIndex(b.phase),
    );
}

export function analyzeReplayTrends(races: RaceRow[]): ReplayTrends {
  const analyzed = selectAnalyzedRaces(races);
  const trends = computeTrends(
    analyzed.map((x) => ({ id: x.row.id, createdAt: x.row.created_at, analysis: x.analysis })),
    Math.min(4, Math.max(2, analyzed.length)),
  );
  return {
    analyzedMatches: analyzed.length,
    phases: phaseLosses(analyzed),
    topCauses: topCauses(analyzed),
    mechanics: mechanicFrequencies(analyzed),
    trends,
  };
}
