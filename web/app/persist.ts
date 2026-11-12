type Saved = { db: Uint8Array | null; files: [string, { data: Uint8Array; mtime: number }][] };

const EMPTY: Saved = { db: null, files: [] };

const open = () =>
  new Promise<IDBDatabase>((ok, fail) => {
    const r = indexedDB.open("stratas", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });

export async function load(): Promise<Saved> {
  try {
    const db = await open();
    return await new Promise((ok) => {
      const r = db.transaction("kv").objectStore("kv").get("state");
      r.onsuccess = () => ok((r.result as Saved | undefined) ?? EMPTY);
      r.onerror = () => ok(EMPTY);
    });
  } catch {
    return EMPTY;
  }
}

export async function save(s: Saved) {
  try {
    const db = await open();
    await new Promise<void>((ok) => {
      const t = db.transaction("kv", "readwrite");
      t.objectStore("kv").put(s, "state");
      t.oncomplete = () => ok();
      t.onerror = () => ok();
    });
  } catch {
    /* Storage is blocked, so the data only lasts for this visit. */
  }
}
