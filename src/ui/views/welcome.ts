// First time screen: what Stratas does and what it touches, your Minecraft name (typed, never guessed on its own),
// then the few settings worth deciding up front. Settings has all of it later
import { THEMES, type ThemeColors } from "../../core/prefs";
import { g, type AppState } from "../bridge";
import { h, toast } from "../dom";
import { btn, head, rank } from "../parts";
import { prefs, savePrefs } from "../prefs";
import { isWeb, pickReplays } from "../web";
import logo from "../logo.png";

type Found = { nickname: string; uuid: string; elo: number | null; rank: number | null };

let step = 0;
let name = "";
let found: Found | null = null;
let checking = false;
let missing = false;

export function welcomeView(s: AppState, rerender: () => void) {
  const finish = async () => {
    await g.settings({ onboarded: true });
    step = 0; found = null; name = "";
  };
  const pages = [intro, who, setup];
  return h("div", { class: "welcome" },
    h("div", { class: "wl-card" },
      h("div", { class: "wl-steps", "aria-hidden": "true" }, pages.map((_, i) => h("i", { class: i === step ? "on" : i < step ? "done" : "" }))),
      pages[step](s, rerender, finish)));
}

const next = (rerender: () => void) => { step++; rerender(); };
const back = (rerender: () => void) => btn("Back", () => { step--; rerender(); }, { ghost: true });

function intro(_s: AppState, rerender: () => void) {
  const item = (title: string, text: string) => h("li", null, h("b", null, title), h("span", { class: "dim" }, text));
  return [
    h("div", { class: "wl-brand" }, h("img", { src: logo, alt: "" }), h("h1", null, "Stratas")),
    h("p", { class: "wl-lead" }, "Practice MCSR Ranked seeds against a player at any Elo, then watch both runs in one replay and see where the time went."),
    h("h2", null, "What it looks at"),
    h("ul", { class: "wl-list" },
      isWeb
        ? item("Replays you add", "They stay in this browser. Nothing gets uploaded, the page reads them right here.")
        : item("Your Ranked replays", "Read from your MCSR Ranked instance folder. They never leave your computer."),
      item("Ranked's public API", "Match history and Elo, the same things anyone can see on a Ranked profile."),
      item("Minecraft skins", "For the little heads next to names."),
      isWeb ? null : item("GitHub", "To check for a new version of Stratas."),
      item("No account, no tracking", "There's nothing to sign up for, and Stratas doesn't collect anything about you.")),
    h("div", { class: "wl-actions" }, btn("Get started", () => next(rerender), { primary: true, key: "Enter" })),
  ];
}

function who(s: AppState, rerender: () => void) {
  const check = async () => {
    const n = name.trim();
    if (!n || checking) return;
    checking = true; missing = false; found = null; rerender();
    found = await g.lookupPlayer(n);
    missing = !found; checking = false; rerender();
  };
  const input = h("input", { id: "wl-name", type: "text", value: name, placeholder: "Minecraft name", spellcheck: "false", autocomplete: "off", "aria-label": "Minecraft name",
    oninput: (e: Event) => { name = (e.target as HTMLInputElement).value; },
    onkeydown: (e: KeyboardEvent) => { if (e.key === "Enter") { e.stopPropagation(); name = (e.target as HTMLInputElement).value; void check(); } } });
  setTimeout(() => { if (!found) (document.getElementById("wl-name") as HTMLInputElement | null)?.focus(); });
  return [
    h("h1", null, "Who are you on Ranked?"),
    h("p", { class: "wl-lead" }, "Your name tells Stratas which runs in a replay are yours and what Elo to pick opponents around. It only gets used to look you up on Ranked."),
    h("div", { class: "wl-name" }, input, btn(checking ? "Checking…" : "Check", check, { disabled: checking })),
    found ? h("div", { class: "wl-found" },
      head({ uuid: found.uuid, name: found.nickname }, 40),
      h("div", null, h("div", { class: "wl-found-name" }, found.nickname),
        h("div", { class: "dim" }, found.elo != null ? [rank(found.elo), found.rank ? ` #${found.rank}` : ""] : "No Elo this season yet")))
      : missing ? h("p", { class: "bad wl-note" }, `No Ranked player called ${name.trim()}. Check the spelling?`)
      : null,
    // Only reads your local replays when you click it, and only fills in the box
    isWeb ? null : h("p", { class: "dim wl-note" }, "Don't remember the exact spelling? ",
      h("button", { class: "linkish", onclick: async () => {
        const n = await g.suggestName();
        if (!n) { toast("Couldn't tell from your replays yet. Play a game or two first"); return; }
        name = n; rerender(); void check();
      } }, "Find it in my replays"), "."),
    h("div", { class: "wl-actions" },
      back(rerender),
      h("button", { class: "linkish dim", onclick: () => { found = null; next(rerender); } }, "Skip for now"),
      btn("Continue", async () => {
        if (found && s.settings.nickname !== found.nickname) await g.settings({ nickname: found.nickname });
        next(rerender);
      }, { primary: true, disabled: !found })),
  ];
}

function setup(s: AppState, rerender: () => void, finish: () => Promise<void>) {
  const p = prefs(), st = s.settings;
  const tog = (on: boolean, set: (v: boolean) => void, label: string) =>
    h("button", { class: `sx-t ${on ? "on" : ""}`, role: "switch", "aria-checked": String(on), "aria-label": label, onclick: () => set(!on) }, h("i"));
  const row = (title: string, hint: string, control: HTMLElement | null) =>
    h("div", { class: "wl-row" }, h("div", null, h("b", null, title), h("div", { class: "dim" }, hint)), control);
  // Auto is Stratas's own colours unless there's a matugen file, so it lights the Stratas card
  const card = (id: string, label: string, c: ThemeColors) =>
    h("button", { class: `sx-theme ${p.theme === id || (id === "stratas" && p.theme === "auto") ? "on" : ""}`, onclick: () => savePrefs({ theme: id }), style: `--tb:${c.bg};--tt:${c.text}` },
      h("span", { class: "pv" }, h("b", null, "Aa"), [c.accent, c.you, c.them, c.good, c.bad].map((col) => h("i", { style: `background:${col}` }))),
      h("span", { class: "nm" }, label));
  return [
    h("h1", null, "A few settings"),
    h("p", { class: "wl-lead" }, "The ones worth picking now. Everything else is in Settings."),
    isWeb
      ? row("Your replays", "The browser can't see your Ranked folder, so add .rrf files here or drop them anywhere. Ranked keeps them in your instance's replays folder.", btn("Add replays", pickReplays, { sm: true }))
      : row("Ranked instance", s.instance ? `Found: ${s.instances.find((i) => i.path === (st.instancePath ?? s.instance?.root))?.name ?? s.instance.root}` : "Not found. Pick the instance folder you play Ranked in.",
        btn(s.instance ? "Change" : "Pick folder", async () => { const dir = await g.pickInstance(); if (dir) await g.settings({ instancePath: dir }); }, { sm: true })),
    row("Mix replays on their own", "Builds the replay with both of you as soon as both runs are there.", tog(st.autoRace, (v) => void g.settings({ autoRace: v }), "Mix replays on their own")),
    isWeb ? null : row("Notifications", "A popup when one of your games is analysed.", tog(st.notify, (v) => void g.settings({ notify: v }), "Notifications")),
    h("h2", null, "Theme"),
    h("div", { class: "sx-themes wl-themes" }, THEMES.map((t) => card(t.id, t.name, t.c))),
    h("div", { class: "wl-actions" }, back(rerender), btn("Start", () => void finish().then(rerender), { primary: true, key: "Enter" })),
  ];
}
