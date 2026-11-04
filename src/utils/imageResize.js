// Shrink camera / gallery photos in the browser before upload.
//
// Phones hand us 4000-8000 px photos of 5-50 MB. Every photo is now resized
// to at most 2000 px on the long edge and saved as JPEG (quality 0.85) —
// typically 300-900 KB. Rules:
//   * never upscale; a photo already ≤ 2000 px and ≤ 1.5 MB is left alone;
//   * a small PNG (≤ 1.5 MB, e.g. a screenshot) is kept as PNG, untouched;
//     a big PNG with transparency is resized but kept PNG; a big opaque PNG
//     becomes JPEG;
//   * EXIF orientation: the image is decoded with imageOrientation
//     "from-image" (and <img> applies it by default), so the pixels drawn are
//     already upright; the new file carries no EXIF, so it cannot be rotated
//     twice;
//   * anything that cannot be decoded (HEIC on desktop, PDF, video…) or any
//     error → the original file is returned unchanged; if the result is not
//     smaller than the original, the original is kept.

export const MAX_EDGE = 2000;
export const JPEG_QUALITY = 0.85;
export const SMALL_BYTES = 1.5 * 1024 * 1024;

const RESIZABLE = /^image\/(jpe?g|png|webp)$/i;

export function isResizableImage(file) {
  return !!(file && RESIZABLE.test(file.type || ""));
}

// Target size for a width/height: long edge ≤ maxEdge, aspect kept, never upscaled.
export function targetSize(width, height, maxEdge = MAX_EDGE) {
  const w = Math.max(1, Math.round(width || 0)), h = Math.max(1, Math.round(height || 0));
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale };
}

// Decide what to do with a photo. Pure — unit tested.
//   meta = { type, size, width, height, hasAlpha }
//   → { action: "keep" } | { action: "resize", width, height, outType }
export function planResize(meta, maxEdge = MAX_EDGE) {
  const { type = "", size = 0, width = 0, height = 0, hasAlpha = false } = meta || {};
  if (!RESIZABLE.test(type) || !width || !height) return { action: "keep", reason: "not-image" };
  const isPng = /png$/i.test(type);
  const t = targetSize(width, height, maxEdge);
  if (t.scale >= 1 && size <= SMALL_BYTES) return { action: "keep", reason: "already-small" };
  if (isPng && size <= SMALL_BYTES) return { action: "keep", reason: "small-png" };
  const outType = isPng && hasAlpha ? "image/png" : "image/jpeg";
  return { action: "resize", width: t.width, height: t.height, outType };
}

export function renameForType(name, outType) {
  const base = String(name || "photo").replace(/\.[^./\\]+$/, "") || "photo";
  return `${base}.${outType === "image/png" ? "png" : "jpg"}`;
}

async function decode(file) {
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { /* try <img> */ }
  }
  if (typeof document === "undefined" || typeof URL === "undefined") return null;
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error("decode failed"));
      img.src = url;
    });
  } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
}

function hasTransparency(ctx, w, h) {
  try {
    const d = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < d.length; i += 4 * 7) if (d[i] < 255) return true;   // sampled
  } catch { /* tainted / unsupported → assume opaque */ }
  return false;
}

/**
 * Returns a smaller File for big photos, or the original file.
 * Never throws.
 */
export async function shrinkImageFile(file, { maxEdge = MAX_EDGE, quality = JPEG_QUALITY } = {}) {
  try {
    if (!isResizableImage(file)) return file;
    if (typeof document === "undefined") return file;
    const img = await decode(file);
    if (!img) return file;
    const w0 = img.width || img.naturalWidth, h0 = img.height || img.naturalHeight;
    const isPng = /png$/i.test(file.type);
    let plan = planResize({ type: file.type, size: file.size, width: w0, height: h0, hasAlpha: false }, maxEdge);
    if (plan.action === "keep") { if (img.close) img.close(); return file; }
    const canvas = document.createElement("canvas");
    canvas.width = plan.width; canvas.height = plan.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) { if (img.close) img.close(); return file; }
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, plan.width, plan.height);
    if (img.close) img.close();
    if (isPng && hasTransparency(ctx, plan.width, plan.height)) {
      plan = planResize({ type: file.type, size: file.size, width: w0, height: h0, hasAlpha: true }, maxEdge);
    }
    if (plan.outType === "image/jpeg") {
      // JPEG has no alpha: paint white behind the photo.
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, plan.width, plan.height);
      ctx.globalCompositeOperation = "source-over";
    }
    const blob = await new Promise((res) => canvas.toBlob(res, plan.outType, quality));
    if (!blob || blob.size >= file.size) return file;
    const out = new File([blob], renameForType(file.name, plan.outType), { type: plan.outType, lastModified: Date.now() });
    console.info("[photo] resized", { from: `${w0}x${h0} ${Math.round(file.size / 1024)}KB`, to: `${plan.width}x${plan.height} ${Math.round(out.size / 1024)}KB` });
    return out;
  } catch (e) {
    console.warn("[photo] resize skipped", e);
    return file;
  }
}
