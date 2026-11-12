import type { AppState, Bridge, UpdateState } from "../../src/ui/bridge";
import type { Service } from "../../src/core/service";
import type { SkinOwner } from "../../src/core/skins";
import { readFileSync, writeFileSync } from "../shims/fs";
import { REPLAYS } from "./paths";

const STATE_BATCH_MS = 250;

const download = (file: string) => {
  const bytes = readFileSync(file) as Uint8Array;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/octet-stream" }));
  a.download = file.split("/").pop()!;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
};

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((ok) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result));
    fr.readAsDataURL(b);
  });

// Mojang's API doesn't answer web pages, mc-heads.net does.
const fetchSkin = (id: string): Promise<string | null> =>
  fetch(`https://mc-heads.net/skin/${encodeURIComponent(id)}`)
    .then((r) => (r.ok ? r.blob() : null))
    .then((b) => (b ? blobToDataUrl(b) : null))
    .catch(() => null);

export function webBridge(service: Service, version: string): Bridge {
  const stateFns: ((s: AppState) => void)[] = [];
  const gameFns: ((g: { id: number | null; title: string; body: string }) => void)[] = [];
  let pending: ReturnType<typeof setTimeout> | null = null;
  let last = "";
  const broadcast = () => {
    pending = null;
    const s = service.state();
    const json = JSON.stringify(s);
    if (json === last) {
      return;
    }
    last = json;
    for (const f of stateFns) {
      f(s);
    }
  };
  service.on("changed", () => {
    if (!pending) {
      pending = setTimeout(broadcast, STATE_BATCH_MS);
    }
  });
  service.on("newGame", (g) => {
    for (const f of gameFns) {
      f(g);
    }
  });
  const broadcastAfter =
    <A extends unknown[], R>(fn: (...a: A) => R) =>
    async (...a: A): Promise<Awaited<R>> => {
      const r = await fn(...a);
      broadcast();
      return r;
    };
  const rescan = () => {
    service.rescanLibrary(true);
    service.pairRuns();
  };
  const skins = new Map<string, Promise<string | null>>();
  const update: UpdateState = { status: "off", current: version };

  return {
    state: async () => service.state(),
    settings: broadcastAfter((patch) => service.updateSettings(patch)),
    pick: (opts) => service.pick(opts),
    enqueue: broadcastAfter((picks) => service.enqueue(picks)),
    queueStatus: broadcastAfter((id, status) => service.setQueueStatus(id, status)),
    practicing: async (id) => service.practicing(id),
    race: async (id) => service.race(id) ?? null,
    deleteRace: broadcastAfter((id) => service.deleteRace(id)),
    reanalyze: async () => service.reanalyzeAll(),
    rescan: broadcastAfter(rescan),
    refresh: () => service.refresh(),
    profile: (season, pool) => service.profile(season, pool),
    profileMatch: (id) => service.profileMatch(id),
    suggestName: async () => service.suggestName(),
    lookupPlayer: (name) => service.lookupPlayer(name),
    matchElo: (uuid, id) => service.matchElo(uuid, id),
    profileRefresh: (season, pool) => service.profileRefresh(season, pool),
    // Rank icons and menu art come out of the Ranked mod's files, which the browser can't see.
    rankIcons: async () => ({}),
    rankedAssets: async () => ({ background: null, structures: null }),
    rankedArt: async () => null,
    pickArt: async () => null,
    oldArt: async () => [],
    fetchOldArt: async () => [],
    skin: (who: SkinOwner) => {
      const id = who?.uuid || who?.name;
      if (!id) {
        return Promise.resolve(null);
      }
      let p = skins.get(id);
      if (!p) {
        p = fetchSkin(id);
        skins.set(id, p);
      }
      return p;
    },
    copy: async (text) => {
      try {
        await navigator.clipboard.writeText(String(text));
      } catch {
        /* The browser refused clipboard access. */
      }
    },
    reveal: async (file) => download(file),
    openDir: async () => {},
    pickInstance: async () => null,
    companion: async () => {},
    openInMinecraft: async (file) => {
      download(file);
      return {
        ok: true,
        message:
          "Downloaded. Put it in your Ranked folder under .minecraft/mcsrranked/replay, then in Ranked: My replays, Watch.",
      };
    },
    launchRanked: async () => ({ ok: false, message: "The browser version can't start Ranked" }),
    theme: async () => ({ css: "", file: "", found: false }),
    onTheme: () => {},
    onState: (fn) => {
      stateFns.push(fn);
    },
    onOpenRace: () => {},
    onNewGame: (fn) => {
      gameFns.push(fn);
    },
    onCompanionRace: () => {},
    update: async () => update,
    updateCheck: async () => {},
    updateInstall: async () => {},
    onUpdate: () => {},
    addReplays: async (files) => {
      for (const f of files) {
        writeFileSync(`${REPLAYS}/${f.name}`, f.bytes);
      }
      rescan();
      broadcast();
      return files.length;
    },
  };
}
