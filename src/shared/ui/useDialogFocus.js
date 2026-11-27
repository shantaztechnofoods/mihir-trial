// src/shared/ui/useDialogFocus.js — keyboard + screen-reader behaviour for a hand-built
// pop-up (2026-11-27, gap audit #4; same pattern as the New BOM popup in OutwardPage, #246).
// UI behaviour only: no data, no handlers.
//   * on open: remembers the control that opened it, moves focus to the first field
//     (or the first button) inside the pop-up;
//   * Tab / Shift+Tab stay inside the pop-up while it is the top-most modal dialog;
//   * on close: focus goes back to the control that opened it.
// Esc is NOT handled here — every pop-up that uses this already closes on Esc itself.
// Put role="dialog" aria-modal="true" and an aria-label on the element you pass in.
import { useEffect } from "react";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function useDialogFocus(ref) {
  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return undefined;
    const opener = document.activeElement;
    const list = () => Array.from(dlg.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
    const all0 = list();
    const first = all0.find((el) => el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA") || all0[0];
    if (first && !dlg.contains(document.activeElement)) { try { first.focus({ preventScroll: true }); } catch { first.focus(); } }
    const isTop = () => {
      const all = document.querySelectorAll('[role="dialog"][aria-modal="true"],[role="alertdialog"][aria-modal="true"]');
      return all.length > 0 && all[all.length - 1] === dlg;
    };
    const onKey = (e) => {
      if (e.key !== "Tab" || !isTop()) return;
      const items = list();
      if (!items.length) return;
      const a = items[0], b = items[items.length - 1];
      if (!dlg.contains(document.activeElement)) { e.preventDefault(); a.focus(); return; }
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); }
      else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener && opener !== document.body && document.contains(opener) && typeof opener.focus === "function") {
        try { opener.focus({ preventScroll: true }); } catch { /* gone */ }
      }
    };
  }, [ref]);
}
