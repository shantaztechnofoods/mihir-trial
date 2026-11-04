import React, { useEffect, useRef } from "react";

// Login hero (2026-11-04, world UI): a steel production rack drawn in pure CSS
// 3D — no WebGL, no library. It is loaded lazily by LoginPage only after the
// form is on screen, so it never delays typing. Decorative only (aria-hidden).
//
//   still = true  → drawn once at a fixed angle (reduced motion / low-end phone)
//   tab hidden    → the rotation pauses (no battery spent in the background)
//   pointer moves → the rig tilts a few degrees towards the cursor (desktop)

// One cuboid: six faces around a centre point. Sizes in px; y grows downwards.
function Box({ w, h, d, x = 0, y = 0, z = 0, cls = "" }) {
  const face = (name, fw, fh, t) => (
    <i className={`lh-f lh-${name}`} style={{ width: fw, height: fh, marginLeft: -fw / 2, marginTop: -fh / 2, transform: t }} />
  );
  return (
    <b className={`lh-box ${cls}`} style={{ transform: `translate3d(${x}px,${y}px,${z}px)` }}>
      {face("front", w, h, `translateZ(${d / 2}px)`)}
      {face("back", w, h, `rotateY(180deg) translateZ(${d / 2}px)`)}
      {face("right", d, h, `rotateY(90deg) translateZ(${w / 2}px)`)}
      {face("left", d, h, `rotateY(-90deg) translateZ(${w / 2}px)`)}
      {face("top", w, d, `rotateX(90deg) translateZ(${h / 2}px)`)}
      {face("bottom", w, d, `rotateX(-90deg) translateZ(${h / 2}px)`)}
    </b>
  );
}

const W = 250, H = 270, D = 116, T = 7;        // rack outer size, post/shelf thickness
const SHELVES = [-128, -42, 44, 128];

export default function LoginHero({ still = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current; if (!el) return undefined;
    const onVis = () => el.classList.toggle("is-paused", document.hidden);
    document.addEventListener("visibilitychange", onVis);
    let raf = 0;
    const onMove = (e) => {
      if (still || raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = el.getBoundingClientRect();
        el.style.setProperty("--px", ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
        el.style.setProperty("--py", ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("pointermove", onMove); if (raf) cancelAnimationFrame(raf); };
  }, [still]);

  const posts = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  return (
    <div ref={ref} className={`lh-root${still ? " is-still" : ""}`} aria-hidden="true">
      <div className="lh-floor" />
      <div className="lh-cam">
        <div className="lh-tilt">
          <div className="lh-rig">
            {posts.map(([sx, sz]) => (
              <Box key={`${sx}${sz}`} cls="lh-steel" w={T} h={H} d={T} x={sx * (W / 2 - T / 2)} z={sz * (D / 2 - T / 2)} />
            ))}
            {SHELVES.map((y) => <Box key={y} cls="lh-steel lh-shelf" w={W} h={T - 2} d={D} y={y} />)}
            {/* machines resting on the shelves */}
            <Box cls="lh-crate" w={92} h={58} d={86} x={-62} y={44 - 3 - 29} />
            <Box cls="lh-crate lh-heat" w={96} h={62} d={86} x={56} y={44 - 3 - 31} />
            <Box cls="lh-crate lh-panel" w={120} h={52} d={80} x={-20} y={-42 - 3 - 26} />
            <Box cls="lh-crate lh-low" w={196} h={50} d={90} y={128 - 3 - 25} />
          </div>
        </div>
        <div className="lh-shadow" />
      </div>
    </div>
  );
}
