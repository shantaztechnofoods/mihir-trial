// motion-a (2026-11-06) — <SaveMorph/>: the save button itself says it worked.
// Put it INSIDE an existing save button, in place of the label. It never runs
// or changes a save; it only reads the state the screen already keeps.
//
//   <button onClick={save}>
//     <SaveMorph busy={busy} saved={savedFlag}>💾 Save Changes</SaveMorph>
//   </button>
//
//   busy   true while saving → "Saving…"
//   saved  any value; each time it CHANGES to something truthy the label morphs
//          to ✓ (pops in) then "Saved" for `hold` ms, then back to the label.
//          (An object, e.g. a result message, flashes again on every new save.)
//
// Motion: tick scale/opacity 200 ms, word slides in 150 ms later (transform +
// opacity only, world-ui.css .wu-sm-*). The first render never animates.
// Reduced motion: no movement, the words still change. Meaning is in the word
// "Saved" + the tick icon, never in motion alone; aria-live announces it.
import { useEffect, useRef, useState } from "react";

export default function SaveMorph({ busy = false, saved = null, hold = 1600, savingText = "Saving…", savedText = "Saved", children }) {
  const [flash, setFlash] = useState(false);
  const last = useRef(saved);
  const moved = useRef(false);
  useEffect(() => {
    if (saved === last.current) return undefined;
    last.current = saved;
    if (!saved) { setFlash(false); return undefined; }
    setFlash(true);
    const t = setTimeout(() => setFlash(false), hold);
    return () => clearTimeout(t);
  }, [saved, hold]);
  const state = busy ? "saving" : flash ? "saved" : "idle";
  const animate = moved.current;
  if (state !== "idle") moved.current = true;
  return (
    <span className="wu-sm" data-save-state={state} aria-live="polite">
      {state === "saved" ? (
        <span key="saved" className="wu-sm-saved">
          <svg className="wu-sm-tick" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
               strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
          <span className="wu-sm-word">{savedText}</span>
        </span>
      ) : (
        <span key={state} className={animate ? "wu-sm-in" : undefined}>{state === "saving" ? savingText : children}</span>
      )}
    </span>
  );
}
