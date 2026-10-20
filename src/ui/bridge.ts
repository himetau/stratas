// Typed access to the preload bridge
import type { AppState, Settings } from "../core/service";
import type { RaceAnalysis } from "../core/detect/analyze";
import type { Pick, PickOptions } from "../core/seeds/picker";
import type { QueueRow, RaceRow } from "../core/store";
import type { MatchDetail, ProfileData } from "../core/profile/types";
import type { OldArt } from "../core/oldart";

export interface Bridge {
  state(): Promise<AppState>;
  settings(patch: Partial<Settings>): Promise<void>;
  pick(opts: PickOptions): Promise<{ picks: Pick[]; notes: string[] }>;
  enqueue(picks: Pick[]): Promise<void>;
  queueStatus(id: number, status: QueueRow["status"]): Promise<void>;
  race(id: number): Promise<{ row: RaceRow; analysis: RaceAnalysis | null } | null>;
  deleteRace(id: number): Promise<void>;
  reanalyze(): Promise<void>;
  rescan(): Promise<void>;
  refresh(): Promise<void>;
  rankIcons(): Promise<Record<string, string>>;
  /** Ranked's blurred menu background and structure icon sheet, read from the mod jar */
  rankedAssets(): Promise<{ background: string | null; structures: string | null }>;
  /** One of Ranked's backgrounds (menu, menu_sharp, or a seed type) as a data URL */
  rankedArt(key: string): Promise<string | null>;
  /** Menu backgrounds saved from older Ranked releases */
  oldArt(): Promise<OldArt[]>;
  /** Go online and look through older Ranked releases for their menu backgrounds */
  fetchOldArt(): Promise<OldArt[]>;
  /** Player skin PNG as a data URL */
  skin(who: { uuid?: string | null; name?: string | null }): Promise<string | null>;
  /** pool = how many of your newest Ranked matches the split times come from */
  profile(season?: number, pool?: number): Promise<ProfileData>;
  profileMatch(id: number): Promise<MatchDetail | null>;
  profileRefresh(season?: number, pool?: number): Promise<ProfileData>;
  copy(text: string): Promise<void>;
  reveal(file: string): Promise<void>;
  openDir(file: string): Promise<void>;
  companion(id: number | null): Promise<void>;
  openInMinecraft(file: string): Promise<{ ok: boolean; message: string }>;
  theme(): Promise<{ css: string; file: string; found: boolean }>;
  onTheme(fn: (css: string) => void): void;
  onState(fn: (s: AppState) => void): void;
  onCompanionRace(fn: (id: number | null) => void): void;
  onOpenRace(fn: (id: number) => void): void;
  onNewGame(fn: (g: { id: number | null; title: string; body: string }) => void): void;
}

/** Looked up on use so the browser preview can install its mock first */
export const g: Bridge = new Proxy({} as Bridge, { get: (_t, k) => (window as unknown as { stratas: Record<string | symbol, unknown> }).stratas[k] });
export type { AppState, Settings, RaceAnalysis, Pick, PickOptions, QueueRow, RaceRow, ProfileData, MatchDetail };
