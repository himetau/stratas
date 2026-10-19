// Finds the Ranked instance, picks the one whose mcsrranked/ folder was used most recently
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Instance { root: string; ranked: string; modVersion: string | null; modJar: string | null; modTime: number }

const LAUNCHER_DIRS = [
  ".local/share/PrismLauncher/instances",
  ".var/app/org.prismlauncher.PrismLauncher/data/PrismLauncher/instances",
  ".local/share/multimc/instances",
  ".local/share/ModrinthApp/profiles",
  "AppData/Roaming/PrismLauncher/instances",
  "Library/Application Support/PrismLauncher/instances",
];

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
  for (const d of LAUNCHER_DIRS) {
    const base = join(homedir(), d);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      try { const i = inspectInstance(join(base, name)); if (i) out.push(i); } catch { /* Unreadable instance */ }
    }
  }
  const used = (i: Instance) => { try { return statSync(i.ranked).mtimeMs; } catch { return 0; } };
  return out.sort((a, b) => used(b) - used(a));
}

export const replayDirs = (i: Instance) => [join(i.ranked, "replay"), join(i.ranked, "temp-replay")];
export const myReplaysDir = (i: Instance) => join(i.ranked, "replay");
