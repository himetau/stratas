// Race graph, gap to the opponent over your run time. Hover a phase for details, click to zoom (Esc to zoom out)
// Layers, how moments show and the rest of the look come from settings
import { buildDeltaModel } from "../core/detect/segments";
import type { RaceAnalysis } from "./bridge";
import { fmtDelta, h } from "./dom";
import { phaseIconKey, phaseIconKeys, structIcon } from "./ranked";
import { prefs, savePrefs, still } from "./prefs";
import type { Prefs } from "../core/prefs";
import type { CraftScreen } from "../core/detect/stats";
import { listItems } from "../core/detect/steps";

const NS = "http://www.w3.org/2000/svg";
const PAD_L = 64, PAD_R = 14, PLOT_H = 210, RAIL_H = 74;

/** Phase span on your clock (you0..you1) and on theirs (them0..them1) */
/** them0/them1 stretch to cover their steps in the phase, themFrom/themTo are their actual splits */
export interface PhaseBand { phase: string; you0: number; you1: number; them0: number; them1: number; themFrom: number; themTo: number; change: number | null; you: number | null; them: number | null }

/** Your span in each report phase, in play order */
export function phaseBands(a: RaceAnalysis): PhaseBand[] {
  const out: PhaseBand[] = [];
  for (const s of buildDeltaModel(a).segments) {
    const name = s.reportPhase ?? s.segLabel;
    const last = out.at(-1);
    if (last && last.phase === name) { last.you1 = s.you1; last.them1 = Math.max(last.them1, s.them1); last.themTo = s.them1; }
    else {
      const p = a.report?.find((r) => r.phase === name);
      const st = p?.steps?.them ?? [];
      out.push({ phase: name, you0: s.you0, you1: s.you1, them0: st.length ? Math.min(...st.map((x) => x.t0)) / 20 : s.them0, them1: st.length ? Math.max(s.them1, ...st.map((x) => x.t1 / 20)) : s.them1, themFrom: s.them0, themTo: s.them1,
        change: p?.change ?? null, you: p?.you ?? null, them: p?.them ?? null });
    }
  }
  return out;
}

/** Gap at any second, read off the curve */
function gapLookup(curve: [number, number][]) {
  return (sec: number) => {
    if (sec <= curve[0][0]) return curve[0][1];
    for (let i = 1; i < curve.length; i++) {
      const [x1, y1] = curve[i];
      if (sec <= x1) { const [x0, y0] = curve[i - 1]; return x1 > x0 ? y0 + ((sec - x0) / (x1 - x0)) * (y1 - y0) : y1; }
    }
    return curve.at(-1)![1];
  };
}
/** Gap axis for a stretch of the run. The strip uses the same one so its curve lines up with the graph */
function gapRange(curve: [number, number][], gapAt: (s: number) => number, x0: number, x1: number, roomy: number) {
  const gs = curve.filter((p) => p[0] >= x0 && p[0] <= x1).map((p) => p[1]).concat([gapAt(x0), gapAt(x1), 0]);
  const lo = Math.min(...gs), hi = Math.max(...gs);
  const step = [10, 15, 20, 30, 60, 90, 120, 180, 300].find((v) => v >= (hi - lo) / 3) ?? 300;
  // Theirs go under the curve, so zoomed in there's more room below
  return { step, gTop: Math.ceil((hi + (hi - lo) * (0.28 + roomy) + 1) / step) * step, gBot: Math.floor((lo - (hi - lo) * (0.2 + roomy * 2) - 1) / step) * step };
}

// Rounds like clockSec so the same time reads the same here and in the table
const clock = (s: number) => { const a = Math.round(Math.abs(s)); return `${s < 0 && a ? "−" : ""}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`; };
const short = (s: number) => { const r = Math.round(s), a = Math.abs(r); return r === 0 ? "±0s" : `${r > 0 ? "+" : "−"}${a >= 60 ? `${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}` : `${a}s`}`; };
const sentence = (t: string) => t.charAt(0) + t.slice(1).toLowerCase();
const tone = (g: number | null) => (g === null || Math.abs(g) < 0.5 ? "var(--text-dim)" : g > 0 ? "var(--bad)" : "var(--good)");
const toneCls = (g: number) => (g > 0.5 ? "bad" : g < -0.5 ? "good" : "dim");
// Measured in the chart font so labels are sized to what's drawn (guessing per character let long ones run off)
let measureCtx: CanvasRenderingContext2D | null = null;
const textW = (t: string, size = 11) => {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) return t.length * 7 + 4;
  measureCtx.font = `${size}px ${getComputedStyle(document.documentElement).getPropertyValue("--font") || "monospace"}`;
  return measureCtx.measureText(t).width + 4;
};
/** Cut to fit a width, with an ellipsis. Empty if not even one letter fits */
const fitText = (t: string, w: number, size = 11) => {
  if (textW(t, size) <= w) return t;
  for (let n = t.length - 1; n > 0; n--) { const c = `${t.slice(0, n).trimEnd()}…`; if (textW(c, size) <= w) return c; }
  return "";
};
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** Analysis cost labels reworded the way runners say them */
export function callLabel(label: string, v: number): string {
  const l = label.replace(/ on the way$/, "");
  const rods = /^(\d+) rods?$/.exec(l);
  if (rods) return `Getting ${rods[1]} rods`;
  const named: Record<string, string> = {
    "First throw": "First trade", "After trading": "Leaving the bastion", Stronghold: "In the stronghold", Eyes: "Eye throws",
    Idle: "Standing still", "In a portal": "Portal waits", Death: "Dead", Distance: v > 0 ? "Longer route" : "Shorter route", "To blind": "Fortress to blind", Speed: v > 0 ? "Slower travel" : "Faster travel",
  };
  return named[l] ?? l;
}
const SHORT: Record<string, string> = { "Nether travel": "Nether", "Bastion to fortress": "To fortress", "Fortress to stronghold": "To stronghold", "Bastion to blind": "To blind", "After the bastion": "After bastion" };
const SPLIT_SHORT: Record<string, string> = { "Entered the Nether": "Nether", "Entered Bastion": "Bastion", "Left the Bastion": "Left bastion", "Entered Fortress": "Fortress", "6 Blaze Rods": "6 rods", "Blind Travelled": "Blind", "Eye Spy": "Eye Spy", "Entered the End": "End", "Defeated the Dragon": "Dragon" };
/** "2 beds", "1 bed, 1 TNT", "3 TNT" */
const blastsText = (bs: { what: "bed" | "tnt" }[]) => {
  const beds = bs.filter((b) => b.what === "bed").length, tnt = bs.length - beds;
  return [beds ? `${beds} bed${beds > 1 ? "s" : ""}` : "", tnt ? `${tnt} TNT` : ""].filter(Boolean).join(", ");
};
/** When room on the curve is short, the extras get placed after everything else (which goes in time order) */
const PLACE_FIRST: Record<string, number> = { pearls: 1, blast: 1, kit: 2, craft: 2, owcraft: 2 };
/** What you picked up from trades: these go in the trade line's label, the rest only in its detail */
const PICKED_LABEL: [string, string][] = [["ender_pearl", "pearls"], ["obsidian", "obsidian"], ["string", "string"]];
const PICKED_NAME: Record<string, string> = { ender_pearl: "pearls", obsidian: "obsidian", string: "string", crying_obsidian: "crying obsidian", fire_res: "fire res", fire_charge: "fire charges", glowstone_dust: "glowstone dust" };
/** Precraft items worth naming on the line */
const PRECRAFT_NAME: Record<string, string> = { respawn_anchor: "anchor", bow: "bow", iron_axe: "iron axe", iron_sword: "iron sword", golden_pickaxe: "gold pick", ender_eye: "eye" };
const PRECRAFT_SHORT: Record<string, string> = { bastion: "bastion precraft", fort: "fortress precraft", stronghold: "stronghold precraft" };
/** Setting that turns each kind of moment on or off */
const KIND_PREF: Record<string, keyof Prefs> = { owcraft: "mOwCraft", trade: "mTrade", kit: "mKit", pearls: "mPearls", blaze: "mBlaze", blast: "mBlast", craft: "mCraft",
  portal: "mPortal", eyes: "mEyes", zero: "mZero", perch: "mPerch", kill: "mKill", done: "mDone", dead: "mDead" };
const MOMENT_COLOR: Record<string, string> = { owcraft: "color-mix(in srgb, var(--accent) 60%, var(--text))", kit: "var(--warn)", craft: "var(--accent)", blast: "var(--bad)", pearls: "color-mix(in srgb, var(--them) 50%, var(--you))", perch: "var(--warn)", zero: "var(--warn)", kill: "var(--good)", done: "var(--text)", trade: "var(--warn)", dead: "var(--bad)", blaze: "color-mix(in srgb, var(--warn) 60%, var(--bad))", portal: "color-mix(in srgb, var(--accent) 55%, var(--them))", eyes: "var(--them)" };

type Layer = "splits" | "times" | "lead";
const LAYER_LABEL: Record<Layer, string> = { splits: "Splits", times: "Phase times", lead: "Lead" };

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, text?: string): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Marks along a moment's line, in seconds: counts written into the line (rods, the needed trade) and dots (blaze
 * kills, pearls) */
interface Moment { who: "you" | "them"; kind: string; label: string; a: number; b: number; own: number; detail: string; nums?: { t: number; n: number }[]; dots?: number[] }
type Box = { x0: number; x1: number; y0: number; y1: number };

export interface GapChart extends HTMLElement {
  /** Remove window listeners when the race page makes a new chart */
  dispose(): void;
  select(phase: string | null): void;
  /** Put the playhead at a race time in seconds, null clears it */
  setPlayhead(sec: number | null): void;
  /** Plot position in the SVG as last drawn, top/bottom and x/y scales */
  geom(): { top: number; bot: number; x(sec: number): number; y(gap: number): number; gap(sec: number): number } | null;
}

export function gapChart(a: RaceAnalysis, opts: { seedType?: string | null; selected?: string | null; onSelect?: (phase: string | null) => void } = {}): GapChart {
  const { curve, segments } = buildDeltaModel(a);
  const bands = phaseBands(a);
  const xMax = Math.max(curve.at(-1)?.[0] ?? 60, a.you.endTicks / 20, a.them.endTicks / 20, 60);
  const them = a.them.name;
  let selected = opts.selected ?? null, hovered: string | null = null, zoomed = false;
  let view = { x0: 0, x1: xMax };
  let playhead: number | null = null, lastGeom: ReturnType<GapChart["geom"]> = null;

  const gapAt = gapLookup(curve);
  // Both players on the race clock so same second = same moment
  const steps = (who: "you" | "them") => (a.report ?? []).flatMap((r) => r.steps?.[who] ?? []).map((s) => ({ ...s, s0: s.t0 / 20, s1: s.t1 / 20 }));
  const lanes = { you: steps("you"), them: steps("them") };
  const stepAt = (who: "you" | "them", sec: number) => lanes[who].find((s) => sec >= s.s0 && sec <= s.s1) ?? null;

  // Biggest single costs from the analysis, at when they happened
  const calls = (a.report ?? []).flatMap((p) => (p.why ?? []).filter((w) => w.at?.you != null && Math.abs(w.seconds) >= 5 && w.key !== "rest" && w.key !== "step:other")
    .map((w) => ({ t: w.at!.you! / 20, label: callLabel(w.label, w.seconds), v: w.seconds, sub: w.text.split(" · ")[0] })))
    .sort((x, y) => Math.abs(y.v) - Math.abs(x.v));

  // Moments for each player: trading, deaths, blazes, portals, eyes
  const moments = (who: "you" | "them"): Moment[] => {
    const L = (a.report ?? []).flatMap((r) => r.steps?.[who] ?? []);
    const out: Moment[] = [];
    const add = (kind: string, label: string, s0: number, s1: number, detail = "", extra: Pick<Moment, "nums" | "dots"> = {}) => out.push({ who, kind, label, a: s0, b: s1, own: s0, detail, ...extra });
    const st = a.stats?.[who];
    const split = (re: RegExp) => a.splits.find((sp) => re.test(sp.name))?.[who] ?? null;
    const merge = (xs: { a: number; b: number; n: number }[], gap: number) => {
      const m: typeof xs = [];
      for (const x of xs.sort((p, q) => p.a - q.a)) { const l = m.at(-1); if (l && x.a - l.b <= gap) { l.b = Math.max(l.b, x.b); l.n += x.n; } else m.push({ ...x }); }
      return m;
    };
    // The trade that covered what you used later is written into the line
    const need = st?.trades?.needed;
    // Each pickup from barter drops as an amount (the analysis keeps running totals per item)
    const pickups: { t: number; item: string; n: number }[] = [];
    const prevTotal: Record<string, number> = {};
    for (const p of st?.trades?.pickups ?? []) { pickups.push({ t: p.t / 20, item: p.item, n: p.total - (prevTotal[p.item] ?? 0) }); prevTotal[p.item] = p.total; }
    const tradeLines = merge(L.filter((s) => s.kind === "trade").map((s) => ({ a: s.t0 / 20, b: s.t1 / 20, n: Number(/^(\d+)/.exec(s.text)?.[1] ?? 0) })), 60);
    for (const [i, m] of tradeLines.entries()) {
      const here = need && need.t / 20 >= m.a && need.t / 20 <= m.b ? need : null;
      // What you picked up from trades: pearls, obsidian and string in the label, everything with times in the detail.
      // A pickup counts for the line that started before it (the last drops get picked up on the way out)
      const until = tradeLines[i + 1]?.a ?? Infinity;
      const picks = pickups.filter((p) => p.t >= (i ? m.a : -Infinity) && p.t < until);
      const got = new Map<string, { n: number; at: number[] }>();
      for (const p of picks) { const g = got.get(p.item) ?? { n: 0, at: [] }; g.n += p.n; g.at.push(p.t); got.set(p.item, g); }
      const short = PICKED_LABEL.filter(([k]) => got.get(k)?.n).map(([k, name]) => `${got.get(k)!.n} ${name}`).join(", ");
      const long = [...got].filter(([, g]) => g.n).map(([k, g]) => `${g.n} ${PICKED_NAME[k] ?? k} (${[...new Set(g.at.map((t) => clock(t)))].join(", ")})`).join(", ");
      add("trade", `${m.n ? `${m.n} trades in ${clock(m.b - m.a)}` : `trading for ${clock(m.b - m.a)}`}${short ? ` · got ${short}` : ""}`, m.a, m.b,
        [long ? `picked up ${long}` : "", here ? `trade ${here.n} covered what you used later, at ${clock(here.t / 20)}` : ""].filter(Boolean).join("; "),
        here ? { nums: [{ t: here.t / 20, n: here.n }] } : {});
    }
    // What you left the bastion with
    const kit = st?.trades?.leftWith, leftAt = split(/left the bastion/i);
    if (kit && leftAt !== null) {
      const parts = [["ender_pearl", "pearls"], ["obsidian", "obsidian"], ["string", "string"]].filter(([k]) => (kit[k as keyof typeof kit] ?? 0) > 0).map(([k, name]) => `${kit[k as keyof typeof kit]} ${name}`);
      // On the split, so it belongs to the phase after the bastion
      if (parts.length) add("kit", `left on ${parts.join(", ")}`, leftAt / 20, leftAt / 20);
    }
    for (const s of L.filter((x) => x.kind === "death")) add("dead", s.text === "Died" ? `dead for ${clock((s.t1 - s.t0) / 20)}` : `${s.text.toLowerCase()}, ${clock((s.t1 - s.t0) / 20)}`, s.t0 / 20, s.t1 / 20);
    // Rods = first blaze fight to 6 rods (the split) so both are measured the same. Marks each blaze killed and
    // numbers each rod where it dropped
    const blazes = L.filter((s) => s.kind === "fight" && /blaze/.test(s.text)).sort((p, q) => p.t0 - q.t0);
    if (blazes.length) {
      const six = split(/blaze rods/i);
      const from = blazes[0].t0 / 20, to = six !== null ? six / 20 : blazes.at(-1)!.t1 / 20;
      const got = (a.rods?.[who] ?? []).filter((r) => r.got / 20 >= from && r.got / 20 <= to).map((r) => r.dropped / 20);
      // Kills without a rod; the rod's count stands for the kill that dropped it (the closest one before the drop)
      const kills = (a.blazeKills?.[who] ?? []).map((t) => t / 20).filter((t) => t >= from && t <= to);
      for (const d of got) {
        const k = kills.reduce((best, t, i) => (t <= d + 0.5 && t >= d - 5 && (best < 0 || t > kills[best]) ? i : best), -1);
        if (k >= 0) kills.splice(k, 1);
      }
      // Analyses saved before rod times were kept only have the count per fight
      const rods = a.rods ? got.length : blazes.reduce((n, s) => n + Number(/(\d+) rod/.exec(s.detail ?? "")?.[1] ?? 0), 0);
      // Beds and TNT set off for the blaze bed go in the line's detail
      const blasts = (st?.blasts ?? []).filter((b) => b.t / 20 >= from && b.t / 20 <= to);
      const blastNote = blasts.length ? `blaze bed ${blastsText(blasts)} at ${clock(blasts[0].t / 20)}` : "";
      if (to > from) add("blaze", six !== null ? `6 rods in ${clock(to - from)}` : rods ? `${rods} rod${rods > 1 ? "s" : ""} in ${clock(to - from)}, never got 6` : `fought blazes for ${clock(to - from)}`,
        from, to, [got.length ? `rods at ${got.map(clock).join(", ")}` : "", blastNote].filter(Boolean).join(", "),
        { nums: got.map((t, i) => ({ t, n: i + 1 })), dots: kills });
    }
    // Blaze bed set off outside the rods line gets its own mark
    const lineSpan = out.find((m) => m.kind === "blaze");
    const loose = (st?.blasts ?? []).filter((b) => !lineSpan || b.t / 20 < lineSpan.a || b.t / 20 > lineSpan.b);
    if (loose.length) add("blast", `blaze bed: ${blastsText(loose)}`, loose[0].t / 20, loose[0].t / 20);
    // Pearls thrown on the way from the bastion to the fortress, a dot each
    const pearls = st?.pearlsToFort ?? [], left = split(/left the bastion/i), fort = split(/entered fortress/i);
    if (pearls.length && left !== null && fort !== null && fort > left)
      add("pearls", `${pearls.length} pearl${pearls.length > 1 ? "s" : ""} to the fortress`, left / 20, fort / 20, `thrown at ${pearls.map((t) => clock(t / 20)).join(", ")}`, { dots: pearls.map((t) => t / 20) });
    // Precrafts, with what they made
    for (const p of st?.precrafts ?? []) {
      const items = Object.entries(p.items).sort((x, y) => y[1] - x[1]).map(([it, n]) => `${n} ${it.replace(/_/g, " ")}`).join(", ");
      // The label names the end items, the rest (wool, glowstone, bricks) is in the detail
      const made = Object.entries(p.items).filter(([it]) => PRECRAFT_NAME[it] || /_bed$/.test(it))
        .map(([it, n]) => { const name = PRECRAFT_NAME[it] ?? "bed"; return n === 1 ? name : `${n} ${name}s`; });
      add("craft", `${PRECRAFT_SHORT[p.kind]} ${Math.round(p.secs)} s${made.length ? `: ${made.join(", ")}` : ""}`, p.t0 / 20, p.t1 / 20, items);
    }
    // Overworld crafting, screens under 20 s apart as one, named by what they made
    const groups: CraftScreen[][] = [];
    for (const c of st?.owCrafts ?? []) { const g = groups.at(-1); if (g && c.t0 - g.at(-1)!.t1 <= 400) g.push(c); else groups.push([c]); }
    for (const g of groups) {
      // In the order they were made, planks and sticks only if that's all there was
      const items = new Map<string, number>();
      for (const c of g) for (const [it, n] of Object.entries(c.items)) items.set(it, (items.get(it) ?? 0) + n);
      const real = [...items].filter(([it]) => !/_planks$|^stick$/.test(it)), shown = real.length ? real : [...items];
      const names = shown.map(([it, n]) => listItems({ [it]: n }, 1, false));
      const secs = g.reduce((n, c) => n + c.secs, 0), smelt = g.every((c) => c.smelt);
      add("owcraft", `${smelt ? "smelted" : "crafted"} ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3} more` : ""}, ${Math.round(secs)} s`, g[0].t0 / 20, g.at(-1)!.t1 / 20,
        g.map((c) => `${clock(c.t0 / 20)} ${listItems(c.items, 4, false)} (${Math.round(c.secs)} s)`).join(", "));
    }
    for (const s of L.filter((x) => x.kind === "portal")) add("portal", /blind/.test(s.text) ? "blind" : /stronghold/.test(s.text) ? "to stronghold" : /lava/.test(s.text) ? "built a lava portal" : "built a portal", s.t1 / 20, s.t1 / 20, s.detail);
    for (const s of L.filter((x) => x.kind === "eyes")) add("eyes", s.text.replace("Threw ", "threw "), s.t0 / 20, s.t0 / 20, s.detail);
    // Dragon fight: zero cycle or attempt, each perch, free the End, finish
    const f = a.end?.[who];
    if (f) {
      const zb = f.beds.slice(0, f.zeroBeds);
      if (zb.length) add("zero", `${f.zero ? "zero cycle" : "failed zero cycle"}, ${zb.length} bed${zb.length === 1 ? "" : "s"}`, zb[0] / 20, zb.at(-1)! / 20);
      f.perches.forEach((p, i) => add("perch", `perch ${i + 1}: ${p.beds ? `${p.beds} bed${p.beds === 1 ? "" : "s"}` : "no beds"}, ${p.killed ? "killed it" : `flew off at ${p.hp1} HP`}`, p.t0 / 20, p.t1 / 20));
      // Free the End and finish close together count as one
      const close = f.kill !== null && f.done !== null && f.done - f.kill < 60;
      if (f.kill !== null) add("kill", close ? `Free the End, finished ${clock(f.done! / 20)}` : "Free the End", f.kill / 20, f.kill / 20);
      if (f.done !== null && !close) add("done", `finished ${clock(f.done / 20)}`, f.done / 20, f.done / 20);
    }
    return out.sort((p, q) => p.a - q.a);
  };
  const MOM = { you: moments("you"), them: moments("them") };

  // ---- controls around the graph
  const status = h("div", { class: "gap-status" });
  // Layer toggles on their own line above the graph, how moments show is in settings
  const layerBox = h("div", { class: "gap-seg multi", role: "group", "aria-label": "Show" });
  const tools = h("div", { class: "gap-tools" }, h("div", { class: "gap-tool" }, h("span", { class: "lbl" }, "Show"), layerBox));
  const pills = h("div", { class: "gap-pills" });
  // Refit when the row or a pill resizes (pixel font loads late and widens the pills)
  const pillSizes = new ResizeObserver(() => fitPills());
  const svg = el("svg", { class: "gap-svg" });
  const tip = h("div", { class: "gap-tip", hidden: true });
  const list = h("div", { class: "gap-list", hidden: true });
  const costs = h("div", { class: "gap-costs" });
  const chrome = h("div", { class: "gap-chrome" }, status, pills, costs, tools);
  const wrap = h("div", { class: "gap-chart" }, chrome, h("div", { class: "gap-plot" }, svg, tip), list) as unknown as GapChart;

  const pick = (phase: string | null) => { const next = phase === selected && zoomed ? null : phase; wrap.select(next); opts.onSelect?.(next); };

  function drawSwitches() {
    const p = prefs();
    layerBox.replaceChildren(...(Object.keys(LAYER_LABEL) as Layer[]).map((k) => h("button", { class: p[k] ? "on" : "", "aria-pressed": String(p[k]),
      onclick: () => savePrefs({ [k]: !p[k] }) }, LAYER_LABEL[k])));
  }
  function drawPills() {
    const shortName = (s: (typeof segments)[number]) => ({ "To fort": "To fortress", "To bastion": "To bastion" })[sentence(s.segShort)] ?? sentence(s.segShort);
    // Adjacent segments with the same name are one phase (fortress through blind travel)
    const groups: { name: string; segs: typeof segments }[] = [];
    for (const s of segments) {
      const last = groups.at(-1);
      if (last && last.name === shortName(s)) last.segs.push(s); else groups.push({ name: shortName(s), segs: [s] });
    }
    pills.replaceChildren(...groups.map(({ name, segs }) => {
      const first = segs[0], last = segs.at(-1)!, delta = segs.reduce((n, s) => n + s.segDelta, 0);
      const phase = first.reportPhase ?? first.segLabel, on = segs.some((s) => (s.reportPhase ?? s.segLabel) === selected), icon = structIcon(phaseIconKey(name, opts.seedType));
      return h("button", { class: `gap-pill ${on ? "on" : ""} ${icon ? "" : "noicon"}`, title: `${name}: ${clock(first.you0)} to ${clock(last.you1)}`, onclick: () => pick(phase) },
        icon, h("span", { class: "txt" }, h("span", { class: "n" }, name), h("span", { class: `d ${toneCls(delta)}` }, short(delta))));
    }));
    pillSizes.disconnect();
    pillSizes.observe(pills);
    for (const p of pills.children) pillSizes.observe(p);
    fitPills();
  }
  // One line if they fit, else fewest rows split evenly (5+4 not 8+1), each row fills the width
  function fitPills() {
    pills.querySelectorAll(".gap-break").forEach((b) => b.remove());
    const W = pills.clientWidth, kids = [...pills.children] as HTMLElement[], n = kids.length;
    if (!W || !n) return;
    pills.classList.add("measure");
    // Layout widths. The shrinking header scales the chart and that shouldn't change the rows
    const w = kids.map((c) => c.offsetWidth + 3);
    pills.classList.remove("measure");
    // Where each row ends, bigger rows first. fits() and the breaks both use this so they agree
    const ends = (rows: number) => { const base = Math.floor(n / rows), extra = n % rows, out: number[] = []; for (let r = 0, i = 0; r < rows; r++) out.push(i += base + (r < extra ? 1 : 0)); return out; };
    const fits = (rows: number) => { let i = 0; for (const e of ends(rows)) { if (w.slice(i, e).reduce((a, b) => a + b, 0) > W) return false; i = e; } return true; };
    let rows = 1;
    while (rows < n && !fits(rows)) rows++;
    for (const e of ends(rows).slice(0, -1)) kids[e - 1].after(h("span", { class: "gap-break" }));
  }
  function drawStatus() {
    const b = zoomed ? bands.find((x) => x.phase === selected) : undefined;
    const kids: (HTMLElement | string)[] = [];
    // "0:31 behind", "0:08 ahead", "even"
    const gapText = (g: number) => (Math.abs(g) < 0.5 ? "even" : `${clock(Math.abs(g))} ${g > 0 ? "behind" : "ahead"}`);
    if (b) {
      kids.push(h("b", null, b.phase));
      if (b.you !== null && b.them !== null) kids.push(h("span", null, `${clock(b.you)} vs ${clock(b.them)}`));
      if (b.change !== null) kids.push(h("span", { class: toneCls(b.change) }, gapText(b.change)));
      kids.push(h("button", { class: "btn sm ghost", onclick: () => pick(null) }, "Whole run", h("span", { class: "kbd" }, "ESC")));
    } else {
      kids.push(h("b", null, a.you.finished ? `Finished ${clock(a.you.endTicks / 20)}` : "Didn't finish"), h("span", { class: toneCls(a.finalGap) }, gapText(a.finalGap)));
    }
    status.replaceChildren(...kids);
    status.title = b ? "" : "Hover a phase for detail, click to zoom";
  }

  let showAt = (_sec: number) => {}, hideCursor = () => {};

  function paint() {
    const W = Math.round(svg.getBoundingClientRect().width);
    // Not laid out yet, or too narrow to draw a plot in
    if (W < PAD_L + PAD_R + 40) return;
    const L = PAD_L, R = W - PAD_R;
    const { x0, x1 } = view;
    const layers = prefs(), mode = layers.moments, curveW = layers.curveWidth;
    const plotH = PLOT_H, top = layers.splits ? 26 : 8, bot = top + plotH;
    const railY = bot + 10, railH = mode === "rail" ? RAIL_H : 0, phY = railY + railH + 6, phH = layers.times ? 58 : 30, H = phY + phH + 22;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("height", String(H));
    svg.replaceChildren();
    const boxes: Box[] = [];
    const free = (b: Box) => b.x0 >= L - 2 && b.x1 <= R + 2 && b.y0 >= top - 2 && b.y1 <= bot + 2 && boxes.every((o) => b.x1 < o.x0 || b.x0 > o.x1 || b.y1 < o.y0 || b.y0 > o.y1);
    // Only show detail for the zoomed phase or the one under the cursor
    const focus = bands.find((b) => b.phase === (zoomed ? selected : hovered)) ?? null;
    // Everything shows in one phase only: a point where it is, a line where its middle is (a blaze hit just before
    // entering the fortress doesn't put the rods line in the phase before). A phase has its start but not its end
    const inFocus = (t0: number, t1: number, who: "you" | "them" = "you") => {
      if (!focus) return false;
      const [a0, b0] = who === "you" ? [focus.you0, focus.you1] : [focus.themFrom, focus.themTo];
      // The last phase keeps its end, that's where the run finished
      const last = b0 >= (who === "you" ? a.you.endTicks : a.them.endTicks) / 20 - 0.1;
      const t = (t0 + t1) / 2;
      return t >= a0 && (t < b0 || (last && t <= b0));
    };

    const X = (s: number) => L + ((s - x0) / (x1 - x0)) * (R - L);
    const roomy = zoomed && mode === "curve" ? 0.3 : 0; // When zoomed, leave room around the curve for callouts
    const { step, gTop, gBot } = gapRange(curve, gapAt, x0, x1, roomy);
    const Y = (g: number) => top + ((gTop - g) / (gTop - gBot)) * plotH;
    lastGeom = { top, bot, x: X, y: Y, gap: gapAt };
    const id = `gc${Math.random().toString(36).slice(2, 8)}`;
    const defs = el("defs", {});
    const clip = (name: string, y: number, hgt: number) => { const c = el("clipPath", { id: id + name }); c.appendChild(el("rect", { x: L, y, width: R - L, height: Math.max(0, hgt) })); defs.appendChild(c); };
    clip("all", 0, H); clip("up", 0, Y(0)); clip("dn", Y(0), H);
    svg.appendChild(defs);
    const g = el("g", { "clip-path": `url(#${id}all)` });
    svg.appendChild(g);

    // Phase bands
    bands.forEach((b, i) => {
      const fill = b.phase === selected ? "color-mix(in srgb, var(--accent) 10%, transparent)" : b.phase === hovered ? "rgba(255,255,255,.05)" : i % 2 ? "rgba(255,255,255,.02)" : "transparent";
      g.appendChild(el("rect", { x: X(b.you0), y: top, width: Math.max(0, X(b.you1) - X(b.you0)), height: phY + phH - top, fill, class: "keep" }));
      if (i) g.appendChild(el("line", { x1: X(b.you0), x2: X(b.you0), y1: top, y2: phY + phH, stroke: "var(--rule)", class: "keep" }));
    });
    // Grid
    for (let v = gBot; v <= gTop + 0.01; v += step) {
      svg.appendChild(el("line", { x1: L, x2: R, y1: Y(v), y2: Y(v), stroke: v === 0 ? "var(--line)" : "var(--rule)", "stroke-dasharray": v === 0 ? "" : "2 4", class: v === 0 ? "keep" : "" }));
      svg.appendChild(el("text", { x: L - 8, y: Y(v) + 4, "text-anchor": "end", class: "dimt" }, v === 0 ? "even" : short(v)));
    }
    // Splits
    if (layers.splits) {
      let lastX = -1e9;
      for (const s of a.splits) {
        if (s.you === null) continue;
        const t = s.you / 20;
        if (t < x0 || t > x1) continue;
        const x = X(t);
        g.appendChild(el("line", { x1: x, x2: x, y1: top - 10, y2: bot, stroke: "rgba(255,255,255,.14)", "stroke-dasharray": "1 3" }));
        const name = SPLIT_SHORT[s.name] ?? s.name, w = textW(name), cx = Math.max(L + w / 2, Math.min(R - w / 2, x));
        if (cx - w / 2 > lastX + 6) { g.appendChild(el("text", { x: cx, y: top - 14, "text-anchor": "middle", class: "dimt" }, name)); lastX = cx + w / 2; }
      }
    }
    // Gap curve, or shaded by who was gaining
    const line = curve.map(([s, v], i) => `${i ? "L" : "M"}${X(s).toFixed(1)} ${Y(v).toFixed(1)}`).join("");
    if (layers.lead) {
      for (let i = 1; i < curve.length; i++) {
        const [s0, v0] = curve[i - 1], [s1, v1] = curve[i];
        if (s1 < x0 || s0 > x1) continue;
        const c = v1 > v0 + 0.05 ? "var(--bad)" : v1 < v0 - 0.05 ? "var(--good)" : "var(--text-dim)";
        g.appendChild(el("path", { d: `M${X(s0)} ${Y(0)}L${X(s0)} ${Y(v0)}L${X(s1)} ${Y(v1)}L${X(s1)} ${Y(0)}Z`, fill: c, "fill-opacity": 0.2, class: "keep" }));
        g.appendChild(el("line", { x1: X(s0), y1: Y(v0), x2: X(s1), y2: Y(v1), stroke: c, "stroke-width": curveW, class: "keep" }));
      }
    } else {
      const area = `${line}L${X(curve.at(-1)![0])} ${Y(0)}L${X(curve[0][0])} ${Y(0)}Z`;
      for (const [part, c, o] of [["up", "var(--bad)", 0.15], ["dn", "var(--good)", 0.2]] as const) {
        const gg = el("g", { "clip-path": `url(#${id}${part})` });
        gg.appendChild(el("path", { d: area, fill: c, "fill-opacity": o, class: "keep" }));
        gg.appendChild(el("path", { d: line, fill: "none", stroke: c, "stroke-width": curveW, "stroke-linejoin": "round", class: "keep" }));
        g.appendChild(gg);
      }
    }
    // Biggest costs in one line under the pills, hover one to find it on the curve
    const shownCosts = calls.filter((c) => c.t >= x0 && c.t <= x1 && (!focus || inFocus(c.t, c.t))).slice(0, layers.costs);
    costs.replaceChildren(...(shownCosts.length ? [h("span", { class: "dim" }, focus ? `Biggest costs in ${focus.phase.toLowerCase()}:` : "Biggest costs:"),
      ...shownCosts.map((c, i) => h("button", { class: "cost", title: c.sub,
        onmouseenter: () => showAt(c.t), onmouseleave: () => hideCursor(),
        onclick: () => { const b = bands.find((q) => c.t >= q.you0 && c.t <= q.you1); if (b && !(zoomed && b.phase === selected)) pick(b.phase); } },
        `${c.label.toLowerCase()} `, h("span", { class: toneCls(c.v) }, fmtDelta(c.v)), i < shownCosts.length - 1 ? "," : ""))] : []));
    // What each player did
    for (let x = L; x <= R; x += 6) { const y = Y(gapAt(x0 + ((x - L) / (R - L)) * (x1 - x0))); boxes.push({ x0: x - 3, x1: x + 3, y0: y - 3, y1: y + 3 }); }
    const labelled: { m: Moment; box: Box; pc: string; ends: boolean }[] = [], called: { box: Box; text: string }[] = [];
    const tipText = (m: Moment) => `${m.who === "you" ? "You" : them}, ${m.b > m.a ? `${clock(m.a)} to ${clock(m.b)}` : `at ${clock(m.a)}`}: ${cap(m.label)}${m.detail ? `, ${m.detail}` : ""}`;
    // Picked in settings: which kinds and whose, then short ones skipped (deaths, crafts and the End always count)
    const picked = (m: Moment) => layers[KIND_PREF[m.kind]] !== false && (layers.momentsOf === "both" || layers.momentsOf === m.who);
    const worth = (m: Moment) => picked(m) && !(m.b - m.a > 0 && m.b - m.a < layers.minMoment && !["dead", "zero", "perch", "craft", "owcraft", "pearls"].includes(m.kind));
    if (mode === "curve") {
      // Dot at the start, line for the duration. Yours sits above the curve, theirs along the bottom
      // since the curve is your gap not their position
      // Moments get placed in time order, the extras after
      const rank = (m: Moment) => PLACE_FIRST[m.kind] ?? 0;
      const queue = (["you", "them"] as const).flatMap((who) => MOM[who].filter((m) => worth(m))).sort((p, q) => rank(p) - rank(q));
      for (const m of queue) {
        const who = m.who;
        if (m.b < x0 || m.a > x1 || !inFocus(m.a, m.b, who)) continue;
        const up = who === "you", pc = up ? "var(--you)" : "var(--them)";
        const xa = X(Math.max(m.a, x0)), xb = X(Math.min(m.b, x1)), span = xb - xa > 4;
        // Diff vs their matching moment (same kind, same index)
        const mine = MOM[who].filter((q) => q.kind === m.kind), other = MOM[up ? "them" : "you"].filter((q) => q.kind === m.kind)[mine.indexOf(m)];
        const diff = other && m.b > m.a && other.b > other.a && !up && !["perch", "zero", "craft", "owcraft"].includes(m.kind) ? Math.floor(m.b - m.a) - Math.floor(other.b - other.a) : 0; // Whole seconds to match the labels
        const label = fitText(`${up ? "You" : them}: ${m.label}${Math.abs(diff) >= 1 ? `, ${Math.round(Math.abs(diff))} s ${diff < 0 ? "quicker" : "slower"}` : ""}`, R - L - 8), w = textW(label);
        // Start/end times at each end of the line, only if they fit in the plot
        const tA = clock(m.a), tB = clock(m.b), ends = layers.lineTimes && span && (zoomed || xb - xa > 90) && xa - textW(tA) - 12 >= L && xb + textW(tB) + 12 <= R;
        const padA = ends ? textW(tA) + 8 : 0, padB = ends ? textW(tB) + 8 : 0;
        const ys = curve.filter((p) => p[0] >= m.a && p[0] <= m.b).map((p) => Y(p[1])).concat([Y(gapAt(m.a)), Y(gapAt(m.b))]);
        // Theirs sit between the curve and the phase labels, which can take a few rows to clear
        for (let k = 0; k < (up ? 5 : 8); k++) {
          const y = up ? Math.min(...ys) - 8 - k * 16 : bot - 6 - k * 16, ly = y - 5, lx = Math.max(L + 4, Math.min(xa - 3, R - w - 4));
          // Kept inside the plot, a line that starts or ends past the edge of the view is cut off there
          const box = { x0: Math.max(L - 2, Math.min(xa - padA, lx) - 4), x1: Math.min(R + 2, Math.max(xb + padB, lx + w) + 4), y0: ly - 11, y1: y + 4 };
          // Yours stays above the curve and theirs below, across the whole label width
          const cy: number[] = [];
          for (let x = Math.max(L, box.x0); x <= Math.min(R, box.x1); x += 4) cy.push(Y(gapAt(x0 + ((x - L) / (R - L)) * (x1 - x0))));
          if (!free(box) || (up ? box.y1 > Math.min(...cy) - 2 : box.y0 < Math.max(...cy) + 2)) continue;
          boxes.push(box);
          labelled.push({ m, box, pc, ends });
          // Counts written into the line (which breaks around them), dots for each blaze killed that dropped no rod or
          // pearl thrown. Counts that would touch merge into the later one. Marks slide apart to
          // not touch and stay clear of the start square and end tick (text is 11px, see textW)
          const half = (n: number) => String(n).length * 3.4 + 2;
          const nums: { x: number; n: number }[] = [];
          for (const { t, n } of m.nums ?? []) {
            if (t < x0 || t > x1) continue;
            const rx = X(t), last = nums.at(-1);
            if (last && rx - half(n) < last.x + half(last.n)) last.n = n; else nums.push({ x: rx, n });
          }
          // Too tight to fit: dots touch, then counts merge into the next one, and last of all the dots go
          const kx = (m.dots ?? []).filter((t) => t >= x0 && t <= x1).map(X);
          const lay = (dots: boolean, gap: number) => {
            const ms = [...(dots ? kx.map((x) => ({ x, r: gap ? 1.6 : 1.3, n: 0 })) : []), ...nums.map(({ x, n }) => ({ x, r: half(n), n }))].sort((p, q) => p.x - q.x || p.n - q.n);
            for (let k = 0, prev = xa + 3; k < ms.length; k++) { ms[k].x = Math.max(ms[k].x, prev + gap + ms[k].r); prev = ms[k].x + ms[k].r; }
            for (let k = ms.length - 1, next = xb - 1; k >= 0; k--) { ms[k].x = Math.min(ms[k].x, next - gap - ms[k].r); next = ms[k].x - ms[k].r; }
            return !ms.length || ms[0].x - ms[0].r >= xa + 3 - 0.01 ? ms : null;
          };
          let marks = lay(true, 1) ?? lay(true, 0);
          while (!marks && nums.length > 1) { nums.splice(0, 1); marks = lay(true, 0); }
          marks ??= lay(false, 1) ?? [];
          const gaps = marks.filter((q) => q.n).map((q) => [q.x - q.r, q.x + q.r]);
          if (span) {
            let d = "", from = xa;
            for (const [g0, g1] of gaps) { if (g0 > from) d += `M${from} ${y}H${g0}`; from = Math.max(from, g1); }
            if (xb > from) d += `M${from} ${y}H${xb}`;
            g.appendChild(el("path", { d: `${d}M${xb} ${y - 3}V${y + 3}`, fill: "none", stroke: pc, "stroke-width": 2 }));
          }
          for (const q of marks) g.appendChild(q.n ? el("text", { x: q.x, y: y + 4, "text-anchor": "middle", fill: pc }, String(q.n)) : el("circle", { cx: q.x, cy: y, r: q.r, fill: "var(--text)" }));
          g.appendChild(el("rect", { x: xa - 3, y: y - 3, width: 6, height: 6, fill: pc }));
          g.appendChild(el("text", { x: lx, y: ly, fill: pc }, label));
          if (ends) {
            g.appendChild(el("text", { x: xa - 6, y: y + 4, "text-anchor": "end", fill: pc, "fill-opacity": 0.65, "font-size": 11 }, tA));
            g.appendChild(el("text", { x: xb + 5, y: y + 4, fill: pc, "fill-opacity": 0.65, "font-size": 11 }, tB));
          }
          break;
        }
      }
      // Zoomed in, label what cost or saved time on the curve where it happened
      if (zoomed && focus) for (const c of calls.filter((q) => q.t >= x0 && q.t <= x1 && inFocus(q.t, q.t)).slice(0, layers.callouts)) {
        const xc = X(c.t), yc = Y(gapAt(c.t)), num = fmtDelta(c.v), name = `${fitText(c.label.toLowerCase(), R - L - textW(num) - 6)} `, w = textW(name + num);
        for (let k = 0; k < 8; k++) {
          const up = k % 2 === 0, d = 18 + Math.floor(k / 2) * 15, ly = up ? yc - d : yc + d + 10, lx = Math.max(L, Math.min(xc - w / 2, R - w));
          const box = { x0: lx - 2, x1: lx + w + 2, y0: ly - 11, y1: ly + 3 };
          if (!free(box)) continue;
          boxes.push(box);
          called.push({ box, text: c.sub });
          g.appendChild(el("line", { x1: xc, x2: xc, y1: yc, y2: up ? ly + 3 : ly - 11, stroke: "var(--text-dim)", "stroke-opacity": 0.6 }));
          g.appendChild(el("circle", { cx: xc, cy: yc, r: 2.5, fill: "var(--text)" }));
          const t = el("text", { x: lx, y: ly, class: "midt" }, name);
          const n = el("tspan", { fill: tone(c.v) }, num);
          t.appendChild(n);
          g.appendChild(t);
          break;
        }
      }
    } else if (mode === "rail") {
      (["you", "them"] as const).forEach((who, i) => {
        const base = railY + i * 38;
        svg.appendChild(el("text", { x: L - 8, y: base + 14, "text-anchor": "end", fill: who === "you" ? "var(--you)" : "var(--them)" }, who === "you" ? "You" : them.length > 7 ? `${them.slice(0, 6)}…` : them));
        const ends = [-1e9, -1e9];
        for (const m of MOM[who]) {
          if (m.b < x0 || m.a > x1 || !worth(m)) continue;
          const xa = X(m.a), xb = X(m.b), span = xb - xa > 3, row = ends[0] < xa - 8 ? 0 : ends[1] < xa - 8 ? 1 : -1;
          if (row < 0) continue;
          const y = base + 6 + row * 17;
          g.appendChild(span ? el("rect", { x: xa, y: y + 2, width: xb - xa, height: 3, fill: MOMENT_COLOR[m.kind] }) : el("rect", { x: xa - 3, y, width: 6, height: 6, fill: MOMENT_COLOR[m.kind] }));
          for (const { t } of m.nums ?? []) if (t >= x0 && t <= x1) g.appendChild(el("rect", { x: X(t) - 0.75, y: y - 1, width: 1.5, height: 9, fill: MOMENT_COLOR[m.kind] }));
          const lbl = fitText(cap(m.label), R - xa - (span ? 0 : 6));
          if (!lbl) continue;
          const t = el("text", { x: xa + (span ? 0 : 6), y: y + 15, class: "midt" }, lbl);
          t.appendChild(el("title", {}, tipText(m)));
          g.appendChild(t);
          ends[row] = Math.max(xb, xa + textW(lbl) + (span ? 0 : 6));
        }
      });
    }
    // Phase labels with both players' times
    const maxDur = Math.max(...bands.map((b) => Math.max(b.you ?? 0, b.them ?? 0)), 1);
    for (const b of layers.phaseNames ? bands : []) {
      const xa = Math.max(X(b.you0), L), xb = Math.min(X(b.you1), R), w = xb - xa;
      if (w < 30) continue;
      // Icons only if the name still fits after them, name then short name then cut, all inside the band
      const keys = phaseIconKeys(b.phase, opts.seedType), cx = xa + 6, room = xb - cx - 4, iconW = 4 + 18 * keys.length;
      const delta = b.change !== null ? fmtDelta(b.change) : null;
      const pickName = (r: number) => (textW(b.phase) <= r ? b.phase : fitText(SHORT[b.phase] ?? b.phase, r));
      const withIcon = w > 60 && keys.length > 0 && textW(SHORT[b.phase] ?? b.phase) <= room - iconW, tx = cx + (withIcon ? iconW : 0);
      const name = w > 60 ? pickName(xb - tx - 4) : "";
      if (withIcon) keys.forEach((k, i) => { const ic = structIcon(k); if (ic) { const fo = el("foreignObject", { x: cx + 18 * i, y: phY + 2, width: 16, height: 16 }); fo.appendChild(ic); g.appendChild(fo); } });
      if (name) g.appendChild(el("text", { x: tx, y: phY + 14, fill: "var(--text)" }, name));
      if (delta && textW(delta) <= (name ? xb - tx - 4 : room)) g.appendChild(el("text", { x: name ? tx : cx, y: phY + (name ? 27 : 14), fill: tone(b.change) }, delta));
      if (layers.times && b.you !== null && w > 70) {
        const bw = Math.min(w - 60, 220), tw = textW("00:00", 10);
        ([["you", b.you], ["them", b.them]] as const).forEach(([who, d], i) => {
          if (d === null) return;
          const y = phY + 34 + i * 10;
          g.appendChild(el("rect", { x: cx, y, width: Math.max(2, (d / maxDur) * bw), height: 6, fill: who === "you" ? "var(--you)" : "var(--them)", "fill-opacity": 0.75 }));
          if (cx + (d / maxDur) * bw + 6 + tw <= xb) g.appendChild(el("text", { x: cx + (d / maxDur) * bw + 6, y: y + 6, class: "dimt small" }, clock(d)));
        });
      }
    }
    // Time axis
    const every = [30, 60, 120, 180, 300].find((v) => v >= (x1 - x0) / Math.max(4, Math.floor((R - L) / 100))) ?? 300;
    for (let t = Math.ceil(x0 / every) * every; t <= x1; t += every) { const hw = textW(clock(t)) / 2; svg.appendChild(el("text", { x: Math.max(hw, Math.min(W - hw, X(t))), y: H - 6, "text-anchor": "middle", class: "dimt" }, clock(t))); }
    // Playhead at the split you're reading
    if (playhead !== null && playhead >= x0 && playhead <= x1) {
      const px = X(playhead), pg = gapAt(playhead), py = Y(pg), lbl = `${clock(playhead)} ${Math.abs(pg) < 0.5 ? "even" : fmtDelta(pg)}`, lw = textW(lbl), right = px + 12 + lw < R;
      // Top of the plot unless that covers a label, then the bottom
      const lx0 = right ? px + 8 : px - 8 - lw, ly = [top + 11, bot - 4].find((y) => free({ x0: lx0, x1: lx0 + lw, y0: y - 11, y1: y + 3 })) ?? top + 11;
      svg.append(el("line", { x1: px, x2: px, y1: top, y2: bot, stroke: "var(--text)", "stroke-opacity": 0.55, "stroke-dasharray": "2 3", "pointer-events": "none" }),
        el("rect", { x: px - 4, y: py - 4, width: 8, height: 8, fill: "var(--text)", "pointer-events": "none" }),
        el("text", { x: right ? px + 8 : px - 8, y: ly, "text-anchor": right ? "start" : "end", fill: "var(--text)", "pointer-events": "none" }, lbl));
    }

    // Moments list goes under the graph
    list.hidden = mode !== "list";
    if (mode === "list") {
      const all = [...MOM.you, ...MOM.them].filter((m) => picked(m) && m.b >= x0 && m.a <= x1).sort((p, q) => p.a - q.a);
      list.replaceChildren(h("div", { class: "h" }, h("span", null, "When"), h("span", { class: "you" }, "You"), h("span", { class: "them" }, them)),
        ...all.map((m) => {
          const cell = [h("i", { style: `background:${MOMENT_COLOR[m.kind]}` }), cap(m.label), h("small", null, `${clock(m.own)}${m.detail ? `, ${m.detail}` : ""}`)];
          return h("div", { class: "m", onmouseenter: () => showAt(m.a), onmouseleave: () => hideCursor(),
            onclick: () => { const b = bands.find((q) => m.a >= q.you0 && m.a <= q.you1); if (b && !(zoomed && b.phase === selected)) pick(b.phase); } },
            h("span", { class: "dim" }, clock(m.a)), h("span", null, m.who === "you" ? cell : null), h("span", null, m.who === "them" ? cell : null));
        }));
    }

    // Hover and click
    const guide = el("line", { y1: top, y2: bot, stroke: "var(--text-dim)", "stroke-dasharray": "2 3", visibility: "hidden", "pointer-events": "none" });
    const dot = el("rect", { width: 7, height: 7, fill: "var(--text)", visibility: "hidden", "pointer-events": "none" });
    const hit = el("rect", { x: L, y: top, width: R - L, height: railY + railH - top, fill: "transparent", class: "gap-hit" });
    const span = el("g", { "pointer-events": "none" });
    svg.insertBefore(span, g.nextSibling);
    svg.append(guide, dot, hit);
    const showSpan = (hit: { m: Moment; pc: string; ends: boolean } | undefined) => {
      span.replaceChildren();
      if (!hit || hit.m.b <= hit.m.a) return;
      const xa = X(Math.max(hit.m.a, x0)), xb = X(Math.min(hit.m.b, x1));
      span.append(el("rect", { x: xa, y: top, width: Math.max(1, xb - xa), height: bot - top, fill: hit.pc, "fill-opacity": 0.12 }),
        el("line", { x1: xa, x2: xa, y1: top, y2: bot, stroke: hit.pc, "stroke-opacity": 0.6 }), el("line", { x1: xb, x2: xb, y1: top, y2: bot, stroke: hit.pc, "stroke-opacity": 0.6 }));
      if (hit.ends) return;
      const ta = clock(hit.m.a), tb = clock(hit.m.b), wa = textW(ta), wb = textW(tb);
      if (free({ x0: xa - 4 - wa, x1: xa - 4, y0: bot - 15, y1: bot - 1 })) span.append(el("text", { x: xa - 4, y: bot - 4, "text-anchor": "end", fill: hit.pc }, ta));
      if (free({ x0: xb + 4, x1: xb + 4 + wb, y0: bot - 15, y1: bot - 1 })) span.append(el("text", { x: xb + 4, y: bot - 4, fill: hit.pc }, tb));
    };
    showAt = (sec) => { const x = X(sec); guide.setAttribute("x1", String(x)); guide.setAttribute("x2", String(x)); guide.setAttribute("visibility", "visible"); dot.setAttribute("x", String(x - 3.5)); dot.setAttribute("y", String(Y(gapAt(sec)) - 3.5)); dot.setAttribute("visibility", "visible"); };
    hideCursor = () => { showSpan(undefined); guide.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); tip.hidden = true; };
    const secAt = (ev: MouseEvent) => { const r = svg.getBoundingClientRect(); return x0 + ((ev.clientX - r.left - L) / (R - L)) * (x1 - x0); };
    hit.addEventListener("mousemove", (ev) => {
      const sec = secAt(ev), gp = gapAt(sec);
      const r0 = svg.getBoundingClientRect(), px = ev.clientX - r0.left, py = ev.clientY - r0.top;
      const over = labelled.find((q) => px >= q.box.x0 && px <= q.box.x1 && py >= q.box.y0 - 2 && py <= q.box.y1 + 2);
      showSpan(over);
      const call = over ? undefined : called.find((q) => px >= q.box.x0 && px <= q.box.x1 && py >= q.box.y0 - 2 && py <= q.box.y1 + 2);
      if (call) { tip.replaceChildren(h("div", null, call.text)); tip.hidden = false; tip.style.left = `${Math.min(px + 14, r0.width - 260)}px`; tip.style.top = `${Math.max(0, call.box.y0 - 34)}px`; return; }
      if (over) { tip.replaceChildren(h("div", { class: over.m.who }, tipText(over.m))); tip.hidden = false; tip.style.left = `${Math.min(px + 14, r0.width - 260)}px`; tip.style.top = `${Math.max(0, over.box.y0 - 34)}px`; guide.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); return; }
      const b = bands.find((q) => sec >= q.you0 && sec <= q.you1);
      if (!zoomed && b && b.phase !== hovered) { hovered = b.phase; paint(); }
      showAt(sec);
      // Small tooltip pinned to the top next to the cursor line
      const step = (who: "you" | "them") => { const st = stepAt(who, sec); return st ? h("div", { class: who }, st.text) : ""; };
      const reached = sec <= (curve.at(-1)?.[0] ?? 0) && Math.abs(gp) >= 0.5;
      tip.replaceChildren(
        h("div", { class: "tip-top" }, h("b", null, clock(sec)), h("span", { class: toneCls(gp) }, Math.abs(gp) < 0.5 ? "even" : `${fmtDelta(gp)} ${gp > 0 ? "behind" : "ahead"}`)),
        reached ? h("div", { class: "dim" }, `${them} here at ${clock(Math.max(0, sec - gp))}`) : "",
        step("you"), step("them"));
      tip.hidden = false;
      const r = svg.getBoundingClientRect(), left = ev.clientX - r.left, tw = tip.offsetWidth || 200;
      tip.style.left = `${left + 12 + tw > r.width ? left - 12 - tw : left + 12}px`;
      tip.style.top = `${top}px`;
    });
    hit.addEventListener("mouseleave", () => { hideCursor(); if (hovered) { hovered = null; paint(); } });
    hit.addEventListener("click", (ev) => { const sec = secAt(ev); const b = bands.find((q) => sec >= q.you0 && sec <= q.you1); if (b) pick(b.phase); });
  }

  // Animate between views instead of jumping
  let anim = 0;
  function animateTo(target: typeof view) {
    const from = { ...view }, t0 = performance.now();
    cancelAnimationFrame(anim);
    const frame = (now: number) => {
      const k = Math.min(1, (now - t0) / 240), e = 1 - (1 - k) ** 3;
      view = { x0: from.x0 + (target.x0 - from.x0) * e, x1: from.x1 + (target.x1 - from.x1) * e };
      paint();
      if (k < 1) anim = requestAnimationFrame(frame);
    };
    anim = requestAnimationFrame(frame);
  }
  const phaseView = (phase: string | null) => {
    const b = bands.find((x) => x.phase === phase);
    if (!b) return { x0: 0, x1: xMax };
    // Both players in this phase, each on their own clock: their splits and all their steps in it
    const lo = Math.min(b.you0, b.them0, b.themFrom), hi = Math.max(b.you1, b.them1, b.themTo), pad = (hi - lo) * 0.06 + 2;
    return { x0: Math.max(0, lo - pad), x1: Math.min(xMax, hi + pad) };
  };

  wrap.geom = () => lastGeom;
  wrap.setPlayhead = (sec) => { if (sec === playhead) return; playhead = sec; paint(); };
  wrap.select = (phase) => {
    selected = phase; zoomed = phase !== null; hovered = null;
    drawPills(); drawStatus();
    if (still() || !prefs().zoomAnim) { view = phaseView(phase); paint(); } else animateTo(phaseView(phase));
  };
  // The chart is reused when you come back to the race so these stay until dispose(), not until detach
  const life = new AbortController();
  wrap.dispose = () => life.abort();
  addEventListener("keydown", (e) => {
    if (!wrap.isConnected) return;
    if (e.key === "Escape" && zoomed && !(e.target as HTMLElement).closest("input, select, textarea")) { e.preventDefault(); pick(null); }
  }, { signal: life.signal });
  drawSwitches(); drawPills(); drawStatus();
  new ResizeObserver(() => paint()).observe(svg);
  void document.fonts?.ready.then(() => { if (!life.signal.aborted) paint(); });
  addEventListener("stratas-theme", () => paint(), { signal: life.signal });
  addEventListener("stratas-prefs", () => { drawSwitches(); paint(); }, { signal: life.signal });
  return wrap;
}


// ---- the strip, whole run in a band at the top while reading the splits
// Drawn at its own size so text stays crisp. Click to jump the table there
export const STRIP_H = 82;
const S_RAIL = 16, S_TOP = 24, S_BOT = 66;

export interface GapStrip extends HTMLElement {
  dispose(): void;
  /** Playhead at a second (null hides it) */
  at(sec: number | null, note?: string): void;
  /** Phase open in the table */
  mark(phase: string | null): void;
  /** Stretch the curve layer (not text) by this much, from the curve top */
  fold(scale: number): void;
  /** Curve position inside the strip */
  plotTop: number; plotH: number;
}

export function gapStrip(a: RaceAnalysis, opts: { seedType?: string | null; selected?: string | null; onPick?: (sec: number) => void } = {}): GapStrip {
  const { curve } = buildDeltaModel(a);
  const bands = phaseBands(a);
  const gapAt = gapLookup(curve);
  const xMax = Math.max(curve.at(-1)?.[0] ?? 60, a.you.endTicks / 20, a.them.endTicks / 20, 60);
  const { gTop, gBot } = gapRange(curve, gapAt, 0, xMax, 0);
  const deaths = (a.report ?? []).flatMap((r) => r.steps?.you ?? []).filter((s) => s.kind === "death").map((s) => ({ a: s.t0 / 20, b: s.t1 / 20 }));
  const svg = el("svg", { class: "strip-svg", height: STRIP_H });
  const wrap = h("div", { class: "gap-strip" }, svg) as unknown as GapStrip;
  wrap.plotTop = S_TOP; wrap.plotH = S_BOT - S_TOP;
  let W = 0, X = (s: number) => s, current: string | null = null, marked = opts.selected ?? null, hover = false;
  let sec: number | null = null, note = "";
  const Y = (g: number) => S_TOP + ((gTop - g) / (gTop - gBot)) * (S_BOT - S_TOP);
  // Moving parts, drawn once then only attributes change
  const ph = el("g", { class: "strip-ph" });
  const phLine = el("line", { y1: S_RAIL + 2, y2: S_BOT + 2 }), phDot = el("rect", { width: 7, height: 7, rx: 1, class: "dot" });
  const phBg = el("rect", { height: 15, rx: 3, y: S_RAIL + 3, class: "bg" }), phText = el("text", { y: S_RAIL + 14 });
  ph.append(phLine, phBg, phText, phDot);
  const bandEls: { b: PhaseBand; rect: SVGRectElement; label: SVGGElement }[] = [];
  // Curve + backdrop stretch while the graph folds into the strip, text doesn't
  const fold = el("g", { class: "strip-fold" });
  let foldBy = 1;
  const setFold = () => fold.setAttribute("transform", foldBy === 1 ? "" : `translate(0 ${S_TOP}) scale(1 ${foldBy.toFixed(4)}) translate(0 ${-S_TOP})`);

  function draw() {
    W = Math.round(svg.getBoundingClientRect().width);
    if (W < PAD_L + PAD_R + 40) { W = 0; return; }
    const L = PAD_L, R = W - PAD_R;
    X = (s: number) => L + (s / xMax) * (R - L);
    svg.setAttribute("viewBox", `0 0 ${W} ${STRIP_H}`);
    svg.replaceChildren();
    fold.replaceChildren();
    bandEls.length = 0;
    const id = `gs${Math.random().toString(36).slice(2, 8)}`;
    const defs = el("defs", {});
    for (const [name, y, hgt] of [["up", 0, Y(0)], ["dn", Y(0), STRIP_H]] as const) {
      const c = el("clipPath", { id: id + name });
      c.appendChild(el("rect", { x: L, y, width: R - L, height: Math.max(0, hgt) }));
      defs.appendChild(c);
    }
    for (const [name, c] of [["gu", "var(--bad)"], ["gd", "var(--good)"]] as const) {
      const up = name === "gu", gr = el("linearGradient", { id: id + name, x1: 0, x2: 0, y1: 0, y2: 1 });
      gr.append(el("stop", { offset: 0, "stop-color": c, "stop-opacity": up ? 0.32 : 0.04 }), el("stop", { offset: 1, "stop-color": c, "stop-opacity": up ? 0.04 : 0.36 }));
      defs.appendChild(gr);
    }
    svg.append(defs, fold);

    // Phases as tinted bands, current one lit, icon/name/gain on the rail
    bands.forEach((b, i) => {
      const xa = X(b.you0), xb = X(b.you1), w = xb - xa;
      const rect = el("rect", { x: xa, y: 0, width: Math.max(0, w), height: S_BOT + 2, class: `strip-band ${i % 2 ? "odd" : ""}` });
      fold.appendChild(rect);
      if (i) fold.appendChild(el("line", { x1: xa, x2: xa, y1: 2, y2: S_BOT + 2, class: "strip-sep" }));
      const label = el("g", { class: "strip-lbl" });
      const key = phaseIconKey(b.phase, opts.seedType), icon = key && w > 22 ? structIcon(key, 12) : null;
      let x = xa + 5;
      if (icon) { const fo = el("foreignObject", { x, y: 1, width: 12, height: 12 }); fo.appendChild(icon); label.appendChild(fo); x += 16; }
      const delta = b.change !== null && Math.abs(b.change) >= 0.5 ? short(b.change) : "";
      const room = xb - x - 4, full = b.phase, brief = SHORT[b.phase] ?? b.phase;
      const name = textW(full) + (delta ? textW(delta) : 0) <= room ? full : textW(brief) + (delta ? textW(delta) : 0) <= room ? brief : textW(brief) <= room ? brief : "";
      const t = el("text", { x, y: 11, class: "strip-name" }, name);
      if (delta && textW(name) + textW(delta) <= room) t.appendChild(el("tspan", { fill: tone(b.change), dx: name ? 6 : 0 }, delta));
      label.appendChild(t);
      label.appendChild(el("title", {}, `${b.phase}: ${b.you !== null ? clock(b.you) : "?"} for you, ${b.them !== null ? clock(b.them) : "?"} for ${a.them.name}${b.change !== null ? `, ${fmtDelta(b.change)}` : ""}`));
      svg.appendChild(label);
      bandEls.push({ b, rect, label });
    });
    // Gap axis, even plus top and bottom of the scale
    fold.appendChild(el("line", { x1: L, x2: R, y1: Y(0), y2: Y(0), class: "strip-zero" }));
    svg.appendChild(el("text", { x: L - 8, y: Y(0) + 4, "text-anchor": "end", class: "strip-axis" }, "even"));
    if (Y(gTop) < Y(0) - 12) svg.appendChild(el("text", { x: L - 8, y: S_TOP + 8, "text-anchor": "end", class: "strip-axis" }, short(gTop)));
    if (Y(gBot) > Y(0) + 12) svg.appendChild(el("text", { x: L - 8, y: S_BOT, "text-anchor": "end", class: "strip-axis" }, short(gBot)));
    // Split ticks
    for (const s of a.splits) if (s.you !== null) fold.appendChild(el("line", { x1: X(s.you / 20), x2: X(s.you / 20), y1: S_TOP - 3, y2: S_BOT, class: "strip-split" }));
    const line = curve.map(([s, v], i) => `${i ? "L" : "M"}${X(s).toFixed(1)} ${Y(v).toFixed(1)}`).join("");
    const area = `${line}L${X(curve.at(-1)![0])} ${Y(0)}L${X(curve[0][0])} ${Y(0)}Z`;
    for (const [part, c, gr] of [["up", "var(--bad)", "gu"], ["dn", "var(--good)", "gd"]] as const) {
      const gg = el("g", { "clip-path": `url(#${id}${part})` });
      gg.append(el("path", { d: area, fill: `url(#${id}${gr})` }), el("path", { d: line, fill: "none", stroke: c, "stroke-width": 1.75, "stroke-linejoin": "round" }));
      fold.appendChild(gg);
    }
    // Your deaths along the bottom
    for (const d of deaths) fold.appendChild(el("rect", { x: X(d.a), y: S_BOT - 2, width: Math.max(3, X(d.b) - X(d.a)), height: 3, rx: 1, fill: "var(--bad)" }));
    // Final gap, plus max behind/ahead if that's not the end
    const endX = X(curve.at(-1)![0]), endT = `${short(a.finalGap)}`;
    svg.appendChild(el("text", { x: Math.min(endX + 6, R - textW(endT) + 4), y: Math.max(S_TOP + 9, Math.min(S_BOT - 2, Y(a.finalGap) + 4)), fill: tone(a.finalGap), class: "strip-end" }, endT));
    const peaks = [curve.reduce((m, p) => (p[1] > m[1] ? p : m), curve[0]), curve.reduce((m, p) => (p[1] < m[1] ? p : m), curve[0])];
    for (const [t, v] of peaks) {
      if (Math.abs(v) < 5 || Math.abs(v - a.finalGap) < 1 || endX - X(t) < 70) continue;
      // Next to the dot, on the side away from zero
      const x = X(t), y = Y(v), txt = short(v), right = x + 6 + textW(txt) < R;
      svg.append(el("circle", { cx: x, cy: y, r: 2.5, fill: tone(v) }),
        el("text", { x: right ? x + 6 : x - 6, y: Math.max(S_TOP + 4, Math.min(S_BOT - 1, y + (v > 0 ? -3 : 10))), "text-anchor": right ? "start" : "end", class: "strip-peak", fill: tone(v) }, txt));
    }
    // Time axis
    const every = [60, 120, 180, 300, 600].find((v) => v >= xMax / Math.max(3, Math.floor((R - L) / 90))) ?? 600;
    for (let t = every; t < xMax - every / 3; t += every) svg.appendChild(el("text", { x: X(t), y: STRIP_H - 3, "text-anchor": "middle", class: "strip-axis" }, clock(t)));
    svg.appendChild(el("text", { x: L, y: STRIP_H - 3, "text-anchor": "middle", class: "strip-axis" }, "0:00"));
    svg.appendChild(ph);
    // Hover reads out a moment, click jumps the table there
    const hit = el("rect", { x: L, y: 0, width: R - L, height: STRIP_H, fill: "transparent", class: "strip-hit" });
    const secOf = (ev: MouseEvent) => Math.max(0, Math.min(xMax, ((ev.clientX - svg.getBoundingClientRect().left - L) / (R - L)) * xMax));
    hit.addEventListener("mousemove", (ev) => { hover = true; const t = secOf(ev), b = bands.find((q) => t >= q.you0 && t <= q.you1); paintPh(t, `${b ? b.phase : ""}${t <= (curve.at(-1)?.[0] ?? 0) && Math.abs(gapAt(t)) >= 0.5 ? ` · ${a.them.name} at ${clock(Math.max(0, t - gapAt(t)))}` : ""}`); });
    hit.addEventListener("mouseleave", () => { hover = false; paintPh(sec, note); });
    hit.addEventListener("click", (ev) => opts.onPick?.(secOf(ev)));
    svg.appendChild(hit);
    setFold();
    paintBands();
    paintPh(sec, note);
  }
  function paintBands() {
    for (const { b, rect, label } of bandEls) {
      rect.classList.toggle("on", b.phase === current);
      rect.classList.toggle("open", b.phase === marked);
      label.classList.toggle("on", b.phase === current);
    }
  }
  function paintPh(t: number | null, what: string) {
    ph.style.display = t === null || !W ? "none" : "";
    if (t === null || !W) return;
    const x = X(t), g = gapAt(t);
    const cur = bands.find((q) => t >= q.you0 && t <= q.you1)?.phase ?? null;
    if (cur !== current) { current = cur; paintBands(); }
    phLine.setAttribute("x1", x.toFixed(1)); phLine.setAttribute("x2", x.toFixed(1));
    phDot.setAttribute("x", (x - 3.5).toFixed(1)); phDot.setAttribute("y", (Y(g) - 3.5).toFixed(1));
    phDot.setAttribute("fill", tone(g) === "var(--text-dim)" ? "var(--text)" : tone(g));
    const txt = `${clock(t)}  ${Math.abs(g) < 0.5 ? "even" : fmtDelta(g)}${what ? `  ${what}` : ""}`, w = textW(txt) + 6;
    const right = x + 8 + w < W - 4, tx = right ? x + 8 : x - 8 - w;
    phText.textContent = "";
    phText.append(el("tspan", { class: "t" }, clock(t)), el("tspan", { dx: 7, fill: tone(g) === "var(--text-dim)" ? "var(--text-mid)" : tone(g) }, Math.abs(g) < 0.5 ? "even" : fmtDelta(g)), what ? el("tspan", { dx: 7, class: "w" }, what) : "");
    phText.setAttribute("x", (tx + 5).toFixed(1));
    phBg.setAttribute("x", tx.toFixed(1)); phBg.setAttribute("width", w.toFixed(1));
  }
  wrap.at = (t, what = "") => { sec = t; note = what; if (!hover) paintPh(t, what); };
  wrap.fold = (by) => { if (Math.abs(by - foldBy) < 0.0005) return; foldBy = by; setFold(); };
  wrap.mark = (phase) => { marked = phase; paintBands(); };
  new ResizeObserver(() => draw()).observe(svg);
  const life = new AbortController();
  wrap.dispose = () => life.abort();
  addEventListener("stratas-theme", () => draw(), { signal: life.signal });
  return wrap;
}
