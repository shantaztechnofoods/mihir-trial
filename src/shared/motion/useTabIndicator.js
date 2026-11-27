// motion3 (2026-11-27) — the tab / segmented-control indicator slides to the
// chosen tab instead of jumping.
//
//   const barRef = useRef(null);
//   useTabIndicator(barRef, tab, { variant: "line" });   // underline tabs
//   useTabIndicator(barRef, lang, { variant: "pill" });  // segmented control
//   <div ref={barRef}> <button aria-pressed|aria-selected …/> … </div>
//
// One <span class="wu-tab-ind"> (not a React node, aria-hidden) is placed
// behind the buttons; the chosen button's own underline / white pill is hidden
// by motion3-lists.css while the indicator draws it. It moves on transform
// only, 200 ms (--m-small, --m-ease-out). Its position is read in the same
// commit as the tap (one read of the chosen button; layout happens for that
// frame anyway). A resize re-places it with no animation.
// Reduced motion: it jumps (no transition) — still drawn, so nothing is lost.
import { useLayoutEffect } from "react";
import "./motion3-lists.css";

const ACTIVE = ':scope > [aria-pressed="true"], :scope > [aria-selected="true"], :scope > [data-tab-active]';

function place(bar, variant, animate) {
  const active = bar.querySelector(ACTIVE);
  let ind = bar.querySelector(":scope > .wu-tab-ind");
  if (!active) { if (ind) ind.style.opacity = "0"; return; }
  if (!ind) {
    ind = document.createElement("span");
    ind.className = `wu-tab-ind wu-tab-ind--${variant}`;
    ind.setAttribute("aria-hidden", "true");
    bar.insertBefore(ind, bar.firstChild);
    bar.classList.add("wu-tabs", `wu-tabs--${variant}`);
    animate = false;
  }
  const x = active.offsetLeft, y = active.offsetTop, w = active.offsetWidth, h = active.offsetHeight;
  if (!animate) ind.classList.add("is-still");
  ind.style.opacity = "1";
  if (variant === "line") {
    ind.style.transform = `translate(${x}px, ${y + h - 2}px) scaleX(${w / 100})`;
  } else {
    ind.style.width = `${w}px`; ind.style.height = `${h}px`;
    ind.style.transform = `translate(${x}px, ${y}px)`;
  }
  if (!animate) { void ind.offsetWidth; ind.classList.remove("is-still"); }
}

export function useTabIndicator(ref, activeKey, { variant = "line" } = {}) {
  useLayoutEffect(() => {
    const bar = ref.current;
    if (bar) place(bar, variant, true);
  }, [activeKey, variant]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const bar = ref.current;
    if (!bar || typeof ResizeObserver !== "function") return undefined;
    let raf = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => place(bar, variant, false)); });
    ro.observe(bar);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [variant]); // eslint-disable-line react-hooks/exhaustive-deps
}
