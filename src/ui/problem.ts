import { g, type AppState } from "./bridge";
import { toast } from "./dom";
import { update } from "./update";
import { isWeb } from "./web";

const ISSUES = "https://github.com/himetau/stratas/issues/new";

const scrubUserNames = (t: string) =>
  t
    .replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/"'\n]+/gi, "$1<you>") // Windows user names can have spaces
    .replace(/(\/home\/|\/Users\/)[^/\s"']+/g, "$1<you>");

function os() {
  const ua = navigator.userAgent;
  if (/Windows/.test(ua)) {
    return "Windows";
  }
  if (/Mac OS/.test(ua)) {
    return "macOS";
  }
  if (/Linux/.test(ua)) {
    return "Linux";
  }
  return navigator.platform || "?";
}

function problemReport(s: AppState): string {
  const how = isWeb ? "browser" : update?.status === "off" ? "from the code" : "app";
  const lines = [
    `Stratas ${update?.current ?? "?"} (${how}), ${os()}`,
    `MCSR Ranked ${s.gate.version ?? "?"}, replay format ${s.gate.status}`,
    isWeb
      ? null
      : `Instance: ${s.instance ? "found" : "not found"}${s.settings.instancePath ? ", set by hand" : ", detected"}`,
    `Replays: ${s.library.practice} private, ${s.library.ranked} ranked, ${s.library.reference} reference, ${s.library.unreadable} unreadable`,
    `Match index: ${s.index.matches} matches${s.index.error ? `, error: ${s.index.error}` : ""}`,
    `Queue: ${s.queue.length}, games: ${s.races.length}, errors: ${s.races.filter((r) => r.error).length}`,
  ].filter(Boolean);
  return scrubUserNames(
    [
      "### Details",
      "",
      ...lines,
      "",
      "<details><summary>Activity log</summary>",
      "",
      "```",
      ...(s.log.length ? s.log : ["(empty)"]),
      "```",
      "",
      "</details>",
    ].join("\n"),
  );
}

export async function reportProblem(s: AppState) {
  await g.copy(problemReport(s));
  toast("Details copied. Paste them into the issue that just opened", 8000);
  window.open(`${ISSUES}?template=bug.yml`, "_blank");
}

export const suggestFeature = () => {
  window.open(`${ISSUES}?template=feature.yml`, "_blank");
};
