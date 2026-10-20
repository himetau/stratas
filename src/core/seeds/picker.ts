// Picks stronger players' runs to race. Auto uses 3 tiers above your Elo that adapt to results, manual is an Elo range
import type { MatchRow, RaceRow, Store } from "../store";
import { hasReplay, type Api } from "./api";
import { fmtTime } from "../detect/names";

export type Tier = "next" | "stretch" | "ceiling" | "manual" | "player";
/** The 3 auto levels, the ones with an Elo band */
type Band = Exclude<Tier, "manual" | "player">;
const TIER_WEIGHT: Record<Band, number> = { next: 0.6, stretch: 0.3, ceiling: 0.1 };
const DEFAULT_BANDS: Record<Band, [number, number]> = { next: [100, 250], stretch: [400, 700], ceiling: [0, 0] };

export interface PickFilters {
  seedType?: string | null;
  bastionType?: string | null;
  /** Only wins faster than this, in seconds */
  maxTime?: number | null;
}
export interface PickOptions extends PickFilters {
  mode: "auto" | "manual";
  /** Manual range, absolute Elo */
  minElo?: number;
  maxElo?: number;
  /** Auto mode only, stick to one tier */
  lockTier?: Band | null;
  count: number;
  /** Just this player's runs, by Minecraft name. Not saved with the rest */
  player?: string | null;
}
export interface Pick { match: MatchRow; tier: Tier; reason: string }

export interface TierShift { next: number; stretch: number; ceiling: number }

/** How far each tier can shift from its default */
const SHIFT_LIMIT: Record<keyof TierShift, [number, number]> = { next: [-50, 250], stretch: [-250, 400], ceiling: [-250, 600] };

/** Elo bands for all 3 tiers with the learned shifts. Always ordered next < stretch < ceiling */
export function tierBands(elo: number, shift: TierShift): Record<Band, [number, number]> {
  // Round edges to 50s since a band gets shown by where it starts ("1400+")
  const r = (x: number) => Math.round(x / 50) * 50;
  const next: [number, number] = [r(elo + DEFAULT_BANDS.next[0] + shift.next), r(elo + DEFAULT_BANDS.next[1] + shift.next)];
  const s0 = Math.max(r(elo + DEFAULT_BANDS.stretch[0] + shift.stretch), next[1]);
  const stretch: [number, number] = [s0, Math.max(r(elo + DEFAULT_BANDS.stretch[1] + shift.stretch), s0 + 150)];
  const ceiling: [number, number] = [Math.max(r(Math.max(2000, elo + 800) + shift.ceiling), stretch[1]), 4000];
  return { next, stretch, ceiling };
}
export const tierBand = (tier: Band, elo: number, shift: TierShift): [number, number] => tierBands(elo, shift)[tier];

/** Tier goes up when races vs it are close and getting closer, down when you keep losing by minutes.
 * Replayed over the whole race history in order, so reanalysing doesn't move it again */
export function adaptTiers(races: RaceRow[]): TierShift {
  const out: TierShift = { next: 0, stretch: 0, ceiling: 0 };
  for (const tier of ["next", "stretch", "ceiling"] as const) {
    const all = races.filter((r) => r.tier === tier && !r.error).sort((a, b) => a.created_at - b.created_at || a.id - b.id).map((r) => r.final_gap);
    const [lo, hi] = SHIFT_LIMIT[tier];
    for (let k = 1; k <= all.length; k++) {
      const gaps = all.slice(0, k).reverse(); // Newest first, as of race k
      if (gaps.length >= 3) {
        const recent = gaps.slice(0, 3).sort((a, b) => a - b);
        if (recent[1] < 30 && gaps[0] <= gaps[1]) out[tier] = Math.min(out[tier] + 50, hi);
      }
      if (gaps.length >= 2 && gaps[0] > 120 && gaps[1] > 120) out[tier] = Math.max(out[tier] - 50, lo);
    }
  }
  return out;
}

/** Which tiers to fill next to keep the mix near 60/30/10 */
function tierPlan(count: number, recent: Tier[], lock: Band | null | undefined): Band[] {
  if (lock) return Array(count).fill(lock);
  const have = { next: 0, stretch: 0, ceiling: 0 };
  for (const t of recent) if (t !== "manual" && t !== "player") have[t]++;
  const out: Band[] = [];
  for (let i = 0; i < count; i++) {
    const total = Object.values(have).reduce((a, b) => a + b, 0) + 1;
    const t = (Object.keys(TIER_WEIGHT) as (keyof typeof TIER_WEIGHT)[]).sort((a, b) => (have[a] / total - TIER_WEIGHT[a]) - (have[b] / total - TIER_WEIGHT[b]))[0];
    have[t]++; out.push(t);
  }
  return out;
}

const RECENT_HOURS = 36; // Ranked only lets you download recent matches

async function playerMedians(store: Store, api: Api, uuid: string, name: string) {
  const cached = store.player(uuid);
  if (cached && Date.now() - cached.fetched_at < 86400_000) return { matches: cached.matches, medians: JSON.parse(cached.medians) as Record<string, number> };
  const ms = await api.userMatches(uuid);
  const by: Record<string, number[]> = {};
  for (const m of ms) {
    if (m.forfeited || m.result?.uuid !== uuid || !m.result.time) continue;
    const k = `${m.seedType ?? m.seed?.overworld}/${m.bastionType ?? m.seed?.nether}`;
    (by[k] ??= []).push(m.result.time);
    (by["*"] ??= []).push(m.result.time);
  }
  const medians: Record<string, number> = {};
  for (const [k, v] of Object.entries(by)) if (v.length >= 3) medians[k] = v.sort((a, b) => a - b)[v.length >> 1];
  store.putPlayer(uuid, name, ms.length, medians);
  return { matches: ms.length, medians };
}

const nice = (s: string | null) => (s ? s.toLowerCase().replace(/_/g, " ") : "any");

export async function pickRuns(store: Store, api: Api, yourElo: number, yourUuid: string | null, o: PickOptions): Promise<{ picks: Pick[]; notes: string[] }> {
  const notes: string[] = [];
  const shift = store.get<TierShift>("tierShift", { next: 0, stretch: 0, ceiling: 0 });
  const races = store.races();
  const queue = store.queue();
  const taken = new Set([...queue.map((q) => q.match_id)]);
  const recentPlayers = [...races.slice(0, 2).map((r) => r.their_uuid), ...queue.filter((q) => q.status === "queued").map((q) => q.player_uuid)];
  const recentTiers = [...races.slice(0, 10).map((r) => r.tier as Tier), ...queue.slice(0, 10).map((q) => q.tier as Tier)];
  const since = Math.floor(Date.now() / 1000) - RECENT_HOURS * 3600;
  const plan: (Band | "manual")[] = o.mode === "manual" ? Array(o.count).fill("manual") : tierPlan(o.count, recentTiers, o.lockTier);
  const picks: Pick[] = [];
  const usedPlayers = new Map<string, number>();
  for (const p of recentPlayers) usedPlayers.set(p, (usedPlayers.get(p) ?? 0) + 1);

  for (const tier of plan) {
    const [lo, hi] = tier === "manual" ? [o.minElo ?? yourElo, o.maxElo ?? yourElo + 500] : tierBand(tier, yourElo, shift);
    const rows = store.candidates({ minElo: lo, maxElo: hi, since, seedType: o.seedType, bastionType: o.bastionType, maxTime: o.maxTime ? o.maxTime * 1000 : null })
      .filter((m) => !taken.has(m.id) && m.winner_uuid !== yourUuid && m.loser_uuid !== yourUuid);
    if (!rows.length) { notes.push("No recent runs match these filters"); continue; }
    const median = store.bandMedian(lo, hi, o.seedType ?? null, o.bastionType ?? null);
    const ranked = rows
      .map((m) => ({ m, score: (median ? Math.abs(m.time - median) / median : 0) + (usedPlayers.get(m.winner_uuid!) ?? 0) * 0.5 + (Date.now() / 1000 - m.date) / (RECENT_HOURS * 3600) * 0.2 }))
      .sort((a, b) => a.score - b.score);
    let chosen: Pick | null = null;
    for (const { m } of ranked.slice(0, 8)) {
      if ((usedPlayers.get(m.winner_uuid!) ?? 0) >= 2) continue;
      let stats: { matches: number; medians: Record<string, number> };
      try { stats = await playerMedians(store, api, m.winner_uuid!, m.winner_name!); } catch { continue; }
      if (stats.matches < 10) continue;
      const own = stats.medians[`${m.seed_type}/${m.bastion_type}`] ?? stats.medians["*"];
      if (own && m.time < own * 0.82) continue; // Way faster than their usual, probably just luck
      const reason = `${m.winner_name}, ${m.winner_elo} Elo, ${fmtTime(m.time / 50)} on ${nice(m.seed_type)} / ${nice(m.bastion_type)}`;
      chosen = { match: m, tier, reason };
      break;
    }
    if (!chosen) { notes.push("No recent runs match these filters"); continue; }
    picks.push(chosen);
    taken.add(chosen.match.id);
    usedPlayers.set(chosen.match.winner_uuid!, (usedPlayers.get(chosen.match.winner_uuid!) ?? 0) + 1);
  }
  return { picks, notes };
}

/** Recent wins by one player you named, newest first. No Elo or luck checks since you asked for them */
export async function pickPlayer(store: Store, api: Api, yourUuid: string | null, o: PickOptions): Promise<{ picks: Pick[]; notes: string[] }> {
  const name = (o.player ?? "").trim();
  let ms;
  try { ms = await api.userMatches(name); }
  catch { return { picks: [], notes: [`Couldn't find a player called ${name}`] }; }
  if (!ms.length) return { picks: [], notes: [`${name} hasn't played any ranked games yet`] };
  store.putMatches(ms);
  // Whoever is in every one of the matches, the name match is just in case they played themselves twice
  const them = ms[0].players.find((p) => p.nickname.toLowerCase() === name.toLowerCase())
    ?? ms[0].players.find((p) => ms.every((m) => m.players.some((x) => x.uuid === p.uuid))) ?? ms[0].players[0];
  if (them.uuid === yourUuid) return { picks: [], notes: ["That's you. Type someone else's name"] };
  const taken = new Set(store.queue().map((q) => q.match_id));
  const since = Math.floor(Date.now() / 1000) - RECENT_HOURS * 3600;
  const wins = ms.filter((m) => m.result?.uuid === them.uuid && !m.forfeited && m.result.time > 0 && hasReplay(m) && m.date >= since);
  const fits = wins
    .filter((m) => !o.seedType || (m.seedType ?? m.seed?.overworld) === o.seedType)
    .filter((m) => !o.bastionType || (m.bastionType ?? m.seed?.nether) === o.bastionType)
    .filter((m) => !o.maxTime || m.result.time <= o.maxTime * 1000);
  const rows = fits.filter((m) => !taken.has(m.id))
    .map((m) => store.match(m.id)).filter((m): m is MatchRow => !!m)
    .sort((a, b) => b.date - a.date);
  const picks = rows.slice(0, o.count).map((m): Pick => ({ match: m, tier: "player",
    reason: `${m.winner_name}, ${m.winner_elo} Elo, ${fmtTime(m.time / 50)} on ${nice(m.seed_type)} / ${nice(m.bastion_type)}` }));
  const notes = picks.length ? [] : [!wins.length
    ? `${them.nickname} hasn't won a ranked game with a replay in the last ${RECENT_HOURS} hours, and Ranked only keeps recent ones`
    : fits.length ? `${them.nickname}'s recent wins are already in your queue` : `None of ${them.nickname}'s recent wins match these filters`];
  return { picks, notes };
}
