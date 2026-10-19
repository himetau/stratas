// Small DOM helpers
type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, unknown> & { class?: string; style?: string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === "class") el.className = String(v);
    else if (k === "style") el.setAttribute("style", String(v));
    else if (k in el && typeof v !== "string") (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function mount(target: HTMLElement, ...children: Child[]) {
  target.replaceChildren();
  append(target, children);
}

export function toast(msg: string, ms = 2200) {
  const t = h("div", { class: "toast" }, msg);
  document.body.appendChild(t);
  setTimeout(() => t.classList.add("show"), 10);
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, ms);
}

export const fmtClock = (ticks: number) => {
  const s = Math.max(0, Math.round(ticks / 20));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
export const fmtMs = (ms: number) => fmtClock(ms / 50);
export { clockSec, fmtDur } from "../core/detect/names";
/** LiveSplit style delta: + behind and − ahead, tenths under a minute, m:ss above */
export function fmtDelta(s: number): string {
  const a = Math.abs(s);
  const r = Math.round(a);
  const body = a < 59.95 ? a.toFixed(1) : `${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`;
  return `${s > 0.05 ? "+" : s < -0.05 ? "−" : "±"}${body}`;
}
export const deltaClass = (s: number) => (s > 0.05 ? "bad" : s < -0.05 ? "good" : "dim");
export const ago = (unixSeconds: number) => {
  const m = Math.round((Date.now() / 1000 - unixSeconds) / 60);
  if (m < 60) return `${m} min ago`;
  const hr = Math.round(m / 60);
  return hr < 48 ? `${hr} h ago` : `${Math.round(hr / 24)} days ago`;
};
export const nice = (s: string | null | undefined) => (s ? s.toLowerCase().replace(/_/g, " ") : "any");
