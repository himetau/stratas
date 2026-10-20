// Shared UI bits: panels, kv grids, buttons with key hints, copy fields, shortcuts
import { g } from "./bridge";
import { rankOf } from "../core/tiers";
import { h, toast } from "./dom";

type Kid = Parameters<typeof h>[2];

export function panel(title: string | null, opts: { right?: Kid; cls?: string } | null, ...kids: Kid[]) {
  return h("section", { class: `card ${opts?.cls ?? ""}` },
    title || opts?.right ? h("div", { class: "card-head" }, title ? h("h2", null, title) : h("span"), opts?.right ?? null) : null, ...kids);
}

/** Collapsible panel with the tetr chevron */
export function fold(title: Kid, open: boolean, cls: string, ...kids: Kid[]) {
  return h("details", { class: `card ${cls}`, open },
    h("summary", { class: "card-head" }, title, h("span", { class: "chevron" }, "›")), ...kids);
}

export function btn(label: string, onclick: () => void, o: { key?: string; primary?: boolean; ghost?: boolean; danger?: boolean; sm?: boolean; disabled?: boolean } = {}) {
  if (o.key && !o.disabled) bindKey(o.key, onclick);
  return h("button", { class: ["btn", o.primary && "primary", o.ghost && "ghost", o.danger && "danger", o.sm && "sm"].filter(Boolean).join(" "), onclick, disabled: o.disabled },
    label, o.key ? h("span", { class: "kbd" }, o.key === "Escape" ? "ESC" : o.key.toUpperCase()) : null);
}

export const copy = (text: string, what: string) => { void g.copy(text); toast(`${what} copied`); };

export async function openInMinecraft(file: string) {
  const r = await g.openInMinecraft(file);
  toast(r.message, 6000);
}

export function copyField(k: string, v: string, key?: string, onCopy?: () => void) {
  return h("div", { class: "field" }, h("span", { class: "k" }, k), h("span", { class: "v" }, v), btn("Copy", () => { copy(v, k); onCopy?.(); }, { sm: true, key }));
}

// ---- page shortcuts, rebound every render so only what's on screen responds
let keys = new Map<string, () => void>();
let next = new Map<string, () => void>();
export function bindKey(key: string, fn: () => void) { next.set(key.toLowerCase(), fn); }
export function commitKeys() { keys = next; next = new Map(); }
export function handleKey(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement;
  if (e.ctrlKey || e.metaKey || e.altKey || t.closest("input, select, textarea")) return false;
  const fn = keys.get(e.key.toLowerCase());
  if (!fn) return false;
  e.preventDefault(); fn();
  return true;
}

// ---- ranks

let rankIcons: Record<string, string> = {};
export const setRankIcons = (x: Record<string, string>) => { rankIcons = x; };

/** In-game rank icon + Elo, rank name in the tooltip */
/** Level is named by the Elo it starts at ("1400+"), custom range is just "custom" */
export function tierName(tiers: Record<"next" | "stretch" | "ceiling", [number, number]> | null | undefined, tier: string | null | undefined): string {
  if (tier === "manual") return "custom";
  if (tier === "player") return "by name";
  const b = tiers && tier && tier in tiers ? tiers[tier as "next" | "stretch" | "ceiling"] : null;
  return b ? `${b[0]}+` : "";
}

export function rank(elo: number | null | undefined, cls = "") {
  const r = rankOf(elo);
  const icon = rankIcons[r.key];
  return h("span", { class: `rank ${cls}`, title: r.name },
    icon ? h("img", { src: icon, alt: r.name }) : null,
    h("span", null, elo != null ? String(elo) : r.name));
}

// ---- player heads (face + hat layer of the skin)

const skins = new Map<string, Promise<HTMLImageElement | null>>();
/** Decoded skins cache so heads don't blink on redraw */
const decoded = new Map<string, HTMLImageElement>();
export function head(who: { uuid?: string | null; name: string }, size = 24) {
  const c = h("canvas", { class: "head", width: 8, height: 8, style: `width:${size}px;height:${size}px`, title: who.name });
  const key = `${who.uuid ?? ""}|${who.name.toLowerCase()}`;
  const paint = (img: HTMLImageElement) => {
    const x = c.getContext("2d")!;
    x.imageSmoothingEnabled = false;
    x.drawImage(img, 8, 8, 8, 8, 0, 0, 8, 8);
    x.drawImage(img, 40, 8, 8, 8, 0, 0, 8, 8);
    c.classList.add("ok");
  };
  const ready = decoded.get(key);
  if (ready) { paint(ready); return c; }
  let p = skins.get(key);
  if (!p) {
    p = g.skin({ uuid: who.uuid ?? null, name: who.name }).catch(() => null).then((url) => url ? new Promise<HTMLImageElement | null>((done) => {
      const img = new Image();
      img.onload = () => { decoded.set(key, img); done(img); };
      img.onerror = () => done(null);
      img.src = url;
    }) : null);
    skins.set(key, p);
  }
  void p.then((img) => { if (img) paint(img); });
  return c;
}
