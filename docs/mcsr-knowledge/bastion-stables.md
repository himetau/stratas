# Stables Bastion Routing (Minecraft 1.16.1 MCSR)

In Minecraft 1.16.1 RSG and MCSR Ranked (Piglin Brutes absent prior to 1.16.2; * note: MCSR Ranked disables terrain/netherrack intrusion inside bastions), **Hoglin Stables ("Stables")** is the most modular and RNG-dependent bastion remnant. It consists of **3 upper ramparts** (Left, Middle, Right) and **2 lower stable wings** ("gaps" on the Left and Right).

---

## 1. Upper Ramparts, Triple Chests, & Gold Blocks
Unlike Bridge, Housing, and Treasure (which generate 2 ramparts), Stables always generates **3 adjacent upper ramparts** (`ramparts_1`, `ramparts_2`, `ramparts_3`). Each slot independently rolls one of three upper templates:
- **Triple Chest (`ramparts_1`):** Contains **3 `generic` loot chests** (1 double + 1 single separated by 4 blocks, player level `Y=72` vs `Y=73` in Bridge/Housing) and **4 guaranteed Gold Blocks** hidden in the lower room directly beneath the chests.
- **Double / Lantern (`ramparts_2`):** Contains **2 `generic` chests** (1 upper, 1 in the lower staircase room) and **0 Gold Blocks**.
- **Single / Diagonal (`ramparts_3`):** Contains **1 `generic` chest** and **0 Gold Blocks** (features a misleading piglin-snout wall with no gold behind it).
- **Routing Configurations:** Stables can roll anywhere from **0 to 3 Triple Chests** ("Single Triple", "Double Triple", "Triple Triple", or "No Triple"). Each Triple Chest rampart provides 4 gold blocks (up to **12 gold blocks** from upper ramparts alone).

---

## 2. Good Gap vs. Bad Gap (Lower Stable Wings)
The two lower stable sides (Left and Right) connect below the ramparts and roll either a **Good Gap** or a **Bad Gap**, supplemented by modular inner/outer large and small stable stalls:
- **Good Gap:** Identified from the rampart staircase by mining the top-right check block (air/open corridor behind it) or spotting the recessed two-layered lower room. Contains **up to 4 Gold Blocks** in the back wall cavity plus **up to 6 additional exposed/semi-hidden Gold Blocks** across adjacent stable stalls (`small_stables`/`large_stables`, where individual gold blocks generate at a 50% structure-processor roll `[uncertain: exact average yield typically ~4–7 gold blocks per good gap]`), alongside 1–2 chests.
- **Bad Gap:** Solid blackstone wall at the staircase check spot and lacks the lower gold room. Contains **0 Gold Blocks** in the main gap connector and only a single chest (though outer/inner stable stalls can still roll isolated 50% gold blocks and `hoglin_stable` chests).
- **Core Routes:**
  - **Triple-to-Gap / Good Gap Only:** Loot the Triple Chest + 4 under-chest gold blocks, drop into the Good Gap to mine its gold blocks, and barter in the gap pit.
  - **Double/Triple-Triple:** Chain across upper ramparts (`Y=72`) to harvest 8–12 gold blocks and 6–9 chests without relying on lower gaps.
  - **Hourglass Route (Left Triple → Left Bad Gap → Right Good Gap):** Used when a left triple sits over a left bad gap, crossing through the center to finish in the right good gap.

---

## 3. Piglin Density, Stuck Spots, & Hoglin Hazards
- **Piglin Density:** Stables has lower natural piglin concentration than Housing or Bridge. A Triple Chest rampart spawns ~8 piglins (`6+2` structure mob markers), while Double (`2+1`) and Single (`1+1`) ramparts are sparse. Most bartering relies on pulling upper-rampart piglins down via chest/gold-block aggro (16-block radius) and merging them with lower stable piglins (`1–2` per inner/outer stall).
- **Stuck Piglin Spots (Blocks & Slabs):** Because Stables pieces (`inner_0..4`, `outer_0..4`) are heavily weathered with **Blackstone Slabs, Stairs, Blackstone Walls, and Basalt pillars**, piglins frequently get stuck on half-slab ledges, stair corners, or behind 1-block wall posts when pathfinding toward thrown gold. Runners must break overhanging slabs/walls or throw backup ingots onto upper ledges so stuck piglins contribute to trades `[uncertain: exact count of stuck piglins varies by inner/outer stall roll, typically 2–5 per wing]`.
- **Hoglin Hazards:** Both `large_stables` and `small_stables` pieces spawn persistent **Hoglins** in the lower stalls and courtyard. Hoglins deal high knockback (launching players into lava bits or off broken ramparts) and cannot be distracted by gold. Keep a 2-block pillar, door, or 1x2 wall buffer while mining lower stall gold and collecting barter drops.

---

## 4. Chest Expectations (Obsidian & String) & Exit Routes
- **Chest Loot Distinction (`generic` vs. `hoglin_stable`):**
  - **Upper Rampart Chests (`bastion_other` / `generic`):** Roll general bastion loot—good for **Obsidian** (`4–6` per roll), **String** (`4–16` for bed crafting), Gold/Iron ingots, and spectral arrows, though diluted by chains/bone blocks.
  - **Lower Stable Chests (`bastion_hoglin_stable`):** Located in `large_stables/inner` pieces; pull from a dedicated pool with **Crying Obsidian** (`1–5`), **String** (`3–8`), **Gold Ingots**, Cooked Porkchops, Saddles, and Soul Speed books, plus a high-tier pool (Diamond Shovel/Pickaxe, Ancient Debris, Golden Apples), **but 0 regular Obsidian** in the `hoglin_stable` table itself.
  - **Expectation:** Always prioritize **Triple Chests** (and Double/Single rampart chests) when short on **regular Obsidian** for portal exit, while using lower `hoglin_stable` chests for supplemental **String**, gold, food, and diamond picks.
- **Exit Routes:**
  1. **Lower Gap / Courtyard Exit:** After bartering in the Good Gap pit, pearl out to the open side/front of the stable stalls away from hoglins to build or pearl toward the blind/calculated travel coordinates.
  2. **Upper Rampart Roof (`Y=72+`):** In Double/Triple-Triple routes where piglins are trapped and traded on the mid-deck, pillar or pearl onto the top rampart roof for unobstructed line-of-sight pearling into open Nether terrain.

---

## Sources & References
- **MCSR Wiki (`mcsr.miraheze.org/wiki/Bastion_routing`):** Stables 3-rampart identification, `Y=72` triple chest height, and `1/2/3` chest rampart counts.
- **Minecraft Wiki (`minecraft.wiki/w/Bastion_Remnant/Structure`):** Blueprints for `hoglin_stable/ramparts_1..3`, `large_stables`, `small_stables`, and `bastion_hoglin_stable` vs. `bastion_other` loot tables.
- **MCSR Ranked & Community Routing Guides (Meebie, HiTrippy, Silverr, Rowl, Chloe/Pavkin):** Good/Bad Gap identification checks, Hourglass routing, and slab/stall piglin pathfinding manipulation in 1.16.1.
