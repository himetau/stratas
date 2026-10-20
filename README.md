<a href="https://ko-fi.com/cyoshi"><img align="right" src="docs/readme/kofi.svg" width="190" alt="Buy me a donut on Ko-fi"></a>

<p align="center"><img src="docs/readme/hero.svg" width="100%" alt="Stratas: replay mixer and analysis for MCSR Ranked"></p>

<p align="center">
  <a href="#why-stratas"><b>Why</b></a> ·
  <a href="#what-does-it-do"><b>What it does</b></a> ·
  <a href="#why-its-different"><b>Why it's different</b></a> ·
  <a href="#a-look-inside"><b>A look inside</b></a> ·
  <a href="#get-it-running"><b>Get it running</b></a> ·
  <a href="#support-me"><b>Support me</b></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/MCSR_Ranked-6.0%2B-ffb2ba?style=flat-square&labelColor=1a1112" alt="MCSR Ranked 6.0+">
  <img src="https://img.shields.io/badge/platform-Linux-efc186?style=flat-square&labelColor=1a1112" alt="Linux">
  <img src="https://img.shields.io/badge/uploads-none-87edcd?style=flat-square&labelColor=1a1112" alt="Nothing uploaded">
  <img src="https://img.shields.io/badge/price-free-87ee86?style=flat-square&labelColor=1a1112" alt="Free">
</p>

<br>

## Why Stratas?

In ranked you only ever play people around your own Elo. Stratas lets you practice against someone **way better**, on the **same seed**, whenever you want.

It finds a run from a player above your Elo. You play that seed in a private room. Then Stratas **mixes both replays into one file**, so you open it in Ranked's own replay viewer and you're both in the same world at the same time. No Elo on the line, no pressure, as many tries as you like.

<table>
  <tr>
    <td width="50%"><img src="docs/readme/card-practice.png" alt="Picking opponents by Elo"></td>
    <td width="50%"><img src="docs/readme/card-race.png" alt="Your gap to them over the whole run"></td>
  </tr>
</table>

<br>

## What does it do?

**It analyses every match you play, from the first log to the dragon.** Every private room race, and every ranked game once you download its replay.

<p align="center"><img src="docs/readme/splits.png" width="100%" alt="The splits overview in Stratas: every split against Frieren, and where the time went in the stronghold"></p>

<table>
  <tr>
    <td width="50%" valign="top">
      <p><b>The gap, phase by phase</b><br>where you gained and lost, on a graph you can zoom into</p>
      <p><b>Why you lost time, in plain words</b><br>"7 piglins stuck on gold", "longer way to the fortress", "15 s crafting"</p>
      <p><b>Every trade, craft, pearl and rod</b><br>side by side with theirs, item by item</p>
    </td>
    <td width="50%" valign="top">
      <p><b>Deaths and what they cost</b><br>how long you were gone and what you dropped</p>
      <p><b>The End</b><br>zero cycles, failed cycles, each perch and the dragon kill</p>
      <p><b>Your habits</b><br>after a few races, the things that keep losing you time</p>
    </td>
  </tr>
</table>

<br>

## Why it's different

|  | watching a VOD | a replay on its own | split trackers | **Stratas** |
|---|:---:|:---:|:---:|:---:|
| you and a better player in the same world | — | — | — | **✓** |
| same seed, opponent picked by Elo | — | — | — | **✓** |
| where every second went | you guess | you guess | per split | **✓ with the reason** |
| trades, crafts, pearls, rods, eyes | — | — | — | **✓** |
| habits across many races | — | — | — | **✓** |
| jump to the moment in the replay | — | — | — | **✓** |

- **It reads Ranked's own replays.** No extra mod, no recording, nothing to set up in game.
- **Nothing leaves your computer.** It only reads Ranked's files and adds the mixed replays to My replays.
- **Made by a runner, for runners.** Every number is something you can actually go and fix.

<br>

## A look inside

<table>
  <tr>
    <td width="50%"><img src="docs/readme/card-bastion.png" alt="Zoomed into the bastion"></td>
    <td width="50%"><img src="docs/readme/card-breakdown.png" alt="Where the time went"></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/readme/card-habits.png" alt="Habits that keep losing you time"></td>
    <td width="50%"><img src="docs/readme/card-themes.png" alt="Themes and colours"></td>
  </tr>
</table>

**Make it yours:** theme presets (Nether, Warped, End, Ice, Colourblind) or your own colours, old Ranked menu backgrounds, rain, snow, embers or stars, and you pick exactly what shows on the graph and in the splits.

<br>

## Get it running

Linux only for now. You need Node and an MCSR Ranked instance. Prism, MultiMC and Modrinth instances are found automatically.

```
npm install
npm start
```

You can also put `bin/stratas` on your path. It rebuilds when the code changes, and `--background` starts it in the tray.

<details>
<summary><b>Development</b></summary>

```
npm test
npm run typecheck
npm run snapshot && npm run ui:dev   # the UI in a browser with test data
```

Notes on the replay format are in `docs/replay-format.md`.

</details>

<br>

## Support me

<p align="center"><img src="docs/readme/card-donut.png" width="80%" alt="Can I have a donut?"></p>

<p align="center">
Stratas is free and made by one person. If it's helped you find a few seconds,<br>
a donut keeps it going 🍩
</p>

<p align="center"><a href="https://ko-fi.com/cyoshi"><img src="docs/readme/kofi.svg" width="230" alt="Buy me a donut on Ko-fi"></a></p>

<br>

<p align="center"><sub>made with 🩷 by cyoshi · not affiliated with MCSR Ranked or Mojang</sub></p>
