import React, { useId } from "react";
import { shantazLogo } from "./shantazLogoGeometry.js";

// 2D SHANTAZ logo (gear + wheat + wordmark + ® + tagline) as one inline SVG,
// drawn from the EXACT paths of the owner's CorelDRAW master
// (src/assets/shantaz-logo.svg) — the same paths the 3D login hero extrudes.
// For the sidebar/header, reports, and the login fallback (reduced motion /
// no WebGL). Self-contained: needs no CSS.
//   tone="light"  – the file's own colours, for light backgrounds
//   tone="dark"   – same true colours on navy; the black gear only gets a thin
//                   cool rim line, and the (black) tagline + ® switch to light
//                   steel so they can be read
//   shine         – one soft light sweep across the logo (plays once)
//   showTagline   – drop the tagline for tiny sizes
const STEEL = "#C3CCDB";

export default function ShantazLogoSVG({ tone = "light", shine = false, showTagline = true, className = "", style, title = "SHANTAZ — Innovation for Life" }) {
  const L = shantazLogo();
  const uid = useId().replace(/:/g, "");
  const dark = tone === "dark";
  const b = L.box;
  const gid = (id) => `${id}-${uid}`;
  const parts = L.parts.filter((p) => showTagline || p.part !== "tagline");
  const fillOf = (p) => {
    if (p.fill && p.fill.startsWith("url(#")) return `url(#${gid(p.fill.slice(5, -1))})`;
    if (dark && (p.part === "tagline" || p.part === "registered")) return STEEL;
    return p.fill;
  };
  const rim = { stroke: "#9FB3CF", strokeOpacity: 0.6, strokeWidth: 0.55, strokeLinejoin: "round" };
  const sweepW = 70;
  return (
    <svg
      className={`shantaz-logo ${className}`}
      style={{ display: "block", ...style }}
      viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`}
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title}</title>
      <defs>
        {L.gradients.map((g) => (
          <linearGradient key={g.id} id={gid(g.id)} gradientUnits="userSpaceOnUse" x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}>
            {g.stops.map((s, i) => <stop key={i} offset={s.offset} stopColor={s.color} />)}
          </linearGradient>
        ))}
      </defs>
      {parts.map((p) => (
        <path key={p.id} d={p.d} fill={fillOf(p)} fillRule="evenodd" {...(dark && p.part === "gear" ? rim : {})} />
      ))}
      {shine && (
        <>
          <defs>
            <linearGradient id={`sh-g-${uid}`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset=".5" stopColor="#fff" stopOpacity=".7" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <clipPath id={`sh-c-${uid}`}>{parts.map((p) => <path key={p.id} d={p.d} fillRule="evenodd" />)}</clipPath>
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
