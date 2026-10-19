"""Prototype: rebuild each run as actions, then diff two runs of the same seed.

Usage: python3 detect.py <combined-or-match.rrf> <you-nickname>
"""
import bisect, collections, json, math, sys, zipfile
import rpd2

TPS = 20


def fmt(t): t = int(t / TPS); return f"{t // 60}:{t % 60:02d}"


class Run:
    def __init__(s, name, ev, tl):
        s.name, s.ev = name, ev
        s.track = [(e["t"], e["world"], *e["pos"]) for e in ev if "pos" in e and e["type"].startswith(("PLAYER_P", "PLAYER_S"))]
        s.tt = [p[0] for p in s.track]
        s.looks = [(e["t"], e["yaw"]) for e in ev if "yaw" in e and e["type"].startswith("PLAYER")]
        s.splits = {e["type"].split(".")[-1]: e["time"] / 50 for e in tl}
        s.end = max(s.tt)
        s.actions = []
        s._inventory(); s._containers(); s._mining(); s._pickups(); s._throws(); s._trades(); s._deaths(); s._portals()
        s.actions.sort(key=lambda a: a["t0"])

    # ---- helpers
    def pos_at(s, t):
        i = max(0, bisect.bisect_right(s.tt, t) - 1); return s.track[i][1:]

    def path(s, t0, t1):
        i, j = bisect.bisect_left(s.tt, t0), bisect.bisect_right(s.tt, t1)
        d = 0.0
        for a, b in zip(s.track[i:j], s.track[i + 1:j]):
            if a[1] == b[1]: d += math.dist((a[2], a[4]), (b[2], b[4]))
        return d

    def idle(s, t0, t1, busy):
        """seconds standing still (<1 block per second) and not busy with an action"""
        i, j = bisect.bisect_left(s.tt, t0), bisect.bisect_right(s.tt, t1)
        pts = s.track[i:j]; idle = 0
        for k in range(len(pts) - 1):
            a, b = pts[k], pts[k + 1]; dt = b[0] - a[0]
            if dt <= 0 or dt > 40: continue
            if a[1] == b[1] and math.dist((a[2], a[4]), (b[2], b[4])) / dt * TPS < 1 and not busy(a[0]): idle += dt
        # gaps without position updates = not moving at all
        last = t0
        for p in pts:
            if p[0] - last > 10 and not busy(last): idle += p[0] - last
            last = p[0]
        return idle / TPS

    def searching(s, t0, t1):
        """seconds of fast camera sweeps (>120 deg/s) while nearly stationary"""
        ls = [l for l in s.looks if t0 <= l[0] <= t1]; tot = 0
        for a, b in zip(ls, ls[1:]):
            dt = b[0] - a[0]
            if 0 < dt <= 4:
                dyaw = abs((b[1] - a[1] + 180) % 360 - 180)
                pa, pb = s.pos_at(a[0]), s.pos_at(b[0])
                if dyaw / dt * TPS > 120 and math.dist((pa[1], pa[3]), (pb[1], pb[3])) / dt * TPS < 2: tot += dt
        return tot / TPS

    # ---- inventory
    def _inventory(s):
        slots, s.inv = {}, []  # inv: list of (t, Counter)
        for e in s.ev:
            if e["type"] == "INVENTORY_SLOT":
                slots[e["slot"]] = (e["item"], e["count"])
                c = collections.Counter()
                for it, n in slots.values():
                    if it != "air": c[it] += n
                s.inv.append((e["t"], c))
        s.inv_t = [x[0] for x in s.inv]

    def inv_at(s, t):
        i = bisect.bisect_right(s.inv_t, t) - 1
        return s.inv[i][1] if i >= 0 else collections.Counter()

    def inv_delta(s, t0, t1):
        a, b = s.inv_at(t0 - 1), s.inv_at(t1 + 1)
        d = collections.Counter(b); d.subtract(a)
        return {k: v for k, v in d.items() if v}

    # ---- actions
    def add(s, kind, t0, t1, **kw):
        s.actions.append(dict(kind=kind, t0=t0, t1=t1, world=s.pos_at(t0)[0], **kw))

    def _containers(s):
        cur = None
        for e in s.ev:
            if e["type"] != "CONTAINER": continue
            if cur and (e["container"] == "closed" or e["container"] != cur["container"]):
                kind = {"crafting": "craft", "inventory": "inventory", "furnace": "furnace", "merchant": "trade_villager"}.get(cur["container"], "chest")
                at = cur["at"][0] if cur["at"] else None
                s.add(kind, cur["t"], e["t"], at=at, container=cur["container"], delta=s.inv_delta(cur["t"], e["t"]))
                cur = None
            if e["container"] != "closed": cur = e

    def _mining(s):
        open_ = {}
        for e in s.ev:
            if e["type"] == "BLOCK_PROGRESS":
                k = (e["world"], tuple(e["at"]))
                if k not in open_ or e["t"] - open_[k][1] > 40: open_[k] = [e["t"], e["t"]]
                else: open_[k][1] = e["t"]
            elif e["type"] in ("BLOCK_REMOVE", "BLOCK_BREAK"):
                k = (e["world"], tuple(e["at"]))
                if k in open_:
                    t0, _ = open_.pop(k)
                    s.add("mine", t0, e["t"], at=list(k[1]))
        # long abandoned mining attempts
        for k, (t0, t1) in open_.items():
            if t1 - t0 > 10: s.add("mine_abandoned", t0, t1, at=list(k[1]))

    def _pickups(s):
        items = {}
        for e in s.ev:
            if e["type"] == "ITEM_ENTITY": items[e["id"]] = e["item"]
            elif e["type"] == "ITEM_PICKUP" and e["collector"] == -2:
                s.add("pickup", e["t"], e["t"], item=items.get(e["id"], "?"), count=e["count"])

    def _throws(s):
        for e in s.ev:
            if e["type"] == "PROJECTILE" and e["entity"] in ("ender_pearl", "eye_of_ender"):
                s.add("throw_" + e["entity"], e["t"], e["t"], at=e["pos"])
            if e["type"] == "ENTITY_ADD" and e["entity"] == "eye_of_ender":
                s.add("throw_eye", e["t"], e["t"], at=e["pos"])

    def _trades(s):
        for e in s.ev:
            if e["type"] == "PIGLIN_BARTER":
                s.add("barter", e["t"], e["t"], items=e["items"])

    def _deaths(s):
        for name, t in s.splits.items():
            if name == "death": s.add("death", t, t)

    def _portals(s):
        prev = None
        for p in s.track:
            if prev and p[1] != prev[1]:
                s.add("portal", prev[0], p[0], at=[round(v) for v in prev[2:]], to=rpd2.WORLDS[p[1]])
            prev = p


# ---------- comparison

def anchors(r):
    """actions that identify a place in the shared world"""
    out = []
    for a in r.actions:
        if a["kind"] in ("chest", "craft", "furnace", "mine", "portal") and a.get("at"):
            out.append(a)
    return out


def match(a, b):
    if a["kind"] != b["kind"] or a["world"] != b["world"]: return False
    lim = 2 if a["kind"] == "mine" else 6
    return math.dist(a["at"], b["at"]) <= lim


def lcs(A, B):
    n, m = len(A), len(B)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            dp[i][j] = dp[i + 1][j + 1] + 1 if match(A[i], B[j]) else max(dp[i + 1][j], dp[i][j + 1])
    i = j = 0; pairs = []
    while i < n and j < m:
        if match(A[i], B[j]): pairs.append((A[i], B[j])); i += 1; j += 1
        elif dp[i + 1][j] >= dp[i][j + 1]: i += 1
        else: j += 1
    return pairs


def summarize(r, t0, t1):
    acts = [a for a in r.actions if t0 <= a["t0"] < t1]
    busy_spans = [(a["t0"], a["t1"]) for a in acts if a["t1"] > a["t0"]]
    busy = lambda t: any(x <= t <= y for x, y in busy_spans)
    by = collections.defaultdict(lambda: [0, 0.0])
    for a in acts:
        by[a["kind"]][0] += 1; by[a["kind"]][1] += (a["t1"] - a["t0"]) / TPS
    return dict(time=(t1 - t0) / TPS, path=r.path(t0, t1), idle=r.idle(t0, t1, busy), search=r.searching(t0, t1),
                acts={k: (n, round(d, 1)) for k, (n, d) in by.items()}, list=acts)


def compare(you, them):
    A, B = anchors(you), anchors(them)
    pairs = lcs(A, B)
    pts = [(0, 0)] + [(a["t0"], b["t0"]) for a, b in pairs]
    segs = []
    for (ya, ta), (yb, tb) in zip(pts, pts[1:]):
        loss = ((yb - ya) - (tb - ta)) / TPS
        segs.append(dict(you=(ya, yb), them=(ta, tb), loss=loss))
    # merge consecutive segments into windows of meaningful loss
    return pairs, segs


def main():
    path, me = sys.argv[1], sys.argv[2]
    meta, tl, ev = rpd2.decode(path)
    names = {p["uuid"]: p["nickname"] for p in meta["players"]}
    runs = {names[u]: Run(names[u], E, [x for x in tl if x["uuid"] == u]) for u, E in ev.items()}
    you = runs[me]; them = next(r for n, r in runs.items() if n != me)
    print(f"{you.name}: {len(you.actions)} actions | {them.name}: {len(them.actions)} actions")
    for r in (you, them):
        print(f"\n== {r.name} actions by kind:", collections.Counter(a["kind"] for a in r.actions))
    pairs, segs = compare(you, them)
    print(f"\nmatched {len(pairs)} shared-world anchors (same chest/block/portal/table)")
    run_gap = 0
    for s in segs:
        run_gap += s["loss"]
        if abs(s["loss"]) >= 4:
            y, t = summarize(you, *s["you"]), summarize(them, *s["them"])
            print(f"\n[{fmt(s['you'][0])}-{fmt(s['you'][1])} you | {fmt(s['them'][0])}-{fmt(s['them'][1])} them] "
                  f"loss {s['loss']:+.1f}s  (running gap {run_gap:+.1f}s)")
            for lab, d in (("you ", y), ("them", t)):
                print(f"   {lab}: {d['time']:.1f}s path {d['path']:.0f}b idle {d['idle']:.1f}s search {d['search']:.1f}s {d['acts']}")
    return runs, pairs, segs


if __name__ == "__main__":
    main()
