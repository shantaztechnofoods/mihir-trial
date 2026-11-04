import React, { useId } from "react";
import { BRAND, partPath, shantazLogo } from "./shantazLogoGeometry.js";

// 2D SHANTAZ logo (gear + wheat + wordmark + ® + tagline) as one inline SVG,
// traced from the owner's logo file — same geometry as the 3D login hero.
// For the sidebar/header, reports, and the login fallback (reduced motion /
// no WebGL). Self-contained: needs no CSS.
//   tone="light"  – real colours, for light backgrounds
//   tone="dark"   – gear, ® and tagline in light steel so they read on navy
//   shine         – one soft light sweep across the logo (plays once)
//   showTagline   – drop the tagline for tiny sizes
export default function ShantazLogoSVG({ tone = "light", shine = false, showTagline = true, className = "", style, title = "SHANTAZ — Innovation for Life" }) {
  const L = shantazLogo();
  const uid = useId().replace(/:/g, "");
  const dark = tone === "dark";
  const gearFill = dark ? "#AEB7C6" : BRAND.gear;
  const inkFill = dark ? "#C3CCDB" : BRAND.ink;
  const greenFill = dark ? "#2F6B1F" : BRAND.green;
  const b = L.box;
  const tagTop = Math.min(...L.tag.glyphs.map((g) => g.box[1]));
  const h = showTagline ? b.h : tagTop - 3 - b.y;
  // flat list of paths (a <clipPath> may only hold shapes, no groups)
  const parts = [
    ...L.gear.pieces.map((p) => ({ d: partPath(p), fill: gearFill })),
    ...L.wheat.pieces.map((p) => ({ d: partPath(p), fill: greenFill })),
    ...L.word.map((p) => ({ d: partPath(p), fill: BRAND.red })),
    ...L.reg.map((p) => ({ d: partPath(p), fill: inkFill })),
    ...(showTagline ? L.tag.glyphs.map((p) => ({ d: partPath(p), fill: inkFill })) : []),
  ];
  const shapes = (fill) => parts.map((p, i) => <path key={i} d={p.d} fill={fill ? p.fill : undefined} fillRule="evenodd" />);
  const sweepW = 60;
  return (
    <svg
      className={`shantaz-logo ${className}`}
      style={{ display: "block", ...style }}
      viewBox={`${b.x.toFixed(1)} ${b.y.toFixed(1)} ${b.w.toFixed(1)} ${h.toFixed(1)}`}
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title}</title>
      {shapes(true)}
      {shine && (
        <>
          <defs>
            <linearGradient id={`sh-g-${uid}`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset=".5" stopColor="#fff" stopOpacity=".7" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <clipPath id={`sh-c-${uid}`}>{shapes(false)}</clipPath>
          </defs>
          <g clipPath={`url(#sh-c-${uid})`}>
            <g transform={`skewX(-18) translate(${(b.h * 0.33).toFixed(1)} 0)`}>
              <rect x={b.x - sweepW - 20} y={b.y} width={sweepW} height={b.h} fill={`url(#sh-g-${uid})`}>
                {/* one pass, then stays off-logo (SMIL: works without any stylesheet) */}
                <animateTransform attributeName="transform" type="translate" from="0 0" to={`${(b.w + sweepW + 60).toFixed(0)} 0`}
                  begin="0.35s" dur="1.3s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.22 1 0.36 1" />
              </rect>
            </g>
          </g>
        </>
      )}
    </svg>
  );
}
