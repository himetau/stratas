// Keeps the database and your replays in the browser (IndexedDB) between visits
type Saved = { db: Uint8Array | null; files: [string, { data: Uint8Array; mtime: number }][] };

const open = () => new Promise<IDBDatabase>((ok, fail) => {
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
      r.onsuccess = () => ok((r.result as Saved | undefined) ?? { db: null, files: [] });
      r.onerror = () => ok({ db: null, files: [] });
    });
  } catch { return { db: null, files: [] }; } // Private window or storage blocked, start empty
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
  } catch { /* Can't save, it still works for this visit */ }
}

export async function clear() {
  try { const db = await open(); db.transaction("kv", "readwrite").objectStore("kv").clear(); } catch { /* Nothing saved */ }
}
