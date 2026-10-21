// Settings: a section at a time from the side list, or everything that matches a search. Rows changed from the
// default are marked and can be reset
import { customTheme, DEFAULT_PREFS, THEME_KEYS, THEMES, type Prefs, type ThemeColors } from "../../core/prefs";
import type { OldArt } from "../../core/oldart";
import { rankOf } from "../../core/tiers";
import { g, type AppState } from "../bridge";
import { h, toast } from "../dom";
import { artUrl, celebrate, prefs, rankColor, savePrefs, themeColors } from "../prefs";
import { reportProblem, suggestFeature } from "../problem";
import { DISCORD_URL, openKofi } from "../support";
import { updateSetting } from "../update";
import { isWeb, pickReplays } from "../web";

export let themeInfo: { file: string; found: boolean } = { file: "~/.config/stratas/colors.css", found: false };
export function setThemeInfo(t: { file: string; found: boolean }) { themeInfo = t; }

type Child = Parameters<typeof h>[2];
type Opt<K extends keyof Prefs> = [Prefs[K], string];
type Section = "theme" | "background" | "effects" | "graph" | "splits" | "analysis" | "companion" | "system";
const SECTIONS: [Section, string][] = [
  ["theme", "Theme"], ["background", "Background"], ["effects", "Effects"], ["graph", "Graph"], ["splits", "Splits overview"],
  ["analysis", "Analysis"], ["companion", "Companion and keys"], ["system", "System"],
];

// Kept across redraws: the open section, the search, older Ranked backgrounds and whether they're being looked for
let section: Section = (() => { try { return (localStorage.getItem("settings.section") as Section) || "theme"; } catch { return "theme"; } })();
let query = "";
let oldArt: OldArt[] | null = null;
let looking = false;

export function settingsView(s: AppState, rerender: () => void) {
  const st = s.settings, gate = s.gate, p = prefs();
  if (oldArt === null) { oldArt = []; void g.oldArt().then((l) => { oldArt = l; if (l.length) rerender(); }).catch(() => {}); }

  // ---- controls
  const row = (label: string, control: Child, o: { hint?: string; key?: keyof Prefs | (keyof Prefs)[]; extra?: Child } = {}) => {
    const keys = o.key === undefined ? [] : Array.isArray(o.key) ? o.key : [o.key];
    const changed = keys.some((k) => p[k] !== DEFAULT_PREFS[k]);
    return h("div", { class: `sx-row ${changed ? "ch" : ""}`, "data-q": `${label} ${o.hint ?? ""}`.toLowerCase() },
      h("div", { class: "k" }, h("span", null, label), o.hint ? h("small", null, o.hint) : null),
      h("div", { class: "v" }, control, o.extra ?? null),
      changed ? h("button", { class: "rs", title: "Back to default", "aria-label": `Reset ${label}`, onclick: () => savePrefs(Object.fromEntries(keys.map((k) => [k, DEFAULT_PREFS[k]]))) }, "↺") : h("span", { class: "rs" }));
  };
  const tog = (on: boolean, set: (v: boolean) => void, label = "") =>
    h("button", { class: `sx-t ${on ? "on" : ""}`, role: "switch", "aria-checked": String(on), "aria-label": label, onclick: () => set(!on) }, h("i"));
  const ptog = <K extends keyof Prefs>(key: K, label = "") => tog(p[key] as boolean, (v) => savePrefs({ [key]: v }), label);
  const opt = <K extends keyof Prefs>(key: K, opts: Opt<K>[]) => h("span", { class: "sx-o", role: "radiogroup" },
    opts.map(([v, label]) => h("button", { class: p[key] === v ? "on" : "", role: "radio", "aria-checked": String(p[key] === v), onclick: () => savePrefs({ [key]: v }) }, label)));
  const num = <K extends keyof Prefs>(key: K, min: number, max: number, step: number, fmt: (n: number) => string) => {
    const v = p[key] as number, set = (n: number) => savePrefs({ [key]: Math.round(Math.max(min, Math.min(max, n)) * 100) / 100 });
    return h("span", { class: "sx-n" },
      h("button", { "aria-label": "Less", disabled: v <= min, onclick: () => set(v - step) }, "−"),
      h("em", null, fmt(v)),
      h("button", { "aria-label": "More", disabled: v >= max, onclick: () => set(v + step) }, "+"));
  };
  // A grid of checkboxes under a row, for picking several things at once
  const checks = (label: string, items: [keyof Prefs, string, string?][], hint?: string) => {
    const keys = items.map(([k]) => k), changed = keys.some((k) => p[k] !== DEFAULT_PREFS[k]);
    return h("div", { class: `sx-row sx-block ${changed ? "ch" : ""}`, "data-q": `${label} ${hint ?? ""} ${items.map(([, l]) => l).join(" ")}`.toLowerCase() },
      h("div", { class: "k" }, h("span", null, label), hint ? h("small", null, hint) : null),
      changed ? h("button", { class: "rs", title: "Back to default", "aria-label": `Reset ${label}`, onclick: () => savePrefs(Object.fromEntries(keys.map((k) => [k, DEFAULT_PREFS[k]]))) }, "↺") : h("span", { class: "rs" }),
      h("div", { class: "sx-checks" }, items.map(([k, l, color]) => h("label", { class: p[k] ? "on" : "" },
        h("input", { type: "checkbox", checked: !!p[k], onchange: () => savePrefs({ [k]: !p[k] }) }),
        color ? h("i", { class: "dot", style: `background:${color}` }) : null, l))));
  };
  const key = (k: "keyWatch" | "keyCompanion") => h("input", { class: "sx-key", type: "text", maxlength: 1, value: p[k].toUpperCase(), "aria-label": "Key",
    onfocus: (e: Event) => (e.target as HTMLInputElement).select(),
    oninput: (e: Event) => { const el = e.target as HTMLInputElement; const c = el.value.slice(-1).toLowerCase(); el.value = c.toUpperCase(); if (/^[a-z0-9]?$/.test(c)) savePrefs({ [k]: c }); } });
  const btn = (label: string, fn: () => void, title?: string) => h("button", { class: "sx-btn", title, onclick: fn }, label);
  const group = (name: string, rows: Child[]) => h("div", { class: "sx-group" }, h("div", { class: "sx-gh" }, name), rows);
  const x = (n: number) => `${n}×`, secs = (n: number) => `${n} s`, pct = (n: number) => `${n}%`, plain = (n: number) => String(n);
  const dot = (ok: "good" | "bad" | "warn", text: string) => h("span", { class: `sx-status ${ok}` }, text);

  // ---- theme: preset cards, then the colours of the one in use
  const shown = themeColors() ?? THEMES[0].c;
  const card = (id: string, name: string, c: ThemeColors | null, sub?: string) =>
    h("button", { class: `sx-theme ${p.theme === id ? "on" : ""}`, onclick: () => savePrefs({ theme: id, ...(id === "custom" && !p.themeCustom ? { themeCustom: JSON.stringify(shown) } : {}) }),
      style: c ? `--tb:${c.bg};--tt:${c.text}` : "" },
      h("span", { class: "pv" }, h("b", null, "Aa"), c ? [c.accent, c.you, c.them, c.good, c.bad].map((col) => h("i", { style: `background:${col}` })) : h("span", { class: "auto" }, "file")),
      h("span", { class: "nm" }, name, sub ? h("small", null, sub) : null));
  const editColor = (k: keyof ThemeColors, label: string) => h("label", { class: "sx-color" },
    h("input", { type: "color", value: shown[k], "aria-label": label,
      oninput: (e: Event) => savePrefs({ theme: "custom", themeCustom: JSON.stringify({ ...shown, [k]: (e.target as HTMLInputElement).value }) }) }),
    h("span", null, label, h("small", null, shown[k])));
  const paste = h("input", { class: "sx-in", type: "text", placeholder: "paste a theme code", "aria-label": "Theme code" });
  const theme = [
    group("Presets", [
      h("div", { class: "sx-themes", "data-q": "theme preset colours palette" },
        card("auto", "Auto", null, themeInfo.found ? "matugen" : "Stratas"),
        THEMES.map((t) => card(t.id, t.name, t.c)),
        card("custom", "Custom", customTheme(p.themeCustom || JSON.stringify(shown)))),
    ]),
    group(p.theme === "auto" ? "Colours (edit one to make your own)" : "Colours", [
      h("div", { class: "sx-colors", "data-q": "colours colors background text accent you opponent gain loss highlight custom" }, THEME_KEYS.map(([k, l]) => editColor(k, l))),
      row("Share", h("span", { class: "sx-share" }, paste,
        btn("apply", () => { const v = paste.value.trim(); try { JSON.parse(v); savePrefs({ theme: "custom", themeCustom: JSON.stringify(customTheme(v)) }); toast("Theme applied"); } catch { toast("That isn't a theme code"); } }),
        btn("copy", () => { void g.copy(JSON.stringify(shown)); toast("Theme code copied"); })), { hint: "copy yours, or paste someone else's" }),
      row("Accent from your rank", ptog("rankAccent", "Accent from your rank"), { key: "rankAccent", hint: s.you.elo ? `${rankOf(s.you.elo).name}, ${rankColor(s.you.elo)}` : "once you have an Elo" }),
    ]),
    group("Text and shape", [
      row("Font", opt("font", [["pixel", "pixel"], ["system", "system"]]), { key: "font" }),
      row("Size", num("scale", 80, 130, 5, pct), { key: "scale" }),
      row("Corners", opt("corners", [["pixel", "stepped"], ["square", "square"]]), { key: "corners" }),
    ]),
  ];

  // ---- background: image tiles with thumbnails, loaded when shown
  const tile = (k: string, label: string, sub?: string) => {
    const img = h("span", { class: "img" });
    if (k !== "off") void artUrl(k).then((u) => { if (u) img.style.backgroundImage = `url("${u}")`; });
    return h("button", { class: `sx-tile ${p.art === k ? "on" : ""}`, onclick: () => savePrefs({ art: k }) }, img, h("span", { class: "nm" }, label, sub ? h("small", null, sub) : null));
  };
  const background = [
    group("Image", [
      h("div", { class: "sx-tiles", "data-q": "background image ranked menu old" },
        tile("menu", "Current menu", "blurred"), tile("menu_sharp", "Current menu", "sharp"),
        // The one your installed Ranked still uses is already the first two tiles
        (oldArt ?? []).filter((a) => !gate.version || !a.versions.split("–").at(-1)!.startsWith(gate.version.split(".").slice(0, 2).join("."))).map((a) => tile(a.key, a.label, "older release")),
        tile("off", "None")),
      row("Older Ranked menus", h("span", { class: "dim" }, looking ? "looking…" : oldArt?.length ? `${oldArt.length} found` : "not looked yet"),
        { hint: "looks through past MCSR Ranked releases on Modrinth", extra: btn(oldArt?.length ? "look again" : "find them", async () => {
          if (looking) return;
          looking = true; rerender();
          try { oldArt = await g.fetchOldArt(); toast(oldArt.length ? `Found ${oldArt.length} older backgrounds` : "No older backgrounds found"); }
          catch (e) { toast(`Couldn't reach Modrinth: ${(e as Error).message}`); }
          looking = false; rerender();
        }) }),
    ]),
    group("Look", [
      row("Blur", num("artBlur", 0, 20, 2, (n) => `${n} px`), { key: "artBlur" }),
      row("Dimming", num("artDim", 30, 95, 5, pct), { key: "artDim", hint: "higher is darker, easier to read over" }),
    ]),
  ];

  const effects = [
    group("Over the background", [
      row("Effect", opt("effect", [["snow", "snow"], ["embers", "embers"], ["stars", "stars"], ["off", "off"]]), { key: "effect" }),
      row("Amount", num("effectAmount", 0.25, 3, 0.25, x), { key: "effectAmount" }),
      row("Speed", num("effectSpeed", 0.25, 3, 0.25, x), { key: "effectSpeed" }),
    ]),
    group("Motion", [
      row("Animations", opt("motion", [["system", "system"], ["full", "full"], ["reduced", "reduced"]]), { key: "motion", hint: "system follows your desktop's setting" }),
      row("Win celebration", opt("celebrate", [["confetti", "confetti"], ["sparks", "sparks"], ["off", "off"]]), { key: "celebrate", hint: "when you open a game you won",
        extra: btn("try", () => celebrate(p.celebrate === "off" ? "confetti" : p.celebrate)) }),
    ]),
  ];

  const M = (v: string) => `var(${v})`;
  const graph = [
    group("Moments", [
      row("Show them", opt("moments", [["curve", "on the curve"], ["rail", "as labels"], ["list", "as a list"], ["off", "hidden"]]), { key: "moments" }),
      row("Whose", opt("momentsOf", [["both", "both"], ["you", "yours"], ["them", "theirs"]]), { key: "momentsOf" }),
      row("Skip shorter than", num("minMoment", 0, 60, 5, secs), { key: "minMoment", hint: "deaths, crafts and the End always show" }),
      checks("Which", [
        ["mOwCraft", "Overworld crafting", M("--accent")], ["mTrade", "trades", M("--warn")], ["mKit", "left the bastion with", M("--warn")],
        ["mPearls", "pearls to the fortress", M("--them")], ["mBlaze", "rods", M("--bad")], ["mBlast", "blaze bed", M("--bad")],
        ["mCraft", "precrafts", M("--accent")], ["mPortal", "portals", M("--them")], ["mEyes", "eyes", M("--them")],
        ["mZero", "zero cycle", M("--warn")], ["mPerch", "perches", M("--warn")], ["mKill", "free the End", M("--good")],
        ["mDone", "finish", M("--text")], ["mDead", "deaths", M("--bad")],
      ]),
    ]),
    group("Layers", [
      row("Split lines", ptog("splits"), { key: "splits" }),
      row("Phase names", ptog("phaseNames"), { key: "phaseNames", hint: "and their time bars, under the graph" }),
      row("Phase time bars", ptog("times"), { key: "times" }),
      row("Lead shading", ptog("lead"), { key: "lead", hint: "who was gaining, instead of ahead or behind" }),
      row("Times at line ends", ptog("lineTimes"), { key: "lineTimes" }),
    ]),
    group("Costs", [
      row("Listed above the graph", num("costs", 0, 6, 1, plain), { key: "costs" }),
      row("Called out when zoomed in", num("callouts", 0, 12, 1, plain), { key: "callouts" }),
    ]),
    group("Style", [
      row("Curve thickness", num("curveWidth", 1, 4, 0.5, plain), { key: "curveWidth" }),
      row("Text outline", num("outline", 0, 100, 5, pct), { key: "outline" }),
      row("Zoom animation", ptog("zoomAnim"), { key: "zoomAnim" }),
    ]),
  ];

  const splits = [
    group("Table", [
      checks("Columns", [["colDelta", "± per split"], ["colGap", "gap"], ["colWatch", "watch at"]]),
      row("Split rows", ptog("splitRows"), { key: "splitRows", hint: "off shows one row per phase" }),
      row("Splits only one of you reached", ptog("unreached"), { key: "unreached" }),
    ]),
    group("Inside a phase", [
      row("Cost rows", ptog("costRows"), { key: "costRows", hint: "first trade, trading, crafting…" }),
      row("Breakdown under costs", ptog("costDetail"), { key: "costDetail" }),
      row("Crafts table", ptog("craftsTable"), { key: "craftsTable", hint: "in the Overworld" }),
      row("Trades table", ptog("tradesTable"), { key: "tradesTable", hint: "in the bastion" }),
      checks("Notes", [["nTrading", "trading"], ["nDeaths", "deaths"], ["nOverworld", "Overworld"], ["nNether", "Nether"], ["nPrecraft", "precrafts"], ["nEnd", "stronghold and End"], ["nOther", "other"]]),
      row("Play by play", opt("playByPlay", [["closed", "folded"], ["open", "open"], ["hidden", "hidden"]]), { key: "playByPlay" }),
    ]),
  ];

  const analysis = [
    group("Done trading once you have", [
      row("Pearls", num("leavePearls", 0, 64, 2, plain), { key: "leavePearls" }),
      row("Obsidian", num("leaveObsidian", 0, 64, 2, plain), { key: "leaveObsidian" }),
      row("String", num("leaveString", 0, 128, 4, plain), { key: "leaveString" }),
      row("Apply to old games", btn("re-analyse", async () => { await g.reanalyze(); toast("Re-analysing"); }), { hint: "they keep the old numbers until then" }),
    ]),
  ];

  const companion = [
    group("Companion window", [
      row("Keep on top", ptog("companionOnTop"), { key: "companionOnTop", hint: "over Minecraft" }),
      row("Open when a game is ready", ptog("companionAuto"), { key: "companionAuto" }),
    ]),
    group("Keys in a game", [
      row("Watch in Ranked", key("keyWatch"), { key: "keyWatch" }),
      row("Open companion", key("keyCompanion"), { key: "keyCompanion" }),
    ]),
  ];

  const system = [
    group("Updates", [
      (() => { const u = updateSetting((label, fn) => btn(label, fn)); return row("Stratas", u.control, { hint: u.hint }); })(),
    ]),
    group("Help", [
      row("Something broken?", btn("report a problem", () => void reportProblem(s)), { hint: "copies your version and activity log, then opens a GitHub issue to paste them in" }),
      row("Missing something?", btn("suggest a feature", suggestFeature), { hint: "opens a GitHub issue" }),
      row("Discord", btn("join", () => { window.open(DISCORD_URL, "_blank", "noopener"); }), { hint: "ask questions, share runs, hear about updates first" }),
      row("GitHub", btn("open", () => { window.open("https://github.com/himetau/stratas", "_blank"); }), { hint: "the code, releases and issues" }),
    ]),
    group("Support", [
      row("Support Stratas", h("button", { class: "sx-btn sx-kofi", onclick: openKofi }, "☕ Ko-fi"), { hint: "it's free and made by one person, tips keep it going" }),
    ]),
    group("You", [
      row("Minecraft name", h("input", { class: "sx-in", type: "text", value: st.nickname ?? "", placeholder: "your name", "aria-label": "Minecraft name",
        onchange: (e: Event) => g.settings({ nickname: (e.target as HTMLInputElement).value.trim() || null }) }),
        { hint: s.you.elo ? `${s.you.elo} Elo${s.you.rank ? `, #${s.you.rank}` : ""}` : "found from your replays if empty" }),
    ]),
    group("MCSR Ranked", [
      ...(isWeb ? [row("Replays", btn("add replays", pickReplays), { hint: "or drop .rrf files anywhere on the page" })] : [
      row("Instance", h("select", { class: "sx-in", "aria-label": "Ranked instance", onchange: (e: Event) => g.settings({ instancePath: (e.target as HTMLSelectElement).value || null }) },
          h("option", { value: "", selected: !st.instancePath }, "detect"),
          s.instances.map((i) => h("option", { value: i.path, selected: st.instancePath === i.path }, i.name)),
          st.instancePath && !s.instances.some((i) => i.path === st.instancePath) ? h("option", { value: st.instancePath, selected: true }, st.instancePath) : null),
          { hint: s.instance ? undefined : "not found" }),
        row("Somewhere else?", btn("pick folder", async () => { const dir = await g.pickInstance(); if (dir) { await g.settings({ instancePath: dir }); toast("Instance set"); } }),
          { hint: "the instance folder, if it isn't in the list" }),
      ]),
      row("Replay format", gate.status === "ok" ? dot("good", "ok") : gate.status === "failed" ? dot("bad", "changed") : dot("warn", "unchecked"), { hint: `MCSR Ranked ${gate.version ?? "?"}` }),
      row("Mix replays on their own", tog(st.autoRace, (v) => g.settings({ autoRace: v }), "Mix replays on their own"), { hint: "when a replay shows up" }),
      row("Delete forfeited runs", ptog("dropForfeits", "Delete forfeited runs"), { key: "dropForfeits", hint: "races on queued seeds you forfeit from now on, older ones stay" }),
    ]),
    group("Data", [
      row("Replays", btn("rescan", async () => { await g.rescan(); toast("Rescanned"); }), { hint: `${s.library.practice} private, ${s.library.ranked} ranked, ${s.library.reference} reference` }),
      row("Games", btn("re-analyse", async () => { await g.reanalyze(); toast("Re-analysing"); }), { hint: "after an update or changing analysis settings" }),
      row("Match index", h("span", { class: "dim" }, `${s.index.matches.toLocaleString()} matches`), { hint: s.index.error ?? `${s.index.apiLeft} API calls left` }),
      h("details", { class: "sx-log", "data-q": "activity log" }, h("summary", null, "Activity"),
        h("pre", { class: "log" }, s.log.length ? s.log.slice().reverse().join("\n") : "Nothing yet.")),
    ]),
  ];

  const pages: Record<Section, Child[]> = { theme, background, effects, graph, splits, analysis, companion, system };

  // ---- layout: side list and one section, or search results from all of them
  const content = h("div", { class: "sx-content" });
  const count = h("span", { class: "dim sx-count" });
  const draw = () => {
    const q = query.trim().toLowerCase();
    if (!q) {
      const page = h("div", null, pages[section]);
      page.querySelectorAll<HTMLElement>("[hidden]").forEach((e) => { e.hidden = false; });
      content.replaceChildren(h("h2", { class: "sx-title" }, SECTIONS.find(([k]) => k === section)![1]), page);
      count.textContent = "";
      return;
    }
    // Every section, keeping only rows that match, and groups and sections left with none dropped
    const out: Node[] = [];
    let n = 0;
    for (const [k, name] of SECTIONS) {
      const box = h("div", null, pages[k]);
      const hitName = name.toLowerCase().includes(q);
      box.querySelectorAll<HTMLElement>("[data-q]").forEach((r) => { const hit = hitName || r.dataset.q!.includes(q); r.hidden = !hit; if (hit) n++; });
      box.querySelectorAll<HTMLElement>(".sx-group").forEach((gr) => { gr.hidden = !gr.querySelector("[data-q]:not([hidden])"); });
      if (box.querySelector("[data-q]:not([hidden])")) out.push(h("h2", { class: "sx-title" }, name), box);
    }
    content.replaceChildren(...(out.length ? out : [h("div", { class: "dim" }, "Nothing matches.")]));
    count.textContent = `${n} found`;
  };
  const nav = h("nav", { class: "sx-nav" }, SECTIONS.map(([k, name]) => h("button", { class: section === k && !query ? "on" : "",
    onclick: () => { section = k; query = ""; try { localStorage.setItem("settings.section", k); } catch { /* Fine */ } rerender(); } }, name)),
    h("button", { class: "sx-support", onclick: openKofi, title: "Opens Ko-fi in your browser" }, "♥ Support Stratas"));
  const search = h("input", { class: "sx-q", type: "search", placeholder: "Search settings", value: query, "aria-label": "Search settings",
    oninput: (e: Event) => { query = (e.target as HTMLInputElement).value; nav.querySelectorAll("button").forEach((b, i) => b.classList.toggle("on", !query && SECTIONS[i][0] === section)); draw(); } });
  draw();
  return h("div", { class: "page sx" },
    h("div", { class: "page-head sx-head" }, h("h1", null, "Settings"), search, count),
    h("div", { class: "sx-body" }, nav, content));
}
