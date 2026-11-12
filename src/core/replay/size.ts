// Ranked 6.0.11 verifies ZipEntry.getSize() for replay.rpd against the source match.
import { strToU8, unzipSync, zipSync } from "fflate";
import { constants, zstdCompressSync, zstdDecompressSync } from "node:zlib";
import { checkReadable, readRrf, ReplayError, splitChunks, type ReplayMeta } from "./decode";

export interface SizeReference {
  meta: ReplayMeta;
  rpd: Uint8Array;
}
export const REPLAY_EXPORT_VERSION = 1;
export const SIZE_FIT_FAILURE = "mixed replay payload";
const ZSTD_SKIPPABLE_MAGIC = 0x184d2a50;
const SKIPPABLE_HEADER_BYTES = 8;

/** Thrown when a mix decodes fine but is too big to pass as either original. */
export class ReplaySizeError extends ReplayError {}

export function requiresReplayVerification(version: string | null): boolean {
  const [major = 0, minor = 0, patch = 0] = (version ?? "").split(".").map(Number);
  return major > 6 || (major === 6 && (minor > 0 || (minor === 0 && patch >= 11)));
}

/** Joins compressed chunk bodies into replay.rpd, each behind its u32 BE length */
export function packChunks(bodies: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(bodies.reduce((n, b) => n + 4 + b.length, 0));
  const view = new DataView(out.buffer);
  let offset = 0;
  for (const body of bodies) {
    view.setUint32(offset, body.length);
    out.set(body, offset + 4);
    offset += 4 + body.length;
  }
  return out;
}

function recompressSmaller(body: Uint8Array): Uint8Array {
  const compressed = new Uint8Array(
    zstdCompressSync(zstdDecompressSync(body), {
      params: { [constants.ZSTD_c_compressionLevel]: 19 },
    }),
  );
  return compressed.length < body.length ? compressed : body;
}

/** Appends a Zstd skippable frame so the chunk body grows by exactly `gap` bytes */
function padWithSkippableFrame(body: Uint8Array, gap: number): Uint8Array {
  // A skippable frame follows a normal Zstd frame INSIDE its length-prefixed
  // chunk. The Java and Node decoders discard it before reading any records.
  const padded = new Uint8Array(body.length + gap);
  padded.set(body);
  const view = new DataView(padded.buffer);
  view.setUint32(body.length, ZSTD_SKIPPABLE_MAGIC, true);
  view.setUint32(body.length + 4, gap - SKIPPABLE_HEADER_BYTES, true);
  return padded;
}

/** Fit real chunks to an original payload size without adding or removing records.
 * Donors are originals from any seed whose match ID a mix may carry when no same-seed source fits. */
export function matchReplaySize(
  rpd: Uint8Array,
  meta: ReplayMeta,
  references: SizeReference[],
  donors: SizeReference[] = [],
) {
  const candidates = references.filter(({ meta: ref }) => {
    if (
      ref.overworldSeed !== meta.overworldSeed ||
      ref.netherSeed !== meta.netherSeed ||
      ref.theEndSeed !== meta.theEndSeed
    ) {
      return false;
    }
    // Race verification also sends the first player's UUID; keep that identity intact.
    return (
      ref.matchId != null || (ref.raceId != null && ref.players[0]?.uuid === meta.players[0]?.uuid)
    );
  });
  const matchDonors = donors.filter(({ meta: ref }) => ref.matchId != null && ref.raceId == null);
  const fits = (ref: SizeReference) => {
    const gap = ref.rpd.length - rpd.length;
    return gap === 0 || gap >= SKIPPABLE_HEADER_BYTES;
  };
  let bodies = splitChunks(rpd).map((c) => c.body);
  if (!bodies.length) {
    throw new ReplayError("cannot size-match a replay without chunks");
  }
  let reference = candidates.find(fits);
  if (!reference && (candidates.length || matchDonors.length)) {
    // Also strips padding left by a previous export. Higher compression can
    // make a mix that exceeds both original sizes fit without dropping events.
    bodies = bodies.map(recompressSmaller);
    rpd = packChunks(bodies);
    reference = candidates.find(fits) ?? matchDonors.find(fits);
  }
  if (reference) {
    const gap = reference.rpd.length - rpd.length;
    if (gap) {
      bodies[0] = padWithSkippableFrame(bodies[0], gap);
      rpd = packChunks(bodies);
    }
    return {
      rpd,
      meta: {
        ...meta,
        matchId: reference.meta.matchId,
        raceId: reference.meta.raceId ?? null,
        stratasReplayVersion: REPLAY_EXPORT_VERSION,
      },
    };
  }
  throw new ReplaySizeError(
    `${SIZE_FIT_FAILURE} (${rpd.length} bytes) cannot fit an original replay size (${candidates.map((r) => r.rpd.length).join(", ") || "no matching source"}); add a Ranked replay from any game bigger than about ${Math.ceil((rpd.length + SKIPPABLE_HEADER_BYTES) / 1024)} KB`,
  );
}

/** Repair an existing mix using an untouched original from the same seed. */
export function repairReplay(bytes: Uint8Array, referenceBytes: Uint8Array): Uint8Array {
  const replay = readRrf(bytes);
  const reference = readRrf(referenceBytes);
  checkReadable(replay.meta);
  checkReadable(reference.meta);
  const fitted = matchReplaySize(replay.rpd, replay.meta, [reference]);
  return zipSync({
    ...unzipSync(bytes),
    "replay.rpd": fitted.rpd,
    "meta.json": strToU8(JSON.stringify(fitted.meta)),
  });
}
