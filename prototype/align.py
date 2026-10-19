"""Progress alignment of two runs on the same seed via path DTW, plus finding windows.

gap(i) = (your time at sample i) - (their time at the matched place), in seconds.
"""
import math, sys, collections
import rpd2
from detect import Run, summarize, fmt, TPS

CAP = 40.0       # distance cost cap: divergent routes cost a constant instead of dominating
DIMPEN = 200.0   # different dimension


def samples(r, hz=1):
    out, k = [], 0
    step = TPS // hz
    for t in range(0, int(r.end) + 1, step):
        w, x, y, z = r.pos_at(t)
        out.append((t, w, x, y, z))
    return out


def cost(a, b):
    if a[1] != b[1]: return DIMPEN
    return min(math.dist(a[2:], b[2:]), CAP)


def dtw(A, B):
    n, m = len(A), len(B); INF = float("inf")
    D = [[INF] * (m + 1) for _ in range(n + 1)]; D[0][0] = 0
    P = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        Ai = A[i - 1]; Di, Dp = D[i], D[i - 1]; Pi = P[i]
        for j in range(1, m + 1):
            c = cost(Ai, B[j - 1])
            best, mv = Dp[j - 1], 0
            if Dp[j] < best: best, mv = Dp[j], 1
            if Di[j - 1] < best: best, mv = Di[j - 1], 2
            Di[j] = best + c; Pi[j] = mv
    i, j, path = n, m, []
    # allow the shorter run to end early: start backtrack from the best cell on the last row/col
    while i > 0 and j > 0:
        path.append((i - 1, j - 1))
        mv = P[i][j]
        if mv == 0: i, j = i - 1, j - 1
        elif mv == 1: i -= 1
        else: j -= 1
    return path[::-1]


def gap_curve(you, them):
    A, B = samples(you), samples(them)
    path = dtw(A, B)
    first = {}
    for i, j in path:
        if cost(A[i], B[j]) < 8: first.setdefault(i, j)    # confident spatial match only
    # gap at confident matches, interpolated in between
    pts = sorted((i, i - j) for i, j in first.items())
    return A, B, path, pts


def windows(pts, min_gain=6, max_len=90):
    """greedy: windows where the gap grows by >= min_gain s"""
    out, k = [], 0
    while k < len(pts) - 1:
        best = None
        for l in range(k + 1, len(pts)):
            if pts[l][0] - pts[k][0] > max_len: break
            g = pts[l][1] - pts[k][1]
            if g >= min_gain and (best is None or g > best[2]): best = (k, l, g)
        if best:
            # extend while still growing
            k0, l, g = best
            while l + 1 < len(pts) and pts[l + 1][1] >= pts[l][1] and pts[l + 1][0] - pts[l][0] < 30: l += 1
            out.append((pts[k0], pts[l])); k = l
        else: k += 1
    return out


if __name__ == "__main__":
    path, me = sys.argv[1], sys.argv[2]
    meta, tl, ev = rpd2.decode(path)
    names = {p["uuid"]: p["nickname"] for p in meta["players"]}
    runs = {names[u]: Run(names[u], E, [x for x in tl if x["uuid"] == u]) for u, E in ev.items()}
    you = runs[me]; them = next(r for n, r in runs.items() if n != me)
    A, B, p, pts = gap_curve(you, them)
    print(f"confident spatial matches: {len(pts)} of {len(A)} seconds")
    print("gap every 30s of your run:", [(fmt(i * TPS), g) for i, g in pts if i % 30 == 0])
    for (i0, g0), (i1, g1) in windows(pts):
        y = summarize(you, i0 * TPS, i1 * TPS); t = summarize(them, (i0 - g0) * TPS, (i1 - g1) * TPS)
        print(f"\nWINDOW you {fmt(i0*TPS)}-{fmt(i1*TPS)} | them {fmt((i0-g0)*TPS)}-{fmt((i1-g1)*TPS)}  lost {g1-g0:+d}s (gap {g0:+d} -> {g1:+d})")
        for lab, d in (("you ", y), ("them", t)):
            print(f"   {lab}: {d['time']:.0f}s path {d['path']:.0f}b idle {d['idle']:.1f}s search {d['search']:.1f}s {d['acts']}")
