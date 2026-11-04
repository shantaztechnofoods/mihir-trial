import React, { useEffect, useRef } from "react";
import { createLogoScene } from "./shantazLogoScene.js";
import { LOGO_SVG } from "./shantazLogoGeometry.js";

export { default as ShantazLogoSVG } from "./ShantazLogoSVG.jsx";

// Login hero: the SHANTAZ logo in 3D, extruded from the exact paths of the
// owner's CorelDRAW master (src/assets/shantaz-logo.svg) as a cinematic
// reveal: the black-chrome gear rolls in and locks (glint), wheat grows and
// then sways in the wind, SHANTAZ rotates in letter by letter under a light
// sweep, the tagline rises in, ® pops. Idle: wind, a light orbiting the gear,
// a sweep every 8 s (window event "shantaz:sweep"), ±4° parallax.
// The scene engine lives in shantazLogoScene.js.
// Decorative (aria-hidden). onFail() → the page shows the 2D SVG logo (no
// WebGL, lost context, or < 40 fps after the intro).
// fullBleed: the canvas fills the whole screen (it draws its own navy
// background); the logo sits left-of-centre on desktop, at the top on phones.
// onStart() → the canvas has faded in (the login page then fades its 2D poster out).
export default function LoginBrand3D({ onFail, onStart, fullBleed = false }) {
  const hostRef = useRef(null);
  useEffect(() => {
    const host = hostRef.current; if (!host) return undefined;
    return createLogoScene(host, { svgText: LOGO_SVG, fullBleed, onFail, onStart });
  }, [onFail, onStart, fullBleed]);
  return (
    <div className={`lg-brand3d${fullBleed ? " lg-brand3d--full" : ""}`} aria-hidden="true"
         style={fullBleed ? { position: "absolute", inset: 0, height: "auto", pointerEvents: "none" } : undefined}>
      <div ref={hostRef} className="lg-3d lg-3d--logo" style={fullBleed ? { position: "absolute", inset: 0 } : undefined} />
    </div>
  );
}
