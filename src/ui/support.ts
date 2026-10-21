// Supporting Stratas: the Ko-fi link, and a small popup that asks at most twice, never on a first run.
// First once you've used it a while (2 hours open, 3 races opened, or 5 launches with 15 minutes of use),
// then "Can I have a donut?" 3 days after that. Going to Ko-fi from anywhere stops them for good
import { h } from "./dom";
import { prefs, savePrefs, still } from "./prefs";

export const KOFI_URL = "https://ko-fi.com/cyoshi";
export const DISCORD_URL = "https://discord.gg/K3NxjhJRD";

const MIN = 60_000, DAY = 86_400_000;

export function openKofi() {
  window.open(KOFI_URL, "_blank", "noopener");
  if (!prefs().supportClicked) savePrefs({ supportClicked: true });
}

// Usage counters tick often, so they live in local storage instead of settings (saving those redraws the app)
type Use = { ms: number; launches: number; races: number };
const load = (): Use => { try { return { ms: 0, launches: 0, races: 0, ...JSON.parse(localStorage.getItem("support.use") ?? "{}") }; } catch { return { ms: 0, launches: 0, races: 0 }; } };
const save = (u: Use) => { try { localStorage.setItem("support.use", JSON.stringify(u)); } catch { /* Fine */ } };

/** Count this launch, then count time while the window is in front, checking once a minute whether to ask */
export function trackUsage() {
  const u = load();
  u.launches++;
  save(u);
  setInterval(() => {
    if (document.visibilityState !== "visible" || !document.hasFocus()) return;
    const v = load();
    v.ms += MIN;
    save(v);
    maybeAskSupport();
  }, MIN);
}

/** Opening a race counts toward the first ask */
export function noteRaceOpened() {
  const u = load();
  u.races++;
  save(u);
  // After a pause so it doesn't cover the race as it opens
  setTimeout(maybeAskSupport, 4000);
}

export function maybeAskSupport() {
  const p = prefs(), u = load();
  if (p.supportClicked || document.querySelector(".support-pop")) return;
  const settled = u.ms >= 120 * MIN || u.races >= 3 || (u.launches >= 5 && u.ms >= 15 * MIN);
  if (p.supportAsked === 0 && settled) show(0);
  else if (p.supportAsked === 1 && Date.now() - p.supportLastAsked >= 3 * DAY) show(1);
}

const ASKS = [
  { title: "Support me? 🥺", button: "☕ Buy me a coffee" },
  { title: "Can I have a donut? 🍩", button: "🍩 Buy me a donut" },
];

function show(i: number) {
  savePrefs({ supportAsked: i + 1, supportLastAsked: Date.now() });
  const close = () => { pop.classList.remove("show"); setTimeout(() => pop.remove(), still() ? 0 : 200); };
  const pop = h("div", { class: "support-pop", role: "dialog", "aria-label": "Support Stratas" },
    h("button", { class: "x", "aria-label": "Close", onclick: close }, "×"),
    h("b", null, ASKS[i].title),
    h("div", { class: "row" },
      h("button", { class: "btn kofi", onclick: () => { openKofi(); close(); } }, ASKS[i].button),
      h("button", { class: "btn ghost", onclick: close }, "maybe later")));
  document.body.appendChild(pop);
  requestAnimationFrame(() => pop.classList.add("show"));
}
