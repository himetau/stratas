import { describe, expect, it, vi } from "vitest";
import { deepStrictEqual } from "node:assert";
vi.mock("node:fs", async () => await import("../web/shims/fs"));
vi.mock("node:sqlite", async () => await import("../web/shims/sqlite"));
vi.mock("node:zlib", async () => await import("../web/shims/zlib"));
// The site swaps node:path for path-browserify too, so paths are "/" on Windows like in a browser
vi.mock("node:path", async () => {
  const p = (await import("path-browserify")).default;
  return { ...p, default: p };
});
import { readFile } from "node:fs/promises";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import initSqlJs from "sql.js";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "../web/shims/fs";
import { exportDb, useSqlJs } from "../web/shims/sqlite";
import { mergeRunners } from "../src/core/replay/merge";
import { repairReplay } from "../src/core/replay/size";
import { decodeRrf, readRrf } from "../src/core/replay/decode";
import { Service } from "../src/core/service";

const ME = "fba98cacdc6a495eba271ee046dcbba9";
const CHAV = "e1b919fe90b044b484ff93979e8308a4";
const readChavron = async () =>
  new Uint8Array(await readFile(new URL("./fixtures/chavron-14182329.rrf", import.meta.url)));

describe("browser build: the whole loop in memory", () => {
  it("reads size-matched replay padding with the browser decoder", async () => {
    const original = await readChavron();
    const solo = mergeRunners([{ bytes: original, uuid: ME }], { matchSourceSize: false });
    const repaired = repairReplay(solo.bytes, original);
    expect(readRrf(repaired).rpd.length).toBe(readRrf(original).rpd.length);
    deepStrictEqual(decodeRrf(repaired).events.get(ME), decodeRrf(solo.bytes).events.get(ME));
  });

  it("their replay -> seeds -> your replay -> mixed replay you can download", async () => {
    const CHAVRON = await readChavron();
    const solo = (uuid: string, patch: Record<string, unknown>) => {
      const files = unzipSync(mergeRunners([{ bytes: CHAVRON, uuid }]).bytes);
      return zipSync({
        ...files,
        "meta.json": strToU8(
          JSON.stringify({ ...JSON.parse(strFromU8(files["meta.json"])), ...patch }),
        ),
      });
    };
    useSqlJs(await initSqlJs(), null);
    const mc = "/ranked/minecraft";
    mkdirSync(`${mc}/mcsrranked/replay`);
    writeFileSync(`${mc}/mods/mcsrranked-web.jar`, new Uint8Array(0));
    const svc = new Service("/data/stratas.db", { offline: true });
    svc.store.set("settings", { nickname: "cyoshi", uuid: ME, instancePath: "/ranked" });
    svc.start();
    svc.store.enqueue({
      match_id: 14182329,
      player_uuid: CHAV,
      player_name: "Chavron",
      opponent_name: "cyoshi",
      date: Math.floor(Date.now() / 1000),
      time: 785002,
      seed_type: "VILLAGE",
      bastion_type: "STABLES",
      elo: 1390,
      tier: "next",
      reason: "test",
    });

    writeFileSync(`${mc}/mcsrranked/replay/chav.rrf`, solo(CHAV, { matchId: 14182329 }));
    svc.rescanLibrary();
    expect(svc.store.queueRow(14182329)!.overworld_seed).toBe("-3566570342730286256");

    writeFileSync(
      `${mc}/mcsrranked/replay/mine.rrf`,
      solo(ME, { matchId: 99999999, matchType: 3 }),
    );
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
