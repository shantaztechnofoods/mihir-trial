// motion3 (2026-11-27) — count-up for stat numbers, ONCE per page load.
//
// Zero React re-renders and zero layout reads: React keeps rendering the REAL
// number (text, screen readers, tests all read the final value from the first
// frame). The counting digits are painted by CSS on top of it (::after with
// content: attr(data-cu), see motion3.css) while the real glyphs are
// transparent, so the box keeps its final width from frame one — no layout
// shift; tabular-nums keeps every digit the same width. One shared rAF loop
// drives all numbers; each frame writes one attribute per number.
//
// Timing: Motion v2 --m-medium (260 ms) on --m-ease-out (.23,1,.32,1).
import { formatCount } from "../ui/countFormat.js";

const DURATION = 260;                       // --m-medium
// cubic-bezier(.23, 1, .32, 1) (--m-ease-out), solved for x → y
function ease(x) {
  const p1x = 0.23, p1y = 1, p2x = 0.32, p2y = 1;
  const bx = (t) => 3 * (1 - t) * (1 - t) * t * p1x + 3 * (1 - t) * t * t * p2x + t * t * t;
  const by = (t) => 3 * (1 - t) * (1 - t) * t * p1y + 3 * (1 - t) * t * t * p2y + t * t * t;
  let lo = 0, hi = 1, t = x;
  for (let i = 0; i < 14; i++) { t = (lo + hi) / 2; if (bx(t) < x) lo = t; else hi = t; }
  return by(t);
}

const running = new Set();
let raf = 0;

function frame(ts) {
  raf = 0;
  for (const a of running) {
    if (a.start == null) a.start = ts;
    const p = Math.min(1, (ts - a.start) / DURATION);
    if (p >= 1) { a.stop(); continue; }
    const v = a.to * ease(p);
    a.el.setAttribute("data-cu", formatCount(a.int ? Math.round(v) : Number(v.toFixed(a.dp)), a.locales, a.format));
  }
  if (running.size) raf = requestAnimationFrame(frame);
}

function decimals(n) {
  const s = String(n);
  const i = s.indexOf(".");
  return i < 0 ? 0 : Math.min(4, s.length - i - 1);
}

/**
 * Start a count-up on `el` (an element whose only content is the final number
 * text). Returns stop(), which puts the element back exactly as React left it.
 */
export function startCountIntro(el, to, { locales = "en-IN", format } = {}) {
  if (!el || typeof requestAnimationFrame !== "function" || !Number.isFinite(to) || to === 0) return () => {};
  const a = { el, to, locales, format, int: Number.isInteger(to), dp: decimals(to), start: null, stop: null };
  a.stop = () => {
    if (!running.has(a)) return;
    running.delete(a);
    el.classList.remove("wu-cu");
    el.removeAttribute("data-cu");
  };
  el.setAttribute("data-cu", formatCount(0, locales, format));
  el.classList.add("wu-cu");
  running.add(a);
  if (!raf) raf = requestAnimationFrame(frame);
  return a.stop;
}
