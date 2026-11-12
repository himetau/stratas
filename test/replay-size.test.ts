import { describe, expect, it } from "vitest";
import { deepStrictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { constants, zstdCompressSync, zstdDecompressSync } from "node:zlib";
import { strToU8, unzipSync, zipSync } from "fflate";
import { decodeRrf, readRrf, splitChunks } from "../src/core/replay/decode";
import { mergeRunners } from "../src/core/replay/merge";
import { matchReplaySize, repairReplay, ReplaySizeError, requiresReplayVerification } from "../src/core/replay/size";

const original = new Uint8Array(readFileSync(new URL("./fixtures/chavron-14182329.rrf", import.meta.url)));
const ME = "fba98cacdc6a495eba271ee046dcbba9";
const CHAV = "e1b919fe90b044b484ff93979e8308a4";
const solo = mergeRunners([{ bytes: original, uuid: ME }], { matchSourceSize: false });
const patch = (bytes: Uint8Array, meta: Record<string, unknown>) => zipSync({
  ...unzipSync(bytes), "meta.json": strToU8(JSON.stringify({ ...readRrf(bytes).meta, ...meta })),
});

describe("Ranked replay size verification", () => {
  it("pads inside a chunk to the original RPD size with identical decompressed bytes", () => {
    const repaired = repairReplay(solo.bytes, original);
    const before = splitChunks(readRrf(solo.bytes).rpd), after = splitChunks(readRrf(repaired).rpd);
    expect(readRrf(repaired).rpd.length).toBe(readRrf(original).rpd.length);
    expect(after.length).toBe(before.length);
    for (let i = 0; i < before.length; i++) {
      deepStrictEqual(zstdDecompressSync(after[i].body), zstdDecompressSync(before[i].body));
    }
    deepStrictEqual(decodeRrf(repaired).events.get(ME), decodeRrf(solo.bytes).events.get(ME));
    expect(readRrf(repaired).timelines).toEqual(solo.timelines);
    expect(readRrf(repaired).meta.stratasReplayVersion).toBe(1);
    expect(repairReplay(repaired, original)).toBeInstanceOf(Uint8Array);
  });

  it("uses the larger donor match's ID when the private replay is too small", () => {
    const privateRun = patch(solo.bytes, { version: 41, matchId: 99999999, matchType: 3 });
    const reference = patch(original, { version: 41 });
    const merged = mergeRunners([{ bytes: privateRun, uuid: ME }, { bytes: reference, uuid: CHAV }]);
    expect(merged.meta.matchId).toBe(readRrf(reference).meta.matchId);
    expect(merged.meta.raceId).toBeNull();
    expect(readRrf(merged.bytes).rpd.length).toBe(readRrf(reference).rpd.length);
    expect(merged.meta.players.map((p) => p.uuid)).toEqual([ME, CHAV]);
    const decoded = decodeRrf(merged.bytes), source = decodeRrf(original);
    for (const uuid of [ME, CHAV]) deepStrictEqual(decoded.events.get(uuid), source.events.get(uuid));
  });

  it("recompresses oversized chunks without changing their records", () => {
    const raw = splitChunks(readRrf(solo.bytes).rpd).map((c) => zstdDecompressSync(c.body));
    const oversizedBodies = raw.map((r) => zstdCompressSync(r, { params: { [constants.ZSTD_c_compressionLevel]: 1 } }));
    const oversized = new Uint8Array(oversizedBodies.reduce((n, b) => n + 4 + b.length, 0));
    let offset = 0;
    for (const b of oversizedBodies) {
      new DataView(oversized.buffer).setUint32(offset, b.length);
      oversized.set(b, offset + 4); offset += 4 + b.length;
    }
    const target = readRrf(solo.bytes);
    expect(oversized.length).toBeGreaterThan(target.rpd.length);
    const fitted = matchReplaySize(oversized, target.meta, [target]);
    expect(fitted.rpd.length).toBe(target.rpd.length);
    splitChunks(fitted.rpd).forEach((c, i) => deepStrictEqual(zstdDecompressSync(c.body), raw[i]));
  });

  it("refuses different seeds and sizes that cannot hold the recorded events", () => {
    expect(() => repairReplay(solo.bytes, patch(original, { theEndSeed: "different" }))).toThrow(/no matching source/);
    const source = readRrf(solo.bytes);
    expect(() => matchReplaySize(source.rpd, source.meta, [{ ...source, rpd: new Uint8Array(1) }])).toThrow(/cannot fit/);
  });

  it("borrows a larger original's match ID from another seed when no source fits", () => {
    const source = readRrf(solo.bytes);
    const donor = readRrf(patch(original, { overworldSeed: "other", matchId: 777, raceId: null }));
    const tooSmall = { ...source, rpd: new Uint8Array(1) };
    const fitted = matchReplaySize(source.rpd, source.meta, [tooSmall], [donor]);
    expect(fitted.rpd.length).toBe(donor.rpd.length);
    expect(fitted.meta).toMatchObject({ matchId: 777, raceId: null, overworldSeed: source.meta.overworldSeed });
    splitChunks(fitted.rpd).forEach((c, i) => deepStrictEqual(zstdDecompressSync(c.body), zstdDecompressSync(splitChunks(source.rpd)[i].body)));
  });

  it("prefers a same-seed source over a donor and never borrows a race ID", () => {
    const source = readRrf(solo.bytes);
    const donor = readRrf(patch(original, { overworldSeed: "other", matchId: 777 }));
    const sameSeed = readRrf(original);
    expect(matchReplaySize(source.rpd, source.meta, [sameSeed], [donor]).meta.matchId).toBe(sameSeed.meta.matchId);
    const race = readRrf(patch(original, { overworldSeed: "other", matchId: null, raceId: 5 }));
    expect(() => matchReplaySize(source.rpd, source.meta, [], [race])).toThrow(ReplaySizeError);
  });

  it("marks an oversized mix as a size failure, not a format failure", () => {
    const source = readRrf(solo.bytes);
    expect(() => matchReplaySize(source.rpd, source.meta, [{ ...source, rpd: new Uint8Array(1) }])).toThrow(ReplaySizeError);
  });

  it("keeps the UUID required for race verification", () => {
    const source = readRrf(solo.bytes);
    const originalMeta = readRrf(original).meta;
    const race = { meta: { ...originalMeta, matchId: null, raceId: 123, players: [
      ...originalMeta.players.filter((p) => p.uuid === ME), ...originalMeta.players.filter((p) => p.uuid !== ME),
    ] } };
    const bytes = patch(original, race.meta);
    expect(readRrf(repairReplay(solo.bytes, bytes)).meta.raceId).toBe(123);
    const wrongPlayer = patch(bytes, { players: [...race.meta.players].reverse() });
    expect(() => repairReplay(solo.bytes, wrongPlayer)).toThrow(/no matching source/);
    expect(source.meta.players[0].uuid).toBe(ME);
  });

  it("enables matching for Ranked 6.0.11 and later", () => {
    for (const version of [null, "6.0.3", "6.0.10"]) expect(requiresReplayVerification(version)).toBe(false);
    for (const version of ["6.0.11", "6.0.12", "6.1.0", "7.0.0"]) expect(requiresReplayVerification(version)).toBe(true);
  });

  it("leaves exact-size chunks alone and refuses a merge across End seeds", () => {
    const repaired = readRrf(repairReplay(original, original));
    deepStrictEqual(repaired.rpd, readRrf(original).rpd);
    expect(() => mergeRunners([])).toThrow(/at least one runner/);
    expect(() => mergeRunners([
      { bytes: original, uuid: ME }, { bytes: patch(original, { theEndSeed: "different" }), uuid: CHAV },
    ])).toThrow(/different seeds/);
  });
});
