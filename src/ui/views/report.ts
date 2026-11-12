import { prefs } from "../prefs";
import type { PhaseReport } from "../../core/detect/analyze";
import { clockSec, deltaClass, fmtClock, fmtDelta, fmtDur, h } from "../dom";
import { fold } from "../parts";

/** Where to look in Ranked's replay viewer */
function watchAt(at: { you?: number; them?: number } | undefined, theirName: string) {
  if (!at || (at.you == null && at.them == null)) {
    return null;
  }
  return h(
    "div",
    { class: "at" },
    at.you != null ? h("span", { class: "you" }, `you ${fmtClock(at.you)}`) : null,
    at.them != null ? h("span", { class: "them" }, `${theirName} ${fmtClock(at.them)}`) : null,
  );
}

export function phaseCard(p: PhaseReport, theirName: string, open: boolean) {
  const summary = [
    h(
      "span",
      { class: `delta ${p.change === null ? "dim" : deltaClass(p.change)}` },
      p.change === null ? "—" : fmtDelta(p.change),
    ),
    h(
      "div",
      { style: "min-width:0" },
      h("div", { class: "title" }, p.phase),
      h(
        "div",
        { class: "sub" },
        p.you !== null
          ? h("span", { class: "you" }, `you ${clockSec(p.you)}`)
          : h("span", null, "you didn't reach it"),
        p.them !== null
          ? h("span", { class: "them" }, `${theirName} ${clockSec(p.them)}`)
          : h("span", null, `${theirName} didn't reach it`),
      ),
    ),
  ];
  const note = (n: PhaseReport["notes"][number]) => {
    const cost = n.seconds;
    const quiet = cost === null || Math.abs(cost) < 1;
    return h(
      "div",
      { class: "row1 note" },
      h("span", { class: `s ${quiet ? "dim" : deltaClass(cost)}` }, quiet ? "·" : fmtDelta(cost)),
      h("span", { class: "txt wide" }, n.text),
      watchAt(n.at, theirName),
    );
  };
  const part = (w: PhaseReport["why"][number]) =>
    h(
      "div",
      { class: "row1" },
      h(
        "span",
        { class: `s ${Math.abs(w.seconds) < 1 ? "dim" : deltaClass(w.seconds)}` },
        fmtDelta(w.seconds),
      ),
      h("span", { class: "lbl" }, w.label),
      h("span", { class: "txt" }, w.text),
      watchAt(w.at, theirName),
    );
  const why = p.why ?? [];
  const body = h(
    "div",
    { class: "body" },
    p.theirsEnded ? h("div", { class: "meta" }, `${theirName}'s run ended here`) : null,
    why.length
      ? h(
          "div",
          null,
          p.unfinished
            ? h("div", { class: "meta", style: "margin-bottom:4px" }, "your run ended here")
            : null,
          why.map(part),
        )
      : null,
    p.notes.length ? h("div", null, p.notes.map(note)) : null,
    playByPlay(p, theirName),
  );
  return fold(summary, open, "finding", body);
}

const KEY_STEP_KINDS = new Set([
  "trade",
  "portal",
  "death",
  "loot",
  "eyes",
  "beds",
  "fight",
  "pause",
]);
const TICKS_PER_SEC = 20;

/** Both runs' steps through a phase side by side, folded */
export function playByPlay(p: PhaseReport, theirName: string) {
  const col = (who: string, name: string, steps: PhaseReport["steps"]["you"]) =>
    h(
      "div",
      { class: "pbp" },
      h("div", { class: `label ${who}` }, name),
      steps.length
        ? steps.map((s) => {
            const ticks = s.t1 - s.t0;
            const key = KEY_STEP_KINDS.has(s.kind) || ticks >= 10 * TICKS_PER_SEC;
            return h(
              "div",
              { class: `step k-${s.kind} ${key ? "key" : "minor"}` },
              h("span", { class: "t" }, fmtClock(s.t0)),
              h(
                "span",
                { class: "d" },
                ticks >= TICKS_PER_SEC ? fmtDur(ticks / TICKS_PER_SEC) : "",
              ),
              h("span", null, s.text, s.detail ? h("small", null, s.detail) : null),
            );
          })
        : h("div", { class: "meta" }, "nothing recorded"),
    );
  return h(
    "details",
    { class: "pbp-fold", open: prefs().playByPlay === "open" },
    h(
      "summary",
      null,
      h("span", { class: "label" }, "Play by play"),
      h(
        "span",
        { class: "meta" },
        `${p.steps.you.length} steps for you, ${p.steps.them.length} for ${theirName}`,
      ),
    ),
    h(
      "div",
      { class: "pbp-cols" },
      col("you", "You", p.steps.you),
      col("them", theirName, p.steps.them),
    ),
  );
}
