// Rank tiers plus their icons, read out of the mod jar (textures/gui/rank/*.png)
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
export { rankOf } from "./tiers";

/** Rank key to icon data URL, from the mod jar */
export function rankIcons(modJar: string | null): Record<string, string> {
  if (!modJar) return {};
  try {
    const files = unzipSync(new Uint8Array(readFileSync(modJar)), { filter: (f) => f.name.startsWith("assets/mcsrranked/textures/gui/rank/") && f.name.endsWith(".png") });
    return Object.fromEntries(Object.entries(files).map(([n, b]) => [n.replace(/^.*\//, "").replace(/\.png$/, ""), `data:image/png;base64,${Buffer.from(b).toString("base64")}`]));
  } catch { return {}; }
}

/** Ranked's blurred menu bg and the structure icon sheet (seed types, bastions, phases) as data URLs */
export function rankedAssets(modJar: string | null): { background: string | null; structures: string | null } {
  const none = { background: null, structures: null };
  if (!modJar) return none;
  try {
    const dir = "assets/mcsrranked/textures/gui/";
    const files = unzipSync(new Uint8Array(readFileSync(modJar)), { filter: (f) => f.name === `${dir}background_blur.png` || f.name === `${dir}structure_icons.png` });
    const url = (n: string) => (files[dir + n] ? `data:image/png;base64,${Buffer.from(files[dir + n]).toString("base64")}` : null);
    return { background: url("background_blur.png"), structures: url("structure_icons.png") };
  } catch { return none; }
}

/** Ranked's current menu background, blurred or sharp. Older releases' ones come from oldart.ts */
export const RANKED_ART: Record<string, string> = { menu: "background_blur.png", menu_sharp: "background.png" };

/** One of those backgrounds as a data URL, null if the jar doesn't have it */
export function rankedArt(modJar: string | null, key: string): string | null {
  const file = RANKED_ART[key];
  if (!modJar || !file) return null;
  try {
    const name = `assets/mcsrranked/textures/gui/${file}`;
    const got = unzipSync(new Uint8Array(readFileSync(modJar)), { filter: (f) => f.name === name })[name];
    return got ? `data:image/png;base64,${Buffer.from(got).toString("base64")}` : null;
  } catch { return null; }
}
