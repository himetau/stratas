# MCSR 1.16.1 Fortress & Blaze Strategies

In Minecraft 1.16.1 RSG and MCSR Ranked, the Fortress split centers on rapidly locating a blaze spawner, maximizing spawn spaces per cycle, executing clean two-hit axe kills, and managing rod counts for Stronghold blind travel.

---

## 1. E-Counter & Pie Chart Spawner Locating (Pie-Ray)
- **Debug Profiler (`Shift+F3`):** Navigate to `root.gameRenderer.level.entities`. A Blaze spawner registers under `blockEntities` (`mob_spawner`). Lowering **Entity Distance to 50%** shrinks the `entities` slice so `blockEntities` spikes stand out clearly (requires Sodium's *Entity Culling* **OFF**).
- **Chunk-Border Piedar:** When `mob_spawner` appears on the pie chart, drop Render Distance (RD) until it unloads, then step across chunk borders (`F3+G`) or increment RD by 1 to find the exact chunk distance and cardinal axis. Pan the camera frustum to pinpoint the direction where the `blockEntities` slice expands.
- **E-Counter & Corridor Routing:** Monitor `E:` (rendered/total entities) and `M:` (Monster mob cap, max 70) on F3 to spot fortress mob clusters through terrain. Inside enclosed hallways, go **down/straight at Nether Wart stairs** and **up all other stairs** to reach the single-lava-block room leading to exterior bridge intersections where spawners generate.
- **Spawnerless / Stray Blazes:** Dropping RD to **2–5 chunks** unloads distant Nether mobs, keeping `M < 70` and forcing natural fortress blazes to spawn on nearby bridges to supplement or replace spawner waves.

---

## 2. Spawner Box, Roof & Wither-Skeleton Blocking
- **Activation & Spawn Volume:** Spawners activate when the player is within **16 blocks** (spherical radius) and attempt up to 4 spawns every **10–39.95s** (`200–799` ticks) inside a **9×3×9** box (`±4` X/Z, `-1` to `+1` Y from the spawner).
- **Box & Roof Control:** On open spawners, build side walls and an overhead roof to prevent aggroed blazes from floating out of melee reach and to keep knockback on the platform. On enclosed spawners, seal side exits and establish a **2–3 block LOS retreat corner** within the 16-block radius to dodge fireball volleys safely.
- **Wither Skeleton Blocking:** Wither skeletons are **2.4 blocks tall** (`0.7` wide) and inflict lethal Wither + high melee damage. Placing a **2-block-high lintel/roof** (a block at `Y+2` above the floor) across bridge choke points and stairwell entrances completely blocks Wither Skeletons while allowing the player (`1.8` blocks) and blazes to pass.

---

## 3. Axe vs. Sword Crits & Damage Breakpoints
- **Blaze Health:** Blazes have **20 HP (10 hearts)**.
- **Axe Efficiency (2-Hit Kill):** Stone, Iron, and Diamond axes all deal **9 base damage** (`13.5` crit), while Wood/Gold axes deal **7 base damage** (`10.5` crit).
  - **Stone / Iron / Diamond Axe:** Kills in **1 crit + 1 normal full-charge hit** (`13.5 + 9 = 22.5 ≥ 20`) or **2 crits** (`27`).
  - **Wood / Gold Axe:** Kills in **2 crits** (`10.5 × 2 = 21 ≥ 20`).
  - Despite slower recharge (`0.8–1.0` attacks/s), axes save crafting time and iron compared to swords while guaranteeing a 2-swing kill.
- **Sword & Backup Tools:** Stone (`5` base / `7.5` crit) and Iron (`6` base / `9` crit) swords require **3 hits** (`18 < 20` on 2 crits). Only a **Diamond/Netherite sword** (`7`/`8` base, `10.5`/`12` crit) achieves a 2-crit kill at `1.6` attacks/s with sweep damage. If an axe breaks, an **Iron/Diamond shovel** (3 crits) kills in fewer hits than an Iron pickaxe (4 crits).

---

## 4. Bed-Blazes (Blaze Bedding)
- **Mechanics:** Detonating a bed (or TNT) next to the spawner immediately after the initial wave clears surrounding Nether brick fences, stairs, and walls inside the **9×3×9** spawn volume. Removing solid blocks maximizes valid spawn spaces for subsequent cycles while dealing AoE damage to active blazes.
- **Execution & Fire Clearing:** Place a blast-shield block between your feet and the bed, detonate, and **immediately punch out remaining fire blocks**. Fire raises light levels above the vanilla blaze spawn threshold (`light ≤ 11`) and occupies spawn coordinates. On bombed open spawners, runners often hold a **fishing rod in the offhand** to reel drifting blazes into axe range.

---

## 5. Fire Resistance Management
- **Potion Usage:** Piglin-bartered Fire Resistance (3:00 duration; splash overhead/at feet for maximum ~3:00 duration) completely negates blaze fireball damage and floor fire, enabling aggressive open-spawner fighting and bed-blazing without cover.
- **Timer & No-Fire-Res Routing:** Keep a spare potion on a fixed hotbar slot and check the status timer **between waves** so it never expires mid-wave or during lava/bridge exits. Without Fire Resistance, rely on a **shield** and LOS pillar: wait for a blaze to ignite (telegraphing its 3-fireball volley), block or hide behind cover, then step out to land jump-crits during its cooldown.

---

## 6. MCSR Ranked Standardized Blaze & Rod RNG
- **Standardized Rod Drop Sequence:** MCSR Ranked seeds blaze rod drops (`0` or `1` per kill, 50% base rate) via the match **RNG Seed**. Both players experience the exact same drop sequence in kill order (e.g., if the 1st, 3rd, and 4th blazes drop rods for Player A, they do the same for Player B), eliminating rod-luck variance.
- **Standardized Spawner Cycles & Positions:** Spawner cycle intervals and the **4 candidate `(x, y, z)` spawn coordinates** per wave (weighted toward the spawner center) are identical for both runners.
- **Blocked Spawn Penalty:** If any block, fire, entity, or the player occupies one of the 4 predetermined spots on the spawn tick, **that blaze fails to spawn**. Clearing surrounding bricks (bed-blazing), extinguishing fire, and standing outside the inner spawn cluster are essential in Ranked to avoid forfeiting guaranteed blazes.
- **Target Rod Count:** Runners typically leave with **6–7 rods** (12–14 powder), factoring in pearl supply, blind-travel distance, and Ranked's standardized End Portal pre-fills and guaranteed non-breaking **2nd Eye of Ender throw**.

---

## Sources & References
- **MCSR Ranked Wiki (`wiki.mcsrranked.com/gameplay/rng`):** RNG Seed standardization for Blaze Rod drop sequences, spawner timings, and 4-spot `(x, y, z)` spawner placement logic.
- **MCSR Community Guides (`mcsr.info/speedrunning/fortress`, Metacor 1.16 RSG Guide, MCSR Miraheze Wiki):** Pie-ray (`blockEntities`) calibration, spawnerless RD manipulation, blaze bedding, and tool damage breakpoints.
- **Minecraft Wiki (Java Edition 1.16.1):** Blaze spawner `9×3×9` volume rules, Wither Skeleton `2.4`-block hitbox mechanics, and weapon critical hit multipliers.
