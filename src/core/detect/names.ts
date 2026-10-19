// Split and advancement names like Ranked's replay viewer shows them (Align Splits)

/** Timeline type -> Ranked split name, in route order */
export const SPLITS: [string, string, string][] = [
  // [timeline type, split name in Align Splits, phase that starts here]
  ["story.enter_the_nether", "Entered the Nether", "Nether"],
  ["nether.find_bastion", "Entered Bastion", "Bastion"],
  ["nether.find_fortress", "Entered Fortress", "Fortress"],
  ["projectelo.timeline.blind_travel", "Blind Travelled", "Stronghold"],
  ["story.follow_ender_eye", "Eye Spy", "Stronghold"],
  ["story.enter_the_end", "Entered the End", "End"],
  ["projectelo.timeline.dragon_death", "Defeated the Dragon", "Finished"],
];

export const ADVANCEMENTS: Record<string, string> = {
  "story.mine_stone": "Stone Age",
  "story.iron_tools": "Isn't It Iron Pick",
  "story.smelt_iron": "Acquire Hardware",
  "story.obtain_armor": "Suit Up",
  "story.lava_bucket": "Hot Stuff",
  "story.form_obsidian": "Ice Bucket Challenge",
  "story.mine_diamond": "Diamonds!",
  "nether.loot_bastion": "War Pigs",
  "nether.obtain_crying_obsidian": "Who is Cutting Onions?",
  "nether.obtain_blaze_rod": "Into Fire",
  "adventure.kill_a_mob": "Monster Hunter",
  "end.kill_dragon": "Free the End",
};

export const START_SPLIT = "Start of Run";
export const END_SPLIT = "End of Run";

export const splitName = (type: string) => SPLITS.find((s) => s[0] === type)?.[1] ?? ADVANCEMENTS[type] ?? null;

export const DEATH_TYPES = ["projectelo.timeline.death", "projectelo.timeline.death_spawnpoint"];

export function fmtTime(ticks: number): string {
  const s = Math.max(0, Math.round(ticks / 20));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Seconds as m:ss, rounds first so 59.6 is 1:00 not 0:60 */
export const clockSec = (s: number) => { const r = Math.max(0, Math.round(s)); return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`; };
/** Duration, "13 s" under a minute, "2:07" otherwise */
export const fmtDur = (s: number) => { const r = Math.round(Math.abs(s)); return r >= 60 ? clockSec(r) : `${r} s`; };

export const fmtSec = (s: number) => `${s >= 0 ? "+" : "−"}${Math.abs(Math.round(s))} s`;
