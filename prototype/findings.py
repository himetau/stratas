"""Findings: exact time decomposition per window + evidence. Prototype."""
import collections, math, sys
import rpd2
from detect import Run, fmt, TPS
from align import gap_curve

STATES = ["dead", "screen", "mining", "idle", "moving"]
SCREEN_NAMES = {"craft": "crafting table", "inventory": "inventory", "chest": "chest", "furnace": "furnace", "trade_villager": "villager trade"}


def timeline_states(r):
    """one state per tick, priority dead > screen > mining > idle > moving"""
    n = int(r.end) + 1
    st = ["moving"] * n
    # idle from track speed
    pos = [r.pos_at(t) for t in range(n)]
    for t in range(n):
        a, b = pos[max(0, t - 10)], pos[min(n - 1, t + 10)]
        if a[0] == b[0] and math.dist((a[1], a[3]), (b[1], b[3])) < 1.0: st[t] = "idle"
    for a in r.actions:
        lo, hi = int(a["t0"]), min(n, int(a["t1"]) + 1)
        k = {"mine": "mining", "mine_abandoned": "mining"}.get(a["kind"]) or ("screen" if a["kind"] in SCREEN_NAMES else None)
        if not k: continue
        for t in range(lo, hi):
            if STATES.index(k) < STATES.index(st[t]): st[t] = k
    # death: from death to first time back within 8 blocks of the death spot
    for a in r.actions:
        if a["kind"] == "death":
            d = int(a["t0"]); spot = pos[max(0, d - 2)]
            back = next((t for t in range(d + 40, n) if pos[t][0] == spot[0] and math.dist(pos[t][1:], spot[1:]) < 8), None)
            r.death_info = dict(t=d, spot=spot, back=back)
            for t in range(d, back or n): st[t] = "dead"
    return st, pos


def screen_detail(r, t0, t1):
    out = collections.defaultdict(lambda: [0, 0.0, collections.Counter()])
    for a in r.actions:
        if a["kind"] in SCREEN_NAMES and t0 <= a["t0"] < t1:
            o = out[a["kind"]]; o[0] += 1; o[1] += (a["t1"] - a["t0"]) / TPS
            for k, v in a.get("delta", {}).items():
                if v > 0: o[2][k] += v
    return out


def mined_detail(r, t0, t1):
    """what was mined: items picked up within 3 s after each mine action"""
    got = collections.Counter(); n = 0; secs = 0
    picks = [a for a in r.actions if a["kind"] == "pickup"]
    for a in r.actions:
        if a["kind"] == "mine" and t0 <= a["t0"] < t1:
            n += 1; secs += (a["t1"] - a["t0"]) / TPS
            for p in picks:
                if a["t1"] <= p["t0"] <= a["t1"] + 60: got[p["item"]] += p["count"]; break
    return n, secs, got


def barter_detail(r, t0, t1):
    gold_in = 0; out = collections.Counter(); n = 0
    for a in r.actions:
        if a["kind"] == "barter" and t0 <= a["t0"] < t1:
            n += 1
            for it, c in a["items"]: out[it] += c
    return n, out


def explain(you, them, ys, ts, w):
    (i0, g0), (i1, g1) = w
    yt0, yt1 = i0 * TPS, i1 * TPS
    tt0, tt1 = (i0 - g0) * TPS, (i1 - g1) * TPS
    yc = collections.Counter(ys[yt0:yt1]); tc = collections.Counter(ts[int(tt0):int(tt1)])
    parts = {s: (yc[s] - tc[s]) / TPS for s in STATES}
    lines = []
    total = g1 - g0
    head = f"you {fmt(yt0)}–{fmt(yt1)} | them {fmt(tt0)}–{fmt(tt1)} | {total:+d} s"
    for s in sorted(parts, key=lambda s: -parts[s]):
        v = parts[s]
        if v < 2: continue
        if s == "screen":
            yd, td = screen_detail(you, yt0, yt1), screen_detail(them, tt0, tt1)
            for k in sorted(set(yd) | set(td), key=lambda k: -(yd[k][1] - td[k][1])):
                dv = yd[k][1] - td[k][1]
                if dv < 2: continue
                made = ", ".join(f"{c} {i}" for i, c in yd[k][2].most_common(4))
                lines.append(f"  {dv:+.0f}s  {SCREEN_NAMES[k]} open {yd[k][1]:.0f}s ({yd[k][0]}×) vs {td[k][1]:.0f}s ({td[k][0]}×)" + (f"; you came out with {made}" if made else ""))
        elif s == "mining":
            yn, ysec, yg = mined_detail(you, yt0, yt1); tn, tsec, tg = mined_detail(them, tt0, tt1)
            extra = yg.copy(); extra.subtract(tg); extra = +extra
            lines.append(f"  {v:+.0f}s  mining: {yn} blocks in {ysec:.0f}s vs {tn} in {tsec:.0f}s" + (f"; you got extra {', '.join(f'{c} {i}' for i, c in extra.most_common(4))}" if extra else ""))
        elif s == "idle":
            ys_ = you.searching(yt0, yt1); ts_ = them.searching(tt0, tt1)
            lines.append(f"  {v:+.0f}s  standing still: {yc['idle']/TPS:.0f}s vs {tc['idle']/TPS:.0f}s" + (f" (camera sweeping {ys_:.0f}s vs {ts_:.0f}s)" if ys_ - ts_ >= 2 else ""))
        elif s == "moving":
            yp, tp = you.path(yt0, yt1), them.path(tt0, tt1)
            lines.append(f"  {v:+.0f}s  moving: {yc['moving']/TPS:.0f}s for {yp:.0f} blocks vs {tc['moving']/TPS:.0f}s for {tp:.0f} blocks")
        elif s == "dead":
            d = you.death_info
            lines.append(f"  {v:+.0f}s  death at {fmt(d['t'])}: back at the death spot {fmt(d['back']) if d['back'] else 'never'}")
    yb, yo = barter_detail(you, yt0, yt1); tb, to = barter_detail(them, tt0, tt1)
    if yb - tb >= 8:
        lines.append(f"  note: {yb} barters vs {tb}")
    return head, lines


def main():
    path, me = sys.argv[1], sys.argv[2]
    meta, tl, ev = rpd2.decode(path)
    names = {p["uuid"]: p["nickname"] for p in meta["players"]}
    runs = {names[u]: Run(names[u], E, [x for x in tl if x["uuid"] == u]) for u, E in ev.items()}
    you = runs[me]; them = next(r for n, r in runs.items() if n != me)
    ys, _ = timeline_states(you); ts, _ = timeline_states(them)
    A, B, p, pts = gap_curve(you, them)
    # windows = consecutive confident points where gap grew >= 6 s, including jumps across unmatched stretches
    marks = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        if b[0] - a[0] > 20: marks += [a, b]
    marks.append(pts[-1])
    # split into ~phase-sized windows at local minima of the gap
    ws, start = [], pts[0]
    for k in range(1, len(pts)):
        prev, cur = pts[k - 1], pts[k]
        nxt = pts[k + 1] if k + 1 < len(pts) else None
        jump = cur[0] - prev[0] > 20
        if jump:
            if prev[1] - start[1] >= 6: ws.append((start, prev))
            if cur[1] - prev[1] >= 6: ws.append((prev, cur))
            start = cur; continue
        if nxt and cur[1] < prev[1] - 3 and cur[1] <= nxt[1]:   # gap started shrinking: close window
            if prev[1] - start[1] >= 6: ws.append((start, prev))
            start = cur
    if pts[-1][1] - start[1] >= 6: ws.append((start, pts[-1]))
    print(f"{you.name} vs {them.name}: final gap {pts[-1][1]:+d}s at your {fmt(pts[-1][0]*TPS)}")
    for w in sorted(ws, key=lambda w: -(w[1][1] - w[0][1])):
        h, ls = explain(you, them, ys, ts, w)
        print("\n" + h); print("\n".join(ls) if ls else "  (no single cause above 2 s)")


if __name__ == "__main__":
    main()
