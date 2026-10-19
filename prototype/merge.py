"""Build a combined .rrf from runners taken out of one or more v40+ replays.

merge([(rrf_path, uuid), ...], out_path, order="interleave"|"concat")
Chunks are copied byte for byte (still compressed); only the zip, meta.json and
timelines.json are written fresh.
"""
import json, struct, zipfile
from compression import zstd


def chunks(path):
    raw = zipfile.ZipFile(path).read("replay.rpd"); i = 0; out = []
    while i < len(raw):
        n = struct.unpack(">I", raw[i:i + 4])[0]; body = raw[i + 4:i + 4 + n]; i += 4 + n
        head = zstd.decompress(body)[:23]
        uuid = head[:16].hex()
        tick = struct.unpack(">i", head[19:23])[0] if head[18] == 0xFF else 0   # first record's absolute tick
        out.append((uuid, tick, body))
    return out


def merge(sources, out_path, order="interleave", label=None):
    metas, players, timelines, picked = [], [], [], []
    for path, uuid in sources:
        z = zipfile.ZipFile(path); meta = json.loads(z.read("meta.json")); tl = json.loads(z.read("timelines.json"))
        if meta.get("symmetricKey"): raise ValueError(f"{path}: encrypted replay")
        metas.append(meta)
        players += [p for p in meta["players"] if p["uuid"] == uuid]
        timelines += [e for e in tl if e["uuid"] == uuid]
        picked.append([c for c in chunks(path) if c[0] == uuid])
    seeds = {(m["overworldSeed"], m["netherSeed"]) for m in metas}
    if len(seeds) > 1: print("warning: runners are on different seeds", seeds)
    if order == "interleave": body = sorted((c for p in picked for c in p), key=lambda c: c[1])
    else: body = [c for p in picked for c in p]
    finishes = [e for e in timelines if e["type"] == "projectelo.timeline.dragon_death"]
    meta = dict(metas[0])
    meta["players"] = players
    if finishes:
        w = min(finishes, key=lambda e: e["time"]); meta["result"] = {"uuid": w["uuid"], "time": w["time"]}
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("replay.rpd", b"".join(struct.pack(">I", len(b)) + b for _, _, b in body))
        z.writestr("meta.json", json.dumps(meta, separators=(",", ":")))
        z.writestr("timelines.json", json.dumps(sorted(timelines, key=lambda e: -e["time"]), separators=(",", ":")))
    return out_path
