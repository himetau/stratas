# Draft Discord Feature Request (MCSR Ranked)

> **Note:** Drafted for MCSR Ranked Discord (`#suggestions` or `#api-discussion`). Not sent—post if and when you want.

---

Hey! First off, thank you for the public API and the in-game replay viewer—they've been awesome for VOD review and studying runs.

I've been building a local training tool that compares my runs and splits against opponents (and against stronger runners on the same seed) using `.rrf` files from the `replay/` and `temp-replay/` folders, and wanted to ask if two small quality-of-life additions might be possible:

1. **An auto-save toggle for your own ranked replays (or higher `temp-replay` retention):**
   Right now, reviewing a session of your own ranked games and comparing splits across matches means either remembering to manually click Download on every match in the UI or catching the files in `temp-replay/` before they rotate out. An in-game setting to automatically save your own completed ranked matches (or solo private room runs for supporters) straight to `replay/` would make post-session VOD/split review completely seamless.

2. **A `Private-Key`-authenticated replay download endpoint on the public API:**
   Currently, the public API exposes `replayExist` on match objects, and players can generate a personal `Private-Key` for authenticated requests, but downloading an `.rrf` still requires going through the in-game menus (Search Profile → Recent Matches → Download Replay) using the mod's internal credentials. To stay strictly respectful of Ranked's anticheat and server load, I don't touch internal mod auth—everything goes through the UI manually. Having an official endpoint (even with a strict separate rate limit or CDN signed link gated behind the user's `Private-Key`) to fetch public `.rrf` files by `matchId` would let training and analysis tools fetch a match replay cleanly without scraping or manual menu clicking.

Totally understand if storage, bandwidth, or anticheat constraints make either of these tricky—happy to work within whatever rate limits or restrictions make sense. Thanks for considering it!
