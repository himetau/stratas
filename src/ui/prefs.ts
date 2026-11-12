import {
  customTheme,
  DEFAULT_PREFS,
  mergePrefs,
  THEMES,
  type Prefs,
  type ThemeColors,
} from "../core/prefs";
import { rankOf } from "../core/tiers";
import { g } from "./bridge";

let cur: Prefs = DEFAULT_PREFS;
let elo: number | null = null;
const artUrls = new Map<string, string | null>();
const ART_KEY = /^(menu|menu_sharp|old:[0-9a-f]+|custom:[0-9a-f]{10})$/;
let appliedKey = "";

export const prefs = (): Prefs => cur;

const RANK_COLOR: Record<string, string> = {
  coal: "#a49a9a",
  iron: "#dcdcdc",
  gold: "#f5c542",
  emerald: "#4fe08a",
  diamond: "#6fe3e0",
  netherite: "#c9a0b4",
  unrated: "#ffb2ba",
};
export const rankColor = (e: number | null) =>
  RANK_COLOR[rankOf(e).key.replace(/_\d$/, "")] ?? RANK_COLOR.unrated;

/** Reduced motion from the setting, or from the system when it's left on system */
export const still = () =>
  cur.motion === "reduced" ||
  (cur.motion === "system" && matchMedia("(prefers-reduced-motion: reduce)").matches);

/** The colours of the picked theme, null for auto (the stylesheet or matugen's file decides) */
export function themeColors(p: Prefs = cur): ThemeColors | null {
  if (p.theme === "custom") {
    return customTheme(p.themeCustom);
  }
  return THEMES.find((t) => t.id === p.theme)?.c ?? null;
}

/** New prefs (and your Elo for the rank accent) from the app state */
export function setPrefs(p: Partial<Prefs> | undefined, yourElo: number | null) {
  cur = mergePrefs(p);
  elo = yourElo;
  const key = JSON.stringify([cur, elo]);
  if (key === appliedKey) {
    return;
  }
  appliedKey = key;
  apply();
}

const toBlob = (dataUrl: string) => {
  const [head, b64] = dataUrl.split(",", 2);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new Blob([bytes], { type: /^data:([^;]+)/.exec(head)?.[1] ?? "image/png" });
};

/** A background as an object URL, loaded once. Several MB is too big for a CSS variable as a data URL */
export async function artUrl(key: string): Promise<string | null> {
  if (artUrls.has(key)) {
    return artUrls.get(key)!;
  }
  const data = await g.rankedArt(key).catch(() => null);
  const url = data ? URL.createObjectURL(toBlob(data)) : null;
  if (url) {
    artUrls.set(key, url);
  }
  return url;
}

/** The picked art key, with unknown keys such as old seed type backgrounds falling back to the menu */
const knownArtKey = (art: string) => (ART_KEY.test(art) ? art : "menu");

/** Load the picked background if needed, then put it behind the pages */
function showArt() {
  const r = document.documentElement.style;
  if (cur.art === "off") {
    r.removeProperty("--ranked-bg");
    return;
  }
  const key = knownArtKey(cur.art);
  void artUrl(key).then((url) => {
    if (cur.art === "off" || knownArtKey(cur.art) !== key) {
      return;
    }
    if (url) {
      r.setProperty("--ranked-bg", `url("${url}")`);
    } else {
      r.removeProperty("--ranked-bg");
    }
  });
}

/** Change some prefs, show it right away and save */
export function savePrefs(patch: Partial<Prefs>) {
  cur = { ...cur, ...patch };
  appliedKey = JSON.stringify([cur, elo]);
  apply();
  void g.settings({ prefs: cur });
}

const PALETTE = [
  "--bg",
  "--bg-deep",
  "--bg-inset",
  "--bg-raised",
  "--bg-high",
  "--line",
  "--text",
  "--text-mid",
  "--text-dim",
  "--you",
  "--them",
  "--good",
  "--bad",
  "--warn",
];
/** The whole palette from a theme's few colours, mixed the same way as the stylesheet's palette */
function palette(c: ThemeColors): Record<string, string> {
  const mix = (a: string, pa: number, b: string) => `color-mix(in srgb, ${a} ${pa}%, ${b})`;
  return {
    "--bg": c.bg,
    "--bg-deep": mix(c.bg, 78, "black"),
    "--bg-inset": mix(c.bg, 78, "black"),
    "--bg-raised": mix(c.bg, 91, c.text),
    "--bg-high": mix(c.bg, 84, c.text),
    "--line": mix(c.bg, 66, c.text),
    "--text": c.text,
    "--text-mid": mix(c.text, 86, c.bg),
    "--text-dim": mix(c.text, 58, c.bg),
    "--you": c.you,
    "--them": c.them,
    "--good": c.good,
    "--bad": c.bad,
    "--warn": c.warn,
  };
}

/** Sets the look on the root element, where it wins over the theme file */
function apply() {
  const r = document.documentElement.style;
  const set = (k: string, v: string | null) =>
    v === null ? r.removeProperty(k) : r.setProperty(k, v);
  const t = themeColors();
  const pal = t ? palette(t) : null;
  for (const k of PALETTE) {
    set(k, pal?.[k] ?? null);
  }
  const accent = cur.rankAccent ? rankColor(elo) : (t?.accent ?? null);
  set("--accent", accent);
  set("--accent-soft", accent && `color-mix(in srgb, ${accent} 32%, var(--bg))`);
  set("--on-accent", accent && `color-mix(in srgb, ${accent} 22%, black)`);
  set(
    "--font",
    cur.font === "system" ? `ui-monospace, "JetBrains Mono", "Cascadia Mono", monospace` : null,
  );
  const notch = cur.corners === "square" ? "none" : null;
  set("--notch", notch);
  set("--notch-sm", notch);
  set("--art-blur", `${cur.artBlur}px`);
  set("--art-dim", `${cur.artDim}%`);
  showArt();
  set("--gap-outline", String(cur.outline / 100));
  r.zoom = cur.scale === 100 ? "" : String(cur.scale / 100);
  dispatchEvent(new Event("stratas-theme"));
  dispatchEvent(new Event("stratas-prefs"));
}

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  life: number;
};

const CELEBRATE_SECONDS = 3.4;

function confetti(w: number, height: number, colors: string[]): Particle[] {
  const out: Particle[] = [];
  for (let i = 0; i < 160; i++) {
    out.push({
      x: Math.random() * w,
      y: -20 - Math.random() * height * 0.5,
      vx: (Math.random() - 0.5) * 1.2,
      vy: 1.5 + Math.random() * 2.5,
      size: 3 + Math.round(Math.random() * 3),
      color: colors[i % colors.length],
      life: 1,
    });
  }
  return out;
}

function sparks(w: number, height: number, colors: string[]): Particle[] {
  const out: Particle[] = [];
  for (let b = 0; b < 5; b++) {
    const bx = w * (0.15 + Math.random() * 0.7);
    const by = height * (0.15 + Math.random() * 0.35);
    const color = colors[b % colors.length];
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const v = 1.5 + Math.random() * 3;
      out.push({
        x: bx,
        y: by,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 1,
        size: 3,
        color,
        life: 1 + b * 0.25,
      });
    }
  }
  return out;
}

/** Pixel confetti falling from the top, or sparks bursting from a few points */
export function celebrate(kind: Prefs["celebrate"] = cur.celebrate) {
  if (kind === "off" || still()) {
    return;
  }
  const c = document.createElement("canvas");
  c.className = "celebrate";
  document.body.appendChild(c);
  const w = (c.width = innerWidth);
  const height = (c.height = innerHeight);
  const ctx = c.getContext("2d")!;
  const css = getComputedStyle(document.documentElement);
  const colors = ["--accent", "--you", "--them", "--good", "--warn"].map(
    (v) => css.getPropertyValue(v).trim() || "#fff",
  );
  const particles = kind === "confetti" ? confetti(w, height, colors) : sparks(w, height, colors);
  const t0 = performance.now();
  const frame = (now: number) => {
    const age = (now - t0) / 1000;
    ctx.clearRect(0, 0, w, height);
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += kind === "confetti" ? 0.02 : 0.06;
      if (kind === "sparks") {
        p.vx *= 0.985;
        p.life -= 0.012;
      }
      ctx.globalAlpha = Math.max(0, Math.min(1, kind === "confetti" ? 3.2 - age : p.life));
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    if (age < CELEBRATE_SECONDS) {
      requestAnimationFrame(frame);
    } else {
      c.remove();
    }
  };
  requestAnimationFrame(frame);
}
