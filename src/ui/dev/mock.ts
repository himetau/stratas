// Browser-only mock of the Electron bridge, fed by snapshot.json (npm run snapshot)
// Only loads when window.stratas is missing, so never in Electron
type Snap = {
  state: Record<string, unknown> & { queue: { match_id: number; status: string }[] };
  races: Record<string, unknown>;
  profile?: unknown;
  matchDetails?: Record<string, unknown>;
};

export async function installMock() {
  // Fetched rather than imported so the type check works without a snapshot (it isn't in git)
  let text = await fetch(new URL("./snapshot.json", import.meta.url)).then((r) => r.text());
  // ?cast renames everyone but you to Frieren and Fern, skins included, for screenshots
  const cast = new URLSearchParams(location.search).has("cast");
  if (cast) text = recast(text);
  const snap = JSON.parse(text) as Snap;
  const listeners: ((s: unknown) => void)[] = [];
  let update = { status: "available" as string, current: "1.0.0", version: "1.1.0", percent: undefined as number | undefined };
  const updateListeners: ((u: typeof update) => void)[] = [];
  // Dev server reads these from your Ranked instance (vite.config.ts)
  const ranked: Promise<{ icons: Record<string, string>; background: string | null; structures: string | null }> = fetch("/__dev/ranked").then((r) => r.json()).catch(() => ({ icons: {}, background: null, structures: null }));
  const push = () => listeners.forEach((f) => f(structuredClone(snap.state)));
  (window as unknown as { stratas: unknown }).stratas = {
    state: async () => structuredClone(snap.state),
    settings: async (p: Record<string, unknown>) => { Object.assign(snap.state.settings as object, p); push(); },
    // Preview has no match index so it uses the queued runs as picks
    pick: async () => ({
      picks: (snap.state.queue as unknown as Record<string, unknown>[]).slice(0, 3).map((q) => ({
        tier: q.tier, reason: q.reason,
        match: { id: q.match_id, date: q.date, seed_type: q.seed_type, bastion_type: q.bastion_type, variations: "", winner_uuid: q.player_uuid, winner_name: q.player_name,
          winner_elo: q.elo, loser_uuid: null, loser_name: q.opponent_name, loser_elo: null, time: q.time, forfeited: 0, replay: 1 },
      })),
      notes: ["Browser preview: these are the queued runs from the snapshot."],
    }),
    enqueue: async () => {},
    queueStatus: async (id: number, status: string) => { const q = snap.state.queue.find((x) => x.match_id === id); if (q) q.status = status; push(); },
    race: async (id: number) => snap.races[id] ?? null,
    deleteRace: async () => {},
    reanalyze: async () => {},
    rescan: async () => {},
    copy: async (t: string) => console.log("copy", t),
    reveal: async () => {},
    openDir: async () => {},
    pickInstance: async () => null,
    practicing: async () => {},
    // Pretends a new version is out so the update button shows, and walks through the download
    update: async () => update,
    updateCheck: async () => {},
    updateInstall: async () => {
      for (let p = 0; p <= 100; p += 20) { update = { ...update, status: "downloading", percent: p }; updateListeners.forEach((f) => f(update)); await new Promise((r) => setTimeout(r, 300)); }
      update = { ...update, status: "ready" }; updateListeners.forEach((f) => f(update));
    },
    onUpdate: (f: (u: typeof update) => void) => updateListeners.push(f),
    companion: async () => {},
    openInMinecraft: async () => ({ ok: true, message: "Replay name copied. In Ranked: My replays, paste the name into search, Watch." }),
    theme: async () => ({ css: "", file: "~/.config/stratas/colors.css", found: false }),
    onTheme: () => {},
    onState: (f: (s: unknown) => void) => listeners.push(f),
    onCompanionRace: () => {},
    onOpenRace: () => {},
    refresh: async () => {},
    rankIcons: async () => (await ranked).icons,
    rankedAssets: async () => { const r = await ranked; return { background: r.background, structures: r.structures }; },
    oldArt: async () => (await fetch("/__dev/oldart")).json(),
    fetchOldArt: async () => (await fetch("/__dev/oldart?fetch=1")).json(),
    rankedArt: async (key: string) => { const r = await fetch(`/__dev/art?key=${encodeURIComponent(key)}`); return r.ok ? r.text() : null; },
    skin: async (who: { uuid?: string | null; name?: string | null }) => {
      const alias = cast && (who.name === "Frieren" || who.name === "Fern");
      // Skins dropped in dev/cast (not in git) win, otherwise whoever owns the name on Mojang
      const local = alias ? await fetch(new URL(`./cast/${who.name!.toLowerCase()}.png`, import.meta.url)).catch(() => null) : null;
      const r = local?.ok && local.headers.get("content-type")?.startsWith("image/") ? local
        : await fetch(`/__dev/skin?uuid=${encodeURIComponent(alias ? "" : who.uuid ?? "")}&name=${encodeURIComponent(who.name ?? "")}`);
      if (!r.ok) return null;
      const b = await r.blob();
      return await new Promise<string>((ok) => { const f = new FileReader(); f.onload = () => ok(String(f.result)); f.readAsDataURL(b); });
    },
    onNewGame: () => {},
    profile: async () => structuredClone(snap.profile ?? null),
    profileMatch: async (id: number) => structuredClone(snap.matchDetails?.[id] ?? null),
    suggestName: async () => "Feinberg",
    lookupPlayer: async (name: string) => ({ nickname: name, uuid: "9a8e24df4c8549d696a6951da84fa5c4", elo: 2242, rank: 16 }),
    matchElo: async () => ({ elo: 1836, change: 17 }),
    profileRefresh: async () => structuredClone(snap.profile ?? null),
  };
}

function recast(text: string) {
  const raw = JSON.parse(text) as Snap;
  const me = (raw.state.settings as { nickname?: string }).nickname?.toLowerCase();
  const others = new Set<string>();
  (function walk(o: unknown) {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "string" && /^(nickname|player_name|opponent_name|their_?name|winner_name|loser_name)$/i.test(k) && v.toLowerCase() !== me && v !== "someone") others.add(v);
      else walk(v);
    }
  })(raw);
  [...others].sort((a, b) => b.length - a.length).forEach((name, i) => {
    text = text.replace(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), i % 2 ? "Fern" : "Frieren");
  });
  return text;
}
