import { g, type UpdateState } from "./bridge";
import { h } from "./dom";
import { icons } from "./icons";
import { isWeb } from "./web";

export let update: UpdateState | null = null;

export function watchUpdates(redraw: () => void) {
  const receive = (u: UpdateState) => {
    update = u;
    redraw();
  };
  void g.update().then(receive);
  g.onUpdate(receive);
}

const pct = (u: UpdateState) => `${Math.round(u.percent ?? 0)}%`;

function railLabel(u: UpdateState): string | null {
  switch (u.status) {
    case "available":
      return `Update to ${u.version}`;
    case "downloading":
      return `Downloading ${u.version}, ${pct(u)}`;
    case "ready":
      return "Restarting";
    default:
      return null;
  }
}

/** Rail button, only while there's something to do */
export function updateRailBtn() {
  const u = update;
  const label = u && railLabel(u);
  if (!u || !label) {
    return null;
  }
  return h(
    "button",
    {
      class: `rail-btn update ${u.status}`,
      title: label,
      "aria-label": label,
      onclick: () => void g.updateInstall(),
    },
    icons.update(),
    u.status === "downloading"
      ? h("span", { class: "count" }, pct(u))
      : h("span", { class: "dot" }),
  );
}

type SettingButton = (label: string, fn: () => void) => HTMLElement;

function settingControl(u: UpdateState, btn: SettingButton): HTMLElement {
  switch (u.status) {
    case "available":
      return btn(`update to ${u.version}`, () => void g.updateInstall());
    case "downloading":
      return h("span", { class: "dim" }, `downloading ${pct(u)}`);
    case "ready":
      return h("span", { class: "dim" }, "restarting");
    default:
      return btn(u.status === "checking" ? "checking…" : "check", () => void g.updateCheck());
  }
}

function settingHint(u: UpdateState): string {
  if (u.status === "none") {
    return `version ${u.current}, the newest one`;
  }
  if (u.status === "error") {
    return `version ${u.current}, couldn't check: ${u.error ?? "offline?"}`;
  }
  return `version ${u.current}`;
}

/** Settings row: what you're on, and check or update */
export function updateSetting(btn: SettingButton): { control: HTMLElement; hint: string } {
  const u = update;
  if (!u || u.status === "off") {
    return {
      control: h("span", { class: "dim" }, u ? `version ${u.current}` : ""),
      hint: isWeb
        ? "the browser version is always the newest"
        : "running from the code, update with git pull",
    };
  }
  return { control: settingControl(u, btn), hint: settingHint(u) };
}
