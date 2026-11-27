// UI P0 (2026-11-05) — <Count value={n}/>: a number that rolls to its new value.
//
// Frame-budget pass (2026-11-05, owner: "no frame drops"): this used
// @number-flow/react. Every NumberFlow measures itself with offsetWidth /
// getBoundingClientRect before AND after each React commit, so a commit that
// changed several counts (Accept, Finish & Transfer) forced one synchronous
// layout per number in the middle of the commit (~45 ms at 4x CPU throttle).
// Now the roll is pure CSS: when the value changes, the new text is a fresh
// span that slides + fades in (transform/opacity only, 260 ms, see
// world-ui.css .wu-roll). No layout read, no library download. The first
// render never animates; non-numeric values are plain text; tabular-nums keeps
// the width steady. Reduced motion: no roll (world-ui.css).
//
//   import Count from "../../shared/ui/Count.jsx";
//   <Count value={stock} />   <Count value={pct} format={{ style: "percent" }} />
//
// motion3 (2026-11-27) — `intro="<page key>"`: stat numbers count up from 0 ONCE,
// the first time that page shows in this page load (claimFirstShow). Re-renders,
// live refreshes and coming back to the page never replay it. The real number is
// in the DOM from the first frame; the counting digits are CSS-painted on top
// (shared/motion/countIntro.js), so there is no layout shift and no React render
// per frame. Reduced motion: no count-up.
import { useLayoutEffect, useRef } from "react";
import { formatCount, isCountable } from "./countFormat.js";
import { canFirstShow, claimFirstShow } from "../motion/firstShow.js";
import { startCountIntro } from "../motion/countIntro.js";
import "../motion/motion3.css";

export default function Count({ value, locales = "en-IN", format, className = "", intro = null, ...rest }) {
  const cls = `tabular-nums ${className}`.trim();
  const text = formatCount(value, locales, format);
  const elRef = useRef(null);
  const introTried = useRef(false);
  useLayoutEffect(() => {
    // Waits for the first real (non-zero) number: with Supabase a page can
    // mount with empty data and get its numbers a moment later.
    if (!intro || introTried.current || !isCountable(value) || value === 0) return undefined;
    introTried.current = true;
    if (!claimFirstShow(`count:${intro}`)) return undefined;
    return startCountIntro(elRef.current, Number(value), { locales, format });
    // a value change mid-count → cleanup stops it and the real number shows
  }, [intro, value]); // eslint-disable-line react-hooks/exhaustive-deps
  const seen = useRef({ first: value, dir: "up", last: value });
  const s = seen.current;
  // intro: the first real number replaces an empty/zero first render as "first"
  // (counts up instead of rolling in) — only while the intro can still play.
  if (intro && !introTried.current && (s.first === 0 || !isCountable(s.first)) && isCountable(value) && value !== 0 && canFirstShow(`count:${intro}`)) {
    s.first = value; s.last = value;
  }
  if (value !== s.last) {
    if (isCountable(value) && isCountable(s.last)) s.dir = Number(value) < Number(s.last) ? "down" : "up";
    s.last = value;
  }
  if (!isCountable(value) || value === s.first) return <span ref={elRef} className={cls} {...rest}>{text}</span>;
  return (
    <span className={cls} {...rest}>
      <span key={text} className={`wu-roll wu-roll-${s.dir}`}>{text}</span>
    </span>
  );
}
