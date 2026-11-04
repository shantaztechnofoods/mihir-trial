import React, { useId } from "react";
import { BRAND, partPath, shantazLogo, toPath } from "./shantazLogoGeometry.js";

// 2D SHANTAZ logo (gear + wheat + wordmark + ® + tagline) as one inline SVG.
// Same geometry as the 3D login hero. For the sidebar/header, reports, and the
// login fallback (reduced motion / no WebGL).
//   tone="light"  – for light backgrounds (black gear, black tagline)
//   tone="dark"   – for dark backgrounds (steel gear + tagline so they read)
//   shine         – one soft light sweep across the logo (CSS, plays once)
//   showTagline   – drop the tagline for tiny sizes
export default function ShantazLogoSVG({ tone = "light", shine = false, showTagline = true, className = "", style, title = "SHANTAZ — Innovation for Life" }) {
  const L = shantazLogo();
  const uid = useId().replace(/:/g, "");
  const dark = tone === "dark";
  const gearFill = dark ? "#AEB7C6" : BRAND.gear;
  const tagFill = dark ? "#C3CCDB" : BRAND.ink;
  const b = L.box;
  const h = showTagline ? b.h : L.tag.baseline - L.tag.size * 1.2 - b.y;
  // flat list of paths (a <clipPath> may only hold shapes, no groups)
  const parts = [
    { d: toPath(L.gear.outer), fill: gearFill },
    ...L.wheat.flatMap((s) => [
      { d: toPath(s.stem), fill: BRAND.green },
      ...s.grains.filter((g) => g.awn).map((g) => ({ d: toPath(g.awn), fill: BRAND.green2 })),
      ...s.grains.map((g) => ({ d: toPath(g.pts), fill: g.tone ? BRAND.green2 : BRAND.green })),
    ]),
    ...L.word.map((l) => ({ d: partPath(l), fill: BRAND.red })),
    ...L.reg.map((r) => ({ d: partPath(r), fill: tagFill })),
    ...(showTagline ? L.tag.glyphs.map((g) => ({ d: g.d, fill: tagFill })) : []),
  ];
  const shapes = (fill) => parts.map((p, i) => <path key={i} d={p.d} fill={fill ? p.fill : undefined} fillRule="evenodd" />);
  return (
    <svg
      className={`shantaz-logo${shine ? " shantaz-logo--shine" : ""} ${className}`}
      style={style}
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
              <stop offset=".5" stopColor="#fff" stopOpacity=".75" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <clipPath id={`sh-c-${uid}`}>{shapes(false)}</clipPath>
          </defs>
          <g clipPath={`url(#sh-c-${uid})`}>
            <g transform={`skewX(-18) translate(${(b.h * 0.33).toFixed(1)} 0)`}>
              <rect className="shantaz-logo__shine" x={b.x - 90} y={b.y} width="70" height={b.h} fill={`url(#sh-g-${uid})`}
                    style={{ "--shx": `${(b.w + 180).toFixed(0)}px` }} />
            </g>
          </g>
        </>
      )}
    </svg>
  );
}
