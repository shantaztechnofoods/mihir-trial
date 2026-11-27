// motion3 F (2026-11-27) — a small "nothing found" drawing (an empty box and a
// lens) that draws itself once (360 ms, motion3-big.css). Decorative:
// aria-hidden; the words next to it carry the meaning. Reduced motion: static.
import "../motion/motion3-big.css";

export default function EmptyArt() {
  return (
    <svg className="wu-empty-art" viewBox="0 0 96 72" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path className="d" pathLength="1" d="M14 30 L44 18 L74 30 L44 42 Z" />
      <path className="d d2" pathLength="1" d="M14 30 V52 L44 64 L74 52 V30 M44 42 V64" />
      <g className="lens" stroke="#2E50D6"><circle cx="66" cy="20" r="9" /><path d="M72.5 26.5 L80 34" /></g>
    </svg>
  );
}
