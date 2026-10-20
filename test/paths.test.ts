import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A fake home with launchers in it, then findInstances as each OS would see it
let home: string;
const ranked = (gameDir: string) => {
  mkdirSync(join(gameDir, "mods"), { recursive: true });
  mkdirSync(join(gameDir, "mcsrranked"), { recursive: true });
  writeFileSync(join(gameDir, "mods", "mcsrranked-5.1.0.jar"), "");
};

async function findOn(platform: NodeJS.Platform, env: Record<string, string> = {}) {
  vi.resetModules();
  vi.doMock("node:os", async (orig) => ({ ...(await orig<typeof import("node:os")>()), homedir: () => home }));
  const old = process.platform;
  Object.defineProperty(process, "platform", { value: platform });
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  try {
    const { findInstances, instanceName } = await import("../src/core/ingest/paths");
    return findInstances().map((i) => instanceName(i.root)).sort();
  } finally { Object.defineProperty(process, "platform", { value: old }); }
}

beforeEach(() => { home = mkdtempSync(join(tmpdir(), "stratas-home-")); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.doUnmock("node:os"); });

describe("finding Ranked instances", () => {
  it("finds Prism, Modrinth, CurseForge and the official launcher on Windows", async () => {
    const roaming = join(home, "AppData", "Roaming");
    ranked(join(roaming, "PrismLauncher", "instances", "Ranked", "minecraft"));
    ranked(join(roaming, "ModrinthApp", "profiles", "MCSR"));
    ranked(join(home, "curseforge", "minecraft", "Instances", "Speedrun"));
    ranked(join(roaming, ".minecraft"));
    mkdirSync(join(roaming, "PrismLauncher", "instances", "Vanilla", "minecraft", "mods"), { recursive: true }); // No Ranked mod
    expect(await findOn("win32", { APPDATA: roaming })).toEqual(["MCSR", "Minecraft Launcher", "Ranked", "Speedrun"]);
  });

  it("uses XDG_DATA_HOME and the flatpak folder on Linux", async () => {
    ranked(join(home, "data", "PrismLauncher", "instances", "Ranked 1.16", ".minecraft"));
    ranked(join(home, ".var/app/org.prismlauncher.PrismLauncher/data/PrismLauncher/instances/Flat/minecraft"));
    expect(await findOn("linux", { XDG_DATA_HOME: join(home, "data") })).toEqual(["Flat", "Ranked 1.16"]);
  });
});
