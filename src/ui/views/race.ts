import { g, type RaceAnalysis, type RaceRow } from "../bridge";
import { buildDeltaModel } from "../../core/detect/segments";
import { kitText, TRADE_ITEMS, TRADE_NAME, type CraftScreen } from "../../core/detect/stats";
import { itemName, listItems } from "../../core/detect/steps";
import { cap, clockSec, deltaClass, fmtClock, fmtDelta, fmtDur, h } from "../dom";
import { callLabel, gapChart, gapStrip, STRIP_H, type GapChart, type GapStrip } from "../gap";
import { bindKey, copyField, head, openInMinecraft, panel, rank } from "../parts";
import { phaseIconKeys, structIcon } from "../ranked";
import { playByPlay } from "./report";
import { celebrate, prefs, still } from "../prefs";
import { noteRaceOpened } from "../support";
import type { Prefs } from "../../core/prefs";
import { day, seedText } from "./races";
import { isWeb } from "../web";

const cache = new Map<number, { row: RaceRow; analysis: RaceAnalysis | null }>();
/** IDs of races that loaded empty. The page shows them as missing and does not ask again. */
const gone = new Set<number>();
const cheered = new Set<number>();
export async function loadRace(id: number) {
  const hit = cache.get(id);
  if (hit) {
    return hit;
  }
  const r = await g.race(id);
  if (r) {
    cache.set(id, r);
  } else {
    gone.add(id);
  }
  return r;
}
/** The race if it's already loaded, without waiting */
export const cachedRace = (id: number) => cache.get(id) ?? null;
export function forgetRace(id?: number) {
  if (id === undefined) {
    cache.clear();
  } else {
    cache.delete(id);
  }
}

type Report = NonNullable<RaceAnalysis["report"]>[number];
let openRace: { race: number; phase: string | null } | null = null;
// The ⋯ menu closes on any outside click.
document.addEventListener("click", (e) => {
  for (const d of document.querySelectorAll<HTMLDetailsElement>("details.menu[open]")) {
    if (!d.contains(e.target as Node)) {
      d.open = false;
    }
  }
});
let keptChart: {
  a: RaceAnalysis;
  chart: GapChart;
  strip: GapStrip;
  pick: (p: string | null) => void;
  jump: (sec: number) => void;
  ro?: ResizeObserver;
} | null = null;

const changeCls = (s: number | null) => (s === null || Math.abs(s) < 0.5 ? "dim" : deltaClass(s));
const signed = (s: number | null) => (s === null ? "" : fmtDelta(s));

function runLine(p: RaceAnalysis["you"]) {
  const t = fmtClock(p.endTicks);
  if (p.finished) {
    return `Finished in ${t}`;
  }
  return p.quit ? `Left at ${t}` : `Didn't finish, stopped at ${t}`;
}

/** "137 vs 53 blocks" -> you, them, unit. null if it's not a comparison */
function versus(part: string): { you: string; them: string; what: string } | null {
  const m = /^(\d[\d:.,]*(?: s| blocks)?) vs (\d[\d:.,]*(?: s| blocks)?)(?: (.+))?$/.exec(
    part.trim(),
  );
  if (!m) {
    return null;
  }
  // When either side is over a minute, both are written as m:ss ("1:16 vs 0 s").
  const unit = / (s|blocks)$/.exec(m[2])?.[0] ?? / (s|blocks)$/.exec(m[1])?.[0] ?? "";
  const bare = (x: string) => x.replace(/ (s|blocks)$/, "");
  if (unit === " s" && (m[1].includes(":") || m[2].includes(":"))) {
    const mmss = (x: string) => (x.includes(":") ? bare(x) : clockSec(Number(bare(x))));
    return { you: mmss(m[1]), them: mmss(m[2]), what: m[3] ?? "" };
  }
  return { you: bare(m[1]) + unit, them: bare(m[2]) + unit, what: m[3] ?? "" };
}

function watch(at: { you?: number; them?: number } | undefined, theirName: string) {
  if (!at) {
    return "";
  }
  return [
    at.you != null ? `you ${fmtClock(at.you)}` : null,
    at.them != null ? `${theirName} ${fmtClock(at.them)}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/** Bastion trades side by side: what each of you picked up and left on the ground, what you left with and used, and
 * which trade covered what you used */
function tradesTable(a: RaceAnalysis, theirName: string) {
  const y = a.stats?.you.trades;
  const t = a.stats?.them.trades;
  if (!y && !t) {
    return null;
  }
  const n = (v: number | undefined) => (v ? String(v) : "");
  const rows = TRADE_ITEMS.filter((k) =>
    [y?.got, y?.left, t?.got, t?.left].some((d) => (d?.[k] ?? 0) > 0),
  ).map((k) =>
    h(
      "tr",
      null,
      h("td", null, cap(TRADE_NAME[k])),
      h("td", null, n(y?.got[k])),
      h("td", { class: "dim" }, n(y?.left[k])),
      h("td", null, n(t?.got[k])),
      h("td", { class: "dim" }, n(t?.left[k])),
    ),
  );
  const need = (s: typeof y) => {
    if (!s) {
      return "—";
    }
    if (s.noneNeeded) {
      return "none";
    }
    return s.needed ? `${s.needed.n} of ${s.n} (${fmtClock(s.needed.t)})` : `? of ${s.n}`;
  };
  const both = (label: string, f: (s: NonNullable<typeof y>) => string, first = false) =>
    h(
      "tr",
      { class: first ? "sum first" : "sum" },
      h("td", null, label),
      h("td", { colspan: 2 }, y ? f(y) : "—"),
      h("td", { colspan: 2 }, t ? f(t) : "—"),
    );
  return h(
    "table",
    { class: "plain trades-t" },
    h(
      "tr",
      null,
      h("th", null, "Trades"),
      h("th", { class: "you" }, "You got"),
      h("th", null, "Left"),
      h("th", { class: "them" }, `${theirName} got`),
      h("th", null, "Left"),
    ),
    rows,
    both("Trades", (s) => String(s.n), true),
    both("Left on", (s) => kitText(s.leftWith)),
    both("Used after", (s) => kitText(s.used)),
    h(
      "tr",
      { class: "sum" },
      h("td", null, "Needed"),
      h("td", { colspan: 2 }, need(y)),
      h("td", { colspan: 2 }, need(t)),
    ),
  );
}

/** Overworld crafting side by side: each thing made with how many and when, then screens, time in them and the slowest */
function craftsTable(a: RaceAnalysis, theirName: string) {
  const y = a.stats?.you.owCrafts;
  const t = a.stats?.them.owCrafts;
  if (!y?.length && !t?.length) {
    return null;
  }
  /** First time each item was made, and how many in all */
  const byItem = (xs: CraftScreen[] | undefined) => {
    const m = new Map<string, { n: number; t: number }>();
    for (const x of xs ?? []) {
      for (const [it, n] of Object.entries(x.items)) {
        const c = m.get(it);
        if (c) {
          c.n += n;
        } else {
          m.set(it, { n, t: x.t0 });
        }
      }
    }
    return m;
  };
  const my = byItem(y);
  const mt = byItem(t);
  const items = [...new Set([...my.keys(), ...mt.keys()])].sort(
    (p, q) =>
      Math.min(my.get(p)?.t ?? Infinity, mt.get(p)?.t ?? Infinity) -
      Math.min(my.get(q)?.t ?? Infinity, mt.get(q)?.t ?? Infinity),
  );
  const cell = (c: { n: number; t: number } | undefined) =>
    c
      ? [h("td", null, c.n > 1 ? String(c.n) : "✓"), h("td", { class: "dim" }, fmtClock(c.t))]
      : [h("td", { class: "dim" }, "—"), h("td")];
  const smelt = (xs: CraftScreen[] | undefined) =>
    new Set((xs ?? []).filter((x) => x.smelt).flatMap((x) => Object.keys(x.items)));
  const smelted = new Set([...smelt(y), ...smelt(t)]);
  const slow = (xs: CraftScreen[] | undefined) => {
    const s = (xs ?? []).reduce<CraftScreen | null>(
      (m, x) => (!m || x.secs > m.secs ? x : m),
      null,
    );
    return s ? `${fmtDur(s.secs)} at ${fmtClock(s.t0)}, ${listItems(s.items, 3, false)}` : "—";
  };
  const both = (label: string, f: (xs: CraftScreen[] | undefined) => string, first = false) =>
    h(
      "tr",
      { class: first ? "sum first" : "sum" },
      h("td", null, label),
      h("td", { colspan: 2 }, f(y)),
      h("td", { colspan: 2 }, f(t)),
    );
  return h(
    "table",
    { class: "plain trades-t crafts-t" },
    h(
      "tr",
      null,
      h("th", null, "Crafted"),
      h("th", { class: "you" }, "You"),
      h("th", null, "at"),
      h("th", { class: "them" }, theirName),
      h("th", null, "at"),
    ),
    items.map((it) =>
      h(
        "tr",
        null,
        h("td", null, cap(itemName(it)) + (smelted.has(it) ? " (smelted)" : "")),
        ...cell(my.get(it)),
        ...cell(mt.get(it)),
      ),
    ),
    both("Screens", (xs) => String(xs?.length ?? 0), true),
    both("Slowest", slow),
  );
}

/** Which settings switch a phase note falls under, from how it starts */
function noteKind(text: string): keyof Prefs {
  if (/\bdied\b|^death (reset|warp)|death reset|death warp/i.test(text)) {
    return "nDeaths";
  }
  if (/precraft/i.test(text)) {
    return "nPrecraft";
  }
  if (
    /^(trades|trades used|left on the ground|while trading|gold blocks|could have left)\b|extra trades|piglins angry/i.test(
      text,
    )
  ) {
    return "nTrading";
  }
  if (
    /^(wood|lava portal|ruined portal|buried treasure|shipwreck|iron golem|temple chests|iron pickaxe)\b|\bvillage\b/i.test(
      text,
    )
  ) {
    return "nOverworld";
  }
  if (
    /^(pearls to the fortress|blocks placed|pearl hang|blinded with|6 rods|blaze bed)\b/i.test(text)
  ) {
    return "nNether";
  }
  if (
    /^(eyes|in the stronghold|dragon|free the end|finished|first bed|last setup block)\b|^[^:]+: perch\b|\bin the stronghold:/i.test(
      text,
    )
  ) {
    return "nEnd";
  }
  return "nOther";
}

function phaseTable(p: Report, theirName: string, a: RaceAnalysis, P: Prefs) {
  if (p.phase === "Bastion" && P.tradesTable) {
    return tradesTable(a, theirName);
  }
  if (p.phase === "Overworld" && P.craftsTable) {
    return craftsTable(a, theirName);
  }
  return null;
}

/** What each player did in one phase */
function facts(p: Report, theirName: string, a: RaceAnalysis) {
  const P = prefs();
  const trades = phaseTable(p, theirName, a, P);
  // Lines that aren't "you vs them" read as a note under the row, from the left.
  const note = (t: string) => h("tr", { class: "f-sub f-note" }, h("td", { colspan: 5 }, cap(t)));
  const rows: HTMLElement[] = [];
  for (const w of P.costRows ? (p.why ?? []) : []) {
    const [first, ...rest] = w.text.split(" · ");
    const v = versus(first);
    rows.push(
      h(
        "tr",
        { class: "f-main" },
        h("td", null, callLabel(w.label, w.seconds)),
        h("td", null, v ? v.you : ""),
        h("td", null, v ? v.them : ""),
        h(
          "td",
          { class: changeCls(w.seconds) },
          Math.abs(w.seconds) < 0.5 ? "" : fmtDelta(w.seconds),
        ),
        h("td", { class: "dim" }, watch(w.at, theirName)),
      ),
    );
    if (!P.costDetail) {
      continue;
    }
    if (!v && first) {
      rows.push(note(first));
    }
    for (const part of rest) {
      const pv = versus(part);
      rows.push(
        pv
          ? h(
              "tr",
              { class: "f-sub" },
              h("td", null, pv.what),
              h("td", null, pv.you),
              h("td", null, pv.them),
              h("td"),
              h("td"),
            )
          : note(part),
      );
    }
  }
  // The trades table already shows the trade notes.
  const notes = (p.notes ?? []).filter(
    (n) =>
      !/^could have/i.test(n.text) &&
      !(trades && /^(Trades:|Left on the ground:)/.test(n.text)) &&
      P[noteKind(n.text)],
  );
  return h(
    "div",
    { class: "facts" },
    p.unfinished ? h("div", { class: "dim" }, "Your run ended in this phase.") : null,
    p.theirsEnded ? h("div", { class: "dim" }, `${theirName}'s run ended in this phase.`) : null,
    rows.length
      ? h(
          "table",
          { class: `plain facts-t ${P.colWatch ? "" : "no-watch"}` },
          h(
            "tr",
            null,
            h("th", null, ""),
            h("th", { class: "you" }, "You"),
            h("th", { class: "them" }, theirName),
            h("th", null, "Cost"),
            h("th", null, "Watch at"),
          ),
          rows,
        )
      : null,
    trades,
    notes.length
      ? h(
          "ul",
          { class: "facts-notes" },
          notes.map((n) =>
            h(
              "li",
              null,
              h("span", null, n.text.replace(/ · /g, ", ")),
              h("span", { class: "dim" }, watch(n.at, theirName)),
            ),
          ),
        )
      : null,
    P.playByPlay === "hidden" ? null : playByPlay(p, theirName),
  );
}

type Split = RaceAnalysis["splits"][number];

/** Split time in seconds, yours or else theirs */
const splitSec = (sp: Split) => (sp.you ?? sp.them ?? 0) / 20;

function unreachedTitle(unreached: Split[], theirName: string) {
  if (unreached.every((x) => x.you !== null)) {
    return "Only you reached";
  }
  if (unreached.every((x) => x.them !== null)) {
    return `Only ${theirName} reached`;
  }
  return "Only one of you reached";
}

function splitsTable(
  a: RaceAnalysis,
  id: number,
  seedType: string | null,
  selected: string | null,
  select: (phase: string | null) => void,
) {
  const { segments } = buildDeltaModel(a);
  const byName = new Map(a.splits.map((s) => [s.name, s]));
  const groups: { phase: string; segs: typeof segments }[] = [];
  for (const s of segments) {
    const phase = s.reportPhase ?? s.segLabel;
    const last = groups.at(-1);
    if (last?.phase === phase) {
      last.segs.push(s);
    } else {
      groups.push({ phase, segs: [s] });
    }
  }
  const used = new Set(segments.map((s) => s.splitName));
  const unreached = a.splits.filter(
    (s) => !used.has(s.name) && (s.you === null || s.them === null),
  );
  const t = (ticks: number | null) => (ticks === null ? "—" : fmtClock(ticks));
  const P = prefs();

  const body: HTMLElement[] = [];
  for (const grp of groups) {
    const p = a.report?.find((r) => r.phase === grp.phase);
    const on = grp.phase === selected;
    body.push(
      h(
        "tr",
        {
          class: `grp ${on ? "on" : ""}`,
          "data-grp": grp.phase,
          "data-t": grp.segs[0].you0,
          "data-name": grp.phase,
          onclick: () => select(on ? null : grp.phase),
        },
        h(
          "td",
          null,
          h(
            "span",
            { class: "grp-name" },
            h("span", { class: "caret" }, on ? "▾" : "▸"),
            ...phaseIconKeys(grp.phase, seedType).map((k) => structIcon(k)),
            grp.phase,
          ),
        ),
        h("td", { class: "dim" }, p?.you != null ? clockSec(p.you) : ""),
        h("td", { class: "dim" }, p?.them != null ? clockSec(p.them) : ""),
        h(
          "td",
          { class: changeCls(p?.change ?? null) },
          p?.change != null && (grp.segs.length > 1 || !P.splitRows) ? signed(p.change) : "",
        ),
        // Without split rows, the gap at the end of the phase goes on the phase row.
        P.splitRows
          ? h("td")
          : h("td", { class: changeCls(grp.segs.at(-1)!.gap1) }, signed(grp.segs.at(-1)!.gap1)),
      ),
    );
    for (const s of P.splitRows ? grp.segs : []) {
      const sp = byName.get(s.splitName);
      if (!sp) {
        continue;
      }
      body.push(
        h(
          "tr",
          { class: "split", "data-t": splitSec(sp), "data-name": s.splitName },
          h("td", null, s.splitName),
          h("td", null, t(sp.you)),
          h("td", null, t(sp.them)),
          h("td", { class: changeCls(s.segDelta) }, signed(s.segDelta)),
          h("td", { class: changeCls(s.gap1) }, signed(s.gap1)),
        ),
      );
    }
    // Quick races built from Ranked's splits have no play-by-play or reasons to show.
    if (on && p && !a.quick) {
      body.push(h("tr", { class: "facts-row" }, h("td", { colspan: 5 }, facts(p, a.them.name, a))));
    }
  }
  if (unreached.length && P.unreached) {
    body.push(
      h(
        "tr",
        { class: "grp off" },
        h("td", { colspan: 5 }, unreachedTitle(unreached, a.them.name)),
      ),
    );
    for (const sp of unreached) {
      body.push(
        h(
          "tr",
          { class: "split off", "data-t": splitSec(sp) },
          h("td", null, sp.name),
          h("td", null, t(sp.you)),
          h("td", null, t(sp.them)),
          h("td"),
          h("td"),
        ),
      );
    }
  }
  return h(
    "table",
    {
      class: `plain splits2 ${P.colDelta ? "" : "no-delta"} ${P.colGap ? "" : "no-gap"}`,
      "data-race": id,
    },
    h(
      "tr",
      null,
      h("th", null, "Split"),
      h("th", { class: "you" }, "You"),
      h("th", { class: "them" }, a.them.name),
      h("th", { title: "Time lost (+) or gained (−) on this split" }, "±"),
      h("th", { title: "Total lead (−) or deficit (+)" }, "Gap"),
    ),
    body,
  );
}

/** The ⋯ menu with every action on the race. The keys from settings still work as shortcuts. */
function actionsMenu(row: RaceRow, id: number, rerender: () => void) {
  const watchIt = () => void openInMinecraft(row.race_file!);
  const companion = () => g.companion(id);
  const keys = prefs();
  if (row.race_file && keys.keyWatch) {
    bindKey(keys.keyWatch, watchIt);
  }
  if (keys.keyCompanion) {
    bindKey(keys.keyCompanion, companion);
  }
  const remove = async () => {
    if (!confirm(`Remove the game vs ${row.their_name}? The replay files stay.`)) {
      return;
    }
    forgetRace(id);
    gone.add(id);
    await g.deleteRace(id);
    rerender();
  };
  const item = (label: string, fn: () => void, key?: string, cls = "") =>
    h(
      "button",
      {
        class: cls,
        onclick: (e: Event) => {
          (e.currentTarget as HTMLElement).closest("details")!.open = false;
          fn();
        },
      },
      label,
      key ? h("span", { class: "kbd" }, key) : null,
    );
  return h(
    "details",
    { class: "menu" },
    h("summary", { class: "btn ghost", title: "Watch, companion, file" }, "⋯"),
    h(
      "div",
      { class: "menu-list" },
      row.race_file
        ? item(
            isWeb ? "Download mixed replay" : "Watch in Ranked",
            watchIt,
            keys.keyWatch.toUpperCase() || undefined,
          )
        : null,
      isWeb ? null : item("Companion", companion, keys.keyCompanion.toUpperCase() || undefined),
      row.race_file && !isWeb ? item("Show file", () => g.reveal(row.race_file!)) : null,
      item("Remove", remove, undefined, "bad"),
    ),
  );
}

function raceHeader(
  a: RaceAnalysis,
  row: RaceRow,
  yourElo: number | null,
  where: string,
  actions: HTMLElement,
) {
  const who = (p: RaceAnalysis["you"], elo: number | null | undefined, side: "you" | "them") =>
    h(
      "span",
      { class: `race-who ${side}`, title: runLine(p) },
      head({ uuid: p.uuid, name: p.name }, 22),
      h("span", { class: side }, p.name),
      rank(elo),
    );
  let gapTitle = "even at the end";
  if (a.finalGap > 0.5) {
    gapTitle = "behind at the end";
  } else if (a.finalGap < -0.5) {
    gapTitle = "ahead at the end";
  }
  return h(
    "div",
    { class: "race-head" },
    h(
      "div",
      { class: "race-vs" },
      who(a.you, a.you.elo ?? yourElo, "you"),
      h(
        "span",
        { class: `race-gap ${deltaClass(a.finalGap)}`, title: gapTitle },
        fmtDelta(a.finalGap),
      ),
      who(a.them, a.them.elo ?? row.their_elo, "them"),
      h("span", { class: "dim" }, where),
    ),
    actions,
  );
}

/** For races built from Ranked's splits, what is missing and whether the full race is still coming */
function quickNotice(a: RaceAnalysis) {
  if (!a.quick) {
    return null;
  }
  return h(
    "div",
    { class: "notice" },
    h(
      "span",
      null,
      a.quick.ironPick
        ? "Splits from Ranked's API only. When Ranked saves your replay, this becomes the merged replay with a per-phase breakdown."
        : "Splits from Ranked only. You reset before getting an iron pickaxe, so Ranked didn't save a replay of this run.",
    ),
  );
}

function seedPanel(a: RaceAnalysis) {
  if (!a.seed?.overworld) {
    return null;
  }
  return panel(
    null,
    null,
    h("div", { class: "p-head" }, h("h2", null, "Seed")),
    h(
      "div",
      { class: "seeds" },
      copyField("World", String(a.seed.overworld)),
      a.seed.nether ? copyField("Nether", String(a.seed.nether)) : null,
    ),
  );
}

/** The race's chart and strip, kept across redraws of the same analysis so the graph keeps its
 * zoom, hover and layers */
function keepChart(a: RaceAnalysis, seedType: string | null, selected: string | null) {
  if (keptChart?.a === a) {
    return keptChart;
  }
  keptChart?.chart.dispose();
  keptChart?.strip.dispose();
  keptChart?.ro?.disconnect();
  keptChart = {
    a,
    chart: gapChart(a, { seedType, selected, onSelect: (p) => keptChart?.pick(p) }),
    strip: gapStrip(a, { seedType, selected, onPick: (t) => keptChart?.jump(t) }),
    pick: () => {},
    jump: () => {},
  };
  return keptChart;
}

export function raceView(id: number, rerender: () => void, yourElo: number | null = null) {
  const r = cache.get(id);
  if (!r && gone.has(id)) {
    return h(
      "div",
      { class: "page" },
      h("div", { class: "empty" }, "This game isn't there anymore."),
    );
  }
  if (!r) {
    void loadRace(id).then(rerender);
    return h("div", { class: "page" }, h("div", { class: "empty" }, "Loading game"));
  }
  const { row, analysis: a } = r;
  const isRace = row.your_file !== row.their_file;
  const actions = actionsMenu(row, id, rerender);
  const where = [isRace ? null : "Ranked match", seedText(row.seed_type), day(row.created_at)]
    .filter(Boolean)
    .join(", ");
  if (!a) {
    return h(
      "div",
      { class: "page" },
      h("div", { class: "race-head" }, h("span", { class: "dim" }, where), actions),
      h("div", { class: "notice bad" }, row.error ?? "This game couldn't be analysed."),
    );
  }

  if (openRace?.race !== id) {
    noteRaceOpened();
    // A race you won cheers once, the first time it opens.
    if (a.finalGap < -0.5 && !cheered.has(id)) {
      cheered.add(id);
      requestAnimationFrame(() => celebrate());
    }
    const worst = [...(a.report ?? [])]
      .filter((p) => p.change !== null && !p.unfinished)
      .sort((x, y) => y.change! - x.change!)[0];
    openRace = { race: id, phase: worst && worst.change! > 0 ? worst.phase : null };
  }
  const tableFor = (phase: string | null) =>
    splitsTable(a, id, row.seed_type, phase, (p) => pickPhase(p, true));
  // Picking a phase only redraws the table, so the graph can animate to it.
  let table = tableFor(openRace.phase);
  const tablePanel = panel(null, null, table);
  const kept = keepChart(a, row.seed_type, openRace.phase);
  const { chart, strip } = kept;
  kept.pick = (p) => pickPhase(p, false);
  function pickPhase(phase: string | null, fromTable: boolean) {
    openRace = { race: id, phase };
    const next = tableFor(phase);
    table.replaceWith(next);
    table = next;
    if (fromTable) {
      chart.select(phase);
    }
    strip.mark(phase);
    // Only table clicks scroll the row into view, so picking from the graph doesn't scroll.
    if (phase && fromTable) {
      requestAnimationFrame(() =>
        next
          .querySelector(`tr[data-grp="${CSS.escape(phase)}"]`)
          ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
      );
    }
  }
  const header = raceHeader(a, row, yourElo, where, actions);
  const chartPanel = panel(null, { cls: "race-graph" }, header, chart, strip);
  const page = h(
    "div",
    { class: "page race-page" },
    quickNotice(a),
    chartPanel,
    tablePanel,
    seedPanel(a),
  );
  foldOnScroll({ page, chartPanel, header, tablePanel, kept });
  return page;
}

/** Scrolling into the splits folds the graph into a strip at the top. The panel is sticky with a
 * negative top, so layout never changes. Positions follow the scroll exactly, and the fold look
 * runs on a spring so it doesn't step per wheel notch. Once folded, the strip's playhead follows
 * the split row being read. */
function foldOnScroll(parts: {
  page: HTMLElement;
  chartPanel: HTMLElement;
  header: HTMLElement;
  tablePanel: HTMLElement;
  kept: NonNullable<typeof keptChart>;
}) {
  const { page, chartPanel, header, tablePanel, kept } = parts;
  const { chart, strip } = kept;
  const plot = chart.querySelector<HTMLElement>(".gap-plot")!;
  let layout = { travel: 0, plotTop: 0, plotH: 1, stripTop: 0 };
  /** Scroll progress through the fold, 0 to 1 */
  let scrolled = 0;
  let hovered: number | null = null;
  /** Spring position chasing scrolled, and its speed */
  let folded = 0;
  let foldSpeed = 0;
  /** Where the strip's playhead is drawn, gliding toward playTo */
  let playAt: number | null = null;
  let playTo: number | null = null;
  let playNote = "";
  let raf = 0;
  let lastFrame = 0;
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  const ease = (x: number) => x * x * (3 - 2 * x);
  const measure = () => {
    const geom = chart.geom();
    if (!geom || !chartPanel.isConnected) {
      return;
    }
    const saved = plot.style.transform;
    plot.style.transform = "";
    const pr = chartPanel.getBoundingClientRect();
    const r = plot.getBoundingClientRect();
    plot.style.transform = saved;
    const headH = header.offsetHeight + 8;
    const stripH = 14 + headH + STRIP_H + 10;
    const travel = Math.max(0, chartPanel.offsetHeight - stripH);
    layout = {
      travel,
      plotTop: r.top - pr.top + geom.top,
      plotH: Math.max(1, geom.bot - geom.top),
      stripTop: 14 + headH,
    };
    chartPanel.style.top = `${-travel}px`;
    strip.style.cssText = `left:${(r.left - pr.left).toFixed(1)}px;width:${r.width.toFixed(1)}px;top:${layout.stripTop}px`;
    plot.style.transformOrigin = `0 ${geom.top}px`;
    apply();
  };
  const apply = () => {
    // The slide keeps pinned parts in place while the panel scrolls under them.
    const slide = scrolled * layout.travel;
    header.style.transform = scrolled ? `translateY(${slide.toFixed(1)}px)` : "";
    // The plot folds onto the strip's curve, which uses the same scale and axis so it lands exactly on top.
    const f = clamp(folded);
    const target = layout.stripTop + strip.plotTop;
    const curveTop = layout.plotTop + slide + f * (target - layout.plotTop);
    const curveH = layout.plotH + f * (strip.plotH - layout.plotH);
    plot.style.transform =
      slide || f > 0.001
        ? `translateY(${(curveTop - layout.plotTop).toFixed(1)}px) scaleY(${(curveH / layout.plotH).toFixed(4)})`
        : "";
    const handOff = ease(clamp((folded - 0.5) / 0.4));
    chartPanel.style.setProperty("--k", folded.toFixed(3));
    chartPanel.style.setProperty("--detail", (1 - clamp(folded * 2.6)).toFixed(3));
    chartPanel.style.setProperty("--curve", (1 - handOff).toFixed(3));
    chartPanel.style.setProperty("--chrome", (1 - clamp(folded * 3.2)).toFixed(3));
    strip.style.opacity = handOff.toFixed(3);
    strip.style.transform = `translateY(${(curveTop - target).toFixed(1)}px)`;
    strip.fold(curveH / strip.plotH);
    chartPanel.classList.toggle("shrunk", folded > 0.02);
    chartPanel.classList.toggle("strip-on", handOff > 0.9);
  };
  const snap = () => {
    folded = scrolled;
    playAt = playTo;
    apply();
    strip.at(playAt, playNote);
  };
  /** One frame of the critically damped spring, which never overshoots, plus the playhead glide */
  const frame = (now: number) => {
    const dt = Math.min(1 / 30, lastFrame ? (now - lastFrame) / 1000 : 1 / 60);
    lastFrame = now;
    const stiffness = 24;
    foldSpeed += (stiffness * stiffness * (scrolled - folded) - 2 * stiffness * foldSpeed) * dt;
    folded += foldSpeed * dt;
    if (playTo !== null && playAt !== null) {
      playAt += (playTo - playAt) * (1 - Math.exp(-dt * 16));
    }
    const springDone = Math.abs(scrolled - folded) < 0.0005 && Math.abs(foldSpeed) < 0.002;
    const glideDone =
      playAt === playTo || (playAt !== null && playTo !== null && Math.abs(playTo - playAt) < 0.02);
    if (springDone) {
      folded = scrolled;
      foldSpeed = 0;
    }
    if (glideDone) {
      playAt = playTo;
    }
    apply();
    strip.at(playAt, playNote);
    raf = springDone && glideDone ? 0 : requestAnimationFrame(frame);
  };
  const kick = () => {
    if (still()) {
      snap();
      return;
    }
    if (!raf) {
      lastFrame = 0;
      raf = requestAnimationFrame(frame);
    }
  };
  const aim = (sec: number | null, what = "") => {
    playNote = what;
    // The playhead jumps without gliding when it appears or hides.
    if (sec === null || playAt === null) {
      playAt = sec;
    }
    playTo = sec;
  };
  /** Playhead time at the split row under the strip, between rows by how far it's scrolled */
  const rowTimeAt = (rows: HTMLElement[], ref: number) => {
    for (let i = 0; i < rows.length; i++) {
      const ra = rows[i].getBoundingClientRect();
      const rb = rows[i + 1]?.getBoundingClientRect();
      if (ra.top <= ref && (!rb || rb.top > ref)) {
        const t0 = Number(rows[i].dataset.t);
        const t1 = rows[i + 1] ? Number(rows[i + 1].dataset.t) : t0;
        const between = rb ? Math.min(1, (ref - ra.top) / Math.max(1, rb.top - ra.top)) : 0;
        return { at: t0 + (t1 - t0) * between, name: rows[i].dataset.name ?? "" };
      }
    }
    return { at: Number(rows[0].dataset.t), name: rows[0].dataset.name ?? "" };
  };
  const follow = () => {
    const main = page.closest("main");
    if (!main) {
      return;
    }
    // The panel box never moves, only its contents, so this is how far it scrolled past the top.
    const d = main.getBoundingClientRect().top - chartPanel.getBoundingClientRect().top;
    scrolled = layout.travel ? clamp(d / layout.travel) : 0;
    // Positions update at once so nothing lags the scroll, and the look catches up on the spring.
    apply();
    if (scrolled < 0.6) {
      aim(null);
      chart.setPlayhead(hovered);
      kick();
      return;
    }
    chart.setPlayhead(null);
    const rows = [...tablePanel.querySelectorAll<HTMLElement>("tr[data-t]")];
    if (hovered !== null) {
      const tr = rows.find((x) => Number(x.dataset.t) === hovered);
      aim(hovered, tr?.dataset.name ?? "");
      kick();
      return;
    }
    const ref = chartPanel.getBoundingClientRect().bottom + 6;
    const inSplits = rows[0] && rows[0].getBoundingClientRect().top <= ref;
    if (!inSplits) {
      aim(null);
      kick();
      return;
    }
    const { at, name } = rowTimeAt(rows, ref);
    aim(at, name);
    kick();
  };
  // Clicking the strip scrolls the table to the split at that time and flashes it.
  kept.jump = (sec) => {
    const main = page.closest("main");
    const rows = [...tablePanel.querySelectorAll<HTMLElement>("tr.split[data-t]")].filter(
      (x) => x.offsetParent,
    );
    if (!main || !rows.length) {
      return;
    }
    const tr = rows.reduce(
      (best, x) =>
        Math.abs(Number(x.dataset.t) - sec) < Math.abs(Number(best.dataset.t) - sec) ? x : best,
      rows[0],
    );
    const pinnedStripBottom = layout.stripTop + STRIP_H + 10 + 6;
    main.scrollBy({
      top: tr.getBoundingClientRect().top - main.getBoundingClientRect().top - pinnedStripBottom,
      behavior: still() ? "auto" : "smooth",
    });
    tr.classList.remove("flash");
    void tr.offsetWidth;
    tr.classList.add("flash");
  };
  tablePanel.addEventListener("mouseover", (e) => {
    const tr = (e.target as HTMLElement).closest<HTMLElement>("tr[data-t]");
    const val = tr ? Number(tr.dataset.t) : null;
    if (val !== hovered) {
      hovered = val;
      follow();
    }
  });
  tablePanel.addEventListener("mouseleave", () => {
    hovered = null;
    follow();
  });
  setTimeout(() => {
    const main = page.closest("main");
    if (!main) {
      return;
    }
    const onScroll = () => {
      if (!page.isConnected) {
        main.removeEventListener("scroll", onScroll);
        cancelAnimationFrame(raf);
        return;
      }
      follow();
    };
    main.addEventListener("scroll", onScroll, { passive: true });
    // Zoom or layer changes resize the graph, and there is one observer per chart, not per redraw.
    kept.ro?.disconnect();
    kept.ro = new ResizeObserver(() => {
      measure();
      follow();
    });
    kept.ro.observe(chart);
    measure();
    follow();
    // A redraw mid-page starts already folded.
    foldSpeed = 0;
    snap();
  });
}
