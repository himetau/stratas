// Notes from run stats (precrafts, wood, pearls on the way, blaze bed, zero setup, trades) for a phase
import type { Note, Side, Span } from "./findings";
import { fmtDur } from "./names";
import { dragonFight } from "./end";
import {
  blastText, blazeBedBlasts, extraBarters, itemsText, pearlsThrown, precrafts, PRECRAFT_LABEL, tradeSummary, woodGrabbed, zeroSetup, zeroText,
  type Precraft, type PrecraftKind,
} from "./stats";

const dur = (t: number) => fmtDur(t / 20);
const inSpan = (t: number, sp: Span) => !!sp && t >= sp[0] && t < sp[1];

export function statNotes(phase: string, Y: Side, T: Side, ys: Span, ts: Span): Note[] {
  const N = T.run.name, out: Note[] = [];

  if (phase === "Overworld") {
    const y = woodGrabbed(Y.run), t = woodGrabbed(T.run);
    if (y.logs || y.leaves || t.logs || t.leaves) out.push({ text: `Wood: ${y.logs} logs, ${y.leaves} leaves vs ${t.logs} logs, ${t.leaves} leaves`, seconds: null });
  }

  if (phase === "Bastion") out.push(...tradeNotes(Y, T, N));

  if (phase === "Bastion to fortress") {
    const p = (s: Side) => { const l = s.run.mark("bastion_left"), f = s.run.mark("fortress"); return l !== undefined && f !== undefined && f > l ? pearlsThrown(s.run, l, f) : null; };
    const y = p(Y), t = p(T);
    if (y || t) out.push({ text: `Pearls to the fortress: ${y?.length ?? "—"} vs ${t?.length ?? "—"}`, seconds: null, at: { you: y?.[0], them: t?.[0] } });
  }

  if (phase === "Fortress" || phase === "Fortress to stronghold") {
    const y = blazeBedBlasts(Y), t = blazeBedBlasts(T);
    if (y.length || t.length) out.push({ text: `Blaze bed: ${blastText(y)} vs ${blastText(t)}`, seconds: null, at: { you: y[0]?.t, them: t[0]?.t } });
  }

  // Precrafts that started in this phase, by kind
  const yp = precrafts(Y).filter((p) => inSpan(p.t0, ys)), tp = precrafts(T).filter((p) => inSpan(p.t0, ts));
  for (const kind of ["bastion", "fort", "stronghold"] as PrecraftKind[]) {
    const a = yp.filter((p) => p.kind === kind), b = tp.filter((p) => p.kind === kind);
    if (!a.length && !b.length) continue;
    const secs = (xs: Precraft[]) => (xs.length ? `${Math.round(xs.reduce((s, p) => s + p.secs, 0))} s${xs.length > 1 ? ` in ${xs.length} goes` : ""}` : "—");
    out.push({ text: `${PRECRAFT_LABEL[kind]}: ${secs(a)} vs ${secs(b)}`,
      seconds: null, at: { you: a[0]?.t0, them: b[0]?.t0 } });
  }

  if (phase === "End") {
    const fy = ys ? dragonFight(Y, ys) : null, ft = ts ? dragonFight(T, ts) : null;
    const y = zeroSetup(Y, fy), t = zeroSetup(T, ft);
    if (y || t) {
      out.push({ text: `First bed: ${y ? zeroText(y) : "—"} vs ${t ? zeroText(t) : "—"}`, seconds: null, at: { you: y?.first, them: t?.first } });
      const gap = (z: typeof y) => (z && z.setupDone !== null ? dur(z.first - z.setupDone) : "—");
      out.push({ text: `Last setup block to first bed: ${gap(y)} vs ${gap(t)}`, seconds: null, at: { you: y?.setupDone ?? undefined, them: t?.setupDone ?? undefined } });
    }
  }

  return out;
}

function tradeNotes(Y: Side, T: Side, N: string): Note[] {
  const y = tradeSummary(Y.run), t = tradeSummary(T.run);
  if (!y && !t) return [];
  const out: Note[] = [];
  out.push({ text: `Trades: ${y?.barters.length ?? 0} vs ${t?.barters.length ?? 0}`, seconds: null });
  if (y && t && t.barters.length > y.barters.length) {
    const extra = itemsText(extraBarters(y.barters, t.barters));
    if (extra) out.push({ text: `${N}'s ${t.barters.length - y.barters.length} extra trades gave ${extra}`, seconds: null, at: { them: t.barters[y.barters.length].t } });
  } else if (y && t && y.barters.length > t.barters.length) {
    const extra = itemsText(extraBarters(t.barters, y.barters));
    if (extra) out.push({ text: `Your ${y.barters.length - t.barters.length} extra trades gave ${extra}`, seconds: null, at: { you: y.barters[t.barters.length].t } });
  }
  const leftOnGround = (s: typeof y) => (s ? itemsText(s.left, ["ender_pearl", "obsidian", "crying_obsidian", "string", "fire_res"]) || "nothing" : "—");
  if (y || t) out.push({ text: `Left on the ground: ${leftOnGround(y)} vs ${leftOnGround(t)}`, seconds: null });
  // How many of your trades what you used later took, and how long you stayed after
  const used = (s: typeof y, side: Side) => {
    if (!s) return "—";
    if (s.noneNeeded) return "none needed";
    if (!s.needed) return `? of ${s.barters.length}`;
    const late = side.run.mark("bastion_left")! - s.needed.t;
    return `${s.needed.n} of ${s.barters.length}${s.needed.n < s.barters.length ? ` (left ${dur(late)} later)` : ""}`;
  };
  out.push({ text: `Trades used: ${used(y, Y)} vs ${used(t, T)}`, seconds: null, at: { you: y?.needed?.t, them: t?.needed?.t } });
  return out;
}
