/// <reference types="vite/client" />
// App shell: icon rail + list column + page, live state, matugen theme, routing, shortcuts
import { g, type AppState } from "./bridge";
import { h, mount, toast } from "./dom";
import { icons } from "./icons";
import { commitKeys, handleKey, head, rank, setRankIcons } from "./parts";
import { setStructures } from "./ranked";
import { startRain } from "./rain";
import { setPrefs } from "./prefs";
import { openKofi, trackUsage } from "./support";
import logo from "./logo.png";
import { homeView, queueList } from "./views/home";
import { findView } from "./views/find";
import { firstRace, raceList, raceOrder } from "./views/races";
import { forgetRace, raceView } from "./views/race";
import { patternsView } from "./views/patterns";
import { profileView, forgetProfile } from "./views/profile";
import { setThemeInfo, settingsView } from "./views/settings";
import { companionInit, companionView, setCompanionRace } from "./views/companion";

// Browser preview only (npm run ui:dev), not in the Electron build
if (import.meta.env.DEV && !(window as unknown as { stratas?: unknown }).stratas) await (await import("./dev/mock")).installMock();

type Page = "home" | "find" | "races" | "patterns" | "profile" | "settings";
type Route = { page: Page } | { page: "race"; id: number };
const ORDER: Page[] = ["home", "find", "races", "patterns", "profile", "settings"];

const app = document.getElementById("app")!;
const isCompanion = location.hash.startsWith("#companion");
let state: AppState | null = null;
let route: Route = { page: "home" };
let lastRaces = "";

function applyTheme(css: string) {
  let el = document.getElementById("matugen") as HTMLStyleElement | null;
  if (!el) { el = document.createElement("style"); el.id = "matugen"; document.head.appendChild(el); }
  el.textContent = css;
  dispatchEvent(new Event("stratas-theme"));
}

function go(r: Route) { route = r; lastPage = null; render(); document.querySelector("main")?.scrollTo(0, 0); }

function navBtn(page: Page, label: string, icon: () => SVGElement, count?: number) {
  const on = route.page === page || (page === "races" && route.page === "race");
  return h("button", { class: `rail-btn ${on ? "on" : ""}`, title: label, "aria-label": label, onclick: () => go({ page }) },
    icon(), count ? h("span", { class: "count" }, String(count)) : null);
}

// Set when a state came in while typing and we skipped the redraw
let behind = false;
let lastComp = "";
function render() {
  behind = false;
  if (!state) { mount(app, h("div", { class: "page" }, h("div", { class: "empty" }, "Starting"))); return; }
  const s = state;
  // The race you were on got removed
  if (route.page === "race" && !s.races.some((r) => r.id === (route as { id: number }).id)) route = { page: "races" };
  if (isCompanion) { app.className = "companion"; mount(app, companionView(s, render)); commitKeys(); return; }
  const waiting = s.queue.filter((q) => q.status === "queued" || q.status === "downloaded").length;
  const openRace = (id: number) => go({ page: "race", id });
  const raceId = route.page === "race" ? route.id : route.page === "races" ? firstRace(s) : null;
  const view = route.page === "home" ? homeView(s, { find: () => go({ page: "find" }), race: openRace, redraw: render })
    : route.page === "find" ? findView(s, render)
    : route.page === "races" || route.page === "race" ? (raceId !== null ? raceView(raceId, render, s.you.elo)
      : h("div", { class: "page" }, h("div", { class: "empty" }, "No games yet. Queue a run on Practice, then play it in a private room.")))
    : route.page === "patterns" ? patternsView(s, openRace)
    : route.page === "profile" ? profileView(s, openRace, render)
    : settingsView(s, render);
  const notice = s.gate.status === "failed" ? h("div", { class: "notice bad" }, `Ranked ${s.gate.version} changed its replay format (${s.gate.detail}).`)
    : !s.instance ? h("div", { class: "notice" }, "No MCSR Ranked instance found. Pick it in Settings.")
    : !s.settings.nickname ? h("div", { class: "notice" }, "Set your Minecraft name in Settings.") : null;
  if (notice) view.prepend(notice);
  const list = route.page === "home" ? queueList(s, render, () => go({ page: "find" }))
    : route.page === "races" || route.page === "race" ? raceList(s, raceId, openRace, render) : null;
  // Keep scroll position and open cards across redraws
  const page = JSON.stringify(route);
  const keep = page === lastPage;
  const oldMain = app.querySelector("main");
  const scroll = keep && oldMain ? oldMain.scrollTop : 0;
  const listScroll = app.querySelector(".list-body")?.scrollTop ?? 0;
  const folds = keep ? new Map([...app.querySelectorAll<HTMLDetailsElement>("main details")].map((d, i) => [foldKey(d, i), d.open])) : new Map();
  lastPage = page;
  const name = s.settings.nickname;
  mount(app,
    h("nav", { class: "rail" },
      h("img", { class: "logo", src: logo, alt: "Stratas", title: "Stratas" }),
      navBtn("home", "Practice", icons.next, waiting),
      navBtn("find", "Find runs", icons.find),
      navBtn("races", "Games", icons.races),
      navBtn("patterns", "Patterns", icons.patterns),
      navBtn("profile", "Profile", icons.profile),
      h("div", { class: "spacer" }),
      h("button", { class: "rail-btn support", title: "Support Stratas on Ko-fi", "aria-label": "Support Stratas on Ko-fi", onclick: openKofi }, icons.heart()),
      navBtn("settings", "Settings", icons.settings),
      name ? h("button", { class: "me", title: `${name}, ${s.you.elo ?? "unrated"}`, onclick: () => go({ page: "profile" }) },
        head({ uuid: s.settings.uuid, name }, 32), rank(s.you.elo, "me-rank")) : null),
    list,
    h("main", null, view));
  const lb = app.querySelector(".list-body");
  if (lb) lb.scrollTop = listScroll;
  if (keep) {
    app.querySelectorAll<HTMLDetailsElement>("main details").forEach((d, i) => { const o = folds.get(foldKey(d, i)); if (o !== undefined) d.open = o; });
    app.querySelector("main")?.scrollTo(0, scroll);
  }
  commitKeys();
}

let lastPage: string | null = null;
const foldKey = (d: HTMLDetailsElement, i: number) => d.querySelector("summary .title")?.textContent ?? `#${i}`;

addEventListener("keydown", (e) => {
  if (handleKey(e) || isCompanion) return;
  if ((e.key === "ArrowDown" || e.key === "ArrowUp") && state && (route.page === "race" || route.page === "races") && !(e.target as HTMLElement).closest("input, select, textarea")) {
    const ids = raceOrder(state), cur = ids.indexOf(route.page === "race" ? route.id : firstRace(state) ?? -1);
    const next = ids[cur + (e.key === "ArrowDown" ? 1 : -1)];
    if (next !== undefined) { e.preventDefault(); go({ page: "race", id: next }); }
    return;
  }
  if ((e.key === "[" || e.key === "]") && !(e.target as HTMLElement).closest("input, select, textarea")) {
    const cur = ORDER.indexOf(route.page === "race" ? "races" : route.page);
    go({ page: ORDER[(cur + (e.key === "]" ? 1 : ORDER.length - 1)) % ORDER.length] });
  }
});

g.onState((s) => {
  const races = JSON.stringify(s.races.map((r) => [r.id, r.createdAt, r.error]));
  if (races !== lastRaces) { forgetRace(); forgetProfile(); lastRaces = races; }
  state = s;
  setPrefs(s.settings.prefs, s.you.elo);
  // Don't redraw while a field is focused
  const a = document.activeElement;
  if (!isCompanion && a && a.closest("input, select")) { behind = true; return; }
  // The companion only cares about the race list. Redrawing it on every scan update reset its scroll and folds
  if (isCompanion) { if (races === lastComp) return; lastComp = races; }
  render();
});
// Do the skipped redraw once focus leaves the field, unless it went straight into another one
document.addEventListener("focusout", () => setTimeout(() => {
  if (!behind || document.activeElement?.closest("input, select")) return;
  behind = false;
  render();
}));
g.onTheme(applyTheme);
// A Ranked game you just played got analysed
g.onOpenRace((id) => go(id ? { page: "race", id } : { page: "races" }));
g.onNewGame((n) => toast(`${n.title} · ${n.body}`, 8000));

if (isCompanion) {
  const id = Number(location.hash.split("/")[1]);
  setCompanionRace(Number.isFinite(id) && id > 0 ? id : null);
  companionInit(render);
}

startRain();
void g.theme().then((t) => { setThemeInfo(t); if (t.css) applyTheme(t.css); });
void g.rankIcons().then((x) => { setRankIcons(x); render(); }).catch(() => {});
// Ranked's structure icons (the background art loads from settings)
void g.rankedAssets().then((x) => {
  if (x.structures) { setStructures(x.structures); render(); }
}).catch(() => {});
void g.state().then((s) => { state = s; setPrefs(s.settings.prefs, s.you.elo); if (!isCompanion) trackUsage(); lastRaces = JSON.stringify(s.races.map((r) => [r.id, r.createdAt, r.error])); render(); });
