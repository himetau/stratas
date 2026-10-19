// Fetches and caches the Ranked profile, season history, recent matches and match details
import type { Api } from "../seeds/api";
import type { Store } from "../store";
import type { ApiUserFull, MatchDetail, UserSeasonSummary } from "./types";

export interface FetchedProfileRaw {
  user: ApiUserFull | null;
  seasons: UserSeasonSummary | null;
  matches: MatchDetail[];
  details: MatchDetail[];
  partial: boolean;
  fetchedAt: number;
  apiCallsMade: number;
}

export function loadCachedProfileRaw(store: Store, season?: number): FetchedProfileRaw | null {
  const snapshotKey = `profile:${season ?? "current"}`;
  const cached = store.get<FetchedProfileRaw | null>(snapshotKey, null);
  if (!cached) return null;
  const matchIds = (cached.matches ?? []).map((m) => m.id);
  const fromStore = store.matchDetails(matchIds);
  const byId = new Map<number, MatchDetail>();
  for (const d of cached.details ?? []) byId.set(d.id, d);
  for (const d of fromStore) byId.set(d.id, d);
  const details = matchIds.length
    ? matchIds.map((id) => byId.get(id)).filter((d): d is MatchDetail => d !== undefined)
    : Array.from(byId.values());
  return {
    ...cached,
    details,
  };
}

export async function fetchProfile(
  store: Store,
  api: Api,
  uuidOrName: string,
  season?: number,
  opts: { offline?: boolean; maxDetailCalls?: number } = {},
): Promise<FetchedProfileRaw> {
  const snapshotKey = `profile:${season ?? "current"}`;
  const existing = loadCachedProfileRaw(store, season);

  if (opts.offline) {
    if (existing) return { ...existing, apiCallsMade: 0 };
    return {
      user: null,
      seasons: null,
      matches: [],
      details: [],
      partial: false,
      fetchedAt: Date.now(),
      apiCallsMade: 0,
    };
  }

  let apiCallsMade = 0;

  apiCallsMade++;
  const user = await api.user(uuidOrName, season);

  apiCallsMade++;
  const seasons = await api.seasons(user.uuid).catch(() => null);

  apiCallsMade++;
  const page1 = await api.userMatchesPage(user.uuid, { type: 2, count: 50, season });

  let page2: MatchDetail[] = [];
  if (page1.length === 50) {
    apiCallsMade++;
    page2 = await api.userMatchesPage(user.uuid, { type: 2, count: 50, before: page1.at(-1)!.id, season }).catch(() => []);
  }

  const seen = new Set<number>();
  const matches: MatchDetail[] = [];
  for (const m of [...page1, ...page2]) {
    if (m.type !== 2 || seen.has(m.id)) continue;
    seen.add(m.id);
    matches.push(m);
    if (matches.length >= 100) break;
  }

  store.putMatches(matches);

  const targetIds = matches.slice(0, 50).map((m) => m.id);
  const missingIds = targetIds.filter((id) => !store.matchDetail(id));
  const maxDetailCalls = opts.maxDetailCalls ?? 40;

  let detailCalls = 0;
  for (const id of missingIds) {
    if (detailCalls >= maxDetailCalls || api.remaining() < 60) break;
    detailCalls++;
    apiCallsMade++;
    const detail = await api.match(id).catch(() => null);
    if (detail) {
      store.putMatchDetail(detail);
    }
  }

  const partial = targetIds.some((id) => !store.matchDetail(id));
  const details = store.matchDetails(matches.map((m) => m.id));

  const result: FetchedProfileRaw = {
    user,
    seasons,
    matches,
    details,
    partial,
    fetchedAt: Date.now(),
    apiCallsMade,
  };

  store.set(snapshotKey, result);
  if (season === undefined && user.season !== undefined) {
    store.set(`profile:${user.season}`, result);
  }

  return result;
}
