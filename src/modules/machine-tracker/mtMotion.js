// Machine Tracker motion layer (Phase 1 motion, 2026-11-05). VISUAL ONLY.
//
// Nothing here reads or writes ERP data, and no handler waits for it: it only
// watches the DOM that React has already committed and animates the change.
//
//   useMtMotion(rootRef)  call once in MachinePage; rootRef = the page root.
//
// What it does (MOTION-PLAN.md MT-2 / MT-4 / MT-5 / MT-12):
//   * Card moves: a machine card that leaves a section (Accept → Work, Work →
//     Sent on) exits in 180 ms (a detached copy fades up and out), the cards
//     around it glide into the gap in 240 ms (FLIP, transform only), and the
//     card that arrived in its new section gets a soft green ring (1.1 s).
//     Cards are found by data-mt-mid (machine id) + their section.
//   * Route pill: the white "now" pill of Rack → Accept → Work → Send slides
//     to the new step (240 ms) instead of jumping.
//   * Sheets / dialogs: a closing .modal-backdrop animates out (phone: slides
//     down 200 ms, laptop: fades + settles 160 ms) instead of vanishing.
//
// Why not document.startViewTransition here: a view transition must wrap the
// state update itself, and that update lives in the Accept / Finish handlers
// (and App.jsx). The owner rule is "logic stays exactly the same", so this
// layer animates AFTER the commit instead — same look, zero handler change,
// zero KB of library.
//
// Safety:
//   * Ghost copies live in a body-level host OUTSIDE the React root (React
//     never sees their events), are inert + aria-hidden + pointer-events:none,
//     lose every data-* / id attribute (tests and code never find them) and are
//     removed after ≤ 220 ms.
//   * prefers-reduced-motion: no movement — exits and dialogs fade (120 ms),
//     no FLIP, no ring motion, pill jumps.
//   * Big changes (first data load, filter switch, > 8 cards changed) or more
//     than 40 cards on screen → no card animation at all.

import { useEffect, useLayoutEffect, useRef } from "react";

const DUR = { out: 180, move: 240, ring: 1100, sheet: 200, dialog: 160, fade: 120 };
const EASE_MOVE = "cubic-bezier(.65, 0, .35, 1)";
const EASE_IN = "cubic-bezier(.4, 0, 1, 1)";
const EASE_DRAWER = "cubic-bezier(.32, .72, 0, 1)";
const MAX_CHANGES = 8;
const MAX_CARDS = 40;

const reducedMotion = () => {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
};
const canAnimate = (el) => !!(el && typeof el.animate === "function");

// One body-level host for every ghost. display:contents keeps it out of layout;
// the mt-premium class keeps the page's own styles matching the ghost.
function ghostHost() {
  let h = document.getElementById("mt-ghost-host");
  if (!h) {
    h = document.createElement("div");
    h.id = "mt-ghost-host";
    h.className = "mt-premium mt-ghost-host";
    h.setAttribute("aria-hidden", "true");
    document.body.appendChild(h);
  }
  return h;
}

// Make a detached node harmless: no hooks for tests / code, no focus, no clicks.
function neuter(node) {
  const strip = (el) => {
    if (!el || el.nodeType !== 1) return;
    for (const a of Array.from(el.attributes)) {
      if (a.name.startsWith("data-") || a.name === "id" || a.name === "role" || a.name.startsWith("aria-")) el.removeAttribute(a.name);
    }
  };
  strip(node);
  node.querySelectorAll && node.querySelectorAll("*").forEach(strip);
  node.setAttribute("aria-hidden", "true");
  node.inert = true;
  node.style.pointerEvents = "none";
}

function dropLater(node, ms) {
  setTimeout(() => { try { node.remove(); } catch { /* gone */ } }, ms + 40);
}

// ── Card exit ghost ───────────────────────────────────────────────────────
function cardGhost(node, vp) {
  if (!node || node.isConnected || !canAnimate(node)) return;
  try {
    neuter(node);
    node.classList.remove("mt-arrive");
    Object.assign(node.style, {
      position: "fixed", left: `${vp.x}px`, top: `${vp.y}px`, width: `${vp.w}px`, height: `${vp.h}px`,
      margin: "0", zIndex: "20", boxSizing: "border-box", animation: "none", transition: "none",
    });
    ghostHost().appendChild(node);
    const reduce = reducedMotion();
    node.animate(
      reduce
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-6px) scale(.98)" }],
      { duration: reduce ? DUR.fade : DUR.out, easing: EASE_IN, fill: "forwards" },
    );
    dropLater(node, reduce ? DUR.fade : DUR.out);
  } catch { try { node.remove(); } catch { /* ignore */ } }
}

// ── Dialog / sheet exit ghost ─────────────────────────────────────────────
export function dialogGhost(node) {
  if (!node || node.isConnected || !canAnimate(node)) return;
  const panel = node.firstElementChild;
  // A sheet the worker dragged down is already off screen — nothing to play.
  if (panel && panel.style && panel.style.transform) return;
  try {
    neuter(node);
    ghostHost().appendChild(node);
    const reduce = reducedMotion();
    const phone = window.innerWidth < 768;
    const dur = reduce ? DUR.fade : phone ? DUR.sheet : DUR.dialog;
    node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur, easing: "ease-out", fill: "forwards" });
    if (panel && !reduce && canAnimate(panel)) {
      panel.style.animation = "none";
      panel.animate(
        phone
          ? [{ transform: "none" }, { transform: "translateY(100%)" }]
          : [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(8px) scale(.985)" }],
        { duration: dur, easing: phone ? EASE_DRAWER : EASE_IN, fill: "forwards" },
      );
    }
    dropLater(node, dur);
  } catch { try { node.remove(); } catch { /* ignore */ } }
}

// ── Snapshot of every machine card: key = section|machine id ──────────────
function sectionOf(el) {
  const s = el.closest("[data-staff-section]");
  return s ? s.getAttribute("data-staff-section") : (el.getAttribute("data-mt-sec") || "board");
}
function snapshot(root) {
  const map = new Map();
  if (!root) return map;
  const rr = root.getBoundingClientRect();
  const st = root.scrollTop;
  const els = root.querySelectorAll("[data-mt-mid]");
  if (els.length > MAX_CARDS) { map.tooMany = true; return map; }
  els.forEach((el) => {
    if (el.closest(".modal-backdrop")) return;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return;
    const mid = el.getAttribute("data-mt-mid");
    // y is in the scroll container's content coordinates, so scrolling between
    // two renders never looks like a move.
    map.set(`${sectionOf(el)}|${mid}`, { el, mid, x: r.left - rr.left, y: r.top - rr.top + st, w: r.width, h: r.height });
  });
  return map;
}

// ── Route pill: Rack → Accept → Work → Send ───────────────────────────────
function placeRoutePill(root) {
  const nav = root && root.querySelector("[data-staff-route]");
  if (!nav) return;
  const now = nav.querySelector(".wu-step.is-now");
  if (!now) { nav.removeAttribute("data-glide"); return; }
  const x = now.offsetLeft, w = now.offsetWidth;
  if (!w) return;
  const px = `${x}px`, pw = `${w}px`;
  if (nav.style.getPropertyValue("--pill-x") !== px) nav.style.setProperty("--pill-x", px);
  if (nav.style.getPropertyValue("--pill-w") !== pw) nav.style.setProperty("--pill-w", pw);
  // The first placement must not slide in from the left edge: switch the
  // transition on only after the pill has been drawn once.
  if (!nav.hasAttribute("data-glide")) {
    nav.setAttribute("data-glide", "");
    requestAnimationFrame(() => requestAnimationFrame(() => nav.setAttribute("data-glide", "on")));
  }
}

export function useMtMotion(rootRef) {
  const prev = useRef(null);

  // After EVERY commit (no deps on purpose — cheap: at most 40 rects).
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    placeRoutePill(root);
    const next = snapshot(root);
    const before = prev.current;
    prev.current = next;
    if (!before || before.tooMany || next.tooMany) return;

    const gone = [], came = [];
    before.forEach((v, k) => { if (!next.has(k)) gone.push([k, v]); });
    next.forEach((v, k) => { if (!before.has(k)) came.push([k, v]); });
    if (!gone.length && !came.length) return;                 // nothing moved between sections
    if (gone.length + came.length > MAX_CHANGES) return;      // a load / filter change, not an action

    const reduce = reducedMotion();
    const rr = root.getBoundingClientRect();
    const st = root.scrollTop;

    // 1. The card that left: a detached copy fades up and out where it was.
    for (const [, v] of gone) {
      cardGhost(v.el, { x: v.x + rr.left, y: v.y - st + rr.top, w: v.w, h: v.h });
    }
    // 2. The same machine in its new section: soft ring (opacity only).
    const goneMids = new Set(gone.map(([, v]) => v.mid));
    for (const [, v] of came) {
      if (!goneMids.has(v.mid)) continue;
      v.el.classList.remove("mt-arrive");
      void v.el.offsetWidth;                                   // restart the ring if it was still on
      v.el.classList.add("mt-arrive");
      setTimeout(() => { try { v.el.classList.remove("mt-arrive"); } catch { /* gone */ } }, DUR.ring + 60);
    }
    // 3. Everyone else glides into the gap (FLIP, transform only).
    if (reduce) return;
    next.forEach((v, k) => {
      const b = before.get(k);
      if (!b || !canAnimate(v.el)) return;
      const dx = b.x - v.x, dy = b.y - v.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      v.el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        { duration: DUR.move, easing: EASE_MOVE });
    });
  });

  // Keep the "before" picture fresh between renders (photos loading, window
  // resize), so the next move starts from where the cards really are.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof window === "undefined") return undefined;
    let raf = 0;
    const refresh = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (prev.current) prev.current = snapshot(root);
        placeRoutePill(root);
      });
    };
    root.addEventListener("load", refresh, true);
    window.addEventListener("resize", refresh);
    // Dialogs and sheets: animate the one that just closed.
    let mo = null;
    if (typeof MutationObserver !== "undefined") {
      mo = new MutationObserver((muts) => {
        for (const m of muts) {
          m.removedNodes.forEach((n) => {
            if (n.nodeType === 1 && n.classList && n.classList.contains("modal-backdrop")) dialogGhost(n);
          });
        }
        refresh();
      });
      mo.observe(root, { childList: true, subtree: true });
    }
    return () => {
      root.removeEventListener("load", refresh, true);
      window.removeEventListener("resize", refresh);
      if (mo) mo.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [rootRef]);
}

// ── Display-only "what is left" line under a grey Confirm button ─────────
// "1 check left · then Sign". Built only from values the dialog already
// shows; it never decides whether the button works (the handler does).
export function leftToDoText({ needPeople = false, signLeft = false, checksLeft = 0, needLateReason = false } = {}) {
  const parts = [];
  if (needPeople) parts.push("Pick who is accepting");
  if (needLateReason) parts.push("Write why it is late");
  if (checksLeft > 0) parts.push(`${checksLeft} check${checksLeft === 1 ? "" : "s"} left`);
  if (signLeft) parts.push("Sign above");
  if (!parts.length) return "";
  return parts.map((p, i) => (i === 0 ? p : `then ${p.charAt(0).toLowerCase()}${p.slice(1)}`)).join(" · ");
}
