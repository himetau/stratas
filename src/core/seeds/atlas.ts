// Split benchmarks per Elo band, seed type and bastion type (median plus p25/p75), from Ranked match timelines
import type { ApiMatch } from "./api";
import type { TimelineEntry } from "../replay/decode";

export const SPLIT_KEYS = ["nether", "bastion", "fortress", "blind", "eye", "end", "finish"] as const;
export type AtlasSplitKey = (typeof SPLIT_KEYS)[number];

export interface SplitRow {
  matchId: number;
  uuid: string;
  elo: number | null;
  won: boolean;
  seedType: string | null;
  bastionType: string | null;
  nether: number | null;
  bastion: number | null;
  fortress: number | null;
  blind: number | null;
  eye: number | null;
  end: number | null;
  finish: number | null;
}

export interface BandStats {
  band: [number, number];
  seedType: string | null;
  bastionType: string | null;
  count: number;
  smallSample?: boolean;
  medians: Partial<Record<string, number>>;
  p25: Partial<Record<string, number>>;
  p75: Partial<Record<string, number>>;
}

const SMALL_SAMPLE_THRESHOLD = 5;

const TIMELINE_TO_SPLIT: Record<string, AtlasSplitKey> = {
  "story.enter_the_nether": "nether",
  "nether.find_bastion": "bastion",
  "nether.find_fortress": "fortress",
  "projectelo.timeline.blind_travel": "blind",
  "story.follow_ender_eye": "eye",
  "story.enter_the_end": "end",
  "projectelo.timeline.dragon_death": "finish",
  "end.kill_dragon": "finish",
  nether: "nether",
  bastion: "bastion",
  fortress: "fortress",
  blind: "blind",
  eye: "eye",
  end: "end",
  finish: "finish",
};

const normUuid = (u: string) => u.replace(/-/g, "").toLowerCase();
const normType = (s: string | null | undefined) => (s ? s.trim().toUpperCase().replace(/\s+/g, "_") : null);

/** Split ticks per player from a match detail and its timelines. ticks = time_ms / 50 */
export function extractSplitsFromTimeline(
  m: ApiMatch & { timelines?: TimelineEntry[]; changes?: { uuid: string; eloRate?: number | null }[] },
  timelines: TimelineEntry[] = m.timelines ?? [],
): SplitRow[] {
  const seedType = m.seedType ?? m.seed?.overworld ?? null;
  const bastionType = m.bastionType ?? m.seed?.nether ?? null;
  const sorted = [...timelines].sort((a, b) => a.time - b.time);

  return (m.players ?? []).map((p) => {
    const targetUuid = normUuid(p.uuid);
    const won = Boolean(m.result?.uuid && normUuid(m.result.uuid) === targetUuid);
    const elo = p.eloRate ?? m.changes?.find((c) => normUuid(c.uuid) === targetUuid)?.eloRate ?? null;
    const splits: Record<AtlasSplitKey, number | null> = {
      nether: null,
      bastion: null,
      fortress: null,
      blind: null,
      eye: null,
      end: null,
      finish: null,
    };

    for (const e of sorted) {
      if (normUuid(e.uuid) !== targetUuid) continue;
      const key = TIMELINE_TO_SPLIT[e.type];
      if (!key || splits[key] !== null) continue;
      if (typeof e.time === "number" && Number.isFinite(e.time) && e.time >= 0) {
        splits[key] = Math.round(e.time / 50);
      }
    }

    if (splits.finish === null && won && !m.forfeited && (m.result?.time ?? 0) > 0) {
      splits.finish = Math.round(m.result.time / 50);
    }

    return {
      matchId: m.id,
      uuid: p.uuid,
      elo,
      won,
      seedType,
      bastionType,
      ...splits,
    };
  });
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const frac = pos - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

/** Median and p25/p75 per split for an Elo band, optionally by seed/bastion type. Under 5 samples gets flagged small */
export function computeBandStats(
  rows: SplitRow[],
  band: [number, number],
  seedType: string | null = null,
  bastionType: string | null = null,
): BandStats & { smallSample: boolean } {
  const [minElo, maxElo] = band;
  const wantSeed = normType(seedType);
  const wantBastion = normType(bastionType);

  const filtered = rows.filter((r) => {
    if (r.elo === null || r.elo < minElo || r.elo > maxElo) return false;
    if (wantSeed && normType(r.seedType) !== wantSeed) return false;
    if (wantBastion && normType(r.bastionType) !== wantBastion) return false;
    return true;
  });

  const medians: Partial<Record<string, number>> = {};
  const p25: Partial<Record<string, number>> = {};
  const p75: Partial<Record<string, number>> = {};

  for (const key of SPLIT_KEYS) {
    const vals = filtered
      .map((r) => r[key])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0)
      .sort((a, b) => a - b);
    if (!vals.length) continue;
    medians[key] = quantile(vals, 0.5);
    p25[key] = quantile(vals, 0.25);
    p75[key] = quantile(vals, 0.75);
  }

  const count = filtered.length;
  return {
    band,
    seedType,
    bastionType,
    count,
    smallSample: count < SMALL_SAMPLE_THRESHOLD,
    medians,
    p25,
    p75,
  };
}
