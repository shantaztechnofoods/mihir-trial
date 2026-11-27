// Overlap guard (2026-11-27). LOCAL TEST DATA ONLY.
// Rule from the handler: NOTHING may overlap anywhere at any width. For an admin,
// open every page the sidebar lists at 1440, 1024, 768 and 390 and assert 0 real
// overlaps, found two ways:
//   1. sibling boxes: any two visible children of one parent whose boxes intersect
//      (inline elements are measured per line box, so a wrapped <span> is not one big box);
//   2. leaf content: any visible text run or control (button, link, field, image, icon)
//      that covers a text run or control of another element, after clipping by every
//      overflow box (so ellipsis-truncated text and inner scroll areas count only where shown).
// A 1px touch is not an overlap (borders and sub-pixel rounding).
//
// INTENDED overlaps, excluded on purpose (each one is a design, not a bug):
//   A. badges and dots: an absolutely positioned child no bigger than 24x24 on its sibling
//      (bell count, avatar online dot, status dot on a section icon);
//   B. field adornments: an absolutely positioned icon or caret inside an input's wrapper
//      (search glyph on the left, ▾ on a picker); the field pads its text clear of it;
//   C. decoration: an absolutely positioned element with no text and no control inside it
//      (the rack crate handle drawn on the crate's top edge);
//   D. fixed / sticky chrome above scrolled content: the two boxes sit in different
//      fixed/sticky layers (mobile tab bar, sticky page header) — content scrolls under them;
//   E. focus rings: drawn with outline / box-shadow, which never enter a layout box.
// Anything else that intersects fails, with page, width, both elements and the overlap size.
import fs from "fs";
import pw from "/usr/local/lib/node_modules_global/playwright/index.js";
import { BASE, makeOk, track } from "./lib/helpers.mjs";
const src = fs.readFileSync(new URL("./go-live-workflows.mjs", import.meta.url), "utf8");
const seedSrc = src.match(/const seed = \(\) => \{[\s\S]*?\n\};\n/)[0].replace("const seed = ", "").replace(/;\s*$/, "");
const { ok, done } = makeOk();
const b = track(await pw.chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] }));
const WIDTHS = [1440, 1024, 768, 390];

// Runs inside the page. Returns [{ kind, a, b, w, h }] for every real overlap.
const probe = () => {
  const MIN = 1;
  const cls = (el) => (el.className?.baseVal ?? el.className ?? "").toString().trim().split(/\s+/).filter(Boolean).slice(0, 4).join(".");
  const desc = (el) => { const t = (el.getAttribute("aria-label") || el.innerText || el.value || "").trim().replace(/\s+/g, " ").slice(0, 40); return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${cls(el) ? "." + cls(el) : ""} "${t}"`; };
  const shown = (el) => { for (let a = el; a && a !== document.documentElement; a = a.parentElement) { const s = getComputedStyle(a); if (s.display === "none" || s.visibility === "hidden" || +s.opacity === 0) return false; } return true; };
  const skip = (el) => !!el.closest("#erp-build-badge, script, style, template");
  const CTL = "button,a,input,select,textarea,img,svg,[role=button]";
  const isAbs = (el) => { const p = getComputedStyle(el).position; return p === "absolute" || p === "fixed"; };
  const hasText = (el) => !!(el.innerText || "").trim();
  const isField = (el) => /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
  const inter = (a, c) => [Math.min(a.right, c.right) - Math.max(a.left, c.left), Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top)];
  // A/B/C: is this absolutely positioned element an intended badge, adornment or decoration?
  const intendedAbs = (el, other) => {
    if (!isAbs(el)) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 24 && r.height <= 24) return true;                                         // A
    if (other && (isField(other) || other.querySelector?.("input,select,textarea")) && !el.querySelector(CTL.replace(",svg", "").replace(",img", ""))) return true; // B
    if (!hasText(el) && !el.matches(CTL) && !el.querySelector("button,a,input,select,textarea,[role=button]")) return true; // C
    return false;
  };
  const absAncestor = (el, stop) => { for (let a = el; a && a !== stop; a = a.parentElement) if (isAbs(a)) return a; return null; };
  const layer = (el) => { for (let a = el; a && a !== document.body; a = a.parentElement) { const p = getComputedStyle(a).position; if (p === "fixed" || p === "sticky") return a; } return null; };
  const clip = (el, self) => { let r = { left: -1e9, top: -1e9, right: 1e9, bottom: 1e9 }; for (let a = self ? el : el.parentElement; a && a !== document.body; a = a.parentElement) { const s = getComputedStyle(a); if (s.overflowX !== "visible" || s.overflowY !== "visible") { const q = a.getBoundingClientRect(); r = { left: Math.max(r.left, q.left), top: Math.max(r.top, q.top), right: Math.min(r.right, q.right), bottom: Math.min(r.bottom, q.bottom) }; } if (s.position === "fixed") break; } return r; };
  const cut = (r, c) => ({ left: Math.max(r.left, c.left), top: Math.max(r.top, c.top), right: Math.min(r.right, c.right), bottom: Math.min(r.bottom, c.bottom) });
  const out = [];
  // 1. sibling boxes
  const boxesOf = (el) => (getComputedStyle(el).display === "inline" ? [...el.getClientRects()] : [el.getBoundingClientRect()]).filter((r) => r.width > 0 && r.height > 0);
  for (const parent of document.body.querySelectorAll("*")) {
    if (parent.closest("svg") || skip(parent) || parent.children.length < 2 || !shown(parent)) continue;
    const kids = [...parent.children].filter((k) => !skip(k) && shown(k)).map((k) => ({ k, rs: boxesOf(k) })).filter((x) => x.rs.length);
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const A = kids[i], B = kids[j];
      if (intendedAbs(A.k, B.k) || intendedAbs(B.k, A.k) || layer(A.k) !== layer(B.k)) continue;
      let best = null;
      for (const ra of A.rs) for (const rb of B.rs) { const [w, h] = inter(ra, rb); if (w > MIN && h > MIN && (!best || w * h > best[0] * best[1])) best = [w, h]; }
      if (best) out.push({ kind: "sibling", a: desc(A.k), b: desc(B.k), w: Math.round(best[0]), h: Math.round(best[1]) });
    }
  }
  // 2. leaf content (text runs + controls), clipped by overflow boxes
  const leaves = [];
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = tw.nextNode());) {
    const el = n.parentElement; if (!n.textContent.trim() || !el || el.closest("svg, option") || skip(el) || !shown(el)) continue;
    const rg = document.createRange(); rg.selectNodeContents(n); const c = clip(el, true);
    for (const r of rg.getClientRects()) { const q = cut(r, c); if (q.right - q.left > MIN && q.bottom - q.top > MIN) leaves.push({ el, ...q }); }
  }
  for (const el of document.body.querySelectorAll(CTL)) {
    if (el.parentElement?.closest("svg") || skip(el) || !shown(el)) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue; const q = cut(r, clip(el, false));
    if (q.right - q.left > MIN && q.bottom - q.top > MIN) leaves.push({ el, ...q });
  }
  leaves.sort((x, y) => x.left - y.left);
  const seen = new Set();
  for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length && leaves[j].left < leaves[i].right - MIN; j++) {
    const A = leaves[i], B = leaves[j];
    if (A.el === B.el || A.el.contains(B.el) || B.el.contains(A.el)) continue;
    const [w, h] = inter(A, B); if (w <= MIN || h <= MIN) continue;
    if (layer(A.el) !== layer(B.el)) continue;                                                // D
    // A/B/C: one side lives in an intended absolutely positioned badge / adornment / decoration
    let p = A.el.parentElement; while (p && !p.contains(B.el)) p = p.parentElement;           // common ancestor
    const aa = absAncestor(A.el, p), ab = absAncestor(B.el, p);
    if ((aa && intendedAbs(aa, ab || B.el)) || (ab && intendedAbs(ab, aa || A.el))) continue;
    const key = desc(A.el) + "|" + desc(B.el); if (seen.has(key)) continue; seen.add(key);
    out.push({ kind: "content", a: desc(A.el), b: desc(B.el), w: Math.round(w), h: Math.round(h) });
  }
  return out;
};

for (const W of WIDTHS) {
  const mobile = W < 600;
  const ctx = await b.newContext({ viewport: { width: W, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
  await p.goto(BASE, { waitUntil: "networkidle" }); await p.evaluate(`(${seedSrc})()`); await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(500);
  await p.locator("#login-username").fill("admin"); await p.locator("#login-password").click(); await p.locator("#login-password").fill("admin123");
  await p.getByRole("button", { name: "Sign In" }).click(); await p.locator("#login-username").waitFor({ state: "detached", timeout: 15000 }); await p.waitForTimeout(1200);
  // hide the toast strip and stop motion, so boxes are measured at rest
  await p.addStyleTag({ content: ".fixed.bottom-0.inset-x-0.z-\\[200\\]{display:none!important} *,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important}" });
  const openNav = async () => { const m = p.locator('[aria-label="All pages"]:visible'); if (await m.count()) { await m.first().click(); await p.waitForTimeout(400); } };
  await openNav();
  const pages = [...new Set((await p.locator("aside button.sb-item:visible").allInnerTexts()).map((l) => l.split("\n")[0].trim()).filter(Boolean))];
  if (mobile) { await p.keyboard.press("Escape"); await p.waitForTimeout(300); }
  ok(`${W}: sidebar lists the pages`, pages.length >= 10, pages.join(" | "));
  for (const label of pages) {
    await openNav();
    await p.locator("aside button.sb-item:visible").filter({ hasText: label }).first().click();
    await p.waitForTimeout(1300);
    if (mobile && await p.locator(".nav-backdrop:visible").count()) { await p.keyboard.press("Escape"); await p.waitForTimeout(300); }
    await p.evaluate(() => window.scrollTo(0, 0));
    const hits = await p.evaluate(probe);
    ok(`${W}: ${label} — 0 overlaps`, hits.length === 0, hits.slice(0, 6).map((h) => `[${h.kind}] ${h.a} <> ${h.b} ${h.w}x${h.h}px`).join(" ; "));
    if (mobile) {   // phone: every header action holds its own content (the bell badge once stuck 6px out of a 50px box)
      const spill = await p.evaluate(() => [...document.querySelectorAll(".page-header .page-header-actions > button")].filter((el) => el.offsetParent && el.scrollWidth > el.clientWidth + 1).map((el) => `${(el.getAttribute("aria-label") || el.innerText).trim().slice(0, 30)} ${el.scrollWidth}>${el.clientWidth}`));
      ok(`${W}: ${label} — header buttons hold their content`, spill.length === 0, spill.join(" ; "));
    }
  }
  ok(`${W}: no page errors`, errs.length === 0, errs.join(" | "));
  await ctx.close();
}
await done(b);
