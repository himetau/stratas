const EFFECTS = ["snow", "embers", "stars", "off"] as const;

/** Settings page options other than account and instance setup. */
export interface Prefs {
  /** A preset id from THEMES, "custom" for themeCustom, or "auto".
   *  The auto theme uses matugen's colours file when there is one, else Stratas. */
  theme: string;
  /** Custom colours as a JSON ThemeColors. */
  themeCustom: string;
  /** Takes the accent colour from your rank. */
  rankAccent: boolean;
  font: "pixel" | "system";
  scale: number;
  corners: "pixel" | "square";
  /** Background behind the pages: "menu" or "menu_sharp" (current Ranked), "old:<id>" (an older
   *  release's), "custom:<hash>" (your own image), or "off". */
  art: string;
  artBlur: number;
  artDim: number;
  effect: (typeof EFFECTS)[number];
  effectAmount: number;
  effectSpeed: number;
  motion: "system" | "full" | "reduced";
  celebrate: "confetti" | "sparks" | "off";
  companionOnTop: boolean;
  companionAuto: boolean;
  moments: "curve" | "rail" | "list" | "off";
  minMoment: number;
  splits: boolean;
  times: boolean;
  lead: boolean;
  lineTimes: boolean;
  costs: number;
  callouts: number;
  outline: number;
  curveWidth: number;
  zoomAnim: boolean;
  phaseNames: boolean;
  /** Whose moments go on the graph. */
  momentsOf: "both" | "you" | "them";
  // Each m-prefixed flag shows one kind of moment on the graph.
  mOwCraft: boolean;
  mTrade: boolean;
  mKit: boolean;
  mPearls: boolean;
  mBlaze: boolean;
  mBlast: boolean;
  mCraft: boolean;
  mPortal: boolean;
  mEyes: boolean;
  mZero: boolean;
  mPerch: boolean;
  mKill: boolean;
  mDone: boolean;
  mDead: boolean;
  colDelta: boolean;
  colGap: boolean;
  colWatch: boolean;
  splitRows: boolean;
  unreached: boolean;
  costRows: boolean;
  costDetail: boolean;
  tradesTable: boolean;
  craftsTable: boolean;
  // Each n-prefixed flag shows one category of notes in the splits overview.
  nTrading: boolean;
  nDeaths: boolean;
  nOverworld: boolean;
  nNether: boolean;
  nPrecraft: boolean;
  nEnd: boolean;
  nOther: boolean;
  playByPlay: "closed" | "open" | "hidden";
  leavePearls: number;
  leaveObsidian: number;
  leaveString: number;
  /** Deletes the race and our copy of your run when you forfeit a private room run.
   *  Only runs after dropForfeitsSince (ms) are deleted. */
  dropForfeits: boolean;
  dropForfeitsSince: number;
  keyWatch: string;
  keyCompanion: string;
  // The support popup fields are not on the settings page. supportLastAsked is in ms, and a true
  // supportClicked means you went to Ko-fi, so the popup never asks again.
  supportAsked: number;
  supportLastAsked: number;
  supportClicked: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  theme: "auto",
  themeCustom: "",
  rankAccent: false,
  font: "pixel",
  scale: 100,
  corners: "pixel",
  art: "menu",
  artBlur: 0,
  artDim: 74,
  effect: "off",
  effectAmount: 1,
  effectSpeed: 1,
  motion: "system",
  celebrate: "confetti",
  companionOnTop: true,
  companionAuto: false,
  moments: "curve",
  minMoment: 15,
  splits: true,
  times: true,
  lead: false,
  lineTimes: true,
  costs: 3,
  callouts: 8,
  outline: 55,
  curveWidth: 2,
  zoomAnim: true,
  phaseNames: true,
  momentsOf: "both",
  mOwCraft: true,
  mTrade: true,
  mKit: true,
  mPearls: true,
  mBlaze: true,
  mBlast: true,
  mCraft: true,
  mPortal: true,
  mEyes: true,
  mZero: true,
  mPerch: true,
  mKill: true,
  mDone: true,
  mDead: true,
  colDelta: true,
  colGap: true,
  colWatch: true,
  splitRows: true,
  unreached: true,
  costRows: true,
  costDetail: true,
  tradesTable: true,
  craftsTable: true,
  nTrading: true,
  nDeaths: true,
  nOverworld: true,
  nNether: true,
  nPrecraft: true,
  nEnd: true,
  nOther: true,
  playByPlay: "closed",
  leavePearls: 20,
  leaveObsidian: 20,
  leaveString: 64,
  dropForfeits: false,
  dropForfeitsSince: 0,
  keyWatch: "m",
  keyCompanion: "c",
  supportAsked: 0,
  supportLastAsked: 0,
  supportClicked: false,
};

/** Merges saved prefs over the defaults. Saved keys missing from the defaults or of another type
 *  are dropped, and an unknown effect falls back to off. */
export function mergePrefs(saved: Partial<Prefs> | undefined): Prefs {
  const out = { ...DEFAULT_PREFS };
  for (const k of Object.keys(DEFAULT_PREFS) as (keyof Prefs)[]) {
    const v = saved?.[k];
    if (v !== undefined && typeof v === typeof DEFAULT_PREFS[k]) {
      (out as Record<string, unknown>)[k] = v;
    }
  }
  if (!EFFECTS.includes(out.effect)) {
    out.effect = "off";
  }
  return out;
}

/** The colours a theme sets. The rest of the palette is mixed from these. */
export interface ThemeColors {
  bg: string;
  text: string;
  accent: string;
  you: string;
  them: string;
  good: string;
  bad: string;
  warn: string;
}
export const THEME_KEYS: [keyof ThemeColors, string][] = [
  ["bg", "Background"],
  ["text", "Text"],
  ["accent", "Accent"],
  ["you", "You"],
  ["them", "Opponent"],
  ["good", "Gain"],
  ["bad", "Loss"],
  ["warn", "Highlight"],
];

export const THEMES: { id: string; name: string; c: ThemeColors }[] = [
  {
    id: "stratas",
    name: "Stratas",
    c: {
      bg: "#1a1112",
      text: "#f0dedf",
      accent: "#ffb2ba",
      you: "#efc186",
      them: "#87edcd",
      good: "#87ee86",
      bad: "#f2838f",
      warn: "#f09d84",
    },
  },
  {
    id: "nether",
    name: "Nether",
    c: {
      bg: "#1c0d0b",
      text: "#f3dcd4",
      accent: "#ff7b54",
      you: "#ffc66d",
      them: "#c58bff",
      good: "#8be38b",
      bad: "#ff6b6b",
      warn: "#ffab5e",
    },
  },
  {
    id: "warped",
    name: "Warped",
    c: {
      bg: "#0b1716",
      text: "#d6f2ee",
      accent: "#35d0b5",
      you: "#f0c27b",
      them: "#b48cff",
      good: "#7ee8a1",
      bad: "#ff7f8a",
      warn: "#f2a65a",
    },
  },
  {
    id: "end",
    name: "End",
    c: {
      bg: "#12101a",
      text: "#e8e2f5",
      accent: "#c7a6ff",
      you: "#f2e29b",
      them: "#8fd3ff",
      good: "#9ae6a0",
      bad: "#ff8fa3",
      warn: "#f4b183",
    },
  },
  {
    id: "overworld",
    name: "Overworld",
    c: {
      bg: "#10150f",
      text: "#e3eedc",
      accent: "#8fd16a",
      you: "#f2c46d",
      them: "#7cc7ff",
      good: "#9be37a",
      bad: "#ff8577",
      warn: "#f0ad6b",
    },
  },
  {
    id: "ice",
    name: "Ice",
    c: {
      bg: "#0e1419",
      text: "#e2edf5",
      accent: "#8cc8ff",
      you: "#f5d08a",
      them: "#9cf0d8",
      good: "#8ae6b2",
      bad: "#ff8f9c",
      warn: "#f6b37a",
    },
  },
  {
    id: "mono",
    name: "Mono",
    c: {
      bg: "#121212",
      text: "#e8e8e8",
      accent: "#d0d0d0",
      you: "#f2d38a",
      them: "#9ad8e8",
      good: "#a8e0a0",
      bad: "#f0a0a0",
      warn: "#e0b890",
    },
  },
  {
    id: "colourblind",
    name: "Colourblind",
    c: {
      bg: "#14131a",
      text: "#ecebf3",
      accent: "#8cc8ff",
      you: "#ffd36e",
      them: "#c9a7ff",
      good: "#6cb6ff",
      bad: "#ffa657",
      warn: "#f0c674",
    },
  },
];

const isHexColour = (c: unknown): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);

/** Parses custom colours, falling back to Stratas for anything missing or not a colour. */
export function customTheme(json: string): ThemeColors {
  const base = THEMES[0].c;
  try {
    const v = JSON.parse(json) as Partial<ThemeColors>;
    return Object.fromEntries(
      THEME_KEYS.map(([k]) => {
        const colour = v[k];
        return [k, isHexColour(colour) ? colour : base[k]];
      }),
    ) as unknown as ThemeColors;
  } catch {
    return { ...base };
  }
}
