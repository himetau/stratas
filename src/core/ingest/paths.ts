// Finds the Ranked instance, picks the one whose mcsrranked/ folder was used most recently
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

export interface Instance { root: string; ranked: string; modVersion: string | null; modJar: string | null; modTime: number }

/** Where launchers keep their instances on this OS. `many` folders hold one instance per subfolder, `one` is a game folder itself */
function launcherDirs(): { many: string[]; one: string[] } {
  const home = homedir(), env = process.env;
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
      ],
      one: [join(roaming, ".minecraft")],
    };
  }
  if (process.platform === "darwin") {
    const support = join(home, "Library", "Application Support");
    return {
      many: [join(support, "PrismLauncher", "instances"), join(support, "ModrinthApp", "profiles"), join(home, "Documents", "curseforge", "minecraft", "Instances")],
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

export function inspectInstance(root: string): Instance | null {
  const mc = existsSync(join(root, "minecraft")) ? join(root, "minecraft") : existsSync(join(root, ".minecraft")) ? join(root, ".minecraft") : root;
  const mods = join(mc, "mods");
  if (!existsSync(mods)) return null;
  const jar = readdirSync(mods).filter((f) => /^mcsrranked-.*\.jar$/.test(f)).sort().at(-1);
  if (!jar) return null;
  const ranked = join(mc, "mcsrranked");
  return {
    root: mc, ranked, modJar: join(mods, jar),
    modVersion: jar.replace(/^mcsrranked-|\.jar$/g, ""),
    modTime: statSync(join(mods, jar)).mtimeMs,
  };
}

export function findInstances(): Instance[] {
  const out: Instance[] = [];
  const { many, one } = launcherDirs();
  for (const base of many) {
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      try { const i = inspectInstance(join(base, name)); if (i) out.push(i); } catch { /* Unreadable instance */ }
    }
  }
  for (const dir of one) {
    try { const i = existsSync(dir) ? inspectInstance(dir) : null; if (i) out.push(i); } catch { /* Unreadable */ }
  }
  const used = (i: Instance) => { try { return statSync(i.ranked).mtimeMs; } catch { return 0; } };
  return out.sort((a, b) => used(b) - used(a));
}

/** What to call an instance in a list: its folder name, or "Minecraft Launcher" for the official game folder */
export function instanceName(root: string) {
  if (launcherDirs().one.includes(root)) return "Minecraft Launcher";
  return basename(/^\.?minecraft$/.test(basename(root)) ? dirname(root) : root); // .../instances/<name>/minecraft
}

export const replayDirs = (i: Instance) => [join(i.ranked, "replay"), join(i.ranked, "temp-replay")];
export const myReplaysDir = (i: Instance) => join(i.ranked, "replay");
