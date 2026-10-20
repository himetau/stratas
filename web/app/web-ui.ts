// What the browser version adds around the app: a bar saying what only the app does, and dropping replay files anywhere
import { h } from "../../src/ui/dom";
import { addReplayFiles, pickReplays } from "../../src/ui/web";

const DOWNLOAD = "https://github.com/himetau/stratas#get-it-running";

export function banner() {
  let open = false;
  const more = h("div", { class: "web-more" },
    h("p", null, "This is Stratas in your browser. Profile, Find runs and full races from replays you add all work here. The app does the rest on its own:"),
    h("ul", null,
      h("li", null, "Finds your Ranked folder and picks up new replays the moment Ranked saves them, no adding files by hand"),
      h("li", null, "Mixes races straight into My replays, opens Ranked on the replay, and notifies you when a game is ready"),
      h("li", null, "Companion window over the game, quick splits right after a private room run, tray icon, rank icons and menu backgrounds from your Ranked install"),
      h("li", null, "Keeps everything for good. Here it's only saved in this browser")),
    h("p", { class: "dim" }, "Replay files are in your instance: .minecraft/mcsrranked/replay (downloaded and private room runs) and temp-replay (recent ranked games)."));
  const bar = h("div", { class: "web-bar" },
    h("div", { class: "web-bar-row" },
      h("span", null, h("b", null, "Browser version."), " Add replays with the button or drop .rrf files anywhere. The app does it all automatically."),
      h("span", { class: "web-bar-actions" },
        h("button", { class: "web-link", onclick: () => { open = !open; bar.classList.toggle("open", open); } }, "what's different"),
        h("button", { class: "web-link", onclick: () => void pickReplays() }, "add replays"),
        h("a", { class: "web-dl", href: DOWNLOAD, target: "_blank", rel: "noopener" }, "Get the app"))),
    more);
  return bar;
}

export function dropZone() {
  let depth = 0;
  const show = (on: boolean) => document.body.classList.toggle("dropping", on);
  addEventListener("dragenter", (e) => { if (e.dataTransfer?.types.includes("Files")) { depth++; show(true); } });
  addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) show(false); });
  addEventListener("dragover", (e) => { if (e.dataTransfer?.types.includes("Files")) e.preventDefault(); });
  addEventListener("drop", (e) => { e.preventDefault(); depth = 0; show(false); void addReplayFiles([...(e.dataTransfer?.files ?? [])]); });
}
