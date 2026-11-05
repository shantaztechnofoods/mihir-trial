// World UI motion helpers (2026-11-04). Visual only — nothing here reads or
// writes ERP data, and nothing waits for an animation before an action runs.
//
// celebrate(label, { big })  a check-seal pop (0.9 s) for the rare moments:
//                    machine accepted, sent on, Ready. Confetti only with
//                    { big: true } (machine Ready). Never on repeated per-item
//                    actions. Reduced motion / cheap phone (wu-lite): no confetti.
//                    No vibration here: the success toast (shared/ui/toast.js)
//                    gives the one 10 ms haptic tick.
// installLiteMode()  html.wu-lite on low-memory / data-saver phones: CSS drops
//                    blur and confetti there (world-ui.css / mtMotion.css).
// installSheetGestures()  on a phone, a dialog panel can be dragged down by its
//                    header and let go to close: it presses the dialog's own
//                    Close / Cancel button, so the existing close rules apply
//                    (a busy dialog keeps its disabled close and stays open).

const reduced = () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
const COLORS = ["#15803D", "#2E50D6", "#E8962E", "#4F3FC4", "#22A05A", "#8FA6FF"];

export function isLiteDevice(nav = typeof navigator !== "undefined" ? navigator : undefined, win = typeof window !== "undefined" ? window : undefined) {
  try {
    if (win && win.matchMedia && win.matchMedia("(prefers-reduced-data: reduce)").matches) return true;
    if (!nav) return false;
    if (nav.connection && nav.connection.saveData) return true;
    return typeof nav.deviceMemory === "number" && nav.deviceMemory <= 2;
  } catch { return false; }
}

export function installLiteMode() {
  try { if (typeof document !== "undefined" && isLiteDevice()) document.documentElement.classList.add("wu-lite"); } catch { /* ignore */ }
}

export function celebrate(label = "Done", { big = false } = {}) {
  if (typeof document === "undefined" || !document.body) return;
  try {
    const root = document.createElement("div");
    root.className = "wu-celebrate"; root.setAttribute("aria-hidden", "true");
    const seal = document.createElement("div"); seal.className = "wu-seal";
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    [["viewBox", "0 0 24 24"], ["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "2.6"], ["stroke-linecap", "round"], ["stroke-linejoin", "round"]].forEach(([k, v]) => svg.setAttribute(k, v));
    const path = document.createElementNS(NS, "path"); path.setAttribute("d", "M5 12.5l4.5 4.5L19 7.5"); svg.appendChild(path);
    seal.appendChild(svg);
    const t = document.createElement("span"); t.textContent = String(label).slice(0, 18); seal.appendChild(t);
    root.appendChild(seal);
    if (big && !reduced() && !isLiteDevice()) {
      for (let i = 0; i < 26; i++) {
        const c = document.createElement("i"); c.className = "wu-confetti";
        const a = (Math.PI * 2 * i) / 26 + Math.random() * 0.4; const r = 90 + Math.random() * 90;
        c.style.setProperty("--dx", `${Math.cos(a) * r}px`); c.style.setProperty("--dy", `${Math.sin(a) * r - 30}px`);
        c.style.setProperty("--rot", `${Math.round(Math.random() * 540 - 270)}deg`);
        c.style.background = COLORS[i % COLORS.length]; c.style.animationDelay = `${90 + Math.random() * 80}ms`;
        root.appendChild(c);
      }
    }
    document.body.appendChild(root);
    setTimeout(() => { try { root.remove(); } catch { /* gone */ } }, big ? 1250 : 950);
  } catch { /* decoration must never break an action */ }
}

export function installSheetGestures() {
  if (typeof window === "undefined" || window.__wuSheetGestures) return;
  window.__wuSheetGestures = true;
  let drag = null;
  const isPhone = () => window.innerWidth < 768;
  const closeBtnOf = (panel) =>
    panel.querySelector(".modal-x, [aria-label='Close'], [data-my-dashboard-close]")
    || Array.from(panel.querySelectorAll("button")).find((b) => /^(Cancel|Close)$/.test((b.textContent || "").trim()));
  document.addEventListener("pointerdown", (e) => {
    if (!isPhone() || e.button > 0) return;
    const panel = e.target.closest && e.target.closest(".modal-backdrop > div");
    if (!panel) return;
    if (e.target.closest("button, input, textarea, select, a, canvas, [contenteditable], [data-signature-pad]")) return;
    const r = panel.getBoundingClientRect();
    if (e.clientY - r.top > 64) return;              // header / grabber zone only
    drag = { panel, y0: e.clientY, t0: performance.now(), dy: 0 };
  }, { passive: true });
  document.addEventListener("pointermove", (e) => {
    if (!drag) return;
    drag.dy = Math.max(0, e.clientY - drag.y0);
    drag.panel.style.transition = "none";
    drag.panel.style.transform = `translateY(${drag.dy}px)`;
  }, { passive: true });
  const end = () => {
    if (!drag) return;
    const { panel, dy, t0 } = drag; drag = null;
    const v = dy / Math.max(1, performance.now() - t0);   // px per ms
    const btn = closeBtnOf(panel);
    panel.style.transition = "transform 320ms cubic-bezier(.32,.72,0,1)";
    if ((dy > 120 || (dy > 40 && v > 0.6)) && btn && !btn.disabled) {
      panel.style.transform = "translateY(100%)";
      setTimeout(() => { btn.click(); if (panel.isConnected) panel.style.transform = ""; }, 200);
    } else {
      panel.style.transform = "";
    }
  };
  document.addEventListener("pointerup", end, { passive: true });
  document.addEventListener("pointercancel", end, { passive: true });
}

// installScrollReveal()  cards below the fold rise in once as they scroll into
//                    view (≤40ms stagger per batch). Anything already on screen
//                    is left alone, so nothing a worker can see is ever hidden,
//                    and a click is never delayed. Reduced motion: off.
// installHeaderCompact()  the sticky page header gets a soft shadow once the page scrolls
//                    (shadow only — no size change, so it can never oscillate).
const REVEAL = ".section-card, .kpi-tile, .hero-tile, .wu-card, .wu-tile, .rack-crate, .wu-sent";
export function installScrollReveal() {
  if (typeof window === "undefined" || window.__wuReveal || !("IntersectionObserver" in window) || reduced()) return;
  window.__wuReveal = true;
  let batch = [];
  let flushT = 0;
  const flush = () => {
    flushT = 0;
    batch.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
      .forEach((el, i) => { el.style.transitionDelay = `${Math.min(i, 8) * 40}ms`; el.classList.add("wu-in"); });
    batch = [];
  };
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target); batch.push(e.target);
      if (!flushT) flushT = requestAnimationFrame(flush);
    });
  }, { rootMargin: "0px 0px -6% 0px", threshold: 0.01 });
  const consider = (el) => {
    if (el.__wuSeen || el.closest(".modal-backdrop, [data-my-dashboard], .rp-backdrop, .tc-form, .app-sidebar, .mr-paper, .rpt-sheet")) return;
    el.__wuSeen = true;
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight && r.bottom > 0) return;   // already visible: never hide it
    el.classList.add("wu-reveal"); io.observe(el);
  };
  const scan = (root) => {
    if (!root || root.nodeType !== 1) return;
    if (root.matches && root.matches(REVEAL)) consider(root);
    root.querySelectorAll && root.querySelectorAll(REVEAL).forEach(consider);
  };
  const mo = new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach(scan)));
  const start = () => { scan(document.body); mo.observe(document.body, { childList: true, subtree: true }); };
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
}

export function installHeaderCompact() {
  if (typeof window === "undefined" || window.__wuHeader) return;
  window.__wuHeader = true;
  let raf = 0;
  document.addEventListener("scroll", (e) => {
    const el = e.target;
    if (raf || !el || el.nodeType !== 1) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const head = el.querySelector && el.querySelector(":scope > .page-header");
      if (head) head.classList.toggle("is-compact", el.scrollTop > 24);
    });
  }, { capture: true, passive: true });
}
