import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";
import { decodeRrf, readRrf, splitChunks, ReplayError, type Replay } from "../src/core/replay/decode";
import { mergeRunners, retimeChunk } from "../src/core/replay/merge";
import { recordLength } from "../src/core/replay/walk";

const fx = (n: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${n}`, import.meta.url)));
const CHAVRON = fx("chavron-14182329.rrf");
const AMMY = fx("ammy-14215217.rrf");
const ME = "fba98cacdc6a495eba271ee046dcbba9";
const CHAV = "e1b919fe90b044b484ff93979e8308a4";

const counts = (r: Replay) => Object.fromEntries([...r.events].map(([u, e]) => [u, e.length]));

describe("decode", () => {
  const r = decodeRrf(CHAVRON);

  it("decodes every record of both players", () => {
    expect(counts(r)).toEqual({ [ME]: 80572, [CHAV]: 71416 });
    expect(decodeRrf(AMMY).events.size).toBe(2);
  });

  it("positions match the game's own split coordinates", () => {
    let ok = 0, n = 0;
    for (const e of r.timelines) {
      if (!e.data || e.data.length !== 3) continue;
      const tick = e.time / 50;
      const track = r.events.get(e.uuid)!.filter((x) => x.pos && x.type.startsWith("PLAYER"));
      const near = track.reduce((a, b) => (Math.abs(b.t - tick) < Math.abs(a.t - tick) ? b : a));
      n++;
      if (Math.max(...near.pos!.map((v, i) => Math.abs(v - e.data![i]))) <= 3) ok++;
    }
    expect(n).toBe(41);
    expect(ok).toBeGreaterThanOrEqual(36);
  });

  it("names items, mobs and containers", () => {
    const ev = r.events.get(ME)!;
    const items = new Set(ev.filter((e) => e.type === "INVENTORY_SLOT").map((e) => e.item));
    expect(items).toContain("ender_pearl");
    expect(items).toContain("iron_pickaxe");
    expect(new Set(ev.filter((e) => e.type === "ENTITY_ADD").map((e) => e.entity))).toContain("piglin");
    expect(new Set(ev.filter((e) => e.type === "CONTAINER").map((e) => e.container))).toContain("crafting");
  });

  it("refuses encrypted replays", () => {
    expect(() => decodeRrf(fx("encrypted-14158194.rrf"))).toThrow(ReplayError);
  });
});

describe("walk", () => {
  for (const [name, bytes] of [["chavron", CHAVRON], ["ammy", AMMY]] as const) {
    it(`record lengths walk every ${name} chunk exactly`, () => {
      for (const c of splitChunks(readRrf(bytes).rpd)) {
        const raw = new Uint8Array(zstdDecompressSync(c.body));
        let i = 17;
        while (i < raw.length) { const t = raw[i], d = raw[i + 1]; i += 2 + (d === 255 ? 4 : 0); i += recordLength(t, raw, i); }
        expect(i).toBe(raw.length);
      }
    });
  }
});

describe("merge", () => {
  const orig = decodeRrf(CHAVRON);

  it("round-trips both runners exactly", () => {
    const m = mergeRunners([{ bytes: CHAVRON, uuid: ME }, { bytes: CHAVRON, uuid: CHAV }]);
    const back = decodeRrf(m.bytes);
    expect(back.events.get(ME)).toEqual(orig.events.get(ME));
    expect(back.events.get(CHAV)).toEqual(orig.events.get(CHAV));
    expect(m.meta.players.map((p) => p.nickname)).toEqual(["cyoshi", "Chavron"]);
    expect(m.meta.result.uuid).toBe(CHAV);
  });

  it("refuses runners on different seeds", () => {
    expect(() => mergeRunners([{ bytes: CHAVRON, uuid: ME }, { bytes: AMMY, uuid: readRrf(AMMY).meta.players[0].uuid }])).toThrow(/different seeds/);
  });

  it("shifts a runner's ticks", () => {
    const m = mergeRunners([{ bytes: CHAVRON, uuid: CHAV, shiftTicks: 100 }]);
    const a = orig.events.get(CHAV)!, b = decodeRrf(m.bytes).events.get(CHAV)!;
    expect(b.length).toBe(a.length);
    expect(b.every((e, i) => e.t === a[i].t + 100)).toBe(true);
    expect(retimeChunk(splitChunks(readRrf(CHAVRON).rpd)[0].body, 0)).toBeInstanceOf(Uint8Array);
  });
});
