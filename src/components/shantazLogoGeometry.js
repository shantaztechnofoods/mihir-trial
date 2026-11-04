// SHANTAZ logo — one source of truth for the 2D SVG and the 3D login hero.
//
// The shapes are TRACED from the owner's logo file (Shantaz_Logo_bg, 500×500
// PNG): each colour layer — black gear, green wheat, red SHANTAZ, dark ®,
// dark tagline — was upscaled 4×, smoothed and traced with potrace, and the
// curves flattened to polygons (outer ring + holes) in the file's pixel space
// (y down). Nothing is redrawn by hand, so the 2D and 3D logos match the
// artwork. Source data: src/assets/shantaz-logo-trace.json.
import trace from "../assets/shantaz-logo-trace.json";

// colours measured on the logo file (red is the brand red)
export const BRAND = {
  red: "#E20014",
  green: "#1D5013",
  gear: "#191816",
  ink: "#191817",
};
export const TAGLINE = "INNOVATION FOR LIFE";
export const GEAR_C = [121.7, 277.7];   // least-squares circle through the traced gear
export const WHEAT_BASE = [123, 305];   // where the stalks leave the gear

const ring = (pts) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join("") + "Z";
export const toPath = ring;
export const partPath = (p) => ring(p.outer) + (p.holes || []).map(ring).join("");

let cache = null;
export function shantazLogo() {
  if (cache) return cache;
  const word = trace.letters.map((p, i) => ({ ...p, ch: "SHANTAZ"[i] || "", x: p.box[0], w: p.box[2], top: p.box[1] }));
  // tagline pieces in reading order; `x` is used for the tracking-in motion
  const glyphs = trace.tagline.map((p) => ({ ...p, x: p.box[0] }));
  const tx0 = Math.min(...glyphs.map((g) => g.box[0]));
  const tx1 = Math.max(...glyphs.map((g) => g.box[0] + g.box[2]));
  const baseline = Math.max(...glyphs.map((g) => g.box[1] + g.box[3]));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  ["gear", "wheat", "letters", "reg", "tagline"].forEach((k) => trace[k].forEach((p) => {
    const [x, y, w, h] = p.box;
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
  }));
  const pad = 3;
  cache = {
    gear: { pieces: trace.gear, center: GEAR_C },
    wheat: { pieces: trace.wheat, base: WHEAT_BASE },
    word,
    reg: trace.reg,
    tag: { glyphs, x0: tx0, x1: tx1, baseline },
    box: { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 },
  };
  return cache;
}
