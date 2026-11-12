/// <reference types="vite/client" />
import { g, type AppState } from "./bridge";
import { h, mount, toast } from "./dom";
import { icons } from "./icons";
import { commitKeys, handleKey, head, isTypingIn, rank, setRankIcons } from "./parts";
import { setStructures } from "./ranked";
import { startEffects } from "./effects";
import { setPrefs } from "./prefs";
import { openKofi, trackUsage } from "./support";
import logo from "./logo.png";
import { homeView, practiceQueue, queueList } from "./views/home";
import { findView } from "./views/find";
import { firstRace, raceList, raceOrder } from "./views/races";
import { forgetRace, raceView } from "./views/race";
import { patternsView } from "./views/patterns";
import { profileView, forgetProfile } from "./views/profile";
import { setThemeInfo, settingsView } from "./views/settings";
import { welcomeView } from "./views/welcome";
import { companionInit, companionView, setCompanionRace } from "./views/companion";
import { updateRailBtn, watchUpdates } from "./update";

if (import.meta.env.DEV && !(window as unknown as { stratas?: unknown }).stratas) {
  await (await import("./dev/mock")).installMock();
}

type Page = "home" | "find" | "races" | "patterns" | "profile" | "settings";
type Route = { page: Page } | { page: "race"; id: number };
const ORDER: Page[] = ["home", "find", "races", "patterns", "profile", "settings"];

const app = document.getElementById("app")!;
const isCompanion = location.hash.startsWith("#companion");
let state: AppState | null = null;
let route: Route = { page: "home" };
let lastRaces = "";
let lastCompanionRaces = "";
let lastPage: string | null = null;
let redrawSkippedWhileTyping = false;

const racesKey = (s: AppState) => JSON.stringify(s.races.map((r) => [r.id, r.createdAt, r.error]));
const onRacesPage = () => route.page === "races" || route.page === "race";

function applyTheme(css: string) {
  let el = document.getElementById("matugen") as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = "matugen";
    document.head.appendChild(el);
  }
  el.textContent = css;
  dispatchEvent(new Event("stratas-theme"));
}

function go(r: Route) {
  route = r;
  lastPage = null;
  render();
  document.querySelector("main")?.scrollTo(0, 0);
}

function navBtn(page: Page, label: string, icon: () => SVGElement, count?: number) {
  const on = route.page === page || (page === "races" && route.page === "race");
  return h(
    "button",
    {
      class: `rail-btn ${on ? "on" : ""}`,
      title: label,
      "aria-label": label,
      onclick: () => go({ page }),
    },
    icon(),
    count ? h("span", { class: "count" }, String(count)) : null,
  );
}

function pageView(s: AppState, raceId: number | null, openRace: (id: number) => void) {
  switch (route.page) {
    case "home":
      return homeView(s, { find: () => go({ page: "find" }), race: openRace, redraw: render });
    case "find":
      return findView(s, render);
    case "races":
    case "race":
      if (raceId === null) {
        return h(
          "div",
          { class: "page" },
          h(
            "div",
            { class: "empty" },
            "No games yet. Queue a run on Practice, then play it in a private room.",
          ),
        );
      }
      return raceView(raceId, render, s.you.elo);
    case "patterns":
      return patternsView(s, openRace);
    case "profile":
      return profileView(s, openRace, render);
    default:
      return settingsView(s, render);
  }
}

function setupNotice(s: AppState) {
  if (s.gate.status === "failed") {
    return h(
      "div",
      { class: "notice bad" },
      `Ranked ${s.gate.version} changed its replay format (${s.gate.detail}).`,
    );
  }
  if (!s.instance) {
    return h("div", { class: "notice" }, "No MCSR Ranked instance found. Pick it in Settings.");
  }
  if (!s.settings.nickname) {
    return h("div", { class: "notice" }, "Set your Minecraft name in Settings.");
  }
  return null;
}

function rail(s: AppState) {
  const waiting = practiceQueue(s).filter((q) => q.practice?.step !== "analyze").length;
  const name = s.settings.nickname;
  return h(
    "nav",
    { class: "rail" },
    h("img", { class: "logo", src: logo, alt: "Stratas", title: "Stratas" }),
    navBtn("home", "Practice", icons.next, waiting),
    navBtn("find", "Find runs", icons.find),
    navBtn("races", "Games", icons.races),
    navBtn("patterns", "Patterns", icons.patterns),
    navBtn("profile", "Profile", icons.profile),
    h("div", { class: "spacer" }),
    updateRailBtn(),
    h(
      "button",
      {
        class: "rail-btn support",
        title: "Support Stratas on Ko-fi",
        "aria-label": "Support Stratas on Ko-fi",
        onclick: openKofi,
      },
      icons.heart(),
    ),
    navBtn("settings", "Settings", icons.settings),
    name
      ? h(
          "button",
          {
            class: "me",
            title: `${name}, ${s.you.elo ?? "unrated"}`,
            onclick: () => go({ page: "profile" }),
          },
          head({ uuid: s.settings.uuid, name }, 32),
          rank(s.you.elo, "me-rank"),
        )
      : null,
  );
}

const foldKey = (d: HTMLDetailsElement, i: number) =>
  d.querySelector("summary .title")?.textContent ?? `#${i}`;

type ScrollState = { samePage: boolean; main: number; list: number; folds: Map<string, boolean> };

/** Scroll positions and open folds. Main keeps its own only while the page stays the same. */
function readScroll(samePage: boolean): ScrollState {
  const folds = new Map<string, boolean>();
  if (samePage) {
    app.querySelectorAll<HTMLDetailsElement>("main details").forEach((d, i) => {
      folds.set(foldKey(d, i), d.open);
    });
  }
  const oldMain = app.querySelector("main");
  return {
    samePage,
    main: samePage && oldMain ? oldMain.scrollTop : 0,
    list: app.querySelector(".list-body")?.scrollTop ?? 0,
    folds,
  };
}

function restoreScroll(saved: ScrollState) {
  const listBody = app.querySelector(".list-body");
  if (listBody) {
    listBody.scrollTop = saved.list;
  }
  if (!saved.samePage) {
    return;
  }
  app.querySelectorAll<HTMLDetailsElement>("main details").forEach((d, i) => {
    const open = saved.folds.get(foldKey(d, i));
    if (open !== undefined) {
      d.open = open;
    }
  });
  app.querySelector("main")?.scrollTo(0, saved.main);
}

function render() {
  redrawSkippedWhileTyping = false;
  if (!state) {
    mount(app, h("div", { class: "page" }, h("div", { class: "empty" }, "Starting")));
    return;
  }
  const s = state;
  if (route.page === "race") {
    const id = route.id;
    if (!s.races.some((r) => r.id === id)) {
      route = { page: "races" };
    }
  }
  if (isCompanion) {
    app.className = "companion";
    mount(app, companionView(s, render));
    commitKeys();
    return;
  }
  if (!s.settings.onboarded) {
    lastPage = null;
    mount(app, welcomeView(s, render));
    commitKeys();
    return;
  }
  const openRace = (id: number) => go({ page: "race", id });
  const raceId = route.page === "race" ? route.id : route.page === "races" ? firstRace(s) : null;
  const view = pageView(s, raceId, openRace);
  const notice = setupNotice(s);
  if (notice) {
    view.prepend(notice);
  }
  let list: HTMLElement | null = null;
  if (route.page === "home") {
    list = queueList(s, render, () => go({ page: "find" }));
  } else if (onRacesPage()) {
    list = raceList(s, raceId, openRace, render);
  }
  const page = JSON.stringify(route);
  const scroll = readScroll(page === lastPage);
  lastPage = page;
  mount(app, rail(s), list, h("main", null, view));
  restoreScroll(scroll);
  commitKeys();
}

addEventListener("keydown", (e) => {
  if (handleKey(e) || isCompanion) {
    return;
  }
  if (isTypingIn(e.target)) {
    return;
  }
  if ((e.key === "ArrowDown" || e.key === "ArrowUp") && state && onRacesPage()) {
    const ids = raceOrder(state);
    const cur = ids.indexOf(route.page === "race" ? route.id : (firstRace(state) ?? -1));
    const next = ids[cur + (e.key === "ArrowDown" ? 1 : -1)];
    if (next !== undefined) {
      e.preventDefault();
      go({ page: "race", id: next });
    }
    return;
  }
  if (e.key === "[" || e.key === "]") {
    const cur = ORDER.indexOf(route.page === "race" ? "races" : route.page);
    go({ page: ORDER[(cur + (e.key === "]" ? 1 : ORDER.length - 1)) % ORDER.length] });
  }
});

if (!isCompanion) {
  watchUpdates(render);
}
g.onState((s) => {
  const races = racesKey(s);
  if (races !== lastRaces) {
    forgetRace();
    forgetProfile();
    lastRaces = races;
  }
  state = s;
  setPrefs(s.settings.prefs, s.you.elo);
  const a = document.activeElement;
  if (!isCompanion && a && a.closest("input, select")) {
    redrawSkippedWhileTyping = true;
    return;
  }
  if (isCompanion) {
    if (races === lastCompanionRaces) {
      return;
    }
    lastCompanionRaces = races;
  }
  render();
});
document.addEventListener("focusout", () =>
  setTimeout(() => {
    if (!redrawSkippedWhileTyping || document.activeElement?.closest("input, select")) {
      return;
    }
    render();
  }),
);
g.onTheme(applyTheme);
g.onOpenRace((id) => go(id ? { page: "race", id } : { page: "races" }));
g.onNewGame((n) => toast(`${n.title} · ${n.body}`, 8000));

if (isCompanion) {
  const id = Number(location.hash.split("/")[1]);
  setCompanionRace(Number.isFinite(id) && id > 0 ? id : null);
  companionInit(render);
}

startEffects();
void g.theme().then((t) => {
  setThemeInfo(t);
  if (t.css) {
    applyTheme(t.css);
  }
});
void g
  .rankIcons()
  .then((x) => {
    setRankIcons(x);
    render();
  })
  .catch(() => {});
void g
  .rankedAssets()
  .then((x) => {
    if (x.structures) {
      setStructures(x.structures);
      render();
    }
  })
  .catch(() => {});
void g.state().then((s) => {
  state = s;
  setPrefs(s.settings.prefs, s.you.elo);
  if (!isCompanion) {
    trackUsage();
  }
  lastRaces = racesKey(s);
  render();
});
