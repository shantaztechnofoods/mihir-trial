// motion3 (2026-11-27) — rows fade/slide in and out when a SEARCH or FILTER changes.
//
//   const rowsRef = useRef(null);
//   useRowMotion(rowsRef, `${search}|${statusFilter}`);
//   <tbody ref={rowsRef}>…rows…</tbody>          (or any list element)
//
// * Only when `filterKey` changes. The first render, data refreshes, sorting
//   and "show more" never animate (those rows are not new to the eye).
// * New rows: fade + rise 4 px, 200 ms (--m-small, --m-ease-out), all together
//   (no stagger on a keystroke). Capped at the first 20 (10 on a phone).
// * Removed rows: a copy fades out where the row was, 140 ms (--m-small-out,
//   ease-in), floating over the list (position:absolute, pointer-events:none,
//   aria-hidden, inert) — the real list re-flows at once, nothing waits and no
//   click is ever blocked. Capped at 12 (6 on a phone). The positions come from
//   a read done right after the previous paint (no forced layout on input).
// * React never sees any of this: classes go on its rows for one animation and
//   come off again; the copies are not React nodes.
// * Reduced motion: nothing.
import { useLayoutEffect, useRef } from "react";
import { prefersReducedMotion } from "./viewTransition.js";
import "./motion3-lists.css";

const phone = () => { try { return window.matchMedia("(max-width: 767.98px)").matches; } catch { return false; } };

function hostOf(el) {
  const host = el.tagName === "TBODY" ? el.parentElement : el;
  if (host && !host.classList.contains("wu-rows-host")) host.classList.add("wu-rows-host");
  return host;
}

// Positions of the first rows, read after a paint (layout is clean then).
function measure(s, el) {
  const host = hostOf(el);
  const geo = new Map();
  const rows = s.prev || [];
  const cap = Math.min(rows.length, 24);
  for (let i = 0; i < cap; i++) {
    const r = rows[i];
    if (!r.isConnected || r.offsetParent !== host) continue;
    geo.set(r, {
      top: r.offsetTop, left: r.offsetLeft, width: r.offsetWidth, height: r.offsetHeight,
      cells: r.tagName === "TR" ? Array.from(r.children, (c) => c.offsetWidth) : null,
    });
  }
  s.geo = geo;
}

function ghostOut(el, node, g) {
  const copy = node.cloneNode(true);
  copy.classList.add("wu-row-ghost");
  copy.setAttribute("aria-hidden", "true");
  copy.setAttribute("inert", "");
  copy.removeAttribute("id");
  copy.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
  Object.assign(copy.style, { top: `${g.top}px`, left: `${g.left}px`, width: `${g.width}px`, height: `${g.height}px` });
  if (g.cells) Array.from(copy.children).forEach((c, i) => { c.style.width = `${g.cells[i] || 0}px`; });
  el.appendChild(copy);
  const done = () => copy.remove();
  copy.addEventListener("animationend", done, { once: true });
  setTimeout(done, 400);   // safety: never leave a copy behind
}

export function useRowMotion(ref, filterKey) {
  const st = useRef({ key: filterKey, prev: null, geo: new Map(), raf: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    const s = st.current;
    if (!el) { s.prev = null; return undefined; }
    const kids = [];
    for (const c of el.children) if (!c.classList.contains("wu-row-ghost")) kids.push(c);
    if (s.prev && s.key !== filterKey && !prefersReducedMotion()) {
      const small = phone();
      const before = new Set(s.prev);
      const now = new Set(kids);
      let n = 0;
      for (const c of kids) {
        if (n >= (small ? 10 : 20)) break;
        if (before.has(c)) continue;
        c.classList.add("wu-row-in");
        c.addEventListener("animationend", () => c.classList.remove("wu-row-in"), { once: true });
        n++;
      }
      let m = 0;
      for (const c of s.prev) {
        if (m >= (small ? 6 : 12)) break;
        if (now.has(c)) continue;
        const g = s.geo.get(c);
        if (!g) continue;
        ghostOut(el, c, g);
        m++;
      }
    }
    s.key = filterKey;
    s.prev = kids;
    if (typeof requestAnimationFrame === "function") {
      cancelAnimationFrame(s.raf);
      // after the next paint: rAF → setTimeout 0 lands once layout is clean
      s.raf = requestAnimationFrame(() => setTimeout(() => { if (ref.current === el) measure(s, el); }, 0));
    }
    return undefined;
  });
  useLayoutEffect(() => () => cancelAnimationFrame(st.current.raf), []);
}
