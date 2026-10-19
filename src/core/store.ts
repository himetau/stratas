// Local SQLite DB (node:sqlite). Match index, players, download queue, replay library, races, settings
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ApiMatch } from "./seeds/api";
import { hasReplay } from "./seeds/api";
import type { MatchDetail } from "./profile/types";
import { extractSplitsFromTimeline, type SplitRow } from "./seeds/atlas";

export interface MatchRow {
  id: number; date: number; seed_type: string | null; bastion_type: string | null; variations: string;
  winner_uuid: string | null; winner_name: string | null; winner_elo: number | null;
  loser_uuid: string | null; loser_name: string | null; loser_elo: number | null;
  time: number; forfeited: number; replay: number;
}

export type QueueStatus = "queued" | "downloaded" | "raced" | "expired" | "skipped";
export interface QueueRow {
  match_id: number; player_uuid: string; player_name: string; opponent_name: string | null; date: number; time: number;
  seed_type: string | null; bastion_type: string | null; elo: number | null; tier: string; reason: string;
  added_at: number; status: QueueStatus; file: string | null; overworld_seed: string | null; nether_seed: string | null;
}

export type RunKind = "practice" | "ranked" | "reference" | "race" | "unreadable";
export interface RunRow {
  file: string; mtime: number; size: number; match_id: number | null; match_type: number | null; version: number | null;
  overworld_seed: string | null; nether_seed: string | null; players: string; kind: RunKind; error: string | null; date: number | null;
}

export interface RaceRow {
  id: number; key: string; your_file: string; your_uuid: string; their_file: string; their_uuid: string; their_name: string;
  their_elo: number | null; tier: string | null; race_file: string | null; created_at: number; final_gap: number;
  seed_type: string | null; analysis: string; error: string | null;
}

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS matches (
        id INTEGER PRIMARY KEY, date INTEGER, seed_type TEXT, bastion_type TEXT, variations TEXT,
        winner_uuid TEXT, winner_name TEXT, winner_elo INTEGER, loser_uuid TEXT, loser_name TEXT, loser_elo INTEGER,
        time INTEGER, forfeited INTEGER, replay INTEGER);
      CREATE INDEX IF NOT EXISTS matches_elo ON matches (winner_elo);
      CREATE INDEX IF NOT EXISTS matches_date ON matches (date);
      CREATE TABLE IF NOT EXISTS players (uuid TEXT PRIMARY KEY, name TEXT, fetched_at INTEGER, matches INTEGER, medians TEXT);
      CREATE TABLE IF NOT EXISTS queue (
        match_id INTEGER PRIMARY KEY, player_uuid TEXT, player_name TEXT, opponent_name TEXT, date INTEGER, time INTEGER,
        seed_type TEXT, bastion_type TEXT, elo INTEGER, tier TEXT, reason TEXT, added_at INTEGER, status TEXT,
        file TEXT, overworld_seed TEXT, nether_seed TEXT);
      CREATE TABLE IF NOT EXISTS runs (
        file TEXT PRIMARY KEY, mtime INTEGER, size INTEGER, match_id INTEGER, match_type INTEGER, version INTEGER,
        overworld_seed TEXT, nether_seed TEXT, players TEXT, kind TEXT, error TEXT, date INTEGER);
      CREATE TABLE IF NOT EXISTS races (
        id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE, your_file TEXT, your_uuid TEXT, their_file TEXT, their_uuid TEXT,
        their_name TEXT, their_elo INTEGER, tier TEXT, race_file TEXT, created_at INTEGER, final_gap REAL, seed_type TEXT,
        analysis TEXT, error TEXT);
      CREATE TABLE IF NOT EXISTS splits (
        match_id INTEGER, uuid TEXT, elo INTEGER, won INTEGER, seed_type TEXT, bastion_type TEXT,
        nether INTEGER, bastion INTEGER, fortress INTEGER, blind INTEGER, eye INTEGER, end INTEGER, finish INTEGER,
        PRIMARY KEY (match_id, uuid));
      CREATE INDEX IF NOT EXISTS splits_elo ON splits (elo);
      CREATE TABLE IF NOT EXISTS match_detail (id INTEGER PRIMARY KEY, json TEXT, fetched_at INTEGER);
      DROP TABLE IF EXISTS replay_fetches;
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
    `);
  }

  // ---- settings / key-value
  get<T>(key: string, fallback: T): T {
    const r = this.db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
    return r ? (JSON.parse(r.value) as T) : fallback;
  }
  /** Drop every kv entry starting with this, like all the cached profile:<season> ones */
  dropPrefix(prefix: string) { this.db.prepare("DELETE FROM kv WHERE key LIKE ? ESCAPE '\\'").run(prefix.replace(/[\\%_]/g, "\\$&") + "%"); }
  set(key: string, value: unknown) {
    this.db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
  }

  // ---- match index
  putMatches(ms: ApiMatch[]): number {
    const st = this.db.prepare(`INSERT OR REPLACE INTO matches VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    let n = 0;
    for (const m of ms) {
      if (m.type !== 2 || m.players.length !== 2) continue;
      const w = m.players.find((p) => p.uuid === m.result?.uuid) ?? null;
      const l = m.players.find((p) => p.uuid !== m.result?.uuid) ?? null;
      const rep = m.replayExist ?? m.replayExists;
      const replayCode = typeof rep === "number" ? rep : hasReplay(m) ? 1 : 0;
      st.run(m.id, m.date, m.seedType ?? m.seed?.overworld ?? null, m.bastionType ?? m.seed?.nether ?? null, JSON.stringify(m.seed?.variations ?? []),
        w?.uuid ?? null, w?.nickname ?? null, w?.eloRate ?? null, l?.uuid ?? null, l?.nickname ?? null, l?.eloRate ?? null,
        m.result?.time ?? 0, m.forfeited ? 1 : 0, replayCode);
      n++;
    }
    return n;
  }
  matchCount() { return (this.db.prepare("SELECT COUNT(*) AS n FROM matches").get() as { n: number }).n; }
  newestMatchId() { return (this.db.prepare("SELECT MAX(id) AS id FROM matches").get() as { id: number | null }).id; }
  oldestMatch() { return this.db.prepare("SELECT id, date FROM matches ORDER BY id ASC LIMIT 1").get() as { id: number; date: number } | undefined; }
  match(id: number) { return this.db.prepare("SELECT * FROM matches WHERE id = ?").get(id) as MatchRow | undefined; }

  candidates(o: { minElo: number; maxElo: number; since: number; seedType?: string | null; bastionType?: string | null; maxTime?: number | null }): MatchRow[] {
    const where = ["winner_elo BETWEEN ? AND ?", "date >= ?", "forfeited = 0", "replay >= 1", "time > 0"];
    const args: (string | number)[] = [o.minElo, o.maxElo, o.since];
    if (o.seedType) { where.push("seed_type = ?"); args.push(o.seedType); }
    if (o.bastionType) { where.push("bastion_type = ?"); args.push(o.bastionType); }
    if (o.maxTime) { where.push("time <= ?"); args.push(o.maxTime); }
    return this.db.prepare(`SELECT * FROM matches WHERE ${where.join(" AND ")} ORDER BY date DESC LIMIT 400`).all(...args) as unknown as MatchRow[];
  }
  /** Median winning time for an Elo band and seed type */
  bandMedian(minElo: number, maxElo: number, seedType: string | null, bastionType: string | null): number | null {
    const rows = this.db.prepare(`SELECT time FROM matches WHERE winner_elo BETWEEN ? AND ? AND forfeited = 0 AND time > 0
      AND (? IS NULL OR seed_type = ?) AND (? IS NULL OR bastion_type = ?) ORDER BY time`).all(minElo, maxElo, seedType, seedType, bastionType, bastionType) as { time: number }[];
    return rows.length >= 3 ? rows[rows.length >> 1].time : null;
  }

  // ---- players
  player(uuid: string) { return this.db.prepare("SELECT * FROM players WHERE uuid = ?").get(uuid) as { uuid: string; name: string; fetched_at: number; matches: number; medians: string } | undefined; }
  putPlayer(uuid: string, name: string, matches: number, medians: Record<string, number>) {
    this.db.prepare("INSERT OR REPLACE INTO players VALUES (?,?,?,?,?)").run(uuid, name, Date.now(), matches, JSON.stringify(medians));
  }

  // ---- queue
  queue(statuses?: QueueStatus[]): QueueRow[] {
    const rows = this.db.prepare("SELECT * FROM queue ORDER BY added_at DESC").all() as unknown as QueueRow[];
    return statuses ? rows.filter((r) => statuses.includes(r.status)) : rows;
  }
  queueRow(id: number) { return this.db.prepare("SELECT * FROM queue WHERE match_id = ?").get(id) as QueueRow | undefined; }
  enqueue(r: Omit<QueueRow, "added_at" | "status" | "file" | "overworld_seed" | "nether_seed">) {
    this.db.prepare(`INSERT OR IGNORE INTO queue VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL)`).run(
      r.match_id, r.player_uuid, r.player_name, r.opponent_name, r.date, r.time, r.seed_type, r.bastion_type, r.elo, r.tier, r.reason, Date.now(), "queued");
  }
  setQueue(id: number, patch: Partial<Pick<QueueRow, "status" | "file" | "overworld_seed" | "nether_seed">>) {
    for (const [k, v] of Object.entries(patch)) this.db.prepare(`UPDATE queue SET ${k} = ? WHERE match_id = ?`).run(v as string, id);
  }

  // ---- local replay library
  run(file: string) { return this.db.prepare("SELECT * FROM runs WHERE file = ?").get(file) as RunRow | undefined; }
  runs(kind?: RunKind) {
    return (kind ? this.db.prepare("SELECT * FROM runs WHERE kind = ? ORDER BY mtime DESC").all(kind) : this.db.prepare("SELECT * FROM runs ORDER BY mtime DESC").all()) as unknown as RunRow[];
  }
  putRun(r: RunRow) {
    this.db.prepare("INSERT OR REPLACE INTO runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(
      r.file, r.mtime, r.size, r.match_id, r.match_type, r.version, r.overworld_seed, r.nether_seed, r.players, r.kind, r.error, r.date);
  }
  dropRun(file: string) { this.db.prepare("DELETE FROM runs WHERE file = ?").run(file); }

  // ---- races
  race(id: number) { return this.db.prepare("SELECT * FROM races WHERE id = ?").get(id) as RaceRow | undefined; }
  raceByKey(key: string) { return this.db.prepare("SELECT * FROM races WHERE key = ?").get(key) as RaceRow | undefined; }
  races() { return this.db.prepare("SELECT * FROM races ORDER BY created_at DESC, id DESC").all() as unknown as RaceRow[]; }
  putRace(r: Omit<RaceRow, "id">): number {
    const res = this.db.prepare(`INSERT INTO races (key, your_file, your_uuid, their_file, their_uuid, their_name, their_elo, tier, race_file, created_at, final_gap, seed_type, analysis, error)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET race_file = excluded.race_file, final_gap = excluded.final_gap,
      analysis = excluded.analysis, error = excluded.error,
      seed_type = COALESCE(excluded.seed_type, races.seed_type), their_name = COALESCE(excluded.their_name, races.their_name),
      their_elo = COALESCE(excluded.their_elo, races.their_elo), tier = COALESCE(excluded.tier, races.tier)`).run(
      r.key, r.your_file, r.your_uuid, r.their_file, r.their_uuid, r.their_name, r.their_elo, r.tier, r.race_file, r.created_at, r.final_gap, r.seed_type, r.analysis, r.error);
    return Number(res.lastInsertRowid) || this.raceByKey(r.key)!.id;
  }
  deleteRace(id: number) { this.db.prepare("DELETE FROM races WHERE id = ?").run(id); }

  // ---- match details
  matchDetail(id: number): MatchDetail | undefined {
    const r = this.db.prepare("SELECT json FROM match_detail WHERE id = ?").get(id) as { json: string } | undefined;
    return r ? (JSON.parse(r.json) as MatchDetail) : undefined;
  }
  putMatchDetail(m: MatchDetail): void {
    this.db.prepare("INSERT OR REPLACE INTO match_detail VALUES (?, ?, ?)").run(m.id, JSON.stringify(m), Date.now());
    if (m.timelines?.length) {
      this.putSplits(extractSplitsFromTimeline(m, m.timelines));
    }
  }
  matchDetails(ids: number[]): MatchDetail[] {
    const out: MatchDetail[] = [];
    for (const id of ids) {
      const d = this.matchDetail(id);
      if (d) out.push(d);
    }
    return out;
  }

  // ---- elo benchmark atlas splits
  putSplits(rows: SplitRow[]): number {
    const st = this.db.prepare(`INSERT OR REPLACE INTO splits VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const r of rows) {
      st.run(r.matchId, r.uuid, r.elo, r.won ? 1 : 0, r.seedType, r.bastionType, r.nether, r.bastion, r.fortress, r.blind, r.eye, r.end, r.finish);
    }
    return rows.length;
  }
  private mapSplitRow(r: Record<string, unknown>): SplitRow {
    return {
      matchId: Number(r.match_id), uuid: String(r.uuid), elo: r.elo !== null ? Number(r.elo) : null, won: Boolean(r.won),
      seedType: (r.seed_type as string | null) ?? null, bastionType: (r.bastion_type as string | null) ?? null,
      nether: (r.nether as number | null) ?? null, bastion: (r.bastion as number | null) ?? null,
      fortress: (r.fortress as number | null) ?? null, blind: (r.blind as number | null) ?? null,
      eye: (r.eye as number | null) ?? null, end: (r.end as number | null) ?? null, finish: (r.finish as number | null) ?? null,
    };
  }
  splitsForBand(minElo: number, maxElo: number, seedType: string | null = null, bastionType: string | null = null): SplitRow[] {
    const raw = this.db.prepare(`SELECT * FROM splits WHERE elo BETWEEN ? AND ? AND (? IS NULL OR seed_type = ?) AND (? IS NULL OR bastion_type = ?)`).all(
      minElo, maxElo, seedType, seedType, bastionType, bastionType,
    ) as Record<string, unknown>[];
    return raw.map((r) => this.mapSplitRow(r));
  }
}
