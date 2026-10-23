// Core of the app. Settings, replay library, download queue, pairing runs into races, analysis, API scan
// Used by Electron main but has no Electron imports
import { EventEmitter } from "node:events";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { basename, dirname, join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { decodeRrf, ReplayError, type ReplayMeta } from "./replay/decode";
import { mergeRunners } from "./replay/merge";
import { analyzeRace, ANALYSIS_VERSION, type RaceAnalysis } from "./detect/analyze";
import { quickRace } from "./detect/quick";
import type { Finding } from "./detect/explain";
import { buildInsights, type Insights } from "./detect/insights";
import { fmtDur } from "./detect/names";
import { Store, type QueueRow, type RaceRow, type RunKind, type RunRow } from "./store";
import { Api, type ApiMatch } from "./seeds/api";
import { Scanner } from "./seeds/scanner";
import { adaptTiers, pickPlayer, pickRuns, tierBands, type Pick, type PickOptions, type Tier, type TierShift } from "./seeds/picker";
import { findInstances, inspectInstance, instanceName, myReplaysDir, replayDirs, type Instance } from "./ingest/paths";
import { fetchProfile, loadCachedProfileRaw } from "./profile/fetch";
import { buildProfileInsights } from "./profile/insights";
import { analyzeReplayTrends } from "./profile/replays";
import { analyzeSplitsProfile, benchmarkBands, buildScorecard } from "./profile/splits";
import { analyzeRanked, eloWinChance } from "./profile/stats";
import type { MatchDetail, ProfileData, ProfileMatch, ProfileUser, SeasonResultEntry } from "./profile/types";
import { rankOf } from "./tiers";
import { DEFAULT_PREFS, mergePrefs, type Prefs } from "./prefs";

export interface Settings {
  nickname: string | null;
  uuid: string | null;
  instancePath: string | null;
  autoRace: boolean;
  pick: Omit<PickOptions, "count">;
  /** Desktop notification when one of your new games gets analysed */
  notify: boolean;
  /** Everything else on the settings page */
  prefs: Prefs;
  /** Went through the welcome screen. Your name is only ever what you typed there or in Settings */
  onboarded: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  nickname: null, uuid: null, instancePath: null, autoRace: true, notify: true,
  pick: { mode: "auto", seedType: null, bastionType: null, maxTime: null, minElo: undefined, maxElo: undefined, lockTier: null },
  prefs: DEFAULT_PREFS,
  onboarded: false,
};

export type GateState = { version: string | null; status: "ok" | "unverified" | "failed"; detail: string };

export interface RaceSummary {
  id: number; createdAt: number; theirName: string; theirElo: number | null; tier: string | null; finalGap: number;
  seedType: string | null; raceFile: string | null; error: string | null; top: string | null; topSeconds: number | null; kind: "race" | "match";
  /** Splits only, from Ranked's API */
  quick: boolean;
}

export interface AppState {
  settings: Settings;
  instance: Instance | null;
  instances: { path: string; name: string }[];
  gate: GateState;
  you: { elo: number | null; rank: number | null; checkedAt: number | null };
  index: { matches: number; scanning: boolean; error: string | null; apiLeft: number };
  queue: QueueRow[];
  races: RaceSummary[];
  insights: Insights;
  tiers: Record<Exclude<Tier, "manual" | "player">, [number, number]> | null;
  library: { practice: number; ranked: number; reference: number; unreadable: number };
  /** Your newest Ranked games since the new replay format, analysed or still waiting on the replay */
  myGames: MyGame[];
  log: string[];
}

const QUEUE_EXPIRE_MS = 48 * 3600_000;

/** One line summary, phase and time lost then the top 2 causes */
function summaryLine(f: Finding): string {
  const a = Math.round(f.seconds);
  const t = a < 60 ? `${a}s` : `${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`;
  const why = f.causes.filter((c) => c.seconds > 0).slice(0, 2).map((c) => c.label ?? c.key).join(" + ");
  return `${f.phase} +${t}${why ? ` · ${why}` : ""}`;
}

/** Ranked 6.0.1, first replays we can read (older ones are encrypted) */
const NEW_REPLAYS_SINCE = Date.UTC(2026, 9, 15) / 1000;

/** One of your Ranked games from match history */
export interface MyGame {
  id: number; date: number; opponent: { uuid: string; name: string; elo: number | null };
  won: boolean | null; forfeited: boolean; time: number; seedType: string | null;
  raceId: number | null; finalGap: number | null; top: string | null; topSeconds: number | null; error: string | null;
  /** Your private room run, to race someone on the same seed */
  private: boolean;
  /** Replay is downloaded */
  hasReplay: boolean;
}

function biggest(a: RaceAnalysis) {
  return (a.report ?? []).flatMap((p) => (p.why ?? []).map((x) => ({ ...x, phase: p.phase })))
    .filter((x) => x.seconds >= 3 && x.key !== "step:other").sort((x, y) => y.seconds - x.seconds)[0];
}
/** Biggest cost in a race, short */
export function topCost(a: RaceAnalysis): string | null {
  const w = biggest(a);
  return w ? `${w.phase} · ${w.label.toLowerCase()} +${Math.round(w.seconds)} s` : null;
}
export const topSeconds = (a: RaceAnalysis): number | null => biggest(a)?.seconds ?? null;

export class Service extends EventEmitter {
  readonly store: Store;
  readonly api: Api;
  private scanner: Scanner;
  private instance: Instance | null = null;
  private watchers: FSWatcher[] = [];
  private timers: NodeJS.Timeout[] = [];
  private pending = new Set<string>();
  private flushTimer: NodeJS.Timeout | null = null;
  private logLines: string[] = [];
  private you = { elo: null as number | null, rank: null as number | null, checkedAt: null as number | null };
  /** Our own copies of your newest Ranked games so they outlive Ranked's temp-replay */
  readonly poolDir: string;
  private startedAt = Date.now();

  constructor(
    dbPath: string,
    private opts: {
      offline?: boolean;
      poolDir?: string;
    } = {},
  ) {
    super();
    this.store = new Store(dbPath);
    this.api = new Api(() => null);
    this.scanner = new Scanner(this.store, this.api);
    this.poolDir = opts.poolDir ?? join(dirname(dbPath), "games");
  }

  // ---- lifecycle

  start() {
    this.locateInstance();
    // Reread every replay if the sorting rules changed
    const LIBRARY_VERSION = 3;
    const fresh = this.store.get<number>("libraryVersion", 1) !== LIBRARY_VERSION;
    this.rescanLibrary(fresh);
    if (fresh) this.store.set("libraryVersion", LIBRARY_VERSION);
    this.pool();
    if (this.settings().autoRace) this.pairRuns(); // Reanalyses anything from an older detector version
    this.adapt(); // Tier shifts come from race history so a stale stored value fixes itself
    this.timers.push(setInterval(() => this.rescanLibrary(), 60_000));
    if (this.opts.offline) return;
    void this.refreshYou();
    void this.scanTick();
    this.timers.push(setInterval(() => void this.scanTick(), 90_000));
    this.timers.push(setInterval(() => void this.refreshYou(), 15 * 60_000));
    this.timers.push(setInterval(() => void this.profileRefresh().catch(() => {}), 10 * 60_000));
    void this.refreshGames();
    this.timers.push(setInterval(() => void this.refreshGames(), 2 * 60_000));
  }

  /** Rescan replay folders, match history and races */
  async refresh() {
    this.rescanLibrary(true);
    this.pool();
    this.pairRuns();
    if (!this.opts.offline) await this.refreshGames();
    this.changed();
  }

  /** Fetch your newest Ranked games so new ones show up right after you play */
  async refreshGames() {
    const s = this.settings();
    if (!s.uuid) return;
    const fetchSince = async (type: 2 | 3, knownIds: Set<number>): Promise<ApiMatch[]> => {
      const collected: ApiMatch[] = [];
      let before: number | undefined;
      for (let page = 0; page < 10; page++) {
        const batch = await this.api.userMatchesPage(s.uuid!, { type, count: 50, before });
        if (!batch.length) break;
        collected.push(...batch);
        const oldest = batch.at(-1)!;
        if (batch.length < 50 || oldest.date < NEW_REPLAYS_SINCE || batch.some((m) => knownIds.has(m.id))) break;
        before = oldest.id;
      }
      return collected;
    };
    const mergeMatches = (fresh: ApiMatch[], existing: ApiMatch[]): ApiMatch[] => {
      const byId = new Map<number, ApiMatch>();
      for (const m of existing) byId.set(m.id, m);
      for (const m of fresh) byId.set(m.id, m);
      return [...byId.values()].sort((a, b) => b.date - a.date || b.id - a.id);
    };
    try {
      const prevGames = this.store.get<ApiMatch[]>("myGames", []);
      const fetchedRanked = (await fetchSince(2, new Set(prevGames.map((m) => m.id))))
        .filter((m) => m.type === 2 && m.date >= NEW_REPLAYS_SINCE);
      const ms = mergeMatches(fetchedRanked, prevGames);
      // Private room runs (type 3). Ranked doesn't save these either, you download them like Ranked games
      // Solo set seed runs get raced vs queued seeds, group rooms with friends get analysed directly
      const prevPrivate = this.store.get<ApiMatch[]>("myPrivate", []);
      const fetchedPrivate = (await fetchSince(3, new Set(prevPrivate.map((m) => m.id))))
        .filter((m) => m.date >= NEW_REPLAYS_SINCE && ((!m.seedType && !m.bastionType && m.players.length === 1) || m.players.length > 1));
      const priv = mergeMatches(fetchedPrivate, prevPrivate);
      this.store.set("myPrivate", priv);
      await this.quickRaces();
      const before = this.store.get<number[] | null>("myGameIds", null);
      this.store.set("myGames", ms);
      this.store.set("myGameIds", ms.map((m) => m.id));
      for (const m of before ? ms.filter((x) => !before.includes(x.id)) : []) {
        const them = m.players.find((p) => p.uuid !== s.uuid);
        this.log(`New ranked game vs ${them?.nickname ?? "?"}`);
        if (s.notify) {
          this.emit("newGame", { id: null, title: `New game vs ${them?.nickname ?? "?"}`, body: "Download the replay in Ranked to analyse it" });
        }
      }
      this.changed();
    } catch (e) { this.log(`Couldn't load your games: ${(e as Error).message}`); }
  }

  private myGames(): MyGame[] {
    const me = this.settings().uuid;
    const ms = this.store.get<ApiMatch[]>("myGames", []);
    const races = this.store.races();
    const runs = this.store.runs();
    const dropped = new Set(this.store.get<number[]>("droppedForfeits", []));
    const priv = this.store.get<ApiMatch[]>("myPrivate", []).filter((m) => !dropped.has(m.id)).map((m): MyGame => {
      // Private room run turns into a race once its replay is here and paired with someone on that seed
      const mine = runs.filter((r) => r.match_id === m.id && (r.kind === "practice" || r.kind === "ranked"));
      const race = races.find((r) => mine.some((x) => x.file === r.your_file) && r.your_file !== r.their_file);
      const a = race && !race.error ? (JSON.parse(race.analysis) as RaceAnalysis) : null;
      const others = m.players.filter((p) => p.uuid !== me).map((p) => p.nickname);
      return {
        id: m.id, date: m.date * 1000, private: true, hasReplay: mine.length > 0,
        opponent: race ? { uuid: race.their_uuid, name: race.their_name, elo: race.their_elo } : { uuid: "", name: others.length ? others.join(", ") : "Your run on a queued seed", elo: null },
        won: null, forfeited: m.forfeited, time: m.result?.time ?? 0,
        seedType: m.seedType || m.bastionType ? `${(m.seedType ?? "?").toLowerCase().replace(/_/g, " ")} / ${(m.bastionType ?? "?").toLowerCase()}` : "set seed",
        raceId: race?.id ?? null, finalGap: race ? race.final_gap : null, top: a?.report ? topCost(a) : null, topSeconds: a?.report ? topSeconds(a) : null, error: race?.error ?? null,
      };
    });
    return [...priv, ...ms.map((m): MyGame => {
      const them = m.players.find((p) => p.uuid !== me) ?? m.players[0];
      const race = races.find((r) => r.key.startsWith(`match|${m.id}|`));
      const a = race && !race.error ? (JSON.parse(race.analysis) as RaceAnalysis) : null;
      return {
        id: m.id, date: m.date * 1000, opponent: { uuid: them.uuid, name: them.nickname, elo: them.eloRate ?? null },
        won: m.result?.uuid ? m.result.uuid === me : null, forfeited: m.forfeited, time: m.result?.time ?? 0,
        seedType: m.seedType || m.bastionType ? `${(m.seedType ?? "?").toLowerCase().replace(/_/g, " ")} / ${(m.bastionType ?? "?").toLowerCase()}` : null,
        raceId: race?.id ?? null, finalGap: race ? race.final_gap : null, top: a?.report ? topCost(a) : null, topSeconds: a?.report ? topSeconds(a) : null, error: race?.error ?? null,
        private: false, hasReplay: runs.some((r) => r.match_id === m.id),
      };
    })];
  }

  stop() {
    for (const t of this.timers) {
      clearInterval(t);
      clearTimeout(t);
    }
    for (const w of this.watchers) w.close();
  }

  private log(msg: string) {
    this.logLines.push(`${new Date().toLocaleTimeString()} ${msg}`);
    if (this.logLines.length > 200) this.logLines.shift();
    this.changed();
  }
  private changed() { this.emit("changed"); }

  // ---- settings

  settings(): Settings {
    const s = this.store.get<Partial<Settings>>("settings", {});
    const out = { ...DEFAULT_SETTINGS, pick: { ...DEFAULT_SETTINGS.pick, ...(s.pick ?? {}) }, prefs: mergePrefs(s.prefs) };
    // Only keep keys we still have, old ones (apiKey, autoDownload...) just get dropped
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) if (k !== "pick" && k !== "prefs" && s[k] !== undefined) (out as Record<string, unknown>)[k] = s[k];
    // From before the welcome screen. Already set up if there's a name
    if (s.onboarded === undefined) out.onboarded = !!s.nickname;
    // The jungle temple filter is gone, don't keep filtering by it with no chip to turn it off
    if (out.pick.seedType === "JUNGLE_TEMPLE") out.pick.seedType = null;
    return out;
  }

  async updateSettings(patch: Partial<Settings>) {
    const cur = this.settings();
    const next = { ...cur, ...patch, pick: { ...cur.pick, ...(patch.pick ?? {}) }, prefs: mergePrefs({ ...cur.prefs, ...(patch.prefs ?? {}) }) };
    if (patch.nickname !== undefined && patch.nickname !== cur.nickname) { next.uuid = null; this.forgetAccount(); }
    // Only forfeits from now on get deleted. The ui sends all its prefs, so its copy of when never counts
    next.prefs.dropForfeitsSince = next.prefs.dropForfeits && !cur.prefs.dropForfeits ? Date.now() : cur.prefs.dropForfeitsSince;
    this.store.set("settings", next);
    if (patch.instancePath !== undefined) { this.locateInstance(); this.rescanLibrary(); }
    if (patch.nickname !== undefined) { if (!this.opts.offline) await this.refreshYou(); this.rescanLibrary(true); }
    this.changed();
  }

  // ---- instance + version gate

  private locateInstance() {
    const s = this.settings();
    this.instance = s.instancePath ? inspectInstance(s.instancePath) : findInstances()[0] ?? null;
    for (const w of this.watchers) w.close();
    this.watchers = [];
    if (!this.instance) { this.log("No MCSR Ranked instance found. Set it in Settings."); return; }
    for (const dir of replayDirs(this.instance)) {
      if (!existsSync(dir)) continue;
      try {
        this.watchers.push(watch(dir, { recursive: true }, (_e, f) => { if (f && String(f).endsWith(".rrf")) this.queueFile(join(dir, String(f))); }));
      } catch { /* Polling covers it */ }
    }
  }

  private refreshInstanceMod() {
    if (!this.instance) return;
    if (!this.instance.modJar || !existsSync(this.instance.modJar)) {
      const updated = inspectInstance(this.instance.root);
      if (updated) this.instance = updated;
    }
  }

  gate(): GateState {
    this.refreshInstanceMod();
    const v = this.instance?.modVersion ?? null;
    const g = this.store.get<Record<string, { status: GateState["status"]; detail: string }>>("gate", {});
    if (!v) return { version: null, status: "unverified", detail: "No Ranked mod found" };
    return { version: v, ...(g[v] ?? { status: "unverified", detail: "No replay made with this version has been checked yet" }) };
  }

  private setGate(status: GateState["status"], detail: string) {
    const v = this.instance?.modVersion;
    if (!v) return;
    const g = this.store.get<Record<string, { status: string; detail: string }>>("gate", {});
    if (g[v]?.status === "failed" && status === "ok") return;
    if (g[v]?.status === status) return;
    g[v] = { status, detail };
    this.store.set("gate", g);
    this.log(status === "ok" ? `Ranked ${v}: replay format checked, all records decode` : `Ranked ${v}: ${detail}`);
  }

  // ---- your account

  /** Save who you are after a lookup. Settings get read again since they could have changed while we waited */
  private learnYou(askedAs: string | null, u: { nickname: string; uuid: string }) {
    const s = this.settings();
    if (s.nickname !== askedAs) return; // Name got changed while we waited
    if (s.uuid === u.uuid && s.nickname) return;
    if (s.uuid && s.uuid !== u.uuid) this.forgetAccount();
    this.store.set("settings", { ...s, nickname: u.nickname, uuid: u.uuid });
    this.rescanLibrary(true); // Runs indexed before we knew who you are need resorting
  }

  /** A different account: drop the old one's games and profile so they don't show up as yours */
  private forgetAccount() {
    this.store.set("myGames", []);
    this.store.set("myPrivate", []);
    this.store.set("myGameIds", null); // So the first fetch for the new account doesn't pop up every game as new
    this.store.dropPrefix("profile:");
    this.you = { elo: null, rank: null, checkedAt: 0 };
  }

  private async refreshYou() {
    const s = this.settings();
    const name = s.nickname;
    if (!name) return;
    try {
      const u = await this.api.user(name);
      this.you = { elo: u.eloRate, rank: u.eloRank, checkedAt: Date.now() };
      this.learnYou(s.nickname, u);
      this.changed();
    } catch (e) { this.log(`Couldn't look up ${name}: ${(e as Error).message}`); }
  }

  /** Whoever shows up in the most local replays is almost certainly you. Only when you ask for it on the welcome screen */
  suggestName(): string | null {
    const count = new Map<string, number>();
    for (const r of this.store.runs()) for (const p of JSON.parse(r.players) as { nickname: string }[]) count.set(p.nickname, (count.get(p.nickname) ?? 0) + 1);
    const best = [...count].sort((a, b) => b[1] - a[1])[0];
    return best && best[1] >= 2 ? best[0] : null;
  }

  /** Checks a name on Ranked before you save it */
  async lookupPlayer(name: string): Promise<{ nickname: string; uuid: string; elo: number | null; rank: number | null } | null> {
    try {
      const u = await this.api.user(name.trim());
      return { nickname: u.nickname, uuid: u.uuid, elo: u.eloRate ?? null, rank: u.eloRank ?? null };
    } catch { return null; }
  }

  // ---- background api scan

  private async scanTick() {
    const added = await this.scanner.tick();
    if (added) this.changed();
    // A few more games near your Elo each time, so the profile's comparison keeps getting better in the background
    const s = this.settings();
    if (s.uuid && this.you.elo !== null) await this.fillBenchmarks(s.uuid, this.you.elo, 6);
    if (this.scanner.lastError) this.log(`Match index: ${this.scanner.lastError}`);
    this.expireQueue();
  }

  /** Loads splits from other players' games near your Elo (and the next rank) until each range has enough to compare
   *  against. The match index knows the games, the splits come from each match's details. At most `calls` API calls */
  private async fillBenchmarks(uuid: string, elo: number | null, calls: number) {
    const ENOUGH = 120;
    let made = 0;
    for (const [lo, hi] of benchmarkBands(elo)) {
      while (made < calls && this.api.remaining() > 80 && this.store.othersInBand(lo, hi, uuid) < ENOUGH) {
        const ids = this.store.benchmarkCandidates(lo, hi, Math.min(10, calls - made));
        if (!ids.length) break;
        for (const id of ids) {
          made++;
          try { this.store.putMatchDetail(await this.api.match(id)); } catch { /* Skip it, the next one will do */ }
        }
      }
    }
    if (made) this.changed();
  }

  private expireQueue() {
    for (const q of this.store.queue(["queued"])) if (Date.now() - q.date * 1000 > QUEUE_EXPIRE_MS) this.store.setQueue(q.match_id, { status: "expired" });
  }

  // ---- library

  rescanLibrary(force = false) {
    this.refreshInstanceMod();
    if (!this.instance) return;
    const seen = new Set<string>();
    for (const dir of [...replayDirs(this.instance), this.poolDir]) {
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir, { recursive: true }) as string[]) {
        if (!f.endsWith(".rrf")) continue;
        const p = join(dir, f);
        seen.add(p);
        let st;
        try { st = statSync(p); } catch { continue; } // Ranked deleted it after we listed it
        const known = this.store.run(p);
        if (force || !known || known.mtime !== Math.round(st.mtimeMs) || known.size !== st.size) this.pending.add(p);
      }
    }
    for (const r of this.store.runs()) if (!seen.has(r.file) && (r.file.startsWith(this.instance.ranked) || r.file.startsWith(this.poolDir))) this.store.dropRun(r.file);
    this.flush();
  }

  private queueFile(p: string) {
    this.pending.add(p);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), 1500); // Let Ranked finish writing
  }

  private flush() {
    const files = [...this.pending];
    this.pending.clear();
    let any = false;
    for (const f of files) any = this.indexFile(f) || any;
    if (any) { this.pool(); this.processQueue(); if (this.settings().autoRace) this.pairRuns(); }
    this.changed();
  }

  private indexFile(p: string): boolean {
    let st;
    try { st = statSync(p); } catch { this.store.dropRun(p); return true; } // Gone, Ranked cleans up temp-replay
    const me = this.settings().uuid;
    const row: RunRow = { file: p, mtime: Math.round(st.mtimeMs), size: st.size, match_id: null, match_type: null, version: null,
      overworld_seed: null, nether_seed: null, players: "[]", kind: "unreadable", error: null, date: null };
    try {
      const files = unzipSync(new Uint8Array(readFileSync(p)), { filter: (f) => f.name === "meta.json" });
      const meta = JSON.parse(strFromU8(files["meta.json"])) as ReplayMeta;
      Object.assign(row, {
        match_id: meta.matchId ?? null, match_type: meta.matchType ?? null, version: meta.version ?? null,
        overworld_seed: meta.overworldSeed, nether_seed: meta.netherSeed, date: meta.date ?? null,
        players: JSON.stringify(meta.players.map((x) => ({ uuid: x.uuid, nickname: x.nickname, eloRate: x.eloRate ?? null }))),
      });
      let kind: RunKind;
      // Our race files are "vs <name> <yyyy-mm-dd> <hhmm>.rrf". A replay you just named "vs someone" isn't one
      if (/^vs .+ \d{4}-\d{2}-\d{2} \d{4}\.rrf$/.test(basename(p)) || this.store.races().some((r) => r.race_file === p && r.your_file !== r.their_file)) kind = "race";
      else if (meta.symmetricKey || (meta.version ?? 0) < 40) { kind = "unreadable"; row.error = "made before MCSR Ranked 6.0.1 (encrypted)"; }
      else if (me && meta.players.some((x) => x.uuid === me)) kind = meta.players.length === 1 ? "practice" : "ranked";
      else kind = "reference";
      row.kind = kind;
    } catch (e) {
      row.error = (e as Error).message;
    }
    this.store.putRun(row);
    return true;
  }

  // ---- queue

  private processQueue() {
    const refs = [...this.store.runs("reference")].sort(
      (a, b) => (b.file.startsWith(this.poolDir) ? 1 : 0) - (a.file.startsWith(this.poolDir) ? 1 : 0),
    );
    for (const r of refs) {
      if (!r.match_id) continue;
      const q = this.store.queueRow(r.match_id);
      if (q && q.status === "queued") {
        this.store.setQueue(r.match_id, { status: "downloaded", file: r.file, overworld_seed: r.overworld_seed, nether_seed: r.nether_seed });
        this.log(`Downloaded ${q.player_name}'s run: seeds ready`);
      }
    }
  }

  async pick(o: PickOptions): Promise<{ picks: Pick[]; notes: string[] }> {
    const s = this.settings();
    if (o.player?.trim()) return pickPlayer(this.store, this.api, s.uuid, o);
    if (this.you.elo === null) await this.refreshYou();
    if (this.you.elo === null) return { picks: [], notes: ["Set your Minecraft name in Settings so Stratas knows your Elo"] };
    if (this.store.matchCount() < 200) await this.scanTick();
    return pickRuns(this.store, this.api, this.you.elo, s.uuid, o);
  }

  enqueue(picks: Pick[]) {
    for (const p of picks) {
      const m = p.match;
      this.store.enqueue({ match_id: m.id, player_uuid: m.winner_uuid!, player_name: m.winner_name!, opponent_name: m.loser_name, date: m.date,
        time: m.time, seed_type: m.seed_type, bastion_type: m.bastion_type, elo: m.winner_elo, tier: p.tier, reason: p.reason });
    }
    this.processQueue();
    this.changed();
  }

  /** You copied a queued seed to play it. Your next private room runs get compared with that run */
  practicing(matchId: number) { this.store.set("practicing", { matchId, at: Date.now() }); }

  /** Your private room runs on a queued seed, compared split by split from Ranked's API. Shows right after you play,
   *  and is all there is when Ranked doesn't save the replay (no iron pickaxe) */
  private async quickRaces() {
    const me = this.settings().uuid;
    if (!me) return;
    const playing = this.store.get<{ matchId: number; at: number } | null>("practicing", null);
    const links = this.store.get<Record<string, number>>("quickLinks", {}); // Your private match -> the queued match you played
    const races = this.store.races(), runs = this.store.runs();
    const dropped = new Set(this.store.get<number[]>("droppedForfeits", []));
    for (const m of this.store.get<ApiMatch[]>("myPrivate", [])) {
      if (m.players.length !== 1 || m.seedType || m.bastionType) continue; // Solo set seed runs only
      if (dropped.has(m.id)) continue;
      if (m.forfeited && this.dropsForfeit(m.date * 1000)) { this.dropForfeit(m.id); continue; }
      // The API doesn't say which seed a set seed room was on, so it's the one you copied last, if you played within 3 hours of that
      if (!links[m.id] && playing && m.date * 1000 >= playing.at && m.date * 1000 - playing.at < 3 * 3600_000) links[m.id] = playing.matchId;
      const q = links[m.id] ? this.store.queueRow(links[m.id]) : undefined;
      if (!q) continue;
      const key = `quick|${m.id}|${q.match_id}`;
      const full = races.some((r) => r.your_file !== r.their_file && !r.error && runs.some((x) => x.file === r.your_file && x.match_id === m.id));
      if (full || this.store.raceByKey(key)) continue;
      const [mine, theirs] = await Promise.all([this.profileMatch(m.id), this.profileMatch(q.match_id)]);
      if (!mine?.timelines || !theirs?.timelines) continue;
      const ended = (d: MatchDetail, uuid: string) =>
        (d.completions?.find((c) => c.uuid === uuid)?.time ?? (d.result?.uuid === uuid || d.players.length === 1 ? d.result?.time : null) ?? d.timelines?.filter((e) => e.uuid === uuid).at(-1)?.time ?? 0) / 1000;
      const analysis = quickRace(
        { matchId: m.id, uuid: me, name: m.players[0]?.nickname ?? "You", elo: this.you.elo, timelines: mine.timelines, seconds: ended(mine, me) },
        { matchId: q.match_id, uuid: q.player_uuid, name: q.player_name, elo: q.elo, timelines: theirs.timelines, seconds: ended(theirs, q.player_uuid) },
        { overworld: q.overworld_seed ?? "", nether: q.nether_seed ?? "" });
      const st = q.seed_type || q.bastion_type ? `${(q.seed_type ?? "?").toLowerCase().replace(/_/g, " ")} / ${(q.bastion_type ?? "?").toLowerCase()}` : null;
      this.store.putRace({ key, your_file: `api:${m.id}`, your_uuid: me, their_file: `api:${q.match_id}`, their_uuid: q.player_uuid, their_name: q.player_name,
        their_elo: q.elo, tier: q.tier, race_file: null, created_at: m.date * 1000, final_gap: analysis.finalGap, seed_type: st, analysis: JSON.stringify(analysis), error: null });
      if (q.status !== "raced") this.store.setQueue(q.match_id, { status: "raced" });
      const made = this.store.raceByKey(key);
      this.log(`Splits ready vs ${q.player_name} (${fmtDur(analysis.finalGap)} ${analysis.finalGap >= 0 ? "behind" : "ahead"})`);
      if (made && this.settings().notify) {
        this.emit("newGame", { id: made.id, title: `vs ${q.player_name} · splits`, body: analysis.quick?.ironPick
          ? "From Ranked's splits. The full breakdown comes once both replays are in"
          : "No iron pickaxe, so Ranked didn't save a replay. Splits only" });
      }
    }
    this.store.set("quickLinks", links);
  }

  setQueueStatus(id: number, status: QueueRow["status"]) {
    this.store.setQueue(id, { status });
    this.changed();
  }

  // ---- races

  /** Pairs your runs with a stronger player's run on the same seed, and analyses your Ranked matches */
  pairRuns(force = false) {
    const me = this.settings().uuid;
    if (!me || !this.instance) return;
    const rank = (f: string) => (f.startsWith(this.poolDir) ? 2 : basename(dirname(f)) === "temp-replay" ? 1 : 0);
    const dedupByMatch = (rows: RunRow[]) => {
      const sorted = [...rows].sort((a, b) => rank(b.file) - rank(a.file));
      const seen = new Set<string | number>();
      return sorted.filter((r) => {
        const k = r.match_id ?? r.file;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    };
    const current = new Set<string>(); // Race keys from the files we pair with now
    const refs = dedupByMatch(this.store.runs("reference"));
    const dropped = new Set(this.store.get<number[]>("droppedForfeits", []));
    const forfeits = new Set(this.store.get<ApiMatch[]>("myPrivate", []).filter((m) => m.forfeited).map((m) => m.id));
    for (const run of dedupByMatch(this.store.runs("practice"))) {
      if (run.match_id && dropped.has(run.match_id)) continue;
      const mates = refs.filter((r) => r.overworld_seed === run.overworld_seed && r.nether_seed === run.nether_seed);
      // Ranked's match list already says you forfeited, don't bother mixing it
      if (mates.length && run.match_id && forfeits.has(run.match_id) && this.dropsForfeit(run.date ?? run.mtime)) { this.dropForfeit(run.match_id); continue; }
      for (const ref of mates) {
        const q = ref.match_id ? this.store.queueRow(ref.match_id) : undefined;
        const players = JSON.parse(ref.players) as { uuid: string; nickname: string; eloRate: number | null }[];
        const them = players.find((p) => p.uuid === q?.player_uuid) ?? players.find((p) => p.uuid === this.winnerOf(ref)) ?? players[0];
        const key = `${run.file}|${ref.file}|${them.uuid}`;
        current.add(key);
        const old = this.store.raceByKey(key);
        if (!force && old && !old.error && JSON.parse(old.analysis || "{}").analysisVersion === ANALYSIS_VERSION) continue;
        this.buildRace(run, ref, them, q?.tier ?? null, key);
        // Ranked's match list can lag behind the replay, a run that never killed the dragon is a forfeit too
        const built = this.store.raceByKey(key);
        if (run.match_id && built && !built.error && !(JSON.parse(built.analysis) as RaceAnalysis).you.finished && this.dropsForfeit(run.date ?? run.mtime)) {
          this.dropForfeit(run.match_id);
          break;
        }
        if (q) this.store.setQueue(q.match_id, { status: "raced" });
        // The full race replaces the quick one from Ranked's splits
        if (run.match_id && !this.store.raceByKey(key)?.error) for (const r of this.store.races()) if (r.key.startsWith(`quick|${run.match_id}|`)) this.store.deleteRace(r.id);
      }
    }
    // Prefer our pooled copy, then Ranked's temp-replay, over a renamed copy of the same match
    const pooled = new Set(this.store.runs("ranked").filter((r) => r.file.startsWith(this.poolDir)).map((r) => r.match_id));
    const ranked = this.store.runs("ranked").filter((r) => !r.match_id || pooled.has(r.match_id) || !pooled.size).sort((a, b) => rank(b.file) - rank(a.file));
    const doneMatches = new Set<string>();
    for (const run of ranked) {
      const players = JSON.parse(run.players) as { uuid: string; nickname: string; eloRate: number | null }[];
      for (const them of players.filter((p) => p.uuid !== me)) {
        const key = `match|${run.match_id ?? run.file}|${them.uuid}`;
        current.add(key);
        if (doneMatches.has(key)) continue;
        doneMatches.add(key);
        const old = this.store.raceByKey(key);
        if (!force && old && !old.error && JSON.parse(old.analysis || "{}").analysisVersion === ANALYSIS_VERSION) continue;
        this.analyzeMatch(run, them, key);
        // Game you just played, tell the app so it pops up
        const made = this.store.raceByKey(key);
        if (!old && made && !made.error && (run.date ?? run.mtime) >= this.startedAt - 10 * 60_000) this.announce(made.id);
      }
    }
    this.dropDuplicateRaces(current);
    this.adapt();
  }

  /**
   * The same game can get paired twice, once from a renamed copy and once from the pool copy.
   * Keep the race made from the files we use now and drop the older one, or it gets counted twice
   */
  private dropDuplicateRaces(current: Set<string>) {
    const game = (f: string) => this.store.run(f)?.match_id ?? f;
    const same = (r: RaceRow) => `${game(r.your_file)}|${game(r.their_file)}|${r.their_uuid}`;
    const races = this.store.races(), keep = new Map<string, string>();
    for (const r of races) if (current.has(r.key)) keep.set(same(r), r.key);
    for (const r of races) {
      const k = keep.get(same(r));
      if (k && k !== r.key) this.store.deleteRace(r.id);
    }
  }

  /** Deleting forfeits is on and this run is from after it got turned on */
  private dropsForfeit(dateMs: number) {
    const p = this.settings().prefs;
    return p.dropForfeits && dateMs >= p.dropForfeitsSince;
  }

  /** You forfeited this private room run: delete its races, the mixed replay and our copy, and never pair it again.
   *  Ranked's own replay files stay, and the seed goes back to the queue so you can race it again */
  private dropForfeit(matchId: number) {
    const gameOf = (f: string) => (f.startsWith("api:") ? Number(f.slice(4)) : this.store.run(f)?.match_id ?? null);
    const rm = (f: string) => {
      try { if (existsSync(f)) rmSync(f); } catch (e) { this.log(`Couldn't delete ${basename(f)}: ${(e as Error).message}`); return; }
      this.store.dropRun(f);
    };
    let who: string | null = null;
    for (const r of this.store.races()) {
      if (r.your_file === r.their_file || gameOf(r.your_file) !== matchId) continue;
      if (r.race_file) rm(r.race_file);
      this.store.deleteRace(r.id);
      who = r.their_name;
      const theirs = gameOf(r.their_file), q = theirs !== null ? this.store.queueRow(theirs) : undefined;
      if (q?.status === "raced") this.store.setQueue(q.match_id, { status: q.file ? "downloaded" : "queued" });
    }
    rm(join(this.poolDir, `${matchId}.rrf`));
    this.store.set("droppedForfeits", [...this.store.get<number[]>("droppedForfeits", []), matchId]);
    this.log(`Forfeited run${who ? ` vs ${who}` : ""} deleted`);
    this.changed();
  }

  /** Copy new format replays with a match_id into the pool so they outlive Ranked's temp-replay */
  private pool() {
    const dropped = new Set(this.store.get<number[]>("droppedForfeits", []));
    const poolable = this.store.runs().filter(
      (r) =>
        r.match_id && !dropped.has(r.match_id) &&
        (r.version ?? 0) >= 40 &&
        (r.kind === "ranked" || r.kind === "practice" || r.kind === "reference"),
    );
    if (!poolable.length) return;
    mkdirSync(this.poolDir, { recursive: true });
    const byMatch = new Map<number, RunRow>();
    for (const r of poolable) {
      if (!byMatch.has(r.match_id!) || r.file.startsWith(this.poolDir)) byMatch.set(r.match_id!, r);
    }
    const newest = [...byMatch.values()].sort((a, b) => (b.date ?? b.mtime) - (a.date ?? a.mtime));
    for (const r of newest) {
      const dest = join(this.poolDir, `${r.match_id}.rrf`);
      if (existsSync(dest) || !existsSync(r.file)) continue;
      try { copyFileSync(r.file, dest); } catch (e) { this.log(`Couldn't save a copy of game ${r.match_id}: ${(e as Error).message}`); continue; }
      this.indexFile(dest);
      this.log(`Saved a copy of game ${r.match_id}`);
    }
  }

  /** What counts as done trading, from settings */
  private leaveGoals() {
    const p = this.settings().prefs;
    return { ender_pearl: p.leavePearls, obsidian: p.leaveObsidian, string: p.leaveString };
  }

  private announce(raceId: number) {
    const s = this.settings();
    if (!s.notify) return;
    const r = this.race(raceId);
    if (!r?.analysis) return;
    const a = r.analysis;
    const top = (a.report ?? []).flatMap((p) => (p.why ?? []).map((w) => ({ ...w, phase: p.phase })))
      .filter((w) => w.seconds >= 3 && w.key !== "step:other").sort((x, y) => y.seconds - x.seconds)[0];
    const gap = Math.round(a.finalGap), sign = gap >= 0 ? "+" : "−", abs = Math.abs(gap);
    const t = abs >= 60 ? `${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}` : `${abs} s`;
    this.emit("newGame", { id: raceId, title: `vs ${r.row.their_name} · ${sign}${t}`,
      body: top ? `Biggest loss: ${top.phase} · ${top.label.toLowerCase()} +${Math.round(top.seconds)} s` : "Analysed" });
  }

  private winnerOf(run: RunRow): string | null {
    try {
      const meta = JSON.parse(strFromU8(unzipSync(new Uint8Array(readFileSync(run.file)), { filter: (f) => f.name === "meta.json" })["meta.json"])) as ReplayMeta;
      return meta.result?.uuid ?? null;
    } catch { return null; }
  }

  private buildRace(run: RunRow, ref: RunRow, them: { uuid: string; nickname: string; eloRate: number | null }, tier: string | null, key: string) {
    const me = this.settings().uuid!;
    const base = { key, your_file: run.file, your_uuid: me, their_file: ref.file, their_uuid: them.uuid, their_name: them.nickname,
      their_elo: them.eloRate, tier, created_at: Date.now(), seed_type: this.seedTypeOf(ref) };
    if (this.gate().status === "failed") {
      this.store.putRace({ ...base, race_file: null, final_gap: 0, analysis: "{}", error: "Ranked's replay format changed in this version; Stratas won't write mixed replays until it's updated" });
      return;
    }
    try {
      const yb = new Uint8Array(readFileSync(run.file)), tb = new Uint8Array(readFileSync(ref.file));
      // Fully decode both first and refuse anything that doesn't decode cleanly
      decodeRrf(yb); decodeRrf(tb);
      const merged = mergeRunners([{ bytes: yb, uuid: me }, { bytes: tb, uuid: them.uuid }]);
      const replay = decodeRrf(merged.bytes);
      const analysis = analyzeRace(replay, me, them.uuid, { leave: this.leaveGoals() });
      const d = new Date(run.mtime);
      const name = `vs ${them.nickname} ${d.toISOString().slice(0, 10)} ${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}.rrf`;
      const out = join(myReplaysDir(this.instance!), name);
      writeFileSync(out, merged.bytes);
      this.indexFile(out);
      this.setGate("ok", "Replays from this version decode completely");
      this.store.putRace({ ...base, race_file: out, final_gap: analysis.finalGap, analysis: JSON.stringify(analysis), error: null });
      this.log(`Game ready: ${name.replace(/\.rrf$/, "")} (${fmtDur(analysis.finalGap)} ${analysis.finalGap >= 0 ? "behind" : "ahead"})`);
    } catch (e) {
      const msg = (e as Error).message;
      if (e instanceof ReplayError && run.mtime > (this.instance?.modTime ?? 0)) this.setGate("failed", msg);
      this.store.putRace({ ...base, race_file: null, final_gap: 0, analysis: "{}", error: msg });
      this.log(`Couldn't build the mixed replay vs ${them.nickname}: ${msg}`);
    }
    this.changed();
  }

  private analyzeMatch(run: RunRow, them: { uuid: string; nickname: string; eloRate: number | null }, key: string) {
    const me = this.settings().uuid!;
    const base = { key, your_file: run.file, your_uuid: me, their_file: run.file, their_uuid: them.uuid, their_name: them.nickname,
      their_elo: them.eloRate, tier: null, race_file: run.file, created_at: run.date ?? run.mtime, seed_type: this.seedTypeOf(run) };
    try {
      const replay = decodeRrf(new Uint8Array(readFileSync(run.file)));
      const analysis = analyzeRace(replay, me, them.uuid, { leave: this.leaveGoals() });
      this.store.putRace({ ...base, final_gap: analysis.finalGap, analysis: JSON.stringify(analysis), error: null });
      if (run.mtime > (this.instance?.modTime ?? 0)) this.setGate("ok", "Replays from this version decode completely");
    } catch (e) {
      if (e instanceof ReplayError && run.mtime > (this.instance?.modTime ?? 0)) this.setGate("failed", (e as Error).message);
      this.store.putRace({ ...base, final_gap: 0, analysis: "{}", error: (e as Error).message });
    }
  }

  private seedTypeOf(run: RunRow): string | null {
    if (!run.match_id) return null;
    const m = this.store.match(run.match_id) ?? null;
    const q = this.store.queueRow(run.match_id);
    const st = m?.seed_type ?? q?.seed_type, bt = m?.bastion_type ?? q?.bastion_type;
    return st || bt ? `${(st ?? "?").toLowerCase().replace(/_/g, " ")} / ${(bt ?? "?").toLowerCase()}` : null;
  }

  private adapt() {
    this.store.set("tierShift", adaptTiers(this.store.races()));
  }

  race(id: number): { row: RaceRow; analysis: RaceAnalysis | null } | null {
    const row = this.store.race(id);
    if (!row) return null;
    return { row, analysis: row.error ? null : (JSON.parse(row.analysis) as RaceAnalysis) };
  }

  deleteRace(id: number) { this.store.deleteRace(id); this.changed(); }

  /** Redo every analysis, like after detection got better */
  reanalyzeAll() {
    this.pairRuns(true); // Old analyses stay until the new one is made, so a missing replay doesn't wipe one

    this.changed();
  }

  // ---- state for the ui

  state(): AppState {
    const races = this.store.races();
    const shift = this.store.get<TierShift>("tierShift", { next: 0, stretch: 0, ceiling: 0 });
    const lib = { practice: 0, ranked: 0, reference: 0, unreadable: 0 };
    for (const r of this.store.runs()) if (r.kind in lib) lib[r.kind as keyof typeof lib]++;
    return {
      settings: this.settings(),
      instance: this.instance,
      instances: findInstances().map((i) => ({ path: i.root, name: instanceName(i.root) })),
      gate: this.gate(),
      you: this.you,
      index: { matches: this.store.matchCount(), scanning: this.scanner.busy, error: this.scanner.lastError, apiLeft: this.api.remaining() },
      queue: this.store.queue().filter((q) => q.status !== "skipped"),
      races: races.map((r) => {
        const a = r.error ? null : (JSON.parse(r.analysis) as RaceAnalysis);
        return { id: r.id, createdAt: r.created_at, theirName: r.their_name, theirElo: r.their_elo, tier: r.tier, finalGap: r.final_gap,
          seedType: r.seed_type, raceFile: r.race_file, error: r.error, top: a?.report ? topCost(a) : a?.losses?.[0] ? summaryLine(a.losses[0]) : null,
          topSeconds: a?.report ? topSeconds(a) : null,
          kind: r.your_file === r.their_file ? "match" : "race", quick: !!a?.quick };
      }),
      // Quick races have no reasons to learn habits from
      insights: buildInsights(races.filter((r) => !r.error && !r.key.startsWith("quick|")).map((r) => ({ id: r.id, name: r.their_name, createdAt: r.created_at, finalGap: r.final_gap, seedType: r.seed_type, analysis: JSON.parse(r.analysis) as RaceAnalysis }))),
      tiers: this.you.elo !== null ? {
        ...tierBands(this.you.elo, shift),
      } : null,
      library: lib,
      myGames: this.myGames(),
      log: this.logLines.slice(-40),
    };
  }

  // ---- profile

  async profile(season?: number, pool = 50): Promise<ProfileData> {
    const s = this.settings();
    const nameOrUuid = s.uuid ?? s.nickname;
    let raw = loadCachedProfileRaw(this.store, season);

    if (!raw && !this.opts.offline && nameOrUuid) {
      try {
        raw = await fetchProfile(this.store, this.api, nameOrUuid, season, { offline: this.opts.offline });
        if (raw.user) {
          const u = raw.user;
          if (season === undefined) {
            this.you = { elo: u.eloRate ?? null, rank: u.eloRank ?? null, checkedAt: Date.now() };
          }
          this.learnYou(s.nickname, u);
          this.changed();
        }
      } catch (e) {
        this.log(`Couldn't load profile: ${(e as Error).message}`);
      }
    }

    if (!raw) {
      const fallbackMatches = this.store.get<MatchDetail[]>("myGames", []);
      const details = this.store.matchDetails(fallbackMatches.map((m) => m.id));
      raw = {
        user: null,
        seasons: null,
        matches: fallbackMatches,
        details,
        partial: false,
        fetchedAt: Date.now(),
        apiCallsMade: 0,
      };
    } else if (raw.user && this.you.elo === null && season === undefined) {
      this.you = { elo: raw.user.eloRate ?? null, rank: raw.user.eloRank ?? null, checkedAt: raw.fetchedAt };
    }

    const curSettings = this.settings();
    const uuid = raw.user?.uuid ?? curSettings.uuid ?? "";
    const seasonResults: Record<string, SeasonResultEntry> = {
      ...(raw.user?.seasonResults ?? {}),
      ...(raw.seasons?.seasonResults ?? {}),
    };
    const userSeason = season ?? raw.user?.season;
    if (userSeason !== undefined && raw.user?.seasonResult && !seasonResults[String(userSeason)]) {
      seasonResults[String(userSeason)] = raw.user.seasonResult;
    }
    const availableSeasons = Object.keys(seasonResults)
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => b - a);

    const seasonLast = userSeason !== undefined ? seasonResults[String(userSeason)]?.last : undefined;
    const elo = raw.user?.eloRate ?? seasonLast?.eloRate ?? this.you.elo;
    const globalRank = raw.user?.eloRank ?? seasonLast?.eloRank ?? this.you.rank;

    const user: ProfileUser | null = raw.user
      ? {
          uuid: raw.user.uuid,
          nickname: raw.user.nickname,
          roleType: raw.user.roleType ?? raw.seasons?.roleType,
          elo,
          rank: rankOf(elo),
          globalRank,
          country: raw.user.country ?? raw.seasons?.country ?? null,
          nextDecay: season === undefined ? (raw.user.timestamp?.nextDecay ?? null) : null,
          season: userSeason,
          availableSeasons,
          seasonResults,
        }
      : curSettings.uuid || curSettings.nickname
        ? {
            uuid: curSettings.uuid ?? "",
            nickname: curSettings.nickname ?? "Player",
            elo,
            rank: rankOf(elo),
            globalRank,
            country: null,
            nextDecay: null,
            season: userSeason,
            availableSeasons: [],
            seasonResults: {},
          }
        : null;

    if (!this.opts.offline && uuid) await this.fillBenchmarks(uuid, elo ?? null, 30);
    const { stats, eloHistory, breakdowns } = analyzeRanked(uuid, raw.matches, raw.details, raw.user, season);
    const splits = analyzeSplitsProfile(this.store, uuid, elo, raw.details, pool);
    const { scorecard, details: scorecardDetails } = buildScorecard(stats, splits);

    const normUuid = (u: string | null | undefined) => (u ?? "").replace(/-/g, "").toLowerCase();
    const meNorm = normUuid(uuid);
    const myGames = this.myGames();
    const myGamesById = new Map(myGames.filter((g) => !g.private).map((g) => [g.id, g]));
    const races = this.store.races();
    const runs = this.store.runs();

    const rankedRawMatches = (raw.matches ?? []).filter(
      (m): m is MatchDetail =>
        Boolean(m) &&
        m.type === 2 &&
        (season === undefined || m.season === undefined || m.season === season),
    );

    let matches: ProfileMatch[];
    if (rankedRawMatches.length > 0) {
      matches = rankedRawMatches.map((m): ProfileMatch => {
        const local = myGamesById.get(m.id);
        const detail = this.store.matchDetail(m.id);
        const mePlayer = m.players?.find((p) => normUuid(p.uuid) === meNorm);
        const oppPlayer = m.players?.find((p) => normUuid(p.uuid) !== meNorm) ?? m.players?.[0];
        const changesList = m.changes ?? detail?.changes;
        const myChangeObj = changesList?.find((c) => normUuid(c.uuid) === meNorm);
        const oppChangeObj = changesList?.find((c) => normUuid(c.uuid) !== meNorm);

        const myEloRate = myChangeObj?.eloRate ?? mePlayer?.eloRate ?? null;
        const myChange =
          typeof myChangeObj?.change === "number" && Number.isFinite(myChangeObj.change)
            ? myChangeObj.change
            : null;
        const myEloAfter =
          myEloRate !== null && myChange !== null ? myEloRate + myChange : myEloRate;

        const oppEloRate = oppChangeObj?.eloRate ?? oppPlayer?.eloRate ?? local?.opponent.elo ?? null;
        const oppChange =
          typeof oppChangeObj?.change === "number" && Number.isFinite(oppChangeObj.change)
            ? oppChangeObj.change
            : null;
        const oppEloAfter =
          oppEloRate !== null && oppChange !== null ? oppEloRate + oppChange : oppEloRate;

        const race = races.find((r) => r.key.startsWith(`match|${m.id}|`));
        const a = race && !race.error ? (JSON.parse(race.analysis) as RaceAnalysis) : null;

        const rawSeedType =
          m.seedType ?? m.seed?.overworld ?? detail?.seedType ?? detail?.seed?.overworld ?? null;
        const bastionType =
          m.bastionType ?? m.seed?.nether ?? detail?.bastionType ?? detail?.seed?.nether ?? null;
        const seedType =
          local?.seedType ??
          (rawSeedType || bastionType
            ? `${(rawSeedType ?? "?").toLowerCase().replace(/_/g, " ")} / ${(bastionType ?? "?").toLowerCase()}`
            : null);

        const won = m.result?.uuid ? normUuid(m.result.uuid) === meNorm : null;
        const dateMs = m.date > 1e11 ? m.date : m.date * 1000;

        return {
          id: m.id,
          date: dateMs,
          opponent: {
            uuid: oppPlayer?.uuid ?? local?.opponent.uuid ?? "",
            name: oppPlayer?.nickname ?? local?.opponent.name ?? "Unknown",
            elo: oppEloRate,
          },
          won,
          forfeited: Boolean(m.forfeited),
          time: m.result?.time ?? local?.time ?? 0,
          seedType,
          raceId: local?.raceId ?? race?.id ?? null,
          finalGap: local?.finalGap ?? (race ? race.final_gap : null),
          top: local?.top ?? (a?.report ? topCost(a) : null),
          topSeconds: local?.topSeconds ?? (a?.report ? topSeconds(a) : null),
          error: local?.error ?? race?.error ?? null,
          private: false,
          hasReplay: local?.hasReplay ?? runs.some((r) => r.match_id === m.id),
          eloRate: myEloRate,
          eloAfter: myEloAfter,
          change: myChange,
          opponentEloAfter: oppEloAfter,
          opponentChange: oppChange,
          bastionType,
          rawSeedType,
          hasDetail: Boolean(detail || (Array.isArray(m.timelines) && m.timelines.length > 0)),
          winChance: eloWinChance(myEloRate, oppEloRate),
        };
      });
    } else {
      matches = myGames
        .filter((g) => !g.private)
        .map((g): ProfileMatch => {
          const detail = this.store.matchDetail(g.id);
          const myChangeObj = detail?.changes?.find((c) => normUuid(c.uuid) === meNorm);
          const oppChangeObj = detail?.changes?.find((c) => normUuid(c.uuid) !== meNorm);
          const myEloRate = myChangeObj?.eloRate ?? elo ?? null;
          const myChange =
            typeof myChangeObj?.change === "number" && Number.isFinite(myChangeObj.change)
              ? myChangeObj.change
              : null;
          const myEloAfter =
            myEloRate !== null && myChange !== null ? myEloRate + myChange : myEloRate;
          const oppEloRate = oppChangeObj?.eloRate ?? g.opponent.elo ?? null;
          const oppChange =
            typeof oppChangeObj?.change === "number" && Number.isFinite(oppChangeObj.change)
              ? oppChangeObj.change
              : null;
          const oppEloAfter =
            oppEloRate !== null && oppChange !== null ? oppEloRate + oppChange : oppEloRate;
          const rawSeedType = detail?.seedType ?? detail?.seed?.overworld ?? null;
          const bastionType = detail?.bastionType ?? detail?.seed?.nether ?? null;
          return {
            ...g,
            eloRate: myEloRate,
            eloAfter: myEloAfter,
            change: myChange,
            opponentEloAfter: oppEloAfter,
            opponentChange: oppChange,
            bastionType,
            rawSeedType,
            hasDetail: Boolean(detail),
            winChance: eloWinChance(myEloRate, oppEloRate),
          };
        });
    }

    const replays = analyzeReplayTrends(this.store.races());
    const insights = buildProfileInsights({
      stats,
      splits,
      replays,
      scorecardDetails,
      matches,
    });

    return {
      user,
      stats,
      eloHistory,
      splits,
      scorecard,
      scorecardDetails,
      breakdowns,
      matches,
      replays,
      insights,
      fetchedAt: raw.fetchedAt ?? null,
      partial: Boolean(raw.partial),
      offline: Boolean(this.opts.offline),
    };
  }

  async profileRefresh(season?: number, pool = 50): Promise<ProfileData> {
    const s = this.settings();
    const nameOrUuid = s.uuid ?? s.nickname;
    if (nameOrUuid) {
      const raw = await fetchProfile(this.store, this.api, nameOrUuid, season, { offline: this.opts.offline });
      if (raw.user) {
        const u = raw.user;
        if (season === undefined) {
          this.you = { elo: u.eloRate ?? null, rank: u.eloRank ?? null, checkedAt: Date.now() };
        }
        this.learnYou(s.nickname, u);
      }
      this.log(`Profile refreshed (${raw.apiCallsMade} API calls)`);
      this.changed();
    }
    return this.profile(season, pool);
  }

  /** The player's Elo going into a match and what they gained, to spot it in their Recent Matches */
  async matchElo(uuid: string, matchId: number): Promise<{ elo: number; change: number } | null> {
    try {
      const c = (await this.profileMatch(matchId))?.changes?.find((x) => x.uuid === uuid);
      return c && c.eloRate != null && c.change != null ? { elo: c.eloRate, change: c.change } : null;
    } catch (e) {
      this.log(`Couldn't load ${uuid}'s matches: ${(e as Error).message}`);
      return null;
    }
  }

  async profileMatch(id: number): Promise<MatchDetail | null> {
    const hit = this.store.matchDetail(id);
    if (hit) return hit;
    if (!this.opts.offline) {
      try {
        const m = await this.api.match(id);
        this.store.putMatchDetail(m);
        return m;
      } catch (e) {
        this.log(`Couldn't load match ${id}: ${(e as Error).message}`);
      }
    }
    return null;
  }
}
