// motion3 big moments (2026-11-27, owner: "सब अच्छे हैं"). Visual only: nothing
// here reads or writes ERP data, and nothing waits for an animation.
//
// installBigMoments() — one document MutationObserver that ONLY listens to two
// attributes screens put on themselves:
//   data-step-glide="<index>"  (Machine Tracker card stepper) — when the index
//       goes up by one on a card that has been on screen for a while (a real
//       hand-over, not the first data load), a token glides from the old step
//       to the new one (360 ms) and the new step pops (200 ms).
//   data-ready-count="<n>"     (Machine Tracker "Ready" tile) — when it goes up,
//       a short sparkle around the tile (< 800 ms) and the number pops.
//   data-slot-state="empty|…"  (Production Rack View crate) — when a slot goes
//       from empty to filled, it fills up from the bottom in its rack colour
//       (360 ms) with a "✓ Filled" badge, then the wash fades (B2, 2026-11-27).
// Also, the first time Rack View shows in a page load, every EMPTY slot gives
// one soft pulse ("these still need parts").
// A change in the first 3 s after the screen mounts (installBigMoments() is
// called on every mount) is ignored: that is data arriving, not a hand-over.
// Reduced motion: nothing. Phones get the same (it is one small element).
import { prefersReducedMotion } from "./viewTransition.js";
import { claimFirstShow } from "./firstShow.js";
import "./motion3-big.css";

const SETTLE_MS = 3000;
let mountedAt = 0;

function circles(row) {
  // each step: <div.flex-1> → <div.flex-col> → first child = the circle
  return Array.from(row.children, (s) => s.firstElementChild && s.firstElementChild.firstElementChild).filter(Boolean);
}

function glide(row, from, to) {
  const cs = circles(row);
  const a = cs[from], b = cs[to];
  if (!a || !b) return;
  const host = row.parentElement;                         // .mt-card-stages
  if (getComputedStyle(host).position === "static") host.style.position = "relative";
  const hr = host.getBoundingClientRect(), ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
  const t = document.createElement("span");
  t.className = "wu-glide-token"; t.setAttribute("aria-hidden", "true");
  t.style.left = `${ar.left - hr.left}px`; t.style.top = `${ar.top - hr.top}px`;
  t.style.width = `${ar.width}px`; t.style.height = `${ar.height}px`;
  t.style.setProperty("--gx", `${br.left - ar.left}px`);
  t.style.color = getComputedStyle(b).borderTopColor;
  host.appendChild(t);
  b.classList.remove("wu-glide-pop"); void b.offsetWidth;
  b.classList.add("wu-glide-pop");
  const done = () => t.remove();
  t.addEventListener("animationend", done, { once: true });
  setTimeout(done, 700);
}

function sparkle(tile) {
  tile.classList.remove("wu-spark-host"); void tile.offsetWidth; tile.classList.add("wu-spark-host");
  const COLORS = ["#f59e0b", "#22c55e", "#facc15"];
  for (let i = 0; i < 10; i++) {
    const s = document.createElement("i");
    s.className = "wu-spark"; s.setAttribute("aria-hidden", "true");
    const ang = (i / 10) * Math.PI * 2 + 0.3, r = 58 + (i % 3) * 12;
    s.style.setProperty("--dx", `${Math.cos(ang) * r}px`);
    s.style.setProperty("--dy", `${Math.sin(ang) * r * 0.7}px`);
    s.style.setProperty("--c", COLORS[i % 3]);
    s.style.animationDelay = `${(i % 4) * 30}ms`;
    tile.appendChild(s);
    setTimeout(() => s.remove(), 1000);
  }
  setTimeout(() => tile.classList.remove("wu-spark-host"), 1000);
}

function slotFill(crate) {
  crate.classList.remove("wu-slot-filling"); void crate.offsetWidth;
  crate.classList.add("wu-slot-filling");
  const fill = document.createElement("i"); fill.className = "wu-slot-fill"; fill.setAttribute("aria-hidden", "true");
  const badge = document.createElement("span"); badge.className = "wu-slot-badge"; badge.setAttribute("aria-hidden", "true"); badge.textContent = "✓ Filled";
  crate.append(fill, badge);
  setTimeout(() => { fill.remove(); badge.remove(); crate.classList.remove("wu-slot-filling"); }, 1500);
}

function pulseEmptySlots() {
  if (prefersReducedMotion() || !claimFirstShow("rack-empty-pulse")) return;
  setTimeout(() => {
    document.querySelectorAll('.rack-crate[data-slot-state="empty"]').forEach((c) => {
      c.classList.add("wu-slot-pulse");
      setTimeout(() => c.classList.remove("wu-slot-pulse"), 500);
    });
  }, 400);
}

export function installBigMoments() {
  if (typeof document === "undefined" || typeof MutationObserver !== "function") return;
  mountedAt = performance.now();
  try { pulseEmptySlots(); } catch { /* decoration only */ }
  if (window.__wuBigMoments) return;
  window.__wuBigMoments = true;
  new MutationObserver((list) => {
    if (performance.now() - mountedAt < SETTLE_MS || prefersReducedMotion()) return;
    for (const m of list) {
      const el = m.target;
      if (m.attributeName === "data-slot-state") {
        if (m.oldValue === "empty" && el.getAttribute("data-slot-state") !== "empty") { try { slotFill(el); } catch { /* decoration only */ } }
        continue;
      }
      const old = Number(m.oldValue), now = Number(el.getAttribute(m.attributeName));
      if (m.oldValue == null || !Number.isFinite(old) || !Number.isFinite(now) || now <= old) continue;
      try {
        if (m.attributeName === "data-step-glide" && now - old === 1 && old >= 0) glide(el, old, now);
        if (m.attributeName === "data-ready-count") sparkle(el);
      } catch { /* decoration must never break anything */ }
    }
  }).observe(document.body, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["data-step-glide", "data-ready-count", "data-slot-state"] });
}
