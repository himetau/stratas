// Keeps the local match index fresh. New matches first, then backfills a few days
import type { Store } from "../store";
import type { Api } from "./api";

const BACKFILL_DAYS = 4;

export class Scanner {
  busy = false;
  lastError: string | null = null;
  constructor(private store: Store, private api: Api) {}

  /** Catch up on new matches then backfill one page. Returns how many got added */
  async tick(): Promise<number> {
    if (this.busy) return 0;
    this.busy = true;
    let added = 0;
    try {
      const newest = this.store.newestMatchId();
      let before: number | undefined;
      for (let page = 0; page < 6; page++) {
        const ms = await this.api.matches(before);
        if (!ms.length) break;
        added += this.store.putMatches(ms);
        before = ms.at(-1)!.id;
        if (!newest || before <= newest) break;
      }
      const oldest = this.store.oldestMatch();
      if (oldest && oldest.date * 1000 > Date.now() - BACKFILL_DAYS * 86400_000) {
        const ms = await this.api.matches(oldest.id);
        added += this.store.putMatches(ms);
      }
      this.lastError = null;
    } catch (e) {
      this.lastError = (e as Error).message;
    } finally {
      this.busy = false;
    }
    return added;
  }
}
