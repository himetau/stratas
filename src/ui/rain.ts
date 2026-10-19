// Slow diagonal rain behind every page (like tetr.lol), static with reduced motion
export function startRain() {
  const c = document.createElement("canvas");
  c.id = "rain";
  document.body.prepend(c);
  const ctx = c.getContext("2d")!;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let w = 0, h = 0;
  type Drop = { x: number; y: number; len: number; v: number; a: number; dot: boolean };
  let drops: Drop[] = [];
  const color = () => getComputedStyle(document.documentElement).getPropertyValue("--text-dim").trim() || "#888";
  let col = color();
  const reset = () => {
    w = c.width = innerWidth; h = c.height = innerHeight;
    drops = Array.from({ length: Math.round((w * h) / 26000) }, () => ({
      x: Math.random() * w, y: Math.random() * h, len: 14 + Math.random() * 40, v: 0.15 + Math.random() * 0.45, a: 0.05 + Math.random() * 0.12, dot: Math.random() < 0.25,
    }));
  };
  const frame = () => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
    for (const d of drops) {
      ctx.globalAlpha = d.a;
      if (d.dot) ctx.fillRect(Math.round(d.x), Math.round(d.y), 2, 2);
      else { ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.len * 0.35, d.y + d.len); ctx.stroke(); }
      if (!still) { d.y += d.v; d.x -= d.v * 0.35; if (d.y > h + 40) { d.y = -40; d.x = Math.random() * (w + 200); } }
    }
    ctx.globalAlpha = 1;
    if (!still) requestAnimationFrame(frame);
  };
  addEventListener("resize", () => { reset(); if (still) frame(); });
  addEventListener("stratas-theme", () => { col = color(); if (still) frame(); });
  reset(); frame();
}
