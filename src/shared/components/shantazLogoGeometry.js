// SHANTAZ logo — one source of truth for the 2D SVG and the 3D login hero.
//
// src/assets/shantaz-logo.svg holds the EXACT paths of the owner's CorelDRAW
// master (logo.cdr → SVG), cropped to the artwork, page background dropped,
// coordinates scaled 1/50 (1 unit = 0.5 mm). Fills and the wheat gradients
// are the file's own. Groups / data-part: gear, wheat (data-kind stem|grain),
// wordmark, tagline, registered.
//
// This module reads that file (as text) into plain data for the 2D component;
// the 3D hero hands the same text to three's SVGLoader.
import LOGO_SVG from "../../assets/shantaz-logo.svg?raw";

export { LOGO_SVG };

export const BRAND = {
  red: "#E30016",    // from the CDR file
  gear: "#1B1918",
  ink: "#1B1918",
  wheatLight: "#4AAC26",
  wheatDark: "#1D5113",
};
export const TAGLINE = "INNOVATION FOR LIFE";

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? m[1] : null;
};

let cache = null;
export function shantazLogo() {
  if (cache) return cache;
  const [x, y, w, h] = attr(LOGO_SVG.match(/<svg[^>]*>/)[0], "viewBox").split(/\s+/).map(Number);
  const gradients = [...LOGO_SVG.matchAll(/<linearGradient([^>]*)>(.*?)<\/linearGradient>/g)].map(([, a, inner]) => ({
    id: attr(a, "id"),
    x1: +attr(a, "x1"), y1: +attr(a, "y1"), x2: +attr(a, "x2"), y2: +attr(a, "y2"),
    stops: [...inner.matchAll(/<stop([^>]*)\/>/g)].map(([, s]) => ({ offset: +attr(s, "offset"), color: attr(s, "stop-color") })),
  }));
  const parts = [...LOGO_SVG.matchAll(/<path([^>]*)\/>/g)].map(([, a]) => ({
    id: attr(a, "id"), part: attr(a, "data-part"), kind: attr(a, "data-kind"), fill: attr(a, "fill"), d: attr(a, "d"),
  }));
  // tagline top (for the "no tagline" crop): smallest y in its path
  const tagYs = parts.filter((p) => p.part === "tagline").flatMap((p) => [...p.d.matchAll(/[-\d.]+ ([-\d.]+)/g)].map((m) => +m[1]));
  cache = {
    box: { x, y, w, h },
    gradients,
    parts,
    gearCenter: [64.98, 122.8],    // centre of the gear ring (logo units)
    tagTop: Math.min(...tagYs),
  };
  return cache;
}
