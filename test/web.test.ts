import { describe, expect, it } from "vitest";
import { zstdDecompressSync as nodeDecompress, zstdCompressSync as nodeCompress } from "node:zlib";
import { zstdCompressSync, zstdDecompressSync } from "../web/shims/zlib";

describe("browser zstd", () => {
  const data = new Uint8Array(300_000).map((_, i) => (i * 31 + (i >> 7)) & 0xff);

  it("writes frames real zstd reads back", () => {
    for (const d of [data, data.subarray(0, 131072), data.subarray(0, 5), new Uint8Array(0)]) {
      expect(new Uint8Array(nodeDecompress(zstdCompressSync(d)))).toEqual(d);
    }
  });

  it("reads frames real zstd wrote", () => {
    expect(zstdDecompressSync(new Uint8Array(nodeCompress(data)))).toEqual(data);
  });
});
