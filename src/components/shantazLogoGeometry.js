// SHANTAZ logo — one source of truth for the 2D SVG and the 3D login hero.
//
// Traced from the owner's logo file (Shantaz_Logo_bg, 500×500 PNG) and
// redrawn as clean geometry in that file's pixel space: the black cogwheel
// (a "C" open to the upper right, teeth on the outside, the band thinning to a
// fine tail at the bottom right), green wheat — a tall stalk and two shorter
// ones leaning right, leaf-shaped grains with fine awns — growing out of it,
// the red SHANTAZ wordmark (heavy caps; S and Z taller, cut as sharp
// Σ / Z shapes), the ® mark and the serif tagline "INNOVATION FOR LIFE".
// Letter boxes, gear centre/radii and stalk tips were measured on the trace.
//
// Every part is a polygon (outer ring + optional holes) in SVG units (y down).
// The 2D component turns them into path strings; the 3D hero extrudes the
// same points, so both always match. Tagline glyphs come from a 10-letter
// subset of Droid Serif (Apache 2.0, shipped with three.js).
import taglineFont from "../assets/shantaz-tagline.typeface.json";

export const BRAND = {
  red: "#E4002B",    // file measures #E20014; brand red per owner
  green: "#2F6B1F",
  green2: "#3D8A2A",
  gear: "#191816",   // measured on the logo file
  ink: "#191817",
};
export const TAGLINE = "INNOVATION FOR LIFE";

const rad = (d) => (d * Math.PI) / 180;
const polar = (cx, cy, r, deg) => [cx + r * Math.cos(rad(deg)), cy + r * Math.sin(rad(deg))];

// ── Gear: a "C" open to the upper right, teeth outside ───────────────────
export const GEAR_C = [121.7, 277.7];
function gearOutline() {
  const [cx, cy] = GEAR_C;
  const TIP = 61.5, ROOT = 54.5, IN = 45.5;
  const A0 = -55, A1 = -318;            // top-right end → round the left → bottom-right tail
  const TAPER = -250;                   // band thins to a fine tail after this angle
  const teeth = [];
  for (let a = -72; a >= -262; a -= 23.6) teeth.push(a);
  const outerR = (a) => (a > TAPER ? ROOT : ROOT - (ROOT - IN - 0.9) * Math.pow((TAPER - a) / (TAPER - A1), 0.9));
  const pts = [];
  const N = 220;
  for (let i = 0; i <= N; i++) {
    const a = A0 + ((A1 - A0) * i) / N;
    let r = outerR(a);
    for (const t of teeth) {
      const d = Math.abs(a - t);
      if (d < 4.4) r = TIP; else if (d < 6.2) r = Math.max(r, TIP - ((d - 4.4) / 1.8) * (TIP - ROOT));
    }
    pts.push(polar(cx, cy, r, a));
  }
  for (let i = 0; i <= 120; i++) pts.push(polar(cx, cy, IN, A1 + ((A0 - A1) * i) / 120));
  return pts;
}

// ── Wheat: tall stalk + two shorter ones leaning right ───────────────────
const STALKS = [
  { p0: [122, 304], p1: [124, 232], p2: [119, 168], pairs: 7, len: 16, wid: 6.4, awn: 15 }, // tall
  { p0: [124, 304], p1: [134, 250], p2: [157, 212], pairs: 6, len: 12.5, wid: 5.2, awn: 12 }, // right
  { p0: [123, 304], p1: [136, 270], p2: [139, 236], pairs: 5, len: 12, wid: 5, awn: 11 },     // middle
];
const qb = (p0, p1, p2, t) => {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
};
const qd = (p0, p1, p2, t) => {
  const u = 1 - t;
  return [2 * u * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]), 2 * u * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1])];
};
function stemPoly({ p0, p1, p2 }) {
  const L = [], R = [], n = 22;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const [x, y] = qb(p0, p1, p2, t);
    const [dx, dy] = qd(p0, p1, p2, t);
    const len = Math.hypot(dx, dy) || 1;
    const w = (1.9 * (1 - t) + 0.7 * t) / 2;
    const nx = -dy / len, ny = dx / len;
    L.push([x + nx * w, y + ny * w]);
    R.push([x - nx * w, y - ny * w]);
  }
  return [...L, ...R.reverse()];
}
const rot = (ax, ay, deg) => { const c = Math.cos(rad(deg)), s = Math.sin(rad(deg)); return ([x, y]) => [ax + x * c - y * s, ay + x * s + y * c]; };
function grainPoly(ax, ay, angleDeg, len, wid) {
  const side = (sign) => {
    const s = [];
    for (let i = 0; i <= 10; i++) {
      const u = i / 10;
      s.push([u * len, sign * (wid / 2) * Math.pow(Math.sin(Math.PI * u), 0.8) * (1 - 0.3 * u)]);
    }
    return s;
  };
  return [...side(1), ...side(-1).reverse().slice(1, -1)].map(rot(ax, ay, angleDeg));
}
// a fine awn (whisker) continuing from the grain tip
function awnPoly(ax, ay, angleDeg, from, len) {
  return [[from, -0.3], [from + len, -0.05], [from + len, 0.05], [from, 0.3]].map(rot(ax, ay, angleDeg));
}
function stalk(def, index) {
  const grains = [];
  const { pairs } = def;
  for (let k = 0; k < pairs; k++) {
    const t = 0.3 + (0.64 * k) / pairs;
    const [x, y] = qb(def.p0, def.p1, def.p2, t);
    const [dx, dy] = qd(def.p0, def.p1, def.p2, t);
    const a = (Math.atan2(dy, dx) * 180) / Math.PI;
    const len = def.len * (1 - 0.18 * (k / pairs)), wid = def.wid * (1 - 0.15 * (k / pairs));
    [-1, 1].forEach((side) => {
      const ga = a + side * 33;
      grains.push({ pts: grainPoly(x, y, ga, len, wid), awn: awnPoly(x, y, ga, len * 0.8, def.awn), at: [x, y], tone: (k + (side > 0 ? 1 : 0) + index) % 2 });
    });
  }
  const [tx, ty] = def.p2;
  const [dx, dy] = qd(def.p0, def.p1, def.p2, 1);
  const ta = (Math.atan2(dy, dx) * 180) / Math.PI;
  grains.push({ pts: grainPoly(tx, ty, ta, def.len * 0.9, def.wid * 0.85), awn: null, at: [tx, ty], tone: index % 2 });
  return { base: def.p0, stem: stemPoly(def), grains };
}

// ── Wordmark: boxes measured on the trace; S and Z are taller ────────────
const BOTTOM = 302.75;
const LETTERS = [
  { ch: "S", x: 151.25, h: 51.25, outer: [[0,0],[37,0],[37,10],[13.5,10],[40.5,42.75],[40.5,51.25],[0,51.25],[0,42.75],[27,42.75],[0,10]], w: 40.5 },
  { ch: "H", x: 194, h: 40.5, w: 32, outer: [[0,0],[7.75,0],[7.75,14.75],[24.25,14.75],[24.25,0],[32,0],[32,40.5],[24.25,40.5],[24.25,23],[7.75,23],[7.75,40.5],[0,40.5]] },
  { ch: "A", x: 230.5, h: 40.5, w: 38.5 },
  { ch: "N", x: 274, h: 40.5, w: 31, outer: [[0,0],[7.75,0],[23.25,27],[23.25,0],[31,0],[31,40.5],[23.25,40.5],[7.75,13.5],[7.75,40.5],[0,40.5]] },
  { ch: "T", x: 311, h: 40.5, w: 31.25, outer: [[0,0],[31.25,0],[31.25,7.5],[19.6,7.5],[19.6,40.5],[11.6,40.5],[11.6,7.5],[0,7.5]] },
  { ch: "A", x: 340, h: 40.5, w: 38.5 },
  { ch: "Z", x: 381, h: 51.25, w: 40, outer: [[3,0],[40,0],[40,10],[13,42.75],[40,42.75],[40,51.25],[0,51.25],[0,42.75],[26.5,10],[3,10]] },
];
const A_OUTER = [[15.75,0],[22.75,0],[38.5,40.5],[30,40.5],[26.31,31],[12.19,31],[8.5,40.5],[0,40.5]];
const A_HOLE = [[19.25,12.86],[23.4,23.5],[15.1,23.5]];
function wordmark() {
  return LETTERS.map((L) => {
    const top = BOTTOM - L.h;
    const mv = (p) => p.map(([a, b]) => [a + L.x, b + top]);
    const outer = L.ch === "A" ? A_OUTER : L.outer;
    return { ch: L.ch, x: L.x, w: L.w, top, outer: mv(outer), holes: L.ch === "A" ? [mv(A_HOLE)] : [] };
  });
}

// ── ® : thin ring + small R, dark like the tagline ────────────────────────
function registered() {
  const cx = 433.5, cy = 252, R1 = 6.8, R0 = 5.75;
  const circle = (r, rev) => {
    const p = [];
    for (let i = 0; i < 48; i++) p.push(polar(cx, cy, r, (rev ? -1 : 1) * i * 7.5));
    return p;
  };
  const s = 0.55, ox = 430.7, oy = 248.7;
  const m = (p) => p.map(([a, b]) => [ox + a * s, oy + b * s]);
  return [
    { outer: circle(R1), holes: [circle(R0, true)] },
    { outer: m([[0,0],[7,0],[10,3],[10,5.6],[7.6,7.6],[10.6,12],[7.8,12],[5.2,8],[2.4,8],[2.4,12],[0,12]]),
      holes: [m([[2.4,2],[6.4,2],[7.6,3.2],[7.6,4.8],[6.4,6],[2.4,6]])] },
  ];
}

// ── Tagline: Droid Serif caps, tracked across the measured span ───────────
const TAG_SIZE = 11.2;
const TAG_X0 = 179, TAG_X1 = 412, TAG_BASE = 325;
function tagline() {
  const res = taglineFont.resolution || 1000;
  const sc = TAG_SIZE / res;
  const chars = TAGLINE.split("");
  const adv = chars.map((c) => (c === " " ? 0.3 * res : taglineFont.glyphs[c].ha) * sc);
  const natural = adv.reduce((a, b) => a + b, 0);
  const lastInk = taglineFont.glyphs.E.x_max * sc;
  const track = (TAG_X1 - TAG_X0 - (natural - adv[adv.length - 1]) - lastInk) / (chars.length - 1);
  let x = TAG_X0;
  const glyphs = [];
  chars.forEach((c, i) => {
    if (c !== " ") glyphs.push({ ch: c, x, y: TAG_BASE, d: glyphPath(c, x, TAG_BASE, sc) });
    x += adv[i] + track;
  });
  return { size: TAG_SIZE, baseline: TAG_BASE, x0: TAG_X0, x1: TAG_X1, glyphs, font: taglineFont };
}
// typeface.json outline → SVG path (font units, y up → SVG, y down)
function glyphPath(ch, ox, oy, sc) {
  const o = (taglineFont.glyphs[ch].o || "").split(" ");
  const X = (v) => +(ox + Number(v) * sc).toFixed(2), Y = (v) => +(oy - Number(v) * sc).toFixed(2);
  let d = "";
  for (let i = 0; i < o.length;) {
    const c = o[i++];
    if (c === "m") { d += `M${X(o[i++])} ${Y(o[i++])}`; }
    else if (c === "l") { d += `L${X(o[i++])} ${Y(o[i++])}`; }
    else if (c === "q") { const x = o[i++], y = o[i++], cx = o[i++], cy = o[i++]; d += `Q${X(cx)} ${Y(cy)} ${X(x)} ${Y(y)}`; }
    else if (c === "b") { const x = o[i++], y = o[i++], c1x = o[i++], c1y = o[i++], c2x = o[i++], c2y = o[i++]; d += `C${X(c1x)} ${Y(c1y)} ${X(c2x)} ${Y(c2y)} ${X(x)} ${Y(y)}`; }
  }
  return d;
}

export const toPath = (pts) => pts.map(([x, y], i) => `${i ? "L" : "M"}${+x.toFixed(2)} ${+y.toFixed(2)}`).join("") + "Z";
export const partPath = (p) => toPath(p.outer) + (p.holes || []).map(toPath).join("");

let cache = null;
export function shantazLogo() {
  if (cache) return cache;
  const word = wordmark();
  const gear = { outer: gearOutline(), center: GEAR_C };
  const wheat = STALKS.map(stalk);
  const reg = registered();
  const tag = tagline();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (pts) => pts.forEach(([x, y]) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); });
  grow(gear.outer); wheat.forEach((s) => s.grains.forEach((g) => grow(g.pts))); word.forEach((l) => grow(l.outer)); reg.forEach((r) => grow(r.outer));
  maxY = Math.max(maxY, tag.baseline + 2);
  const pad = 3;
  cache = { gear, wheat, word, reg, tag, box: { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 } };
  return cache;
}
