// Find runs page: pick an opponent Elo, narrow the seed, fetch recent wins by stronger players and queue them
import { g, type AppState, type Pick, type PickOptions } from "../bridge";
import { ago, deltaClass, fmtDelta, fmtMs, h, nice, toast } from "../dom";
import { btn, fold, head, panel, rank, tierName } from "../parts";
import { structIcon } from "../ranked";

const OVERWORLD = ["VILLAGE", "BURIED_TREASURE", "SHIPWRECK", "DESERT_TEMPLE", "RUINED_PORTAL"];
const BASTION = ["BRIDGE", "HOUSING", "STABLES", "TREASURE"];
type Level = "mix" | "next" | "stretch" | "ceiling" | "custom";

let picks: Pick[] = [];
let chosen = new Set<number>();
const revealed = new Set<number>();
let notes: string[] = [];
let busy = false;
let searched = false;
let count = 3;
// Just this player's runs instead of the Elo pick. Not saved, it's usually a one off
let player = "";

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const levelOf = (p: AppState["settings"]["pick"]): Level => (p.mode === "manual" ? "custom" : p.lockTier ?? "mix");

type Band = "next" | "stretch" | "ceiling";
const BANDS: Band[] = ["next", "stretch", "ceiling"];
const SHARE: Record<Band, number> = { next: 60, stretch: 30, ceiling: 10 };
const plus = (n: number) => (n >= 0 ? `+${n}` : `−${-n}`);

/** Your races vs a level and the average gap */
function record(s: AppState, tier: string) {
  const rs = s.races.filter((r) => r.tier === tier && !r.error);
  if (!rs.length) return h("span", { class: "dim" }, "no games yet");
  const avg = rs.reduce((n, r) => n + r.finalGap, 0) / rs.length;
  return h("span", null, `${rs.length} game${rs.length === 1 ? "" : "s"} · avg `, h("span", { class: deltaClass(avg) }, fmtDelta(avg)));
}

// Picked row pops once, background redraws don't replay it
let popped: Level | null = null;
let sent: { from: AppState["settings"]["pick"]; pick: AppState["settings"]["pick"] } | null = null;

/** Opponent Elo list, a row per choice with range, ranks, mini ladder vs you and your record there. Mix lights all three */
// An empty box means no limit, not 0
const elo = (e: Event) => { const v = (e.target as HTMLInputElement).value.trim(); return v === "" ? undefined : Number(v); };

function levelList(s: AppState, p: AppState["settings"]["pick"], set: (l: Level) => void, save: (patch: Partial<PickOptions>) => void) {
  const t = s.tiers!, you = s.you.elo!, level = levelOf(p);
  // Swap them if the from is bigger than the to
  const range = (patch: Partial<PickOptions>) => {
    const lo = "minElo" in patch ? patch.minElo : p.minElo, hi = "maxElo" in patch ? patch.maxElo : p.maxElo;
    return lo !== undefined && hi !== undefined && lo > hi ? { minElo: hi, maxElo: lo } : { minElo: lo, maxElo: hi };
  };
  const lo = Math.floor((you - 100) / 100) * 100, hi = Math.max(t.ceiling[0] + 300, t.stretch[1] + 300);
  const X = (e: number) => ((Math.min(Math.max(e, lo), hi) - lo) / (hi - lo)) * 100;
  const seg = (k: string, a: number, b: number) => h("i", { class: `lvl-seg ${k}`, style: `left:${X(a)}%;width:${Math.max(1.5, X(Math.min(b, hi)) - X(a))}%` });
  const track = (...segs: HTMLElement[]) => h("span", { class: "lvl-track", "aria-hidden": "true" }, ...segs, h("b", { class: "lvl-you", style: `left:${X(you)}%` }));
  const pick = (k: Level) => { popped = k; set(k); };
  const row = (k: Level, cls: string, i: number, kids: (HTMLElement | string | null | (HTMLElement | string | null)[])[]) => {
    const on = level === k, inMix = level === "mix" && (k === "next" || k === "stretch" || k === "ceiling");
    return h("div", { class: `lvl ${cls} ${on ? "on" : ""} ${inMix ? "in-mix" : ""} ${popped === k ? "pop" : ""}`, role: "radio", tabindex: on ? "0" : "-1", "aria-checked": String(on), style: `--i:${i}`,
      onclick: () => { if (!on) pick(k); },
      onkeydown: (e: KeyboardEvent) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!on) pick(k); }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const all = [...(e.currentTarget as HTMLElement).parentElement!.children] as HTMLElement[];
          all[(all.indexOf(e.currentTarget as HTMLElement) + (e.key === "ArrowDown" ? 1 : all.length - 1)) % all.length].focus();
        }
      } },
      h("span", { class: "lvl-pip" }), ...kids.flat());
  };
  const rows = [
    row("mix", "lvl-mix", 0, [
      h("span", { class: "lvl-name" }, "Mix"),
      h("span", { class: "lvl-what" }, h("span", { class: "dim" }, `mostly ${t.next[0]}+, some ${t.stretch[0]}+, now and then ${t.ceiling[0]}+`)),
      track(...BANDS.map((b) => seg(`tier-${b}`, t[b][0], t[b][1]))),
      h("span", { class: "lvl-rec" }, BANDS.map((b, n) => [n ? h("span", { class: "dim" }, " / ") : null, h("span", { class: `tier-${b}` }, String(SHARE[b]))])),
      h("span", { class: "lvl-share" }),
    ]),
    ...BANDS.map((b, n) => {
      const [a, z] = t[b], top = z >= 4000;
      return row(b, `tier-${b}`, n + 1, [
        h("span", { class: "lvl-name" }, `${a}+`),
        h("span", { class: "lvl-what" }, h("span", { class: "lvl-rel" }, top ? `${plus(a - you)} and up` : `${plus(a - you)} to ${plus(z - you)}`), rank(a, "lv-rank"),
          ...(top ? [] : [h("span", { class: "dim" }, "→"), rank(z, "lv-rank")])),
        track(seg(`tier-${b}`, a, z)),
        h("span", { class: "lvl-rec" }, record(s, b)),
        h("span", { class: "lvl-share" }, level === "mix" ? `${SHARE[b]}%` : ""),
      ]);
    }),
    row("custom", "lvl-custom", 4, [
      h("span", { class: "lvl-name" }, "Custom"),
      h("span", { class: "lvl-what" }, level === "custom"
        ? h("span", { class: "lvl-inputs", onclick: (e: Event) => e.stopPropagation(), onkeydown: (e: Event) => e.stopPropagation() },
          h("input", { id: "emin", type: "number", value: String(p.minElo ?? ""), "aria-label": "from Elo", onchange: (e: Event) => save(range({ minElo: elo(e) })) }),
          h("span", { class: "dim" }, "to"),
          h("input", { id: "emax", type: "number", value: String(p.maxElo ?? ""), "aria-label": "to Elo", onchange: (e: Event) => save(range({ maxElo: elo(e) })) }))
        : h("span", { class: "dim" }, "any range you like")),
      level === "custom" && p.minElo && p.maxElo ? track(seg("lvl-own", p.minElo, p.maxElo)) : track(),
      h("span", { class: "lvl-rec" }, record(s, "manual")),
      h("span", { class: "lvl-share" }),
    ]),
  ];
  popped = null;
  return h("div", { class: "lvl-list", role: "radiogroup", "aria-label": "Opponent Elo" }, rows);
}

function chips(values: string[], current: string | null | undefined, onPick: (v: string | null) => void) {
  return h("div", { class: "chips" },
    h("button", { class: `chip2 ${!current ? "on" : ""}`, onclick: () => onPick(null) }, "Any"),
    values.map((v) => h("button", { class: `chip2 ${current === v ? "on" : ""}`, onclick: () => onPick(current === v ? null : v) }, structIcon(v), cap(nice(v)))));
}

export function findView(s: AppState, rerender: () => void) {
  // Saves while a field is focused don't redraw, so p can be stale. Build on what we sent until a new state
  // comes in or the next save undoes the last one
  if (sent?.from !== s.settings.pick) sent = null;
  const p = sent?.pick ?? s.settings.pick;
  const save = (patch: Partial<PickOptions>) => {
    sent = { from: s.settings.pick, pick: { ...p, ...(sent?.pick ?? {}), ...patch } };
    void g.settings({ pick: sent.pick });
  };
  const setLevel = (l: Level) => {
    if (l === "custom") save({ mode: "manual", minElo: p.minElo ?? (s.you.elo ?? 1200) + 100, maxElo: p.maxElo ?? (s.you.elo ?? 1200) + 500 });
    else save({ mode: "auto", lockTier: l === "mix" ? null : l });
  };
  const find = async () => {
    if (busy) return;
    busy = true; rerender();
    try { const r = await g.pick({ ...p, count, player: player.trim() || null }); picks = r.picks; notes = r.notes; chosen = new Set(picks.map((x) => x.match.id)); }
    catch (e) { notes = [(e as Error).message]; picks = []; }
    busy = false; searched = true; rerender();
  };
  const queue = async () => {
    const list = picks.filter((x) => chosen.has(x.match.id));
    if (!list.length) return;
    await g.enqueue(list);
    toast(`Queued ${list.length} ${list.length === 1 ? "run" : "runs"}`);
    picks = []; notes = []; searched = false; rerender();
  };
  const index = s.index.scanning ? "Updating the match index" : s.index.error ? `Match index error: ${s.index.error}` : `${s.index.matches.toLocaleString()} matches indexed, ${s.index.apiLeft} API calls left`;

  return h("div", { class: "page" },
    howItWorks(s),
    panel(null, null,
      h("div", { class: "p-head" }, h("h2", null, "Player")),
      h("div", { class: "row find-who" },
        h("input", { id: "who", type: "text", placeholder: "Minecraft name", value: player, spellcheck: "false", autocomplete: "off", "aria-label": "Player name",
          oninput: (e: Event) => { player = (e.target as HTMLInputElement).value; },
          onchange: () => rerender(),
          onkeydown: (e: KeyboardEvent) => { if (e.key === "Enter") { player = (e.target as HTMLInputElement).value; void find(); } } }),
        player.trim() ? btn("Clear", () => { player = ""; rerender(); }, { ghost: true, sm: true }) : null,
        h("span", { class: "dim" }, player.trim() ? `Only ${player.trim()}'s recent wins, any Elo` : "Leave it empty to pick by Elo, or type a name to race one player"))),
    panel(null, { cls: player.trim() ? "find-off" : "" },
      h("div", { class: "p-head" }, h("h2", null, "Opponent Elo"),
        s.you.elo ? h("span", { class: "lv-me" }, rank(s.you.elo, "lv-rank"), s.you.rank ? h("span", { class: "dim" }, `#${s.you.rank}`) : null) : null),
      s.tiers && s.you.elo ? levelList(s, p, setLevel, save)
        : h("p", { class: "dim", style: "margin:0" }, s.settings.nickname
          ? `No Elo for ${s.settings.nickname} yet. It shows up after a ranked game this season, or once Stratas can reach the API.`
          : "Set your Minecraft name in Settings so Stratas knows your Elo.")),
    panel(null, null,
      h("div", { class: "p-head" }, h("h2", null, "Seed")),
      h("dl", { class: "dl" },
        h("dt", null, "Overworld"), h("dd", null, chips(OVERWORLD, p.seedType, (v) => save({ seedType: v }))),
        h("dt", null, "Bastion"), h("dd", null, chips(BASTION, p.bastionType, (v) => save({ bastionType: v }))))),
    panel(null, { cls: "find-bar" },
      h("label", { class: "inline" }, "Show",
        h("input", { id: "count", type: "number", min: "1", max: "10", value: String(count), onchange: (e: Event) => { count = Math.max(1, Math.min(10, Number((e.target as HTMLInputElement).value) || 3)); } }),
        "runs"),
      h("label", { class: "inline" }, "finished in under",
        h("input", { id: "maxt", type: "number", min: "5", max: "30", placeholder: "any", value: p.maxTime ? String(Math.round(p.maxTime / 60)) : "",
          onchange: (e: Event) => { const v = Number((e.target as HTMLInputElement).value); save({ maxTime: v ? v * 60 : null }); } }),
        "minutes"),
      h("span", { class: "dim find-index" }, index),
      btn(busy ? "Searching…" : "Find runs", find, { primary: true, key: "f", disabled: busy })),
    searched ? results(s, rerender, queue) : null);
}

function results(s: AppState, rerender: () => void, queue: () => void) {
  return panel(null, null,
    h("div", { class: "p-head" }, h("h2", null, picks.length ? "Runs to practice" : "No runs found"),
      picks.length ? h("span", { class: "dim" }, `${chosen.size} of ${picks.length} picked`) : null),
    picks.length ? h("table", { class: "plain picks" },
      h("tr", null, h("th"), h("th", null, "Player"), h("th", null, "Elo"), h("th", null, "Level"), h("th", null, "Seed"), h("th", null, "Played"), h("th", { class: "grow" }, "Time")),
      picks.map((x) => {
        const m = x.match, on = chosen.has(m.id), shown = revealed.has(m.id);
        return h("tr", { class: on ? "" : "off" },
          h("td", null, h("input", { type: "checkbox", class: "toggle", checked: on, "aria-label": `Queue ${m.winner_name}`,
            onchange: (e: Event) => { (e.target as HTMLInputElement).checked ? chosen.add(m.id) : chosen.delete(m.id); rerender(); } })),
          h("td", null, h("span", { class: "who-sm" }, head({ uuid: m.winner_uuid, name: m.winner_name ?? "?" }, 20), m.winner_name)),
          h("td", null, rank(m.winner_elo)),
          h("td", { class: x.tier !== "manual" && x.tier !== "player" ? `tier-${x.tier}` : "dim" }, tierName(s.tiers, x.tier)),
          h("td", null, h("span", { class: "who-sm" }, structIcon(m.seed_type), structIcon(m.bastion_type), `${cap(nice(m.seed_type))}, ${nice(m.bastion_type)}`)),
          h("td", { class: "dim" }, ago(m.date)),
          // Hidden till clicked so the winning time doesn't set your pace
          h("td", { class: "grow" }, h("button", { class: `spoiler ${shown ? "shown" : ""}`, onclick: () => { revealed.add(m.id); rerender(); } }, fmtMs(m.time))));
      })) : null,
    notes.map((n) => h("p", { class: "dim", style: "margin:8px 0 0" }, n.replace(/ · /g, ", "))),
    picks.length ? h("div", { class: "row", style: "justify-content:flex-end;margin-top:12px" }, btn(`Queue ${chosen.size}`, queue, { primary: true, key: "q", disabled: !chosen.size })) : null);
}

/** The whole practice loop, open until you've got something in the queue or played a race */
function howItWorks(s: AppState) {
  const step = (n: number, title: string, ...text: (string | HTMLElement)[]) => h("li", { class: "how-step" },
    h("span", { class: "how-n" }, String(n)), h("div", null, h("b", null, title), h("div", { class: "dim" }, ...text)));
  return fold(h("h2", null, "How practice works"), !s.queue.length && !s.races.some((r) => r.kind === "race"), "how",
    h("ol", { class: "how-list" },
      step(1, "Find runs", "Pick an Elo and a seed type, then queue the runs you want to play."),
      step(2, "Download their replay", "In Ranked: Profile, search their name, Recent Matches, Download Replay. Ranked only keeps recent games, so do it soon. The seed then shows up on the Practice page."),
      step(3, "Play the seed in a private room", "Copy the World and Nether seed from the Practice page and set them in the room. The room rules are on the Practice page too."),
      step(4, "Get at least an iron pickaxe", h("span", { class: "warn" }, "Ranked only saves private room replays once you have an iron pickaxe."), " Reset before that and there's no replay to mix."),
      step(5, "See where the time went", "Right after the run you get your splits next to theirs, straight from Ranked. Once your replay is saved, it turns into the full race: both of you in one replay, and where and why you lost time.")));
}

export function roomRules() {
  const rule = (st: "on" | "off", text: string) => h("div", { class: "set-row" },
    h("span", { class: `chip`, style: `color:var(${st === "on" ? "--good" : "--bad"});border-color:currentColor;width:58px;text-align:center` }, st),
    h("div", { class: "name" }, text));
  return fold(h("h2", null, "Private room rules"), false, "",
    rule("on", "World seed and Nether seed"),
    rule("on", "Generate Artificial Lava Pools"),
    rule("on", "Modified Piglin Barters, Modified Portal Behaviors, Standardized Dragon Perch"),
    rule("off", "Beginner Mode, Hardcore, Icarus, Half-Heart, Cheat Commands"),
    rule("off", "Disable Public Replay"));
}
