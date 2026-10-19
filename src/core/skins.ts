// Player skins for the heads next to names. Mojang API by UUID (or name if no UUID), cached on disk for a week
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const WEEK = 7 * 24 * 3600_000;
const API = "https://api.mojang.com";
const SESSION = "https://sessionserver.mojang.com";

export interface SkinOwner { uuid?: string | null; name?: string | null }

const cleanUuid = (u: string | null | undefined) => {
  const x = (u ?? "").replace(/-/g, "").toLowerCase();
  return /^[0-9a-f]{32}$/.test(x) ? x : null;
};

function readCache(file: string, maxAge: number): Uint8Array | null {
  try { return Date.now() - statSync(file).mtimeMs < maxAge ? readFileSync(file) : null; } catch { return null; }
}

/** Skin PNG, or null if they have none or Mojang is down and nothing is cached */
export async function skinPng(who: SkinOwner, cacheDir: string): Promise<Uint8Array | null> {
  let uuid = cleanUuid(who.uuid);
  const name = who.name?.trim();
  if (!uuid && !name) return null;
  const file = join(cacheDir, `${uuid ?? `name-${name!.toLowerCase()}`}.png`);
  const fresh = readCache(file, WEEK);
  if (fresh) return fresh;
  try {
    if (!uuid) {
      const r = await fetch(`${API}/users/profiles/minecraft/${encodeURIComponent(name!)}`);
      if (!r.ok) return readCache(file, Infinity);
      uuid = cleanUuid(((await r.json()) as { id?: string }).id);
      if (!uuid) return null;
    }
    const r = await fetch(`${SESSION}/session/minecraft/profile/${uuid}`);
    if (!r.ok) return readCache(file, Infinity);
    const profile = (await r.json()) as { properties?: { name: string; value: string }[] };
    const tex = profile.properties?.find((p) => p.name === "textures");
    const url = tex ? (JSON.parse(Buffer.from(tex.value, "base64").toString()) as { textures?: { SKIN?: { url?: string } } }).textures?.SKIN?.url : undefined;
    if (!url) return null;
    const res = await fetch(url.replace(/^http:/, "https:"));
    const png = new Uint8Array(await res.arrayBuffer());
    // Don't cache an error page as someone's skin
    if (!res.ok || png[0] !== 0x89 || png[1] !== 0x50 || png[2] !== 0x4e || png[3] !== 0x47) return readCache(file, Infinity);
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(file, png);
    return png;
  } catch {
    return readCache(file, Infinity);
  }
}
