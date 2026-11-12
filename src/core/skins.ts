import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const WEEK = 7 * 24 * 3600_000;
const API = "https://api.mojang.com";
const SESSION = "https://sessionserver.mojang.com";
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

export interface SkinOwner {
  uuid?: string | null;
  name?: string | null;
}

const cleanUuid = (u: string | null | undefined) => {
  const x = (u ?? "").replace(/-/g, "").toLowerCase();
  return /^[0-9a-f]{32}$/.test(x) ? x : null;
};

const cleanName = (n: string | null | undefined) => {
  const x = (n ?? "").trim();
  return /^\w{1,16}$/.test(x) ? x : null;
};

const isPng = (bytes: Uint8Array) => PNG_SIGNATURE.every((b, i) => bytes[i] === b);

function readCache(file: string, maxAge: number): Uint8Array | null {
  try {
    return Date.now() - statSync(file).mtimeMs < maxAge ? readFileSync(file) : null;
  } catch {
    return null;
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${res.status} for ${url}`);
  }
  return (await res.json()) as T;
}

async function uuidForName(name: string): Promise<string | null> {
  const profile = await fetchJson<{ id?: string }>(
    `${API}/users/profiles/minecraft/${encodeURIComponent(name)}`,
  );
  return cleanUuid(profile.id);
}

async function skinUrl(uuid: string): Promise<string | undefined> {
  const profile = await fetchJson<{ properties?: { name: string; value: string }[] }>(
    `${SESSION}/session/minecraft/profile/${uuid}`,
  );
  const textures = profile.properties?.find((p) => p.name === "textures");
  if (!textures) {
    return undefined;
  }
  const decoded = JSON.parse(Buffer.from(textures.value, "base64").toString()) as {
    textures?: { SKIN?: { url?: string } };
  };
  return decoded.textures?.SKIN?.url;
}

/** Skin PNG by UUID, or by name without one, cached on disk for a week.
 *  Null if they have no skin, or Mojang is down and nothing is cached. */
export async function skinPng(who: SkinOwner, cacheDir: string): Promise<Uint8Array | null> {
  let uuid = cleanUuid(who.uuid);
  const name = cleanName(who.name);
  if (!uuid && !name) {
    return null;
  }
  const file = join(cacheDir, `${uuid ?? `name-${name!.toLowerCase()}`}.png`);
  const fresh = readCache(file, WEEK);
  if (fresh) {
    return fresh;
  }
  try {
    uuid ??= await uuidForName(name!);
    if (!uuid) {
      return null;
    }
    const url = await skinUrl(uuid);
    if (!url) {
      return null;
    }
    const res = await fetch(url.replace(/^http:/, "https:"));
    const png = new Uint8Array(await res.arrayBuffer());
    if (!res.ok || !isPng(png)) {
      return readCache(file, Infinity);
    }
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(file, png);
    return png;
  } catch {
    return readCache(file, Infinity);
  }
}
