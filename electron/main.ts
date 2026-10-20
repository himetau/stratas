// Electron main. Windows, tray and IPC around the core service
import { app, BrowserWindow, clipboard, ipcMain, Menu, nativeImage, Notification, shell, Tray } from "electron";
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync, watch } from "node:fs";
import { homedir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { basename, dirname, join, resolve } from "node:path";
import { Service } from "../src/core/service";
import { rankedArt, rankedAssets, rankIcons } from "../src/core/ranks";
import { cachedOldArt, fetchOldArt, oldArtData } from "../src/core/oldart";
import { skinPng, type SkinOwner } from "../src/core/skins";
import type { Pick } from "../src/core/seeds/picker";

const dataDir = join(process.env.XDG_DATA_HOME || join(homedir(), ".local/share"), "stratas");
const root = join(__dirname, "..");
const iconPath = (s: number) => join(root, "..", "packaging", `icon-${s}.png`);
const background = process.argv.includes("--background");
// matugen writes this (see ~/.config/matugen/templates/stratas-colors.css)
const themeFile = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "stratas", "colors.css");
// Stratas used to be Gapium. Move the old data (games, races, db) and config (window state, matugen colors)
// over once, before anything opens them
function moveFromGapium() {
  const configDir = dirname(themeFile), oldData = join(dirname(dataDir), "gapium");
  // Move what the new folder doesn't have yet, going into subfolders that both have (games/, skins/)
  const merge = (from: string, to: string) => {
    if (!existsSync(to)) { renameSync(from, to); return; }
    for (const f of readdirSync(from)) {
      const a = join(from, f), b = join(to, f);
      if (!existsSync(b)) renameSync(a, b);
      else if (statSync(a).isDirectory() && statSync(b).isDirectory()) merge(a, b);
      else console.error(`left ${a} behind, ${b} already exists`);
    }
    if (!readdirSync(from).length) rmdirSync(from);
  };
  for (const [from, to] of [[oldData, dataDir], [join(dirname(configDir), "gapium"), configDir]]) {
    try { if (existsSync(from)) merge(from, to); } catch (e) { console.error(`couldn't move ${from} to ${to}:`, e); }
  }
  for (const ext of ["", "-wal", "-shm"]) {
    const from = join(dataDir, `gapium.db${ext}`), to = join(dataDir, `stratas.db${ext}`);
    try { if (existsSync(from) && !existsSync(to)) renameSync(from, to); } catch (e) { console.error(`couldn't rename ${from}:`, e); }
  }
  if (existsSync(join(dataDir, "gapium.db"))) console.error("both gapium.db and stratas.db exist, using stratas.db");
  // The database keeps full paths to the games it copied. Checked every launch (not just the one that
  // moved the folder) so a rewrite that failed last time gets another go
  const dbFile = join(dataDir, "stratas.db");
  if (!existsSync(dbFile)) return;
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(dbFile);
    db.exec("PRAGMA busy_timeout = 5000");
    const cols = [["queue", "file"], ["runs", "file"], ["races", "key"], ["races", "your_file"], ["races", "their_file"], ["races", "race_file"]];
    const like = `%${oldData}/%`;
    if (!cols.some(([t, c]) => db!.prepare(`SELECT 1 FROM ${t} WHERE ${c} LIKE ? LIMIT 1`).get(like))) return;
    db.exec("BEGIN");
    for (const [t, c] of cols) db.prepare(`UPDATE ${t} SET ${c} = replace(${c}, ?, ?) WHERE ${c} LIKE ?`).run(oldData + "/", dataDir + "/", like);
    db.exec("COMMIT");
  } catch (e) {
    try { db?.exec("ROLLBACK"); } catch { /* Wasn't in one */ }
    console.error("couldn't update the database's file paths:", e);
  } finally { db?.close(); }
}
moveFromGapium();
let themeCss = "";
const readTheme = () => { try { themeCss = existsSync(themeFile) ? readFileSync(themeFile, "utf8") : ""; } catch { themeCss = ""; } };

let service: Service;
let main: BrowserWindow | null = null;
let companion: BrowserWindow | null = null;
let tray: Tray | null = null;

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => showMain());

function load(win: BrowserWindow, hash = "") {
  // Only ever show our own page. Dropping a link on the window would otherwise load it with the bridge attached
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) void shell.openExternal(url); return { action: "deny" }; });
  void win.loadFile(join(root, "ui", "index.html"), { hash });
}

function showMain() {
  if (main && !main.isDestroyed()) { main.show(); main.focus(); return; }
  main = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 600, title: "Stratas", backgroundColor: "#0f1117",
    icon: iconPath(256), autoHideMenuBar: true,
    webPreferences: { preload: join(root, "electron", "preload.cjs"), contextIsolation: true, sandbox: true },
  });
  load(main);
  main.on("closed", () => { main = null; });
}

function openCompanion(raceId: number | null) {
  if (companion && !companion.isDestroyed()) {
    companion.webContents.send("companion:race", raceId);
    companion.show();
    return;
  }
  const onTop = service.settings().prefs.companionOnTop;
  companion = new BrowserWindow({
    width: 440, height: 720, minWidth: 340, title: "Stratas companion", backgroundColor: "#0f1117", alwaysOnTop: onTop,
    icon: iconPath(256), autoHideMenuBar: true,
    webPreferences: { preload: join(root, "electron", "preload.cjs"), contextIsolation: true, sandbox: true },
  });
  if (onTop) companion.setAlwaysOnTop(true, "floating");
  load(companion, `companion/${raceId ?? ""}`);
  companion.on("closed", () => { companion = null; });
}

/** The UI only ever sends paths to replays in Ranked's folder or our own data folder, anything else is refused */
function ours(file: unknown): file is string {
  if (typeof file !== "string") return false;
  const f = resolve(file), inst = service.state().instance;
  return [dataDir, inst?.ranked].some((d) => d && f.startsWith(resolve(d) + "/"));
}

/** Ranked can't open a replay from outside, so copy its name and focus or launch the game */
function openInMinecraft(file: string): { ok: boolean; message: string } {
  // My Replays only lists mcsrranked/replay/ so copy it there if it's somewhere else (temp-replay)
  const inst0 = service.state().instance;
  if (inst0) {
    const mine = join(inst0.ranked, "replay");
    if (dirname(file) !== mine) {
      const target = join(mine, `match ${basename(file)}`);
      try { if (!existsSync(target)) copyFileSync(file, target); file = target; } catch { /* Keep the original name */ }
    }
  }
  const name = basename(file).replace(/\.rrf$/, "");
  clipboard.writeText(name);
  const steps = "In Ranked: My replays, paste the name into search, Watch.";
  const inst = service.state().instance;
  // Already running? Match the process not the window title since it can be wrapped by waywall
  const gamePids = new Set<number>();
  try {
    for (const line of execFileSync("pgrep", ["-f", inst ? inst.root.replace(/\/minecraft$/, "") : "minecraft"], { encoding: "utf8", timeout: 2000 }).split("\n"))
      if (line.trim()) gamePids.add(Number(line));
  } catch { /* None running */ }
  try {
    const clients = JSON.parse(execFileSync("hyprctl", ["clients", "-j"], { encoding: "utf8", timeout: 2000 })) as { address: string; class: string; title: string; pid: number }[];
    const ancestorOfGame = (pid: number) => [...gamePids].some((g) => { let p = g; for (let i = 0; i < 6 && p > 1; i++) { if (p === pid) return true; try { p = Number(readFileSync(`/proc/${p}/stat`, "utf8").split(") ")[1].split(" ")[1]); } catch { return false; } } return false; });
    const mc = clients.find((c) => gamePids.has(c.pid) || ancestorOfGame(c.pid)) ?? clients.find((c) => /minecraft|waywall/i.test(`${c.class} ${c.title}`));
    if (mc) {
      execFileSync("hyprctl", ["dispatch", "focuswindow", `address:${mc.address}`], { timeout: 2000 });
      return { ok: true, message: `Switched to Minecraft. Replay name copied. ${steps}` };
    }
  } catch { /* Not on Hyprland */ }
  if (gamePids.size) return { ok: true, message: `Minecraft is already running. Replay name copied. ${steps}` };
  if (!inst) return { ok: false, message: "No Ranked instance found. Set it in Settings." };
  const id = basename(dirname(inst.root)); // .../instances/<id>/minecraft
  const tries: [string, string[]][] = [["prismlauncher", ["--launch", id]], ["flatpak", ["run", "org.prismlauncher.PrismLauncher", "--launch", id]]];
  for (const [cmd, args] of tries) {
    try {
      const p = spawn(cmd, args, { detached: true, stdio: "ignore" });
      p.on("error", () => {});
      p.unref();
      return { ok: true, message: `Starting Minecraft. Replay name copied. ${steps}` };
    } catch { /* Try the next launcher */ }
  }
  return { ok: false, message: `Replay name copied, but Prism Launcher wasn't found. Start Ranked yourself, then: ${steps}` };
}

// Background work (scans, downloads) changes state in bursts so those get batched. User actions go out
// right away. Unchanged state isn't sent so the page doesn't redraw
let pending: NodeJS.Timeout | null = null, lastSent = "";
function broadcast() {
  if (pending) { clearTimeout(pending); pending = null; }
  const s = service.state(), json = JSON.stringify(s);
  if (json === lastSent) return;
  lastSent = json;
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send("state", s);
}
const broadcastSoon = () => { if (!pending) pending = setTimeout(broadcast, 250); };
/** IPC handler for a user action, runs it then sends the new state right away */
const now = <A extends unknown[], R>(fn: (...a: A) => R) => async (_e: unknown, ...a: A) => { const r = await fn(...a); broadcast(); return r; };

app.whenReady().then(() => {
  service = new Service(join(dataDir, "stratas.db"));
  service.on("changed", broadcastSoon);
  // Just analysed a Ranked game you played, notify and open it on click
  service.on("newGame", (g: { id: number | null; title: string; body: string }) => {
    const openIt = () => { showMain(); const w = main!; const send = () => w.webContents.send("open:race", g.id ?? 0); if (w.webContents.isLoading()) w.webContents.once("did-finish-load", send); else send(); };
    if (Notification.isSupported()) {
      const n = new Notification({ title: g.title, body: g.body, icon: iconPath(256) });
      n.on("click", openIt);
      n.show();
    }
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send("new:game", g);
    if (g.id && service.settings().prefs.companionAuto) openCompanion(g.id);
  });

  readTheme();
  try {
    // matugen replaces the file, so watch the folder rather than the file
    let t: NodeJS.Timeout | null = null;
    watch(dirname(themeFile), (_e, f) => {
      if (f !== "colors.css") return;
      if (t) clearTimeout(t);
      t = setTimeout(() => { readTheme(); for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send("theme", themeCss); }, 120);
    });
  } catch { /* No folder, use fallback palette */ }
  ipcMain.handle("theme", () => ({ css: themeCss, file: themeFile, found: !!themeCss }));
  ipcMain.handle("state", () => service.state());
  ipcMain.handle("settings", now(async (patch) => {
    await service.updateSettings(patch);
    // Keep on top applies to an open companion straight away
    if (companion && !companion.isDestroyed()) companion.setAlwaysOnTop(service.settings().prefs.companionOnTop, "floating");
  }));
  ipcMain.handle("pick", (_e, opts) => service.pick(opts));
  ipcMain.handle("enqueue", now((picks: Pick[]) => service.enqueue(picks)));
  ipcMain.handle("queue:status", now((id: number, status: Parameters<Service["setQueueStatus"]>[1]) => service.setQueueStatus(id, status)));
  ipcMain.handle("race", (_e, id: number) => service.race(id));
  ipcMain.handle("race:delete", now((id: number) => service.deleteRace(id)));
  ipcMain.handle("reanalyze", () => service.reanalyzeAll());
  ipcMain.handle("rescan", () => { service.rescanLibrary(true); service.pairRuns(); });
  ipcMain.handle("refresh", () => service.refresh());
  ipcMain.handle("profile", (_e, season?: number, pool?: number) => service.profile(season, pool));
  ipcMain.handle("profile:match", (_e, id: number) => service.profileMatch(id));
  ipcMain.handle("profile:refresh", (_e, season?: number, pool?: number) => service.profileRefresh(season, pool));
  let icons: Record<string, string> | null = null;
  // Not cached while empty, so they show up once the instance gets found or set
  ipcMain.handle("rank-icons", () => {
    if (!icons) { const got = rankIcons(service.state().instance?.modJar ?? null); if (Object.keys(got).length) icons = got; return got; }
    return icons;
  });
  let ranked: ReturnType<typeof rankedAssets> | null = null;
  // Big images, read once each and kept
  const art = new Map<string, string | null>();
  ipcMain.handle("ranked-art", (_e, key: string) => {
    if (!art.has(key) || art.get(key) === null) art.set(key, String(key).startsWith("old:") ? oldArtData(oldArtDir, String(key)) : rankedArt(service.state().instance?.modJar ?? null, String(key)));
    return art.get(key);
  });
  // Older Ranked releases' menu backgrounds: what's saved, and going online to look for them
  const oldArtDir = join(dataDir, "ranked-art");
  ipcMain.handle("old-art", () => cachedOldArt(oldArtDir));
  ipcMain.handle("old-art:fetch", () => fetchOldArt(oldArtDir));
  ipcMain.handle("ranked-assets", () => {
    if (!ranked) { const got = rankedAssets(service.state().instance?.modJar ?? null); if (got.background || got.structures) ranked = got; return got; }
    return ranked;
  });
  const skins = new Map<string, Promise<string | null>>();
  ipcMain.handle("skin", (_e, who: SkinOwner) => {
    const key = `${who?.uuid ?? ""}|${(who?.name ?? "").toLowerCase()}`;
    let p = skins.get(key);
    if (!p) {
      p = skinPng(who ?? {}, join(dataDir, "skins")).then((png) => {
        if (!png) { skins.delete(key); return null; } // Offline or rate limited, try again next time
        return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
      });
      skins.set(key, p);
    }
    return p;
  });
  ipcMain.handle("copy", (_e, text: string) => clipboard.writeText(String(text)));
  ipcMain.handle("reveal", (_e, file: string) => { if (ours(file)) shell.showItemInFolder(file); });
  ipcMain.handle("open-dir", (_e, file: string) => (ours(file) ? shell.openPath(dirname(file)) : "not a Stratas file"));
  ipcMain.handle("companion", (_e, id: number | null) => openCompanion(id));
  ipcMain.handle("open-mc", (_e, file: string) => (ours(file) && file.endsWith(".rrf") ? openInMinecraft(file) : { ok: false, message: "That isn't a replay Stratas knows about" }));

  // Throwing here leaves no window and no tray, so log it and open anyway
  try { service.start(); } catch (e) { console.error("couldn't start the service:", e); }

  try {
    tray = new Tray(nativeImage.createFromPath(iconPath(32)));
    tray.setToolTip("Stratas");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Open Stratas", click: () => showMain() },
      { label: "Companion window", click: () => openCompanion(service.state().races[0]?.id ?? null) },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]));
    tray.on("click", () => showMain());
  } catch { tray = null; }

  if (!background || !tray) showMain();
});

app.on("window-all-closed", () => { if (!tray) app.quit(); });
app.on("before-quit", () => service?.stop());
