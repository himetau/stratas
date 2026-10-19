// IPC bridge between the UI and main
import { contextBridge, ipcRenderer } from "electron";

const api = {
  state: () => ipcRenderer.invoke("state"),
  settings: (patch: unknown) => ipcRenderer.invoke("settings", patch),
  pick: (opts: unknown) => ipcRenderer.invoke("pick", opts),
  enqueue: (picks: unknown) => ipcRenderer.invoke("enqueue", picks),
  queueStatus: (id: number, status: string) => ipcRenderer.invoke("queue:status", id, status),
  race: (id: number) => ipcRenderer.invoke("race", id),
  deleteRace: (id: number) => ipcRenderer.invoke("race:delete", id),
  reanalyze: () => ipcRenderer.invoke("reanalyze"),
  rescan: () => ipcRenderer.invoke("rescan"),
  refresh: () => ipcRenderer.invoke("refresh"),
  rankIcons: () => ipcRenderer.invoke("rank-icons"),
  rankedAssets: () => ipcRenderer.invoke("ranked-assets"),
  skin: (who: { uuid?: string | null; name?: string | null }) => ipcRenderer.invoke("skin", who),
  profile: (season?: number, pool?: number) => ipcRenderer.invoke("profile", season, pool),
  profileMatch: (id: number) => ipcRenderer.invoke("profile:match", id),
  profileRefresh: (season?: number, pool?: number) => ipcRenderer.invoke("profile:refresh", season, pool),
  copy: (text: string) => ipcRenderer.invoke("copy", text),
  reveal: (file: string) => ipcRenderer.invoke("reveal", file),
  openDir: (file: string) => ipcRenderer.invoke("open-dir", file),
  companion: (id: number | null) => ipcRenderer.invoke("companion", id),
  openInMinecraft: (file: string) => ipcRenderer.invoke("open-mc", file),
  theme: () => ipcRenderer.invoke("theme"),
  onTheme: (fn: (css: string) => void) => { ipcRenderer.on("theme", (_e, css) => fn(css)); },
  onState: (fn: (s: unknown) => void) => { ipcRenderer.on("state", (_e, s) => fn(s)); },
  onOpenRace: (fn: (id: number) => void) => { ipcRenderer.on("open:race", (_e, id) => fn(id)); },
  onNewGame: (fn: (g: { id: number | null; title: string; body: string }) => void) => { ipcRenderer.on("new:game", (_e, g) => fn(g)); },
  onCompanionRace: (fn: (id: number | null) => void) => { ipcRenderer.on("companion:race", (_e, id) => fn(id)); },
};

contextBridge.exposeInMainWorld("stratas", api);
export type StratasBridge = typeof api;
