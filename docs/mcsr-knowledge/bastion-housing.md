# MCSR 1.16.1 Bastion Routing: Housing Units

Housing Units ("Housing") is widely considered the most consistent Bastion Remnant in Minecraft 1.16.1 RSG and MCSR Ranked due to its compact layout, guaranteed 12 rampart gold blocks, high piglin density, and accessible generic loot chests.

---

## 1. Identification & Entry Routes (Top-Down vs. Bottom)
Housing consists of a central Nether wart courtyard (`center_0/1/2`) flanked by modular housing stages and **two adjacent ramparts** (`wall_base` and `connected_wall`). Unlike Stables (`Y=72`, 3 ramparts) or Bridge (separated ramparts), Housing's triple-chest rampart sits at **`Y=73`** (player coordinates).

- **Top-Down Entry (`Topdown Housing`):**
  - **Pathing:** Enter at the top ramparts (`Y=73`), break/loot the guaranteed right **Triple Chest** to aggro upper piglins, run down the internal rampart stairs, block off chasing brutes at the drop, optionally bridge across the flat wall to mine the **middle 3 gold blocks**, and drop into the lower 9-gold trade hole.
  - **Yield & Use Case:** Yields **9–12 gold blocks** and **5–8 chests** (Difficulty: 5/10; 7/10 for *Top-Down Lava Housing* / *Elevator Timing*). Preferred when entering at high Y-levels or when the lower courtyard is flooded with lava.
- **Bottom Entry (`Manhunt Housing`):**
  - **Pathing:** Enter via the lower courtyard, locate and break/loot the **center chest** to aggro courtyard piglins, bridge across the gap toward the ramparts, funnel piglins up the base staircase, and drop into the lower 9-gold trade hole beside the double chest.
  - **Yield & Use Case:** Yields **9 gold blocks + 3 chests** in the base route (or 9–12 gold / 5–8 chests with top extensions; Difficulty: 7/10 for *Manhunt Lava Housing*). Preferred on low-Y entries.
- **Backside Entry:** Breaches directly through the rear of `wall_base` into the bottom double chest and 9-gold room, requiring manual piglin pull from the courtyard afterward.

---

## 2. Gold Block & Chest Locations
- **Gold Block Locations (12 Guaranteed in Ramparts + 3–4 Random in Units):**
  - **Main Bottom Gold Chamber (`wall_base` — "Secret" / Lower 9-Gold Room):** Contains **9 guaranteed gold blocks** embedded in the lower rampart base adjacent to the bottom double chest (1 front block + left/right side pockets excavated during trade hole setup).
  - **Middle Gold Chamber (`connected_wall`):** Contains **3 guaranteed gold blocks** embedded in the flat wall directly above the main 9-gold chamber (mined during Top-Down routing).
  - **Terminology Note (`[Uncertain: "Top Triple" / "Ribs" Gold]`):** In MCSR terminology, *top triple gold* (4 blocks under `Y=72` triple chests) and *ribs / good gap* (up to 10 lower gold blocks) strictly describe **Stables** bastions; in Housing, the top triple chests have no gold directly beneath them, and the lower 9-gold chamber + 3-gold middle wall serve as the primary gold sources (alongside 1 random gold block per `stage_0_0`, `stage_0_2`, `stage_0_3`, `stage_1_0`, `stage_1_3`, and `unit_0`).
- **Chest Locations (`bastion_other` Generic Loot — Obsidian, String, Gold/Iron, Crying Obsidian):**
  - **Top Ramparts (`Y=73`):** Right rampart **always** has a **Triple Chest** (double chest + single chest 3 blocks apart). Left rampart has a **50% (1/2) chance** of a second Triple Chest (otherwise 0 or 1 chest).
  - **Bottom Rampart Base (`wall_base`):** Guaranteed **Double Chest** right outside the 9-gold trade hole.
  - **Center Courtyard (`center_0/1/2`):** Guaranteed **Single Chest** beside the central Nether wart patch.
  - **Housing Stages:** Optional single generic chests inside `stage_0_2` and `stage_1_2` towers.

---

## 3. Piglin Aggro & Trade Hole Setup
- **Aggro Tiers & Pulling (Manhunt):** Breaking the center chest triggers Tier 1 aggro; **punching one piglin** (when entering without gold armor) upgrades nearby piglins to **Tier 2 aggro**, pulling 12–18+ piglins across the courtyard. Avoid punching too close to the ramparts so rampart brutes do not aggro early.
- **Pathfinding Funnel:** Place 2 guide blocks by the center chest so left-unit piglins path across, bridge the 8-block courtyard gap (or use safer 4-block offset/stair bridges), and block the **2 side paths at the rampart staircase** using **3 solid blocks** (safest), **1 lava source**, or **fire** so piglins funnel straight to the double-chest room.
- **Trade Hole Variants (`wall_base`):** Runners place an overhead block to block piglins from dropping on them, excavate the 9 gold blocks into a 2x2x3 pit, and switch to **Hard difficulty** so more piglins crowd into the trap:
  - **Standard1 / Safe1:** `19–20` blocks mined (`~4.80–5.85s` pre-trade); full 2x2x3 pit excavation.
  - **Once-Elevated (`Fast1` / `Fast5` / `Fast6`):** `16–18` blocks mined (`~3.00–4.35s` pre-trade); player stands 1 block higher (`Fast1`/`Fast4` are lavaproof).
  - **Twice-Elevated:** `15` blocks mined (`~2.50s` pre-trade without gold block / `4.25s` with gold block); uses a lava source to block piglin pathing into the player while burning junk barters (standard for Top-Down).
- **Double Chest Overlap:** Looting the bottom double chest is overlapped while piglins barter, or before entering the hole.

---

## 4. Exits & Benchmark Split Expectations
- **Pearl & Walk Exits:**
  - **Item Recovery & Tower Out:** Drop gravel into the trade hole (or mine into the drop corner) to push bartered items up and avoid items falling underneath, then tower out of the corner or walk out the bottom double-chest doorway.
  - **Top Chest Cleanup & Pie-Ray:** If short on obsidian (`<10` or `<20` for blind/divine) or string/fire res, **pearl up** to the `Y=73` ramparts to loot remaining triple chests. Otherwise, **pearl-hang** or walk out to an open courtyard/rampart edge to run F3 Pie-Ray (`spawner` entity check) for the Nether Fortress.
- **Benchmark Split Expectations (`[Uncertain: Ranked ELO-dependent community benchmarks]`):**
  - **Pre-Trade Hole Setup:** `~2.5s–6.15s` of mining/placement once at the `wall_base` corner (per MCSR Wiki timing tables).
  - **Total Bastion Split (Entry to Exit with Pearls + Obby):**
    - **Top/Pro Ranked (1800+ ELO / WR Pace):** `~1:05–1:25` duration (`~50s–1:00` Top-Down with fast gold/pearl RNG).
    - **Competitive Ranked (1200–1600 ELO):** `~1:30–2:00` duration.
    - **Intermediate / Safe Routing:** `~2:00–2:45` duration.

---

## Sources & References
- **MCSR Wiki (Miraheze):** [Bastion routing](https://mcsr.miraheze.org/wiki/Bastion_routing), [Manhunt Housing](https://mcsr.miraheze.org/wiki/Manhunt_Housing) (hole timings, aggro tiers, staircase/bridge setups), and [Topdown Housing](https://mcsr.miraheze.org/wiki/Topdown_Housing).
- **Minecraft Wiki:** [Bastion Remnant Structure Blueprints](https://minecraft.wiki/w/Bastion_Remnant#Housing_units) and [Tutorial: Looting a bastion remnant — Housing](https://minecraft.wiki/w/Tutorial:Looting_a_bastion_remnant#Housing).
- **Community Route Guides:** LlamaPag Bastion Practice Map (`github.com/LlamaPag/bastion`), pncakespoon / MCSR Wiki Housing Guides (2023–2026).
