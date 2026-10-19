// Settings, theme and status
import { g, type AppState } from "../bridge";
import { h, toast } from "../dom";
import { btn, panel } from "../parts";

export let themeInfo: { file: string; found: boolean } = { file: "~/.config/stratas/colors.css", found: false };
export function setThemeInfo(t: { file: string; found: boolean }) { themeInfo = t; }

const SWATCHES = ["--bg-deep", "--bg", "--bg-raised", "--line", "--text-dim", "--text", "--accent", "--you", "--them", "--good", "--bad", "--warn"];

export function settingsView(s: AppState) {
  const st = s.settings, gate = s.gate;
  const row = (name: string, hint: string | null, control: Parameters<typeof h>[2]) =>
    h("div", { class: "set-row" }, h("label", { class: "name" }, name, hint ? h("small", null, hint) : null), control);
  const dot = (ok: "good" | "bad" | "warn", text: string) => h("span", { class: ok }, `■ ${text}`);
  return h("div", { class: "page" },
    h("div", { class: "page-head" }, h("h1", null, "Settings")),
    h("div", { class: "cols c2" },
      panel("Profile", null,
        row("Minecraft name", s.you.elo ? `${s.you.elo} Elo${s.you.rank ? ` · #${s.you.rank}` : ""}` : "auto-detected from replays",
          h("input", { id: "nick", type: "text", value: st.nickname ?? "", onchange: (e: Event) => g.settings({ nickname: (e.target as HTMLInputElement).value.trim() || null }) })),
        row("Notifications", null,
          h("input", { id: "notify", type: "checkbox", class: "toggle", checked: st.notify, onchange: (e: Event) => g.settings({ notify: (e.target as HTMLInputElement).checked }) })),
        row("Auto-build races", null,
          h("input", { id: "auto", type: "checkbox", class: "toggle", checked: st.autoRace, onchange: (e: Event) => g.settings({ autoRace: (e.target as HTMLInputElement).checked }) }))),
      panel("Ranked instance", null,
        row("Instance", s.instance?.ranked ?? "not found",
          h("select", { id: "inst", onchange: (e: Event) => g.settings({ instancePath: (e.target as HTMLSelectElement).value || null }) },
            h("option", { value: "", selected: !st.instancePath }, "Detect"),
            s.instances.map((p) => h("option", { value: p, selected: st.instancePath === p }, p.replace(/^.*instances\//, "").replace(/\/minecraft$/, ""))))),
        row(`MCSR Ranked ${gate.version ?? "?"}`, gate.detail,
          gate.status === "ok" ? dot("good", "format ok") : gate.status === "failed" ? dot("bad", "format changed") : dot("warn", "unchecked")),
        row("Replays", `${s.library.practice} private · ${s.library.ranked} ranked · ${s.library.reference} reference`, null))),
    panel("Theme", { right: themeInfo.found ? h("span", { class: "good" }, "■ matugen") : h("span", { class: "warn" }, "■ default") },
      row("Colours", themeInfo.found ? themeInfo.file : null,
        h("div", { class: "swatches" }, SWATCHES.map((v) => h("span", { title: v, style: `background:var(${v})` }))))),
    panel("Maintenance", null,
      h("div", { class: "row" },
        btn("Rescan replays", async () => { await g.rescan(); toast("Rescanned"); }),
        btn("Re-analyse races", async () => { await g.reanalyze(); toast("Re-analysing"); }),
        h("span", { class: "meta" }, `${s.index.matches.toLocaleString()} matches indexed · ${s.index.apiLeft} API calls left`),
        s.index.error ? h("span", { class: "bad" }, s.index.error) : null)),
    panel("Activity", null, h("pre", { class: "log" }, s.log.length ? s.log.slice().reverse().join("\n") : "Nothing yet.")));
}
