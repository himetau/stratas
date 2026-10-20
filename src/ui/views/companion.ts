// Always-on-top window next to Ranked, compact findings for one race
import { g, type AppState } from "../bridge";
import { deltaClass, fmtDelta, h, mount } from "../dom";
import { phaseCard } from "./report";
import { cachedRace, loadRace } from "./race";

let follow = true;
let current: number | null = null;

export function setCompanionRace(id: number | null) { current = id; follow = id === null; }

export function companionView(s: AppState, rerender: () => void) {
  const races = s.races.filter((r) => !r.error);
  if (follow || current === null) current = races[0]?.id ?? null;
  const top = h("div", { class: "row" },
    h("select", { id: "race", style: "flex:1", onchange: (e: Event) => { current = Number((e.target as HTMLSelectElement).value); follow = false; rerender(); } },
      races.map((r) => h("option", { value: String(r.id), selected: r.id === current }, `vs ${r.theirName} ${fmtDelta(r.finalGap)}`))),
    h("label", { class: "hint" }, h("input", { type: "checkbox", class: "toggle", checked: follow, onchange: (e: Event) => { follow = (e.target as HTMLInputElement).checked; rerender(); } }), "latest"));
  if (current === null) return h("div", { class: "comp" }, top, h("div", { class: "empty" }, "No games yet."));
  const body = h("div", { class: "comp", style: "padding:0" }, h("div", { class: "empty" }, "Loading"));
  const fill = (r: Awaited<ReturnType<typeof loadRace>>) => {
    if (!r?.analysis) { mount(body, h("div", { class: "notice bad" }, r?.row.error ?? "Couldn't load this game")); return; }
    const a = r.analysis;
    mount(body,
      h("div", { class: "row", style: "align-items:baseline" }, h("span", { class: `readout sm ${deltaClass(a.finalGap)}` }, fmtDelta(a.finalGap)), h("span", { class: "meta" }, `vs ${a.them.name}`)),
      (a.report ?? []).map((p) => phaseCard(p, a.them.name, (p.change ?? 0) > 10)));
  };
  // Already loaded means no "Loading" flash
  const hit = cachedRace(current);
  if (hit) fill(hit); else void loadRace(current).then(fill);
  return h("div", { class: "comp" }, top, body);
}

export function companionInit(rerender: () => void) {
  g.onCompanionRace((id) => { setCompanionRace(id); rerender(); });
}
