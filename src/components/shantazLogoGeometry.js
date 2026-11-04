// SHANTAZ logo — one source of truth for the 2D SVG and the 3D login hero.
//
// Redrawn as clean geometry from the company logo: a black half cogwheel
// (open side to the right, thin inner ring), three green wheat stalks growing
// out of it towards the upper right, the red SHANTAZ wordmark (heavy geometric
// caps, S and Z with sharp angled cuts), a ® mark and the serif tagline
// "INNOVATION FOR LIFE" under the wordmark, starting under the H.
//
// Every part is a polygon (outer ring + optional holes) in SVG units (y down).
// The 2D component turns them into path strings; the 3D hero extrudes the
// same points, so both always match. Tagline glyphs come from a 10-letter
// subset of Droid Serif (Apache 2.0, shipped with three.js).
import taglineFont from "../assets/shantaz-tagline.typeface.json";

export const BRAND = {
  red: "#E4002B",
  green: "#2F6B1F",
  green2: "#3D8A2A",
  gear: "#16181C",
  ink: "#111317",
};
export const TAGLINE = "INNOVATION FOR LIFE";

const rad = (d) => (d * Math.PI) / 180;
const polar = (cx, cy, r, deg) => [cx + r * Math.cos(rad(deg)), cy + r * Math.sin(rad(deg))];

// ── Gear: half cog, open side to the right ────────────────────────────────
export const GEAR_C = [96, 118];
function gearOutline() {
  const [cx, cy] = GEAR_C;
  const TIP = 82, ROOT = 68, BODY = 54;
  const from = 80, period = 25, teeth = 8;
  const pts = [];
  const arc = (r, a0, a1, step = 2.5) => {
    const n = Math.max(1, Math.round(Math.abs(a1 - a0) / step));
    for (let i = 0; i <= n; i++) pts.push(polar(cx, cy, r, a0 + ((a1 - a0) * i) / n));
  };
  for (let k = 0; k < teeth; k++) {
    const a = from + k * period;
    arc(ROOT, a, a + 5.5);
    pts.push(polar(cx, cy, TIP, a + 9));
    arc(TIP, a + 9, a + 16, 3.5);
    pts.push(polar(cx, cy, ROOT, a + 19.5));
    arc(ROOT, a + 19.5, a + 25);
  }
  const inner = [];
  const n = 80;
  for (let i = 0; i <= n; i++) inner.push(polar(cx, cy, BODY, from + teeth * period - ((teeth * period) * i) / n));
  return [...pts, ...inner];
}
function gearRing() {
  const [cx, cy] = GEAR_C;
  const a0 = 96, a1 = 264, n = 64, R1 = 48.5, R0 = 44;
  const out = [];
  for (let i = 0; i <= n; i++) out.push(polar(cx, cy, R1, a0 + ((a1 - a0) * i) / n));
  for (let i = 0; i <= n; i++) out.push(polar(cx, cy, R0, a1 - ((a1 - a0) * i) / n));
  return out;
}

// ── Wheat: 3 stalks, leaf-shaped grains in pairs + one at the tip ─────────
const STALKS = [
  { p0: [92, 150], p1: [90, 92], p2: [110, 26] },   // left
  { p0: [98, 152], p1: [112, 84], p2: [150, 20] },  // centre
  { p0: [104, 154], p1: [138, 106], p2: [184, 56] }, // right
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
  const L = [], R = [], n = 18;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const [x, y] = qb(p0, p1, p2, t);
    const [dx, dy] = qd(p0, p1, p2, t);
    const len = Math.hypot(dx, dy) || 1;
    const w = (4.4 * (1 - t) + 1.6 * t) / 2;
    const nx = -dy / len, ny = dx / len;
    L.push([x + nx * w, y + ny * w]);
    R.push([x - nx * w, y - ny * w]);
  }
  return [...L, ...R.reverse()];
}
function grainPoly(ax, ay, angleDeg, len, wid) {
  const ca = Math.cos(rad(angleDeg)), sa = Math.sin(rad(angleDeg));
  const side = (sign) => {
    const s = [];
    for (let i = 0; i <= 10; i++) {
      const u = i / 10;
      const hw = (wid / 2) * Math.pow(Math.sin(Math.PI * u), 0.85) * (1 - 0.25 * u);
      s.push([u * len, sign * hw]);
    }
    return s;
  };
  const local = [...side(1), ...side(-1).reverse().slice(1, -1)];
  return local.map(([x, y]) => [ax + x * ca - y * sa, ay + x * sa + y * ca]);
}
function stalk(def, index) {
  const grains = [];
  const ts = [0.5, 0.63, 0.76, 0.88];
  ts.forEach((t, k) => {
    const [x, y] = qb(def.p0, def.p1, def.p2, t);
    const [dx, dy] = qd(def.p0, def.p1, def.p2, t);
    const a = (Math.atan2(dy, dx) * 180) / Math.PI;
    const len = 19 - k * 1.6, wid = 7.6 - k * 0.5;
    [-1, 1].forEach((side) => {
      grains.push({ pts: grainPoly(x, y, a + side * 30, len, wid), at: [x, y], tone: (k + (side > 0 ? 1 : 0) + index) % 2 });
    });
  });
  const [tx, ty] = def.p2;
  const [dx, dy] = qd(def.p0, def.p1, def.p2, 1);
  grains.push({ pts: grainPoly(tx, ty, (Math.atan2(dy, dx) * 180) / Math.PI, 15, 6.4), at: [tx, ty], tone: index % 2 });
  return { base: def.p0, stem: stemPoly(def), grains };
}

// ── Wordmark: heavy geometric caps, cap height 90, y 60 → 150 ─────────────
const LETTERS = {
  S: { w: 66, outer: [[18,0],[66,0],[58,21],[24,21],[24,34],[50,34],[66,48],[66,74],[50,90],[0,90],[8,69],[42,69],[42,56],[16,56],[0,42],[0,16]] },
  H: { w: 70, outer: [[0,0],[24,0],[24,34],[46,34],[46,0],[70,0],[70,90],[46,90],[46,56],[24,56],[24,90],[0,90]] },
  A: { w: 78, outer: [[28,0],[50,0],[78,90],[54,90],[49.5,74],[28.5,74],[24,90],[0,90]], holes: [[[33.5,56],[44.5,56],[39,35]]] },
  N: { w: 70, outer: [[0,0],[22,0],[48,48],[48,0],[70,0],[70,90],[48,90],[22,42],[22,90],[0,90]] },
  T: { w: 68, outer: [[0,0],[68,0],[68,22],[46,22],[46,90],[22,90],[22,22],[0,22]] },
  Z: { w: 66, outer: [[0,0],[66,0],[66,21],[31,69],[66,69],[58,90],[0,90],[0,69],[35,21],[8,21]] },
};
const WORD_X = 200, WORD_Y = 60, GAP = 8, CAP = 90;
function wordmark() {
  const out = [];
  let x = WORD_X;
  for (const ch of "SHANTAZ") {
    const L = LETTERS[ch];
    const mv = (p) => p.map(([a, b]) => [a + x, b + WORD_Y]);
    out.push({ ch, x, w: L.w, outer: mv(L.outer), holes: (L.holes || []).map(mv) });
    x += L.w + GAP;
  }
  return out;
}

// ── ® : ring + small R, top right of the Z ────────────────────────────────
function registered(word) {
  const z = word[word.length - 1];
  const cx = z.x + z.w + 11, cy = WORD_Y + 9, R1 = 8.6, R0 = 7.1;
  const circle = (r, rev) => {
    const p = [];
    for (let i = 0; i < 40; i++) p.push(polar(cx, cy, r, (rev ? -1 : 1) * i * 9));
    return p;
  };
  const s = 0.82, ox = cx - 4.3 * s * 1.0, oy = cy - 6 * s;
  const m = (p) => p.map(([a, b]) => [ox + a * s, oy + b * s]);
  return [
    { outer: circle(R1), holes: [circle(R0, true)] },
    { outer: m([[0,0],[7,0],[10,3],[10,5.6],[7.6,7.6],[10.6,12],[7.8,12],[5.2,8],[2.4,8],[2.4,12],[0,12]]),
      holes: [m([[2.4,2],[6.4,2],[7.6,3.2],[7.6,4.8],[6.4,6],[2.4,6]])] },
  ];
}

// ── Tagline: Droid Serif caps, tracked to run from under the H to the Z ───
const TAG_SIZE = 15.5;
function tagline(word) {
  const res = taglineFont.resolution || 1000;
  const sc = TAG_SIZE / res;
  const x0 = word[1].x + 2;                       // under the H
  const x1 = word[word.length - 1].x + word[word.length - 1].w; // to the end of the Z
  const chars = TAGLINE.split("");
  const adv = chars.map((c) => (c === " " ? 0.3 * res : taglineFont.glyphs[c].ha) * sc);
  const natural = adv.reduce((a, b) => a + b, 0);
  const track = (x1 - x0 - natural + (adv[adv.length - 1] - (taglineFont.glyphs.E.x_max * sc))) / (chars.length - 1);
  const baseline = WORD_Y + CAP + 14 + TAG_SIZE * 0.95;
  let x = x0;
  const glyphs = [];
  chars.forEach((c, i) => {
    if (c !== " ") glyphs.push({ ch: c, x, y: baseline, d: glyphPath(c, x, baseline, sc) });
    x += adv[i] + track;
  });
  return { size: TAG_SIZE, baseline, x0, x1, glyphs, font: taglineFont };
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
  const gear = { outer: gearOutline(), ring: gearRing(), center: GEAR_C };
  const wheat = STALKS.map(stalk);
  const reg = registered(word);
  const tag = tagline(word);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (pts) => pts.forEach(([x, y]) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); });
  grow(gear.outer); wheat.forEach((s) => s.grains.forEach((g) => grow(g.pts))); word.forEach((l) => grow(l.outer)); reg.forEach((r) => grow(r.outer));
  maxY = Math.max(maxY, tag.baseline + 2);
  const pad = 6;
  cache = { gear, wheat, word, reg, tag, box: { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 } };
  return cache;
}
