// One race: players, gap graph, splits grouped by phase
// Opening a phase shows what each player did in it side by side
import { g, type RaceAnalysis, type RaceRow } from "../bridge";
import { buildDeltaModel } from "../../core/detect/segments";
import { kitText, TRADE_ITEMS, TRADE_NAME, type CraftScreen } from "../../core/detect/stats";
import { itemName, listItems } from "../../core/detect/steps";
import { clockSec, deltaClass, fmtClock, fmtDelta, fmtDur, h } from "../dom";
import { callLabel, gapChart, gapStrip, STRIP_H } from "../gap";
import { bindKey, copyField, head, openInMinecraft, panel, rank } from "../parts";
import { phaseIconKeys, structIcon } from "../ranked";
import { playByPlay } from "./report";
import { celebrate, prefs, still } from "../prefs";
import { noteRaceOpened } from "../support";
import type { Prefs } from "../../core/prefs";
import { day, seedText } from "./races";

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const cache = new Map<number, { row: RaceRow; analysis: RaceAnalysis | null }>();
export async function loadRace(id: number) {
  const hit = cache.get(id);
  if (hit) return hit;
  const r = await g.race(id);
  if (r) cache.set(id, r); else gone.add(id);
  return r;
}
// Races that came back empty, so the page says so instead of asking again forever
const gone = new Set<number>();
const cheered = new Set<number>();
/** The race if it's already loaded, without waiting */
export const cachedRace = (id: number) => cache.get(id) ?? null;
export function forgetRace(id?: number) { if (id === undefined) cache.clear(); else cache.delete(id); }

type Report = NonNullable<RaceAnalysis["report"]>[number];
let open: { race: number; phase: string | null } | null = null;
// The ⋯ menu closes on any outside click
document.addEventListener("click", (e) => { for (const d of document.querySelectorAll<HTMLDetailsElement>("details.menu[open]")) if (!d.contains(e.target as Node)) d.open = false; });
let keptChart: { a: RaceAnalysis; chart: ReturnType<typeof gapChart>; strip: ReturnType<typeof gapStrip>; pick: (p: string | null) => void; jump: (sec: number) => void; ro?: ResizeObserver } | null = null;

const changeCls = (s: number | null) => (s === null || Math.abs(s) < 0.5 ? "dim" : deltaClass(s));
const signed = (s: number | null) => (s === null ? "" : fmtDelta(s));

function runLine(p: RaceAnalysis["you"]) {
  const t = fmtClock(p.endTicks);
  return p.finished ? `Finished in ${t}` : p.quit ? `Left at ${t}` : `Didn't finish, stopped at ${t}`;
}

/** "137 vs 53 blocks" -> you, them, unit. null if it's not a comparison */
function versus(part: string): { you: string; them: string; what: string } | null {
  const m = /^(\d[\d:.,]*(?: s| blocks)?) vs (\d[\d:.,]*(?: s| blocks)?)(?: (.+))?$/.exec(part.trim());
  if (!m) return null;
  // If either side is over a minute, write both as m:ss ("1:16 vs 0 s")
  const unit = / (s|blocks)$/.exec(m[2])?.[0] ?? / (s|blocks)$/.exec(m[1])?.[0] ?? "";
  const bare = (x: string) => x.replace(/ (s|blocks)$/, "");
  if (unit === " s" && (m[1].includes(":") || m[2].includes(":"))) {
    const mmss = (x: string) => (x.includes(":") ? bare(x) : clockSec(Number(bare(x))));
    return { you: mmss(m[1]), them: mmss(m[2]), what: m[3] ?? "" };
  }
  return { you: bare(m[1]) + unit, them: bare(m[2]) + unit, what: m[3] ?? "" };
}

function watch(at: { you?: number; them?: number } | undefined, theirName: string) {
  if (!at) return "";
  return [at.you != null ? `you ${fmtClock(at.you)}` : null, at.them != null ? `${theirName} ${fmtClock(at.them)}` : null].filter(Boolean).join(", ");
}

/** Bastion trades side by side: what each of you picked up and left on the ground, what you left with and used, and
 * which trade covered what you used */
function tradesTable(a: RaceAnalysis, theirName: string) {
  const y = a.stats?.you.trades, t = a.stats?.them.trades;
  if (!y && !t) return null;
  const n = (v: number | undefined) => (v ? String(v) : "");
  const rows = TRADE_ITEMS.filter((k) => [y?.got, y?.left, t?.got, t?.left].some((d) => (d?.[k] ?? 0) > 0)).map((k) =>
    h("tr", null, h("td", null, cap(TRADE_NAME[k])), h("td", null, n(y?.got[k])), h("td", { class: "dim" }, n(y?.left[k])), h("td", null, n(t?.got[k])), h("td", { class: "dim" }, n(t?.left[k]))));
  const need = (s: typeof y) => (!s ? "—" : s.noneNeeded ? "none" : s.needed ? `${s.needed.n} of ${s.n} (${fmtClock(s.needed.t)})` : `? of ${s.n}`);
  const both = (label: string, f: (s: NonNullable<typeof y>) => string, first = false) => h("tr", { class: first ? "sum first" : "sum" }, h("td", null, label), h("td", { colspan: 2 }, y ? f(y) : "—"), h("td", { colspan: 2 }, t ? f(t) : "—"));
  return h("table", { class: "plain trades-t" },
    h("tr", null, h("th", null, "Trades"), h("th", { class: "you" }, "You got"), h("th", null, "Left"), h("th", { class: "them" }, `${theirName} got`), h("th", null, "Left")),
    rows,
    both("Trades", (s) => String(s.n), true),
    both("Left on", (s) => kitText(s.leftWith)),
    both("Used after", (s) => kitText(s.used)),
    h("tr", { class: "sum" }, h("td", null, "Needed"), h("td", { colspan: 2 }, need(y)), h("td", { colspan: 2 }, need(t))));
}

/** Overworld crafting side by side: each thing made with how many and when, then screens, time in them and the slowest */
function craftsTable(a: RaceAnalysis, theirName: string) {
  const y = a.stats?.you.owCrafts, t = a.stats?.them.owCrafts;
  if (!y?.length && !t?.length) return null;
  // First time each item was made, and how many in all
  const byItem = (xs: CraftScreen[] | undefined) => {
    const m = new Map<string, { n: number; t: number }>();
    for (const x of xs ?? []) for (const [it, n] of Object.entries(x.items)) { const c = m.get(it); if (c) c.n += n; else m.set(it, { n, t: x.t0 }); }
    return m;
  };
  const my = byItem(y), mt = byItem(t);
  const items = [...new Set([...my.keys(), ...mt.keys()])].sort((p, q) => Math.min(my.get(p)?.t ?? Infinity, mt.get(p)?.t ?? Infinity) - Math.min(my.get(q)?.t ?? Infinity, mt.get(q)?.t ?? Infinity));
  const cell = (c: { n: number; t: number } | undefined) => (c ? [h("td", null, c.n > 1 ? String(c.n) : "✓"), h("td", { class: "dim" }, fmtClock(c.t))] : [h("td", { class: "dim" }, "—"), h("td")]);
  const smelt = (xs: CraftScreen[] | undefined) => new Set((xs ?? []).filter((x) => x.smelt).flatMap((x) => Object.keys(x.items)));
  const smelted = new Set([...smelt(y), ...smelt(t)]);
  const slow = (xs: CraftScreen[] | undefined) => {
    const s = (xs ?? []).reduce<CraftScreen | null>((m, x) => (!m || x.secs > m.secs ? x : m), null);
    return s ? `${fmtDur(s.secs)} at ${fmtClock(s.t0)}, ${listItems(s.items, 3, false)}` : "—";
  };
  const both = (label: string, f: (xs: CraftScreen[] | undefined) => string, first = false) =>
    h("tr", { class: first ? "sum first" : "sum" }, h("td", null, label), h("td", { colspan: 2 }, f(y)), h("td", { colspan: 2 }, f(t)));
  return h("table", { class: "plain trades-t crafts-t" },
    h("tr", null, h("th", null, "Crafted"), h("th", { class: "you" }, "You"), h("th", null, "at"), h("th", { class: "them" }, theirName), h("th", null, "at")),
    items.map((it) => h("tr", null, h("td", null, cap(itemName(it)) + (smelted.has(it) ? " (smelted)" : "")), ...cell(my.get(it)), ...cell(mt.get(it)))),
    both("Screens", (xs) => String(xs?.length ?? 0), true),
    both("Slowest", slow));
}

/** Which settings switch a phase note falls under, from how it starts */
function noteKind(text: string): keyof Prefs {
  if (/\bdied\b|^death (reset|warp)|death reset|death warp/i.test(text)) return "nDeaths";
  if (/precraft/i.test(text)) return "nPrecraft";
  if (/^(trades|trades used|left on the ground|while trading|gold blocks|could have left)\b|extra trades|piglins angry/i.test(text)) return "nTrading";
  if (/^(wood|lava portal|ruined portal|buried treasure|shipwreck|iron golem|temple chests|iron pickaxe)\b|\bvillage\b/i.test(text)) return "nOverworld";
  if (/^(pearls to the fortress|blocks placed|pearl hang|blinded with|6 rods|blaze bed)\b/i.test(text)) return "nNether";
  if (/^(eyes|in the stronghold|dragon|free the end|finished|first bed|last setup block)\b|^[^:]+: perch\b|\bin the stronghold:/i.test(text)) return "nEnd";
  return "nOther";
}

/** What each player did in one phase */
function facts(p: Report, theirName: string, a: RaceAnalysis) {
  const P = prefs();
  const trades = p.phase === "Bastion" && P.tradesTable ? tradesTable(a, theirName) : p.phase === "Overworld" && P.craftsTable ? craftsTable(a, theirName) : null;
  const rows: HTMLElement[] = [];
  for (const w of P.costRows ? p.why ?? [] : []) {
    const [first, ...rest] = w.text.split(" · ");
    const v = versus(first);
    rows.push(h("tr", { class: "f-main" },
      h("td", null, callLabel(w.label, w.seconds)), h("td", null, v ? v.you : ""), h("td", null, v ? v.them : ""),
      h("td", { class: changeCls(w.seconds) }, Math.abs(w.seconds) < 0.5 ? "" : fmtDelta(w.seconds)),
      h("td", { class: "dim" }, watch(w.at, theirName))));
    // Lines that aren't "you vs them" read as a note under the row, from the left
    const note = (t: string) => h("tr", { class: "f-sub f-note" }, h("td", { colspan: 5 }, cap(t)));
    if (!P.costDetail) continue;
    if (!v && first) rows.push(note(first));
    for (const part of rest) {
      const pv = versus(part);
      rows.push(pv ? h("tr", { class: "f-sub" }, h("td", null, pv.what), h("td", null, pv.you), h("td", null, pv.them), h("td"), h("td"))
        : note(part));
    }
  }
  // The trades table already shows these
  const notes = (p.notes ?? []).filter((n) => !/^could have/i.test(n.text) && !(trades && /^(Trades:|Left on the ground:)/.test(n.text)) && P[noteKind(n.text)]);
  return h("div", { class: "facts" },
    p.unfinished ? h("div", { class: "dim" }, "Your run ended in this phase.") : null,
    p.theirsEnded ? h("div", { class: "dim" }, `${theirName}'s run ended in this phase.`) : null,
    rows.length ? h("table", { class: `plain facts-t ${P.colWatch ? "" : "no-watch"}` },
      h("tr", null, h("th", null, ""), h("th", { class: "you" }, "You"), h("th", { class: "them" }, theirName), h("th", null, "Cost"), h("th", null, "Watch at")),
      rows) : null,
    trades,
    notes.length ? h("ul", { class: "facts-notes" }, notes.map((n) => h("li", null, h("span", null, n.text.replace(/ · /g, ", ")), h("span", { class: "dim" }, watch(n.at, theirName))))) : null,
    P.playByPlay === "hidden" ? null : playByPlay(p, theirName));
}

function splitsTable(a: RaceAnalysis, id: number, seedType: string | null, selected: string | null, select: (phase: string | null) => void) {
  const { segments } = buildDeltaModel(a);
  const byName = new Map(a.splits.map((s) => [s.name, s]));
  const groups: { phase: string; segs: typeof segments }[] = [];
  for (const s of segments) {
    const phase = s.reportPhase ?? s.segLabel;
    if (groups.at(-1)?.phase === phase) groups.at(-1)!.segs.push(s);
    else groups.push({ phase, segs: [s] });
  }
  const used = new Set(segments.map((s) => s.splitName));
  const unreached = a.splits.filter((s) => !used.has(s.name) && (s.you === null || s.them === null));
  const t = (ticks: number | null) => (ticks === null ? "—" : fmtClock(ticks));
  const P = prefs();

  const body: HTMLElement[] = [];
  for (const grp of groups) {
    const p = a.report?.find((r) => r.phase === grp.phase);
    const on = grp.phase === selected;
    body.push(h("tr", { class: `grp ${on ? "on" : ""}`, "data-grp": grp.phase, "data-t": grp.segs[0].you0, "data-name": grp.phase, onclick: () => select(on ? null : grp.phase) },
      h("td", null, h("span", { class: "grp-name" }, h("span", { class: "caret" }, on ? "▾" : "▸"), ...phaseIconKeys(grp.phase, seedType).map((k) => structIcon(k)), grp.phase)),
      h("td", { class: "dim" }, p?.you != null ? clockSec(p.you) : ""), h("td", { class: "dim" }, p?.them != null ? clockSec(p.them) : ""),
      h("td", { class: changeCls(p?.change ?? null) }, p?.change != null && (grp.segs.length > 1 || !P.splitRows) ? signed(p.change) : ""),
      // Without split rows the gap at the end of the phase goes on the phase row
      P.splitRows ? h("td") : h("td", { class: changeCls(grp.segs.at(-1)!.gap1) }, signed(grp.segs.at(-1)!.gap1))));
    for (const s of P.splitRows ? grp.segs : []) {
      const sp = byName.get(s.splitName);
      if (!sp) continue;
      body.push(h("tr", { class: "split", "data-t": (sp.you ?? sp.them ?? 0) / 20, "data-name": s.splitName },
        h("td", null, s.splitName), h("td", null, t(sp.you)), h("td", null, t(sp.them)),
        h("td", { class: changeCls(s.segDelta) }, signed(s.segDelta)), h("td", { class: changeCls(s.gap1) }, signed(s.gap1))));
    }
    if (on && p) body.push(h("tr", { class: "facts-row" }, h("td", { colspan: 5 }, facts(p, a.them.name, a))));
  }
  if (unreached.length && P.unreached) {
    body.push(h("tr", { class: "grp off" }, h("td", { colspan: 5 }, unreached.every((x) => x.you !== null) ? "Only you reached" : unreached.every((x) => x.them !== null) ? `Only ${a.them.name} reached` : "Only one of you reached")));
    for (const sp of unreached) body.push(h("tr", { class: "split off", "data-t": (sp.you ?? sp.them ?? 0) / 20 }, h("td", null, sp.name), h("td", null, t(sp.you)), h("td", null, t(sp.them)), h("td"), h("td")));
  }
  return h("table", { class: `plain splits2 ${P.colDelta ? "" : "no-delta"} ${P.colGap ? "" : "no-gap"}`, "data-race": id },
    h("tr", null, h("th", null, "Split"), h("th", { class: "you" }, "You"), h("th", { class: "them" }, a.them.name), h("th", { title: "Time lost (+) or gained (−) on this split" }, "±"), h("th", { title: "Total lead (−) or deficit (+)" }, "Gap")),
    body);
}

export function raceView(id: number, rerender: () => void, yourElo: number | null = null) {
  const r = cache.get(id);
  if (!r && gone.has(id)) return h("div", { class: "page" }, h("div", { class: "empty" }, "This game isn't there anymore."));
  if (!r) { void loadRace(id).then(rerender); return h("div", { class: "page" }, h("div", { class: "empty" }, "Loading game")); }
  const { row, analysis: a } = r;
  const isRace = row.your_file !== row.their_file;
  // All actions are behind ⋯, the keys from settings still work as shortcuts
  const watchIt = () => void openInMinecraft(row.race_file!), companion = () => g.companion(id);
  const keys = prefs();
  if (row.race_file && keys.keyWatch) bindKey(keys.keyWatch, watchIt);
  if (keys.keyCompanion) bindKey(keys.keyCompanion, companion);
  const item = (label: string, fn: () => void, key?: string, cls = "") =>
    h("button", { class: cls, onclick: (e: Event) => { (e.currentTarget as HTMLElement).closest("details")!.open = false; fn(); } }, label, key ? h("span", { class: "kbd" }, key) : null);
  const actions = h("details", { class: "menu" }, h("summary", { class: "btn ghost", title: "Watch, companion, file" }, "⋯"),
    h("div", { class: "menu-list" },
      row.race_file ? item("Watch in Ranked", watchIt, keys.keyWatch.toUpperCase() || undefined) : null,
      item("Companion", companion, keys.keyCompanion.toUpperCase() || undefined),
      row.race_file ? item("Show file", () => g.reveal(row.race_file!)) : null,
      item("Remove", async () => {
        if (!confirm(`Remove the game vs ${row.their_name}? The replay files stay.`)) return;
        forgetRace(id); gone.add(id);
        await g.deleteRace(id); rerender();
      }, undefined, "bad")));
  const where = [isRace ? null : "Ranked match", seedText(row.seed_type), day(row.created_at)].filter(Boolean).join(", ");
  if (!a) return h("div", { class: "page" }, h("div", { class: "race-head" }, h("span", { class: "dim" }, where), actions), h("div", { class: "notice bad" }, row.error ?? "This game couldn't be analysed."));

  if (open?.race !== id) {
    noteRaceOpened();
    // Opening a race you won, once per race
    if (a.finalGap < -0.5 && !cheered.has(id)) {
      cheered.add(id);
      requestAnimationFrame(() => celebrate());
    }
    const worst = [...(a.report ?? [])].filter((p) => p.change !== null && !p.unfinished).sort((x, y) => y.change! - x.change!)[0];
    open = { race: id, phase: worst && worst.change! > 0 ? worst.phase : null };
  }
  // Picking a phase only redraws the table so the graph can animate to it
  let table = splitsTable(a, id, row.seed_type, open.phase, (p) => pickPhase(p, true));
  const tablePanel = panel(null, null, table);
  // Background updates redraw the page but the graph keeps its zoom, hover and layers
  if (keptChart?.a !== a) {
    keptChart?.chart.dispose(); keptChart?.strip.dispose(); keptChart?.ro?.disconnect();
    keptChart = { a, chart: gapChart(a, { seedType: row.seed_type, selected: open.phase, onSelect: (p) => keptChart?.pick(p) }),
    strip: gapStrip(a, { seedType: row.seed_type, selected: open.phase, onPick: (t) => keptChart?.jump(t) }), pick: () => {}, jump: () => {} };
  }
  const kept = keptChart;
  const { chart, strip } = kept;
  keptChart.pick = (p) => pickPhase(p, false);
  function pickPhase(phase: string | null, fromTable: boolean) {
    open = { race: id, phase };
    const next = splitsTable(a!, id, row.seed_type, phase, (p) => pickPhase(p, true));
    table.replaceWith(next);
    table = next;
    if (fromTable) chart.select(phase);
    strip.mark(phase);
    // Only table clicks scroll the row into view, picking from the graph doesn't scroll
    if (phase && fromTable) requestAnimationFrame(() => next.querySelector(`tr[data-grp="${CSS.escape(phase)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }
  const who = (p: RaceAnalysis["you"], elo: number | null | undefined, side: "you" | "them") =>
    h("span", { class: `race-who ${side}`, title: runLine(p) }, head({ uuid: p.uuid, name: p.name }, 22), h("span", { class: side }, p.name), rank(elo));
  const header = h("div", { class: "race-head" },
    h("div", { class: "race-vs" },
      who(a.you, a.you.elo ?? yourElo, "you"),
      h("span", { class: `race-gap ${deltaClass(a.finalGap)}`, title: a.finalGap > 0.5 ? "behind at the end" : a.finalGap < -0.5 ? "ahead at the end" : "even at the end" }, fmtDelta(a.finalGap)),
      who(a.them, a.them.elo ?? row.their_elo, "them"),
      h("span", { class: "dim" }, where)),
    actions);
  // Scrolling into the splits folds the graph into a strip at the top. The panel is sticky with a negative top
  // so layout never changes. Positions follow scroll exactly, the fold look runs on a spring so it doesn't step per wheel notch.
  // Once it's a strip the playhead follows the split row you're reading
  const chartPanel = panel(null, { cls: "race-graph" }, header, chart, strip);
  const page = h("div", { class: "page race-page" },
    chartPanel,
    tablePanel,
    a.seed?.overworld ? panel(null, null,
      h("div", { class: "p-head" }, h("h2", null, "Seed")),
      h("div", { class: "seeds" }, copyField("World", String(a.seed.overworld)), a.seed.nether ? copyField("Nether", String(a.seed.nether)) : null)) : null);
  const plot = chart.querySelector<HTMLElement>(".gap-plot")!;
  let L = { travel: 0, plotTop: 0, plotH: 1, stripTop: 0 }, k = 0, hovered: number | null = null;
  // Spring state: m chases scroll progress, v is its speed, t is where the playhead is drawn
  let m = 0, v = 0, t: number | null = null, tTo: number | null = null, note = "", raf = 0, last = 0;
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  const ease = (x: number) => x * x * (3 - 2 * x);
  const measure = () => {
    const geom = chart.geom();
    if (!geom || !chartPanel.isConnected) return;
    const saved = plot.style.transform;
    plot.style.transform = "";
    const pr = chartPanel.getBoundingClientRect(), r = plot.getBoundingClientRect();
    plot.style.transform = saved;
    const headH = header.offsetHeight + 8, stripH = 14 + headH + STRIP_H + 10;
    const travel = Math.max(0, chartPanel.offsetHeight - stripH);
    L = { travel, plotTop: r.top - pr.top + geom.top, plotH: Math.max(1, geom.bot - geom.top), stripTop: 14 + headH };
    chartPanel.style.top = `${-travel}px`;
    strip.style.cssText = `left:${(r.left - pr.left).toFixed(1)}px;width:${r.width.toFixed(1)}px;top:${L.stripTop}px`;
    plot.style.transformOrigin = `0 ${geom.top}px`;
    apply();
  };
  const apply = () => {
    const slide = k * L.travel; // Keeps pinned stuff in place while the panel scrolls under it
    header.style.transform = k ? `translateY(${slide.toFixed(1)}px)` : "";
    // Plot folds onto the strip's curve. The strip uses the same scale and axis so it lands exactly on top
    const f = clamp(m), target = L.stripTop + strip.plotTop;
    const curveTop = L.plotTop + slide + f * (target - L.plotTop), curveH = L.plotH + f * (strip.plotH - L.plotH);
    plot.style.transform = slide || f > 0.001 ? `translateY(${(curveTop - L.plotTop).toFixed(1)}px) scaleY(${(curveH / L.plotH).toFixed(4)})` : "";
    const handOff = ease(clamp((m - 0.5) / 0.4));
    chartPanel.style.setProperty("--k", m.toFixed(3));
    chartPanel.style.setProperty("--detail", (1 - clamp(m * 2.6)).toFixed(3));
    chartPanel.style.setProperty("--curve", (1 - handOff).toFixed(3));
    chartPanel.style.setProperty("--chrome", (1 - clamp(m * 3.2)).toFixed(3));
    strip.style.opacity = handOff.toFixed(3);
    strip.style.transform = `translateY(${(curveTop - target).toFixed(1)}px)`;
    strip.fold(curveH / strip.plotH);
    chartPanel.classList.toggle("shrunk", m > 0.02);
    chartPanel.classList.toggle("strip-on", handOff > 0.9);
  };
  // One spring frame (critically damped so no overshoot) + playhead glide
  const frame = (now: number) => {
    const dt = Math.min(1 / 30, last ? (now - last) / 1000 : 1 / 60);
    last = now;
    const to = k, W = 24;
    v += (W * W * (to - m) - 2 * W * v) * dt;
    m += v * dt;
    if (tTo !== null && t !== null) t += (tTo - t) * (1 - Math.exp(-dt * 16));
    const springDone = Math.abs(to - m) < 0.0005 && Math.abs(v) < 0.002, glideDone = t === tTo || (t !== null && tTo !== null && Math.abs(tTo - t) < 0.02);
    if (springDone) { m = to; v = 0; }
    if (glideDone) t = tTo;
    apply();
    strip.at(t, note);
    raf = springDone && glideDone ? 0 : requestAnimationFrame(frame);
  };
  const kick = () => {
    if (still()) { m = k; t = tTo; apply(); strip.at(t, note); return; }
    if (!raf) { last = 0; raf = requestAnimationFrame(frame); }
  };
  const aim = (sec: number | null, what = "") => {
    note = what;
    if (sec === null || t === null) t = sec; // Appearing or hiding, don't glide
    tTo = sec;
  };
  const follow = () => {
    const main = page.closest("main");
    if (!main) return;
    // How far the panel scrolled past the top (the box itself never moves, only its contents)
    const d = main.getBoundingClientRect().top - chartPanel.getBoundingClientRect().top;
    k = L.travel ? clamp(d / L.travel) : 0;
    apply(); // Positions now so nothing lags the scroll, the look catches up on the spring
    if (k < 0.6) { aim(null); chart.setPlayhead(hovered); kick(); return; }
    chart.setPlayhead(null);
    const rows = [...tablePanel.querySelectorAll<HTMLElement>("tr[data-t]")];
    if (hovered !== null) { const tr = rows.find((x) => Number(x.dataset.t) === hovered); aim(hovered, tr?.dataset.name ?? ""); kick(); return; }
    const ref = chartPanel.getBoundingClientRect().bottom + 6;
    // Not in the splits yet
    if (!rows[0] || rows[0].getBoundingClientRect().top > ref) { aim(null); kick(); return; }
    let at: number | null = rows[0] ? Number(rows[0].dataset.t) : null, name = rows[0]?.dataset.name ?? "";
    for (let i = 0; i < rows.length; i++) {
      const ra = rows[i].getBoundingClientRect(), rb = rows[i + 1]?.getBoundingClientRect();
      if (ra.top <= ref && (!rb || rb.top > ref)) {
        const t0 = Number(rows[i].dataset.t), t1 = rows[i + 1] ? Number(rows[i + 1].dataset.t) : t0;
        at = t0 + (t1 - t0) * (rb ? Math.min(1, (ref - ra.top) / Math.max(1, rb.top - ra.top)) : 0);
        name = rows[i].dataset.name ?? "";
        break;
      }
    }
    aim(at, name);
    kick();
  };
  // Clicking the strip scrolls the table to the split at that time and flashes it
  keptChart.jump = (sec) => {
    const main = page.closest("main");
    const rows = [...tablePanel.querySelectorAll<HTMLElement>("tr.split[data-t]")].filter((x) => x.offsetParent);
    if (!main || !rows.length) return;
    const tr = rows.reduce((best, x) => (Math.abs(Number(x.dataset.t) - sec) < Math.abs(Number(best.dataset.t) - sec) ? x : best), rows[0]);
    const below = L.stripTop + STRIP_H + 10 + 6; // Strip height once pinned
    main.scrollBy({ top: tr.getBoundingClientRect().top - main.getBoundingClientRect().top - below, behavior: still() ? "auto" : "smooth" });
    tr.classList.remove("flash");
    void tr.offsetWidth;
    tr.classList.add("flash");
  };
  tablePanel.addEventListener("mouseover", (e) => {
    const tr = (e.target as HTMLElement).closest<HTMLElement>("tr[data-t]");
    const val = tr ? Number(tr.dataset.t) : null;
    if (val !== hovered) { hovered = val; follow(); }
  });
  tablePanel.addEventListener("mouseleave", () => { hovered = null; follow(); });
  setTimeout(() => {
    const main = page.closest("main");
    if (!main) return;
    const onScroll = () => {
      if (!page.isConnected) { main.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); return; }
      follow();
    };
    main.addEventListener("scroll", onScroll, { passive: true });
    // Zoom or layer changes resize the graph. One observer per chart, not per redraw
    kept.ro?.disconnect();
    kept.ro = new ResizeObserver(() => { measure(); follow(); });
    kept.ro.observe(chart);
    measure();
    follow();
    // A redraw mid-page starts already folded
    m = k; v = 0; t = tTo;
    apply();
    strip.at(t, note);
  });
  return page;
}
