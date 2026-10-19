// Dragon fight from Ranked's dragon records. Perches, beds that hit, failed cycles, death (Free the End), run done
import type { Side, Span } from "./findings";
import { fmtDur, fmtTime } from "./names";

/** Vanilla 1.16 dragon phases as Ranked logs them */
const LANDING = 3, TAKEOFF = 4;

export interface Perch { t0: number; t1: number; beds: number; hp0: number; hp1: number; killed: boolean }
export interface DragonFight {
  /** Entering the End */
  start: number;
  /** Beds that went off in the End */
  beds: number[];
  crystals: number;
  perches: Perch[];
  /** Beds before the first perch, so a zero cycle or a try at one */
  zeroBeds: number;
  zero: boolean;
  /** Dragon at 0 HP (Free the End) */
  kill: number | null;
  /** Ranked's "Defeated the Dragon", run is complete */
  done: number | null;
}

export function dragonFight(s: Side, sp: Span): DragonFight | null {
  if (!sp) return null;
  const [a, b] = [sp[0], Math.max(sp[1], s.run.end)];
  const ev = s.run.events.filter((e) => e.t >= a && e.t <= b);
  // Health is a byte offset by 128, so 200 HP is 72 and 0 HP is 128
  const hp = ev.filter((e) => e.type === "DRAGON_HEALTH").map((e) => ({ t: e.t, hp: ((e.value ?? 0) + 128) & 255 }));
  const phases = ev.filter((e) => e.type === "DRAGON_PHASE").map((e) => ({ t: e.t, v: e.value ?? 0 }));
  const beds = ev.filter((e) => e.type === "EXPLOSION" && e.world === 2 && e.power === 5).map((e) => e.t);
  const crystals = ev.filter((e) => e.type === "CRYSTAL_DESTROY").length;
  const kill = hp.find((x) => x.hp === 0)?.t ?? null;
  const hpAt = (t: number) => hp.filter((x) => x.t <= t).at(-1)?.hp ?? 200;

  const perches: Perch[] = [];
  for (const p of phases.filter((x) => x.v === LANDING)) {
    if (kill !== null && p.t > kill) break;
    const off = phases.find((x) => x.t > p.t && x.v === TAKEOFF)?.t ?? null;
    const killed = kill !== null && (off === null || kill <= off);
    const t1 = killed ? kill! : off ?? b;
    perches.push({ t0: p.t, t1, beds: beds.filter((t) => t >= p.t && t <= t1).length, hp0: hpAt(p.t - 1), hp1: hpAt(t1), killed });
  }
  const firstPerch = perches[0]?.t0 ?? Infinity;
  const zeroBeds = beds.filter((t) => t < firstPerch).length;
  return { start: a, beds, crystals, perches, zeroBeds, zero: kill !== null && kill < firstPerch, kill, done: s.run.finished ? s.run.mark("finish") ?? s.run.end : null };
}

/** "zero cycle", "one cycle", "failed zero, then a 3rd-perch kill" */
export function cycleName(f: DragonFight): string {
  if (f.zero) return "zero cycle";
  const killedOn = f.perches.findIndex((p) => p.killed) + 1;
  const tried = f.zeroBeds ? "failed zero, then " : "";
  if (!killedOn) return f.kill !== null ? `${tried}killed off the perch` : `${tried}dragon not killed`;
  return killedOn === 1 ? `${tried}one cycle` : `${tried}killed on perch ${killedOn} (${killedOn - 1} failed)`;
}

/** What happened at each perch, in a few words */
export function perchLines(f: DragonFight): { text: string; t: number }[] {
  const out: { text: string; t: number }[] = [];
  if (f.zeroBeds && !f.zero) out.push({ text: `zero cycle attempt: ${f.zeroBeds} bed${f.zeroBeds === 1 ? "" : "s"}, dragon survived`, t: f.beds[0] });
  f.perches.forEach((p, i) => {
    const beds = p.beds ? `${p.beds} bed${p.beds === 1 ? "" : "s"}` : "no beds";
    out.push({ text: `perch ${i + 1}, ${fmtTime(p.t0 - f.start)} into the End: ${beds}, ${p.killed ? "killed it" : `took off with ${p.hp1} HP`}`, t: p.t0 });
  });
  return out;
}

/** End time split at the fight milestones for both of you. Null unless both killed it */
export function endParts(Y: DragonFight | null, T: DragonFight | null) {
  if (!Y || !T || Y.kill === null || T.kill === null || Y.done === null || T.done === null) return null;
  const ms = (f: DragonFight) => [f.start, f.kill!, f.done!];
  const y = ms(Y), t = ms(T);
  const parts = [
    { key: "end_kill", label: "Killing the dragon" },
    { key: "end_after", label: "Free the End" },
  ];
  return parts.map((p, i) => {
    const dy = (y[i + 1] - y[i]) / 20, dt = (t[i + 1] - t[i]) / 20;
    return { ...p, seconds: dy - dt, text: `${fmtDur(dy)} vs ${fmtDur(dt)}`, at: { you: y[i], them: t[i] } };
  });
}
