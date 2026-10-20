/// <reference types="vite/client" />
// Stratas in the browser: the app's Service and pages, with replays you add by hand instead of a watched Ranked folder
import "../shims/process";
import "./flag";
import "../../src/ui/styles.css";
import "./web.css";
import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { allFiles, existsSync, loadFiles, onFilesChanged, writeFileSync } from "../shims/fs";
import { exportDb, useSqlJs } from "../shims/sqlite";
import { load, save } from "./persist";
import { DB, INSTANCE, MOD_JAR } from "./paths";
import { webBridge } from "./bridge";
import { banner, dropZone } from "./web-ui";
import pkg from "../../package.json";

const saved = await load();
useSqlJs(await initSqlJs({ locateFile: () => wasmUrl }), saved.db);
loadFiles(saved.files);
// A pretend Ranked instance for replays you add, so pairing and mixing work like in the app
if (!existsSync(MOD_JAR)) writeFileSync(MOD_JAR, new Uint8Array(0), 0);

const { Service } = await import("../../src/core/service");
const service = new Service(DB);
service.store.set("settings", { ...service.store.get<Record<string, unknown>>("settings", {}), instancePath: INSTANCE });

// Save a few seconds after things settle, and when you leave
let timer: ReturnType<typeof setTimeout> | null = null;
const persist = () => void save({ db: exportDb(), files: allFiles() });
const soon = () => { if (timer) clearTimeout(timer); timer = setTimeout(persist, 4000); };
service.on("changed", soon);
onFilesChanged(soon);
addEventListener("pagehide", persist);

(window as unknown as { stratas: unknown }).stratas = webBridge(service, pkg.version);
service.start();
document.body.classList.add("web");
document.body.prepend(banner());
dropZone();
await import("../../src/ui/main");
