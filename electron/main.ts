import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  shell,
  Tray,
  type BrowserWindowConstructorOptions,
  type OpenDialogOptions,
  type WebContents,
} from "electron";
import { execFile, execFileSync, spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  statSync,
  watch,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { autoUpdater } from "electron-updater";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { Service } from "../src/core/service";
import { rankedArt, rankedAssets, rankIcons } from "../src/core/ranks";
import { cachedOldArt, fetchOldArt, oldArtData } from "../src/core/oldart";
import { customArtData, saveCustomArt } from "../src/core/customart";
import { skinPng, type SkinOwner } from "../src/core/skins";
import type { Pick } from "../src/core/seeds/picker";
import type { UpdateState } from "../src/core/update";

const linux = process.platform === "linux";
const win = process.platform === "win32";
const dataDir = linux
  ? join(process.env.XDG_DATA_HOME || join(homedir(), ".local/share"), "stratas")
  : join(app.getPath("appData"), "stratas");
const root = join(__dirname, "..");
const iconPath = (s: number) => join(root, "..", "packaging", `icon-${s}.png`);
const background = process.argv.includes("--background");
// matugen writes this file on Linux from ~/.config/matugen/templates/stratas-colors.css.
const themeFile = linux
  ? join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "stratas", "colors.css")
  : join(dataDir, "colors.css");
const oldArtDir = join(dataDir, "ranked-art");
const customArtDir = join(dataDir, "custom-art");
const WINDOW_BACKGROUND = "#0f1117";
const STATE_BATCH_MS = 250;
const THEME_DEBOUNCE_MS = 120;
const PROBE_TIMEOUT_MS = 2000;
const UPDATE_CHECK_INTERVAL_MS = 6 * 3600_000;
const GAPIUM_PATH_COLUMNS = [
  ["queue", "file"],
  ["runs", "file"],
  ["races", "key"],
  ["races", "your_file"],
  ["races", "their_file"],
  ["races", "race_file"],
];

/** Moves into `to` what it lacks from `from`, recursing into folders both have, then removes `from` if empty. */
function mergeFolder(from: string, to: string) {
  if (!existsSync(to)) {
    renameSync(from, to);
    return;
  }
  for (const f of readdirSync(from)) {
    const a = join(from, f);
    const b = join(to, f);
    if (!existsSync(b)) {
      renameSync(a, b);
    } else if (statSync(a).isDirectory() && statSync(b).isDirectory()) {
      mergeFolder(a, b);
    } else {
      console.error(`left ${a} behind, ${b} already exists`);
    }
  }
  if (!readdirSync(from).length) {
    rmdirSync(from);
  }
}

function moveGapiumFolders(oldData: string) {
  const configDir = dirname(themeFile);
  for (const [from, to] of [
    [oldData, dataDir],
    [join(dirname(configDir), "gapium"), configDir],
  ]) {
    try {
      if (existsSync(from)) {
        mergeFolder(from, to);
      }
    } catch (e) {
      console.error(`couldn't move ${from} to ${to}:`, e);
    }
  }
}

function renameGapiumDb() {
  for (const ext of ["", "-wal", "-shm"]) {
    const from = join(dataDir, `gapium.db${ext}`);
    const to = join(dataDir, `stratas.db${ext}`);
    try {
      if (existsSync(from) && !existsSync(to)) {
        renameSync(from, to);
      }
    } catch (e) {
      console.error(`couldn't rename ${from}:`, e);
    }
  }
  if (existsSync(join(dataDir, "gapium.db"))) {
    console.error("both gapium.db and stratas.db exist, using stratas.db");
  }
}

/** Rewrites the database's absolute file paths that still point into Gapium's data folder. */
function rewriteGapiumPaths(oldData: string) {
  const dbFile = join(dataDir, "stratas.db");
  if (!existsSync(dbFile)) {
    return;
  }
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(dbFile);
    db.exec("PRAGMA busy_timeout = 5000");
    const like = `%${oldData}/%`;
    if (
      !GAPIUM_PATH_COLUMNS.some(([t, c]) =>
        db!.prepare(`SELECT 1 FROM ${t} WHERE ${c} LIKE ? LIMIT 1`).get(like),
      )
    ) {
      return;
    }
    db.exec("BEGIN");
    for (const [t, c] of GAPIUM_PATH_COLUMNS) {
      db.prepare(`UPDATE ${t} SET ${c} = replace(${c}, ?, ?) WHERE ${c} LIKE ?`).run(
        oldData + "/",
        dataDir + "/",
        like,
      );
    }
    db.exec("COMMIT");
  } catch (e) {
    try {
      db?.exec("ROLLBACK");
    } catch {
      /* No transaction was open. */
    }
    console.error("couldn't update the database's file paths:", e);
  } finally {
    db?.close();
  }
}

/** Moves Gapium's data, config and database over to Stratas, keeping anything Stratas already has. */
function moveFromGapium() {
  const oldData = join(dirname(dataDir), "gapium");
  moveGapiumFolders(oldData);
  renameGapiumDb();
  rewriteGapiumPaths(oldData);
}

// Gapium only ever ran on Linux.
if (linux) {
  moveFromGapium();
}

let themeCss = "";
function readTheme() {
  try {
    themeCss = existsSync(themeFile) ? readFileSync(themeFile, "utf8") : "";
  } catch {
    themeCss = "";
  }
}

let service: Service;
let main: BrowserWindow | null = null;
let companion: BrowserWindow | null = null;
let tray: Tray | null = null;
const notes = new Set<Notification>();

if (!app.requestSingleInstanceLock()) {
  app.quit();
}
// Windows ties notifications to this id, so it must match the installer's appId.
if (win) {
  app.setAppUserModelId("com.cyoshi.stratas");
}
app.on("second-instance", () => showMain());

function sendToAll(channel: string, payload: unknown) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) {
      w.webContents.send(channel, payload);
    }
  }
}

function createWindow(options: BrowserWindowConstructorOptions) {
  return new BrowserWindow({
    backgroundColor: WINDOW_BACKGROUND,
    icon: iconPath(256),
    autoHideMenuBar: true,
    ...options,
    webPreferences: {
      preload: join(root, "electron", "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  });
}

function load(w: BrowserWindow, hash = "") {
  // A link dropped on the window would load with the bridge attached, so only our own page may load.
  w.webContents.on("will-navigate", (e) => e.preventDefault());
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  void w.loadFile(join(root, "ui", "index.html"), { hash });
}

function showMain() {
  if (main && !main.isDestroyed()) {
    main.show();
    main.focus();
    return;
  }
  main = createWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: "Stratas",
  });
  load(main);
  main.on("closed", () => {
    main = null;
  });
}

function openCompanion(raceId: number | null) {
  if (companion && !companion.isDestroyed()) {
    companion.webContents.send("companion:race", raceId);
    companion.show();
    return;
  }
  const onTop = service.settings().prefs.companionOnTop;
  companion = createWindow({
    width: 440,
    height: 720,
    minWidth: 340,
    title: "Stratas companion",
    alwaysOnTop: onTop,
  });
  if (onTop) {
    companion.setAlwaysOnTop(true, "floating");
  }
  load(companion, `companion/${raceId ?? ""}`);
  companion.on("closed", () => {
    companion = null;
  });
}

/** The UI only ever sends paths to replays in Ranked's folder or our own data folder, anything else is refused */
function ours(file: unknown): file is string {
  if (typeof file !== "string") {
    return false;
  }
  const f = resolve(file);
  const inst = service.state().instance;
  // relative() compares Windows paths case-insensitively.
  const inside = (d: string) => {
    const r = relative(resolve(d), f);
    return !!r && !r.startsWith("..") && !isAbsolute(r);
  };
  return [dataDir, inst?.ranked].some((d) => !!d && inside(d));
}

const isInstancesFolder = (dir: string) => basename(dir).toLowerCase() === "instances";

/** The instance's own folder (Prism's .../instances/<id>, not the minecraft/ inside it), and its id if a launcher can start it */
function instanceInfo(gameDir: string) {
  const name = basename(gameDir);
  const isGameSubfolder =
    name === "minecraft" || (name === ".minecraft" && isInstancesFolder(dirname(dirname(gameDir))));
  const dir = isGameSubfolder ? dirname(gameDir) : gameDir;
  // Prism and MultiMC keep each instance in a folder named "instances".
  const inLauncher = isInstancesFolder(dirname(dir));
  return {
    dir,
    id: inLauncher ? basename(dir) : null,
    launcherDir: inLauncher ? dirname(dirname(dir)) : null,
  };
}

/** Starts a program and says whether it actually started (spawn reports a missing program later, not by throwing) */
const tryStart = (cmd: string, args: string[]) =>
  new Promise<boolean>((done) => {
    try {
      const p = spawn(cmd, args, { detached: true, stdio: "ignore" });
      p.once("spawn", () => {
        p.unref();
        done(true);
      });
      p.once("error", () => done(false));
    } catch {
      done(false);
    }
  });

type GameState = "focused" | "running" | null;

/** Finds the game's processes by their command line, since waywall can wrap the game's window. */
function gamePidsLinux(dir: string): Set<number> {
  const pids = new Set<number>();
  try {
    const pattern = dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const out = execFileSync("pgrep", ["-f", pattern], {
      encoding: "utf8",
      timeout: PROBE_TIMEOUT_MS,
    });
    for (const line of out.split("\n")) {
      if (line.trim()) {
        pids.add(Number(line));
      }
    }
  } catch {
    /* No game process is running. */
  }
  return pids;
}

const parentPid = (pid: number) =>
  Number(readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" ")[1]);

function isAncestorOfAny(pid: number, gamePids: Set<number>) {
  return [...gamePids].some((g) => {
    let p = g;
    for (let i = 0; i < 6 && p > 1; i++) {
      if (p === pid) {
        return true;
      }
      try {
        p = parentPid(p);
      } catch {
        return false;
      }
    }
    return false;
  });
}

/** Focuses the game's window through Hyprland and says whether it found one. */
function focusGameHyprland(gamePids: Set<number>): boolean {
  try {
    const clients = JSON.parse(
      execFileSync("hyprctl", ["clients", "-j"], { encoding: "utf8", timeout: PROBE_TIMEOUT_MS }),
    ) as { address: string; class: string; title: string; pid: number }[];
    const mc =
      clients.find((c) => gamePids.has(c.pid) || isAncestorOfAny(c.pid, gamePids)) ??
      clients.find((c) => /minecraft|waywall/i.test(`${c.class} ${c.title}`));
    if (!mc) {
      return false;
    }
    execFileSync("hyprctl", ["dispatch", "focuswindow", `address:${mc.address}`], {
      timeout: PROBE_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
}

function findGameLinux(dir: string): GameState {
  const pids = gamePidsLinux(dir);
  if (focusGameHyprland(pids)) {
    return "focused";
  }
  return pids.size ? "running" : null;
}

/** Windows: find the game's java process by its command line and bring its window forward */
const findGameWindows = (dir: string) =>
  new Promise<GameState>((done) => {
    const script = [
      "$d = $env:STRATAS_DIR.ToLower()",
      "$p = Get-CimInstance Win32_Process -Filter \"Name='javaw.exe' OR Name='java.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains($d) } | Select-Object -First 1",
      "if ($p) { if ((New-Object -ComObject WScript.Shell).AppActivate([int]$p.ProcessId)) { 'focused' } else { 'running' } }",
    ].join("; ");
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { env: { ...process.env, STRATAS_DIR: dir }, timeout: 8000, windowsHide: true },
      (err, out) => {
        const result = String(out ?? "").trim();
        if (err || (result !== "focused" && result !== "running")) {
          done(null);
          return;
        }
        done(result);
      },
    );
  });

async function findGame(dir: string): Promise<GameState> {
  if (win) {
    return findGameWindows(dir);
  }
  if (linux) {
    return findGameLinux(dir);
  }
  return null;
}

type Command = [string, string[]];

/** Ways to start a Prism or MultiMC instance on this OS, most likely first */
function launchers(id: string, launcherDir: string): Command[] {
  if (win) {
    const local = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    const candidates: Command[] = [
      [join(launcherDir, "MultiMC.exe"), ["-l", id]],
      // Portable Prism keeps its instances next to its executable.
      [join(launcherDir, "prismlauncher.exe"), ["--launch", id]],
      [join(local, "Programs", "PrismLauncher", "prismlauncher.exe"), ["--launch", id]],
      [
        join(homedir(), "scoop", "apps", "prismlauncher", "current", "prismlauncher.exe"),
        ["--launch", id],
      ],
    ];
    return candidates.filter(([exe]) => existsSync(exe));
  }
  const prism: Command[] = [
    ["prismlauncher", ["--launch", id]],
    ["flatpak", ["run", "org.prismlauncher.PrismLauncher", "--launch", id]],
  ];
  return /multimc/i.test(basename(launcherDir)) ? [["multimc", ["-l", id]], ...prism] : prism;
}

const WATCH_STEPS = "In Ranked: My replays, paste the name into search, Watch.";

/** Copies a replay into the folder My Replays lists and returns its path there, or `file` if the copy fails. */
function copyIntoMyReplays(rankedDir: string, file: string): string {
  // Ranked's My Replays only lists mcsrranked/replay/.
  const mine = join(rankedDir, "replay");
  if (dirname(file) === mine) {
    return file;
  }
  const target = join(mine, `match ${basename(file)}`);
  try {
    if (!existsSync(target)) {
      copyFileSync(file, target);
    }
    return target;
  } catch {
    return file;
  }
}

/** Ranked can't open a replay from outside, so copy its name and focus the game. `canLaunch` says the game isn't running and its launcher is known */
async function openInMinecraft(
  file: string,
): Promise<{ ok: boolean; message: string; canLaunch?: boolean }> {
  const inst = service.state().instance;
  const replay = inst ? copyIntoMyReplays(inst.ranked, file) : file;
  clipboard.writeText(basename(replay).replace(/\.rrf$/, ""));
  if (!inst) {
    return { ok: false, message: "No Ranked instance found. Set it in Settings." };
  }
  const { dir, id, launcherDir } = instanceInfo(inst.root);
  const game = await findGame(dir);
  if (game === "focused") {
    return { ok: true, message: `Switched to Minecraft. Replay name copied. ${WATCH_STEPS}` };
  }
  if (game === "running") {
    return {
      ok: true,
      message: `Minecraft is already running. Replay name copied. ${WATCH_STEPS}`,
    };
  }
  return {
    ok: false,
    message: `Replay name copied. Start Ranked, then: ${WATCH_STEPS}`,
    canLaunch: Boolean(id && launcherDir),
  };
}

async function launchRanked(): Promise<{ ok: boolean; message: string }> {
  const failed = {
    ok: false,
    message: `Couldn't start Ranked. Start it yourself, then: ${WATCH_STEPS}`,
  };
  const inst = service.state().instance;
  if (!inst) {
    return failed;
  }
  const { id, launcherDir } = instanceInfo(inst.root);
  if (!id || !launcherDir) {
    return failed;
  }
  for (const [cmd, args] of launchers(id, launcherDir)) {
    if (await tryStart(cmd, args)) {
      return { ok: true, message: `Starting Minecraft. Replay name copied. ${WATCH_STEPS}` };
    }
  }
  return failed;
}

let update: UpdateState = { status: "off", current: app.getVersion() };
function setUpdate(patch: Partial<UpdateState>) {
  update = { ...update, ...patch };
  sendToAll("update", update);
}
function checkUpdate() {
  if (update.status !== "off" && update.status !== "downloading" && update.status !== "ready") {
    void autoUpdater.checkForUpdates().catch(() => {});
  }
}
function setupUpdates() {
  // electron-updater can only update a packaged build, and on Linux only the AppImage.
  if (!app.isPackaged || (linux && !process.env.APPIMAGE)) {
    return;
  }
  update.status = "idle";
  autoUpdater.autoDownload = false;
  autoUpdater.logger = null;
  autoUpdater.on("checking-for-update", () => setUpdate({ status: "checking", error: undefined }));
  autoUpdater.on("update-available", (i) => setUpdate({ status: "available", version: i.version }));
  autoUpdater.on("update-not-available", () => setUpdate({ status: "none" }));
  autoUpdater.on("download-progress", (p) =>
    setUpdate({ status: "downloading", percent: p.percent }),
  );
  autoUpdater.on("update-downloaded", (i) => {
    setUpdate({ status: "ready", version: i.version });
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 800);
  });
  autoUpdater.on("error", (e) =>
    setUpdate({
      status: update.status === "downloading" ? "available" : "error",
      error: e.message,
    }),
  );
  setTimeout(checkUpdate, 10_000);
  setInterval(checkUpdate, UPDATE_CHECK_INTERVAL_MS);
}
function installUpdate() {
  if (update.status === "available") {
    setUpdate({ status: "downloading", percent: 0 });
    void autoUpdater.downloadUpdate().catch(() => {});
  } else if (update.status === "ready") {
    autoUpdater.quitAndInstall(true, true);
  }
}

let pending: NodeJS.Timeout | null = null;
let lastSent = "";
function broadcast() {
  if (pending) {
    clearTimeout(pending);
    pending = null;
  }
  const s = service.state();
  const json = JSON.stringify(s);
  if (json === lastSent) {
    return;
  }
  lastSent = json;
  sendToAll("state", s);
}
function broadcastSoon() {
  if (!pending) {
    pending = setTimeout(broadcast, STATE_BATCH_MS);
  }
}
/** Wraps a user action as an IPC handler that sends the new state as soon as the action finishes. */
const broadcastAfter =
  <A extends unknown[], R>(fn: (...a: A) => R) =>
  async (_e: unknown, ...a: A) => {
    const r = await fn(...a);
    broadcast();
    return r;
  };

type NewGame = { id: number | null; title: string; body: string };

function openRaceInMain(id: number) {
  showMain();
  const w = main!;
  const send = () => w.webContents.send("open:race", id);
  if (w.webContents.isLoading()) {
    w.webContents.once("did-finish-load", send);
  } else {
    send();
  }
}

function notifyNewGame(game: NewGame) {
  if (!Notification.isSupported()) {
    return;
  }
  // Windows drops the click handler of a garbage-collected notification, so each one is held until it closes.
  const n = new Notification({ title: game.title, body: game.body, icon: iconPath(256) });
  notes.add(n);
  n.on("click", () => {
    notes.delete(n);
    openRaceInMain(game.id ?? 0);
  });
  n.on("close", () => notes.delete(n));
  n.show();
}

function onNewGame(game: NewGame) {
  notifyNewGame(game);
  sendToAll("new:game", game);
  if (game.id && service.settings().prefs.companionAuto) {
    openCompanion(game.id);
  }
}

function watchTheme() {
  readTheme();
  try {
    // matugen replaces the file, so the folder is watched rather than the file.
    let timer: NodeJS.Timeout | null = null;
    watch(dirname(themeFile), (_e, f) => {
      if (f !== basename(themeFile)) {
        return;
      }
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        readTheme();
        sendToAll("theme", themeCss);
      }, THEME_DEBOUNCE_MS);
    });
  } catch {
    /* The theme folder does not exist, so the fallback palette applies. */
  }
}

async function showOpenDialog(sender: WebContents, options: OpenDialogOptions) {
  const w = BrowserWindow.fromWebContents(sender);
  return w ? dialog.showOpenDialog(w, options) : dialog.showOpenDialog(options);
}

const currentModJar = () => service.state().instance?.modJar ?? null;

function readArt(key: string) {
  if (key.startsWith("old:")) {
    return oldArtData(oldArtDir, key);
  }
  if (key.startsWith("custom:")) {
    return customArtData(customArtDir, key);
  }
  return rankedArt(currentModJar(), key);
}

function registerArtIpc() {
  let icons: Record<string, string> | null = null;
  ipcMain.handle("rank-icons", () => {
    if (icons) {
      return icons;
    }
    const found = rankIcons(currentModJar());
    if (Object.keys(found).length) {
      icons = found;
    }
    return found;
  });
  let assets: ReturnType<typeof rankedAssets> | null = null;
  ipcMain.handle("ranked-assets", () => {
    if (assets) {
      return assets;
    }
    const found = rankedAssets(currentModJar());
    if (found.background || found.structures) {
      assets = found;
    }
    return found;
  });
  const art = new Map<string, string | null>();
  ipcMain.handle("ranked-art", (_e, key: string) => {
    if (!art.has(key) || art.get(key) === null) {
      art.set(key, readArt(String(key)));
    }
    return art.get(key);
  });
  ipcMain.handle("pick-art", async (e) => {
    const r = await showOpenDialog(e.sender, {
      title: "Pick a background image",
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    });
    return r.canceled || !r.filePaths[0] ? null : saveCustomArt(customArtDir, r.filePaths[0]);
  });
  ipcMain.handle("old-art", () => cachedOldArt(oldArtDir));
  ipcMain.handle("old-art:fetch", () => fetchOldArt(oldArtDir));
  const skins = new Map<string, Promise<string | null>>();
  ipcMain.handle("skin", (_e, who: SkinOwner) => {
    const key = `${who?.uuid ?? ""}|${(who?.name ?? "").toLowerCase()}`;
    let p = skins.get(key);
    if (!p) {
      p = skinPng(who ?? {}, join(dataDir, "skins")).then((png) => {
        if (!png) {
          skins.delete(key);
          return null;
        }
        return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
      });
      skins.set(key, p);
    }
    return p;
  });
}

function registerIpc() {
  ipcMain.handle("update", () => update);
  ipcMain.handle("update:check", () => checkUpdate());
  ipcMain.handle("update:install", () => installUpdate());
  ipcMain.handle("theme", () => ({ css: themeCss, file: themeFile, found: !!themeCss }));
  ipcMain.handle("state", () => service.state());
  ipcMain.handle(
    "settings",
    broadcastAfter(async (patch) => {
      await service.updateSettings(patch);
      if (companion && !companion.isDestroyed()) {
        companion.setAlwaysOnTop(service.settings().prefs.companionOnTop, "floating");
      }
    }),
  );
  ipcMain.handle("pick", (_e, opts) => service.pick(opts));
  ipcMain.handle(
    "enqueue",
    broadcastAfter((picks: Pick[]) => service.enqueue(picks)),
  );
  ipcMain.handle("practicing", (_e, id: number) => service.practicing(Number(id)));
  ipcMain.handle(
    "queue:status",
    broadcastAfter((id: number, status: Parameters<Service["setQueueStatus"]>[1]) =>
      service.setQueueStatus(id, status),
    ),
  );
  ipcMain.handle("race", (_e, id: number) => service.race(id));
  ipcMain.handle(
    "race:delete",
    broadcastAfter((id: number) => service.deleteRace(id)),
  );
  ipcMain.handle("reanalyze", () => service.reanalyzeAll());
  ipcMain.handle("rescan", () => {
    service.rescanLibrary(true);
    service.pairRuns();
  });
  ipcMain.handle("refresh", () => service.refresh());
  ipcMain.handle("profile", (_e, season?: number, pool?: number) => service.profile(season, pool));
  ipcMain.handle("profile:match", (_e, id: number) => service.profileMatch(id));
  ipcMain.handle("suggest-name", () => service.suggestName());
  ipcMain.handle("lookup-player", (_e, name: string) => service.lookupPlayer(String(name)));
  ipcMain.handle("match:elo", (_e, uuid: string, id: number) => service.matchElo(uuid, id));
  ipcMain.handle("profile:refresh", (_e, season?: number, pool?: number) =>
    service.profileRefresh(season, pool),
  );
  registerArtIpc();
  ipcMain.handle("copy", (_e, text: string) => clipboard.writeText(String(text)));
  ipcMain.handle("reveal", (_e, file: string) => {
    if (ours(file)) {
      shell.showItemInFolder(file);
    }
  });
  ipcMain.handle("open-dir", (_e, file: string) =>
    ours(file) ? shell.openPath(dirname(file)) : "not a Stratas file",
  );
  ipcMain.handle("pick-instance", async (e) => {
    const r = await showOpenDialog(e.sender, {
      title: "Pick your Ranked instance folder",
      properties: ["openDirectory"],
    });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  ipcMain.handle("companion", (_e, id: number | null) => openCompanion(id));
  ipcMain.handle("open-mc", (_e, file: string) =>
    ours(file) && file.endsWith(".rrf")
      ? openInMinecraft(file)
      : { ok: false, message: "That isn't a replay Stratas knows about" },
  );
  ipcMain.handle("launch-mc", () => launchRanked());
}

function createTray(): Tray | null {
  try {
    // Windows draws tray icons at 16px, more on scaled screens, and squashes a 32px one.
    const icon = nativeImage.createFromPath(iconPath(win ? 16 : 32));
    if (win) {
      icon.addRepresentation({ scaleFactor: 2, buffer: readFileSync(iconPath(32)) });
    }
    const t = new Tray(icon);
    t.setToolTip("Stratas");
    t.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Open Stratas", click: () => showMain() },
        {
          label: "Companion window",
          click: () => openCompanion(service.state().races[0]?.id ?? null),
        },
        { type: "separator" },
        { label: "Quit", click: () => app.quit() },
      ]),
    );
    t.on("click", () => showMain());
    return t;
  } catch {
    return null;
  }
}

function updateSummary() {
  if (update.status === "off") {
    return "updates off";
  }
  const version = update.version ? ` ${update.version}` : "";
  const error = update.error ? ` (${update.error.split("\n")[0]})` : "";
  return `update ${update.status}${version}${error}`;
}

async function waitForUpdateCheck() {
  for (let i = 0; i < 40 && (update.status === "idle" || update.status === "checking"); i++) {
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** Writes to `reportFile` whether the service runs and the page drew, then exits. CI sets STRATAS_SMOKE to run it. */
function runSmokeTest(reportFile: string, w: BrowserWindow) {
  const report = (ok: boolean, detail: string) => {
    writeFileSync(reportFile, JSON.stringify({ ok, detail, platform: process.platform, dataDir }));
    app.exit(ok ? 0 : 1);
  };
  setTimeout(() => report(false, "timed out"), 60_000);
  w.webContents.once("did-finish-load", () =>
    setTimeout(async () => {
      try {
        const chars = Number(
          await w.webContents.executeJavaScript("document.body.innerText.length"),
        );
        checkUpdate();
        await waitForUpdateCheck();
        const state = service.state();
        report(
          chars > 0,
          `page has ${chars} characters, ${state.races.length} races, instance ${state.instance?.root ?? "none"}, version ${update.current}, ${updateSummary()}`,
        );
      } catch (e) {
        report(false, String(e));
      }
    }, 3000),
  );
}

app.whenReady().then(() => {
  service = new Service(join(dataDir, "stratas.db"));
  service.on("changed", broadcastSoon);
  service.on("newGame", onNewGame);
  watchTheme();
  registerIpc();
  setupUpdates();

  try {
    service.start();
  } catch (e) {
    console.error("couldn't start the service:", e);
  }

  tray = createTray();
  if (!background || !tray) {
    showMain();
  }

  const smoke = process.env.STRATAS_SMOKE;
  if (smoke && main) {
    runSmokeTest(smoke, main);
  }
});

app.on("window-all-closed", () => {
  if (!tray) {
    app.quit();
  }
});
app.on("activate", () => {
  if (service) {
    showMain();
  }
});
app.on("before-quit", () => service?.stop());
