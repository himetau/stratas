# MCSR Ranked Specific Mechanics & RNG Standardization

MCSR Ranked modifies vanilla Minecraft 1.16.1 random number generation (RNG), world filtering, and lobby configuration to ensure competitive parity in head-to-head races while preserving core speedrunning mechanics like chunk-unloading pearl hangs.

---

## 1. Standardized RNG & Filtered Seed Mechanics
By default, MCSR Ranked ties deterministic random sequences to an **RNG Seed** (matching the Overworld seed unless overridden) and generates the Overworld and Nether from independent filtered seeds (preventing cross-dimension seed inference such as Divine Travel).

- **Piglin Barter Sequence:** All runners receive the exact same barter loot sequence in the same order. Obsidian weight is buffed by ~35%, and every 72 barters (8 gold blocks) guarantees at least **6 Obsidian** and exactly **3 Ender Pearl** trades.
- **Blaze Rods & Mob/Block Drops:** Blaze rod drop sequences, blaze spawner timings/positions (4 standardized spawn coordinates per cycle), Enderman pearl drops, animal/Hoglin food drops, and block drops (flint, sticks, gilded blackstone, glowstone) are identical across players. Iron Golems are forced to always drop **4 Iron Ingots**.
- **Eye of Ender Breaks:** Eye throw shatter sequences are standardized per seed, and the **2nd Eye of Ender throw is guaranteed never to break** (enabling reliable 2-eye triangulations).
- **Ender Dragon Perch & Behavior:** Dragon phase direction changes, target block height offsets (`0–15` blocks for zero-cycles vs. `0–20` in vanilla), strafe rolls, and perch rolls are standardized. Furthermore, the dragon is forced to perch if the cumulative probability of not yet having rolled a perch drops below `0.1` (10%).
- **Portal Standardization:** Initial Nether entry coordinates are standardized by spawn location (treated as Overworld `Y=64`), and the first blind return portal built at Nether `Y >= 48` is guaranteed to spawn on the Overworld surface rather than in a cave.
- **Overworld & Bastion Seed Types:**
  - **Overworld Brackets:** Filtered into five archetypes—**Village**, **Shipwreck**, **Desert Temple**, **Ruined Portal**, and **Buried Treasure** (distributed equally at `20%` each at `1200+` Elo and in Private Rooms, with guaranteed iron/food/lava or magma ravines).
  - **Nether & Bastion Filtering:** The intended Bastion Remnant (**Housing**, **Stables**, **Bridge**, or **Treasure**) generates within 14 chunks of `(0, 0)` (at least 10 chunks closer than any other bastion), guarantees `3+` Iron and `5+` Obsidian in rampart/lodestone chests, and has open terrain to a Nether Fortress within 16 chunks. Non-structure monsters cannot spawn inside Bastions, and Ghasts cannot spawn within 5 chunks of the player.

---

## 2. Pearl Hangs (Delayed Chunk-Unload Teleportation)
A **pearl hang** (or stasis pearl) exploits Minecraft's entity-ticking chunk rules to delay an Ender Pearl's landing while the runner performs other tasks.

- **Chunk Unloading Mechanic:** When an Ender Pearl is thrown into or across chunks that stop ticking—either because the pearl travels beyond the player's current **Render Distance (RD)** or the player immediately lowers their RD / moves away (e.g., entering a structure, digging down, or entering a portal)—the projectile freezes mid-air in an unloaded/non-entity-ticking chunk.
- **Delayed Activation:** The pearl remains suspended without losing velocity until those chunks are reloaded into entity-ticking range (by raising RD back up or walking toward the trajectory).
- **Competitive Applications:**
  - **Bastion / Fortress Routing:** Throwing a long pearl toward a Fortress or exit portal before dropping down to finish looting chests or bartering gold, then raising RD to instantly warp across the terrain.
  - **Overworld / Stronghold Travel:** Hanging a pearl toward a lava pool, ocean ravine, or stronghold room while crafting or breaking blocks, saving several seconds of sprint-jumping.

---

## 3. Private Room Settings for Set-Seed Practice
Private Rooms allow solo or multiplayer practice with customizable seed generation, RNG overrides, and match rules:

- **Seed & Archetype Selection:**
  - **Set Seed & RNG Seed:** Host players (any tier) can input a specific Overworld/Nether **Set Seed** and optionally specify a separate **RNG Seed** to test different barter/blaze sequences on the same terrain.
  - **Seed & Bastion Filtering:** Leaving the seed blank with **Use Filtered Seed (`ON`)** pulls from the 1200+ Elo pool. With the Stone Pickaxe supporter tier or higher, hosts can create Solo rooms and filter specifically by **Overworld Seed Type** and **Bastion Type** (Housing, Stables, Bridge, Treasure).
- **Key Practice Game Rules (`Options > Rules`):**
  - **Standardization Toggles:** **Modified Piglin Barters**, **Modified Portal Behaviors**, **Standardized Dragon Perch**, and **Generate Artificial Lava Pools** default to `ON` (matching Ranked ladder play) and can be toggled `OFF` to simulate vanilla behavior.
  - **Endgame & Drill Toggles:** **Dragon Perch Immediately** (`OFF` by default) forces instant perching for One-Cycle/Zero-Cycle practice; **Beginner Mode** enables keep-inventory and split-based respawn points; **Allow Use Cheat Commands** (`OFF` by default) enables `/give` or `/tp` for routing drills; and **Run Command on World Join** automates starter kits or tick-warps on reset.
  - **No-Calc & HUD Restrictions:** **Disable Copy Location** disables `F3+C` / `F3+I` clipboard coordinates for no-calculator triangulations, while **IGT Mode** switches victory timing from RTA to In-Game Time.

---

## Sources & References
- **MCSR Ranked Wiki — RNG Standardization:** [wiki.mcsrranked.com/gameplay/rng](https://wiki.mcsrranked.com/gameplay/rng) (Piglin barter guarantees, mob/block drop sequences, 2nd-eye protection, blind portal `Y >= 48` surface rule, and dragon perch probability threshold).
- **MCSR Ranked Wiki — Filtered Seeds:** [wiki.mcsrranked.com/gameplay/seed](https://wiki.mcsrranked.com/gameplay/seed) (Elo seed-type distribution, Overworld archetype guarantees, and Bastion/Fortress distance and loot filters).
- **MCSR Ranked Wiki — Private Rooms:** [wiki.mcsrranked.com/gameplay/private_rooms](https://wiki.mcsrranked.com/gameplay/private_rooms) (Set-seed configuration, supporter tier filters, and custom room game rules).
- **Minecraft Java Edition 1.16.1 Entity Chunk Processing:** Chunk ticket levels (`entity-ticking` vs. `border`/`lazy` chunks) governing Ender Pearl projectile suspension via Render Distance manipulation.
