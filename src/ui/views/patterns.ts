// Patterns page: usual run by phase, habits that keep costing time, and End/deaths/bests/seed types
// across every race
import type { AppState } from "../bridge";
import { clockSec, deltaClass, fmtDelta, fmtDur, h } from "../dom";
import { panel } from "../parts";
import { phaseIconKey, structIcon } from "../ranked";

type Insights = AppState["insights"];
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** Phase colour, pink if you usually lose time there, green if you gain */
const heat = (x: number) => {
  const a = Math.min(1, Math.abs(x) / 60);
  return Math.abs(x) < 2 ? "var(--tile)" : `color-mix(in srgb, var(--${x > 0 ? "bad" : "good"}) ${Math.round(18 + 62 * a)}%, var(--tile))`;
};
const loud = (x: number) => Math.abs(x) >= 20;
/** Whole seconds for the big numbers, "+35s" "−1:16" */
const secs = (x: number) => { const a = Math.round(Math.abs(x)); return `${x > 0.5 ? "+" : x < -0.5 ? "−" : "±"}${a >= 60 ? clockSec(a) : `${a}s`}`; };
/** First couple of facts only, not the whole breakdown */
const brief = (text: string) => text.split(", ").slice(0, 2).join(", ");

/** Recent races as small bars, up/pink = finished behind, down/green = ahead */
function recentBars(i: Insights, open: (id: number) => void) {
  const max = Math.max(60, ...i.recent.map((r) => Math.abs(r.gap)));
  return h("div", { class: "pt-recent", title: "Your recent games, oldest first" },
    i.recent.map((r) => h("button", { class: "pt-rbar", title: `vs ${r.name}: ${fmtDelta(r.gap)}`, onclick: () => open(r.id) },
      h("i", { class: r.gap > 0 ? "up" : "down", style: `height:${Math.max(2, Math.round((Math.abs(r.gap) / max) * 18))}px` }))));
}

/** One run split into your phases. Width = how long they take you, colour = how you usually do */
function usualRun(i: Insights) {
  const p = i.phases;
  if (!p.length) return null;
  const notes = (() => {
    const worst = [...p].filter((x) => x.usual > 2).sort((a, b) => b.usual - a.usual).slice(0, 2);
    const best = [...p].filter((x) => x.usual < -2).sort((a, b) => a.usual - b.usual)[0];
    return [...worst, ...(best ? [best] : [])].map((x) => {
      const habit = i.habits.find((hb) => hb.phase === x.name);
      const good = x.usual < 0;
      return h("div", { class: "pt-note" },
        h("div", { class: `pt-note-head ${good ? "good" : "bad"}` }, structIcon(phaseIconKey(x.name, null)), x.name, h("span", null, secs(x.usual))),
        h("div", { class: "pt-note-body" }, good
          ? `Your strongest phase: usually ${fmtDur(-x.usual)} quicker, ${clockSec(x.you)} against their ${clockSec(x.them)}.`
          : habit ? `${habit.title}: ${brief(habit.example.text)}.` : `You usually take ${clockSec(x.you)} here, they take ${clockSec(x.them)}.`),
        h("div", { class: "pt-note-foot dim" }, good ? `quicker in ${x.races - x.lostIn} of ${x.races} games` : `slower in ${x.lostIn} of ${x.races} games`));
    });
  })();
  return panel(null, null,
    h("div", { class: "p-head" }, h("h2", null, "Your usual run"), h("span", { class: "dim" }, "each phase sized by how long it takes you, coloured by how you usually do against them")),
    h("div", { class: "pt-run" }, p.map((x) => h("div", { class: "pt-seg", style: `flex:${Math.max(0.6, x.you)};background:${heat(x.usual)}`, title: `${x.name}: you ${clockSec(x.you)}, them ${clockSec(x.them)}` },
      h("span", { class: `pt-seg-n ${loud(x.usual) ? "ink" : ""}` }, x.name),
      h("span", { class: `pt-seg-v ${loud(x.usual) ? "ink" : ""}` }, secs(x.usual))))),
    notes.length ? h("div", { class: "pt-notes" }, notes) : null);
}

/** A card per habit */
function habitCards(i: Insights, open: (id: number) => void) {
  if (!i.habits.length) return panel(null, null, h("div", { class: "p-head" }, h("h2", null, "Habits")),
    h("p", { class: "dim", style: "margin:0" }, i.races < 3 ? "A few more games and the things that keep costing you time show up here." : "Nothing keeps costing you time right now."));
  const card = (hb: Insights["habits"][number]) => h("div", { class: "pt-card" },
    h("div", { class: "pt-card-top" }, h("span", { class: "dim" }, structIcon(phaseIconKey(hb.phase, null)), hb.phase),
      hb.trend ? h("span", { class: `pt-trend ${hb.trend}` }, hb.trend === "better" ? "getting better" : hb.trend === "worse" ? "getting worse" : "steady") : null),
    h("div", { class: "pt-card-title" }, hb.title),
    h("div", { class: "pt-card-cost" }, h("b", { class: "bad" }, secs(hb.usual)), h("span", { class: "dim" }, "usually")),
    h("div", { class: "pt-dots" }, hb.dots.map((d) => h("i", { class: d ? "on" : "" })), h("span", { class: "dim" }, `${hb.hits} of ${hb.outOf} games`)),
    h("div", { class: "pt-card-ev" }, brief(hb.example.text)),
    h("button", { class: "btn sm pt-watch", onclick: () => open(hb.example.raceId) }, `Watch vs ${hb.example.name}${hb.example.at !== null ? ` at ${clockSec(hb.example.at / 20)}` : ""}`));
  const [top, rest] = [i.habits.slice(0, 3), i.habits.slice(3)];
  return h("div", { class: "pt-section" },
    h("div", { class: "pt-h" }, h("h2", null, "Habits"), h("span", { class: "dim" }, "what keeps costing you time")),
    h("div", { class: "pt-cards" }, top.map(card)),
    rest.length ? h("div", { class: "pt-more" }, rest.map((hb) => h("button", { class: "pt-more-row", onclick: () => open(hb.example.raceId) },
      h("span", { class: "dim" }, hb.phase), h("span", null, hb.title), h("span", { class: "dim" }, `${hb.hits} of ${hb.outOf}`), h("b", { class: "bad" }, secs(hb.usual))))) : null);
}

/** End, deaths and seed types as three cards */
function sideCards(i: Insights) {
  const e = i.end, d = i.deaths;
  const stat = (label: string, value: string, cls = "") => h("div", { class: "pt-stat" }, h("span", { class: "dim" }, label), h("b", { class: cls }, value));
  return h("div", { class: "pt-cards" },
    h("div", { class: "pt-card" },
      h("div", { class: "pt-card-top" }, h("span", { class: "dim" }, structIcon("end"), "The End")),
      e ? [h("div", { class: "pt-card-cost" }, h("b", { class: e.failed ? "bad" : "good" }, `${e.failed} of ${e.ends}`), h("span", { class: "dim" }, "with a failed cycle")),
        stat("One cycles", String(e.oneCycle)), stat("Zero cycles", String(e.zero)), stat("Dragon not killed", String(e.notKilled), e.notKilled ? "bad" : ""),
        e.usualFight !== null ? stat("Usual fight", clockSec(e.usualFight)) : null]
        : h("div", { class: "pt-card-ev dim" }, "No Ends yet.")),
    h("div", { class: "pt-card" },
      h("div", { class: "pt-card-top" }, h("span", { class: "dim" }, "Deaths")),
      h("div", { class: "pt-card-cost" }, h("b", { class: d.deaths ? "bad" : "good" }, String(d.deaths)), h("span", { class: "dim" }, d.deaths === 1 ? "death" : "deaths")),
      stat("Games with a death", `${d.races} of ${i.races}`), stat("Time dead", fmtDur(d.seconds), d.seconds ? "bad" : ""), stat("Death resets (on purpose)", String(d.resets))),
    h("div", { class: "pt-card" },
      h("div", { class: "pt-card-top" }, h("span", { class: "dim" }, "Seeds"), h("span", { class: "dim" }, "usual gap")),
      i.seeds.length ? i.seeds.slice(0, 6).map((sd) => h("div", { class: "pt-stat" },
        h("span", null, structIcon(sd.type.replace(/ /g, "_")), cap(sd.type), h("span", { class: "dim" }, ` · ${sd.races}`)), h("b", { class: deltaClass(sd.usual) }, secs(sd.usual))))
        : h("div", { class: "pt-card-ev dim" }, "Practice a few seed types to compare them.")));
}

/** Best time per phase and who you raced */
function bests(i: Insights, open: (id: number) => void) {
  if (!i.best.length) return null;
  return h("div", { class: "pt-section" },
    h("div", { class: "pt-h" }, h("h2", null, "Your best times"), h("span", { class: "dim" }, "fastest you've done each phase")),
    h("div", { class: "pt-bests" }, i.best.map((b) => h("button", { class: "pt-best", onclick: () => open(b.raceId), title: `vs ${b.vs}` },
      h("span", { class: "dim" }, structIcon(phaseIconKey(b.name, null)), b.name), h("b", null, clockSec(b.you)), h("span", { class: "dim" }, `vs ${b.vs}`)))));
}

export function patternsView(s: AppState, open: (id: number) => void) {
  const i = s.insights;
  return h("div", { class: "page" },
    h("div", { class: "page-head pt-head" }, h("h1", null, "Patterns"),
      h("span", { class: "dim" }, `${i.races} game${i.races === 1 ? "" : "s"}`),
      i.usual !== null ? h("span", null, "you usually finish ", h("b", { class: deltaClass(i.usual) }, `${fmtDelta(i.usual)} ${i.usual > 0 ? "behind" : "ahead"}`)) : null,
      i.recent.length > 1 ? recentBars(i, open) : null),
    i.races ? [usualRun(i), habitCards(i, open), sideCards(i), bests(i, open)]
      : panel(null, null, h("div", { class: "empty" }, h("b", null, "No games yet"), "Practice a few seeds and your patterns show up here.")));
}
