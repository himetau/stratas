/** Ranked splits in route order: timeline type, split name in Align Splits, phase that starts there. */
export const SPLITS: [string, string, string][] = [
  ["story.enter_the_nether", "Entered the Nether", "Nether"],
  ["nether.find_bastion", "Entered Bastion", "Bastion"],
  ["nether.find_fortress", "Entered Fortress", "Fortress"],
  ["projectelo.timeline.blind_travel", "Blind Travelled", "Stronghold"],
  ["story.follow_ender_eye", "Eye Spy", "Stronghold"],
  ["story.enter_the_end", "Entered the End", "End"],
  ["projectelo.timeline.dragon_death", "Defeated the Dragon", "Finished"],
];

export const START_SPLIT = "Start of Run";
export const END_SPLIT = "End of Run";

export const DEATH_TYPES = ["projectelo.timeline.death", "projectelo.timeline.death_spawnpoint"];

/** Seconds as m:ss, rounds first so 59.6 is 1:00 not 0:60 */
export const clockSec = (s: number) => {
  const r = Math.max(0, Math.round(s));
  return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`;
};

export function fmtTime(ticks: number): string {
  return clockSec(ticks / 20);
}

/** Duration, "13 s" under a minute, "2:07" otherwise */
export const fmtDur = (s: number) => {
  const r = Math.round(Math.abs(s));
  return r >= 60 ? clockSec(r) : `${r} s`;
};

export const fmtSec = (s: number) => `${s >= 0 ? "+" : "−"}${Math.abs(Math.round(s))} s`;
