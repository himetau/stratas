# Stratas logo: a little layered jelly on a glossy coral tile, 32x32 pixel art.
# python3 packaging/make_logo.py packaging  -> icon-{16..512}.png and icon.svg (src/ui/logo.png is the 64 px one)
import math, sys
from PIL import Image

N = 32
OUT = sys.argv[1] if len(sys.argv) > 1 else "."

def hexc(h, a=255):
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)

C = {
    # tile: a pixel gradient, top lighter, with a gloss row and a darker rim
    "t0": hexc("#ff7b93"), "t1": hexc("#f6667f"), "t2": hexc("#ee566f"), "t3": hexc("#e44863"), "t4": hexc("#d83b57"),
    "gl": hexc("#ff9cb0"), "rim": hexc("#c22f4b"), "sh": hexc("#c93652"),
    # the jelly: cream top with a face, then pink, cream and rose layers
    "W": hexc("#fff8f4"), "Wd": hexc("#f8e2e2"), "Wh": hexc("#ffffff"),
    "P": hexc("#ffb3c4"), "Pd": hexc("#f497ad"),
    "C": hexc("#fff0e6"), "Cd": hexc("#f6dcd2"),
    "R": hexc("#ff8fa8"), "Rd": hexc("#ec7491"),
    "E": hexc("#4a1d2e"), "Eh": hexc("#ffffff"), "B": hexc("#ff9fb5"), "M": hexc("#c4506e"),
    # heart clip
    "H": hexc("#ff4f74"), "Hd": hexc("#d93358"), "Hh": hexc("#ffc2cf"),
}

img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
px = img.load()

# ---- tile: a rounded square with stepped pixel corners
R = 7
def in_tile(x, y):
    cx = min(max(x, R - 0.5), N - R - 0.5)
    cy = min(max(y, R - 0.5), N - R - 0.5)
    return (x - cx) ** 2 + (y - cy) ** 2 <= (R + 0.2) ** 2

bands = ["t0", "t1", "t2", "t3", "t4"]
for y in range(N):
    for x in range(N):
        if not in_tile(x, y):
            continue
        # dithered steps between bands
        # wide flat bands; only the row where two meet is checkered
        f = y / N * len(bands)
        i = min(int(f), len(bands) - 1)
        edge = (f - i) < (1 / N * len(bands)) and i > 0
        c = bands[i - 1] if edge and (x + y) % 2 else bands[i]
        px[x, y] = C[c]
# gloss along the top and a rim along the bottom
for y in range(N):
    for x in range(N):
        if not in_tile(x, y):
            continue
        if not in_tile(x, y - 1) or y == 1 and in_tile(x, y - 1) and not in_tile(x, y - 2):
            px[x, y] = C["gl"]
        if not in_tile(x, y + 1) or not in_tile(x, y + 2):
            px[x, y] = C["rim"]

# ---- the jelly: a dome over a rounded block
X0, X1, Y0, Y1 = 6, 25, 7, 26   # inclusive
def in_body(x, y):
    if x < X0 or x > X1 or y < Y0 or y > Y1:
        return False
    w = (X1 - X0 + 1) / 2
    cx = (X0 + X1) / 2
    if y < Y0 + 9:  # dome
        dy = (Y0 + 9) - y
        return abs(x - cx) <= math.sqrt(max(0, w * w - (dy * w / 9.6) ** 2)) + 0.3
    if y > Y1 - 2:  # soft bottom corners
        inset = 1 if y == Y1 - 1 else 2
        return X0 + inset <= x <= X1 - inset
    return True

# a soft shadow under it
for x in range(X0 + 1, X1):
    px[x, Y1 + 1] = C["sh"]
for x in range(X0 + 3, X1 - 2):
    px[x, Y1 + 2] = C["sh"]

def layer(y):
    if y <= 17: return "W"
    if y <= 19: return "P"
    if y <= 21: return "C"
    if y <= 23: return "R"
    return "P"

for y in range(N):
    for x in range(N):
        if not in_body(x, y):
            continue
        k = layer(y)
        edge_r = not in_body(x + 1, y) or not in_body(x + 1, y + 1)
        edge_b = not in_body(x, y + 1)
        px[x, y] = C[k + "d"] if (edge_r or edge_b) else C[k]
        # a wobble where layers meet
        if layer(y) != layer(y - 1) and in_body(x, y - 1) and (x % 3 == 0):
            px[x, y] = C[layer(y - 1)]

# gloss on the dome
for (x, y) in [(9, 10), (10, 9), (11, 9), (9, 11), (12, 8)]:
    px[x, y] = C["Wh"]

# face
for (x, y) in [(11, 13), (11, 14), (20, 13), (20, 14)]:
    px[x, y] = C["E"]
for (x, y) in [(9, 15), (10, 15), (21, 15), (22, 15)]:
    px[x, y] = C["B"]
for (x, y) in [(15, 15), (16, 15)]:
    px[x, y] = C["M"]

# heart clip on the right of the dome
heart = [
    ".HH.HH.",
    "HhHHHHH",
    "HHHHHHd",
    ".HHHHd.",
    "..HHd..",
    "...d...",
]
hx, hy = 20, 4
for j, row in enumerate(heart):
    for i, ch in enumerate(row):
        if ch == ".": continue
        px[hx + i, hy + j] = C[{"H": "H", "h": "Hh", "d": "Hd"}[ch]]

img.save(f"{OUT}/icon-32.png")
for s in (16, 64, 128, 256, 512):
    img.resize((s, s), Image.NEAREST).save(f"{OUT}/icon-{s}.png")

# svg with one rect per pixel
rects = []
for y in range(N):
    for x in range(N):
        r, g, b, a = px[x, y]
        if a:
            rects.append(f'<rect x="{x}" y="{y}" width="1" height="1" fill="#{r:02x}{g:02x}{b:02x}"/>')
open(f"{OUT}/icon.svg", "w").write(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {N} {N}" shape-rendering="crispEdges">' + "".join(rects) + "</svg>\n")
print("ok")
