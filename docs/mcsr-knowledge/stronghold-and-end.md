# Stronghold Navigation & End Fight (MCSR 1.16.1)

In MCSR Ranked (Minecraft 1.16.1 RSG), the endgame transitions from Blind/Calculated Travel into Stronghold navigation and the Ender Dragon fight. Both phases have dedicated timeline events and `.rpd` packet records (`80–91`, `21`, `84`, `100`) in MCSR Ranked replay files.

---

## 1. Stronghold Navigation

- **Starter Staircase (`Chunk 4, 4`):**
  - Stronghold generation always begins with the **starter spiral staircase** centered at chunk-relative coordinates **`X=4, Z=4`**.
  - Eye of Ender throws (and triangulation tools like Ninjabrain Bot) lock onto `(4, ~, 4)` of the starter chunk. Runners dig straight down at `4, 4` (or dive into exposed ocean strongholds) to enter the top of the staircase and descend to the bottom doorway.
- **5-Way Crossing & Room Routing:**
  - The bottom of the starter staircase almost always opens into a **5-Way Crossing** with five exits: lower-left, lower-right, upper-left, upper-right, and straight ahead (up steps).
  - Because the Portal Room normally generates at a piece depth of `5–7` rooms from the starter staircase, runners prioritize rooms that branch deeper (libraries, stone brick corridors, prison halls) and skip dead-end branches early.
- **Portal Room Pie Chart (`PIE_CHART`, id `21`):**
  - The Portal Room is uniquely identifiable by its **Silverfish `mob_spawner`** block entity (the only spawner in a vanilla stronghold unless a dungeon intersects).
  - Runners open the F3+Shift profiler path `root.gameRenderer.level.entities` (`blockEntities`) and lower render distance (`F3+F`), stepping chunk-by-chunk or raising render distance until **`minecraft:mob_spawner`** spikes in the pie chart (recorded in `.rpd` as `PIE_CHART` id `21` using `data/pie-names.json` indices alongside `chest`). Audio subtitles (`Silverfish hisses`, `Lava pops`) confirm final room direction.
- **Spawnpoint Bed / Respawn Anchor Setting:**
  - When holding spare beds or a charged **Respawn Anchor** (`BLOCK_UPDATE` id `25/30`), runners may set their spawnpoint in the Nether (anchor) or Overworld stronghold (bed) when routing death-warps, resetting hunger/health before portal entry, or securing recovery against End void/explosion deaths.

---

## 2. The End Fight

Entering the End (`projectelo.timeline.the_end`, `world = 2`) spawns the player on the **obsidian platform at `(100, 49, 0)`**.

- **Obsidian Platform → Pillar / Fountain Routing:**
  - Runners immediately bridge, pearl (`PROJECTILE` id `63`), or tower from `(100, 49, 0)` onto the main island.
  - For a standard **One-Cycle**, the runner routes directly to the center bedrock **fountain `(0, y, 0)`**, places the bed-setup obsidian/end stone block against the central pillar, and prepares bow/explosives. For a **Zero-Cycle**, the runner pearls directly up a target obsidian pillar.
- **Crystal Bow Shots (`CRYSTAL_DESTROY`, id `84`):**
  - While waiting at the fountain (or setting up a zero-cycle), runners shoot uncaged End Crystals with a bow/crossbow or snowball (`PROJECTILE` id `63` → `CRYSTAL_DESTROY` id `84`).
  - Destroying crystals prevents dragon regeneration (`DRAGON_HEALTH` id `83`) and removes crystal-linked pathfinding nodes, increasing immediate perch probability or clearing the target pillar for a zero-cycle.
- **Dragon Perch Prediction (`DRAGON_PHASE` id `82`, `DRAGON_TARGET` id `90`):**
  - Vanilla 1.16.1 dragon AI states are logged via `DRAGON_PHASE` (`u8`): `0 = HOLDING_PATTERN` (circling), `1 = STRAFING` (fireball), **`2 = LANDING_APPROACH`** (perch initiated), **`3 = LANDING`** (descending on fountain), `4 = TAKEOFF`, `5–7 = SITTING_*`, `8 = CHARGING_PLAYER`, `9 = DYING`.
  - Pathfinding nodes (`DRAGON_NODES` id `87`, `DRAGON_PATH` id `91`) and target coordinates (`DRAGON_TARGET` id `90`, `3 × f32`) reveal the exact tick the dragon transitions from circling (`0`) to `LANDING_APPROACH` (`2`) targeting `(0, y, 0)` and determine which cardinal direction the dragon's head will face on the fountain.
- **One-Cycle Bed Timing & Damage (`DRAGON_DAMAGE` id `89`, `EXPLOSION` id `100`):**
  - As the dragon transitions from `LANDING_APPROACH` (`2`) into `LANDING` (`3`), runners place beds on top of the fountain center and detonate them (`EXPLOSION` id `100`, `power = 5.0`) beside a blast-shield block.
  - In 1.16.1, the dragon's **head hitbox** takes `4×` explosion damage (`200 HP` total; damage ticks logged via `DRAGON_DAMAGE` id `89` `[u8, i16]` and `DRAGON_HEALTH` id `83`).
  - Timed bed pops every `~14–20 ticks` knock the dragon's head upward, locking it in place so `4–7` beds (or beds + respawn anchors) deal all `200 HP` before takeoff (`DRAGON_DEATH` id `85`).
- **Zero-Cycle Setups (`DRAGON_ZERO` id `88`):**
  - Instead of waiting for a fountain perch, runners pearl to the top of the specific obsidian pillar intersecting the dragon's initial spawn flight path (front/back node rotation, height `c76–t103`).
  - After breaking the pillar crystal, the runner places a standing block + blast shield and chains `4–5` bed/anchor explosions (`DRAGON_ZERO` id `88`) as the dragon flies over the pillar, killing it in `<15–25s` of End entry.

---

## Sources & References
- **MCSR Ranked Client (`com.mcsrranked.client.anticheat.replay.format.*`, v6.0.1–6.0.3):** `TimeLineType` records `PIE_CHART` (`21`), `DRAGON_MOVE` (`80/81`), `DRAGON_PHASE` (`82`), `DRAGON_HEALTH` (`83`), `CRYSTAL_DESTROY` (`84`), `DRAGON_DEATH` (`85`), `DRAGON_NODES` (`87`), `DRAGON_ZERO` (`88`), `DRAGON_DAMAGE` (`89`), `DRAGON_TARGET` (`90`), and `DRAGON_PATH` (`91`).
- **Minecraft Speedrunning Community (MSRC / Ninjabrain Bot / Emma End Practice):** Chunk `4, 4` starter staircase triangulation, 5-way crossing depth heuristics, F3+Shift `mob_spawner` pie-chart scanning, and 1.16.1 One-Cycle / Zero-Cycle bed timing mechanics.
- **Minecraft 1.16.1 Decompiled Source (`EnderDragonEntity`, `PhaseType`):** Dragon phase state machine (`0–10`), node graph pathfinding, and `4×` head-part explosion damage calculation.
