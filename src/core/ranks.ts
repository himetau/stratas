import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { unzipSync } from "fflate";

const GUI_DIR = "assets/mcsrranked/textures/gui/";
const RANK_ICON_DIR = `${GUI_DIR}rank/`;

/** Ranked's current menu backgrounds, blurred or sharp.
 *  Older releases' backgrounds come from oldart.ts. */
const RANKED_ART: Record<string, string> = {
  menu: "background_blur.png",
  menu_sharp: "background.png",
};

const pngDataUrl = (bytes: Uint8Array) =>
  `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;

function unzipJar(modJar: string, keep: (name: string) => boolean): Record<string, Uint8Array> {
  return unzipSync(new Uint8Array(readFileSync(modJar)), { filter: (f) => keep(f.name) });
}

/** Maps each rank key to its icon from the mod jar, as a data URL. */
export function rankIcons(modJar: string | null): Record<string, string> {
  if (!modJar) {
    return {};
  }
  try {
    const files = unzipJar(
      modJar,
      (name) => name.startsWith(RANK_ICON_DIR) && name.endsWith(".png"),
    );
    return Object.fromEntries(
      Object.entries(files).map(([name, bytes]) => [
        posix.basename(name).slice(0, -".png".length),
        pngDataUrl(bytes),
      ]),
    );
  } catch {
    return {};
  }
}

/** Ranked's blurred menu background and its structure icon sheet (seed types, bastions, phases),
 *  both as data URLs. */
export function rankedAssets(modJar: string | null): {
  background: string | null;
  structures: string | null;
} {
  const none = { background: null, structures: null };
  if (!modJar) {
    return none;
  }
  try {
    const background = `${GUI_DIR}background_blur.png`;
    const structures = `${GUI_DIR}structure_icons.png`;
    const files = unzipJar(modJar, (name) => name === background || name === structures);
    const dataUrl = (name: string) => (files[name] ? pngDataUrl(files[name]) : null);
    return { background: dataUrl(background), structures: dataUrl(structures) };
  } catch {
    return none;
  }
}

/** One of the RANKED_ART backgrounds as a data URL, null if the jar does not have it. */
export function rankedArt(modJar: string | null, key: string): string | null {
  const file = RANKED_ART[key];
  if (!modJar || !file) {
    return null;
  }
  try {
    const name = GUI_DIR + file;
    const bytes = unzipJar(modJar, (n) => n === name)[name];
    return bytes ? pngDataUrl(bytes) : null;
  } catch {
    return null;
  }
}
