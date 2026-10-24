// Practice page: queue in the side column, picked run in the main area
// Shows the opponent, their run (time hidden till you race it), seeds, and your history on these seed types
import { g, type AppState, type QueueRow } from "../bridge";
import { deltaClass, fmtDelta, fmtMs, h, nice } from "../dom";
import { btn, copy, copyField, head, panel, rank, tierName } from "../parts";
import { roomRules } from "./find";
import { day, seedText } from "./races";
import { isWeb, pickReplays } from "../web";

let picked: number | null = null;
const revealed = new Set<number>();
// Their Elo going into each queued match, so it's easy to spot in Recent Matches
const elos = new Map<number, { elo: number; change: number } | null | "loading">();
const waiting = (s: AppState) => s.queue.filter((q) => q.status === "queued" || q.status === "downloaded");
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const seedLine = (q: QueueRow) => [q.seed_type ? cap(nice(q.seed_type)) : null, q.bastion_type ? `${nice(q.bastion_type)} bastion` : null].filter(Boolean).join(", ");

function current(s: AppState): QueueRow | null {
  const list = waiting(s);
  return list.find((q) => q.match_id === picked) ?? list.find((q) => q.status === "downloaded") ?? list[0] ?? null;
}

export function queueList(s: AppState, redraw: () => void, find: () => void) {
  const list = waiting(s), sel = current(s);
  const item = (q: QueueRow) => h("button", { class: `li ${q.match_id === sel?.match_id ? "sel" : ""}`, onclick: () => { picked = q.match_id; redraw(); } },
    head({ uuid: q.player_uuid, name: q.player_name }, 24),
    h("span", { class: "t" }, q.player_name),
    q.tier !== "manual" && q.tier !== "player" ? h("span", { class: `v tier-${q.tier}` }, tierName(s.tiers, q.tier)) : h("span"),
    h("span", { class: "s" }, [q.elo ? String(q.elo) : null, seedLine(q)].filter(Boolean).join(", ")));
  const queued = list.filter((q) => q.status === "queued"), ready = list.filter((q) => q.status === "downloaded");
  return h("aside", { class: "list" },
    h("div", { class: "list-head" }, h("h2", null, "Practice"), h("span", { class: "dim" }, list.length ? `${list.length} in queue` : "")),
    h("div", { class: "list-body" },
      h("div", { class: "list-grp" }, "Ready to play"),
      ready.length ? ready.map(item) : h("div", { class: "list-empty" }, "Seeds show up here when a replay is downloaded."),
      queued.length ? [h("div", { class: "list-grp" }, "To download"), queued.map(item)] : null),
    h("div", { class: "list-foot" }, btn("Find more runs", find, { key: "f" })));
}

/** Your analysed games with the same overworld or bastion type */
function history(s: AppState, q: QueueRow) {
  const ow = q.seed_type ? nice(q.seed_type) : null, bt = q.bastion_type ? nice(q.bastion_type) : null;
  const rows = s.races.filter((r) => !r.error && r.seedType && ((ow && r.seedType.startsWith(ow)) || (bt && r.seedType.endsWith(bt))))
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
  const types = [ow, bt ? `${bt} bastion` : null].filter(Boolean).join(" or ");
  return panel(null, null,
    h("div", { class: "p-head" }, h("h2", null, "Your games on these seed types"), h("span", { class: "dim" }, rows.length ? String(rows.length) : "")),
    rows.length ? h("table", { class: "plain" },
      h("tr", null, h("th", null, "Date"), h("th", null, "Opponent"), h("th", null, "Seed"), h("th", null, "Kind"), h("th", { class: "grow" }, "Gap")),
      rows.map((r) => h("tr", null,
        h("td", null, day(r.createdAt)),
        h("td", null, h("span", { class: "who-sm" }, head({ name: r.theirName }, 16), r.theirName)),
        h("td", null, seedText(r.seedType)),
        h("td", { class: "dim" }, r.kind === "race" ? "private room" : "ranked"),
        h("td", { class: `grow ${deltaClass(r.finalGap)}` }, fmtDelta(r.finalGap)))))
      : h("p", { class: "dim", style: "margin:0" }, `No analysed games on ${types || "this seed"} yet.`));
}

export function homeView(s: AppState, go: { find: () => void; race: (id: number) => void; redraw: () => void }) {
  const q = current(s);
  if (!q) {
    const latest = s.races.find((r) => r.kind === "race" && !r.error);
    return h("div", { class: "page" },
      panel(null, null,
        h("div", { class: "p-head" }, h("h2", null, "Nothing in the queue")),
        h("p", { class: "dim", style: "margin:0 0 12px" }, "Pick a few runs by stronger players to practice their seed."),
        btn("Find runs", go.find, { primary: true, key: "f" })),
      latest ? panel(null, null,
        h("div", { class: "p-head" }, h("h2", null, "Last game")),
        h("div", { class: "last" }, head({ name: latest.theirName }, 24), h("span", null, `vs ${latest.theirName}`),
          h("b", { class: deltaClass(latest.finalGap) }, fmtDelta(latest.finalGap)), h("span", { class: "dim" }, day(latest.createdAt)),
          btn("Open", () => go.race(latest.id), { key: "o" }))) : null,
      roomRules());
  }
  const ready = q.status === "downloaded";
  const diff = q.elo && s.you.elo ? q.elo - s.you.elo : null;
  const shown = revealed.has(q.match_id);
  if (!ready && !elos.has(q.match_id) && q.player_uuid) {
    elos.set(q.match_id, "loading");
    void g.matchElo(q.player_uuid, q.match_id).then((e) => { elos.set(q.match_id, e); go.redraw(); });
  }
  const at = elos.get(q.match_id);
  return h("div", { class: "page" },
    panel(null, { cls: "hero" },
      head({ uuid: q.player_uuid, name: q.player_name }, 64),
      h("div", { class: "hero-who" },
        h("div", { class: "hero-name" }, q.player_name),
        h("div", { class: "hero-sub" }, rank(q.elo), diff !== null ? h("span", { class: "dim" }, diff >= 0 ? `${diff} above you` : `${-diff} below you`) : null),
        h("div", { class: "dim" }, q.tier === "manual" ? "Picked from your own range" : q.tier === "player" ? "Picked by name" : tierName(s.tiers, q.tier) ? `${tierName(s.tiers, q.tier)} pick` : "")),
      h("div", { class: "hero-side" },
        ready ? h("div", { class: "good" }, "Ready to play")
          : [h("div", null, "Download the replay in Ranked"), h("div", { class: "dim" }, `Search Profile, ${q.player_name}, Recent Matches, Download Replay`),
            // Pasting the exact name beats eyeballing it in Ranked's search
            at && at !== "loading" ? h("div", null, `${at.elo} to ${at.elo + at.change} (${at.change >= 0 ? "+" : ""}${at.change}) vs ${q.opponent_name ?? "someone"} on ${day(q.date * 1000)}`) : null,
            btn("Copy name", () => copy(q.player_name, "Name"), { sm: true, key: "c" }),
            isWeb ? btn("Add the replay here", pickReplays, { sm: true }) : null],
        btn("Skip", () => g.queueStatus(q.match_id, "skipped"), { ghost: true, sm: true }))),
    panel(null, null,
      h("div", { class: "p-head" }, h("h2", null, "Their run")),
      h("dl", { class: "dl" },
        h("dt", null, "Seed"), h("dd", null, seedLine(q) || "Unknown"),
        h("dt", null, "Result"), h("dd", null, q.opponent_name && q.opponent_name !== "someone" ? `Beat ${q.opponent_name} on ${day(q.date * 1000)}` : `Won on ${day(q.date * 1000)}`),
        h("dt", null, "Time"), h("dd", null,
          // Hidden till clicked so their time doesn't set your pace
          h("button", { class: `spoiler ${shown ? "shown" : ""}`, onclick: () => { revealed.add(q.match_id); go.redraw(); } }, fmtMs(q.time)),
          shown ? null : h("span", { class: "dim" }, "hidden until you play it")))),
    panel(null, null,
      h("div", { class: "p-head" }, h("h2", null, "Seeds"), ready ? null : h("span", { class: "dim" }, "waiting for the replay")),
      // Copying a seed means you're about to play it, so your next private room run gets compared with this one
      ready ? h("div", { class: "seeds" }, copyField("World", q.overworld_seed ?? "?", "w", () => void g.practicing(q.match_id)), copyField("Nether", q.nether_seed ?? "?", "n", () => void g.practicing(q.match_id)))
        : h("dl", { class: "dl" }, h("dt", null, "World"), h("dd", { class: "dim" }, "—"), h("dt", null, "Nether"), h("dd", { class: "dim" }, "—"))),
    history(s, q),
    roomRules());
}
