// Stuff from replays. Habit trends, phase losses, cause counts
import type { RaceAnalysis } from "../detect/analyze";
import type { Note } from "../detect/findings";
import type { Part } from "../detect/why";
import { computeTrends } from "../features";
import type { RaceRow } from "../store";
import type {
  CauseLossStat,
  MechanicFreqStat,
  PhaseLossStat,
  ReplayTrends,
} from "./types";

export const CANONICAL_PHASE_ORDER = [
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
  match: (text: string, phase: string) => boolean;
}

const MECHANIC_MATCHERS: MechanicMatcher[] = [
  // Mechanics registered in src/core/detect/mechanics/index.ts
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
    label: "Iron pickaxe timing",
    phases: ["Overworld"],
    match: (t) => /^iron pickaxe\b/i.test(t),
  },
  {
    key: "nether_bridging",
    label: "Blocks placed on the way",
    match: (t) => /^blocks placed on the way\b/i.test(t),
  },
  {
    key: "bastion_gold_blocks",
    label: "Gold blocks mined",
    phases: ["Bastion"],
    match: (t) => /^gold blocks mined\b|\bmined gold block\b|\bacquired \d+ gold block/i.test(t),
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
    match: (t) => /^inside stronghold:/i.test(t) || /\binside stronghold:/i.test(t),
  },
  // Phase notes from src/core/detect/findings.ts
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
    match: (t) => /^eyes thrown\b/i.test(t),
  },
  {
    key: "end_beds",
    label: "End beds used",
    phases: ["End"],
    match: (t) => /^beds \d+/i.test(t),
  },
];

const round1 = (n: number): number => Math.round(n * 10) / 10;

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function isMatchRaceRow(r: RaceRow): boolean {
  return r.your_file === r.their_file || r.key.startsWith("match|");
}

function parseAnalyzedRace(row: RaceRow): AnalyzedRace | null {
  if (row.error || !row.analysis) return null;
  try {
    const analysis = JSON.parse(row.analysis) as RaceAnalysis;
    if (!analysis || !Array.isArray(analysis.report)) return null;
    return { row, analysis };
  } catch {
    return null;
  }
}

function phaseOrderIndex(phase: string): number {
  const idx = CANONICAL_PHASE_ORDER.indexOf(
    phase as (typeof CANONICAL_PHASE_ORDER)[number],
  );
  return idx >= 0 ? idx : CANONICAL_PHASE_ORDER.length;
}

function classifyNote(phase: string, note: Note): MechanicClassification | null {
  const text = (note.text ?? "").trim();
  if (!text) return null;

  for (const m of MECHANIC_MATCHERS) {
    if (m.phases && !m.phases.includes(phase)) continue;
    if (m.match(text, phase)) {
      return { key: m.key, label: m.label, phase };
    }
  }

  // Second pass ignoring phase, a note can show up in the phase next to it
  for (const m of MECHANIC_MATCHERS) {
    if (m.match(text, phase)) {
      return { key: m.key, label: m.label, phase };
    }
  }

  // Fallback, strip timestamps and numbers so the same note groups together
  const colonIdx = text.indexOf(":");
  const rawHead =
    colonIdx > 0 && colonIdx <= 36 && !/^\d+:\d\d/.test(text)
      ? text.slice(0, colonIdx)
      : text;
  const cleaned = rawHead
    .replace(/\b\d+:\d\d(?:–\d+:\d\d)?\b/g, "")
    .replace(/\b\d+(?:\.\d+)?\s*(?:s|blocks?|chests?|rods?|eyes?|beds?|trades?|piglins?|times?|tnt|iron|lava|water)\b/gi, "")
    .replace(/\b\d+\b/g, "")
    .replace(/[()·,~—–-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const labelBase = cleaned || "Other note";
  const label = labelBase.charAt(0).toUpperCase() + labelBase.slice(1);
  const slug = labelBase
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const phaseSlug = phase
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return {
    key: `note_${phaseSlug}_${slug || "other"}`,
    label,
    phase,
  };
}

function classifyWhyMechanic(phase: string, w: Part): { key: string; label: string; seconds: number; text: string } | null {
  const knownMechanic = MECHANIC_MATCHERS.find((m) => m.key === w.key);
  if (knownMechanic) {
    return {
      key: knownMechanic.key,
      label: knownMechanic.label,
      seconds: Math.max(0, w.seconds),
      text: w.text,
    };
  }
  if (w.key === "back" && w.seconds > 0) {
    return {
      key: "stronghold_backtrack",
      label: "Back in the nether after blind",
      seconds: w.seconds,
      text: w.text,
    };
  }
  if (w.key === "stop:Pie chart" && w.seconds > 0) {
    return {
      key: "pie_chart",
      label: "Pie chart usage",
      seconds: w.seconds,
      text: `${w.label}: ${w.text}`,
    };
  }
  if (phase === "Bastion" && w.key === "trading") {
    if (/\d+\s+stuck\b/i.test(w.text)) {
      return {
        key: "bastion_piglins_stuck",
        label: "Piglins stuck on gold",
        seconds: Math.max(0, w.seconds),
        text: w.text,
      };
    }
    if (/no piglin trading/i.test(w.text) && w.seconds > 0) {
      return {
        key: "bastion_trade_stall",
        label: "Bastion trade stall",
        seconds: Math.max(0, w.seconds),
        text: w.text,
      };
    }
  }
  return null;
}

export function analyzeReplayTrends(
  races: RaceRow[],
): ReplayTrends {
  // 1. Analysed Ranked matches, or all analysed races if there are none
  const allParsed = races
    .map(parseAnalyzedRace)
    .filter((x): x is AnalyzedRace => x !== null);
  const matchParsed = allParsed.filter((x) => isMatchRaceRow(x.row));
  const analyzed = (matchParsed.length > 0 ? matchParsed : allParsed).sort(
    (a, b) => a.row.created_at - b.row.created_at || a.row.id - b.row.id,
  );

  // 2. Avg seconds lost per phase
  const phaseBuckets = new Map<
    string,
    {
      changes: number[];
      worstRaceId: number | null;
      worstLossSeconds: number | null;
    }
  >();

  for (const { row, analysis } of analyzed) {
    for (const p of analysis.report ?? []) {
      if (p.change === null || typeof p.change !== "number" || !Number.isFinite(p.change)) {
        continue;
      }
      const bucket = phaseBuckets.get(p.phase) ?? {
        changes: [],
        worstRaceId: null,
        worstLossSeconds: null,
      };
      bucket.changes.push(round1(p.change));
      if (p.change > 0 && (bucket.worstLossSeconds === null || p.change > bucket.worstLossSeconds)) {
        bucket.worstLossSeconds = p.change;
        bucket.worstRaceId = row.id;
      }
      phaseBuckets.set(p.phase, bucket);
    }
  }

  const phases: PhaseLossStat[] = [];
  for (const [phase, bucket] of phaseBuckets.entries()) {
    if (bucket.changes.length === 0) continue;
    const sum = bucket.changes.reduce((acc, v) => acc + v, 0);
    const avg = sum / bucket.changes.length;
    const med = median(bucket.changes);
    phases.push({
      phase,
      races: bucket.changes.length,
      averageLostSeconds: round1(avg),
      medianLostSeconds: round1(med),
      totalLostSeconds: round1(sum),
      history: bucket.changes,
      worstRaceId: bucket.worstRaceId,
      worstLossSeconds: bucket.worstLossSeconds !== null ? round1(bucket.worstLossSeconds) : null,
    });
  }

  phases.sort(
    (a, b) =>
      b.averageLostSeconds - a.averageLostSeconds ||
      phaseOrderIndex(a.phase) - phaseOrderIndex(b.phase),
  );

  // 3. Top `why` causes by total seconds
  const causeBuckets = new Map<
    string,
    {
      key: string;
      phase: string;
      label: string;
      losses: number[];
      worstRaceId: number;
      worstOpponent: string;
      worstSeconds: number;
      worstAtTick?: number;
      worstText: string;
    }
  >();

  for (const { row, analysis } of analyzed) {
    for (const p of analysis.report ?? []) {
      for (const w of p.why ?? []) {
        if (w.key === "step:other" || w.key === "rest") continue;
        if (typeof w.seconds !== "number" || !Number.isFinite(w.seconds) || w.seconds <= 0) {
          continue;
        }
        const groupKey = `${p.phase}|${w.label}`;
        const atTick = w.at?.you ?? w.at?.them;
        const existing = causeBuckets.get(groupKey);
        if (!existing) {
          causeBuckets.set(groupKey, {
            key: groupKey,
            phase: p.phase,
            label: w.label,
            losses: [w.seconds],
            worstRaceId: row.id,
            worstOpponent: row.their_name,
            worstSeconds: w.seconds,
            ...(atTick !== undefined ? { worstAtTick: atTick } : {}),
            worstText: w.text,
          });
        } else {
          existing.losses.push(w.seconds);
          if (w.seconds > existing.worstSeconds) {
            existing.worstRaceId = row.id;
            existing.worstOpponent = row.their_name;
            existing.worstSeconds = w.seconds;
            if (atTick !== undefined) {
              existing.worstAtTick = atTick;
            } else {
              delete existing.worstAtTick;
            }
            existing.worstText = w.text;
          }
        }
      }
    }
  }

  const topCauses: CauseLossStat[] = [...causeBuckets.values()]
    .map((c) => {
      const total = c.losses.reduce((acc, v) => acc + v, 0);
      const count = c.losses.length;
      return {
        key: c.key,
        phase: c.phase,
        label: c.label,
        occurrences: count,
        totalSeconds: round1(total),
        averageSeconds: round1(total / count),
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
    .slice(0, 12);

  // 4. How often each mechanic fires
  const mechanicBuckets = new Map<
    string,
    {
      key: string;
      phase: string;
      label: string;
      matchIds: Set<number>;
      totalSeconds: number;
      bestSeconds: number;
      sampleText: string;
      raceId: number | null;
    }
  >();

  const recordMechanic = (
    raceId: number,
    phase: string,
    key: string,
    label: string,
    seconds: number,
    text: string,
    addSeconds: boolean,
  ) => {
    const lossSec = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    const existing = mechanicBuckets.get(key);
    if (!existing) {
      mechanicBuckets.set(key, {
        key,
        phase,
        label,
        matchIds: new Set([raceId]),
        totalSeconds: addSeconds ? lossSec : 0,
        bestSeconds: lossSec,
        sampleText: text,
        raceId,
      });
      return;
    }
    existing.matchIds.add(raceId);
    if (addSeconds) {
      existing.totalSeconds += lossSec;
    }
    if (lossSec >= existing.bestSeconds) {
      existing.bestSeconds = lossSec;
      existing.sampleText = text;
      existing.raceId = raceId;
      existing.phase = phase;
    }
  };

  for (const { row, analysis } of analyzed) {
    const notedKeysInRace = new Set<string>();
    for (const p of analysis.report ?? []) {
      for (const n of p.notes ?? []) {
        const cls = classifyNote(p.phase, n);
        if (!cls) continue;
        const sec = typeof n.seconds === "number" && Number.isFinite(n.seconds) ? Math.max(0, n.seconds) : 0;
        recordMechanic(row.id, cls.phase, cls.key, cls.label, sec, n.text, true);
        notedKeysInRace.add(cls.key);
      }
    }
    for (const p of analysis.report ?? []) {
      for (const w of p.why ?? []) {
        const wm = classifyWhyMechanic(p.phase, w);
        if (!wm) continue;
        const alreadyNoted = notedKeysInRace.has(wm.key);
        recordMechanic(
          row.id,
          p.phase,
          wm.key,
          wm.label,
          wm.seconds,
          wm.text,
          !alreadyNoted,
        );
        notedKeysInRace.add(wm.key);
      }
    }
    for (const c of analysis.claims ?? []) {
      if (!c.claim.startsWith("note")) continue;
      const cls = classifyNote(c.phase, { text: c.line, seconds: null });
      if (!cls || notedKeysInRace.has(cls.key)) continue;
      recordMechanic(row.id, cls.phase, cls.key, cls.label, 0, c.line, false);
      notedKeysInRace.add(cls.key);
    }
  }

  const analyzedMatches = analyzed.length;
  const mechanics: MechanicFreqStat[] = [...mechanicBuckets.values()]
    .map((m) => {
      const fires = m.matchIds.size;
      const rate = analyzedMatches > 0 ? Math.round((fires / analyzedMatches) * 100) : 0;
      return {
        key: m.key,
        phase: m.phase,
        label: m.label,
        fires,
        totalMatches: analyzedMatches,
        rate,
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

  // 5. Trend over time per phase
  const trends = computeTrends(
    analyzed.map((x) => ({
      id: x.row.id,
      createdAt: x.row.created_at,
      analysis: x.analysis,
    })),
    Math.min(4, Math.max(2, analyzed.length)),
  );

  return {
    analyzedMatches,
    phases,
    topCauses,
    mechanics,
    trends,
  };
}
