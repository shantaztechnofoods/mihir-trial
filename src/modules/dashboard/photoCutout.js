// src/modules/dashboard/photoCutout.js — BOM photo → cut-out for the Dashboard 3D view (2026-11-06).
// The white background around a machine photo is removed in a canvas at runtime:
// a flood fill from the photo's border over near-white (or already transparent)
// pixels, so white parts INSIDE the machine stay. Cached per URL. If the image
// server does not allow CORS, the canvas cannot be read → the photo is used as a
// plain billboard (no cut-out). If the photo does not load at all → null, and the
// scene shows the neutral "No photo · add in BOM" placeholder.

const cache = new Map();
const MAX_SIDE = 2048; // v6: the photo's own full resolution (up to 2048 px) for the bigger machines (was 1024)

// Pure: clears the background in an RGBA pixel array (Uint8ClampedArray) in place.
// Returns the number of pixels made transparent.
export function cutWhiteBackground(px, w, h, { threshold = 232, spread = 26 } = {}) {
  const isBg = (i) => {
    const o = i * 4, a = px[o + 3];
    if (a < 16) return true;
    const r = px[o], g = px[o + 1], b = px[o + 2];
    const lo = Math.min(r, g, b), hi = Math.max(r, g, b);
    return lo >= threshold && hi - lo <= spread;
  };
  const seen = new Uint8Array(w * h);
  const stack = [];
  const push = (i) => { if (!seen[i] && isBg(i)) { seen[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  let cleared = 0;
  while (stack.length) {
    const i = stack.pop(); px[i * 4 + 3] = 0; cleared++;
    const x = i % w, y = (i - x) / w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  // Soft 1-px edge: light pixels touching the cleared background become half see-through.
  for (let i = 0; i < w * h; i++) {
    if (seen[i]) continue;
    const x = i % w;
    const near = (x > 0 && seen[i - 1]) || (x < w - 1 && seen[i + 1]) || (i >= w && seen[i - w]) || (i + w < w * h && seen[i + w]);
    if (near) { const o = i * 4; if (Math.min(px[o], px[o + 1], px[o + 2]) >= 200) px[o + 3] = Math.min(px[o + 3], 128); }
  }
  return cleared;
}

// Pure: the box around the visible (alpha > 24) pixels, with a 2-px margin; null when empty.
export function alphaBounds(px, w, h, pad = 2) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function loadImage(src, cors) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    if (cors) im.crossOrigin = "anonymous";
    im.decoding = "async";
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("photo did not load"));
    im.src = src;
  });
}

async function build(src) {
  const local = /^(data|blob):/i.test(src);
  let im;
  try { im = await loadImage(src, !local); } catch {
    // No CORS (or a one-off error): try once more as a plain image billboard.
    try { const plain = await loadImage(src, false); return { image: plain, aspect: plain.naturalWidth / plain.naturalHeight || 1.4, cut: false }; } catch { return null; }
  }
  const nw = im.naturalWidth || 1, nh = im.naturalHeight || 1;
  const s = Math.min(1, MAX_SIDE / Math.max(nw, nh));
  const w = Math.max(1, Math.round(nw * s)), h = Math.max(1, Math.round(nh * s));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) return { image: im, aspect: nw / nh, cut: false };
  g.drawImage(im, 0, 0, w, h);
  let data;
  try { data = g.getImageData(0, 0, w, h); } catch { return { image: im, aspect: nw / nh, cut: false }; } // tainted canvas
  cutWhiteBackground(data.data, w, h);
  g.putImageData(data, 0, 0);
  // v6: trim the now-empty margin so the machine fills its card (bigger on screen).
  const b = alphaBounds(data.data, w, h);
  if (!b || (b.w >= w - 2 && b.h >= h - 2)) return { image: c, aspect: w / h, cut: true };
  const t = document.createElement("canvas"); t.width = b.w; t.height = b.h;
  const tg = t.getContext("2d"); if (!tg) return { image: c, aspect: w / h, cut: true };
  tg.drawImage(c, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
  return { image: t, aspect: b.w / b.h, cut: true };
}

// → Promise<{ image, aspect, cut } | null>
export function cutoutPhoto(src) {
  const url = typeof src === "string" ? src.trim() : "";
  if (!url) return Promise.resolve(null);
  if (!cache.has(url)) cache.set(url, build(url).catch(() => null));
  return cache.get(url);
}
