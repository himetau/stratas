// Background effect behind every page: slow diagonal rain (like tetr.lol), snow, embers or twinkling stars.
// Amount and speed come from settings, static with reduced motion
import { prefs, still } from "./prefs";

type Drop = { x: number; y: number; len: number; v: number; a: number; dot: boolean; ph: number };

export function startRain() {
  const c = document.createElement("canvas");
  c.id = "rain";
  document.body.prepend(c);
  const ctx = c.getContext("2d")!;
  let w = 0, h = 0, drops: Drop[] = [], running = false, kind = prefs().effect;
  const color = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || "#888";
  let col = color("--text-dim"), warm = color("--warn");
  const reset = () => {
    w = c.width = innerWidth; h = c.height = innerHeight;
    const p = prefs();
    kind = p.effect;
    const per = kind === "stars" ? 9000 : kind === "snow" ? 16000 : kind === "embers" ? 30000 : 26000;
    drops = kind === "off" ? [] : Array.from({ length: Math.round(((w * h) / per) * p.effectAmount) }, () => ({
      x: Math.random() * w, y: Math.random() * h, len: 14 + Math.random() * 40, v: 0.15 + Math.random() * 0.45, a: 0.05 + Math.random() * 0.12,
      dot: Math.random() < 0.25, ph: Math.random() * Math.PI * 2,
    }));
  };
  const step = (d: Drop, sp: number, t: number) => {
    if (kind === "rain") { d.y += d.v * sp; d.x -= d.v * 0.35 * sp; if (d.y > h + 40) { d.y = -40; d.x = Math.random() * (w + 200); } }
    else if (kind === "snow") { d.y += d.v * 0.6 * sp; d.x += Math.sin(t / 1400 + d.ph) * 0.15 * sp; if (d.y > h + 4) { d.y = -4; d.x = Math.random() * w; } }
    else if (kind === "embers") { d.y -= d.v * 0.7 * sp; d.x += Math.sin(t / 900 + d.ph) * 0.25 * sp; if (d.y < -4) { d.y = h + 4; d.x = Math.random() * w; } }
  };
  const draw = (t: number) => {
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 1;
    const moving = !still(), sp = prefs().effectSpeed;
    for (const d of drops) {
      if (kind === "rain") {
        ctx.globalAlpha = d.a; ctx.strokeStyle = col; ctx.fillStyle = col;
        if (d.dot) ctx.fillRect(Math.round(d.x), Math.round(d.y), 2, 2);
        else { ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.len * 0.35, d.y + d.len); ctx.stroke(); }
      } else if (kind === "snow") {
        ctx.globalAlpha = d.a * 1.6; ctx.fillStyle = col;
        ctx.fillRect(Math.round(d.x), Math.round(d.y), d.dot ? 3 : 2, d.dot ? 3 : 2);
      } else if (kind === "embers") {
        ctx.globalAlpha = Math.min(0.6, d.a * 3) * (0.6 + 0.4 * Math.sin(t / 300 + d.ph)); ctx.fillStyle = warm;
        ctx.fillRect(Math.round(d.x), Math.round(d.y), 2, 2);
      } else {
        ctx.globalAlpha = d.a * (moving ? 0.5 + 0.5 * Math.sin((t / 1600) * sp + d.ph) : 1) * 1.5; ctx.fillStyle = col;
        ctx.fillRect(Math.round(d.x), Math.round(d.y), d.dot ? 2 : 1, d.dot ? 2 : 1);
      }
      if (moving) step(d, sp, t);
    }
    ctx.globalAlpha = 1;
  };
  const frame = (t: number) => {
    draw(t);
    if (!still() && kind !== "off") requestAnimationFrame(frame); else running = false;
  };
  const start = () => { if (running) return; running = true; requestAnimationFrame(frame); };
  addEventListener("resize", () => { reset(); draw(performance.now()); start(); });
  addEventListener("stratas-theme", () => { col = color("--text-dim"); warm = color("--warn"); draw(performance.now()); });
  // Rebuild only when the effect or its amount changed, speed and motion just apply
  let shape = "";
  addEventListener("stratas-prefs", () => {
    const p = prefs(), next = `${p.effect}|${p.effectAmount}`;
    if (next !== shape) { shape = next; reset(); }
    draw(performance.now()); start();
  });
  shape = `${prefs().effect}|${prefs().effectAmount}`;
  reset(); start();
}
