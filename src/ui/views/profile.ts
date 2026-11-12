import type {
  EloPoint,
  ProfileData,
  ProfileMatch,
  SplitSegmentStat,
} from "../../core/profile/types";
import { g, type AppState } from "../bridge";
import { deltaClass, fmtDelta, h, toast } from "../dom";
import { btn, head, panel, rank } from "../parts";
import { structIcon } from "../ranked";
import { seedText } from "./races";

const NS = "http://www.w3.org/2000/svg";
type Mode = "split" | "segment";
const POOLS = [25, 50, 100];
const RANGE_NAME = "Near you";
const MISSING = "—";
const MATCHES_FOLDED = 8;
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* Storage is blocked, so the choice lasts only for this session. */
    }
  },
};

let pool = Number(store.get("profile.pool")) || 50;
let mode: Mode = store.get("profile.mode") === "split" ? "split" : "segment";
let season: number | undefined;
let showAll = false;
let data: ProfileData | null = null;
let dataKey: string | null = null;
let loading = false;
let refreshing = false;
let error: string | null = null;
let redrawSplits = () => {};

export function forgetProfile(): void {
  data = null;
  dataKey = null;
  error = null;
  loading = false;
}

const NAME: Record<string, string> = {
  nether: "Nether",
  bastion: "Bastion",
  fortress: "Fortress",
  blind: "Blind",
  eye: "Stronghold",
  end: "End",
  finish: "Finish",
};
const ICON: Record<string, string> = {
  nether: "nether",
  bastion: "bastion",
  fortress: "fortress",
  blind: "portal",
  eye: "stronghold",
  end: "end",
  finish: "dragon",
};
const clock = (ms: number | null) => {
  if (ms === null) {
    return MISSING;
  }
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const gap = (a: number | null, b: number | null) =>
  a === null || b === null ? null : (a - b) / 1000;
const signed = (n: number) => `${n > 0 ? "+" : ""}${n}`;
const gapCell = (seconds: number | null) =>
  seconds === null
    ? h("td", { class: "dim" }, MISSING)
    : h("td", { class: deltaClass(seconds) }, fmtDelta(seconds));
const recentMatches = (d: ProfileData) =>
  [...d.matches].sort((a, b) => b.date - a.date).slice(0, pool);

interface Row {
  key: string;
  label: string;
  icon: string;
  you: number | null;
  range: number | null;
  next: number | null;
  pct: number | null;
  npct: number | null;
}

function rows(segs: SplitSegmentStat[]): Row[] {
  return segs.map((s, i) =>
    mode === "split"
      ? {
          key: s.key,
          label: NAME[s.key] ?? s.label,
          icon: ICON[s.key],
          you: s.medianMs,
          range: s.bandMedianMs,
          next: s.targetMs,
          pct: s.bandPercentile,
          npct: s.targetPercentile,
        }
      : {
          key: s.key,
          label: i === 0 ? "Overworld" : `To ${(NAME[s.key] ?? s.label).toLowerCase()}`,
          icon: i === 0 ? "village" : ICON[s.key],
          you: s.segmentMedianMs,
          range: s.segment.bandMedianMs,
          next: s.segment.targetMs,
          pct: s.segment.percentile,
          npct: s.segment.targetPercentile,
        },
  );
}

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  text?: string,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    e.setAttribute(k, String(v));
  }
  if (text !== undefined) {
    e.textContent = text;
  }
  return e;
}

/** One spoke per split. Further out = faster than more of your Elo range, middle ring is the median */
function radar(
  R: Row[],
  hot: number,
  setHot: (i: number) => void,
  rangeName: string,
  nextName: string | null,
) {
  const W = 540;
  const H = 396;
  const cx = 270;
  const cy = 196;
  const rad = 132;
  const n = R.length;
  const svg = el("svg", {
    class: "pf-radar",
    viewBox: `0 0 ${W} ${H}`,
    role: "img",
    "aria-label": `Your splits against ${rangeName}`,
  });
  const ang = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i: number, v: number) => [
    cx + (Math.cos(ang(i)) * (rad * v)) / 100,
    cy + (Math.sin(ang(i)) * (rad * v)) / 100,
  ];
  const polygon = (values: number[]) =>
    values
      .map((v, i) => {
        const [x, y] = pt(i, v);
        return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join("") + "Z";
  const ringClass = (v: number) => {
    if (v === 50) {
      return "ring mid";
    }
    return v === 100 ? "ring edge" : "ring";
  };
  for (const v of [25, 50, 75, 100]) {
    svg.appendChild(el("path", { d: polygon(R.map(() => v)), class: ringClass(v) }));
  }
  R.forEach((r, i) => {
    const [ex, ey] = pt(i, 100);
    const [lx, ly] = pt(i, 118);
    svg.appendChild(
      el("line", { x1: cx, y1: cy, x2: ex, y2: ey, class: i === hot ? "spoke on" : "spoke" }),
    );
    const anchor = Math.abs(lx - cx) < 10 ? "middle" : lx > cx ? "start" : "end";
    const icon = structIcon(r.icon);
    if (icon) {
      const fo = el("foreignObject", {
        x: anchor === "middle" ? lx - 8 : anchor === "start" ? lx : lx - 16,
        y: ly - 22,
        width: 16,
        height: 16,
      });
      fo.appendChild(icon);
      svg.appendChild(fo);
    }
    const name = el(
      "text",
      {
        x: lx,
        y: ly + 6,
        "text-anchor": anchor,
        class: i === hot ? "spoke-name on" : "spoke-name",
      },
      r.pct === null ? `${r.label} (no data)` : `${r.label} `,
    );
    if (r.pct !== null && r.you !== null) {
      name.appendChild(el("tspan", { class: "spoke-time" }, clock(r.you)));
    }
    svg.appendChild(name);
  });
  const shape = (key: "pct" | "npct") => polygon(R.map((r) => r[key] ?? 0));
  if (nextName && R.some((r) => r.npct !== null)) {
    svg.appendChild(el("path", { d: shape("npct"), class: "shape next" }));
  }
  svg.appendChild(el("path", { d: shape("pct"), class: "shape you" }));
  R.forEach((r, i) => {
    if (r.pct === null) {
      return;
    }
    const [x, y] = pt(i, r.pct);
    const sz = i === hot ? 10 : 7;
    svg.appendChild(
      el("rect", { x: x - sz / 2, y: y - sz / 2, width: sz, height: sz, class: "dot" }),
    );
    const [px, py] = pt(i, Math.min(100, r.pct + 14));
    svg.appendChild(
      el(
        "text",
        { x: px, y: py + 4, "text-anchor": "middle", class: i === hot ? "pct on" : "pct" },
        i === hot ? `faster than ${r.pct}%` : `${r.pct}%`,
      ),
    );
  });
  R.forEach((_, i) => {
    const a0 = ang(i) - Math.PI / n;
    const a1 = ang(i) + Math.PI / n;
    const big = rad * 1.25;
    const w = el("path", {
      d: `M${cx} ${cy}L${cx + Math.cos(a0) * big} ${cy + Math.sin(a0) * big}L${cx + Math.cos(a1) * big} ${cy + Math.sin(a1) * big}Z`,
      fill: "transparent",
    });
    w.addEventListener("mouseenter", () => setHot(i));
    w.addEventListener("mouseleave", () => setHot(-1));
    svg.appendChild(w);
  });
  return svg;
}

function splitsPanel(d: ProfileData) {
  const sp = d.splits;
  const nextName = sp.nextRankName;
  const has = sp.segments.some((s) => s.medianMs !== null);
  const header = h(
    "div",
    { class: "p-head" },
    h("h2", null, "Your splits against players near your Elo"),
    h(
      "span",
      { class: "dim" },
      `${sp.band[0]} to ${sp.band[1]} Elo, ${sp.bandSampleCount.toLocaleString()} of their games, ${sp.analyzedMatches} of yours`,
    ),
    h(
      "div",
      { class: "seg pf-mode" },
      (
        [
          ["split", "At each split"],
          ["segment", "Per segment"],
        ] as [Mode, string][]
      ).map(([m, label]) =>
        h(
          "button",
          {
            class: mode === m ? "on" : "",
            onclick: () => {
              mode = m;
              store.set("profile.mode", m);
              redrawSplits();
            },
          },
          label,
        ),
      ),
    ),
  );
  if (!has || sp.bandSampleCount === 0) {
    return panel(
      null,
      null,
      header,
      h(
        "p",
        { class: "dim", style: "margin:0" },
        !has
          ? "None of these matches have split times yet. Refresh once the match timelines have loaded."
          : "The match index has no games in your Elo range yet. It fills in as Stratas scans matches.",
      ),
    );
  }
  const radarBox = h("div", { class: "pf-radar-box" });
  const tbody = h("tbody");
  let hot = -1;
  const draw = () => {
    const R = rows(sp.segments);
    radarBox.replaceChildren(radar(R, hot, setHot, RANGE_NAME, nextName));
    tbody.replaceChildren(
      ...R.map((r, i) =>
        h(
          "tr",
          {
            class: i === hot ? "on" : "",
            onmouseenter: () => setHot(i),
            onmouseleave: () => setHot(-1),
          },
          h("td", null, h("span", { class: "who-sm" }, structIcon(r.icon), r.label)),
          h("td", { class: "you" }, clock(r.you)),
          h("td", { class: "them" }, clock(r.range)),
          gapCell(gap(r.you, r.range)),
          nextName ? h("td", { class: "pf-next" }, clock(r.next)) : null,
          nextName ? gapCell(gap(r.you, r.next)) : null,
        ),
      ),
    );
  };
  function setHot(i: number) {
    if (i !== hot) {
      hot = i;
      draw();
    }
  }
  draw();
  return panel(
    null,
    { cls: "pf-splits" },
    header,
    h(
      "div",
      { class: "pf-splits-grid" },
      radarBox,
      h(
        "div",
        null,
        h(
          "table",
          { class: "plain pf-table" },
          h(
            "thead",
            null,
            h(
              "tr",
              null,
              h("th", null, mode === "split" ? "Split" : "Segment"),
              h("th", { class: "you" }, "You"),
              h("th", { class: "them" }, RANGE_NAME),
              h("th", null, "Gap"),
              nextName ? h("th", { class: "pf-next" }, nextName) : null,
              nextName ? h("th", null, "To go") : null,
            ),
          ),
          tbody,
        ),
        h(
          "div",
          { class: "pf-legend" },
          h("span", null, h("i", { class: "you" }), "You"),
          h("span", null, h("i", { class: "them" }), "Median near your Elo"),
          nextName ? h("span", null, h("i", { class: "pf-next" }), `${nextName} median`) : null,
        ),
      ),
    ),
  );
}

function eloLine(points: EloPoint[]) {
  if (points.length < 2) {
    return h("p", { class: "dim", style: "margin:0" }, "Not enough games for an Elo line yet.");
  }
  const elos = points.map((p) => p.elo);
  const lo = Math.min(...elos) - 8;
  const hi = Math.max(...elos) + 8;
  const W = 440;
  const H = 120;
  const X = (i: number) => 40 + (i / (points.length - 1)) * (W - 46);
  const Y = (e: number) => 8 + ((hi - e) / (hi - lo)) * (H - 26);
  const line = points
    .map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(p.elo).toFixed(1)}`)
    .join("");
  const svg = el("svg", { class: "pf-elo", viewBox: `0 0 ${W} ${H}` });
  const round = Math.round((lo + hi) / 2 / 50) * 50;
  if (round > lo && round < hi) {
    svg.appendChild(el("line", { x1: 40, x2: W, y1: Y(round), y2: Y(round), class: "grid" }));
    svg.appendChild(el("text", { x: 0, y: Y(round) + 4 }, String(round)));
  }
  svg.appendChild(
    el("path", {
      d: `${line}L${X(points.length - 1)} ${H - 18}L${X(0)} ${H - 18}Z`,
      class: "area",
    }),
  );
  svg.appendChild(el("path", { d: line, class: "line" }));
  const last = points.at(-1)!;
  svg.appendChild(
    el("rect", {
      x: X(points.length - 1) - 3,
      y: Y(last.elo) - 3,
      width: 6,
      height: 6,
      class: "end",
    }),
  );
  svg.appendChild(el("text", { x: 40, y: H - 3 }, `${points.length} games ago`));
  svg.appendChild(el("text", { x: W, y: H - 3, "text-anchor": "end" }, `now, ${last.elo}`));
  return svg;
}

function lastPanel(d: ProfileData) {
  const ms = recentMatches(d);
  const wins = ms.filter((m) => m.won === true).length;
  const losses = ms.filter((m) => m.won === false).length;
  const clean = ms.filter((m) => m.won === true && !m.forfeited && m.time > 0).map((m) => m.time);
  const elo = ms.reduce((s, m) => s + (m.change ?? 0), 0);
  const points = [...d.eloHistory].sort((a, b) => a.date - b.date).slice(-pool);
  const num = (k: string, v: string, cls = "") =>
    h("div", null, h("div", { class: "k" }, k), h("div", { class: `v ${cls}` }, v));
  return panel(
    null,
    null,
    h(
      "div",
      { class: "p-head" },
      h(
        "h2",
        null,
        ms.length
          ? `Last ${ms.length} match${ms.length === 1 ? "" : "es"}`
          : "No matches this season",
      ),
      points.length
        ? h("span", { class: "dim" }, `${points[0].elo} to ${points.at(-1)!.elo} Elo`)
        : null,
    ),
    h(
      "div",
      { class: "pf-nums" },
      num("Record", `${wins} W, ${losses} L`),
      num("Win rate", wins + losses ? `${Math.round((wins / (wins + losses)) * 100)}%` : "—"),
      num("Elo", signed(elo), elo > 0 ? "good" : elo < 0 ? "bad" : ""),
      num(
        "Average win",
        clock(clean.length ? clean.reduce((t, x) => t + x, 0) / clean.length : null),
      ),
      num("Best", clock(clean.length ? Math.min(...clean) : null)),
    ),
    eloLine(points),
  );
}

function matchRow(m: ProfileMatch, openRace: (id: number) => void) {
  const res = m.won === true ? ["w", "Won"] : m.won === false ? ["l", "Lost"] : ["d", "Draw"];
  const raceId = m.raceId;
  return h(
    "div",
    {
      class: `pf-match ${raceId !== null ? "click" : ""}`,
      onclick: raceId !== null ? () => openRace(raceId) : undefined,
      title: raceId !== null ? "Open the game" : undefined,
    },
    h("span", { class: `pf-res ${res[0]}` }, res[1]),
    head({ uuid: m.opponent.uuid, name: m.opponent.name }, 20),
    h(
      "span",
      { class: "pf-opp" },
      m.opponent.name,
      m.opponent.elo ? h("span", { class: "dim" }, ` ${m.opponent.elo}`) : null,
    ),
    h("span", { class: "dim pf-seed" }, seedText(m.seedType)),
    h("span", { class: "dim" }, m.forfeited ? "forfeit" : clock(m.time)),
    h(
      "span",
      { class: m.change ? deltaClass(-m.change) : "dim" },
      m.change ? signed(m.change) : "0",
    ),
  );
}

function matchesPanel(d: ProfileData, openRace: (id: number) => void, rerender: () => void) {
  const ms = recentMatches(d);
  const shown = showAll ? ms : ms.slice(0, MATCHES_FOLDED);
  return panel(
    null,
    null,
    h(
      "div",
      { class: "p-head" },
      h("h2", null, "Recent matches"),
      h("span", { class: "dim" }, "newest first"),
    ),
    shown.length
      ? shown.map((m) => matchRow(m, openRace))
      : h("p", { class: "dim", style: "margin:0" }, "No ranked matches this season yet."),
    ms.length > MATCHES_FOLDED
      ? h(
          "button",
          {
            class: "pf-more",
            onclick: () => {
              showAll = !showAll;
              rerender();
            },
          },
          showAll ? "Show fewer" : `All ${ms.length} matches`,
        )
      : null,
  );
}

function loadProfile(key: string, rerender: () => void) {
  loading = true;
  dataKey = key;
  error = null;
  void g
    .profile(season, pool)
    .then((res) => {
      data = res;
    })
    .catch((e) => {
      error = (e as Error).message;
      toast(`Couldn't load the profile: ${error}`);
    })
    .finally(() => {
      loading = false;
      rerender();
    });
}

export function profileView(
  s: AppState,
  openRace: (id: number) => void,
  rerender: () => void,
): HTMLElement {
  if (!s.settings.nickname && !s.settings.uuid) {
    return h(
      "div",
      { class: "page" },
      panel(
        null,
        null,
        h("div", { class: "p-head" }, h("h2", null, "No player set")),
        h(
          "p",
          { class: "dim", style: "margin:0" },
          "Set your Minecraft name in Settings to load your profile.",
        ),
      ),
    );
  }

  const player = (s.settings.uuid ?? s.settings.nickname)!;
  const key = `${player}|${season ?? "current"}|${pool}`;
  if (dataKey !== key && !loading) {
    loadProfile(key, rerender);
  }
  if (!data) {
    return h(
      "div",
      { class: "page" },
      panel(
        null,
        null,
        h(
          "p",
          { class: "dim", style: "margin:0" },
          loading
            ? "Loading your profile from MCSR Ranked…"
            : (error ?? "Couldn't load the profile."),
        ),
        !loading
          ? btn("Try again", () => {
              forgetProfile();
              rerender();
            })
          : null,
      ),
    );
  }

  const d = data;
  const u = d.user;
  const name = u?.nickname ?? s.settings.nickname ?? player;
  const peak =
    u?.season !== undefined ? (u.seasonResults[String(u.season)]?.highest ?? null) : null;
  const setPool = (n: number) => {
    pool = n;
    store.set("profile.pool", String(n));
    rerender();
  };
  const refresh = async () => {
    refreshing = true;
    rerender();
    try {
      data = await g.profileRefresh(season, pool);
      toast("Profile refreshed");
    } catch (e) {
      toast(`Couldn't refresh: ${(e as Error).message}`);
    }
    refreshing = false;
    rerender();
  };
  let splits = splitsPanel(d);
  redrawSplits = () => {
    const next = splitsPanel(d);
    splits.replaceWith(next);
    splits = next;
  };

  return h(
    "div",
    { class: "page pf" },
    panel(
      null,
      { cls: "pf-top" },
      h(
        "div",
        { class: "pf-id" },
        head({ uuid: u?.uuid ?? s.settings.uuid, name }, 64),
        h(
          "div",
          null,
          h("div", { class: "pf-name" }, name),
          h(
            "div",
            { class: "pf-sub" },
            rank(u?.elo ?? null),
            h("span", null, u?.rank.name ?? ""),
            h(
              "span",
              { class: "dim" },
              [u?.globalRank ? `#${u.globalRank}` : null, peak ? `season peak ${peak}` : null]
                .filter(Boolean)
                .join(", "),
            ),
          ),
        ),
      ),
      h(
        "div",
        { class: "pf-controls" },
        h(
          "div",
          { class: "seg" },
          POOLS.map((n) =>
            h("button", { class: pool === n ? "on" : "", onclick: () => setPool(n) }, `Last ${n}`),
          ),
        ),
        (u?.availableSeasons.length ?? 0) > 1
          ? h(
              "select",
              {
                id: "pf-season",
                class: "mini-select",
                onchange: (e: Event) => {
                  const v = (e.target as HTMLSelectElement).value;
                  season = v ? Number(v) : undefined;
                  rerender();
                },
              },
              h("option", { value: "", selected: season === undefined }, "This season"),
              u!.availableSeasons.map((n) =>
                h("option", { value: String(n), selected: season === n }, `Season ${n}`),
              ),
            )
          : null,
        btn(refreshing ? "Refreshing…" : "Refresh", () => void refresh(), {
          ghost: true,
          sm: true,
          disabled: refreshing,
        }),
      ),
    ),
    d.offline
      ? h("div", { class: "notice" }, "Offline, showing the profile saved last time.")
      : null,
    d.partial
      ? h(
          "div",
          { class: "notice" },
          "Some match timelines haven't loaded yet, so split times use fewer matches. Refresh to fetch the rest.",
        )
      : null,
    splits,
    h("div", { class: "pf-row" }, lastPanel(d), matchesPanel(d, openRace, rerender)),
  );
}
