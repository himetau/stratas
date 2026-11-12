import { g } from "./bridge";
import { rankOf } from "../core/tiers";
import { h, toast } from "./dom";

type Kid = Parameters<typeof h>[2];

export function panel(
  title: string | null,
  opts: { right?: Kid; cls?: string } | null,
  ...kids: Kid[]
) {
  return h(
    "section",
    { class: `card ${opts?.cls ?? ""}` },
    title || opts?.right
      ? h(
          "div",
          { class: "card-head" },
          title ? h("h2", null, title) : h("span"),
          opts?.right ?? null,
        )
      : null,
    ...kids,
  );
}

/** Collapsible panel with the tetr chevron */
export function fold(title: Kid, open: boolean, cls: string, ...kids: Kid[]) {
  return h(
    "details",
    { class: `card ${cls}`, open },
    h("summary", { class: "card-head" }, title, h("span", { class: "chevron" }, "›")),
    ...kids,
  );
}

export function btn(
  label: string,
  onclick: () => void,
  o: {
    key?: string;
    primary?: boolean;
    ghost?: boolean;
    danger?: boolean;
    sm?: boolean;
    disabled?: boolean;
  } = {},
) {
  if (o.key && !o.disabled) {
    bindKey(o.key, onclick);
  }
  return h(
    "button",
    {
      class: ["btn", o.primary && "primary", o.ghost && "ghost", o.danger && "danger", o.sm && "sm"]
        .filter(Boolean)
        .join(" "),
      onclick,
      disabled: o.disabled,
    },
    label,
    o.key ? h("span", { class: "kbd" }, o.key === "Escape" ? "ESC" : o.key.toUpperCase()) : null,
  );
}

export const copy = (text: string, what: string) => {
  void g.copy(text);
  toast(`${what} copied`);
};

export async function openInMinecraft(file: string) {
  const r = await g.openInMinecraft(file);
  const launch = r.canLaunch && confirm("Ranked isn't running. Launch it now?");
  toast(launch ? (await g.launchRanked()).message : r.message, 6000);
}

export function copyField(k: string, v: string, key?: string, onCopy?: () => void) {
  return h(
    "div",
    { class: "field" },
    h("span", { class: "k" }, k),
    h("span", { class: "v" }, v),
    btn(
      "Copy",
      () => {
        copy(v, k);
        onCopy?.();
      },
      { sm: true, key },
    ),
  );
}

let activeKeys = new Map<string, () => void>();
let pendingKeys = new Map<string, () => void>();

/**
 * Binds a shortcut for the page being rendered.
 * It takes effect at commitKeys, which drops the previous page's shortcuts.
 */
export function bindKey(key: string, fn: () => void) {
  pendingKeys.set(key.toLowerCase(), fn);
}
export function commitKeys() {
  activeKeys = pendingKeys;
  pendingKeys = new Map();
}

export const isTypingIn = (target: EventTarget | null) =>
  !!(target as HTMLElement).closest("input, select, textarea");

export function handleKey(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey || isTypingIn(e.target)) {
    return false;
  }
  const fn = activeKeys.get(e.key.toLowerCase());
  if (!fn) {
    return false;
  }
  e.preventDefault();
  fn();
  return true;
}

let rankIcons: Record<string, string> = {};
export const setRankIcons = (x: Record<string, string>) => {
  rankIcons = x;
};

const TIER_NAME: Record<string, string> = {
  next: "Emerald",
  stretch: "Diamond",
  ceiling: "Netherite",
  manual: "custom",
  player: "by name",
};

/** Name of the level a run was picked from */
export const tierName = (tier: string | null | undefined): string => TIER_NAME[tier ?? ""] ?? "";

/** In-game rank icon + Elo, rank name in the tooltip */
export function rank(elo: number | null | undefined, cls = "") {
  const r = rankOf(elo);
  const icon = rankIcons[r.key];
  return h(
    "span",
    { class: `rank ${cls}`, title: r.name },
    icon ? h("img", { src: icon, alt: r.name }) : null,
    h("span", null, elo != null ? String(elo) : r.name),
  );
}

const skins = new Map<string, Promise<HTMLImageElement | null>>();
const decoded = new Map<string, HTMLImageElement>();

function loadSkin(key: string, url: string | null): Promise<HTMLImageElement | null> | null {
  if (!url) {
    return null;
  }
  return new Promise((done) => {
    const img = new Image();
    img.onload = () => {
      decoded.set(key, img);
      done(img);
    };
    img.onerror = () => done(null);
    img.src = url;
  });
}

/** Player head drawn from the face and hat layers of their skin */
export function head(who: { uuid?: string | null; name: string }, size = 24) {
  const c = h("canvas", {
    class: "head",
    width: 8,
    height: 8,
    style: `width:${size}px;height:${size}px`,
    title: who.name,
  });
  const key = `${who.uuid ?? ""}|${who.name.toLowerCase()}`;
  const paint = (img: HTMLImageElement) => {
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 8, 8);
    ctx.drawImage(img, 40, 8, 8, 8, 0, 0, 8, 8);
    c.classList.add("ok");
  };
  const ready = decoded.get(key);
  if (ready) {
    paint(ready);
    return c;
  }
  let p = skins.get(key);
  if (!p) {
    p = g
      .skin({ uuid: who.uuid ?? null, name: who.name })
      .catch(() => null)
      .then((url) => loadSkin(key, url));
    skins.set(key, p);
  }
  void p.then((img) => {
    if (img) {
      paint(img);
    }
  });
  return c;
}
