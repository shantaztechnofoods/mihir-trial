// motion3 (2026-11-27) — <SuccessTick on={successState} />: a short green ✓ on
// the button that just saved. Put it INSIDE an existing save/submit button (the
// button must be position:relative). It never runs or changes a save: it only
// watches a success value the screen already keeps (its success toast). Each
// time `on` changes to a new truthy value, the tick plays once (~1 s) on top of
// the button, then is gone. aria-hidden + pointer-events:none: the button keeps
// its name and stays clickable; the words of the toast carry the meaning.
// Timing: Motion v2 tokens (motion3-feedback.css). Reduced motion: fade only.
import { useRef } from "react";
import "../motion/motion3-feedback.css";

export default function SuccessTick({ on = null }) {
  const st = useRef({ last: on, n: 0 });
  const s = st.current;
  if (on !== s.last) { if (on) s.n += 1; s.last = on; }   // first render never plays
  if (!s.n) return null;
  return (
    <span key={s.n} className="wu-savetick" aria-hidden="true">
      <svg className="wu-savetick-mark" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
           strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
    </span>
  );
}
