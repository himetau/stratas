// Ranked tiers, same as PlayerTier in the mod (MCSR Ranked 6.0.3)
const TIERS: [string, string, number][] = [
  ["coal_1", "Coal I", 0], ["coal_2", "Coal II", 400], ["coal_3", "Coal III", 500],
  ["iron_1", "Iron I", 600], ["iron_2", "Iron II", 700], ["iron_3", "Iron III", 800],
  ["gold_1", "Gold I", 900], ["gold_2", "Gold II", 1000], ["gold_3", "Gold III", 1100],
  ["emerald_1", "Emerald I", 1200], ["emerald_2", "Emerald II", 1300], ["emerald_3", "Emerald III", 1400],
  ["diamond_1", "Diamond I", 1500], ["diamond_2", "Diamond II", 1650], ["diamond_3", "Diamond III", 1800],
  ["netherite", "Netherite", 2000],
];

export function rankOf(elo: number | null | undefined): { key: string; name: string } {
  if (elo === null || elo === undefined) return { key: "unrated", name: "Unrated" };
  let t = TIERS[0];
  for (const x of TIERS) if (elo >= x[2]) t = x;
  return { key: t[0], name: t[1] };
}

