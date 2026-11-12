import { g, type AppState, type QueueRow } from "../bridge";
import { cap, deltaClass, fmtDelta, fmtMs, h, nice } from "../dom";
import { btn, copy, copyField, head, panel, rank, tierName } from "../parts";
import { roomRules } from "./find";
import { day } from "./races";
import { isWeb, pickReplays } from "../web";

let picked: number | null = null;
const revealed = new Set<number>();
/** Their Elo going into each queued match and what they gained */
const elos = new Map<number, { elo: number; change: number } | null | "loading">();
type PracticeRun = AppState["queue"][number];
type PracticeStep = NonNullable<PracticeRun["practice"]>["step"];
const stage = (q: PracticeRun): PracticeStep =>
  q.practice?.step ?? (q.status === "queued" ? "download-player" : "play-seed");
const seenFinished = new Set<number>();
/** Takes a finished practice run off Practice once its analysed race is open */
export function markPracticeSeen(s: AppState, raceId: number) {
  for (const q of s.queue) {
    if (
      q.status === "raced" &&
      stage(q) === "analyze" &&
      q.practice?.raceId === raceId &&
      !seenFinished.has(q.match_id)
    ) {
      seenFinished.add(q.match_id);
      void g.queueStatus(q.match_id, "skipped");
    }
  }
}
export function practiceQueue(s: AppState): PracticeRun[] {
  const active = s.queue.filter(
    (q) =>
      q.status === "queued" ||
      q.status === "downloaded" ||
      (q.status === "raced" && stage(q) === "download-private"),
  );
  const completed = s.queue
    .filter((q) => q.status === "raced" && stage(q) === "analyze")
    .sort((a, b) => (b.practice?.updatedAt ?? 0) - (a.practice?.updatedAt ?? 0));
  const last = completed.find((q) => q.match_id === picked) ?? completed[0];
  return last ? [...active, last] : active;
}
const seedLine = (q: QueueRow) =>
  [
    q.seed_type ? cap(nice(q.seed_type)) : null,
    q.bastion_type ? `${nice(q.bastion_type)} bastion` : null,
  ]
    .filter(Boolean)
    .join(", ");

function current(s: AppState): PracticeRun | null {
  const list = practiceQueue(s);
  return (
    list.find((q) => q.match_id === picked) ??
    list.find((q) => stage(q) === "download-private") ??
    list.find((q) => q.status === "downloaded") ??
    list[0] ??
    null
  );
}

export function queueList(s: AppState, redraw: () => void, find: () => void) {
  const list = practiceQueue(s);
  const sel = current(s);
  const item = (q: PracticeRun) =>
    h(
      "button",
      {
        class: `li ${q.match_id === sel?.match_id ? "sel" : ""}`,
        onclick: () => {
          picked = q.match_id;
          redraw();
        },
      },
      head({ uuid: q.player_uuid, name: q.player_name }, 24),
      h("span", { class: "t" }, q.player_name),
      h(
        "span",
        { class: "s" },
        [q.elo ? String(q.elo) : null, seedLine(q)].filter(Boolean).join(", "),
      ),
    );
  const group = (step: PracticeStep, title: string) => {
    const runs = list.filter((q) => stage(q) === step);
    return runs.length ? [h("div", { class: "list-grp" }, title), runs.map(item)] : null;
  };
  return h(
    "aside",
    { class: "list" },
    h(
      "div",
      { class: "list-head" },
      h("h2", null, "Practice"),
      h(
        "span",
        { class: "dim" },
        list.length ? `${list.length} ${list.length === 1 ? "run" : "runs"}` : "",
      ),
    ),
    h(
      "div",
      { class: "list-body" },
      group("download-private", "Your replay"),
      group("analyze", "Ready to analyze"),
      group("play-seed", "Ready to play"),
      !list.length
        ? h("div", { class: "list-empty" }, "Empty until you queue a run on Find runs.")
        : null,
      group("download-player", "To download"),
    ),
    h("div", { class: "list-foot" }, btn("Find more runs", find, { key: "f" })),
  );
}

const STEP_TEXT: Partial<Record<PracticeStep, string>> = {
  "download-player": "Download the player's replay.",
  "play-seed": "Play the seed in a private room. This moves on once you finish the run.",
  "download-private": "Download your private room replay.",
};

/** One short instruction for the current stage of this seed's practice run. */
function nextStep(q: PracticeRun, open: (id: number) => void) {
  const step = stage(q);
  const text = STEP_TEXT[step];
  return h(
    "div",
    { class: "notice next", "data-step": step, role: "status", "aria-live": "polite" },
    h(
      "span",
      null,
      text ?? [
        "View your replay folder and analyze the ",
        h(
          "button",
          {
            class: "linkish",
            onclick: () => {
              if (q.practice?.raceId != null) {
                open(q.practice.raceId);
              }
            },
            "aria-label": `Analyze your run against ${q.player_name}`,
          },
          "run",
        ),
        ".",
      ],
    ),
  );
}

function readyStatus(step: PracticeStep) {
  if (step === "analyze") {
    return "Ready to analyze";
  }
  if (step === "download-private") {
    return "Waiting for your replay";
  }
  return "Ready to play";
}

function pickedHow(s: AppState, q: PracticeRun) {
  if (q.tier === "manual") {
    return "Picked from your own range";
  }
  if (q.tier === "player") {
    return "Picked by name";
  }
  const tier = tierName(q.tier);
  return tier ? `${tier} pick` : "";
}

type HomeNav = { find: () => void; race: (id: number) => void; redraw: () => void };

function emptyQueueView(s: AppState, go: HomeNav) {
  const latest = s.races.find((r) => r.kind === "race" && !r.error);
  return h(
    "div",
    { class: "page" },
    panel(
      null,
      null,
      h("div", { class: "p-head" }, h("h2", null, "Nothing in the queue")),
      h(
        "p",
        { class: "dim", style: "margin:0 0 12px" },
        "Queue runs on the Find page to play their seeds.",
      ),
      btn("Find runs", go.find, { primary: true, key: "f" }),
    ),
    latest
      ? panel(
          null,
          null,
          h("div", { class: "p-head" }, h("h2", null, "Last game")),
          h(
            "div",
            { class: "last" },
            head({ name: latest.theirName }, 24),
            h("span", null, `vs ${latest.theirName}`),
            h("b", { class: deltaClass(latest.finalGap) }, fmtDelta(latest.finalGap)),
            h("span", { class: "dim" }, day(latest.createdAt)),
            btn("Open", () => go.race(latest.id), { key: "o" }),
          ),
        )
      : null,
    roomRules(),
  );
}

export function homeView(s: AppState, go: HomeNav) {
  const q = current(s);
  if (!q) {
    return emptyQueueView(s, go);
  }
  // The run stays selected while its API result and replay arrive.
  picked = q.match_id;
  const step = stage(q);
  const ready = step !== "download-player";
  const diff = q.elo && s.you.elo ? q.elo - s.you.elo : null;
  const shown = revealed.has(q.match_id);
  if (!ready && !elos.has(q.match_id) && q.player_uuid) {
    elos.set(q.match_id, "loading");
    void g.matchElo(q.player_uuid, q.match_id).then((e) => {
      elos.set(q.match_id, e);
      go.redraw();
    });
  }
  const at = elos.get(q.match_id);
  return h(
    "div",
    { class: "page" },
    nextStep(q, go.race),
    panel(
      null,
      { cls: "hero" },
      head({ uuid: q.player_uuid, name: q.player_name }, 64),
      h(
        "div",
        { class: "hero-who" },
        h("div", { class: "hero-name" }, q.player_name),
        h(
          "div",
          { class: "hero-sub" },
          rank(q.elo),
          diff !== null
            ? h("span", { class: "dim" }, diff >= 0 ? `${diff} above you` : `${-diff} below you`)
            : null,
        ),
        h("div", { class: "dim" }, pickedHow(s, q)),
      ),
      h(
        "div",
        { class: "hero-side" },
        ready
          ? h("div", { class: step === "download-private" ? "dim" : "good" }, readyStatus(step))
          : [
              h("div", null, "Waiting for their replay"),
              at && at !== "loading"
                ? h(
                    "div",
                    { class: "dim" },
                    `Match: ${at.elo} to ${at.elo + at.change} (${at.change >= 0 ? "+" : ""}${at.change}) vs ${q.opponent_name ?? "someone"} on ${day(q.date * 1000)}`,
                  )
                : null,
              btn("Copy name", () => copy(q.player_name, "Name"), { sm: true, key: "c" }),
              isWeb ? btn("Add the replay here", pickReplays, { sm: true }) : null,
            ],
        btn("Skip", () => g.queueStatus(q.match_id, "skipped"), { ghost: true, sm: true }),
      ),
    ),
    panel(
      null,
      null,
      h("div", { class: "p-head" }, h("h2", null, "Their run")),
      h(
        "dl",
        { class: "dl" },
        h("dt", null, "Seed"),
        h("dd", null, seedLine(q) || "Unknown"),
        h("dt", null, "Result"),
        h(
          "dd",
          null,
          q.opponent_name && q.opponent_name !== "someone"
            ? `Beat ${q.opponent_name} on ${day(q.date * 1000)}`
            : `Won on ${day(q.date * 1000)}`,
        ),
        h("dt", null, "Time"),
        h(
          "dd",
          null,
          h(
            "button",
            {
              class: `spoiler ${shown ? "shown" : ""}`,
              onclick: () => {
                revealed.add(q.match_id);
                go.redraw();
              },
            },
            fmtMs(q.time),
          ),
          shown ? null : h("span", { class: "dim" }, "hidden until you play it"),
        ),
      ),
    ),
    panel(
      null,
      null,
      h(
        "div",
        { class: "p-head" },
        h("h2", null, "Seeds"),
        ready ? null : h("span", { class: "dim" }, "waiting for the replay"),
      ),
      ready
        ? h(
            "div",
            { class: "seeds" },
            copyField("World", q.overworld_seed ?? "?", "w", () => void g.practicing(q.match_id)),
            copyField("Nether", q.nether_seed ?? "?", "n", () => void g.practicing(q.match_id)),
          )
        : h(
            "dl",
            { class: "dl" },
            h("dt", null, "World"),
            h("dd", { class: "dim" }, "—"),
            h("dt", null, "Nether"),
            h("dd", { class: "dim" }, "—"),
          ),
    ),
    roomRules(),
  );
}
