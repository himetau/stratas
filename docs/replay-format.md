# MCSR Ranked replay format (v40+, record format 3)

Reverse-engineered on 2026-10-16 from MCSR Ranked 6.0.1–6.0.3 (`com.mcsrranked.client.anticheat.replay.format.*`: `TimeLineType` ids and each `*Factory.getFromBytes`). The implementation in `src/core/replay/` is the reference; this is a summary.

## Files
- `.rrf` is a zip containing `meta.json`, `timelines.json` and `replay.rpd`.
- `meta.json` has `version`, `matchId`, `matchType` (2 = ranked, 3 = private), `overworldSeed`, `netherSeed`, `theEndSeed`, `symmetricKey`, `result {uuid, time ms}` and `players[]`.
  - When `version` < 40, `symmetricKey` is set and `replay.rpd` is encrypted. Not supported.
- `timelines.json` holds `[{uuid, type, time (ms), data?: [x, y, z]}]`. These are advancements and `projectelo.timeline.*` events. The coordinates are the player's block position at that moment; portal events use the coordinates from before the portal.

## replay.rpd
- **Chunks:** `[u32 BE length][zstd frame]`, repeated. Each decompressed chunk is `[16-byte player UUID][0x83][records…]`. `0x83` is `FORMAT_MARKER_FLAG | 3`. Ranked interleaves the players' chunks about every 5 s.
- **Records:** `[u8 type][u8 tickDelta]`. If `tickDelta == 0xFF`, a big-endian `i32` absolute tick follows. Then the payload, which has no length field. Every chunk's first record uses an absolute tick. The game runs at 20 ticks/s, so `time_ms / 50` = tick.
- **Encoding:** everything is big-endian. Rotations are `i16` hundredths of a degree. Block positions are `BlockPos.asLong`: x is 26 bits shifted left 38, z is 26 bits shifted left 12, y is 12 bits.
- **Positions:** each entity key (the player key `-2147483647`, or an entity id) keeps a running position in 1/4096 of a block.
  - Absolute records set it.
  - `*_DELTA` records add `i16` values.
  - `*_SMALL_DELTA` records add `i8 × 16`.
- **Block deltas** add `i8` values to the last block position used.

| id | record | payload |
|---|---|---|
| 0 | EMPTY | u8 |
| 1 / 2 | PLAYER_SPAWN / PLAYER_POSITION | world u8, x y z f32, yaw i16, pitch i16 |
| 3 | PLAYER_LOOK | world u8, yaw i16, pitch i16 |
| 4 | PLAYER_POS | world u8, x y z f32 |
| 5 | POSE | u8 |
| 6 | RIDE | i32 |
| 7 | PAUSE | bool |
| 8 | PLAYER_REMOVE | world u8, u8 |
| 9 | PERSPECTIVE | u8 |
| 10 | STATS | health, absorption, food, air: i8 each |
| 11 | USE | u8 (hand & 3, finished & 4) |
| 12 | EFFECT | id u8 (vanilla raw id), amplifier u8, duration u16 |
| 13 | HELD_SLOT | u8 |
| 14 | PLAYER_POSITION_DELTA | dx dy dz i16, yaw i16, pitch i16 |
| 15 | PLAYER_POS_DELTA | dx dy dz i16 |
| 16 | CONTAINER | type u8 (255 = closed, 254 = inventory, else menu id), slots u8, flags u8 (world = flags >> 2, count = flags & 3), then `count` × i64 BlockPos |
| 17 | PORTAL | bool |
| 18 | SWING | hand u8 |
| 19 | RENDER_DISTANCE | u8 |
| 20 | ATTACK_RESET | (none) |
| 21 | PIE_CHART | n u8; row 0: k u8 × name, other rows: name; each row ends with u8 u8. A name is a varint id (≥128 → 2 bytes) into `data/pie-names.json` (1-based); id 0 = u8 length + UTF-8 bytes |
| 25 | BLOCK_UPDATE | world u8, pos i64, state id i32, event u8 |
| 26 / 27 | BLOCK_BREAK / BLOCK_REMOVE | world u8, pos i64 |
| 28 | BLOCK_PROGRESS | world u8, pos i64, progress i8 |
| 29 | CHEST_ANIMATION | world u8, pos i64, open bool |
| 30 | BLOCK_UPDATE_DELTA | dx dy dz i8, state u16, event u8 |
| 31 / 32 | BLOCK_BREAK / REMOVE_DELTA | dx dy dz i8 |
| 33 | BLOCK_PROGRESS_DELTA | dx dy dz i8, progress i8 |
| 40 | ENTITY_ADD | world u8, x y z f32, yaw i16, pitch i16, id i32, type i32, data i32 |
| 41 | ENTITY_MOVE | world u8, x y z f32, yaw i16, pitch i16, id i32 |
| 42 | ENTITY_LOOK | world u8, yaw i16, pitch i16, id i32 |
| 43 | ENTITY_POS | world u8, x y z f32, id i32 |
| 44 | ENTITY_MOVE_DELTA | world u8, dx dy dz i16, yaw i16, pitch i16, id i32 |
| 45 | ENTITY_POS_DELTA | world u8, dx dy dz i16, id i32 |
| 46 | ENTITY_DAMAGE | world u8, hurt entity id i32, attacker id i32 |
| 47 | ENTITY_REMOVE | world u8, id i32, u8 |
| 48 | ENTITY_MOVE_SMALL_DELTA | dx dy dz i8, yaw i8, pitch i8, id i32 |
| 49 | ENTITY_POS_SMALL_DELTA | dx dy dz i8, id i32 |
| 50 | PIGLIN_STATE | world u8, id i32, state u8, u8, i16, i16 |
| 51 | MOB_STATE | world u8, id i32, i32 |
| 61 | ITEM_ENTITY | world u8, x y z f32, id i32, item u16, count u8, flags u8 |
| 62 | ITEM_PICKUP | world u8, item entity id i32, collector i32 (-2 = player), count u8 |
| 63 | PROJECTILE | world u8, x y z f32, yaw i16, pitch i16, id i32, velocity 3 × f64, type i32 (low 16 bits = entity type), flags u8 |
| 64 | INVENTORY_SLOT | slot u8, item u16, count u8, durability u8, variant u8, b u8 (enchantments = b & 63), then that many × u16 |
| 80 | DRAGON_MOVE | x y z f32, i16, i16 |
| 81 | DRAGON_MOVE_DELTA | 5 × i16 |
| 82–85 | DRAGON_PHASE / HEALTH / CRYSTAL / DEATH | u8 |
| 86 | DRAGON_DEATH_PROGRESS | i16, u8 |
| 87 | DRAGON_NODES | n u8, n × i64 |
| 88 | DRAGON_ZERO | u8 (1 = nothing more), else f32, u8, 3 × f32, u8 |
| 89 | DRAGON_DAMAGE | u8, i16 |
| 90 | DRAGON_TARGET | u8 (0 = none), else 3 × f32 |
| 91 | DRAGON_PATH | u8, n u8, n × (u8, and i64 if that u8 is 255) |
| 100 | EXPLOSION | world u8, x y z f32, power f32 |
| 101 | AREA_EFFECT_CLOUD | 27 bytes |
| 102 | WORLD_TIME | i64 |
| 103 | PIGLIN_BARTER | world u8, piglin id i32, n u8, n × (item u16, count u8) |

Item, block state, entity, effect and menu ids are vanilla 1.16.1 raw ids (see `data/registries-1.16.1.json`).

## Combining runs
- A chunk only contains one player's data, so you can put runners from different files with the same seed into one `.rrf`. Copy their chunks byte for byte, interleave them by first tick, and write a `meta.json` with both players and `symmetricKey: null`. Ranked's My replays loads files like this (tested in-game on 2026-10-16).
- To shift a runner in time, add the offset to every absolute tick, then recompress (`retimeChunk`).

## Known Replay Pitfalls
- **Position records only when moving:** Ranked only emits `PLAYER_POSITION*` / `PLAYER_POS*` when the player moves. Standing still at a trade spot or in a portal leaves a multi-second gap in `track`; the player was still at the prior coordinate until `nextRecord.t - 1`.
- **Quit pauses (`PAUSE` record 7):** When a player forfeits/quits a match and spectates, Ranked emits `PAUSE(true)` at the forfeit tick and continues recording spectator camera movement until the opponent finishes. An unclosed pause lasting `>= 30 s` (`600` ticks) to the end of the replay marks where the runner stopped playing (`run.quit = true`, `run.end = pauseStart`).
- **Pearl flights & pearl hangs:** Normal ender pearl flights emit `PROJECTILE` (`ender_pearl`) on throw and `ENTITY_REMOVE` on landing. When a pearl is thrown out of a bastion, the runner left the bastion at `pearl.t0` (throw), not landing, unless they pre-threw a chunk-border **pearl hang** (`>= 7 s` flight with `>= 4 s` position-update pause while chunks are unloaded) and stayed to collect more trades.
- **Ground loot vs inventory (`PIGLIN_BARTER` vs `INVENTORY_SLOT`):** `PIGLIN_BARTER` (record 103) fires when the piglin finishes admiring gold and drops the item on the ground; `INVENTORY_SLOT` (record 64, slots `0..40`) updates only when the player picks the item up. `tradesDone()` counts completed trades on the ground, while `enoughAt()` measures when the items are in the player's inventory.
- **Delta block world state (`st.blockWorld`):** Delta block records (`30..33`) inherit `st.blockWorld` from the last absolute block record (`25..29`). Check `run.posAt(t).w` for the player's true dimension. Also filter out stale `BLOCK_PROGRESS` entries when leaves decay in the Overworld (`> 5000` ticks later) or when beds explode blocks in the End (`> 100` ticks after a brief click).
- **Standardised RNG:** Every player on the same seed receives the same piglin trade sequence, blaze rod drop sequence, eye break rolls (guaranteed 2nd eye survival), and dragon perch probability curve. Differences in trade count needed to leave come from chest/mined items, not barter luck.
- **`PlayerTier` Elo thresholds:** Iron `0–599` (1:0, 2:200, 3:400), Gold `600–899` (1:600, 2:700, 3:800), Emerald `900–1199` (1:900, 2:1000, 3:1100), Diamond `1200–1499` (1:1200, 2:1300, 3:1400), Netherite `1500+` (`1500–1999`, `2000+` Top/Leaderboard).
