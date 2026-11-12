import { contextBridge, ipcRenderer } from "electron";

const listen =
  <T>(channel: string) =>
  (fn: (value: T) => void) => {
    ipcRenderer.on(channel, (_e, value) => fn(value));
  };

const api = {
  state: () => ipcRenderer.invoke("state"),
  settings: (patch: unknown) => ipcRenderer.invoke("settings", patch),
  pick: (opts: unknown) => ipcRenderer.invoke("pick", opts),
  enqueue: (picks: unknown) => ipcRenderer.invoke("enqueue", picks),
  queueStatus: (id: number, status: string) => ipcRenderer.invoke("queue:status", id, status),
  practicing: (id: number) => ipcRenderer.invoke("practicing", id),
  race: (id: number) => ipcRenderer.invoke("race", id),
  deleteRace: (id: number) => ipcRenderer.invoke("race:delete", id),
  reanalyze: () => ipcRenderer.invoke("reanalyze"),
  rescan: () => ipcRenderer.invoke("rescan"),
  refresh: () => ipcRenderer.invoke("refresh"),
  rankIcons: () => ipcRenderer.invoke("rank-icons"),
  rankedAssets: () => ipcRenderer.invoke("ranked-assets"),
  rankedArt: (key: string) => ipcRenderer.invoke("ranked-art", key),
  pickArt: () => ipcRenderer.invoke("pick-art"),
  oldArt: () => ipcRenderer.invoke("old-art"),
  fetchOldArt: () => ipcRenderer.invoke("old-art:fetch"),
  skin: (who: { uuid?: string | null; name?: string | null }) => ipcRenderer.invoke("skin", who),
  profile: (season?: number, pool?: number) => ipcRenderer.invoke("profile", season, pool),
  profileMatch: (id: number) => ipcRenderer.invoke("profile:match", id),
  suggestName: () => ipcRenderer.invoke("suggest-name"),
  lookupPlayer: (name: string) => ipcRenderer.invoke("lookup-player", name),
  matchElo: (uuid: string, id: number) => ipcRenderer.invoke("match:elo", uuid, id),
  profileRefresh: (season?: number, pool?: number) =>
    ipcRenderer.invoke("profile:refresh", season, pool),
  copy: (text: string) => ipcRenderer.invoke("copy", text),
  reveal: (file: string) => ipcRenderer.invoke("reveal", file),
  openDir: (file: string) => ipcRenderer.invoke("open-dir", file),
  pickInstance: () => ipcRenderer.invoke("pick-instance"),
  companion: (id: number | null) => ipcRenderer.invoke("companion", id),
  openInMinecraft: (file: string) => ipcRenderer.invoke("open-mc", file),
  launchRanked: () => ipcRenderer.invoke("launch-mc"),
  theme: () => ipcRenderer.invoke("theme"),
  update: () => ipcRenderer.invoke("update"),
  updateCheck: () => ipcRenderer.invoke("update:check"),
  updateInstall: () => ipcRenderer.invoke("update:install"),
  onUpdate: listen<unknown>("update"),
  onTheme: listen<string>("theme"),
  onState: listen<unknown>("state"),
  onOpenRace: listen<number>("open:race"),
  onNewGame: listen<{ id: number | null; title: string; body: string }>("new:game"),
  onCompanionRace: listen<number | null>("companion:race"),
};

contextBridge.exposeInMainWorld("stratas", api);
