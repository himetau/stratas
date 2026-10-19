"""Full decoder for MCSR Ranked replay.rpd (meta v40+, record format 3).

decode(path) -> meta, timelines, {uuid: [event dict, ...]} with every record
decoded into named fields. Positions are reconstructed from deltas; block
positions from block deltas; ids resolved with vanilla 1.16.1 registries.
"""
import json, os, struct, zipfile
from compression import zstd

HERE = os.path.dirname(os.path.abspath(__file__))
REG = json.load(open(os.path.join(HERE, "mcdata/out/reports/registries.json")))
BLOCKS = json.load(open(os.path.join(HERE, "mcdata/out/reports/blocks.json")))


def _reg(name):
    return {v["protocol_id"]: k.removeprefix("minecraft:") for k, v in REG[name]["entries"].items()}


ITEMS, ENTITIES, EFFECTS, MENUS = _reg("minecraft:item"), _reg("minecraft:entity_type"), _reg("minecraft:mob_effect"), _reg("minecraft:menu")
STATES = {s["id"]: k.removeprefix("minecraft:") for k, b in BLOCKS.items() for s in b["states"]}
WORLDS = ["overworld", "nether", "end"]
SCALE = 4096.0
PLAYER_KEY = -2147483647
NAMES = {0: "EMPTY", 1: "PLAYER_SPAWN", 2: "PLAYER_POSITION", 3: "PLAYER_LOOK", 4: "PLAYER_POS", 5: "POSE", 6: "RIDE",
         7: "PAUSE", 8: "PLAYER_REMOVE", 9: "PERSPECTIVE", 10: "STATS", 11: "USE", 12: "EFFECT", 13: "HELD_SLOT",
         14: "PLAYER_POSITION_DELTA", 15: "PLAYER_POS_DELTA", 16: "CONTAINER", 17: "PORTAL", 18: "SWING",
         19: "RENDER_DISTANCE", 20: "ATTACK_RESET", 21: "PIE_CHART", 25: "BLOCK_UPDATE", 26: "BLOCK_BREAK",
         27: "BLOCK_REMOVE", 28: "BLOCK_PROGRESS", 29: "CHEST_ANIMATION", 30: "BLOCK_UPDATE", 31: "BLOCK_BREAK",
         32: "BLOCK_REMOVE", 33: "BLOCK_PROGRESS", 40: "ENTITY_ADD", 41: "ENTITY_MOVE", 42: "ENTITY_LOOK",
         43: "ENTITY_POS", 44: "ENTITY_MOVE", 45: "ENTITY_POS", 46: "ENTITY_DAMAGE", 47: "ENTITY_REMOVE",
         48: "ENTITY_MOVE", 49: "ENTITY_POS", 50: "PIGLIN_STATE", 51: "MOB_STATE", 61: "ITEM_ENTITY", 62: "ITEM_PICKUP",
         63: "PROJECTILE", 64: "INVENTORY_SLOT", 80: "DRAGON_MOVE", 81: "DRAGON_MOVE", 82: "DRAGON_PHASE",
         83: "DRAGON_HEALTH", 84: "CRYSTAL_DESTROY", 85: "DRAGON_DEATH", 86: "DRAGON_DEATH_PROGRESS",
         87: "DRAGON_NODES", 88: "DRAGON_ZERO", 89: "DRAGON_DAMAGE", 90: "DRAGON_TARGET", 91: "DRAGON_PATH",
         100: "EXPLOSION", 101: "AREA_EFFECT_CLOUD", 102: "WORLD_TIME", 103: "PIGLIN_BARTER"}


def unpack_pos(v):  # BlockPos.asLong (1.16): x 26 bits <<38, z 26 bits <<12, y 12 bits
    x = v >> 38; y = (v << 52) >> 52; z = (v << 26) >> 38
    return [x, y, z]


def ang(s): return ((s * 0.01 + 180) % 360) - 180


class B:
    def __init__(s, b): s.b, s.i = b, 0
    def left(s): return len(s.b) - s.i
    def take(s, n):
        if s.i + n > len(s.b): raise EOFError
        v = s.b[s.i:s.i + n]; s.i += n; return v
    def u8(s): return s.take(1)[0]
    def i8(s): return struct.unpack(">b", s.take(1))[0]
    def u16(s): return struct.unpack(">H", s.take(2))[0]
    def i16(s): return struct.unpack(">h", s.take(2))[0]
    def i32(s): return struct.unpack(">i", s.take(4))[0]
    def i64(s): return struct.unpack(">q", s.take(8))[0]
    def f32(s): return struct.unpack(">f", s.take(4))[0]
    def f64(s): return struct.unpack(">d", s.take(8))[0]
    def xyz(s): return [s.f32(), s.f32(), s.f32()]


class State:
    """Per-player decoder state (positions per entity key, last block pos, tick)."""
    def __init__(s): s.pos = {}; s.block = [0, 0, 0]; s.block_world = 0; s.tick = 0

    def store(s, key, w, p): s.pos[key] = [w] + [round(v * SCALE) for v in p]

    def delta(s, key, w, d, mul=1):
        q = s.pos.get(key)
        if q is None: q = s.pos[key] = [w if w is not None else 0, 0, 0, 0]
        if w is not None: q[0] = w
        for i in range(3): q[i + 1] += d[i] * mul
        return q[0], [v / SCALE for v in q[1:]]

    def world(s, key): return s.pos.get(key, [0])[0]


def pie_name(b):
    v = b.u8()
    if v >= 128: v = ((v & 127) << 8) | b.u8()
    if v: return f"#{v}"
    return b.take(b.u8()).decode()


def record(t, b, st):
    e = {}
    if t in (1, 2):
        w = b.u8(); p = b.xyz(); e.update(world=w, pos=p, yaw=ang(b.i16()), pitch=ang(b.i16())); st.store(PLAYER_KEY, w, p)
    elif t == 3: e.update(world=b.u8(), yaw=ang(b.i16()), pitch=ang(b.i16()))
    elif t == 4: w = b.u8(); p = b.xyz(); e.update(world=w, pos=p); st.store(PLAYER_KEY, w, p)
    elif t == 14:
        d = [b.i16(), b.i16(), b.i16()]; y, pi = b.i16(), b.i16()
        w, p = st.delta(PLAYER_KEY, None, d); e.update(world=w, pos=p, yaw=ang(y), pitch=ang(pi))
    elif t == 15:
        w, p = st.delta(PLAYER_KEY, None, [b.i16(), b.i16(), b.i16()]); e.update(world=w, pos=p)
    elif t == 5: e["pose"] = b.u8()
    elif t == 6: e["vehicle"] = b.i32()
    elif t == 7: e["paused"] = bool(b.u8())
    elif t == 8: e.update(world=b.u8(), flag=b.u8() == 1)
    elif t == 9: e["perspective"] = b.u8()
    elif t == 10: e.update(health=b.i8(), absorption=b.i8(), food=b.i8(), air=b.i8())
    elif t == 11: s = b.u8(); e.update(hand=s & 3, finished=bool(s & 4))
    elif t == 12: e.update(effect=EFFECTS.get(b.u8() - 1, "?"), amp=b.u8(), duration=b.u16())
    elif t == 13: e["slot"] = b.u8()
    elif t == 16:
        ty, slots, f = b.u8(), b.u8(), b.u8()
        e.update(container={255: "closed", 254: "inventory"}.get(ty, MENUS.get(ty, ty)), slots=slots,
                 world=f >> 2, at=[unpack_pos(b.i64()) for _ in range(f & 3)])
    elif t == 17: e["in_portal"] = bool(b.u8())
    elif t == 18: e["hand"] = b.u8()
    elif t == 19: e["rd"] = b.u8()
    elif t == 20: pass
    elif t == 21:
        rows = []
        for i in range(b.u8()):
            if i == 0: name = "\x1e".join(pie_name(b) for _ in range(b.u8()))
            else: name = pie_name(b)
            rows.append((name, b.u8(), b.u8()))
        e["pie"] = rows
    elif t in (25, 26, 27, 28, 29):
        w = b.u8(); p = unpack_pos(b.i64()); st.block, st.block_world = p[:], w; e.update(world=w, at=p)
        if t == 25: e.update(block=STATES.get(b.i32(), "?"), event=b.u8())
        elif t == 28: e["progress"] = b.i8()
        elif t == 29: e["open"] = bool(b.u8())
    elif t in (30, 31, 32, 33):
        for i in range(3): st.block[i] += b.i8()
        e.update(world=st.block_world, at=st.block[:])
        if t == 30: e.update(block=STATES.get(b.u16(), "?"), event=b.u8())
        elif t == 33: e["progress"] = b.i8()
    elif t == 40:
        w = b.u8(); p = b.xyz(); b.skip = None
        yaw, pitch, eid, ty, cd = b.i16(), b.i16(), b.i32(), b.i32(), b.i32()
        st.store(eid, w, p); e.update(world=w, pos=p, id=eid, entity=ENTITIES.get(ty, ty), data=cd)
    elif t == 41:
        w = b.u8(); p = b.xyz(); b.i16(); b.i16(); eid = b.i32(); st.store(eid, w, p); e.update(world=w, pos=p, id=eid)
    elif t == 42: e.update(world=b.u8(), yaw=b.i16(), pitch=b.i16(), id=b.i32())
    elif t == 43: w = b.u8(); p = b.xyz(); eid = b.i32(); st.store(eid, w, p); e.update(world=w, pos=p, id=eid)
    elif t == 44:
        w = b.u8(); d = [b.i16(), b.i16(), b.i16()]; b.i16(); b.i16(); eid = b.i32()
        w, p = st.delta(eid, w, d); e.update(world=w, pos=p, id=eid)
    elif t == 45:
        w = b.u8(); d = [b.i16(), b.i16(), b.i16()]; eid = b.i32(); w, p = st.delta(eid, w, d); e.update(world=w, pos=p, id=eid)
    elif t == 48:
        d = [b.i8(), b.i8(), b.i8()]; b.i8(); b.i8(); eid = b.i32()
        w, p = st.delta(eid, st.world(eid), d, 16); e.update(world=w, pos=p, id=eid)
    elif t == 49:
        d = [b.i8(), b.i8(), b.i8()]; eid = b.i32(); w, p = st.delta(eid, st.world(eid), d, 16); e.update(world=w, pos=p, id=eid)
    elif t == 46: e.update(world=b.u8(), id=b.i32(), amount=b.i32())
    elif t == 47: e.update(world=b.u8(), id=b.i32(), killed=b.u8() == 1)
    elif t == 50: e.update(world=b.u8(), id=b.i32(), state=b.u8(), flag=b.u8(), a=b.i16(), b=b.i16())
    elif t == 51: e.update(world=b.u8(), id=b.i32(), state=b.i32())
    elif t == 61:
        w = b.u8(); p = b.xyz(); eid = b.i32(); item = ITEMS.get(b.u16(), "?"); cnt = b.u8(); fl = b.u8()
        st.store(eid, w, p); e.update(world=w, pos=p, id=eid, item=item, count=cnt, flags=fl)
    elif t == 62: e.update(world=b.u8(), id=b.i32(), collector=b.i32(), count=b.u8())
    elif t == 63:
        w = b.u8(); p = b.xyz(); b.i16(); b.i16(); eid = b.i32(); vel = [b.f64(), b.f64(), b.f64()]; ty = b.i32(); fl = b.u8()
        st.store(eid, w, p); e.update(world=w, pos=p, id=eid, vel=vel, entity=ENTITIES.get(ty & 0xFFFF, ty), flags=fl)
    elif t == 64:
        slot, item, cnt, dur, var, f = b.u8(), b.u16(), b.u8(), b.u8(), b.u8(), b.u8()
        ench = [b.u16() for _ in range(f & 63)]
        e.update(slot=slot, item=ITEMS.get(item, item) if cnt else "air", count=cnt, durability=dur, ench=ench)
    elif t == 80: e.update(pos=b.xyz(), yaw=b.i16(), pitch=b.i16())
    elif t == 81: b.take(10)
    elif t in (82, 83, 84, 85): e["v"] = b.u8()
    elif t == 86: b.take(3)
    elif t == 87: b.take(8 * b.u8())
    elif t == 88:
        if b.u8() != 1: b.take(18)
    elif t == 89: b.take(3)
    elif t == 90:
        if b.u8() != 0: b.take(12)
    elif t == 91:
        b.u8()
        for _ in range(b.u8()):
            if b.u8() == 255: b.take(8)
    elif t == 100: e.update(world=b.u8(), pos=b.xyz(), power=b.f32())
    elif t == 101: b.take(27)
    elif t == 102: e["time"] = b.i64()
    elif t == 103:
        w = b.u8(); pid = b.i32()
        e.update(world=w, id=pid, items=[(ITEMS.get(b.u16(), "?"), b.u8()) for _ in range(b.u8())])
    elif t == 0: b.u8()
    else: raise ValueError(f"unknown type {t}")
    return e


def decode(path):
    z = zipfile.ZipFile(path)
    meta = json.loads(z.read("meta.json")); tl = json.loads(z.read("timelines.json"))
    if meta.get("symmetricKey"): raise ValueError("encrypted (pre-v40) replay")
    raw = z.read("replay.rpd"); i = 0; states, out = {}, {}
    while i < len(raw):
        n = struct.unpack(">I", raw[i:i + 4])[0]; c = B(zstd.decompress(raw[i + 4:i + 4 + n])); i += 4 + n
        uuid = c.take(16).hex(); st = states.setdefault(uuid, State()); ev = out.setdefault(uuid, [])
        if c.u8() != 0x83: raise ValueError("unknown record format")
        while c.left():
            t = c.u8(); d = c.u8()
            st.tick = c.i32() if d == 255 else st.tick + d
            e = record(t, c, st); e["t"] = st.tick; e["type"] = NAMES.get(t, t); ev.append(e)
    return meta, tl, out
