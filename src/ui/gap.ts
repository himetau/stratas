import { buildDeltaModel } from "../core/detect/segments";
import type { RaceAnalysis } from "./bridge";
import { cap, clockSec, fmtDelta, h } from "./dom";
import { phaseIconKey, phaseIconKeys, structIcon } from "./ranked";
import { prefs, savePrefs, still } from "./prefs";
import type { Prefs } from "../core/prefs";
import type { CraftScreen } from "../core/detect/stats";
import { listItems } from "../core/detect/steps";

const NS = "http://www.w3.org/2000/svg";
const PAD_L = 64;
const PAD_R = 14;
const PLOT_H = 210;
const RAIL_H = 74;
const TICKS_PER_SEC = 20;

type Who = "you" | "them";

/** A phase's span on your clock (you0..you1) and on theirs (them0..them1). them0/them1 stretch
 * to cover their steps in the phase, and themFrom/themTo are their actual splits. */
interface PhaseBand {
  phase: string;
  you0: number;
  you1: number;
  them0: number;
  them1: number;
  themFrom: number;
  themTo: number;
  change: number | null;
  you: number | null;
  them: number | null;
}

/** Your span in each report phase, in play order */
function phaseBands(a: RaceAnalysis): PhaseBand[] {
  const out: PhaseBand[] = [];
  for (const s of buildDeltaModel(a).segments) {
    const name = s.reportPhase ?? s.segLabel;
    const last = out.at(-1);
    if (last && last.phase === name) {
      last.you1 = s.you1;
      last.them1 = Math.max(last.them1, s.them1);
      last.themTo = s.them1;
    } else {
      const p = a.report?.find((r) => r.phase === name);
      const st = p?.steps?.them ?? [];
      out.push({
        phase: name,
        you0: s.you0,
        you1: s.you1,
        them0: st.length ? Math.min(...st.map((x) => x.t0)) / TICKS_PER_SEC : s.them0,
        them1: st.length ? Math.max(s.them1, ...st.map((x) => x.t1 / TICKS_PER_SEC)) : s.them1,
        themFrom: s.them0,
        themTo: s.them1,
        change: p?.change ?? null,
        you: p?.you ?? null,
        them: p?.them ?? null,
      });
    }
  }
  return out;
}

const bandAt = (bands: PhaseBand[], sec: number) =>
  bands.find((b) => sec >= b.you0 && sec <= b.you1);

/** Last second either player reached, at least a minute */
function runEndSec(a: RaceAnalysis, curve: [number, number][]) {
  return Math.max(
    curve.at(-1)?.[0] ?? 60,
    a.you.endTicks / TICKS_PER_SEC,
    a.them.endTicks / TICKS_PER_SEC,
    60,
  );
}

function curvePath(curve: [number, number][], X: (s: number) => number, Y: (g: number) => number) {
  return curve.map(([s, v], i) => `${i ? "L" : "M"}${X(s).toFixed(1)} ${Y(v).toFixed(1)}`).join("");
}

/** Gap at any second, read off the curve */
function gapLookup(curve: [number, number][]) {
  return (sec: number) => {
    if (sec <= curve[0][0]) {
      return curve[0][1];
    }
    for (let i = 1; i < curve.length; i++) {
      const [x1, y1] = curve[i];
      if (sec <= x1) {
        const [x0, y0] = curve[i - 1];
        return x1 > x0 ? y0 + ((sec - x0) / (x1 - x0)) * (y1 - y0) : y1;
      }
    }
    return curve.at(-1)![1];
  };
}
/** Gap axis for a stretch of the run. The strip uses the same one so its curve lines up with the graph */
function gapRange(
  curve: [number, number][],
  gapAt: (s: number) => number,
  x0: number,
  x1: number,
  roomy: number,
) {
  const gs = curve
    .filter((p) => p[0] >= x0 && p[0] <= x1)
    .map((p) => p[1])
    .concat([gapAt(x0), gapAt(x1), 0]);
  const lo = Math.min(...gs);
  const hi = Math.max(...gs);
  const step = [10, 15, 20, 30, 60, 90, 120, 180, 300].find((v) => v >= (hi - lo) / 3) ?? 300;
  return {
    step,
    gTop: Math.ceil((hi + (hi - lo) * (0.28 + roomy) + 1) / step) * step,
    gBot: Math.floor((lo - (hi - lo) * (0.2 + roomy * 2) - 1) / step) * step,
  };
}

/** Signed m:ss, "−0:31" for negative seconds */
const clock = (s: number) => {
  const a = Math.round(Math.abs(s));
  return `${s < 0 && a ? "−" : ""}${clockSec(a)}`;
};
/** Signed gap, "+12s" under a minute and "−1:05" above */
const short = (s: number) => {
  const r = Math.round(s);
  if (r === 0) {
    return "±0s";
  }
  const a = Math.abs(r);
  return `${r > 0 ? "+" : "−"}${a >= 60 ? clockSec(a) : `${a}s`}`;
};
const sentence = (t: string) => t.charAt(0) + t.slice(1).toLowerCase();
const tone = (g: number | null) => {
  if (g === null || Math.abs(g) < 0.5) {
    return "var(--text-dim)";
  }
  return g > 0 ? "var(--bad)" : "var(--good)";
};
const toneCls = (g: number) => (g > 0.5 ? "bad" : g < -0.5 ? "good" : "dim");
/** "0:31 behind", "0:08 ahead", "even" */
const gapText = (g: number) =>
  Math.abs(g) < 0.5 ? "even" : `${clock(Math.abs(g))} ${g > 0 ? "behind" : "ahead"}`;
const gapLabel = (g: number) => (Math.abs(g) < 0.5 ? "even" : fmtDelta(g));
let measureCtx: CanvasRenderingContext2D | null = null;
const textW = (t: string, size = 11) => {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) {
    return t.length * 7 + 4;
  }
  measureCtx.font = `${size}px ${getComputedStyle(document.documentElement).getPropertyValue("--font") || "monospace"}`;
  return measureCtx.measureText(t).width + 4;
};
/** Cut to fit a width, with an ellipsis. Empty if not even one letter fits */
const fitText = (t: string, w: number, size = 11) => {
  if (textW(t, size) <= w) {
    return t;
  }
  for (let n = t.length - 1; n > 0; n--) {
    const c = `${t.slice(0, n).trimEnd()}…`;
    if (textW(c, size) <= w) {
      return c;
    }
  }
  return "";
};
/** Analysis cost labels reworded the way runners say them */
export function callLabel(label: string, v: number): string {
  const l = label.replace(/ on the way$/, "");
  const rods = /^(\d+) rods?$/.exec(l);
  if (rods) {
    return `Getting ${rods[1]} rods`;
  }
  const named: Record<string, string> = {
    "First throw": "First trade",
    "After trading": "Leaving the bastion",
    Stronghold: "In the stronghold",
    Eyes: "Eye throws",
    Idle: "Standing still",
    "In a portal": "Portal waits",
    Death: "Dead",
    Distance: v > 0 ? "Longer route" : "Shorter route",
    "To blind": "Fortress to blind",
    Speed: v > 0 ? "Slower travel" : "Faster travel",
  };
  return named[l] ?? l;
}
const SHORT: Record<string, string> = {
  "Nether travel": "Nether",
  "Bastion to fortress": "To fortress",
  "Fortress to stronghold": "To stronghold",
  "Bastion to blind": "To blind",
  "After the bastion": "After bastion",
};
const SPLIT_SHORT: Record<string, string> = {
  "Entered the Nether": "Nether",
  "Entered Bastion": "Bastion",
  "Left the Bastion": "Left bastion",
  "Entered Fortress": "Fortress",
  "6 Blaze Rods": "6 rods",
  "Blind Travelled": "Blind",
  "Eye Spy": "Eye Spy",
  "Entered the End": "End",
  "Defeated the Dragon": "Dragon",
};
/** "2 beds", "1 bed, 1 TNT", "3 TNT" */
const blastsText = (bs: { what: "bed" | "tnt" }[]) => {
  const beds = bs.filter((b) => b.what === "bed").length;
  const tnt = bs.length - beds;
  return [beds ? `${beds} bed${beds > 1 ? "s" : ""}` : "", tnt ? `${tnt} TNT` : ""]
    .filter(Boolean)
    .join(", ");
};
/** Placement rank on the curve: higher ranks get placed after everything else, which goes in time order */
const PLACE_FIRST: Record<string, number> = { pearls: 1, blast: 1, kit: 2, craft: 2, owcraft: 2 };
/** Trade items named in the trade line's label and the bastion kit, the rest only in the detail */
const PICKED_LABEL: [string, string][] = [
  ["ender_pearl", "pearls"],
  ["obsidian", "obsidian"],
  ["string", "string"],
];
const PICKED_NAME: Record<string, string> = {
  ender_pearl: "pearls",
  obsidian: "obsidian",
  string: "string",
  crying_obsidian: "crying obsidian",
  fire_res: "fire res",
  fire_charge: "fire charges",
  glowstone_dust: "glowstone dust",
};
/** Precraft items worth naming on the line */
const PRECRAFT_NAME: Record<string, string> = {
  respawn_anchor: "anchor",
  bow: "bow",
  iron_axe: "iron axe",
  iron_sword: "iron sword",
  golden_pickaxe: "gold pick",
  ender_eye: "eye",
};
const PRECRAFT_SHORT: Record<string, string> = {
  bastion: "bastion precraft",
  fort: "fortress precraft",
  stronghold: "stronghold precraft",
};
/** Setting that turns each kind of moment on or off */
const KIND_PREF: Record<string, keyof Prefs> = {
  owcraft: "mOwCraft",
  trade: "mTrade",
  kit: "mKit",
  pearls: "mPearls",
  blaze: "mBlaze",
  blast: "mBlast",
  craft: "mCraft",
  portal: "mPortal",
  eyes: "mEyes",
  zero: "mZero",
  perch: "mPerch",
  kill: "mKill",
  done: "mDone",
  dead: "mDead",
};
const MOMENT_COLOR: Record<string, string> = {
  owcraft: "color-mix(in srgb, var(--accent) 60%, var(--text))",
  kit: "var(--warn)",
  craft: "var(--accent)",
  blast: "var(--bad)",
  pearls: "color-mix(in srgb, var(--them) 50%, var(--you))",
  perch: "var(--warn)",
  zero: "var(--warn)",
  kill: "var(--good)",
  done: "var(--text)",
  trade: "var(--warn)",
  dead: "var(--bad)",
  blaze: "color-mix(in srgb, var(--warn) 60%, var(--bad))",
  portal: "color-mix(in srgb, var(--accent) 55%, var(--them))",
  eyes: "var(--them)",
};

/** Kinds that show however short they are */
const ALWAYS_SHOWN_KINDS = ["dead", "zero", "perch", "craft", "owcraft", "pearls"];
/** Kinds whose curve label gets no quicker or slower comparison */
const UNCOMPARED_KINDS = ["perch", "zero", "craft", "owcraft"];

const PILL_NAME: Record<string, string> = { "To fort": "To fortress", "Run end": "Unfinished" };

type Layer = "splits" | "times" | "lead";
const LAYER_LABEL: Record<Layer, string> = { splits: "Splits", times: "Phase times", lead: "Lead" };

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

/** One thing a player did, from second a to b. nums are counts written into the line (rods,
 * the needed trade) and dots are marks on it (blaze kills, pearls). */
interface Moment {
  who: Who;
  kind: string;
  label: string;
  a: number;
  b: number;
  detail: string;
  nums?: { t: number; n: number }[];
  dots?: number[];
}
type Box = { x0: number; x1: number; y0: number; y1: number };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function moment(
  who: Who,
  kind: string,
  label: string,
  a: number,
  b: number,
  detail = "",
  extra: Pick<Moment, "nums" | "dots"> = {},
): Moment {
  return { who, kind, label, a, b, detail, ...extra };
}

type Step = NonNullable<NonNullable<RaceAnalysis["report"]>[number]["steps"]>["you"][number];

const splitTicks = (a: RaceAnalysis, who: Who, name: RegExp) =>
  a.splits.find((sp) => name.test(sp.name))?.[who] ?? null;

/** Spans closer than maxGap seconds joined into one, counts added */
function mergeSpans(xs: { a: number; b: number; n: number }[], maxGap: number) {
  const merged: typeof xs = [];
  for (const x of xs.sort((p, q) => p.a - q.a)) {
    const last = merged.at(-1);
    if (last && x.a - last.b <= maxGap) {
      last.b = Math.max(last.b, x.b);
      last.n += x.n;
    } else {
      merged.push({ ...x });
    }
  }
  return merged;
}

/** Trading stretches under a minute apart as one line, with what was picked up */
function tradeMoments(a: RaceAnalysis, who: Who, steps: Step[]): Moment[] {
  const trades = a.stats?.[who]?.trades;
  const coveringTrade = trades?.needed;
  const coveredAt = coveringTrade ? coveringTrade.t / TICKS_PER_SEC : NaN;
  // The analysis keeps running totals per item, so each pickup is the difference from the last
  const pickups: { t: number; item: string; n: number }[] = [];
  const prevTotal: Record<string, number> = {};
  for (const p of trades?.pickups ?? []) {
    pickups.push({ t: p.t / TICKS_PER_SEC, item: p.item, n: p.total - (prevTotal[p.item] ?? 0) });
    prevTotal[p.item] = p.total;
  }
  const lines = mergeSpans(
    steps
      .filter((s) => s.kind === "trade")
      .map((s) => ({
        a: s.t0 / TICKS_PER_SEC,
        b: s.t1 / TICKS_PER_SEC,
        n: Number(/^(\d+)/.exec(s.text)?.[1] ?? 0),
      })),
    60,
  );
  return lines.map((m, i) => {
    const here = coveringTrade && coveredAt >= m.a && coveredAt <= m.b ? coveringTrade : null;
    // A pickup counts for the line that started before it, since the last drops get picked up on the way out
    const until = lines[i + 1]?.a ?? Infinity;
    const picks = pickups.filter((p) => p.t >= (i ? m.a : -Infinity) && p.t < until);
    const got = new Map<string, { n: number; at: number[] }>();
    for (const p of picks) {
      const g = got.get(p.item) ?? { n: 0, at: [] };
      g.n += p.n;
      g.at.push(p.t);
      got.set(p.item, g);
    }
    const named = PICKED_LABEL.filter(([k]) => got.get(k)?.n)
      .map(([k, name]) => `${got.get(k)!.n} ${name}`)
      .join(", ");
    const all = [...got]
      .filter(([, g]) => g.n)
      .map(
        ([k, g]) => `${g.n} ${PICKED_NAME[k] ?? k} (${[...new Set(g.at.map(clock))].join(", ")})`,
      )
      .join(", ");
    const duration = clock(m.b - m.a);
    const label = m.n ? `${m.n} trades in ${duration}` : `trading for ${duration}`;
    return moment(
      who,
      "trade",
      `${label}${named ? ` · got ${named}` : ""}`,
      m.a,
      m.b,
      [
        all ? `picked up ${all}` : "",
        here ? `trade ${here.n} covered what you used later, at ${clock(coveredAt)}` : "",
      ]
        .filter(Boolean)
        .join("; "),
      here ? { nums: [{ t: coveredAt, n: here.n }] } : {},
    );
  });
}

/** What the player left the bastion with, on the split so it belongs to the phase after */
function kitMoments(a: RaceAnalysis, who: Who): Moment[] {
  const kit = a.stats?.[who]?.trades?.leftWith;
  const leftAt = splitTicks(a, who, /left the bastion/i);
  if (!kit || leftAt === null) {
    return [];
  }
  const parts = PICKED_LABEL.filter(([k]) => (kit[k as keyof typeof kit] ?? 0) > 0).map(
    ([k, name]) => `${kit[k as keyof typeof kit]} ${name}`,
  );
  if (!parts.length) {
    return [];
  }
  const t = leftAt / TICKS_PER_SEC;
  return [moment(who, "kit", `left on ${parts.join(", ")}`, t, t)];
}

function deathMoments(who: Who, steps: Step[]): Moment[] {
  return steps
    .filter((s) => s.kind === "death")
    .map((s) => {
      const dead = clock((s.t1 - s.t0) / TICKS_PER_SEC);
      return moment(
        who,
        "dead",
        s.text === "Died" ? `dead for ${dead}` : `${s.text.toLowerCase()}, ${dead}`,
        s.t0 / TICKS_PER_SEC,
        s.t1 / TICKS_PER_SEC,
      );
    });
}

/** Index of the first of the two neighbouring marks that sit closest together */
function closestPairStart(marks: { x: number }[]): number {
  let best = 0;
  for (let i = 1; i < marks.length - 1; i++) {
    if (marks[i + 1].x - marks[i].x < marks[best + 1].x - marks[best].x) {
      best = i;
    }
  }
  return best;
}

/** Index of the latest blaze kill from 5 s before a rod drop to just after it, or -1 */
function killForDrop(kills: number[], dropped: number) {
  let best = -1;
  for (const [i, t] of kills.entries()) {
    if (t <= dropped + 0.5 && t >= dropped - 5 && (best < 0 || t > kills[best])) {
      best = i;
    }
  }
  return best;
}

/** Rods from the first blaze fight to the 6 rods split, so both players are measured the same.
 * Each rod is numbered where it dropped and each kill that dropped none is a dot. */
function blazeMoment(a: RaceAnalysis, who: Who, steps: Step[]): Moment | null {
  const fights = steps
    .filter((s) => s.kind === "fight" && /blaze/.test(s.text))
    .sort((p, q) => p.t0 - q.t0);
  if (!fights.length) {
    return null;
  }
  const six = splitTicks(a, who, /blaze rods/i);
  const from = fights[0].t0 / TICKS_PER_SEC;
  const to = six !== null ? six / TICKS_PER_SEC : fights.at(-1)!.t1 / TICKS_PER_SEC;
  const inLine = (sec: number) => sec >= from && sec <= to;
  const drops = (a.rods?.[who] ?? [])
    .filter((r) => inLine(r.got / TICKS_PER_SEC))
    .map((r) => r.dropped / TICKS_PER_SEC);
  const kills = (a.blazeKills?.[who] ?? []).map((t) => t / TICKS_PER_SEC).filter(inLine);
  for (const d of drops) {
    const k = killForDrop(kills, d);
    if (k >= 0) {
      kills.splice(k, 1);
    }
  }
  // Analyses saved before rod times were kept only have the count per fight
  const rods = a.rods
    ? drops.length
    : fights.reduce((n, s) => n + Number(/(\d+) rod/.exec(s.detail ?? "")?.[1] ?? 0), 0);
  const blasts = (a.stats?.[who]?.blasts ?? []).filter((b) => inLine(b.t / TICKS_PER_SEC));
  const blastNote = blasts.length
    ? `blaze bed ${blastsText(blasts)} at ${clock(blasts[0].t / TICKS_PER_SEC)}`
    : "";
  if (to <= from) {
    return null;
  }
  const duration = clock(to - from);
  let label = `fought blazes for ${duration}`;
  if (six !== null) {
    label = `6 rods in ${duration}`;
  } else if (rods) {
    label = `${plural(rods, "rod")} in ${duration}, never got 6`;
  }
  return moment(
    who,
    "blaze",
    label,
    from,
    to,
    [drops.length ? `rods at ${drops.map(clock).join(", ")}` : "", blastNote]
      .filter(Boolean)
      .join(", "),
    { nums: drops.map((t, i) => ({ t, n: i + 1 })), dots: kills },
  );
}

/** Blaze bed set off outside the rods line, as its own mark */
function looseBlastMoments(a: RaceAnalysis, who: Who, rodsLine: Moment | null): Moment[] {
  const loose = (a.stats?.[who]?.blasts ?? []).filter(
    (b) => !rodsLine || b.t / TICKS_PER_SEC < rodsLine.a || b.t / TICKS_PER_SEC > rodsLine.b,
  );
  if (!loose.length) {
    return [];
  }
  const t = loose[0].t / TICKS_PER_SEC;
  return [moment(who, "blast", `blaze bed: ${blastsText(loose)}`, t, t)];
}

/** Pearls thrown on the way from the bastion to the fortress, a dot each */
function pearlMoments(a: RaceAnalysis, who: Who): Moment[] {
  const pearls = a.stats?.[who]?.pearlsToFort ?? [];
  const left = splitTicks(a, who, /left the bastion/i);
  const fort = splitTicks(a, who, /entered fortress/i);
  if (!pearls.length || left === null || fort === null || fort <= left) {
    return [];
  }
  return [
    moment(
      who,
      "pearls",
      `${plural(pearls.length, "pearl")} to the fortress`,
      left / TICKS_PER_SEC,
      fort / TICKS_PER_SEC,
      `thrown at ${pearls.map((t) => clock(t / TICKS_PER_SEC)).join(", ")}`,
      { dots: pearls.map((t) => t / TICKS_PER_SEC) },
    ),
  ];
}

/** Precrafts, labelled with the end items made and everything made in the detail */
function precraftMoments(a: RaceAnalysis, who: Who): Moment[] {
  return (a.stats?.[who]?.precrafts ?? []).map((p) => {
    const items = Object.entries(p.items)
      .sort((x, y) => y[1] - x[1])
      .map(([it, n]) => `${n} ${it.replace(/_/g, " ")}`)
      .join(", ");
    const made = Object.entries(p.items)
      .filter(([it]) => PRECRAFT_NAME[it] || it.endsWith("_bed"))
      .map(([it, n]) => {
        const name = PRECRAFT_NAME[it] ?? "bed";
        return n === 1 ? name : `${n} ${name}s`;
      });
    return moment(
      who,
      "craft",
      `${PRECRAFT_SHORT[p.kind]} ${Math.round(p.secs)} s${made.length ? `: ${made.join(", ")}` : ""}`,
      p.t0 / TICKS_PER_SEC,
      p.t1 / TICKS_PER_SEC,
      items,
    );
  });
}

/** Crafting screens under 20 s apart, grouped */
function groupCraftScreens(screens: CraftScreen[]) {
  const groups: CraftScreen[][] = [];
  for (const c of screens) {
    const g = groups.at(-1);
    if (g && c.t0 - g.at(-1)!.t1 <= 20 * TICKS_PER_SEC) {
      g.push(c);
    } else {
      groups.push([c]);
    }
  }
  return groups;
}

/** Overworld crafting, named by what was made in the order it was made. Planks and sticks only
 * count when that's all there was. */
function overworldCraftMoments(a: RaceAnalysis, who: Who): Moment[] {
  return groupCraftScreens(a.stats?.[who]?.owCrafts ?? []).map((g) => {
    const items = new Map<string, number>();
    for (const c of g) {
      for (const [it, n] of Object.entries(c.items)) {
        items.set(it, (items.get(it) ?? 0) + n);
      }
    }
    const real = [...items].filter(([it]) => !/_planks$|^stick$/.test(it));
    const shown = real.length ? real : [...items];
    const names = shown.map(([it, n]) => listItems({ [it]: n }, 1, false));
    const secs = g.reduce((n, c) => n + c.secs, 0);
    const verb = g.every((c) => c.smelt) ? "smelted" : "crafted";
    const more = names.length > 3 ? ` +${names.length - 3} more` : "";
    return moment(
      who,
      "owcraft",
      `${verb} ${names.slice(0, 3).join(", ")}${more}, ${Math.round(secs)} s`,
      g[0].t0 / TICKS_PER_SEC,
      g.at(-1)!.t1 / TICKS_PER_SEC,
      g
        .map(
          (c) =>
            `${clock(c.t0 / TICKS_PER_SEC)} ${listItems(c.items, 4, false)} (${Math.round(c.secs)} s)`,
        )
        .join(", "),
    );
  });
}

function portalLabel(text: string) {
  if (/blind/.test(text)) {
    return "blind";
  }
  if (/stronghold/.test(text)) {
    return "to stronghold";
  }
  return /lava/.test(text) ? "built a lava portal" : "built a portal";
}

function portalMoments(who: Who, steps: Step[]): Moment[] {
  return steps
    .filter((s) => s.kind === "portal")
    .map((s) => {
      const t = s.t1 / TICKS_PER_SEC;
      return moment(who, "portal", portalLabel(s.text), t, t, s.detail);
    });
}

function eyeMoments(who: Who, steps: Step[]): Moment[] {
  return steps
    .filter((s) => s.kind === "eyes")
    .map((s) => {
      const t = s.t0 / TICKS_PER_SEC;
      return moment(who, "eyes", s.text.replace("Threw ", "threw "), t, t, s.detail);
    });
}

/** Dragon fight: zero cycle or attempt, each perch, free the End, finish */
function endMoments(a: RaceAnalysis, who: Who): Moment[] {
  const f = a.end?.[who];
  if (!f) {
    return [];
  }
  const out: Moment[] = [];
  const zeroBeds = f.beds.slice(0, f.zeroBeds);
  if (zeroBeds.length) {
    out.push(
      moment(
        who,
        "zero",
        `${f.zero ? "zero cycle" : "failed zero cycle"}, ${plural(zeroBeds.length, "bed")}`,
        zeroBeds[0] / TICKS_PER_SEC,
        zeroBeds.at(-1)! / TICKS_PER_SEC,
      ),
    );
  }
  for (const [i, p] of f.perches.entries()) {
    const beds = p.beds ? plural(p.beds, "bed") : "no beds";
    const outcome = p.killed ? "killed it" : `flew off at ${p.hp1} HP`;
    out.push(
      moment(
        who,
        "perch",
        `perch ${i + 1}: ${beds}, ${outcome}`,
        p.t0 / TICKS_PER_SEC,
        p.t1 / TICKS_PER_SEC,
      ),
    );
  }
  // Free the End and finish close together count as one
  const close = f.kill !== null && f.done !== null && f.done - f.kill < 60;
  if (f.kill !== null) {
    const t = f.kill / TICKS_PER_SEC;
    out.push(
      moment(
        who,
        "kill",
        close ? `Free the End, finished ${clock(f.done! / TICKS_PER_SEC)}` : "Free the End",
        t,
        t,
      ),
    );
  }
  if (f.done !== null && !close) {
    const t = f.done / TICKS_PER_SEC;
    out.push(moment(who, "done", `finished ${clock(t)}`, t, t));
  }
  return out;
}

/** Everything a player did worth marking, in time order */
function moments(a: RaceAnalysis, who: Who): Moment[] {
  const steps = (a.report ?? []).flatMap((r) => r.steps?.[who] ?? []);
  const rodsLine = blazeMoment(a, who, steps);
  return [
    ...tradeMoments(a, who, steps),
    ...kitMoments(a, who),
    ...deathMoments(who, steps),
    ...(rodsLine ? [rodsLine] : []),
    ...looseBlastMoments(a, who, rodsLine),
    ...pearlMoments(a, who),
    ...precraftMoments(a, who),
    ...overworldCraftMoments(a, who),
    ...portalMoments(who, steps),
    ...eyeMoments(who, steps),
    ...endMoments(a, who),
  ].sort((p, q) => p.a - q.a);
}

export interface GapChart extends HTMLElement {
  /** Remove window listeners when the race page makes a new chart */
  dispose(): void;
  select(phase: string | null): void;
  /** Put the playhead at a race time in seconds, null clears it */
  setPlayhead(sec: number | null): void;
  /** Plot position in the SVG as last drawn, top/bottom and x/y scales */
  geom(): {
    top: number;
    bot: number;
    x(sec: number): number;
    y(gap: number): number;
    gap(sec: number): number;
  } | null;
}

/** Biggest single costs from the analysis, at your time when they happened, largest first */
function biggestCalls(a: RaceAnalysis) {
  return (a.report ?? [])
    .flatMap((p) =>
      (p.why ?? [])
        .filter(
          (w) =>
            w.at?.you != null &&
            Math.abs(w.seconds) >= 5 &&
            w.key !== "rest" &&
            w.key !== "step:other",
        )
        .map((w) => ({
          t: w.at!.you! / TICKS_PER_SEC,
          label: callLabel(w.label, w.seconds),
          v: w.seconds,
          sub: w.text.split(" · ")[0],
        })),
    )
    .sort((x, y) => Math.abs(y.v) - Math.abs(x.v));
}

export function gapChart(
  a: RaceAnalysis,
  opts: {
    seedType?: string | null;
    selected?: string | null;
    onSelect?: (phase: string | null) => void;
  } = {},
): GapChart {
  const { curve, segments } = buildDeltaModel(a);
  const bands = phaseBands(a);
  const xMax = runEndSec(a, curve);
  const them = a.them.name;
  let selected = opts.selected ?? null;
  let hovered: string | null = null;
  let zoomed = false;
  let view = { x0: 0, x1: xMax };
  let playhead: number | null = null;
  let lastGeom: ReturnType<GapChart["geom"]> = null;

  const gapAt = gapLookup(curve);
  const lane = (who: Who) => (a.report ?? []).flatMap((r) => r.steps?.[who] ?? []);
  const lanes = { you: lane("you"), them: lane("them") };
  const stepAt = (who: Who, sec: number) =>
    lanes[who].find((s) => sec >= s.t0 / TICKS_PER_SEC && sec <= s.t1 / TICKS_PER_SEC) ?? null;
  const calls = biggestCalls(a);
  const playerMoments = { you: moments(a, "you"), them: moments(a, "them") };

  const status = h("div", { class: "gap-status" });
  const layerBox = h("div", { class: "gap-seg multi", role: "group", "aria-label": "Show" });
  const tools = h(
    "div",
    { class: "gap-tools" },
    h("div", { class: "gap-tool" }, h("span", { class: "lbl" }, "Show"), layerBox),
  );
  const pills = h("div", { class: "gap-pills" });
  // The pixel font loads late and widens the pills, so the row refits when any pill resizes.
  const pillSizes = new ResizeObserver(() => fitPills());
  const svg = el("svg", { class: "gap-svg" });
  const tip = h("div", { class: "gap-tip", hidden: true });
  const list = h("div", { class: "gap-list", hidden: true });
  const costs = h("div", { class: "gap-costs" });
  const chrome = h("div", { class: "gap-chrome" }, status, pills, costs, tools);
  const wrap = h(
    "div",
    { class: "gap-chart" },
    chrome,
    h("div", { class: "gap-plot" }, svg, tip),
    list,
  ) as unknown as GapChart;

  const pick = (phase: string | null) => {
    const next = phase === selected && zoomed ? null : phase;
    wrap.select(next);
    opts.onSelect?.(next);
  };
  const zoomToPhaseAt = (sec: number) => {
    const b = bandAt(bands, sec);
    if (b && !(zoomed && b.phase === selected)) {
      pick(b.phase);
    }
  };

  function drawSwitches() {
    const p = prefs();
    layerBox.replaceChildren(
      ...(Object.keys(LAYER_LABEL) as Layer[]).map((k) =>
        h(
          "button",
          {
            class: p[k] ? "on" : "",
            "aria-pressed": String(p[k]),
            onclick: () => savePrefs({ [k]: !p[k] }),
          },
          LAYER_LABEL[k],
        ),
      ),
    );
  }
  function drawPills() {
    const shortName = (s: (typeof segments)[number]) => {
      if (s.splitName === "Run end" && s.reportPhase) {
        return sentence(s.reportPhase);
      }
      const name = sentence(s.segShort);
      return PILL_NAME[name] ?? name;
    };
    // Adjacent segments with the same name are one phase, like fortress through blind travel.
    const groups: { name: string; segs: typeof segments }[] = [];
    for (const s of segments) {
      const last = groups.at(-1);
      if (last && last.name === shortName(s)) {
        last.segs.push(s);
      } else {
        groups.push({ name: shortName(s), segs: [s] });
      }
    }
    pills.replaceChildren(
      ...groups.map(({ name, segs }) => {
        const first = segs[0];
        const last = segs.at(-1)!;
        const delta = segs.reduce((n, s) => n + s.segDelta, 0);
        const phase = first.reportPhase ?? first.segLabel;
        const on = segs.some((s) => (s.reportPhase ?? s.segLabel) === selected);
        const icon = structIcon(phaseIconKey(name, opts.seedType));
        return h(
          "button",
          {
            class: `gap-pill ${on ? "on" : ""} ${icon ? "" : "noicon"}`,
            title: `${name}: ${clock(first.you0)} to ${clock(last.you1)}`,
            onclick: () => pick(phase),
          },
          icon,
          h(
            "span",
            { class: "txt" },
            h("span", { class: "n" }, name),
            h("span", { class: `d ${toneCls(delta)}` }, short(delta)),
          ),
        );
      }),
    );
    pillSizes.disconnect();
    pillSizes.observe(pills);
    for (const p of pills.children) {
      pillSizes.observe(p);
    }
    fitPills();
  }
  /** Pills on one line if they fit, else on the fewest rows split evenly (5+4, not 8+1) */
  function fitPills() {
    pills.querySelectorAll(".gap-break").forEach((b) => b.remove());
    const W = pills.clientWidth;
    const kids = [...pills.children] as HTMLElement[];
    const n = kids.length;
    if (!W || !n) {
      return;
    }
    // The shrinking header scales the chart, so pills are measured at layout width to keep the rows stable.
    pills.classList.add("measure");
    const w = kids.map((c) => c.offsetWidth + 3);
    pills.classList.remove("measure");
    /** Index after the last pill of each row, bigger rows first */
    const ends = (rows: number) => {
      const base = Math.floor(n / rows);
      const extra = n % rows;
      const out: number[] = [];
      let end = 0;
      for (let r = 0; r < rows; r++) {
        end += base + (r < extra ? 1 : 0);
        out.push(end);
      }
      return out;
    };
    const fits = (rows: number) => {
      let i = 0;
      for (const e of ends(rows)) {
        if (w.slice(i, e).reduce((a, b) => a + b, 0) > W) {
          return false;
        }
        i = e;
      }
      return true;
    };
    let rows = 1;
    while (rows < n && !fits(rows)) {
      rows++;
    }
    for (const e of ends(rows).slice(0, -1)) {
      kids[e - 1].after(h("span", { class: "gap-break" }));
    }
  }
  function phaseStatus(b: PhaseBand) {
    return [
      h("b", null, b.phase),
      b.you !== null && b.them !== null
        ? h("span", null, `${clock(b.you)} vs ${clock(b.them)}`)
        : null,
      b.change !== null ? h("span", { class: toneCls(b.change) }, gapText(b.change)) : null,
      h(
        "button",
        { class: "btn sm ghost", onclick: () => pick(null) },
        "Whole run",
        h("span", { class: "kbd" }, "ESC"),
      ),
    ];
  }
  function runStatus() {
    const gapCls = toneCls(a.finalGap);
    if (a.you.finished) {
      return [
        h("b", null, `Finished ${clock(a.you.endTicks / TICKS_PER_SEC)}`),
        h("span", { class: gapCls }, gapText(a.finalGap)),
      ];
    }
    const stoppedAt = segments.at(-1)?.you1 ?? a.you.endTicks / TICKS_PER_SEC;
    return [
      h("b", null, `Didn't finish, ${a.you.quit ? "left" : "stopped"} at ${clock(stoppedAt)}`),
      h("span", { class: gapCls }, `${gapText(a.finalGap)} at that point`),
    ];
  }
  function drawStatus() {
    const b = zoomed ? bands.find((x) => x.phase === selected) : undefined;
    status.replaceChildren(...(b ? phaseStatus(b) : runStatus()).filter((k) => k !== null));
    status.title = b ? "" : "Hover a phase for detail, click to zoom";
  }

  let showAt = (_sec: number) => {};
  let hideCursor = () => {};

  function paint() {
    const W = Math.round(svg.getBoundingClientRect().width);
    // The svg is either not laid out yet or too narrow to draw a plot in.
    if (W < PAD_L + PAD_R + 40) {
      return;
    }
    const L = PAD_L;
    const R = W - PAD_R;
    const { x0, x1 } = view;
    const layers = prefs();
    const mode = layers.moments;
    const top = layers.splits ? 26 : 8;
    const bot = top + PLOT_H;
    const railY = bot + 10;
    const railH = mode === "rail" ? RAIL_H : 0;
    const phY = railY + railH + 6;
    const phH = layers.times ? 58 : 30;
    const H = phY + phH + 22;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("height", String(H));
    svg.replaceChildren();
    const boxes: Box[] = [];
    const free = (b: Box) =>
      b.x0 >= L - 2 &&
      b.x1 <= R + 2 &&
      b.y0 >= top - 2 &&
      b.y1 <= bot + 2 &&
      boxes.every((o) => b.x1 < o.x0 || b.x0 > o.x1 || b.y1 < o.y0 || b.y0 > o.y1);
    const focus = bands.find((b) => b.phase === (zoomed ? selected : hovered)) ?? null;
    /** Whether a point, or the middle of a span, falls in the focused phase. A phase has its start
     * but not its end, except the last phase, which ends where the run finished. */
    const inFocus = (t0: number, t1: number, who: Who = "you") => {
      if (!focus) {
        return false;
      }
      const [a0, b0] = who === "you" ? [focus.you0, focus.you1] : [focus.themFrom, focus.themTo];
      const endTicks = who === "you" ? a.you.endTicks : a.them.endTicks;
      const last = b0 >= endTicks / TICKS_PER_SEC - 0.1;
      const t = (t0 + t1) / 2;
      return t >= a0 && (t < b0 || (last && t <= b0));
    };

    const X = (s: number) => L + ((s - x0) / (x1 - x0)) * (R - L);
    const secAtX = (px: number) => x0 + ((px - L) / (R - L)) * (x1 - x0);
    // Zoomed in, the curve leaves room around it for callouts.
    const roomy = zoomed && mode === "curve" ? 0.3 : 0;
    const { step, gTop, gBot } = gapRange(curve, gapAt, x0, x1, roomy);
    const Y = (g: number) => top + ((gTop - g) / (gTop - gBot)) * PLOT_H;
    const curveYAtX = (px: number) => Y(gapAt(secAtX(px)));
    lastGeom = { top, bot, x: X, y: Y, gap: gapAt };
    const id = `gc${Math.random().toString(36).slice(2, 8)}`;
    const defs = el("defs", {});
    const clip = (name: string, y: number, hgt: number) => {
      const c = el("clipPath", { id: id + name });
      c.appendChild(el("rect", { x: L, y, width: R - L, height: Math.max(0, hgt) }));
      defs.appendChild(c);
    };
    clip("all", 0, H);
    clip("up", 0, Y(0));
    clip("dn", Y(0), H);
    svg.appendChild(defs);
    const g = el("g", { "clip-path": `url(#${id}all)` });
    svg.appendChild(g);

    const labelled: { m: Moment; box: Box; pc: string; ends: boolean }[] = [];
    const called: { box: Box; text: string }[] = [];
    const tipText = (m: Moment) =>
      `${m.who === "you" ? "You" : them}, ${m.b > m.a ? `${clock(m.a)} to ${clock(m.b)}` : `at ${clock(m.a)}`}: ${cap(m.label)}${m.detail ? `, ${m.detail}` : ""}`;
    /** Whether settings show this kind of moment for this player */
    const picked = (m: Moment) =>
      layers[KIND_PREF[m.kind]] !== false &&
      (layers.momentsOf === "both" || layers.momentsOf === m.who);
    /** Picked and not a short span, unless it is a kind that always shows */
    const worth = (m: Moment) =>
      picked(m) &&
      !(m.b - m.a > 0 && m.b - m.a < layers.minMoment && !ALWAYS_SHOWN_KINDS.includes(m.kind));

    drawBands();
    drawGrid();
    if (layers.splits) {
      drawSplits();
    }
    drawCurve();
    drawCosts();
    reserveCurve();
    if (mode === "curve") {
      drawCurveMoments();
      if (zoomed && focus) {
        drawCallouts();
      }
    } else if (mode === "rail") {
      drawRail();
    }
    if (layers.phaseNames) {
      drawPhaseLabels();
    }
    drawTimeAxis();
    drawPlayhead();
    drawList();
    bindPointer();

    function bandFill(b: PhaseBand, i: number) {
      if (b.phase === selected) {
        return "color-mix(in srgb, var(--accent) 10%, transparent)";
      }
      if (b.phase === hovered) {
        return "rgba(255,255,255,.05)";
      }
      return i % 2 ? "rgba(255,255,255,.02)" : "transparent";
    }

    function drawBands() {
      bands.forEach((b, i) => {
        g.appendChild(
          el("rect", {
            x: X(b.you0),
            y: top,
            width: Math.max(0, X(b.you1) - X(b.you0)),
            height: phY + phH - top,
            fill: bandFill(b, i),
            class: "keep",
          }),
        );
        if (i) {
          g.appendChild(
            el("line", {
              x1: X(b.you0),
              x2: X(b.you0),
              y1: top,
              y2: phY + phH,
              stroke: "var(--rule)",
              class: "keep",
            }),
          );
        }
      });
    }

    function drawGrid() {
      for (let v = gBot; v <= gTop + 0.01; v += step) {
        svg.appendChild(
          el("line", {
            x1: L,
            x2: R,
            y1: Y(v),
            y2: Y(v),
            stroke: v === 0 ? "var(--line)" : "var(--rule)",
            "stroke-dasharray": v === 0 ? "" : "2 4",
            class: v === 0 ? "keep" : "",
          }),
        );
        svg.appendChild(
          el(
            "text",
            { x: L - 8, y: Y(v) + 4, "text-anchor": "end", class: "dimt" },
            v === 0 ? "even" : short(v),
          ),
        );
      }
    }

    function drawSplits() {
      const marks = a.splits
        .flatMap((s) =>
          (["you", "them"] as const).flatMap((who) => {
            const ticks = s[who];
            return ticks === null
              ? []
              : [{ who, t: ticks / TICKS_PER_SEC, name: SPLIT_SHORT[s.name] ?? s.name }];
          }),
        )
        .filter((m) => m.t >= x0 && m.t <= x1)
        .sort((p, q) => p.t - q.t);
      let lastX = -1e9;
      for (const m of marks) {
        const x = X(m.t);
        const theirs = m.who === "them";
        g.appendChild(
          el("line", {
            x1: x,
            x2: x,
            y1: top - 10,
            y2: bot,
            stroke: theirs ? "var(--them)" : "rgba(255,255,255,.14)",
            "stroke-opacity": theirs ? 0.35 : 1,
            "stroke-dasharray": "1 3",
          }),
        );
        const w = textW(m.name);
        const cx = Math.max(L + w / 2, Math.min(R - w / 2, x));
        if (cx - w / 2 > lastX + 6) {
          const look: Record<string, string | number> = theirs
            ? { fill: "var(--them)", "fill-opacity": 0.7 }
            : { class: "dimt" };
          g.appendChild(
            el("text", { x: cx, y: top - 14, "text-anchor": "middle", ...look }, m.name),
          );
          lastX = cx + w / 2;
        }
      }
    }

    /** The gap curve, either shaded by who was gaining or split at even */
    function drawCurve() {
      if (layers.lead) {
        drawLeadCurve();
        return;
      }
      const line = curvePath(curve, X, Y);
      const area = `${line}L${X(curve.at(-1)![0])} ${Y(0)}L${X(curve[0][0])} ${Y(0)}Z`;
      for (const [part, c, o] of [
        ["up", "var(--bad)", 0.15],
        ["dn", "var(--good)", 0.2],
      ] as const) {
        const gg = el("g", { "clip-path": `url(#${id}${part})` });
        gg.appendChild(el("path", { d: area, fill: c, "fill-opacity": o, class: "keep" }));
        gg.appendChild(
          el("path", {
            d: line,
            fill: "none",
            stroke: c,
            "stroke-width": layers.curveWidth,
            "stroke-linejoin": "round",
            class: "keep",
          }),
        );
        g.appendChild(gg);
      }
    }

    function drawLeadCurve() {
      for (let i = 1; i < curve.length; i++) {
        const [s0, v0] = curve[i - 1];
        const [s1, v1] = curve[i];
        if (s1 < x0 || s0 > x1) {
          continue;
        }
        const c =
          v1 > v0 + 0.05 ? "var(--bad)" : v1 < v0 - 0.05 ? "var(--good)" : "var(--text-dim)";
        g.appendChild(
          el("path", {
            d: `M${X(s0)} ${Y(0)}L${X(s0)} ${Y(v0)}L${X(s1)} ${Y(v1)}L${X(s1)} ${Y(0)}Z`,
            fill: c,
            "fill-opacity": 0.2,
            class: "keep",
          }),
        );
        g.appendChild(
          el("line", {
            x1: X(s0),
            y1: Y(v0),
            x2: X(s1),
            y2: Y(v1),
            stroke: c,
            "stroke-width": layers.curveWidth,
            class: "keep",
          }),
        );
      }
    }

    /** Biggest costs in one line under the pills. Hovering one finds it on the curve. */
    function drawCosts() {
      const shownCosts = calls
        .filter((c) => c.t >= x0 && c.t <= x1 && (!focus || inFocus(c.t, c.t)))
        .slice(0, layers.costs);
      if (!shownCosts.length) {
        costs.replaceChildren();
        return;
      }
      costs.replaceChildren(
        h(
          "span",
          { class: "dim" },
          focus ? `Biggest costs in ${focus.phase.toLowerCase()}:` : "Biggest costs:",
        ),
        ...shownCosts.map((c, i) =>
          h(
            "button",
            {
              class: "cost",
              title: c.sub,
              onmouseenter: () => showAt(c.t),
              onmouseleave: () => hideCursor(),
              onclick: () => zoomToPhaseAt(c.t),
            },
            `${c.label.toLowerCase()} `,
            h("span", { class: toneCls(c.v) }, fmtDelta(c.v)),
            i < shownCosts.length - 1 ? "," : "",
          ),
        ),
      );
    }

    /** Keeps labels off the curve itself */
    function reserveCurve() {
      for (let x = L; x <= R; x += 6) {
        const y = curveYAtX(x);
        boxes.push({ x0: x - 3, x1: x + 3, y0: y - 3, y1: y + 3 });
      }
    }

    /** Each moment as a dot at its start and a line for its duration. Yours sit above the curve
     * and theirs along the bottom, since the curve is your gap and not their position. */
    function drawCurveMoments() {
      const rank = (m: Moment) => PLACE_FIRST[m.kind] ?? 0;
      const queue = (["you", "them"] as const)
        .flatMap((who) => playerMoments[who].filter((m) => worth(m)))
        .sort((p, q) => rank(p) - rank(q));
      for (const m of queue) {
        if (m.b >= x0 && m.a <= x1 && inFocus(m.a, m.b, m.who)) {
          placeMoment(m);
        }
      }
    }

    /** Whole seconds their moment took over your matching one (same kind, same index), or 0 */
    function diffToYours(m: Moment) {
      if (m.who === "you" || m.b <= m.a || UNCOMPARED_KINDS.includes(m.kind)) {
        return 0;
      }
      const theirs = playerMoments.them.filter((q) => q.kind === m.kind);
      const yours = playerMoments.you.filter((q) => q.kind === m.kind)[theirs.indexOf(m)];
      if (!yours || yours.b <= yours.a) {
        return 0;
      }
      return Math.floor(m.b - m.a) - Math.floor(yours.b - yours.a);
    }

    function placeMoment(m: Moment) {
      const up = m.who === "you";
      const pc = up ? "var(--you)" : "var(--them)";
      const xa = X(Math.max(m.a, x0));
      const xb = X(Math.min(m.b, x1));
      const span = xb - xa > 4;
      const diff = diffToYours(m);
      const compared =
        Math.abs(diff) >= 1
          ? `, ${Math.round(Math.abs(diff))} s ${diff < 0 ? "quicker" : "slower"}`
          : "";
      const label = fitText(`${up ? "You" : them}: ${m.label}${compared}`, R - L - 8);
      const w = textW(label);
      const tA = clock(m.a);
      const tB = clock(m.b);
      const ends =
        layers.lineTimes &&
        span &&
        (zoomed || xb - xa > 90) &&
        xa - textW(tA) - 12 >= L &&
        xb + textW(tB) + 12 <= R;
      const padA = ends ? textW(tA) + 8 : 0;
      const padB = ends ? textW(tB) + 8 : 0;
      const ys = curve
        .filter((p) => p[0] >= m.a && p[0] <= m.b)
        .map((p) => Y(p[1]))
        .concat([Y(gapAt(m.a)), Y(gapAt(m.b))]);
      // Their labels sit between the curve and the phase labels, which can take a few rows to clear.
      for (let k = 0; k < (up ? 5 : 8); k++) {
        const y = up ? Math.min(...ys) - 8 - k * 16 : bot - 6 - k * 16;
        const ly = y - 5;
        const lx = Math.max(L + 4, Math.min(xa - 3, R - w - 4));
        // The box is kept inside the plot, so a line running past the edge of the view is cut off there.
        const box = {
          x0: Math.max(L - 2, Math.min(xa - padA, lx) - 4),
          x1: Math.min(R + 2, Math.max(xb + padB, lx + w) + 4),
          y0: ly - 11,
          y1: y + 4,
        };
        const cy: number[] = [];
        for (let x = Math.max(L, box.x0); x <= Math.min(R, box.x1); x += 4) {
          cy.push(curveYAtX(x));
        }
        const crossesCurve = up ? box.y1 > Math.min(...cy) - 2 : box.y0 < Math.max(...cy) + 2;
        if (!free(box) || crossesCurve) {
          continue;
        }
        boxes.push(box);
        labelled.push({ m, box, pc, ends });
        drawMomentLine(m, { xa, xb, y, pc, span });
        g.appendChild(el("text", { x: lx, y: ly, fill: pc }, label));
        if (ends) {
          g.appendChild(
            el(
              "text",
              {
                x: xa - 6,
                y: y + 4,
                "text-anchor": "end",
                fill: pc,
                "fill-opacity": 0.65,
                "font-size": 11,
              },
              tA,
            ),
          );
          g.appendChild(
            el(
              "text",
              { x: xb + 5, y: y + 4, fill: pc, "fill-opacity": 0.65, "font-size": 11 },
              tB,
            ),
          );
        }
        return;
      }
    }

    /** The line with its counts written in (the line breaks around them), its dots and its start square */
    function drawMomentLine(
      m: Moment,
      at: { xa: number; xb: number; y: number; pc: string; span: boolean },
    ) {
      const { xa, xb, y, pc, span } = at;
      const marks = layMarks(m, xa, xb);
      if (span) {
        let d = "";
        let from = xa;
        for (const q of marks) {
          if (!q.n) {
            continue;
          }
          if (q.x - q.r > from) {
            d += `M${from} ${y}H${q.x - q.r}`;
          }
          from = Math.max(from, q.x + q.r);
        }
        if (xb > from) {
          d += `M${from} ${y}H${xb}`;
        }
        g.appendChild(
          el("path", {
            d: `${d}M${xb} ${y - 3}V${y + 3}`,
            fill: "none",
            stroke: pc,
            "stroke-width": 2,
          }),
        );
      }
      for (const q of marks) {
        g.appendChild(
          q.n
            ? el("text", { x: q.x, y: y + 4, "text-anchor": "middle", fill: pc }, String(q.n))
            : el("circle", { cx: q.x, cy: y, r: q.r, fill: "var(--text)" }),
        );
      }
      g.appendChild(el("rect", { x: xa - 3, y: y - 3, width: 6, height: 6, fill: pc }));
    }

    /** Counts and dots along a moment's line, slid apart so none touch and all stay clear of the
     * start square and end tick. Without room, the closest counts merge into the later one. */
    function layMarks(m: Moment, xa: number, xb: number) {
      // Counts are drawn at 11px, the size textW measures by default.
      const half = (n: number) => String(n).length * 3.4 + 2;
      const nums = (m.nums ?? [])
        .filter(({ t }) => t >= x0 && t <= x1)
        .map(({ t, n }) => ({ x: X(t), n }));
      const kx = (m.dots ?? []).filter((t) => t >= x0 && t <= x1).map(X);
      const lay = (dots: boolean, gap: number) => {
        const ms = [
          ...(dots ? kx.map((x) => ({ x, r: gap ? 1.6 : 1.3, n: 0 })) : []),
          ...nums.map(({ x, n }) => ({ x, r: half(n), n })),
        ].sort((p, q) => p.x - q.x || p.n - q.n);
        let prev = xa + 3;
        for (const q of ms) {
          q.x = Math.max(q.x, prev + gap + q.r);
          prev = q.x + q.r;
        }
        let next = xb - 1;
        for (let k = ms.length - 1; k >= 0; k--) {
          ms[k].x = Math.min(ms[k].x, next - gap - ms[k].r);
          next = ms[k].x - ms[k].r;
        }
        return !ms.length || ms[0].x - ms[0].r >= xa + 3 - 0.01 ? ms : null;
      };
      // When it is too tight, dots touch first, then counts merge into the next one, and last of all the dots go.
      let marks = lay(true, 1) ?? lay(true, 0);
      while (!marks && nums.length > 1) {
        nums.splice(closestPairStart(nums), 1);
        marks = lay(true, 0);
      }
      return marks ?? lay(false, 1) ?? [];
    }

    /** What cost or saved time, labelled on the curve where it happened */
    function drawCallouts() {
      for (const c of calls
        .filter((q) => q.t >= x0 && q.t <= x1 && inFocus(q.t, q.t))
        .slice(0, layers.callouts)) {
        const xc = X(c.t);
        const yc = Y(gapAt(c.t));
        const num = fmtDelta(c.v);
        const name = `${fitText(c.label.toLowerCase(), R - L - textW(num) - 6)} `;
        const w = textW(name + num);
        for (let k = 0; k < 8; k++) {
          const up = k % 2 === 0;
          const d = 18 + Math.floor(k / 2) * 15;
          const ly = up ? yc - d : yc + d + 10;
          const lx = Math.max(L, Math.min(xc - w / 2, R - w));
          const box = { x0: lx - 2, x1: lx + w + 2, y0: ly - 11, y1: ly + 3 };
          if (!free(box)) {
            continue;
          }
          boxes.push(box);
          called.push({ box, text: c.sub });
          g.appendChild(
            el("line", {
              x1: xc,
              x2: xc,
              y1: yc,
              y2: up ? ly + 3 : ly - 11,
              stroke: "var(--text-dim)",
              "stroke-opacity": 0.6,
            }),
          );
          g.appendChild(el("circle", { cx: xc, cy: yc, r: 2.5, fill: "var(--text)" }));
          const t = el("text", { x: lx, y: ly, class: "midt" }, name);
          t.appendChild(el("tspan", { fill: tone(c.v) }, num));
          g.appendChild(t);
          break;
        }
      }
    }

    /** Moments on two rails under the plot, one pair of rows per player */
    function drawRail() {
      (["you", "them"] as const).forEach((who, i) => {
        const base = railY + i * 38;
        svg.appendChild(
          el(
            "text",
            {
              x: L - 8,
              y: base + 14,
              "text-anchor": "end",
              fill: who === "you" ? "var(--you)" : "var(--them)",
            },
            who === "you" ? "You" : them.length > 7 ? `${them.slice(0, 6)}…` : them,
          ),
        );
        const rowEnds = [-1e9, -1e9];
        for (const m of playerMoments[who]) {
          if (m.b < x0 || m.a > x1 || !worth(m)) {
            continue;
          }
          const xa = X(m.a);
          const xb = X(m.b);
          const span = xb - xa > 3;
          const row = rowEnds[0] < xa - 8 ? 0 : rowEnds[1] < xa - 8 ? 1 : -1;
          if (row < 0) {
            continue;
          }
          const y = base + 6 + row * 17;
          const fill = MOMENT_COLOR[m.kind];
          g.appendChild(
            span
              ? el("rect", { x: xa, y: y + 2, width: xb - xa, height: 3, fill })
              : el("rect", { x: xa - 3, y, width: 6, height: 6, fill }),
          );
          for (const { t } of m.nums ?? []) {
            if (t >= x0 && t <= x1) {
              g.appendChild(el("rect", { x: X(t) - 0.75, y: y - 1, width: 1.5, height: 9, fill }));
            }
          }
          const indent = span ? 0 : 6;
          const lbl = fitText(cap(m.label), R - xa - indent);
          if (!lbl) {
            continue;
          }
          const t = el("text", { x: xa + indent, y: y + 15, class: "midt" }, lbl);
          t.appendChild(el("title", {}, tipText(m)));
          g.appendChild(t);
          rowEnds[row] = Math.max(xb, xa + textW(lbl) + indent);
        }
      });
    }

    /** Phase names with icons and the gap change, inside each band. Icons show only if the name
     * still fits after them, and the name falls back to its short form, then gets cut. */
    function drawPhaseLabels() {
      const maxDur = Math.max(...bands.map((b) => Math.max(b.you ?? 0, b.them ?? 0)), 1);
      for (const b of bands) {
        const xa = Math.max(X(b.you0), L);
        const xb = Math.min(X(b.you1), R);
        const w = xb - xa;
        if (w < 30) {
          continue;
        }
        const keys = phaseIconKeys(b.phase, opts.seedType);
        const cx = xa + 6;
        const room = xb - cx - 4;
        const iconW = 4 + 18 * keys.length;
        const delta = b.change !== null ? fmtDelta(b.change) : null;
        const brief = SHORT[b.phase] ?? b.phase;
        const pickName = (r: number) => (textW(b.phase) <= r ? b.phase : fitText(brief, r));
        const withIcon = w > 60 && keys.length > 0 && textW(brief) <= room - iconW;
        const tx = cx + (withIcon ? iconW : 0);
        const name = w > 60 ? pickName(xb - tx - 4) : "";
        if (withIcon) {
          keys.forEach((k, i) => {
            const ic = structIcon(k);
            if (ic) {
              const fo = el("foreignObject", { x: cx + 18 * i, y: phY + 2, width: 16, height: 16 });
              fo.appendChild(ic);
              g.appendChild(fo);
            }
          });
        }
        if (name) {
          g.appendChild(el("text", { x: tx, y: phY + 14, fill: "var(--text)" }, name));
        }
        if (delta && textW(delta) <= (name ? xb - tx - 4 : room)) {
          g.appendChild(
            el(
              "text",
              { x: name ? tx : cx, y: phY + (name ? 27 : 14), fill: tone(b.change) },
              delta,
            ),
          );
        }
        if (layers.times && b.you !== null && w > 70) {
          drawPhaseTimes(b, { cx, w, xb, maxDur });
        }
      }
    }

    /** Both players' phase times as bars, scaled to the longest phase */
    function drawPhaseTimes(
      b: PhaseBand,
      at: { cx: number; w: number; xb: number; maxDur: number },
    ) {
      const { cx, w, xb, maxDur } = at;
      const bw = Math.min(w - 60, 220);
      const tw = textW("00:00", 10);
      (
        [
          ["you", b.you],
          ["them", b.them],
        ] as const
      ).forEach(([who, d], i) => {
        if (d === null) {
          return;
        }
        const y = phY + 34 + i * 10;
        const barW = (d / maxDur) * bw;
        g.appendChild(
          el("rect", {
            x: cx,
            y,
            width: Math.max(2, barW),
            height: 6,
            fill: who === "you" ? "var(--you)" : "var(--them)",
            "fill-opacity": 0.75,
          }),
        );
        if (cx + barW + 6 + tw <= xb) {
          g.appendChild(el("text", { x: cx + barW + 6, y: y + 6, class: "dimt small" }, clock(d)));
        }
      });
    }

    function drawTimeAxis() {
      const every =
        [30, 60, 120, 180, 300].find(
          (v) => v >= (x1 - x0) / Math.max(4, Math.floor((R - L) / 100)),
        ) ?? 300;
      for (let t = Math.ceil(x0 / every) * every; t <= x1; t += every) {
        const hw = textW(clock(t)) / 2;
        svg.appendChild(
          el(
            "text",
            {
              x: Math.max(hw, Math.min(W - hw, X(t))),
              y: H - 6,
              "text-anchor": "middle",
              class: "dimt",
            },
            clock(t),
          ),
        );
      }
    }

    /** Playhead at the split being read, labelled at the top of the plot unless that covers a
     * label, then at the bottom */
    function drawPlayhead() {
      if (playhead === null || playhead < x0 || playhead > x1) {
        return;
      }
      const px = X(playhead);
      const pg = gapAt(playhead);
      const py = Y(pg);
      const lbl = `${clock(playhead)} ${gapLabel(pg)}`;
      const lw = textW(lbl);
      const right = px + 12 + lw < R;
      const lx0 = right ? px + 8 : px - 8 - lw;
      const ly =
        [top + 11, bot - 4].find((y) => free({ x0: lx0, x1: lx0 + lw, y0: y - 11, y1: y + 3 })) ??
        top + 11;
      svg.append(
        el("line", {
          x1: px,
          x2: px,
          y1: top,
          y2: bot,
          stroke: "var(--text)",
          "stroke-opacity": 0.55,
          "stroke-dasharray": "2 3",
          "pointer-events": "none",
        }),
        el("rect", {
          x: px - 4,
          y: py - 4,
          width: 8,
          height: 8,
          fill: "var(--text)",
          "pointer-events": "none",
        }),
        el(
          "text",
          {
            x: right ? px + 8 : px - 8,
            y: ly,
            "text-anchor": right ? "start" : "end",
            fill: "var(--text)",
            "pointer-events": "none",
          },
          lbl,
        ),
      );
    }

    /** Moments as a table under the graph */
    function drawList() {
      list.hidden = mode !== "list";
      if (mode !== "list") {
        return;
      }
      const all = [...playerMoments.you, ...playerMoments.them]
        .filter((m) => picked(m) && m.b >= x0 && m.a <= x1)
        .sort((p, q) => p.a - q.a);
      list.replaceChildren(
        h(
          "div",
          { class: "h" },
          h("span", null, "When"),
          h("span", { class: "you" }, "You"),
          h("span", { class: "them" }, them),
        ),
        ...all.map((m) => {
          const cell = [
            h("i", { style: `background:${MOMENT_COLOR[m.kind]}` }),
            cap(m.label),
            h("small", null, `${clock(m.a)}${m.detail ? `, ${m.detail}` : ""}`),
          ];
          return h(
            "div",
            {
              class: "m",
              onmouseenter: () => showAt(m.a),
              onmouseleave: () => hideCursor(),
              onclick: () => zoomToPhaseAt(m.a),
            },
            h("span", { class: "dim" }, clock(m.a)),
            h("span", null, m.who === "you" ? cell : null),
            h("span", null, m.who === "them" ? cell : null),
          );
        }),
      );
    }

    /** Hover shows the gap and both players' steps, or a label's detail. Click zooms to a phase. */
    function bindPointer() {
      const guide = el("line", {
        y1: top,
        y2: bot,
        stroke: "var(--text-dim)",
        "stroke-dasharray": "2 3",
        visibility: "hidden",
        "pointer-events": "none",
      });
      const dot = el("rect", {
        width: 7,
        height: 7,
        fill: "var(--text)",
        visibility: "hidden",
        "pointer-events": "none",
      });
      const hit = el("rect", {
        x: L,
        y: top,
        width: R - L,
        height: railY + railH - top,
        fill: "transparent",
        class: "gap-hit",
      });
      const spanMarks = el("g", { "pointer-events": "none" });
      svg.insertBefore(spanMarks, g.nextSibling);
      svg.append(guide, dot, hit);
      /** Shades a hovered moment's span, with its times at the bottom if the line has none */
      const showSpan = (label: { m: Moment; pc: string; ends: boolean } | undefined) => {
        spanMarks.replaceChildren();
        if (!label || label.m.b <= label.m.a) {
          return;
        }
        const { m, pc } = label;
        const xa = X(Math.max(m.a, x0));
        const xb = X(Math.min(m.b, x1));
        spanMarks.append(
          el("rect", {
            x: xa,
            y: top,
            width: Math.max(1, xb - xa),
            height: bot - top,
            fill: pc,
            "fill-opacity": 0.12,
          }),
          el("line", { x1: xa, x2: xa, y1: top, y2: bot, stroke: pc, "stroke-opacity": 0.6 }),
          el("line", { x1: xb, x2: xb, y1: top, y2: bot, stroke: pc, "stroke-opacity": 0.6 }),
        );
        if (label.ends) {
          return;
        }
        const ta = clock(m.a);
        const tb = clock(m.b);
        if (free({ x0: xa - 4 - textW(ta), x1: xa - 4, y0: bot - 15, y1: bot - 1 })) {
          spanMarks.append(
            el("text", { x: xa - 4, y: bot - 4, "text-anchor": "end", fill: pc }, ta),
          );
        }
        if (free({ x0: xb + 4, x1: xb + 4 + textW(tb), y0: bot - 15, y1: bot - 1 })) {
          spanMarks.append(el("text", { x: xb + 4, y: bot - 4, fill: pc }, tb));
        }
      };
      const hideGuide = () => {
        guide.setAttribute("visibility", "hidden");
        dot.setAttribute("visibility", "hidden");
      };
      showAt = (sec) => {
        const x = X(sec);
        guide.setAttribute("x1", String(x));
        guide.setAttribute("x2", String(x));
        guide.setAttribute("visibility", "visible");
        dot.setAttribute("x", String(x - 3.5));
        dot.setAttribute("y", String(Y(gapAt(sec)) - 3.5));
        dot.setAttribute("visibility", "visible");
      };
      hideCursor = () => {
        showSpan(undefined);
        hideGuide();
        tip.hidden = true;
      };
      const secAt = (ev: MouseEvent) => secAtX(ev.clientX - svg.getBoundingClientRect().left);
      const near = (box: Box, px: number, py: number) =>
        px >= box.x0 && px <= box.x1 && py >= box.y0 - 2 && py <= box.y1 + 2;
      const showTipAbove = (content: HTMLElement, box: Box, px: number, width: number) => {
        tip.replaceChildren(content);
        tip.hidden = false;
        tip.style.left = `${Math.min(px + 14, width - 260)}px`;
        tip.style.top = `${Math.max(0, box.y0 - 34)}px`;
      };
      /** Small tooltip pinned to the top next to the cursor line */
      const showGapTip = (sec: number, px: number, width: number) => {
        const gp = gapAt(sec);
        const step = (who: Who) => {
          const st = stepAt(who, sec);
          return st ? h("div", { class: who }, st.text) : "";
        };
        const reached = sec <= (curve.at(-1)?.[0] ?? 0) && Math.abs(gp) >= 0.5;
        tip.replaceChildren(
          h(
            "div",
            { class: "tip-top" },
            h("b", null, clock(sec)),
            h(
              "span",
              { class: toneCls(gp) },
              Math.abs(gp) < 0.5 ? "even" : `${fmtDelta(gp)} ${gp > 0 ? "behind" : "ahead"}`,
            ),
          ),
          reached
            ? h("div", { class: "dim" }, `${them} here at ${clock(Math.max(0, sec - gp))}`)
            : "",
          step("you"),
          step("them"),
        );
        tip.hidden = false;
        const tw = tip.offsetWidth || 200;
        tip.style.left = `${px + 12 + tw > width ? px - 12 - tw : px + 12}px`;
        tip.style.top = `${top}px`;
      };
      hit.addEventListener("mousemove", (ev) => {
        const sec = secAt(ev);
        const r = svg.getBoundingClientRect();
        const px = ev.clientX - r.left;
        const py = ev.clientY - r.top;
        const over = labelled.find((q) => near(q.box, px, py));
        showSpan(over);
        const call = over ? undefined : called.find((q) => near(q.box, px, py));
        if (call) {
          showTipAbove(h("div", null, call.text), call.box, px, r.width);
          return;
        }
        if (over) {
          showTipAbove(h("div", { class: over.m.who }, tipText(over.m)), over.box, px, r.width);
          hideGuide();
          return;
        }
        const b = bandAt(bands, sec);
        if (!zoomed && b && b.phase !== hovered) {
          hovered = b.phase;
          paint();
        }
        showAt(sec);
        showGapTip(sec, px, r.width);
      });
      hit.addEventListener("mouseleave", () => {
        hideCursor();
        if (hovered) {
          hovered = null;
          paint();
        }
      });
      hit.addEventListener("click", (ev) => {
        const b = bandAt(bands, secAt(ev));
        if (b) {
          pick(b.phase);
        }
      });
    }
  }

  let anim = 0;
  function animateTo(target: typeof view) {
    const from = { ...view };
    const t0 = performance.now();
    cancelAnimationFrame(anim);
    const frame = (now: number) => {
      const k = Math.min(1, (now - t0) / 240);
      const e = 1 - (1 - k) ** 3;
      view = { x0: from.x0 + (target.x0 - from.x0) * e, x1: from.x1 + (target.x1 - from.x1) * e };
      paint();
      if (k < 1) {
        anim = requestAnimationFrame(frame);
      }
    };
    anim = requestAnimationFrame(frame);
  }
  const phaseView = (phase: string | null) => {
    const b = bands.find((x) => x.phase === phase);
    if (!b) {
      return { x0: 0, x1: xMax };
    }
    // The view covers both players in this phase, each on their own clock, with their splits and all their steps.
    const lo = Math.min(b.you0, b.them0, b.themFrom);
    const hi = Math.max(b.you1, b.them1, b.themTo);
    const pad = (hi - lo) * 0.06 + 2;
    return { x0: Math.max(0, lo - pad), x1: Math.min(xMax, hi + pad) };
  };

  wrap.geom = () => lastGeom;
  wrap.setPlayhead = (sec) => {
    if (sec === playhead) {
      return;
    }
    playhead = sec;
    paint();
  };
  wrap.select = (phase) => {
    selected = phase;
    zoomed = phase !== null;
    hovered = null;
    drawPills();
    drawStatus();
    if (still() || !prefs().zoomAnim) {
      view = phaseView(phase);
      paint();
    } else {
      animateTo(phaseView(phase));
    }
  };
  // The chart is reused when you come back to the race, so these listeners live until dispose() and survive detach.
  const life = new AbortController();
  wrap.dispose = () => life.abort();
  addEventListener(
    "keydown",
    (e) => {
      if (
        !wrap.isConnected ||
        e.key !== "Escape" ||
        !zoomed ||
        (e.target as HTMLElement).closest("input, select, textarea")
      ) {
        return;
      }
      e.preventDefault();
      pick(null);
    },
    { signal: life.signal },
  );
  drawSwitches();
  drawPills();
  drawStatus();
  new ResizeObserver(() => paint()).observe(svg);
  void document.fonts?.ready.then(() => {
    if (!life.signal.aborted) {
      paint();
    }
  });
  addEventListener("stratas-theme", () => paint(), { signal: life.signal });
  addEventListener(
    "stratas-prefs",
    () => {
      drawSwitches();
      paint();
    },
    { signal: life.signal },
  );
  return wrap;
}

export const STRIP_H = 82;
const S_RAIL = 16;
const S_TOP = 24;
const S_BOT = 66;

export interface GapStrip extends HTMLElement {
  dispose(): void;
  /** Playhead at a second (null hides it) */
  at(sec: number | null, note?: string): void;
  /** Phase open in the table */
  mark(phase: string | null): void;
  /** Stretch the curve layer (not text) by this much, from the curve top */
  fold(scale: number): void;
  /** Curve position inside the strip */
  plotTop: number;
  plotH: number;
}

/** The whole run in a band at the top while reading the splits. It is drawn at its own size so
 * text stays crisp, and a click jumps the table there. */
export function gapStrip(
  a: RaceAnalysis,
  opts: { seedType?: string | null; selected?: string | null; onPick?: (sec: number) => void } = {},
): GapStrip {
  const { curve } = buildDeltaModel(a);
  const bands = phaseBands(a);
  const gapAt = gapLookup(curve);
  const xMax = runEndSec(a, curve);
  const { gTop, gBot } = gapRange(curve, gapAt, 0, xMax, 0);
  const deaths = (a.report ?? [])
    .flatMap((r) => r.steps?.you ?? [])
    .filter((s) => s.kind === "death")
    .map((s) => ({ a: s.t0 / TICKS_PER_SEC, b: s.t1 / TICKS_PER_SEC }));
  const svg = el("svg", { class: "strip-svg", height: STRIP_H });
  const wrap = h("div", { class: "gap-strip" }, svg) as unknown as GapStrip;
  wrap.plotTop = S_TOP;
  wrap.plotH = S_BOT - S_TOP;
  let W = 0;
  let X = (s: number) => s;
  let current: string | null = null;
  let marked = opts.selected ?? null;
  let hover = false;
  let sec: number | null = null;
  let note = "";
  const Y = (g: number) => S_TOP + ((gTop - g) / (gTop - gBot)) * (S_BOT - S_TOP);
  // The playhead parts are drawn once, and later only their attributes change.
  const ph = el("g", { class: "strip-ph" });
  const phLine = el("line", { y1: S_RAIL + 2, y2: S_BOT + 2 });
  const phDot = el("rect", { width: 7, height: 7, rx: 1, class: "dot" });
  const phBg = el("rect", { height: 15, rx: 3, y: S_RAIL + 3, class: "bg" });
  const phText = el("text", { y: S_RAIL + 14 });
  ph.append(phLine, phBg, phText, phDot);
  const bandEls: { b: PhaseBand; rect: SVGRectElement; label: SVGGElement }[] = [];
  // The curve and backdrop stretch while the graph folds into the strip, and the text does not.
  const fold = el("g", { class: "strip-fold" });
  let foldBy = 1;
  const setFold = () =>
    fold.setAttribute(
      "transform",
      foldBy === 1
        ? ""
        : `translate(0 ${S_TOP}) scale(1 ${foldBy.toFixed(4)}) translate(0 ${-S_TOP})`,
    );

  function draw() {
    W = Math.round(svg.getBoundingClientRect().width);
    if (W < PAD_L + PAD_R + 40) {
      W = 0;
      return;
    }
    const L = PAD_L;
    const R = W - PAD_R;
    X = (s: number) => L + (s / xMax) * (R - L);
    svg.setAttribute("viewBox", `0 0 ${W} ${STRIP_H}`);
    svg.replaceChildren();
    fold.replaceChildren();
    bandEls.length = 0;
    const id = `gs${Math.random().toString(36).slice(2, 8)}`;
    const defs = el("defs", {});
    for (const [name, y, hgt] of [
      ["up", 0, Y(0)],
      ["dn", Y(0), STRIP_H],
    ] as const) {
      const c = el("clipPath", { id: id + name });
      c.appendChild(el("rect", { x: L, y, width: R - L, height: Math.max(0, hgt) }));
      defs.appendChild(c);
    }
    for (const [name, c] of [
      ["gu", "var(--bad)"],
      ["gd", "var(--good)"],
    ] as const) {
      const up = name === "gu";
      const gr = el("linearGradient", { id: id + name, x1: 0, x2: 0, y1: 0, y2: 1 });
      gr.append(
        el("stop", { offset: 0, "stop-color": c, "stop-opacity": up ? 0.32 : 0.04 }),
        el("stop", { offset: 1, "stop-color": c, "stop-opacity": up ? 0.04 : 0.36 }),
      );
      defs.appendChild(gr);
    }
    svg.append(defs, fold);

    bands.forEach((b, i) => {
      const xa = X(b.you0);
      const xb = X(b.you1);
      const w = xb - xa;
      const rect = el("rect", {
        x: xa,
        y: 0,
        width: Math.max(0, w),
        height: S_BOT + 2,
        class: `strip-band ${i % 2 ? "odd" : ""}`,
      });
      fold.appendChild(rect);
      if (i) {
        fold.appendChild(el("line", { x1: xa, x2: xa, y1: 2, y2: S_BOT + 2, class: "strip-sep" }));
      }
      const label = el("g", { class: "strip-lbl" });
      const key = phaseIconKey(b.phase, opts.seedType);
      const icon = key && w > 22 ? structIcon(key, 12) : null;
      let x = xa + 5;
      if (icon) {
        const fo = el("foreignObject", { x, y: 1, width: 12, height: 12 });
        fo.appendChild(icon);
        label.appendChild(fo);
        x += 16;
      }
      const delta = b.change !== null && Math.abs(b.change) >= 0.5 ? short(b.change) : "";
      const room = xb - x - 4;
      const brief = SHORT[b.phase] ?? b.phase;
      let name = "";
      if (textW(b.phase) + (delta ? textW(delta) : 0) <= room) {
        name = b.phase;
      } else if (textW(brief) <= room) {
        name = brief;
      }
      const t = el("text", { x, y: 11, class: "strip-name" }, name);
      if (delta && textW(name) + textW(delta) <= room) {
        t.appendChild(el("tspan", { fill: tone(b.change), dx: name ? 6 : 0 }, delta));
      }
      label.appendChild(t);
      label.appendChild(
        el(
          "title",
          {},
          `${b.phase}: ${b.you !== null ? clock(b.you) : "?"} for you, ${b.them !== null ? clock(b.them) : "?"} for ${a.them.name}${b.change !== null ? `, ${fmtDelta(b.change)}` : ""}`,
        ),
      );
      svg.appendChild(label);
      bandEls.push({ b, rect, label });
    });
    fold.appendChild(el("line", { x1: L, x2: R, y1: Y(0), y2: Y(0), class: "strip-zero" }));
    svg.appendChild(
      el("text", { x: L - 8, y: Y(0) + 4, "text-anchor": "end", class: "strip-axis" }, "even"),
    );
    if (Y(gTop) < Y(0) - 12) {
      svg.appendChild(
        el(
          "text",
          { x: L - 8, y: S_TOP + 8, "text-anchor": "end", class: "strip-axis" },
          short(gTop),
        ),
      );
    }
    if (Y(gBot) > Y(0) + 12) {
      svg.appendChild(
        el("text", { x: L - 8, y: S_BOT, "text-anchor": "end", class: "strip-axis" }, short(gBot)),
      );
    }
    for (const s of a.splits) {
      if (s.you !== null) {
        fold.appendChild(
          el("line", {
            x1: X(s.you / TICKS_PER_SEC),
            x2: X(s.you / TICKS_PER_SEC),
            y1: S_TOP - 3,
            y2: S_BOT,
            class: "strip-split",
          }),
        );
      }
    }
    const line = curvePath(curve, X, Y);
    const area = `${line}L${X(curve.at(-1)![0])} ${Y(0)}L${X(curve[0][0])} ${Y(0)}Z`;
    for (const [part, c, gr] of [
      ["up", "var(--bad)", "gu"],
      ["dn", "var(--good)", "gd"],
    ] as const) {
      const gg = el("g", { "clip-path": `url(#${id}${part})` });
      gg.append(
        el("path", { d: area, fill: `url(#${id}${gr})` }),
        el("path", {
          d: line,
          fill: "none",
          stroke: c,
          "stroke-width": 1.75,
          "stroke-linejoin": "round",
        }),
      );
      fold.appendChild(gg);
    }
    for (const d of deaths) {
      fold.appendChild(
        el("rect", {
          x: X(d.a),
          y: S_BOT - 2,
          width: Math.max(3, X(d.b) - X(d.a)),
          height: 3,
          rx: 1,
          fill: "var(--bad)",
        }),
      );
    }
    // The final gap is labelled, plus the most behind and ahead when that is not the end.
    const endX = X(curve.at(-1)![0]);
    const endT = short(a.finalGap);
    svg.appendChild(
      el(
        "text",
        {
          x: Math.min(endX + 6, R - textW(endT) + 4),
          y: Math.max(S_TOP + 9, Math.min(S_BOT - 2, Y(a.finalGap) + 4)),
          fill: tone(a.finalGap),
          class: "strip-end",
        },
        endT,
      ),
    );
    const peaks = [
      curve.reduce((m, p) => (p[1] > m[1] ? p : m), curve[0]),
      curve.reduce((m, p) => (p[1] < m[1] ? p : m), curve[0]),
    ];
    for (const [t, v] of peaks) {
      if (Math.abs(v) < 5 || Math.abs(v - a.finalGap) < 1 || endX - X(t) < 70) {
        continue;
      }
      // The peak label sits next to its dot, on the side away from zero.
      const x = X(t);
      const y = Y(v);
      const txt = short(v);
      const right = x + 6 + textW(txt) < R;
      svg.append(
        el("circle", { cx: x, cy: y, r: 2.5, fill: tone(v) }),
        el(
          "text",
          {
            x: right ? x + 6 : x - 6,
            y: Math.max(S_TOP + 4, Math.min(S_BOT - 1, y + (v > 0 ? -3 : 10))),
            "text-anchor": right ? "start" : "end",
            class: "strip-peak",
            fill: tone(v),
          },
          txt,
        ),
      );
    }
    const every =
      [60, 120, 180, 300, 600].find((v) => v >= xMax / Math.max(3, Math.floor((R - L) / 90))) ??
      600;
    for (let t = every; t < xMax - every / 3; t += every) {
      svg.appendChild(
        el(
          "text",
          { x: X(t), y: STRIP_H - 3, "text-anchor": "middle", class: "strip-axis" },
          clock(t),
        ),
      );
    }
    svg.appendChild(
      el("text", { x: L, y: STRIP_H - 3, "text-anchor": "middle", class: "strip-axis" }, "0:00"),
    );
    svg.appendChild(ph);
    const hit = el("rect", {
      x: L,
      y: 0,
      width: R - L,
      height: STRIP_H,
      fill: "transparent",
      class: "strip-hit",
    });
    const secOf = (ev: MouseEvent) =>
      Math.max(
        0,
        Math.min(xMax, ((ev.clientX - svg.getBoundingClientRect().left - L) / (R - L)) * xMax),
      );
    hit.addEventListener("mousemove", (ev) => {
      hover = true;
      const t = secOf(ev);
      const phase = bandAt(bands, t)?.phase ?? "";
      const gap = gapAt(t);
      const reached = t <= (curve.at(-1)?.[0] ?? 0) && Math.abs(gap) >= 0.5;
      const theirs = reached ? ` · ${a.them.name} at ${clock(Math.max(0, t - gap))}` : "";
      paintPh(t, `${phase}${theirs}`);
    });
    hit.addEventListener("mouseleave", () => {
      hover = false;
      paintPh(sec, note);
    });
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
    if (t === null || !W) {
      return;
    }
    const x = X(t);
    const g = gapAt(t);
    const cur = bandAt(bands, t)?.phase ?? null;
    if (cur !== current) {
      current = cur;
      paintBands();
    }
    phLine.setAttribute("x1", x.toFixed(1));
    phLine.setAttribute("x2", x.toFixed(1));
    phDot.setAttribute("x", (x - 3.5).toFixed(1));
    phDot.setAttribute("y", (Y(g) - 3.5).toFixed(1));
    const gapTone = tone(g);
    const even = gapTone === "var(--text-dim)";
    phDot.setAttribute("fill", even ? "var(--text)" : gapTone);
    const txt = `${clock(t)}  ${gapLabel(g)}${what ? `  ${what}` : ""}`;
    const w = textW(txt) + 6;
    const right = x + 8 + w < W - 4;
    const tx = right ? x + 8 : x - 8 - w;
    phText.textContent = "";
    phText.append(
      el("tspan", { class: "t" }, clock(t)),
      el("tspan", { dx: 7, fill: even ? "var(--text-mid)" : gapTone }, gapLabel(g)),
      what ? el("tspan", { dx: 7, class: "w" }, what) : "",
    );
    phText.setAttribute("x", (tx + 5).toFixed(1));
    phBg.setAttribute("x", tx.toFixed(1));
    phBg.setAttribute("width", w.toFixed(1));
  }
  wrap.at = (t, what = "") => {
    sec = t;
    note = what;
    if (!hover) {
      paintPh(t, what);
    }
  };
  wrap.fold = (by) => {
    if (Math.abs(by - foldBy) < 0.0005) {
      return;
    }
    foldBy = by;
    setFold();
  };
  wrap.mark = (phase) => {
    marked = phase;
    paintBands();
  };
  new ResizeObserver(() => draw()).observe(svg);
  const life = new AbortController();
  wrap.dispose = () => life.abort();
  addEventListener("stratas-theme", () => draw(), { signal: life.signal });
  return wrap;
}
