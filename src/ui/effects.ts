import { prefs, still } from "./prefs";

type Drop = { x: number; y: number; v: number; a: number; dot: boolean; ph: number };

/** Screen area in square pixels per drop at amount 1. */
const AREA_PER_DROP = { stars: 9000, snow: 16000, embers: 30000 };

const cssColor = (v: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(v).trim() || "#888";

const shapeOf = () => `${prefs().effect}|${prefs().effectAmount}`;

function randomDrop(w: number, h: number): Drop {
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    v: 0.15 + Math.random() * 0.45,
    a: 0.05 + Math.random() * 0.12,
    dot: Math.random() < 0.25,
    ph: Math.random() * Math.PI * 2,
  };
}

export function startEffects() {
  const c = document.createElement("canvas");
  c.id = "fx";
  document.body.prepend(c);
  const ctx = c.getContext("2d")!;
  let w = 0;
  let h = 0;
  let drops: Drop[] = [];
  let running = false;
  let kind = prefs().effect;
  let col = cssColor("--text-dim");
  let warm = cssColor("--warn");
  const reset = () => {
    w = c.width = innerWidth;
    h = c.height = innerHeight;
    const p = prefs();
    kind = p.effect;
    if (kind === "off") {
      drops = [];
      return;
    }
    const length = Math.round(((w * h) / AREA_PER_DROP[kind]) * p.effectAmount);
    drops = Array.from({ length }, () => randomDrop(w, h));
  };
  const step = (d: Drop, sp: number, t: number) => {
    if (kind === "snow") {
      d.y += d.v * 0.6 * sp;
      d.x += Math.sin(t / 1400 + d.ph) * 0.15 * sp;
      if (d.y > h + 4) {
        d.y = -4;
        d.x = Math.random() * w;
      }
    } else if (kind === "embers") {
      d.y -= d.v * 0.7 * sp;
      d.x += Math.sin(t / 900 + d.ph) * 0.25 * sp;
      if (d.y < -4) {
        d.y = h + 4;
        d.x = Math.random() * w;
      }
    }
  };
  const draw = (t: number) => {
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 1;
    const moving = !still();
    const sp = prefs().effectSpeed;
    for (const d of drops) {
      if (kind === "snow") {
        ctx.globalAlpha = d.a * 1.6;
        ctx.fillStyle = col;
        ctx.fillRect(Math.round(d.x), Math.round(d.y), d.dot ? 3 : 2, d.dot ? 3 : 2);
      } else if (kind === "embers") {
        ctx.globalAlpha = Math.min(0.6, d.a * 3) * (0.6 + 0.4 * Math.sin(t / 300 + d.ph));
        ctx.fillStyle = warm;
        ctx.fillRect(Math.round(d.x), Math.round(d.y), 2, 2);
      } else {
        ctx.globalAlpha = d.a * (moving ? 0.5 + 0.5 * Math.sin((t / 1600) * sp + d.ph) : 1) * 1.5;
        ctx.fillStyle = col;
        ctx.fillRect(Math.round(d.x), Math.round(d.y), d.dot ? 2 : 1, d.dot ? 2 : 1);
      }
      if (moving) {
        step(d, sp, t);
      }
    }
    ctx.globalAlpha = 1;
  };
  const frame = (t: number) => {
    draw(t);
    if (!still() && kind !== "off") {
      requestAnimationFrame(frame);
    } else {
      running = false;
    }
  };
  const start = () => {
    if (running) {
      return;
    }
    running = true;
    requestAnimationFrame(frame);
  };
  addEventListener("resize", () => {
    reset();
    draw(performance.now());
    start();
  });
  addEventListener("stratas-theme", () => {
    col = cssColor("--text-dim");
    warm = cssColor("--warn");
    draw(performance.now());
  });
  let shape = shapeOf();
  addEventListener("stratas-prefs", () => {
    const next = shapeOf();
    if (next !== shape) {
      shape = next;
      reset();
    }
    draw(performance.now());
    start();
  });
  reset();
  start();
}
