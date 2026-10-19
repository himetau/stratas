# MCSR 1.16.1 Bastion Routing: Bridge

Bridge bastions consist of three distinct sections: a central bridge spanning toward a piglin-face **snout** (containing the gold "chalice") flanked by two **separated ramparts** (Left and Right when facing the snout from the back of the bridge). Unlike Housing, Stables, or Treasure, Bridge ramparts are not connected to each other directly. In Minecraft 1.16.1, Piglin Brutes do not exist, making Bridge the fastest and most consistent bastion archetype due to exposed gold and dense piglin spawns.

## 1. Structure & Identification
- **Separated Ramparts:** Two outer towers flank the central bridge deck with a wide gap between them.
- **Snout & Lava Basin:** The front of the bridge forms a giant piglin snout overhanging a lava pool/basin, with nostrils leading up to the central spine.
- **Rampart Variants:** Each rampart independently rolls either **1 chest (Single)** or **3 chests (Triple — a double chest plus an adjacent single chest)**. Triple-chest rampart tops sit at player `Y=73` (MCSR Wiki).

## 2. Snout Gold Blocks (12+ Blocks)
- **Snout / Chalice Gold:** The front snout and central chalice structure contain **12 to 19 gold blocks** (exact count varies with structure decay/random block replacement; *[uncertain: some community sheets cite 12–18 vs. 12–19 depending on whether lower nose/ear blocks are included]*).
- **Mining Options:**
  - **Pickaxe Route:** Mine the snout/chalice gold blocks directly while walling off the outer ledge to prevent gold or the player from falling into the lava basin below.
  - **TNT / Chalice Route:** If the player enters with TNT (or crafts it from sand/gunpowder), a single TNT placed in the chalice mines most of the central gold cluster simultaneously while aggroing nearby piglins.

## 3. Lodestone & Upper Rampart Chests
- **Lodestone Chest:** Located in the central upper archway directly above the bridge spine (`Y≈78–83` depending on generation height). It uses the `bastion_bridge` / `bastion_other` loot tables with a guaranteed Lodestone chest slot yielding high-value **crying obsidian, obsidian, iron/gold ingots, and spectral arrows**.
- **Upper Rampart Double/Triple Chests:**
  - **Right Triple / Left Triple:** When a rampart rolls the 3-chest variant (`Y=73`), the double chest + single chest provide enough obsidian, string, iron, or gold to skip mining parts of the snout or finish portal/explosive requirements immediately.
  - **Double Single:** When both ramparts only have 1 chest, runners rely heavily on the snout gold blocks (12+ blocks → 108+ ingots) plus the central lodestone chest.

## 4. Piglin Aggro & Central Trade Hole
- **Line-of-Sight Aggro:** Breaking a gold block or opening a chest angers piglins within detection range (16 blocks, requiring line-of-sight or block-break awareness). Runners intentionally break an exposed gold block or open the lodestone/rampart chest while visible to upper-rampart piglins.
- **Pulling into a Central Trade Hole:**
  - **Right Triple ("High Hole"):** Mine snout gold, climb the right nostril/staircase toward the lodestone chest and right rampart, pull the rampart + bridge piglins together, and trap them in a 2-deep hole near the upper-right bridge junction.
  - **Left Triple ("Gus Route" / Left Hole):** Mine snout gold, path up the left staircase to pull left-rampart and lodestone piglins into a prepared 1x1/2x1 trade hole along the left bridge corridor.
  - **Manhunt / Lower Bridge Hole:** Dig a 2-deep pit directly in the central bridge floor behind the snout, pull the bridge-deck piglins in, and pillar/roof over yourself while batch-dropping gold ingots.
- **Batch Bartering:** Drop stacks of gold ingots directly onto the trapped piglin cluster while looting nearby rampart/lodestone chests so bartering runs in parallel with chest looting.

## 5. Hoglin Knockback Hazards
- **Spawn Zones:** Hoglins spawn on the wide flat bridge deck, the snout ledges, and occasionally upper rampart platforms.
- **Lethal Knockback Risk:** Hoglin attacks deal high horizontal and vertical knockback that easily launches unarmored runners off the narrow snout or unrailed bridge into lava or into the piglin trade pit.
- **Mitigation:**
  - Place **2-high block pillars or walls** around yourself while mining the snout gold blocks and next to the trade hole.
  - Place **warped fungus** (if collected in a Warped Forest) or a quick **lava tick** to repel/kill charging hoglins.
  - Path along the 1-block-wide raised walls or interior nostril stairs where wide hoglin hitboxes (1.3965 × 1.4 blocks) cannot pathfind through 1-block gaps.

## 6. Inventory Check & Exit Routes
- **Exit Thresholds:** Confirm at least **10–20 obsidian** (for nether portal + blind/calculated travel), **ender pearls** (typically 12+ for travel + eye crafting, or 3+ if boat/strider travel is planned), **fire resistance** (1+ potion), and **explosives** (string/wool for beds or glowstone/crying obsidian for anchors).
- **Exit Execution:**
  - **Rampart / High Exit:** Build a nether portal or pearl directly out from the top of the rampart (`Y=73+`) when continuing along high Nether terrain or ceiling/tunnel travel.
  - **Lower / Lava Ocean Exit:** Drop or pearl down from the snout/bridge overhang to the `Y=32` lava ocean for strider or boat/pearl travel toward the fortress.

## Sources & References
- **MCSR Wiki (`mcsr.miraheze.org/wiki/Bastion_routing`):** Rampart identification (`Y=73` triple chests, separated ramparts), Right Triple (High Hole), Left Triple (Gus route / pncake), Double Single, Manhunt routes, and Crossroads TNT chalice.
- **LlamaPag Bastion Practice Map (`github.com/LlamaPag/bastion`):** Standard 1.16.1 bastion structure presets and route benchmarks.
- **Minecraft Wiki (`minecraft.wiki/w/Bastion_Remnant`):** Structure piece generation, `bastion_bridge` / `bastion_other` chest loot tables, and piglin/hoglin mechanics.
- **MCSR Ranked / Community Guides (k4yfour, Couriway, pncake):** 1.16.1 snout gold counts, hoglin block-off habits, and parallel chest/trade routing.
