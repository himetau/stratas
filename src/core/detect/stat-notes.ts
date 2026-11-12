import type { Note, Side, Span } from "./findings";
import { fmtDur } from "./names";
import { dragonFight } from "./end";
import {
  blastText,
  blazeBedBlasts,
  extraBarters,
  itemsText,
  pearlsThrown,
  precrafts,
  PRECRAFT_LABEL,
  tradeSummary,
  woodGrabbed,
  zeroSetup,
  zeroText,
  type Precraft,
  type PrecraftKind,
  type TradeSummary,
  type ZeroSetup,
} from "./stats";

const dur = (t: number) => fmtDur(t / 20);
const inSpan = (t: number, sp: Span) => !!sp && t >= sp[0] && t < sp[1];

const PRECRAFT_KINDS: PrecraftKind[] = ["bastion", "fort", "stronghold"];

/** "12 s", or "20 s in 2 goes" for several precrafts */
const precraftTime = (xs: Precraft[]) => {
  if (!xs.length) {
    return "—";
  }
  const total = Math.round(xs.reduce((s, p) => s + p.secs, 0));
  return `${total} s${xs.length > 1 ? ` in ${xs.length} goes` : ""}`;
};

/** Notes from run stats for a phase: wood, trades, pearls, blaze bed, precrafts and zero setup */
export function statNotes(phase: string, Y: Side, T: Side, ys: Span, ts: Span): Note[] {
  const out: Note[] = [];

  if (phase === "Overworld") {
    const y = woodGrabbed(Y.run);
    const t = woodGrabbed(T.run);
    if (y.logs || y.leaves || t.logs || t.leaves) {
      out.push({
        text: `Wood: ${y.logs} logs, ${y.leaves} leaves vs ${t.logs} logs, ${t.leaves} leaves`,
        seconds: null,
      });
    }
  }

  if (phase === "Bastion") {
    out.push(...tradeNotes(Y, T));
  }

  if (phase === "Bastion to fortress") {
    const pearlsToFortress = (s: Side) => {
      const l = s.run.mark("bastion_left");
      const f = s.run.mark("fortress");
      return l !== undefined && f !== undefined && f > l ? pearlsThrown(s.run, l, f) : null;
    };
    const y = pearlsToFortress(Y);
    const t = pearlsToFortress(T);
    if (y || t) {
      out.push({
        text: `Pearls to the fortress: ${y?.length ?? "—"} vs ${t?.length ?? "—"}`,
        seconds: null,
        at: { you: y?.[0], them: t?.[0] },
      });
    }
  }

  if (phase === "Fortress" || phase === "Fortress to stronghold") {
    const y = blazeBedBlasts(Y);
    const t = blazeBedBlasts(T);
    if (y.length || t.length) {
      out.push({
        text: `Blaze bed: ${blastText(y)} vs ${blastText(t)}`,
        seconds: null,
        at: { you: y[0]?.t, them: t[0]?.t },
      });
    }
  }

  const yp = precrafts(Y).filter((p) => inSpan(p.t0, ys));
  const tp = precrafts(T).filter((p) => inSpan(p.t0, ts));
  for (const kind of PRECRAFT_KINDS) {
    const a = yp.filter((p) => p.kind === kind);
    const b = tp.filter((p) => p.kind === kind);
    if (!a.length && !b.length) {
      continue;
    }
    out.push({
      text: `${PRECRAFT_LABEL[kind]}: ${precraftTime(a)} vs ${precraftTime(b)}`,
      seconds: null,
      at: { you: a[0]?.t0, them: b[0]?.t0 },
    });
  }

  if (phase === "End") {
    const fy = ys ? dragonFight(Y, ys) : null;
    const ft = ts ? dragonFight(T, ts) : null;
    const y = zeroSetup(Y, fy);
    const t = zeroSetup(T, ft);
    if (y || t) {
      out.push({
        text: `First bed: ${y ? zeroText(y) : "—"} vs ${t ? zeroText(t) : "—"}`,
        seconds: null,
        at: { you: y?.first, them: t?.first },
      });
      const gap = (z: ZeroSetup | null) =>
        z && z.setupDone !== null ? dur(z.first - z.setupDone) : "—";
      out.push({
        text: `Last setup block to first bed: ${gap(y)} vs ${gap(t)}`,
        seconds: null,
        at: { you: y?.setupDone ?? undefined, them: t?.setupDone ?? undefined },
      });
    }
  }

  return out;
}

/** "3 of 5 (left 12 s later)": how many of your trades what you used later took */
function tradesUsedText(s: TradeSummary | null, side: Side): string {
  if (!s) {
    return "—";
  }
  if (s.noneNeeded) {
    return "none needed";
  }
  if (!s.needed) {
    return `? of ${s.barters.length}`;
  }
  const late = side.run.mark("bastion_left")! - s.needed.t;
  const stayed = s.needed.n < s.barters.length ? ` (left ${dur(late)} later)` : "";
  return `${s.needed.n} of ${s.barters.length}${stayed}`;
}

const leftOnGroundText = (s: TradeSummary | null) => {
  if (!s) {
    return "—";
  }
  return (
    itemsText(s.left, ["ender_pearl", "obsidian", "crying_obsidian", "string", "fire_res"]) ||
    "nothing"
  );
};

function tradeNotes(Y: Side, T: Side): Note[] {
  const y = tradeSummary(Y.run);
  const t = tradeSummary(T.run);
  if (!y && !t) {
    return [];
  }
  const out: Note[] = [];
  out.push({
    text: `Trades: ${y?.barters.length ?? 0} vs ${t?.barters.length ?? 0}`,
    seconds: null,
  });
  if (y && t && y.barters.length !== t.barters.length) {
    const yoursMore = y.barters.length > t.barters.length;
    const more = yoursMore ? y : t;
    const fewer = yoursMore ? t : y;
    const extra = itemsText(extraBarters(fewer.barters, more.barters));
    if (extra) {
      const who = yoursMore ? "Your" : `${T.run.name}'s`;
      const firstExtra = more.barters[fewer.barters.length].t;
      out.push({
        text: `${who} ${more.barters.length - fewer.barters.length} extra trades gave ${extra}`,
        seconds: null,
        at: yoursMore ? { you: firstExtra } : { them: firstExtra },
      });
    }
  }
  out.push({
    text: `Left on the ground: ${leftOnGroundText(y)} vs ${leftOnGroundText(t)}`,
    seconds: null,
  });
  out.push({
    text: `Trades used: ${tradesUsedText(y, Y)} vs ${tradesUsedText(t, T)}`,
    seconds: null,
    at: { you: y?.needed?.t, them: t?.needed?.t },
  });
  return out;
}
