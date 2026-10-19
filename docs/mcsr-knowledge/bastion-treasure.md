# MCSR 1.16.1 Bastion Routing: Treasure Bastion

Treasure is the largest and most vertically tall bastion remnant in Minecraft 1.16.1 (which lacks Piglin Brutes, added in 1.16.2). It consists of twin connected **upper ramparts**, a central **lava bridge**, and a massive rear **treasure cube** enclosing a deep lava moat and bottom treasure room.

---

## 1. Structure & Identification: Ramparts vs. Bottom Treasure Room
- **Upper Ramparts:** Two adjacent front towers connected by a central bridge (which always spawns **2 exposed gold blocks**). Unlike other bastions, each Treasure rampart **always generates a double chest (2 chests per rampart)** at the top, plus wall-embedded gold blocks (70% spawn chance per slot) along the staircases and upper ledges.
- **Central Lava Bridge & Racks:** Beneath the upper bridge lies a secondary bridge with flowing lava and multi-tiered perimeter walkways ("racks") overlooking the central courtyard and treasure cube.
- **Bottom Treasure Room:** Located at the base of the giant rear blackstone cube (`~Y=33–38`), surrounded by a lava pool/moat:
  - **Magma Cube Spawner:** Suspended directly above the center of the bottom room. It triggers an unmistakable **F3 entity pie-chart `mobSpawner` spike** from afar and must be broken immediately on bottom routes to prevent magma cube knockback into lava.
  - **Center Gold Pile (~16 Gold Blocks):** The central monument inside the lava basin holds a massive cluster of exposed gold blocks—commonly referenced as **16 gold blocks** (specifically **16** in the "cage" layout, or **12 / 13 / 19** in the double-chest, `1912`, and "hashtag" center variants)—alongside 1–2 high-tier treasure chests.

---

## 2. Core Routes & Rack Piglin Management
Runners choose between upper rampart routes or bottom treasure routes based on entry elevation (`Y`-level) and piglin count (`E`-counter):

- **Upper Rampart Routes (`Right Boomer`, `Ninjabrain`, `Top Treasure`):**
  - **Execution:** Enter via the ramparts or bridge, loot the guaranteed top double chests, and mine the bridge/staircase wall gold blocks (typically yielding `6–10` blocks, or `54–90` ingots).
  - **Rack Piglins:** Because upper ramparts often have fewer pre-grouped piglins than Stables or Housing, runners aggro and pull **"rack piglins"**—piglins stationed along the multi-level rampart ledges, staircases, and inner treasure racks—into a 2-block-deep staircase hole or corner trap. Breaking pathing blocks on the basalt stairs or using gravity blocks (sand/gravel) funnels rack piglins into a single bartering pit.
- **Bottom Treasure Route (`Lower Treasure`):**
  - **Execution:** Enter near the base of the rear cube, bridge across the lava pool, break the **magma cube spawner** first, and mine the **12–19 (typically 16) center gold blocks**.
  - **Bartering:** Players build a small safety box or L-shaped wall hole near the bottom perimeter, aggroing floor and lower-rack piglins to barter the massive gold surplus while staying shielded from lava and stray magma cubes.

---

## 3. Chest Routing
- **Rampart Double Chests:** Both left and right upper ramparts guarantee **2 chests each**. Runners almost always check at least one rampart double chest during upper routes to secure **obsidian, crying obsidian, iron nuggets, string, or fire charges**, reducing reliance on bartered obsidian.
- **Middle & Bottom Cube Chests:** The middle treasure racks (`0–3` chests) and bottom floor (`1–4` perimeter chests + `1–2` center chests) roll the `bastion_treasure` loot table, offering high-roll **obsidian, diamond gear/pickaxes, enchanted golden apples, and gold/iron blocks**. If an upper route under-rolls obsidian, runners drop to check a lower/middle wall chest.

---

## 4. Why Pearl Exits Span Large Vertical & Horizontal Distances
Replay data from Treasure Bastions exhibits unusually large **horizontal (`40–80+` blocks)** and **vertical (`30–50+` blocks)** pearl displacements upon exit:
1. **Extreme Verticality (`ΔY ≈ 35–50` blocks):** The bottom treasure room sits near Nether lava level (`Y≈33`), whereas the upper rampart roofs and surrounding Nether terrain frequently sit at `Y≈75–85+`. Exiting from `Lower Treasure` to high terrain—or dropping from `Top Treasure` down to low blind-travel portals—requires steep upward/downward pearl arcs.
2. **Cube & Lava Moat Geometry:** The rear treasure room is a massive hollow cube (`~30×30` footprint) surrounded by open lava moats and tall flat walls. Rather than pillar-climbing or bridging out, runners throw **long-distance escape pearls** straight through upper cube windows, across the central lava basin, or off the high rampart battlements directly toward open Nether wastes/warped forests for blind travel or fortress navigation.

---

## 5. Benchmark Splits (Bastion Entry to Exit)
*Note: Exact split benchmarks vary by seed inventory, route variant, and MCSR Ranked ELO bracket [uncertain: community coaching benchmarks rather than official wiki constants].*

| Skill / ELO Tier | Typical Split (Entry → Exit) | Key Execution Markers |
| :--- | :--- | :--- |
| **Top / Pro (`2000+` ELO)** | **`1:05 – 1:30`** | Instant rampart/cube ID, clean rack piglin pull (`12+` pigs), overlapped chest looting + bartering, 1-pearl roof/window exit. |
| **Advanced (`1500 – 1900` ELO)** | **`1:30 – 2:05`** | Solid `Right Boomer` / `Lower Treasure` execution; minor delays waiting on smaller piglin groups (`6–9` pigs) or bridging over lava. |
| **Intermediate (`<1500` ELO)** | **`2:05 – 3:00+`** | Slower stair navigation, scattered rack piglins requiring multiple barter spots, or cautious spawner/magma clearing at bottom. |

---

## Sources & References
- **MCSR Wiki (`mcsr.miraheze.org/wiki/Bastion_routing`):** Bastion rampart identification (Treasure always having 2 chests per rampart) and standard route taxonomy (`Right Boomer`, `Ninjabrain`, `Lower Treasure`, `Top Treasure`).
- **MCSR Community Guides (Ninjabrain, Couriway, LlamaPag Bastion Practice Map & Block Generation Spreadsheet):** 70% wall gold generation rules, center treasure gold configurations (`12 / 13 / 16 / 19` blocks), and rack piglin pathing/staircase traps.
- **Minecraft Wiki (`minecraft.wiki/w/Bastion_Remnant`):** `bastion_treasure` vs. `bastion_other` chest loot tables and magma cube spawner mechanics.
