// Everything on the settings page that isn't account or instance setup. Saved with the rest of the settings
export interface Prefs {
  // Theme
  /** A preset id from THEMES, "custom" for themeCustom, or "auto" (matugen's colours file when there is one, else Stratas) */
  theme: string;
  /** Custom colours, a JSON ThemeColors */
  themeCustom: string;
  /** Accent from your rank instead of the theme */
  rankAccent: boolean;
  font: "pixel" | "system";
  scale: number;
  corners: "pixel" | "square";
  /** Background behind the pages: "menu" / "menu_sharp" (current Ranked), "old:<id>" (an older release's), or "off" */
  art: string;
  artBlur: number;
  artDim: number;
  effect: "rain" | "snow" | "embers" | "stars" | "off";
  effectAmount: number;
  effectSpeed: number;
  motion: "system" | "full" | "reduced";
  celebrate: "confetti" | "sparks" | "off";
  // Companion
  companionOnTop: boolean;
  companionAuto: boolean;
  // Graph
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
  /** Whose moments go on the graph */
  momentsOf: "both" | "you" | "them";
  // Each kind of moment on the graph
  mOwCraft: boolean; mTrade: boolean; mKit: boolean; mPearls: boolean; mBlaze: boolean; mBlast: boolean; mCraft: boolean;
  mPortal: boolean; mEyes: boolean; mZero: boolean; mPerch: boolean; mKill: boolean; mDone: boolean; mDead: boolean;
  // Splits overview
  colDelta: boolean; colGap: boolean; colWatch: boolean;
  splitRows: boolean;
  unreached: boolean;
  costRows: boolean;
  costDetail: boolean;
  tradesTable: boolean;
  craftsTable: boolean;
  nTrading: boolean; nDeaths: boolean; nOverworld: boolean; nNether: boolean; nPrecraft: boolean; nEnd: boolean; nOther: boolean;
  playByPlay: "closed" | "open" | "hidden";
  // Analysis
  leavePearls: number;
  leaveObsidian: number;
  leaveString: number;
  // Keys
  keyWatch: string;
  keyCompanion: string;
  // Support popups, not shown on the settings page: how many times it asked and when last (ms), and whether
  // you went to Ko-fi (then it never asks again)
  supportAsked: number;
  supportLastAsked: number;
  supportClicked: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  theme: "auto", themeCustom: "", rankAccent: false, font: "pixel", scale: 100, corners: "pixel", art: "menu", artBlur: 0, artDim: 74,
  effect: "rain", effectAmount: 1, effectSpeed: 1, motion: "system", celebrate: "confetti",
  companionOnTop: true, companionAuto: false,
  moments: "curve", minMoment: 15, splits: true, times: true, lead: false, lineTimes: true, costs: 3, callouts: 8, outline: 55, curveWidth: 2, zoomAnim: true,
  phaseNames: true, momentsOf: "both",
  mOwCraft: true, mTrade: true, mKit: true, mPearls: true, mBlaze: true, mBlast: true, mCraft: true,
  mPortal: true, mEyes: true, mZero: true, mPerch: true, mKill: true, mDone: true, mDead: true,
  colDelta: true, colGap: true, colWatch: true, splitRows: true, unreached: true, costRows: true, costDetail: true, tradesTable: true, craftsTable: true,
  nTrading: true, nDeaths: true, nOverworld: true, nNether: true, nPrecraft: true, nEnd: true, nOther: true,
  playByPlay: "closed",
  leavePearls: 20, leaveObsidian: 20, leaveString: 64,
  keyWatch: "m", keyCompanion: "c",
  supportAsked: 0, supportLastAsked: 0, supportClicked: false,
};

/** Saved prefs over the defaults, dropping keys that no longer exist or changed type */
export function mergePrefs(saved: Partial<Prefs> | undefined): Prefs {
  const out = { ...DEFAULT_PREFS };
  for (const k of Object.keys(DEFAULT_PREFS) as (keyof Prefs)[]) {
    const v = saved?.[k];
    if (v !== undefined && typeof v === typeof DEFAULT_PREFS[k]) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

// ---- themes

/** The colours a theme sets, the rest of the palette is mixed from these */
export interface ThemeColors { bg: string; text: string; accent: string; you: string; them: string; good: string; bad: string; warn: string }
export const THEME_KEYS: [keyof ThemeColors, string][] = [
  ["bg", "Background"], ["text", "Text"], ["accent", "Accent"], ["you", "You"], ["them", "Opponent"], ["good", "Gain"], ["bad", "Loss"], ["warn", "Highlight"],
];

export const THEMES: { id: string; name: string; c: ThemeColors }[] = [
  { id: "stratas", name: "Stratas", c: { bg: "#1a1112", text: "#f0dedf", accent: "#ffb2ba", you: "#efc186", them: "#87edcd", good: "#87ee86", bad: "#f2838f", warn: "#f09d84" } },
  { id: "nether", name: "Nether", c: { bg: "#1c0d0b", text: "#f3dcd4", accent: "#ff7b54", you: "#ffc66d", them: "#c58bff", good: "#8be38b", bad: "#ff6b6b", warn: "#ffab5e" } },
  { id: "warped", name: "Warped", c: { bg: "#0b1716", text: "#d6f2ee", accent: "#35d0b5", you: "#f0c27b", them: "#b48cff", good: "#7ee8a1", bad: "#ff7f8a", warn: "#f2a65a" } },
  { id: "end", name: "End", c: { bg: "#12101a", text: "#e8e2f5", accent: "#c7a6ff", you: "#f2e29b", them: "#8fd3ff", good: "#9ae6a0", bad: "#ff8fa3", warn: "#f4b183" } },
  { id: "overworld", name: "Overworld", c: { bg: "#10150f", text: "#e3eedc", accent: "#8fd16a", you: "#f2c46d", them: "#7cc7ff", good: "#9be37a", bad: "#ff8577", warn: "#f0ad6b" } },
  { id: "ice", name: "Ice", c: { bg: "#0e1419", text: "#e2edf5", accent: "#8cc8ff", you: "#f5d08a", them: "#9cf0d8", good: "#8ae6b2", bad: "#ff8f9c", warn: "#f6b37a" } },
  { id: "mono", name: "Mono", c: { bg: "#121212", text: "#e8e8e8", accent: "#d0d0d0", you: "#f2d38a", them: "#9ad8e8", good: "#a8e0a0", bad: "#f0a0a0", warn: "#e0b890" } },
  { id: "colourblind", name: "Colourblind", c: { bg: "#14131a", text: "#ecebf3", accent: "#8cc8ff", you: "#ffd36e", them: "#c9a7ff", good: "#6cb6ff", bad: "#ffa657", warn: "#f0c674" } },
];

/** Custom colours, falling back to Stratas for anything missing or not a colour */
export function customTheme(json: string): ThemeColors {
  const base = THEMES[0].c;
  try {
    const v = JSON.parse(json) as Partial<ThemeColors>;
    return Object.fromEntries(THEME_KEYS.map(([k]) => [k, typeof v[k] === "string" && /^#[0-9a-f]{6}$/i.test(v[k]!) ? v[k]! : base[k]])) as unknown as ThemeColors;
  } catch { return { ...base }; }
}
