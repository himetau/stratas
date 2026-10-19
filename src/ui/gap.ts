// Race graph, gap to the opponent over your run time. Hover a phase for details, click to zoom (Esc to zoom out)
// Layers and moment display mode are saved
import { buildDeltaModel } from "../core/detect/segments";
import type { RaceAnalysis } from "./bridge";
import { fmtDelta, h } from "./dom";
import { phaseIconKey, phaseIconKeys, structIcon } from "./ranked";

const NS = "http://www.w3.org/2000/svg";
const PAD_L = 64, PAD_R = 14, PLOT_H = 210, RAIL_H = 74;

/** Phase span on your clock (you0..you1) and on theirs (them0..them1) */
export interface PhaseBand { phase: string; you0: number; you1: number; them0: number; them1: number; change: number | null; you: number | null; them: number | null }

/** Your span in each report phase, in play order */
export function phaseBands(a: RaceAnalysis): PhaseBand[] {
  const out: PhaseBand[] = [];
  for (const s of buildDeltaModel(a).segments) {
    const name = s.reportPhase ?? s.segLabel;
    const last = out.at(-1);
    if (last && last.phase === name) { last.you1 = s.you1; last.them1 = Math.max(last.them1, s.them1); }
    else {
      const p = a.report?.find((r) => r.phase === name);
      const st = p?.steps?.them ?? [];
      out.push({ phase: name, you0: s.you0, you1: s.you1, them0: st.length ? Math.min(...st.map((x) => x.t0)) / 20 : s.them0, them1: st.length ? Math.max(s.them1, ...st.map((x) => x.t1 / 20)) : s.them1,
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
  return { step, gTop: Math.ceil((hi + (hi - lo) * (0.28 + roomy) + 1) / step) * step, gBot: Math.floor((lo - (hi - lo) * (0.2 + roomy) - 1) / step) * step };
}

// Rounds like clockSec so the same time reads the same here and in the table
const clock = (s: number) => { const a = Math.round(Math.abs(s)); return `${s < 0 && a ? "−" : ""}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`; };
const short = (s: number) => { const r = Math.round(s), a = Math.abs(r); return r === 0 ? "±0s" : `${r > 0 ? "+" : "−"}${a >= 60 ? `${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}` : `${a}s`}`; };
const sentence = (t: string) => t.charAt(0) + t.slice(1).toLowerCase();
const tone = (g: number | null) => (g === null || Math.abs(g) < 0.5 ? "var(--text-dim)" : g > 0 ? "var(--bad)" : "var(--good)");
const toneCls = (g: number) => (g > 0.5 ? "bad" : g < -0.5 ? "good" : "dim");
const textW = (t: string) => t.length * 6.8 + 4;
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** Analysis cost labels reworded the way runners say them */
export function callLabel(label: string, v: number): string {
  const l = label.replace(/ on the way$/, "");
  const rods = /^(\d+) rods?$/.exec(l);
  if (rods) return `Getting ${rods[1]} rods`;
  const named: Record<string, string> = {
    "First throw": "First trade", "After trading": "Leaving the bastion", Stronghold: "In the stronghold", Eyes: "Eye throws",
    Idle: "Standing still", "In a portal": "Portal waits", Death: "Dead", Distance: v > 0 ? "Longer route" : "Shorter route", Speed: v > 0 ? "Slower travel" : "Faster travel",
  };
  return named[l] ?? l;
}
const SHORT: Record<string, string> = { "Nether travel": "Nether", "Bastion to fortress": "To fortress", "Fortress to stronghold": "To stronghold", "Bastion to blind": "To blind", "After the bastion": "After bastion" };
const SPLIT_SHORT: Record<string, string> = { "Entered the Nether": "Nether", "Entered Bastion": "Bastion", "Left the Bastion": "Left bastion", "Entered Fortress": "Fortress", "6 Blaze Rods": "6 rods", "Blind Travelled": "Blind", "Eye Spy": "Eye Spy", "Entered the End": "End", "Defeated the Dragon": "Dragon" };
const MOMENT_COLOR: Record<string, string> = { perch: "var(--warn)", zero: "var(--warn)", kill: "var(--good)", done: "var(--text)", trade: "var(--warn)", dead: "var(--bad)", blaze: "color-mix(in srgb, var(--warn) 60%, var(--bad))", portal: "color-mix(in srgb, var(--accent) 55%, var(--them))", eyes: "var(--them)" };

type Layers = { splits: boolean; times: boolean; lead: boolean };
type Mode = "curve" | "rail" | "list" | "off";
const LAYER_LABEL: Record<keyof Layers, string> = { splits: "Splits", times: "Phase times", lead: "Lead" };
const MODES: [Mode, string][] = [["curve", "On the curve"], ["rail", "Labels"], ["list", "List"], ["off", "Off"]];
const load = <T>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? { ...d, ...JSON.parse(v) } : d; } catch { return d; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* Fine */ } };
let layers: Layers = load("gap.layers", { splits: true, times: true, lead: false });
let mode: Mode = load<{ m: Mode }>("gap.mode", { m: "curve" }).m;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, text?: string): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

interface Moment { who: "you" | "them"; kind: string; label: string; a: number; b: number; own: number; detail: string }
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
    const add = (kind: string, label: string, s0: number, s1: number, detail = "") => out.push({ who, kind, label, a: s0, b: s1, own: s0, detail });
    const merge = (xs: { a: number; b: number; n: number }[], gap: number) => {
      const m: typeof xs = [];
      for (const x of xs.sort((p, q) => p.a - q.a)) { const l = m.at(-1); if (l && x.a - l.b <= gap) { l.b = Math.max(l.b, x.b); l.n += x.n; } else m.push({ ...x }); }
      return m;
    };
    for (const m of merge(L.filter((s) => s.kind === "trade").map((s) => ({ a: s.t0 / 20, b: s.t1 / 20, n: Number(/^(\d+)/.exec(s.text)?.[1] ?? 0) })), 60))
      add("trade", m.n ? `${m.n} trades in ${clock(m.b - m.a)}` : `trading for ${clock(m.b - m.a)}`, m.a, m.b);
    for (const s of L.filter((x) => x.kind === "death")) add("dead", s.text === "Died" ? `dead for ${clock((s.t1 - s.t0) / 20)}` : `${s.text.toLowerCase()}, ${clock((s.t1 - s.t0) / 20)}`, s.t0 / 20, s.t1 / 20);
    // Rods = first blaze fight to 6 rods (the split) so both are measured the same
    const blazes = L.filter((s) => s.kind === "fight" && /blaze/.test(s.text)).sort((p, q) => p.t0 - q.t0);
    if (blazes.length) {
      const six = a.splits.find((sp) => /blaze rods/i.test(sp.name))?.[who] ?? null;
      const from = blazes[0].t0 / 20, to = six !== null ? six / 20 : blazes.at(-1)!.t1 / 20;
      const rods = blazes.reduce((n, s) => n + Number(/(\d+) rod/.exec(s.detail ?? "")?.[1] ?? 0), 0);
      if (to > from) add("blaze", six !== null ? `6 rods in ${clock(to - from)}` : rods ? `${rods} rod${rods > 1 ? "s" : ""} in ${clock(to - from)}, never got 6` : `fought blazes for ${clock(to - from)}`, from, to);
    }
    for (const s of L.filter((x) => x.kind === "portal")) add("portal", /lava/.test(s.text) ? "built a lava portal" : "built a portal", s.t1 / 20, s.t1 / 20, s.detail);
    for (const s of L.filter((x) => x.kind === "eyes")) add("eyes", s.text.replace("Threw ", "threw "), s.t0 / 20, s.t0 / 20, s.detail);
    // Dragon fight: zero cycle or attempt, each perch, free the End, finish
    const f = a.end?.[who];
    if (f) {
      const zb = f.beds.slice(0, f.zeroBeds);
      if (zb.length) add("zero", `${f.zero ? "zero cycle" : "failed zero cycle"}, ${zb.length} bed${zb.length === 1 ? "" : "s"}`, zb[0] / 20, zb.at(-1)! / 20);
      f.perches.forEach((p, i) => add("perch", `perch ${i + 1}: ${p.beds ? `${p.beds} bed${p.beds === 1 ? "" : "s"}` : "no beds"}, ${p.killed ? "killed it" : `flew off at ${p.hp1} HP`}`, p.t0 / 20, p.t1 / 20));
      // Free the End and finish close together count as one
      const close = f.kill !== null && f.done !== null && f.done - f.kill < 60;
      if (f.kill !== null) add("kill", close ? `Free the End, completed ${clock(f.done! / 20)}` : "Free the End", f.kill / 20, f.kill / 20);
      if (f.done !== null && !close) add("done", `completed ${clock(f.done / 20)}`, f.done / 20, f.done / 20);
    }
    return out.sort((p, q) => p.a - q.a);
  };
  const MOM = { you: moments("you"), them: moments("them") };

  // ---- controls around the graph
  const status = h("div", { class: "gap-status" });
  // View controls on their own line above the graph, stackable layers then the moment display mode
  const layerBox = h("div", { class: "gap-seg multi", role: "group", "aria-label": "Show" });
  const modeBox = h("div", { class: "gap-seg", role: "radiogroup", "aria-label": "What you did" });
  const tools = h("div", { class: "gap-tools" }, h("div", { class: "gap-tool" }, h("span", { class: "lbl" }, "Show"), layerBox), h("div", { class: "gap-tool" }, h("span", { class: "lbl" }, "What you did"), modeBox));
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
    layerBox.replaceChildren(...(Object.keys(LAYER_LABEL) as (keyof Layers)[]).map((k) => h("button", { class: layers[k] ? "on" : "", "aria-pressed": String(layers[k]),
      onclick: () => { layers = { ...layers, [k]: !layers[k] }; save("gap.layers", layers); drawSwitches(); paint(); } }, LAYER_LABEL[k])));
    modeBox.replaceChildren(...MODES.map(([m, label]) => h("button", { class: mode === m ? "on" : "", role: "radio", "aria-checked": String(mode === m),
      onclick: () => { mode = m; save("gap.mode", { m }); drawSwitches(); paint(); } }, label)));
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
    if (b) {
      kids.push(h("b", null, b.phase));
      if (b.you !== null && b.them !== null) kids.push(h("span", { class: "dim" }, `${clock(b.you)} for you, ${clock(b.them)} for ${them}`));
      if (b.change !== null) kids.push(h("span", { class: toneCls(b.change) }, fmtDelta(b.change)));
      kids.push(h("button", { class: "btn sm ghost", onclick: () => pick(null) }, "Whole run", h("span", { class: "kbd" }, "ESC")));
    } else {
      const end = a.you.finished ? `finished ${clock(a.you.endTicks / 20)}` : "didn't finish";
      kids.push(h("b", null, "Whole run"), h("span", { class: toneCls(a.finalGap) }, Math.abs(a.finalGap) < 0.5 ? "even" : `${fmtDelta(a.finalGap)} ${a.finalGap > 0 ? "behind" : "ahead"}`),
        h("span", { class: "dim" }, `${end}. Hover a phase for detail, click to zoom.`));
    }
    status.replaceChildren(...kids);
  }

  let showAt = (_sec: number) => {}, hideCursor = () => {};

  function paint() {
    const W = Math.round(svg.getBoundingClientRect().width);
    if (!W) return;
    const L = PAD_L, R = W - PAD_R;
    const { x0, x1 } = view;
    const plotH = PLOT_H, top = layers.splits ? 26 : 8, bot = top + plotH;
    const railY = bot + 10, railH = mode === "rail" ? RAIL_H : 0, phY = railY + railH + 6, phH = layers.times ? 58 : 30, H = phY + phH + 22;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("height", String(H));
    svg.replaceChildren();
    const boxes: Box[] = [];
    const free = (b: Box) => b.x0 >= L - 2 && b.x1 <= R + 2 && b.y0 >= top - 2 && b.y1 <= bot + 2 && boxes.every((o) => b.x1 < o.x0 || b.x0 > o.x1 || b.y1 < o.y0 || b.y0 > o.y1);
    // Only show detail for the zoomed phase or the one under the cursor
    const focus = bands.find((b) => b.phase === (zoomed ? selected : hovered)) ?? null;
    const inFocus = (t0: number, t1: number, who: "you" | "them" = "you") => !!focus && (who === "you" ? t1 >= focus.you0 && t0 <= focus.you1 : t1 >= focus.them0 && t0 <= focus.them1);

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
        if (x - lastX > 64) { g.appendChild(el("text", { x, y: top - 14, "text-anchor": "middle", class: "dimt" }, SPLIT_SHORT[s.name] ?? s.name)); lastX = x; }
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
        g.appendChild(el("line", { x1: X(s0), y1: Y(v0), x2: X(s1), y2: Y(v1), stroke: c, "stroke-width": 2, class: "keep" }));
      }
    } else {
      const area = `${line}L${X(curve.at(-1)![0])} ${Y(0)}L${X(curve[0][0])} ${Y(0)}Z`;
      for (const [part, c, o] of [["up", "var(--bad)", 0.15], ["dn", "var(--good)", 0.2]] as const) {
        const gg = el("g", { "clip-path": `url(#${id}${part})` });
        gg.appendChild(el("path", { d: area, fill: c, "fill-opacity": o, class: "keep" }));
        gg.appendChild(el("path", { d: line, fill: "none", stroke: c, "stroke-width": 2, "stroke-linejoin": "round", class: "keep" }));
        g.appendChild(gg);
      }
    }
    // Biggest costs in one line under the pills, hover one to find it on the curve
    const shownCosts = calls.filter((c) => c.t >= x0 && c.t <= x1 && (!focus || inFocus(c.t, c.t))).slice(0, 3);
    costs.replaceChildren(...(shownCosts.length ? [h("span", { class: "dim" }, focus ? `Biggest costs in ${focus.phase.toLowerCase()}:` : "Biggest costs:"),
      ...shownCosts.map((c, i) => h("button", { class: "cost", title: c.sub,
        onmouseenter: () => showAt(c.t), onmouseleave: () => hideCursor(),
        onclick: () => { const b = bands.find((q) => c.t >= q.you0 && c.t <= q.you1); if (b && !(zoomed && b.phase === selected)) pick(b.phase); } },
        `${c.label.toLowerCase()} `, h("span", { class: toneCls(c.v) }, fmtDelta(c.v)), i < shownCosts.length - 1 ? "," : ""))] : []));
    // What each player did
    for (let x = L; x <= R; x += 6) { const y = Y(gapAt(x0 + ((x - L) / (R - L)) * (x1 - x0))); boxes.push({ x0: x - 3, x1: x + 3, y0: y - 3, y1: y + 3 }); }
    const labelled: { m: Moment; box: Box; pc: string }[] = [], called: { box: Box; text: string }[] = [];
    const tipText = (m: Moment) => `${m.who === "you" ? "You" : them}, ${m.b > m.a ? `${clock(m.a)} to ${clock(m.b)}` : `at ${clock(m.a)}`}: ${cap(m.label)}${m.detail ? `, ${m.detail}` : ""}`;
    const worth = (m: Moment) => !(m.b - m.a > 0 && m.b - m.a < 15 && !["dead", "zero", "perch"].includes(m.kind));
    if (mode === "curve") {
      // Dot at the start, line for the duration. Yours sits above the curve, theirs along the bottom
      // since the curve is your gap not their position
      const queue = (["you", "them"] as const).flatMap((who) => MOM[who].filter((m) => worth(m)));
      for (const m of queue) {
        const who = m.who;
        if (m.b < x0 || m.a > x1 || !inFocus(m.a, m.b, who)) continue;
        const up = who === "you", pc = up ? "var(--you)" : "var(--them)";
        const xa = X(Math.max(m.a, x0)), xb = X(Math.min(m.b, x1)), span = xb - xa > 4;
        // Diff vs their matching moment (same kind, same index)
        const mine = MOM[who].filter((q) => q.kind === m.kind), other = MOM[up ? "them" : "you"].filter((q) => q.kind === m.kind)[mine.indexOf(m)];
        const diff = other && m.b > m.a && other.b > other.a && !up && !["perch", "zero"].includes(m.kind) ? Math.floor(m.b - m.a) - Math.floor(other.b - other.a) : 0; // Whole seconds to match the labels
        const label = `${up ? "You" : them}: ${m.label}${Math.abs(diff) >= 1 ? `, ${Math.round(Math.abs(diff))} s ${diff < 0 ? "quicker" : "slower"}` : ""}`, w = textW(label);
        // Start/end times at each end of the line, only if they fit in the plot
        const tA = clock(m.a), tB = clock(m.b), ends = span && (zoomed || xb - xa > 90) && xa - textW(tA) - 12 >= L && xb + textW(tB) + 12 <= R;
        const padA = ends ? textW(tA) + 8 : 0, padB = ends ? textW(tB) + 8 : 0;
        const ys = curve.filter((p) => p[0] >= m.a && p[0] <= m.b).map((p) => Y(p[1])).concat([Y(gapAt(m.a)), Y(gapAt(m.b))]);
        for (let k = 0; k < 5; k++) {
          const y = up ? Math.min(...ys) - 8 - k * 16 : bot - 6 - k * 16, ly = y - 5, lx = Math.max(L + 4, Math.min(xa - 3, R - w - 4));
          const box = { x0: Math.min(xa - padA, lx) - 4, x1: Math.max(xb + padB, lx + w) + 4, y0: ly - 11, y1: y + 4 };
          // Yours stays above the curve and theirs below, across the whole label width
          const cy: number[] = [];
          for (let x = Math.max(L, box.x0); x <= Math.min(R, box.x1); x += 4) cy.push(Y(gapAt(x0 + ((x - L) / (R - L)) * (x1 - x0))));
          if (!free(box) || (up ? box.y1 > Math.min(...cy) - 2 : box.y0 < Math.max(...cy) + 2)) continue;
          boxes.push(box);
          labelled.push({ m, box, pc });
          if (span) g.appendChild(el("path", { d: `M${xa} ${y}H${xb}M${xb} ${y - 3}V${y + 3}`, fill: "none", stroke: pc, "stroke-width": 2 }));
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
      if (zoomed && focus) for (const c of calls.filter((q) => q.t >= x0 && q.t <= x1 && inFocus(q.t, q.t)).slice(0, 8)) {
        const xc = X(c.t), yc = Y(gapAt(c.t)), num = fmtDelta(c.v), name = `${c.label.toLowerCase()} `, w = textW(name + num);
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
          const t = el("text", { x: xa + (span ? 0 : 6), y: y + 15, class: "midt" }, cap(m.label));
          t.appendChild(el("title", {}, tipText(m)));
          g.appendChild(t);
          ends[row] = Math.max(xb, xa + textW(cap(m.label)) + (span ? 0 : 6));
        }
      });
    }
    // Phase labels with both players' times
    const maxDur = Math.max(...bands.map((b) => Math.max(b.you ?? 0, b.them ?? 0)), 1);
    for (const b of bands) {
      const xa = Math.max(X(b.you0), L), xb = Math.min(X(b.you1), R), w = xb - xa;
      if (w < 30) continue;
      const keys = phaseIconKeys(b.phase, opts.seedType), cx = xa + 6, withIcon = keys.length > 0 && w > 60 + 18 * (keys.length - 1), tx = cx + (withIcon ? 4 + 18 * keys.length : 0);
      if (withIcon) keys.forEach((k, i) => { const ic = structIcon(k); if (ic) { const fo = el("foreignObject", { x: cx + 18 * i, y: phY + 2, width: 16, height: 16 }); fo.appendChild(ic); g.appendChild(fo); } });
      if (w > 60) g.appendChild(el("text", { x: tx, y: phY + 14, fill: "var(--text)" }, w > b.phase.length * 7 + 40 ? b.phase : SHORT[b.phase] ?? b.phase));
      if (b.change !== null && w > 40) g.appendChild(el("text", { x: w > 60 ? tx : cx, y: phY + (w > 60 ? 27 : 14), fill: tone(b.change) }, fmtDelta(b.change)));
      if (layers.times && b.you !== null && w > 70) {
        const bw = Math.min(w - 60, 220);
        ([["you", b.you], ["them", b.them]] as const).forEach(([who, d], i) => {
          if (d === null) return;
          const y = phY + 34 + i * 10;
          g.appendChild(el("rect", { x: cx, y, width: Math.max(2, (d / maxDur) * bw), height: 6, fill: who === "you" ? "var(--you)" : "var(--them)", "fill-opacity": 0.75 }));
          g.appendChild(el("text", { x: cx + (d / maxDur) * bw + 6, y: y + 6, class: "dimt small" }, clock(d)));
        });
      }
    }
    // Time axis
    const every = [30, 60, 120, 180, 300].find((v) => v >= (x1 - x0) / Math.max(4, Math.floor((R - L) / 100))) ?? 300;
    for (let t = Math.ceil(x0 / every) * every; t <= x1; t += every) svg.appendChild(el("text", { x: X(t), y: H - 6, "text-anchor": "middle", class: "dimt" }, clock(t)));
    // Playhead at the split you're reading
    if (playhead !== null && playhead >= x0 && playhead <= x1) {
      const px = X(playhead), pg = gapAt(playhead), py = Y(pg), lbl = `${clock(playhead)} ${Math.abs(pg) < 0.5 ? "even" : fmtDelta(pg)}`, right = px + 12 + textW(lbl) < R;
      svg.append(el("line", { x1: px, x2: px, y1: top, y2: bot, stroke: "var(--text)", "stroke-opacity": 0.55, "stroke-dasharray": "2 3", "pointer-events": "none" }),
        el("rect", { x: px - 4, y: py - 4, width: 8, height: 8, fill: "var(--text)", "pointer-events": "none" }),
        el("text", { x: right ? px + 8 : px - 8, y: top + 11, "text-anchor": right ? "start" : "end", fill: "var(--text)", "pointer-events": "none" }, lbl));
    }

    // Moments list goes under the graph
    list.hidden = mode !== "list";
    if (mode === "list") {
      const all = [...MOM.you, ...MOM.them].filter((m) => m.b >= x0 && m.a <= x1).sort((p, q) => p.a - q.a);
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
    const showSpan = (hit: { m: Moment; pc: string } | undefined) => {
      span.replaceChildren();
      if (!hit || hit.m.b <= hit.m.a) return;
      const xa = X(Math.max(hit.m.a, x0)), xb = X(Math.min(hit.m.b, x1));
      span.append(el("rect", { x: xa, y: top, width: Math.max(1, xb - xa), height: bot - top, fill: hit.pc, "fill-opacity": 0.12 }),
        el("line", { x1: xa, x2: xa, y1: top, y2: bot, stroke: hit.pc, "stroke-opacity": 0.6 }), el("line", { x1: xb, x2: xb, y1: top, y2: bot, stroke: hit.pc, "stroke-opacity": 0.6 }),
        el("text", { x: xa - 4, y: bot - 4, "text-anchor": "end", fill: hit.pc }, clock(hit.m.a)), el("text", { x: xb + 4, y: bot - 4, fill: hit.pc }, clock(hit.m.b)));
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
    // Both players in this phase, each on their own clock
    const lo = Math.min(b.you0, b.them0), hi = Math.max(b.you1, b.them1), pad = (hi - lo) * 0.06 + 2;
    return { x0: Math.max(0, lo - pad), x1: Math.min(xMax, hi + pad) };
  };

  wrap.geom = () => lastGeom;
  wrap.setPlayhead = (sec) => { if (sec === playhead) return; playhead = sec; paint(); };
  wrap.select = (phase) => {
    selected = phase; zoomed = phase !== null; hovered = null;
    drawPills(); drawStatus();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { view = phaseView(phase); paint(); } else animateTo(phaseView(phase));
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
  addEventListener("stratas-theme", () => paint(), { signal: life.signal });
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
    if (!W) return;
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
