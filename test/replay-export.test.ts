import { expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";
import { strToU8, zipSync } from "fflate";
import { decodeRrf, readRrf, splitChunks } from "../src/core/replay/decode";
import { mergeRunners } from "../src/core/replay/merge";
import { Service } from "../src/core/service";

it("rebuilds a cached export after a Ranked update and recognizes renamed exports", () => {
  const root = mkdtempSync(join(tmpdir(), "stratas-export-"));
  const mc = join(root, "minecraft");
  const mods = join(mc, "mods");
  const folder = join(mc, "mcsrranked", "replay");
  mkdirSync(mods, { recursive: true });
  mkdirSync(folder, { recursive: true });
  const oldMod = join(mods, "mcsrranked-6.0.3.jar");
  writeFileSync(oldMod, "");
  const original = new Uint8Array(
    readFileSync(new URL("./fixtures/chavron-14182329.rrf", import.meta.url)),
  );
  const sourceUuid = "fba98cacdc6a495eba271ee046dcbba9";
  const me = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const solo = readRrf(
    mergeRunners([{ bytes: original, uuid: sourceUuid }], { matchSourceSize: false }).bytes,
  );
  // A different local runner on the fixture's seed; the donor remains a full original match.
  const chunks = splitChunks(solo.rpd).map((c) => {
    const raw = new Uint8Array(zstdDecompressSync(c.body));
    raw.fill(0xaa, 0, 16);
    return new Uint8Array(zstdCompressSync(raw));
  });
  const rpd = new Uint8Array(chunks.reduce((n, c) => n + 4 + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    new DataView(rpd.buffer).setUint32(offset, c.length);
    rpd.set(c, offset + 4);
    offset += 4 + c.length;
  }
  writeFileSync(
    join(folder, "practice.rrf"),
    zipSync({
      "replay.rpd": [rpd, { level: 0 }],
      "meta.json": strToU8(
        JSON.stringify({
          ...solo.meta,
          matchId: 99999999,
          matchType: 3,
          players: [{ ...solo.meta.players[0], uuid: me }],
          result: { ...solo.meta.result, uuid: me },
        }),
      ),
      "timelines.json": strToU8(JSON.stringify(solo.timelines.map((e) => ({ ...e, uuid: me })))),
    }),
  );
  writeFileSync(join(folder, "reference.rrf"), original);
  const svc = new Service(":memory:", { offline: true, poolDir: join(root, "games") });
  svc.store.set("settings", { nickname: "cyoshi", uuid: me, instancePath: root });
  try {
    svc.start();
    const before = svc.store.races().find((r) => r.your_file !== r.their_file)!;
    expect(before.error).toBeNull();
    expect(JSON.parse(before.analysis).replayExportVersion).toBe(0);
    rmSync(oldMod);
    writeFileSync(join(mods, "mcsrranked-6.0.12.jar"), "");
    svc.rescanLibrary();
    svc.pairRuns();
    const after = svc.store.raceByKey(before.key)!;
    expect(after.error).toBeNull();
    expect(JSON.parse(after.analysis).replayExportVersion).toBe(1);
    const exported = new Uint8Array(readFileSync(after.race_file!));
    expect(readRrf(exported).rpd.length).toBe(readRrf(original).rpd.length);
    expect(readRrf(exported).meta.matchId).toBe(readRrf(original).meta.matchId);
    expect(decodeRrf(exported).events.get(me)?.length).toBeGreaterThan(0);
    const build = vi.spyOn(
      svc as unknown as { buildRace: (...args: unknown[]) => void },
      "buildRace",
    );
    svc.pairRuns();
    expect(build).not.toHaveBeenCalled();
    build.mockRestore();
    const renamed = join(folder, "renamed.rrf");
    writeFileSync(renamed, exported);
    svc.rescanLibrary();
    expect(svc.store.run(renamed)?.kind).toBe("race");
  } finally {
    svc.stop();
    rmSync(root, { recursive: true, force: true });
  }
}, 20_000);
