// motion3 (2026-11-27) — status chips cross-fade when their state changes.
//
//   const swap = useSwap(status);            // "" until status first changes
//   <span key={status} className={`chip ${swap}`}>…</span>
//
// The `key` remounts the chip when the state changes and .wu-swap fades the new
// one in (opacity only, 140 ms --m-micro, motion3-feedback.css). The first
// render and re-renders with the same state never animate. Reduced motion: none.
import { useRef } from "react";
import "../motion/motion3-feedback.css";

export function useSwap(k) {
  const r = useRef({ first: k, moved: false });
  if (!r.current.moved && k !== r.current.first) r.current.moved = true;
  return r.current.moved ? "wu-swap" : "";
}
