// Browser-only mock of the Electron bridge, fed by snapshot.json (npm run snapshot)
// Only loads when window.stratas is missing, so never in Electron
type Snap = {
  state: Record<string, unknown> & { queue: { match_id: number; status: string }[] };
  races: Record<string, unknown>;
  profile?: unknown;
  matchDetails?: Record<string, unknown>;
};

export async function installMock() {
  const snap = (await import("./snapshot.json")).default as unknown as Snap;
  const listeners: ((s: unknown) => void)[] = [];
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
    skin: async (who: { uuid?: string | null; name?: string | null }) => {
      const r = await fetch(`/__dev/skin?uuid=${encodeURIComponent(who.uuid ?? "")}&name=${encodeURIComponent(who.name ?? "")}`);
      if (!r.ok) return null;
      const b = await r.blob();
      return await new Promise<string>((ok) => { const f = new FileReader(); f.onload = () => ok(String(f.result)); f.readAsDataURL(b); });
    },
    onNewGame: () => {},
    profile: async () => structuredClone(snap.profile ?? null),
    profileMatch: async (id: number) => structuredClone(snap.matchDetails?.[id] ?? null),
    profileRefresh: async () => structuredClone(snap.profile ?? null),
  };
}
