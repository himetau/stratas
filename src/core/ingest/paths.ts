import { accessSync, constants, existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

export interface Instance {
  root: string;
  ranked: string;
  modVersion: string | null;
  modJar: string | null;
  modTime: number;
}

/** Where launchers keep their instances on this OS. Each `many` folder holds one instance per
 *  subfolder, and each `one` folder is a game folder itself. */
function launcherDirs(): { many: string[]; one: string[] } {
  const home = homedir();
  const env = process.env;
  if (process.platform === "win32") {
    const roaming = env.APPDATA || join(home, "AppData", "Roaming");
    return {
      many: [
        join(roaming, "PrismLauncher", "instances"),
        join(home, "scoop", "persist", "prismlauncher", "instances"),
        join(roaming, "ModrinthApp", "profiles"),
        join(roaming, "com.modrinth.theseus", "profiles"),
        join(home, "curseforge", "minecraft", "Instances"),
        join(roaming, "gdlauncher_carbon", "data", "instances"),
        join(roaming, "ATLauncher", "instances"),
        // MultiMC is portable, so these are the usual places people unzip it.
        ...[
          env.SystemDrive ? env.SystemDrive + "\\" : "C:\\",
          home,
          join(home, "Desktop"),
          join(home, "Documents"),
          join(home, "Downloads"),
        ].map((d) => join(d, "MultiMC", "instances")),
      ],
      one: [join(roaming, ".minecraft")],
    };
  }
  if (process.platform === "darwin") {
    const support = join(home, "Library", "Application Support");
    return {
      many: [
        join(support, "PrismLauncher", "instances"),
        join(support, "ModrinthApp", "profiles"),
        join(home, "Documents", "curseforge", "minecraft", "Instances"),
      ],
      one: [join(support, "minecraft")],
    };
  }
  const share = env.XDG_DATA_HOME || join(home, ".local", "share");
  return {
    many: [
      join(share, "PrismLauncher", "instances"),
      join(home, ".var/app/org.prismlauncher.PrismLauncher/data/PrismLauncher/instances"),
      join(share, "multimc", "instances"),
      join(share, "ModrinthApp", "profiles"),
      join(home, ".var/app/com.modrinth.ModrinthApp/data/ModrinthApp/profiles"),
    ],
    one: [join(home, ".minecraft")],
  };
}

/** Picks the mcsrranked folder by the mod's rule: a usable ~/mcsrranked is shared by every
 *  instance, otherwise each instance keeps its own. */
function rankedDir(mc: string) {
  const global = join(homedir(), "mcsrranked");
  try {
    accessSync(global, constants.R_OK | constants.W_OK);
    return global;
  } catch {
    return join(mc, "mcsrranked");
  }
}

function gameDir(root: string): string {
  for (const sub of ["minecraft", ".minecraft"]) {
    const dir = join(root, sub);
    if (existsSync(dir)) {
      return dir;
    }
  }
  return root;
}

export function inspectInstance(root: string): Instance | null {
  const mc = gameDir(root);
  const mods = join(mc, "mods");
  if (!existsSync(mods)) {
    return null;
  }
  const jar = readdirSync(mods)
    .filter((f) => /^mcsrranked-.*\.jar$/.test(f))
    .sort()
    .at(-1);
  if (!jar) {
    return null;
  }
  const modJar = join(mods, jar);
  return {
    root: mc,
    ranked: rankedDir(mc),
    modJar,
    modVersion: jar.replace(/^mcsrranked-|\.jar$/g, ""),
    modTime: statSync(modJar).mtimeMs,
  };
}

function inspectReadable(root: string): Instance | null {
  try {
    return inspectInstance(root);
  } catch {
    return null;
  }
}

function lastUsed(i: Instance): number {
  try {
    return statSync(i.ranked).mtimeMs;
  } catch {
    return 0;
  }
}

function entriesOf(dir: string): string[] {
  try {
    return readdirSync(dir).map((name) => join(dir, name));
  } catch {
    return [];
  }
}

/** Finds every Ranked instance, the one whose mcsrranked folder was used most recently first. */
export function findInstances(): Instance[] {
  const { many, one } = launcherDirs();
  const roots = [...many.flatMap(entriesOf), ...one.filter((dir) => existsSync(dir))];
  return roots
    .map(inspectReadable)
    .filter((i): i is Instance => i !== null)
    .sort((a, b) => lastUsed(b) - lastUsed(a));
}

/** Names an instance for a list: its folder name,
 *  or "Minecraft Launcher" for the official game folder. */
export function instanceName(root: string) {
  if (launcherDirs().one.includes(root)) {
    return "Minecraft Launcher";
  }
  const instanceFolder = /^\.?minecraft$/.test(basename(root)) ? dirname(root) : root;
  return basename(instanceFolder);
}

export const myReplaysDir = (i: Instance) => join(i.ranked, "replay");
export const replayDirs = (i: Instance) => [myReplaysDir(i), join(i.ranked, "temp-replay")];
