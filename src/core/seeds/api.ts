// Ranked API client, rate limited to stay well under 500 requests per 10 min
import type { ApiUserFull, MatchDetail, UserSeasonSummary } from "../profile/types";

const BASE = "https://api.mcsrranked.com";
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 420;
const MIN_GAP_MS = 250;

export interface ApiPlayer { uuid: string; nickname: string; eloRate: number | null; eloRank?: number | null; roleType?: number }
export interface ApiMatch {
  id: number;
  type: number;
  date: number;
  seed?: { id: string | null; overworld: string | null; nether: string | null; variations?: string[] } | null;
  seedType?: string | null;
  bastionType?: string | null;
  players: ApiPlayer[];
  result: { uuid: string | null; time: number };
  forfeited: boolean;
  decayed?: boolean;
  replayExists?: boolean | number;
  replayExist?: boolean | number;
}
export interface ApiUser { uuid: string; nickname: string; eloRate: number | null; eloRank: number | null }

export class Api {
  private sent: number[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private key: () => string | null = () => null) {}

  /** Requests left in this window, shown in the status bar */
  remaining() { this.prune(); return MAX_PER_WINDOW - this.sent.length; }
  private prune() { const now = Date.now(); while (this.sent.length && now - this.sent[0] > WINDOW_MS) this.sent.shift(); }

  private async slot() {
    for (;;) {
      this.prune();
      const now = Date.now();
      const last = this.sent.at(-1) ?? 0;
      if (this.sent.length < MAX_PER_WINDOW && now - last >= MIN_GAP_MS) { this.sent.push(now); return; }
      const wait = this.sent.length >= MAX_PER_WINDOW ? WINDOW_MS - (now - this.sent[0]) + 50 : MIN_GAP_MS - (now - last);
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  get<T>(path: string): Promise<T> {
    const run = async () => {
      await this.slot();
      const headers: Record<string, string> = { "User-Agent": "Stratas (MCSR Ranked training tool)" };
      const k = this.key();
      if (k) headers["Private-Key"] = k;
      const res = await fetch(BASE + path, { headers, signal: AbortSignal.timeout(15_000) }); // One stuck call would hold up the whole chain
      const body = (await res.json().catch(() => null)) as { status?: string; data?: unknown } | null;
      if (!res.ok || !body || body.status !== "success") throw new Error(`API ${path}: ${res.status} ${typeof body?.data === "string" ? body.data : ""}`.trim());
      return body.data as T;
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  user(id: string, season?: number): Promise<ApiUserFull> {
    const qs = season !== undefined ? `?season=${season}` : "";
    return this.get<ApiUserFull>(`/users/${encodeURIComponent(id)}${qs}`);
  }
  seasons(id: string): Promise<UserSeasonSummary> {
    return this.get<UserSeasonSummary>(`/users/${encodeURIComponent(id)}/seasons`);
  }
  matches(before?: number, count = 100) {
    return this.get<ApiMatch[]>(`/matches?type=2&count=${count}${before ? `&before=${before}` : ""}`);
  }
  match(id: number): Promise<MatchDetail> {
    return this.get<MatchDetail>(`/matches/${id}`);
  }
  userMatchesPage(
    id: string,
    opts: { type?: number; count?: number; before?: number; sort?: string; season?: number } = {},
  ): Promise<MatchDetail[]> {
    const params = new URLSearchParams();
    if (opts.type !== undefined) params.set("type", String(opts.type));
    if (opts.count !== undefined) params.set("count", String(opts.count));
    if (opts.before !== undefined) params.set("before", String(opts.before));
    if (opts.sort !== undefined) params.set("sort", opts.sort);
    if (opts.season !== undefined) params.set("season", String(opts.season));
    const qs = params.toString();
    return this.get<MatchDetail[]>(`/users/${encodeURIComponent(id)}/matches${qs ? `?${qs}` : ""}`);
  }
  userMatches(id: string, before?: number, count = 50): Promise<MatchDetail[]> {
    return this.userMatchesPage(id, { type: 2, count, before });
  }
}

export const hasReplay = (m: ApiMatch) => Boolean(m.replayExists ?? m.replayExist);
