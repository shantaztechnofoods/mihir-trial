// UI P0 (2026-11-05) — <Count value={n}/>: a number that rolls to its new value
// (@number-flow/react, ~6 KB gzip, loaded on demand). Until it has loaded — and
// for non-numeric values — the same number shows as plain text, so the first
// paint never waits and the layout never jumps (tabular-nums).
// NumberFlow follows prefers-reduced-motion (respectMotionPreference) itself.
//
//   import Count from "../../shared/ui/Count.jsx";
//   <Count value={stock} />   <Count value={pct} format={{ style: "percent" }} />
import { Suspense, lazy } from "react";
import { importWithReload } from "../../utils/lazyImport.js";
import { formatCount, isCountable } from "./countFormat.js";

const NumberFlow = lazy(() => importWithReload(() => import("@number-flow/react")));

export default function Count({ value, locales = "en-IN", format, className = "", ...rest }) {
  const cls = `tabular-nums ${className}`.trim();
  const text = <span className={cls} {...rest}>{formatCount(value, locales, format)}</span>;
  if (!isCountable(value)) return text;
  return (
    <Suspense fallback={text}>
      <NumberFlow value={value} locales={locales} format={format} className={cls} willChange={false}
        transformTiming={{ duration: 300, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }}
        spinTiming={{ duration: 300, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }}
        opacityTiming={{ duration: 150, easing: "ease-out" }} {...rest} />
    </Suspense>
  );
}
