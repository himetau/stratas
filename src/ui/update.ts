// The update button: shows in the rail when a new version is out, and in Settings with the version you're on
import { g, type UpdateState } from "./bridge";
import { h } from "./dom";
import { icons } from "./icons";
import { isWeb } from "./web";

export let update: UpdateState | null = null;

export function watchUpdates(redraw: () => void) {
  void g.update().then((u) => { update = u; redraw(); });
  g.onUpdate((u) => { update = u; redraw(); });
}

const pct = (u: UpdateState) => `${Math.round(u.percent ?? 0)}%`;

/** Rail button, only while there's something to do */
export function updateRailBtn() {
  const u = update;
  if (!u || !["available", "downloading", "ready"].includes(u.status)) return null;
  const label = u.status === "available" ? `Update to ${u.version}` : u.status === "downloading" ? `Downloading ${u.version}, ${pct(u)}` : "Restarting";
  return h("button", { class: `rail-btn update ${u.status}`, title: label, "aria-label": label, onclick: () => void g.updateInstall() },
    icons.update(), u.status === "downloading" ? h("span", { class: "count" }, pct(u)) : h("span", { class: "dot" }));
}

/** Settings row: what you're on, and check or update */
export function updateSetting(btn: (label: string, fn: () => void) => HTMLElement): { control: HTMLElement; hint: string } {
  const u = update;
  if (!u || u.status === "off") return { control: h("span", { class: "dim" }, u ? `version ${u.current}` : ""), hint: isWeb ? "the browser version is always the newest" : "running from the code, update with git pull" };
  const control = u.status === "available" ? btn(`update to ${u.version}`, () => void g.updateInstall())
    : u.status === "downloading" ? h("span", { class: "dim" }, `downloading ${pct(u)}`)
    : u.status === "ready" ? h("span", { class: "dim" }, "restarting")
    : btn(u.status === "checking" ? "checking…" : "check", () => void g.updateCheck());
  const hint = u.status === "none" ? `version ${u.current}, the newest one` : u.status === "error" ? `version ${u.current}, couldn't check: ${u.error ?? "offline?"}` : `version ${u.current}`;
  return { control, hint };
}
