import type { Api } from "../seeds/api";
import type { Store } from "../store";
import {
  RANKED_MATCH_TYPE,
  type ApiUserFull,
  type MatchDetail,
  type UserSeasonSummary,
} from "./types";

const PAGE_SIZE = 50;
const MAX_MATCHES = 100;
/** How many of the newest matches get their full details fetched. */
const DETAIL_TARGET = 50;
const DEFAULT_MAX_DETAIL_CALLS = 40;
/** API calls left in the rate limit window that detail fetches never spend. */
const RATE_LIMIT_RESERVE = 60;

export interface FetchedProfileRaw {
  user: ApiUserFull | null;
  seasons: UserSeasonSummary | null;
  matches: MatchDetail[];
  details: MatchDetail[];
  partial: boolean;
  fetchedAt: number;
  apiCallsMade: number;
}

const snapshotKey = (season: number | undefined) => `profile:${season ?? "current"}`;

export function loadCachedProfileRaw(store: Store, season?: number): FetchedProfileRaw | null {
  const cached = store.get<FetchedProfileRaw | null>(snapshotKey(season), null);
  if (!cached) {
    return null;
  }
  const matchIds = (cached.matches ?? []).map((m) => m.id);
  const byId = new Map<number, MatchDetail>();
  for (const d of [...(cached.details ?? []), ...store.matchDetails(matchIds)]) {
    byId.set(d.id, d);
  }
  const details = matchIds.length
    ? matchIds.map((id) => byId.get(id)).filter((d): d is MatchDetail => d !== undefined)
    : Array.from(byId.values());
  return { ...cached, details };
}

/** Keeps the first MAX_MATCHES unique ranked matches. */
function uniqueRankedMatches(pages: MatchDetail[]): MatchDetail[] {
  const seen = new Set<number>();
  const matches: MatchDetail[] = [];
  for (const m of pages) {
    if (m.type !== RANKED_MATCH_TYPE || seen.has(m.id)) {
      continue;
    }
    seen.add(m.id);
    matches.push(m);
    if (matches.length >= MAX_MATCHES) {
      break;
    }
  }
  return matches;
}

export async function fetchProfile(
  store: Store,
  api: Api,
  uuidOrName: string,
  season?: number,
  opts: { offline?: boolean; maxDetailCalls?: number } = {},
): Promise<FetchedProfileRaw> {
  if (opts.offline) {
    const existing = loadCachedProfileRaw(store, season);
    if (existing) {
      return { ...existing, apiCallsMade: 0 };
    }
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
  const page1 = await api.userMatchesPage(user.uuid, {
    type: RANKED_MATCH_TYPE,
    count: PAGE_SIZE,
    season,
  });

  let page2: MatchDetail[] = [];
  if (page1.length === PAGE_SIZE) {
    apiCallsMade++;
    page2 = await api
      .userMatchesPage(user.uuid, {
        type: RANKED_MATCH_TYPE,
        count: PAGE_SIZE,
        before: page1.at(-1)!.id,
        season,
      })
      .catch(() => []);
  }

  const matches = uniqueRankedMatches([...page1, ...page2]);
  store.putMatches(matches);

  const targetIds = matches.slice(0, DETAIL_TARGET).map((m) => m.id);
  const missingIds = targetIds.filter((id) => !store.matchDetail(id));
  const maxDetailCalls = opts.maxDetailCalls ?? DEFAULT_MAX_DETAIL_CALLS;

  let detailCalls = 0;
  for (const id of missingIds) {
    if (detailCalls >= maxDetailCalls || api.remaining() < RATE_LIMIT_RESERVE) {
      break;
    }
    detailCalls++;
    apiCallsMade++;
    const detail = await api.match(id).catch(() => null);
    if (detail) {
      store.putMatchDetail(detail);
    }
  }

  const result: FetchedProfileRaw = {
    user,
    seasons,
    matches,
    details: store.matchDetails(matches.map((m) => m.id)),
    partial: targetIds.some((id) => !store.matchDetail(id)),
    fetchedAt: Date.now(),
    apiCallsMade,
  };

  store.set(snapshotKey(season), result);
  if (season === undefined && user.season !== undefined) {
    store.set(snapshotKey(user.season), result);
  }

  return result;
}
