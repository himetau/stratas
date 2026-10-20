// The app's pages talk to window.stratas. In the desktop app that's Electron, here it's the same Service running in the page
import type { AppState, Bridge, UpdateState } from "../../src/ui/bridge";
import type { Service } from "../../src/core/service";
import type { SkinOwner } from "../../src/core/skins";
import { readFileSync, writeFileSync } from "../shims/fs";
import { REPLAYS } from "./paths";

const download = (file: string) => {
  const bytes = readFileSync(file) as Uint8Array;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/octet-stream" }));
  a.download = file.split("/").pop()!;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
};

export function webBridge(service: Service, version: string): Bridge {
  const stateFns: ((s: AppState) => void)[] = [], openFns: ((id: number) => void)[] = [], gameFns: ((g: { id: number | null; title: string; body: string }) => void)[] = [];
  let pending: ReturnType<typeof setTimeout> | null = null, last = "";
  const broadcast = () => {
    pending = null;
    const s = service.state(), json = JSON.stringify(s);
    if (json === last) return;
    last = json;
    for (const f of stateFns) f(s);
  };
  service.on("changed", () => { if (!pending) pending = setTimeout(broadcast, 250); });
  service.on("newGame", (g) => gameFns.forEach((f) => f(g)));
  // User actions go out right away, like the desktop app does
  const now = <A extends unknown[], R>(fn: (...a: A) => R) => async (...a: A): Promise<Awaited<R>> => { const r = await fn(...a); broadcast(); return r; };
  const skins = new Map<string, Promise<string | null>>();
  const update: UpdateState = { status: "off", current: version };

  const bridge: Bridge = {
    state: async () => service.state(),
    settings: now((patch) => service.updateSettings(patch)),
    pick: (opts) => service.pick(opts),
    enqueue: now((picks) => service.enqueue(picks)),
    queueStatus: now((id, status) => service.setQueueStatus(id, status)),
    practicing: async (id) => service.practicing(id),
    race: async (id) => service.race(id) ?? null,
    deleteRace: now((id) => service.deleteRace(id)),
    reanalyze: async () => service.reanalyzeAll(),
    rescan: now(() => { service.rescanLibrary(true); service.pairRuns(); }),
    refresh: () => service.refresh(),
    profile: (season, pool) => service.profile(season, pool),
    profileMatch: (id) => service.profileMatch(id),
    matchElo: (uuid, id) => service.matchElo(uuid, id),
    profileRefresh: (season, pool) => service.profileRefresh(season, pool),
    // Rank icons and menu art come out of the Ranked mod's files, which the browser can't see
    rankIcons: async () => ({}),
    rankedAssets: async () => ({ background: null, structures: null }),
    rankedArt: async () => null,
    oldArt: async () => [],
    fetchOldArt: async () => [],
    // Mojang's API doesn't answer web pages, mc-heads.net does
    skin: (who: SkinOwner) => {
      const id = who?.uuid || who?.name;
      if (!id) return Promise.resolve(null);
      let p = skins.get(id);
      if (!p) {
        p = fetch(`https://mc-heads.net/skin/${encodeURIComponent(id)}`).then((r) => (r.ok ? r.blob() : null))
          .then((b) => (b ? new Promise<string>((ok) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result)); fr.readAsDataURL(b); }) : null))
          .catch(() => null);
        skins.set(id, p);
      }
      return p;
    },
    copy: async (text) => { try { await navigator.clipboard.writeText(String(text)); } catch { /* Not allowed */ } },
    reveal: async (file) => download(file),
    openDir: async () => {},
    pickInstance: async () => null,
    companion: async () => {},
    // No game to switch to from a web page, so hand over the mixed replay to put in Ranked's folder
    openInMinecraft: async (file) => {
      download(file);
      return { ok: true, message: "Downloaded. Put it in your Ranked folder under .minecraft/mcsrranked/replay, then in Ranked: My replays, Watch." };
    },
    theme: async () => ({ css: "", file: "", found: false }),
    onTheme: () => {},
    onState: (fn) => { stateFns.push(fn); },
    onOpenRace: (fn) => { openFns.push(fn); },
    onNewGame: (fn) => { gameFns.push(fn); },
    onCompanionRace: () => {},
    update: async () => update,
    updateCheck: async () => {},
    updateInstall: async () => {},
    onUpdate: () => {},
    addReplays: async (files) => {
      for (const f of files) writeFileSync(`${REPLAYS}/${f.name}`, f.bytes);
      service.rescanLibrary(true);
      service.pairRuns();
      broadcast();
      return files.length;
    },
  };
  return bridge;
}
