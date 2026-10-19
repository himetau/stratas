// One race: players, gap graph, splits grouped by phase
// Opening a phase shows what each player did in it side by side
import { g, type RaceAnalysis, type RaceRow } from "../bridge";
import { buildDeltaModel } from "../../core/detect/segments";
import { clockSec, deltaClass, fmtClock, fmtDelta, h } from "../dom";
import { callLabel, gapChart, gapStrip, STRIP_H } from "../gap";
import { bindKey, copyField, head, openInMinecraft, panel, rank } from "../parts";
import { phaseIconKeys, structIcon } from "../ranked";
import { playByPlay } from "./report";
import { day, seedText } from "./races";

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

/** What each player did in one phase */
function facts(p: Report, theirName: string) {
  const rows: HTMLElement[] = [];
  for (const w of p.why ?? []) {
    const [first, ...rest] = w.text.split(" · ");
    const v = versus(first);
    rows.push(h("tr", { class: "f-main" },
      h("td", null, callLabel(w.label, w.seconds)), h("td", null, v ? v.you : ""), h("td", null, v ? v.them : ""),
      h("td", { class: changeCls(w.seconds) }, Math.abs(w.seconds) < 0.5 ? "" : fmtDelta(w.seconds)),
      h("td", { class: "dim" }, watch(w.at, theirName))));
    if (!v && first) rows.push(h("tr", { class: "f-sub" }, h("td"), h("td", { colspan: 4 }, first)));
    for (const part of rest) {
      const pv = versus(part);
      rows.push(pv ? h("tr", { class: "f-sub" }, h("td", null, pv.what), h("td", null, pv.you), h("td", null, pv.them), h("td"), h("td"))
        : h("tr", { class: "f-sub" }, h("td"), h("td", { colspan: 4 }, part)));
    }
  }
  const notes = (p.notes ?? []).filter((n) => !/^could have/i.test(n.text));
  return h("div", { class: "facts" },
    p.unfinished ? h("div", { class: "dim" }, "Your run ended in this phase.") : null,
    p.theirsEnded ? h("div", { class: "dim" }, `${theirName}'s run ended in this phase.`) : null,
    rows.length ? h("table", { class: "plain facts-t" },
      h("tr", null, h("th", null, ""), h("th", { class: "you" }, "You"), h("th", { class: "them" }, theirName), h("th", null, "Cost"), h("th", null, "Watch at")),
      rows) : null,
    notes.length ? h("ul", { class: "facts-notes" }, notes.map((n) => h("li", null, h("span", null, n.text.replace(/ · /g, ", ")), h("span", { class: "dim" }, watch(n.at, theirName))))) : null,
    playByPlay(p, theirName));
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

  const body: HTMLElement[] = [];
  for (const grp of groups) {
    const p = a.report?.find((r) => r.phase === grp.phase);
    const on = grp.phase === selected;
    body.push(h("tr", { class: `grp ${on ? "on" : ""}`, "data-grp": grp.phase, "data-t": grp.segs[0].you0, "data-name": grp.phase, onclick: () => select(on ? null : grp.phase) },
      h("td", null, h("span", { class: "grp-name" }, h("span", { class: "caret" }, on ? "▾" : "▸"), ...phaseIconKeys(grp.phase, seedType).map((k) => structIcon(k)), grp.phase)),
      h("td", { class: "dim" }, p?.you != null ? clockSec(p.you) : ""), h("td", { class: "dim" }, p?.them != null ? clockSec(p.them) : ""),
      h("td", { class: changeCls(p?.change ?? null) }, p?.change != null && grp.segs.length > 1 ? signed(p.change) : ""), h("td")));
    for (const s of grp.segs) {
      const sp = byName.get(s.splitName);
      if (!sp) continue;
      body.push(h("tr", { class: "split", "data-t": (sp.you ?? sp.them ?? 0) / 20, "data-name": s.splitName },
        h("td", null, s.splitName), h("td", null, t(sp.you)), h("td", null, t(sp.them)),
        h("td", { class: changeCls(s.segDelta) }, signed(s.segDelta)), h("td", { class: changeCls(s.gap1) }, signed(s.gap1))));
    }
    if (on && p) body.push(h("tr", { class: "facts-row" }, h("td", { colspan: 5 }, facts(p, a.them.name))));
  }
  if (unreached.length) {
    body.push(h("tr", { class: "grp off" }, h("td", { colspan: 5 }, unreached.every((x) => x.you !== null) ? "Only you reached" : unreached.every((x) => x.them !== null) ? `Only ${a.them.name} reached` : "Only one of you reached")));
    for (const sp of unreached) body.push(h("tr", { class: "split off", "data-t": (sp.you ?? sp.them ?? 0) / 20 }, h("td", null, sp.name), h("td", null, t(sp.you)), h("td", null, t(sp.them)), h("td"), h("td")));
  }
  return h("table", { class: "plain splits2", "data-race": id },
    h("tr", null, h("th", null, "Split"), h("th", { class: "you" }, "You"), h("th", { class: "them" }, a.them.name), h("th", { title: "Time lost (+) or gained (−) on this split" }, "±"), h("th", { title: "Total lead (−) or deficit (+)" }, "Gap")),
    body);
}

export function raceView(id: number, rerender: () => void, yourElo: number | null = null) {
  const r = cache.get(id);
  if (!r && gone.has(id)) return h("div", { class: "page" }, h("div", { class: "empty" }, "This race isn't there anymore."));
  if (!r) { void loadRace(id).then(rerender); return h("div", { class: "page" }, h("div", { class: "empty" }, "Loading race")); }
  const { row, analysis: a } = r;
  const isRace = row.your_file !== row.their_file;
  // All actions are behind ⋯, M and C still work as shortcuts
  const watchIt = () => void openInMinecraft(row.race_file!), companion = () => g.companion(id);
  if (row.race_file) bindKey("m", watchIt);
  bindKey("c", companion);
  const item = (label: string, fn: () => void, key?: string, cls = "") =>
    h("button", { class: cls, onclick: (e: Event) => { (e.currentTarget as HTMLElement).closest("details")!.open = false; fn(); } }, label, key ? h("span", { class: "kbd" }, key) : null);
  const actions = h("details", { class: "menu" }, h("summary", { class: "btn ghost", title: "Watch, companion, file" }, "⋯"),
    h("div", { class: "menu-list" },
      row.race_file ? item("Watch in Ranked", watchIt, "M") : null,
      item("Companion", companion, "C"),
      row.race_file ? item("Show file", () => g.reveal(row.race_file!)) : null,
      item("Remove", async () => {
        if (!confirm(`Remove the race vs ${row.their_name}? The replay files stay.`)) return;
        forgetRace(id); gone.add(id);
        await g.deleteRace(id); rerender();
      }, undefined, "bad")));
  const where = [isRace ? null : "Ranked match", seedText(row.seed_type), day(row.created_at)].filter(Boolean).join(", ");
  if (!a) return h("div", { class: "page" }, h("div", { class: "race-head" }, h("span", { class: "dim" }, where), actions), h("div", { class: "notice bad" }, row.error ?? "This race couldn't be analysed."));

  if (open?.race !== id) {
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
  const still = matchMedia("(prefers-reduced-motion: reduce)");
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
    if (still.matches) { m = k; t = tTo; apply(); strip.at(t, note); return; }
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
    main.scrollBy({ top: tr.getBoundingClientRect().top - main.getBoundingClientRect().top - below, behavior: still.matches ? "auto" : "smooth" });
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
