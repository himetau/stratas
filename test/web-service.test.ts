// The whole loop again, but on the browser build's stand-ins for node:fs, node:sqlite and node:zlib
import { describe, expect, it, vi } from "vitest";
vi.mock("node:fs", async () => await import("../web/shims/fs"));
vi.mock("node:sqlite", async () => await import("../web/shims/sqlite"));
vi.mock("node:zlib", async () => await import("../web/shims/zlib"));
import { readFile } from "node:fs/promises";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import initSqlJs from "sql.js";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "../web/shims/fs";
import { exportDb, useSqlJs } from "../web/shims/sqlite";
import { mergeRunners } from "../src/core/replay/merge";
import { decodeRrf } from "../src/core/replay/decode";
import { Service } from "../src/core/service";

const ME = "fba98cacdc6a495eba271ee046dcbba9";
const CHAV = "e1b919fe90b044b484ff93979e8308a4";

describe("browser build: the whole loop in memory", () => {
  it("their replay -> seeds -> your replay -> mixed replay you can download", async () => {
    const CHAVRON = new Uint8Array(await readFile(new URL("./fixtures/chavron-14182329.rrf", import.meta.url)));
    const solo = (uuid: string, patch: Record<string, unknown>) => {
      const files = unzipSync(mergeRunners([{ bytes: CHAVRON, uuid }]).bytes);
      return zipSync({ ...files, "meta.json": strToU8(JSON.stringify({ ...JSON.parse(strFromU8(files["meta.json"])), ...patch })) });
    };
    useSqlJs(await initSqlJs(), null);
    const mc = "/ranked/minecraft";
    mkdirSync(`${mc}/mcsrranked/replay`);
    writeFileSync(`${mc}/mods/mcsrranked-web.jar`, new Uint8Array(0));
    const svc = new Service("/data/stratas.db", { offline: true });
    svc.store.set("settings", { nickname: "cyoshi", uuid: ME, instancePath: "/ranked" });
    svc.start();
    svc.store.enqueue({ match_id: 14182329, player_uuid: CHAV, player_name: "Chavron", opponent_name: "cyoshi", date: Math.floor(Date.now() / 1000),
      time: 785002, seed_type: "VILLAGE", bastion_type: "STABLES", elo: 1390, tier: "next", reason: "test" });

    writeFileSync(`${mc}/mcsrranked/replay/chav.rrf`, solo(CHAV, { matchId: 14182329 }));
    svc.rescanLibrary();
    expect(svc.store.queueRow(14182329)!.overworld_seed).toBe("-3566570342730286256");

    writeFileSync(`${mc}/mcsrranked/replay/mine.rrf`, solo(ME, { matchId: 99999999, matchType: 3 }));
    svc.rescanLibrary();
    const race = svc.state().races.find((r) => r.kind === "race")!;
    expect(race.error).toBeNull();
    expect(Math.round(race.finalGap)).toBe(159);
    // The mixed replay is in memory, and it decodes (zstd frames written by the browser stand-in)
    const file = readdirSync(`${mc}/mcsrranked/replay`).find((f) => f.startsWith("vs Chavron "))!;
    const mixed = decodeRrf(readFileSync(`${mc}/mcsrranked/replay/${file}`) as Uint8Array);
    expect(mixed.events.size).toBe(2);
    // And the database can be saved for next visit
    expect(exportDb()!.length).toBeGreaterThan(10_000);
    svc.stop();
  });
});
