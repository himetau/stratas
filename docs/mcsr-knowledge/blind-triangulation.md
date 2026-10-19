# MCSR 1.16.1 Blind Travel & Stronghold Triangulation

## 1. Stronghold Ring & Optimal Blind Coordinates
In Minecraft 1.16.1, the first stronghold ring contains 3 strongholds spaced $\approx 120^\circ$ apart at an Overworld radial distance of $1408 \le R_{\text{OW}} \le 2688$ blocks from $(0,0)$ ($176 \le R_{\text{Nether}} \le 336$).
- **Optimal Uninformed Blind (`~(150, 0)` Ring)**: Building a portal slightly inside the inner ring boundary avoids overshooting while minimizing expected Euclidean distance (accounting for ocean biome push and portal snapping). Optimal blind coordinates lie on a Nether circle of radius **$150\text{--}210$ blocks** from $(0,0)$—commonly referenced as the **`(150, 0)`** ring or diagonal **`(150, 150)`** ($r \approx 212$).
- **Divine Travel**: Generation of a bone fossil in Nether chunk `(0, 0)` correlates with the Overworld world-gen seed for the first stronghold's angle. Reading the fossil's X-axis block offset (`0`–`15`) narrows the stronghold to three $22.5^\circ$ wedges spaced $120^\circ$ apart, shifting optimal blind coordinates onto the sector centerline at $r \approx 195\text{--}210$.

| Blind Strategy | Target Nether Radius | Example Coords | Avg. OW Distance to Stronghold |
| :--- | :--- | :--- | :--- |
| **Uninformed Blind** | $150\text{--}210$ blocks | `(150, 0)` / `(150, 150)` | $\sim 650\text{--}800$ blocks |
| **Fossil Divine Blind** | $190\text{--}215$ blocks | Sector-specific ray | $\sim 350\text{--}450$ blocks |
| **Calculated (Second Portal)** | Exact $(X_{\text{SH}}/8, Z_{\text{SH}}/8)$ | Ninjabrain Bot output | $< 50$ blocks (chunk link) |

## 2. Rod Counts, Early Blind & Nether Re-entry
An End Portal has 12 frames, each with an independent $10\%$ chance of generating pre-filled ($\mu = 1.2$ eyes).
- **6-Rod Standard (12 Eyes)**: Leaving the fortress with 6 blaze rods (12 eyes) is the standard safe benchmark—it guarantees completion on a 0-eye portal if no eyes break, or absorbs 1–2 eye breaks on a typical 1–2 eye portal. (7 rods = 14 eyes adds margin + Fire Resistance).
- **5-Rod (10 Eyes) Risk Play**: Relies on $\ge 1$ pre-filled frame and minimal eye breaks; saves ~10–20s of blaze waiting on tight pace runs.
- **1-Rod / Early Blind & Nether Re-entry**:
  - **Calculated / Educated Travel**: When the stronghold is projected $>800\text{--}1000$ Overworld blocks away on the first eye throw, runners **re-enter the Nether**, travel $D_{\text{OW}} / 8$ blocks along the triangulated vector, and build a second portal directly on the stronghold.
  - **1-Rod Early Blind**: If a runner obtains 1 blaze rod early (e.g., stray blaze before spawner) or blinds from a bastion with pre-crafted eyes (unlikely in 1.16 RSG, common in specific splits), they can exit to the Overworld, throw an eye to triangulate the stronghold vector, and **re-enter the Nether** to route toward a fortress or portal link aligned with the stronghold.

## 3. Triangulation Angle Math & Boat Eye
Eyes of Ender point directly toward block offset **`(4, 4)`** of the stronghold's starter staircase chunk (`StrongholdStart`, block $(16X + 4, 16Z + 4)$).

### Two-Eye Subpixel Triangulation
1. Throw the first eye at $(x_1, z_1)$ and measure horizontal yaw $\theta_1$ (using minimum `FOV: 30` + low mouse sensitivity zoom to read the eye's horizontal rest frame to $\sim 0.01^\circ$).
2. Strafe perpendicular to $\theta_1$ by $d$ blocks (typically $15\text{--}30$ blocks) to $(x_2, z_2)$ and measure $\theta_2$.
3. By the Law of Sines, radial distance $R$ from the second throw is:
   $$R = d \cdot \frac{\sin(\phi)}{\sin(|\theta_2 - \theta_1|)}$$
   where $\phi$ is the angle between the movement baseline and the initial throw ray. Distance uncertainty scales inversely with parallax $\Delta \theta = |\theta_2 - \theta_1|$.

### Boat Eye (Perfect Travel)
In 1.16.1, mounting a boat snaps the player's camera yaw to a quantized entity rotation grid ($\approx 0.0005^\circ$ effective resolution). Because valid stronghold targets only exist at discrete chunk coordinates $(16X + 4, 16Z + 4)$, a runner can enter a boat to snap their angle, align with a **single thrown eye**, press `F3 + C` to copy exact pose data to **Ninjabrain Bot**, and resolve the exact stronghold chunk from one throw.

## 4. Eye Break Probability (Vanilla vs. MCSR Ranked)
- **Vanilla 1.16.1**: Every Eye of Ender thrown has a fixed, independent **$20\%$ ($1/5$) probability of shattering** and an $80\%$ chance of dropping as a recoverable item.
  - With 12 eyes and 2 throws used for triangulation, the probability that both survive is $0.8^2 = 64\%$; $32\%$ lose 1 eye; $4\%$ lose both.
- **MCSR Ranked Standardization**: To prevent matches from being decided by extreme shatter variance (e.g., losing both triangulation eyes or failing a 12-eye portal), MCSR Ranked uses a **standardized / pseudo-random eye-break sequence** seeded per match so both players share identical, bounded eye-shatter outcomes.

## 5. Starter Staircase & Digging at Chunk `(4, 4)`
- Because the Eye of Ender targets local chunk coordinates **`(4, 4)`**, runners check the `F3` overlay (`Chunk: 4 y 4 in X Y Z`) at the target chunk and dig straight down (straddling `(4, 4)` and `(4, 3)` for safety).
- Digging at `(4, 4)` lands directly inside the $5 \times 5$ **starter spiral staircase** (`StrongholdStart`), allowing immediate entry and portal room navigation via bottom-doorway orientation and 5-way crossing heuristics.

## Sources & References
- **Sharpieman20 & Four (MCSR Community)**: *Blind Travel Optimality & Probability Distributions in 1.16.1* (derivation of the $r \approx 150\text{--}210$ Nether blind ring and Fossil Divine sectors).
- **Ninjabrain1**: *Ninjabrain Bot Documentation — Triangulation, Subpixel Adjustment & Boat Eye Mechanics* ([github.com/Ninjabrain1/Ninjabrain-Bot](https://github.com/Ninjabrain1/Ninjabrain-Bot)).
- **MCSR Ranked Wiki**: *Seed Standardization & Competitive Ruleset (Eye Shatter RNG & Divine Rules)* ([mcsrranked.com](https://mcsrranked.com)).
- **Minecraft Speedrunning Discord / Couriway Metagame Guides**: *Calculated Travel, 6-Rod vs. 5-Rod Endgames, and Chunk (4, 4) Entry*.
