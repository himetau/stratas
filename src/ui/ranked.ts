import { h } from "./dom";

const TILE_PX = 16;

/** Row and column of each tile in Ranked's textures/gui/structure_icons.png. */
const TILE: Record<string, [number, number]> = {
  village: [0, 0],
  buried_treasure: [0, 1],
  shipwreck: [0, 2],
  desert_temple: [0, 3],
  ruined_portal: [1, 0],
  jungle_temple: [1, 1],
  nether: [2, 1],
  bastion: [2, 2],
  fortress: [2, 3],
  portal: [3, 0],
  stronghold: [3, 1],
  end: [3, 2],
  dragon: [3, 3],
  bridge: [4, 3],
  housing: [4, 1],
  stables: [4, 2],
  treasure: [4, 0],
};

let sheet: HTMLImageElement | null = null;
let ready = false;
export function setStructures(url: string) {
  sheet = new Image();
  sheet.onload = () => {
    ready = true;
  };
  sheet.src = url;
}

/** One tile at a multiple of 16px, null if the sheet or tile isn't there */
export function structIcon(key: string | null | undefined, size = 16): HTMLCanvasElement | null {
  const t = key ? TILE[key.toLowerCase()] : undefined;
  if (!t || !sheet) {
    return null;
  }
  const [row, col] = t;
  const c = h("canvas", {
    class: "sicon",
    width: TILE_PX,
    height: TILE_PX,
    style: `width:${size}px;height:${size}px`,
  });
  const draw = () => {
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sheet!, col * TILE_PX, row * TILE_PX, TILE_PX, TILE_PX, 0, 0, TILE_PX, TILE_PX);
  };
  if (ready) {
    draw();
  } else {
    sheet.addEventListener("load", draw, { once: true });
  }
  return c;
}

/** "village / stables" -> overworld and bastion keys */
function seedKeys(seedType: string | null | undefined): {
  ow: string | null;
  bastion: string | null;
} {
  const [ow, bastion] = (seedType ?? "")
    .toLowerCase()
    .split(" / ")
    .map((x) => x.trim().replace(/ /g, "_") || null);
  return { ow: ow ?? null, bastion: bastion ?? null };
}

/** Icon for a phase or graph segment. Travel phases ("To fortress") show where they're going */
export function phaseIconKey(name: string, seedType: string | null | undefined): string | null {
  const { ow, bastion } = seedKeys(seedType);
  const n = name
    .toLowerCase()
    .replace(/^to (?!blind)/, "")
    .replace(/^the /, "");
  if (n.startsWith("fortress")) {
    return "fortress";
  }
  if (n === "overworld") {
    return ow;
  }
  if (n === "nether" || n === "nether travel") {
    return "nether";
  }
  if (n === "bastion") {
    return bastion ?? "bastion";
  }
  if (n === "blind" || n === "pre-blind" || n === "bastion to blind" || n === "to blind") {
    return "portal";
  }
  if (n === "run end" || n === "stronghold") {
    return "stronghold";
  }
  if (n === "end") {
    return "end";
  }
  return null;
}

/** All icons for a phase. Fortress through blind travel gets both fortress and blind portal */
export function phaseIconKeys(name: string, seedType: string | null | undefined): string[] {
  if (name.toLowerCase() === "fortress to stronghold") {
    return ["fortress", "portal"];
  }
  const k = phaseIconKey(name, seedType);
  return k ? [k] : [];
}
