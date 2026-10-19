"""Parser for MCSR Ranked replay.rpd (meta version 40+, record format 3, unencrypted).

replay.rpd = repeated [u32 BE len][zstd frame]. Each decompressed chunk is
[16-byte player UUID][0x83 format marker][records...]. A record is
[u8 type][u8 tickDelta | 0xFF + i32 absolute tick][payload]. No lengths, so every
type's payload layout must be known. Positions are tracked in 1/4096-block units;
*_DELTA records add i16 offsets, *_SMALL_DELTA add i8 * 16.
"""
import io, json, struct, sys, zipfile
from compression import zstd

WORLDS = ["overworld", "nether", "end"]
PLAYER_KEY = -2147483647
SCALE = 4096.0


class Buf:
    def __init__(s, b): s.b, s.i = b, 0
    def left(s): return len(s.b) - s.i
    def take(s, n):
        if s.i + n > len(s.b): raise EOFError
        v = s.b[s.i:s.i + n]; s.i += n; return v
    def u8(s): return s.take(1)[0]
    def i8(s): return struct.unpack(">b", s.take(1))[0]
    def i16(s): return struct.unpack(">h", s.take(2))[0]
    def i32(s): return struct.unpack(">i", s.take(4))[0]
    def f32(s): return struct.unpack(">f", s.take(4))[0]
    def skip(s, n): s.take(n)


def pie_name(b):
    v = b.u8()
    if v >= 128: v = ((v & 127) << 8) | b.u8()
    if v == 0: b.skip(b.u8())


def skip_var(t, b):
    if t == 16:   # PLAYER_CONTAINER
        b.skip(2); n = b.u8() & 3; b.skip(8 * n)
    elif t == 21:  # PLAYER_PIE_CHART
        n = b.u8()
        for i in range(n):
            if i == 0:
                for _ in range(b.u8()): pie_name(b)
            else: pie_name(b)
            b.skip(2)
    elif t == 64:  # INVENTORY_SLOT
        b.skip(6); n = b.u8() & 63; b.skip(2 * n)
    elif t == 87:  # DRAGON_NODES
        b.skip(8 * b.u8())
    elif t == 88:  # DRAGON_ZERO
        if b.u8() != 1: b.skip(18)
    elif t == 90:  # DRAGON_TARGET
        if b.u8() != 0: b.skip(12)
    elif t == 91:  # DRAGON_PATH
        b.skip(1)
        for _ in range(b.u8()):
            if b.u8() == 255: b.skip(8)
    elif t == 103:  # PIGLIN_BARTER
        b.skip(5); b.skip(3 * b.u8())
    else:
        raise ValueError(f"unknown record type {t}")


# payload sizes for fixed-size records that we don't decode
FIXED = {0: 1, 1: 17, 3: 5, 5: 1, 6: 4, 7: 1, 8: 2, 9: 1, 10: 4, 11: 1, 12: 4, 13: 1,
         17: 1, 18: 1, 19: 1, 20: 0, 25: 14, 26: 9, 27: 9, 28: 10, 29: 10, 30: 6, 31: 3,
         32: 3, 33: 4, 40: 29, 41: 21, 42: 9, 43: 17, 44: 15, 45: 11, 46: 9, 47: 6,
         48: 9, 49: 7, 50: 11, 51: 9, 61: 21, 62: 10, 63: 50, 80: 16, 81: 10, 82: 1,
         83: 1, 84: 1, 85: 1, 86: 3, 89: 3, 100: 17, 101: 27, 102: 8}


class Track:
    """Player position state + samples [(tick, world, x, y, z)]."""
    def __init__(s): s.pos = None; s.world = 0; s.samples = []; s.tick = 0
    def set(s, w, x, y, z): s.world = w; s.pos = [round(x * SCALE), round(y * SCALE), round(z * SCALE)]; s.emit()
    def add(s, dx, dy, dz):
        if s.pos is None: s.pos = [0, 0, 0]
        s.pos[0] += dx; s.pos[1] += dy; s.pos[2] += dz; s.emit()
    def emit(s): s.samples.append((s.tick, s.world, *(v / SCALE for v in s.pos)))


def parse_chunk(data, tracks, counts):
    b = Buf(data)
    uuid = b.take(16).hex()
    tr = tracks.setdefault(uuid, Track())
    fmt = b.u8()
    assert fmt == 0x83, f"format {fmt:#x}"
    while b.left():
        t = b.u8(); d = b.u8()
        tr.tick = b.i32() if d == 255 else tr.tick + d
        counts[t] = counts.get(t, 0) + 1
        if t in (2, 1):  # PLAYER_POSITION / PLAYER_SPAWN: world, xyz, yaw, pitch
            w = b.u8(); x, y, z = b.f32(), b.f32(), b.f32(); b.skip(4); tr.set(w, x, y, z)
        elif t == 4:     # PLAYER_POSITION_POS
            w = b.u8(); x, y, z = b.f32(), b.f32(), b.f32(); tr.set(w, x, y, z)
        elif t == 14:    # PLAYER_POSITION_DELTA: dx dy dz yaw pitch
            dx, dy, dz = b.i16(), b.i16(), b.i16(); b.skip(4); tr.add(dx, dy, dz)
        elif t == 15:    # PLAYER_POSITION_POS_DELTA
            tr.add(b.i16(), b.i16(), b.i16())
        elif t in FIXED: b.skip(FIXED[t])
        else: skip_var(t, b)
    return uuid


def parse_rrf(path):
    z = zipfile.ZipFile(path)
    meta = json.loads(z.read("meta.json")); timelines = json.loads(z.read("timelines.json"))
    raw = z.read("replay.rpd")
    assert meta.get("symmetricKey") is None, "encrypted replay (pre-v40), not supported"
    tracks, counts, i = {}, {}, 0
    while i < len(raw):
        n = struct.unpack(">I", raw[i:i + 4])[0]
        parse_chunk(zstd.decompress(raw[i + 4:i + 4 + n]), tracks, counts); i += 4 + n
    return meta, timelines, tracks, counts


if __name__ == "__main__":
    meta, tl, tracks, counts = parse_rrf(sys.argv[1])
    names = {p["uuid"]: p["nickname"] for p in meta["players"]}
    print("record counts:", dict(sorted(counts.items())))
    for u, tr in tracks.items():
        s = tr.samples
        print(f"{names.get(u, u)}: {len(s)} samples, ticks {s[0][0]}..{s[-1][0]} "
              f"(~{s[-1][0] / 20:.0f}s; result {meta['result']['time'] / 1000:.0f}s)")
    # check: decoded position at each timeline event vs the event's recorded block pos
    errs = []
    for e in tl:
        if e["uuid"] not in tracks or not e.get("data") or len(e["data"]) != 3: continue
        tick = e["time"] / 50
        s = min(tracks[e["uuid"]].samples, key=lambda p: abs(p[0] - tick))
        dist = max(abs(a - b) for a, b in zip(s[2:], e["data"]))
        errs.append((dist, e["type"], names[e["uuid"]], e["data"], [round(v, 1) for v in s[2:]], WORLDS[s[1]]))
    errs.sort()
    ok = sum(1 for d in errs if d[0] <= 3)
    print(f"timeline events within 3 blocks: {ok}/{len(errs)}")
    for d in errs[-6:]: print("  worst:", d)
