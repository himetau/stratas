import { g } from "./bridge";
import { h, toast } from "./dom";

export const isWeb = !!(window as unknown as { stratasWeb?: boolean }).stratasWeb;

export async function addReplayFiles(files: File[]) {
  const rrf = files.filter((f) => f.name.toLowerCase().endsWith(".rrf"));
  if (!rrf.length) {
    toast("Those aren't replays, they end in .rrf");
    return;
  }
  const replays = await Promise.all(
    rrf.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })),
  );
  const n = await g.addReplays!(replays);
  toast(`Added ${n} ${n === 1 ? "replay" : "replays"}`);
}

export function pickReplays() {
  const input = h("input", { type: "file", accept: ".rrf", multiple: true });
  input.onchange = () => void addReplayFiles([...(input.files ?? [])]);
  input.click();
}
