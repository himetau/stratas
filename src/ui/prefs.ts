// Settings page prefs on the UI side: the current values, applying the look to the page, saving changes
import { customTheme, DEFAULT_PREFS, mergePrefs, THEMES, type Prefs, type ThemeColors } from "../core/prefs";
import { rankOf } from "../core/tiers";
import { g } from "./bridge";

let cur: Prefs = DEFAULT_PREFS;
let elo: number | null = null;
// Background art: object URLs loaded so far
const art = new Map<string, string | null>();
const ART_KEY = /^(menu|menu_sharp|old:[0-9a-f]+|custom:[0-9a-f]{10})$/;
let last = "";

export const prefs = (): Prefs => cur;

const RANK_COLOR: Record<string, string> = {
  coal: "#a49a9a", iron: "#dcdcdc", gold: "#f5c542", emerald: "#4fe08a", diamond: "#6fe3e0", netherite: "#c9a0b4", unrated: "#ffb2ba",
};
export const rankColor = (e: number | null) => RANK_COLOR[rankOf(e).key.replace(/_\d$/, "")] ?? RANK_COLOR.unrated;

/** Reduced motion from the setting, or from the system when it's left on system */
export const still = () => cur.motion === "reduced" || (cur.motion === "system" && matchMedia("(prefers-reduced-motion: reduce)").matches);

/** The colours of the picked theme, null for auto (the stylesheet or matugen's file decides) */
export function themeColors(p: Prefs = cur): ThemeColors | null {
  if (p.theme === "custom") return customTheme(p.themeCustom);
  return THEMES.find((t) => t.id === p.theme)?.c ?? null;
}

/** New prefs (and your Elo for the rank accent) from the app state */
export function setPrefs(p: Partial<Prefs> | undefined, yourElo: number | null) {
  cur = mergePrefs(p);
  elo = yourElo;
  const key = JSON.stringify([cur, elo]);
  if (key === last) return;
  last = key;
  apply();
}

const toBlob = (dataUrl: string) => {
  const [head, b64] = dataUrl.split(",", 2), bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: /^data:([^;]+)/.exec(head)?.[1] ?? "image/png" });
};

/** A background as an object URL, loaded once. Several MB is too big for a CSS variable as a data URL */
export async function artUrl(key: string): Promise<string | null> {
  if (art.has(key)) return art.get(key)!;
  const data = await g.rankedArt(key).catch(() => null);
  const url = data ? URL.createObjectURL(toBlob(data)) : null;
  if (url) art.set(key, url);
  return url;
}

/** Load the picked background if needed, then put it behind the pages */
function showArt() {
  // Anything else is from before (the seed type backgrounds), back to the current menu
  const key = cur.art === "off" ? null : ART_KEY.test(cur.art) ? cur.art : "menu";
  const r = document.documentElement.style;
  if (!key) { r.removeProperty("--ranked-bg"); return; }
  void artUrl(key).then((url) => {
    // Only if it's still the one wanted by the time it loaded
    if ((ART_KEY.test(cur.art) ? cur.art : "menu") !== key) return;
    if (url) r.setProperty("--ranked-bg", `url("${url}")`); else r.removeProperty("--ranked-bg");
  });
}

/** Change some prefs, show it right away and save */
export function savePrefs(patch: Partial<Prefs>) {
  cur = { ...cur, ...patch };
  last = JSON.stringify([cur, elo]);
  apply();
  void g.settings({ prefs: cur });
}

// The whole palette from a theme's few colours, the same mixes the stylesheet's palette follows
const PALETTE = ["--bg", "--bg-deep", "--bg-inset", "--bg-raised", "--bg-high", "--line", "--text", "--text-mid", "--text-dim", "--you", "--them", "--good", "--bad", "--warn"];
function palette(c: ThemeColors): Record<string, string> {
  const mix = (a: string, pa: number, b: string) => `color-mix(in srgb, ${a} ${pa}%, ${b})`;
  return {
    "--bg": c.bg, "--bg-deep": mix(c.bg, 78, "black"), "--bg-inset": mix(c.bg, 78, "black"), "--bg-raised": mix(c.bg, 91, c.text), "--bg-high": mix(c.bg, 84, c.text),
    "--line": mix(c.bg, 66, c.text), "--text": c.text, "--text-mid": mix(c.text, 86, c.bg), "--text-dim": mix(c.text, 58, c.bg),
    "--you": c.you, "--them": c.them, "--good": c.good, "--bad": c.bad, "--warn": c.warn,
  };
}

// Set on the root element so they win over the theme file
function apply() {
  const r = document.documentElement.style;
  const set = (k: string, v: string | null) => (v === null ? r.removeProperty(k) : r.setProperty(k, v));
  const t = themeColors();
  const pal = t ? palette(t) : null;
  for (const k of PALETTE) set(k, pal?.[k] ?? null);
  const accent = cur.rankAccent ? rankColor(elo) : t?.accent ?? null;
  set("--accent", accent);
  set("--accent-soft", accent && `color-mix(in srgb, ${accent} 32%, var(--bg))`);
  set("--on-accent", accent && `color-mix(in srgb, ${accent} 22%, black)`);
  set("--font", cur.font === "system" ? `ui-monospace, "JetBrains Mono", "Cascadia Mono", monospace` : null);
  set("--notch", cur.corners === "square" ? "none" : null);
  set("--notch-sm", cur.corners === "square" ? "none" : null);
  set("--art-blur", `${cur.artBlur}px`);
  set("--art-dim", `${cur.artDim}%`);
  showArt();
  set("--gap-outline", String(cur.outline / 100));
  r.zoom = cur.scale === 100 ? "" : String(cur.scale / 100);
  // Canvas drawings (background effect, charts) read colours, so tell them like a theme change
  dispatchEvent(new Event("stratas-theme"));
  dispatchEvent(new Event("stratas-prefs"));
}

// ---- win celebration

/** Pixel confetti falling from the top, or sparks bursting from a few points */
export function celebrate(kind: Prefs["celebrate"] = cur.celebrate) {
  if (kind === "off" || still()) return;
  const c = document.createElement("canvas");
  c.className = "celebrate";
  document.body.appendChild(c);
  const w = (c.width = innerWidth), hgt = (c.height = innerHeight), x = c.getContext("2d")!;
  const css = getComputedStyle(document.documentElement);
  const cols = ["--accent", "--you", "--them", "--good", "--warn"].map((v) => css.getPropertyValue(v).trim() || "#fff");
  type P = { x: number; y: number; vx: number; vy: number; s: number; c: string; life: number };
  const ps: P[] = [];
  if (kind === "confetti") {
    for (let i = 0; i < 160; i++) ps.push({ x: Math.random() * w, y: -20 - Math.random() * hgt * 0.5, vx: (Math.random() - 0.5) * 1.2, vy: 1.5 + Math.random() * 2.5, s: 3 + Math.round(Math.random() * 3), c: cols[i % cols.length], life: 1 });
  } else {
    for (let b = 0; b < 5; b++) {
      const bx = w * (0.15 + Math.random() * 0.7), by = hgt * (0.15 + Math.random() * 0.35), col = cols[b % cols.length];
      for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2, v = 1.5 + Math.random() * 3; ps.push({ x: bx, y: by, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1, s: 3, c: col, life: 1 + b * 0.25 }); }
    }
  }
  const t0 = performance.now();
  const frame = (now: number) => {
    const age = (now - t0) / 1000;
    x.clearRect(0, 0, w, hgt);
    for (const p of ps) {
      p.x += p.vx; p.y += p.vy;
      p.vy += kind === "confetti" ? 0.02 : 0.06;
      if (kind === "sparks") { p.vx *= 0.985; p.life -= 0.012; }
      x.globalAlpha = Math.max(0, Math.min(1, kind === "confetti" ? 3.2 - age : p.life));
      x.fillStyle = p.c;
      x.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s);
    }
    if (age < 3.4) requestAnimationFrame(frame); else c.remove();
  };
  requestAnimationFrame(frame);
}
