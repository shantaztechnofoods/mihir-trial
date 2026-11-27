// UI P0 (2026-11-05) — the ONE way to use Motion (motion/react) in the ERP.
//
//   import MotionProvider, { m, AnimatePresence } from "../../shared/motion/MotionProvider.jsx";
//   <MotionProvider><m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} /></MotionProvider>
//
// * Only `LazyMotion` + `m.*` (~5 KB gzip). The animation features (~27 KB gzip)
//   arrive later through a dynamic import(); `strict` makes Motion throw if anyone
//   uses the full `motion.*` component (44 KB) inside this provider.
// * `MotionConfig reducedMotion="user"`: with OS "reduce motion" ON, transform and
//   layout animations are skipped; opacity still fades (vectorlab reduced-motion).
// * Never import this from src/main.jsx or the login screen — module chunks only
//   (tests/uiStack.test.mjs checks the entry files).
// * Durations / easing: use MOTION below (same tokens as world-ui.css --motion-*).
import { LazyMotion, MotionConfig } from "motion/react";
import { importWithReload } from "../../utils/lazyImport.js";

const loadFeatures = () => importWithReload(() => import("./motionFeatures.js")).then((r) => r.default);

export const MOTION = Object.freeze({
  // motion v2 (2026-11-27): same tokens as world-ui.css --m-* (micro / small / medium; exits faster)
  fast: 0.1, quick: 0.14, base: 0.2, sheet: 0.26,           // seconds (100 / 140 / 200 / 260 ms)
  quickOut: 0.1, baseOut: 0.14, sheetOut: 0.18,             // exits
  easeOut: [0.23, 1, 0.32, 1], easeIn: [0.5, 0, 0.75, 0],   // enter = ease-out, exit = ease-in
});

export default function MotionProvider({ children }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user" transition={{ duration: MOTION.base, ease: MOTION.easeOut }}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}

export { m, AnimatePresence, useReducedMotion } from "motion/react";
