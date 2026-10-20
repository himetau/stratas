// Races list in the side column (seed races + analysed Ranked matches), open race fills the main area
import type { AppState } from "../bridge";
import { deltaClass, fmtDelta, h } from "../dom";
import { head } from "../parts";

type Race = AppState["races"][number];
type Sort = "smart" | "newest" | "closest";
type Filter = "all" | "race" | "match";
let sort: Sort = (() => { try { return (localStorage.getItem("races.sort") as Sort) || "smart"; } catch { return "smart"; } })();
let filter: Filter = "all";
const SORTS: [Sort, string][] = [["smart", "Biggest loss"], ["newest", "Newest"], ["closest", "Closest"]];
const FILTERS: [Filter, string][] = [["all", "All"], ["race", "Private rooms"], ["match", "Ranked"]];

/** Sort by biggest cost (failed last), newest, or smallest gap */
function order(xs: Race[]): Race[] {
  return [...xs].sort((a, b) => {
    if (sort === "newest") return b.createdAt - a.createdAt;
    if (sort === "closest") return Math.abs(a.error ? Infinity : a.finalGap) - Math.abs(b.error ? Infinity : b.finalGap) || b.createdAt - a.createdAt;
    return Number(!!a.error) - Number(!!b.error) || (b.topSeconds ?? -1) - (a.topSeconds ?? -1) || b.createdAt - a.createdAt;
  });
}

/** "village / stables" -> "Village, stables" */
export const seedText = (s: string | null | undefined) => {
  if (!s) return "";
  const t = s.replace(/_/g, " ").split(" / ").join(", ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};
export const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });

const groups = (s: AppState) => {
  const races = order(s.races.filter((r) => r.kind === "race")), matches = order(s.races.filter((r) => r.kind === "match"));
  return { races: filter === "match" ? [] : races, matches: filter === "race" ? [] : matches };
};

/** Race to show when Races opens with nothing picked */
export function firstRace(s: AppState): number | null {
  const { races, matches } = groups(s);
  return (races[0] ?? matches[0])?.id ?? null;
}

/** All races in list order, for arrow keys */
export function raceOrder(s: AppState): number[] {
  const { races, matches } = groups(s);
  return [...races, ...matches].map((r) => r.id);
}

export function raceList(s: AppState, openId: number | null, open: (id: number) => void, redraw: () => void) {
  const { races, matches } = groups(s);
  const item = (r: Race) => h("button", { class: `li ${r.id === openId ? "sel" : ""}`, onclick: () => open(r.id) },
    head({ name: r.theirName }, 24),
    h("span", { class: "t" }, `vs ${r.theirName}`),
    h("span", { class: `v ${r.error ? "dim" : deltaClass(r.finalGap)}` }, r.error ? "failed" : fmtDelta(r.finalGap)),
    h("span", { class: "s" }, [seedText(r.seedType), day(r.createdAt)].filter(Boolean).join(", ")));
  const waiting = (s.myGames ?? []).filter((x) => x.raceId === null && !x.private).length;
  return h("aside", { class: "list" },
    h("div", { class: "list-head" }, h("h2", null, "Games"),
      h("select", { id: "race-sort", class: "mini-select", onchange: (e: Event) => { sort = (e.target as HTMLSelectElement).value as Sort; try { localStorage.setItem("races.sort", sort); } catch { /* Fine */ } redraw(); } },
        SORTS.map(([k, label]) => h("option", { value: k, selected: sort === k }, label)))),
    h("div", { class: "list-tabs" }, FILTERS.map(([k, label]) => h("button", { class: filter === k ? "on" : "", onclick: () => { filter = k; redraw(); } }, label))),
    h("div", { class: "list-body" },
      races.length ? [h("div", { class: "list-grp" }, "Private rooms"), races.map(item)] : null,
      matches.length ? [h("div", { class: "list-grp" }, "Your ranked matches"), matches.map(item)] : null,
      !races.length && !matches.length ? h("div", { class: "list-empty" }, filter === "match" ? "No analysed ranked matches yet." : "No games yet. Play a queued seed in a private room.") : null),
    waiting ? h("div", { class: "list-foot dim" }, `${waiting} more ranked ${waiting === 1 ? "match" : "matches"} waiting for a replay`) : null);
}
