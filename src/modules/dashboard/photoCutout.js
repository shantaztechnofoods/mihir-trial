// src/modules/dashboard/photoCutout.js — BOM photo → cut-out for the Dashboard 3D view (2026-11-06).
// The white background around a machine photo is removed in a canvas at runtime:
// a flood fill from the photo's border over near-white (or already transparent)
// pixels, so white parts INSIDE the machine stay. Cached per URL. If the image
// server does not allow CORS, the canvas cannot be read → the photo is used as a
// plain billboard (no cut-out). If the photo does not load at all → null, and the
// scene shows the neutral "No photo · add in BOM" placeholder.

const cache = new Map();
const MAX_SIDE = 1024; // crisp at DPR 2 (review 2026-11-06; was 512)

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
  return { image: c, aspect: w / h, cut: true };
}

// → Promise<{ image, aspect, cut } | null>
export function cutoutPhoto(src) {
  const url = typeof src === "string" ? src.trim() : "";
  if (!url) return Promise.resolve(null);
  if (!cache.has(url)) cache.set(url, build(url).catch(() => null));
  return cache.get(url);
}
