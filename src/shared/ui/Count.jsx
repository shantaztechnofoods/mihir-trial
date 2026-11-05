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
import { useRef } from "react";
import { formatCount, isCountable } from "./countFormat.js";

export default function Count({ value, locales = "en-IN", format, className = "", ...rest }) {
  const cls = `tabular-nums ${className}`.trim();
  const text = formatCount(value, locales, format);
  const seen = useRef({ first: value, dir: "up", last: value });
  const s = seen.current;
  if (value !== s.last) {
    if (isCountable(value) && isCountable(s.last)) s.dir = Number(value) < Number(s.last) ? "down" : "up";
    s.last = value;
  }
  if (!isCountable(value) || value === s.first) return <span className={cls} {...rest}>{text}</span>;
  return (
    <span className={cls} {...rest}>
      <span key={text} className={`wu-roll wu-roll-${s.dir}`}>{text}</span>
    </span>
  );
}
