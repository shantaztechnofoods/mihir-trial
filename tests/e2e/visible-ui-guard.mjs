// Visible-UI guard (2026-11-27). LOCAL TEST DATA ONLY.
// Handler's rule after the glass look turned "+ New PO" / "Create Vendor PO" into empty
// white pills: an agent keeps checking the WHOLE ERP for things a person cannot see.
// For an admin, every page the sidebar lists AND every pop-up its header actions open,
// at 1440, 1024, 768 and 390, in light AND dark, must have:
//   (a) contrast  — every button, link, tab or chip with text: text vs its own computed
//                   background >= 3:1, and the text is really visible (not opacity 0,
//                   not the same colour, not clipped out of its box);
//   (b) names     — every icon-only button / link has an aria-label (or aria-labelledby);
//   (c) headers   — a truncated key header (h1-h4, table header, dialog / page title)
//                   carries a title or tooltip with the full text;
//   (d) viewport  — no sideways page scroll, no element sticking out past the screen edge
//                   (unless an inner scroller clips it);
//   (e) images    — no broken <img>, no <use> pointing at a missing icon, no image / font
//                   request that failed.
// Disabled controls are exempt from (a) (WCAG 1.4.3 "inactive components").
// Background = every background layer of the element and its ancestors composited
// bottom-up (gradients as the mean of their stops, the glass alpha included), so a
// white-on-white glass capsule measures ~1:1 exactly as a person sees it.
// The theme is switched with the app's own Light / Dark switch, so one page load (and one
// opened pop-up) is measured in both themes.
// Env: VUG_WIDTHS="1440 390"  VUG_THEMES="light"  (dev only, CI runs everything)
//      VUG_OUT=/path/report.json  SHOT_DIR=/dir (PNG of every page / pop-up with a finding)
import fs from "fs";
import pw from "/usr/local/lib/node_modules_global/playwright/index.js";
import { BASE, makeOk, track, settle } from "./lib/helpers.mjs";
const src = fs.readFileSync(new URL("./go-live-workflows.mjs", import.meta.url), "utf8");
const seedSrc = src.match(/const seed = \(\) => \{[\s\S]*?\n\};\n/)[0].replace("const seed = ", "").replace(/;\s*$/, "");
const { ok, done } = makeOk();
const b = track(await pw.chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] }));
const WIDTHS = (process.env.VUG_WIDTHS || "1440 1024 768 390").split(/\s+/).filter(Boolean).map(Number);
const THEMES = (process.env.VUG_THEMES || "light dark").split(/\s+/).filter(Boolean);
const SHOTS = process.env.SHOT_DIR || "";
// Header actions that change data, leave the app or open the OS print / file dialog are
// never clicked; everything else in a page header is a pop-up candidate.
const NO_CLICK = /delete|remove|reset|clear|log ?out|sign ?out|export|print|download|pdf|excel|csv|backup|restore|sync|refresh|reload|undo|light|dark|theme|approve|reject|mark|save|submit|send|whatsapp|share/i;

// ── Runs inside the page. Returns [{ k: "a|b|c|d|e", what }] ──────────────────────────
const probe = () => {
  const out = [];
  const W = innerWidth;
  const cvs = document.createElement("canvas"); cvs.width = cvs.height = 1; const cx = cvs.getContext("2d", { willReadFrequently: true });
  const cache = new Map();
  const rgba = (str) => {   // any CSS colour -> [r,g,b,a] in sRGB (canvas does the conversion)
    if (!str || str === "transparent" || str === "none") return [0, 0, 0, 0];
    if (cache.has(str)) return cache.get(str);
    let m = str.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/), v;
    if (m) v = [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
    else { cx.clearRect(0, 0, 1, 1); cx.fillStyle = "rgba(0,0,0,0)"; cx.fillStyle = str; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; v = [d[0], d[1], d[2], d[3] / 255]; }
    cache.set(str, v); return v;
  };
  const over = (top, bot) => { const a = top[3] + bot[3] * (1 - top[3]); if (a <= 0) return [0, 0, 0, 0]; return [0, 1, 2].map((i) => (top[i] * top[3] + bot[i] * bot[3] * (1 - top[3])) / a).concat(a); };
  const COLOR = /rgba?\([^()]*\)|color\([^()]*\)|oklch\([^()]*\)|oklab\([^()]*\)|hsla?\([^()]*\)|#[0-9a-f]{3,8}\b|\btransparent\b/gi;
  const LAYER = /(?:repeating-)?(?:linear|radial|conic)-gradient\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)|url\((?:[^()]|\([^()]*\))*\)/g;
  // background layers of one element, top first; null = an image we cannot measure
  const layersOf = (s) => {
    const ls = [];
    if (s.backgroundImage && s.backgroundImage !== "none") for (const L of s.backgroundImage.match(LAYER) || []) {
      if (L.startsWith("url(")) return null;
      const stops = (L.match(COLOR) || []).map(rgba); if (!stops.length) continue;
      const a = stops.reduce((t, c) => t + c[3], 0) / stops.length;
      const rgb = [0, 1, 2].map((i) => (a ? stops.reduce((t, c) => t + c[i] * c[3], 0) / stops.reduce((t, c) => t + c[3], 0) : 0));
      ls.push([...rgb, a]);
    }
    ls.push(rgba(s.backgroundColor));
    return ls;
  };
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  const canvasBg = () => { const h = rgba(getComputedStyle(document.documentElement).backgroundColor); return h[3] >= 0.99 ? h : over(h, dark ? [18, 18, 18, 1] : [255, 255, 255, 1]); };
  // effective background behind `el`; also the opacity between el and that background
  const bgOf = (el) => {
    const stack = []; let op = 1, solid = false;
    for (let a = el; a && a.nodeType === 1; a = a.parentElement) {
      const s = getComputedStyle(a);
      const ls = layersOf(s); if (ls === null) return null;
      stack.push(...ls);
      if (stack.reduce((t, c) => Math.max(t, c[3]), 0) >= 0.99 && ls.some((c) => c[3] >= 0.99)) { solid = true; break; }
      op *= +s.opacity;
    }
    let c = solid ? [0, 0, 0, 0] : canvasBg();
    for (let i = stack.length - 1; i >= 0; i--) c = over(stack[i], c);
    return { c, op };
  };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (x, y) => { const a = lum(x), b2 = lum(y); return (Math.max(a, b2) + 0.05) / (Math.min(a, b2) + 0.05); };
  const hex = (c) => "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  const cls = (el) => (el.className?.baseVal ?? el.className ?? "").toString().trim().split(/\s+/).filter(Boolean).slice(0, 3).join(".");
  const label = (el) => (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 40);
  const desc = (el) => `${el.tagName.toLowerCase()}${cls(el) ? "." + cls(el) : ""} "${label(el)}"`;
  const where = (el) => { const d = el.closest(".modal-backdrop, [role=dialog], [aria-modal=true]"); if (d) return "dialog"; if (el.closest("aside, .app-sidebar, .mobile-tabbar")) return "nav"; if (el.closest(".page-header, header")) return "header"; return "page"; };
  const skip = (el) => !!el.closest("#erp-build-badge, script, style, template, noscript, canvas, [aria-hidden=true], [inert], .sr-only, .wu-reveal:not(.wu-in), .fixed.bottom-0.inset-x-0.z-\\[200\\]");   // .wu-reveal: a card below the fold waiting to rise in (worldMotion)
  const shown = (el) => { for (let a = el; a && a !== document.documentElement; a = a.parentElement) { const s = getComputedStyle(a); if (s.display === "none" || s.visibility === "hidden" || s.contentVisibility === "hidden") return false; } return true; };
  const opacityChain = (el) => { let o = 1; for (let a = el; a && a !== document.documentElement; a = a.parentElement) o *= +getComputedStyle(a).opacity; return o; };
  const tiny = (r) => r.width <= 1 || r.height <= 1;
  // a nav drawer / sheet that is closed sits fully off-screen: everything in it is not on screen
  const offscreen = (r) => r.right <= 0 || r.left >= W || r.bottom <= 0 || r.top >= innerHeight + 4000;
  const disabled = (el) => !!el.closest(":disabled, [aria-disabled=true], fieldset[disabled]");
  const INTERACTIVE = "button, a, [role=button], [role=tab], [role=link], [role=menuitem], [role=option], [role=switch], summary, select";
  // a chip: a small inline box with its own fill and rounded corners, holding only text
  const chipOf = (el) => {
    for (let a = el, n = 0; a && n < 3; a = a.parentElement, n++) {
      const s = getComputedStyle(a); if (!/inline/.test(s.display) && !/chip|badge|pill|tag|status/i.test(cls(a))) continue;
      const r = a.getBoundingClientRect(); if (r.height > 40 || r.width > 320) continue;
      if (rgba(s.backgroundColor)[3] > 0.05 || (s.backgroundImage !== "none" && !s.backgroundImage.startsWith("url"))) return a;
    }
    return null;
  };
  const seen = new Set();
  const add = (k, el, what) => { const key = k + "|" + what; if (seen.has(key)) return; seen.add(key); out.push({ k, at: where(el), what }); };

  // (a) contrast + invisible text, per text run inside a control or chip
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = tw.nextNode());) {
    const t = n.textContent.trim(); const el = n.parentElement;
    if (!t || !el || el.closest("svg, option") || skip(el)) continue;
    const ctl = el.closest(INTERACTIVE) || chipOf(el); if (!ctl || disabled(ctl) || !shown(el)) continue;
    const rg = document.createRange(); rg.selectNodeContents(n); const rr = rg.getBoundingClientRect();
    if (tiny(rr) || offscreen(rr)) continue;
    const cr = ctl.getBoundingClientRect(); if (tiny(cr) || offscreen(cr)) continue;
    const s = getComputedStyle(el);
    // clipped out: the text run lies (almost) wholly outside its control's visible box
    let vis = { l: -1e9, t: -1e9, r: 1e9, b: 1e9 };
    for (let a = el; a && a !== document.body; a = a.parentElement) { const q = getComputedStyle(a); if (q.overflowX !== "visible" || q.overflowY !== "visible") { const b = a.getBoundingClientRect(); vis = { l: Math.max(vis.l, b.left), t: Math.max(vis.t, b.top), r: Math.min(vis.r, b.right), b: Math.min(vis.b, b.bottom) }; } if (a === ctl) break; }
    const iw = Math.min(vis.r, rr.right) - Math.max(vis.l, rr.left), ih = Math.min(vis.b, rr.bottom) - Math.max(vis.t, rr.top);
    if (iw < Math.min(4, rr.width / 2) || ih < rr.height / 3) { add("a", ctl, `text clipped out of sight: ${desc(ctl)}`); continue; }
    const op = opacityChain(el);
    if (op < 0.15) { add("a", ctl, `text invisible (opacity ${op.toFixed(2)}): ${desc(ctl)}`); continue; }
    let fg = rgba(s.webkitTextFillColor && s.webkitTextFillColor !== s.color ? s.webkitTextFillColor : s.color);
    let clipText = false;
    for (let a = el; a && a !== ctl.parentElement; a = a.parentElement) { const q = getComputedStyle(a); if (q.backgroundClip === "text" || q.webkitBackgroundClip === "text") { clipText = true; break; } }
    if (clipText) continue;   // gradient-filled text: the fill IS the text colour, nothing to compare
    const bg = bgOf(el); if (!bg) continue;   // a photo / pattern behind: not measurable here
    fg = [...fg.slice(0, 3), fg[3] * Math.min(1, bg.op)];
    const shownFg = over(fg, bg.c);
    const r = ratio(shownFg, bg.c);
    if (r < 2.995) add("a", ctl, `contrast ${r.toFixed(2)}:1 (text ${hex(shownFg)} on ${hex(bg.c)}): ${desc(ctl)}`);
  }
  // text cut off inside a control with no ellipsis (half a word showing)
  for (const el of document.body.querySelectorAll(INTERACTIVE)) {
    if (skip(el) || !shown(el)) continue; const s = getComputedStyle(el); const r = el.getBoundingClientRect(); if (tiny(r) || offscreen(r)) continue;
    if (s.overflowX !== "visible" && s.textOverflow !== "ellipsis" && el.scrollWidth > el.clientWidth + 2 && !el.querySelector("[style*=ellipsis], .truncate") && !/auto|scroll/.test(s.overflowX) && (el.innerText || "").trim())
      add("a", el, `text cut off (${el.scrollWidth}px in ${el.clientWidth}px, no ellipsis): ${desc(el)}`);
  }

  // (b) icon-only controls need a name
  for (const el of document.body.querySelectorAll("button, a, [role=button], [role=tab], [role=link], [role=menuitem]")) {
    if (skip(el) || !shown(el)) continue; const r = el.getBoundingClientRect(); if (tiny(r) || offscreen(r)) continue;
    // innerText is "" inside a content-visibility:auto subtree the browser skipped (off-screen
    // cards): read the DOM text there instead
    let text = (el.innerText || "").trim();
    if (!text) for (let a = el; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).contentVisibility === "auto") { text = (el.textContent || "").trim(); break; }
    if (/[\p{L}\p{N}]/u.test(text)) continue;   // has a word or number to read out
    if ((el.getAttribute("aria-label") || "").trim() || el.getAttribute("aria-labelledby")) continue;
    const imgAlt = [...el.querySelectorAll("img[alt]")].some((i) => i.alt.trim());
    if (imgAlt) continue;
    add("b", el, `icon-only ${el.tagName.toLowerCase()} without aria-label${text ? ` (shows "${text.slice(0, 6)}")` : ""}${el.title ? ` (title "${el.title.slice(0, 30)}")` : ""}: ${el.tagName.toLowerCase()}.${cls(el)}`);
  }

  // (c) truncated key headers need the full text in a title / tooltip
  for (const el of document.body.querySelectorAll("h1, h2, h3, h4, th, [role=columnheader], .page-header h1 + *, .modal-title, [class*=modal] [class*=title]")) {
    if (skip(el) || !shown(el)) continue; const r = el.getBoundingClientRect(); if (tiny(r) || offscreen(r)) continue;
    const cands = [el, ...el.querySelectorAll("*")].filter((x) => { const s = getComputedStyle(x); return (s.textOverflow === "ellipsis" || s.webkitLineClamp !== "none" || s.overflowX === "hidden") && ((x.scrollWidth > x.clientWidth + 1) || (s.webkitLineClamp !== "none" && x.scrollHeight > x.clientHeight + 1)); });
    for (const x of cands) {
      const titled = [x, ...x.querySelectorAll("[title]")].some((y) => (y.getAttribute("title") || "").trim()) || !!x.closest("[title]") || !!x.closest("[data-tooltip], [aria-description]");
      if (!titled) { add("c", el, `header truncated without title: ${desc(el)} (${x.scrollWidth}px in ${x.clientWidth}px)`); break; }
    }
  }

  // (d) overflowing the viewport
  const sw = document.documentElement.scrollWidth;
  if (sw > W + 1) add("d", document.body, `page scrolls sideways (${sw}px wide on a ${W}px screen)`);
  const flagged = [];
  for (const el of document.body.querySelectorAll("*")) {
    if (el.closest("svg") && el.tagName !== "svg") continue;
    if (skip(el)) continue; const r = el.getBoundingClientRect(); if (tiny(r)) continue;
    if (!(r.right > W + 1 && r.left < W - 1) && !(r.left < -1 && r.right > 1)) continue;
    if (flagged.some((f) => f.contains(el))) continue;
    if (!shown(el)) continue;
    // clipped by an inner scroller / overflow box that itself fits on screen
    let clipped = false;
    for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.overflowX !== "visible") { const q = a.getBoundingClientRect(); if (q.right <= W + 1 && q.left >= -1) { clipped = true; break; } }
      if (s.position === "fixed") { const q = a.getBoundingClientRect(); if (offscreen(q)) { clipped = true; break; } }
    }
    if (clipped) continue;
    const s = getComputedStyle(el); if (s.position === "fixed" && offscreen(r)) continue;
    flagged.push(el);
    add("d", el, `sticks out of the ${W}px screen (${Math.round(r.left)}..${Math.round(r.right)}px): ${desc(el)}`);
  }

  // (e) broken images and icons
  for (const img of document.querySelectorAll("img")) {
    if (skip(img) || !shown(img)) continue;
    if (img.complete && img.naturalWidth === 0 && (img.currentSrc || img.getAttribute("src"))) add("e", img, `broken image: ${(img.currentSrc || img.getAttribute("src")).slice(0, 80)} (alt "${img.alt}")`);
    else if (!img.getAttribute("src") && !img.srcset) add("e", img, `image with no src (alt "${img.alt}")`);
  }
  for (const u of document.querySelectorAll("use")) {
    const h = u.getAttribute("href") || u.getAttribute("xlink:href") || "";
    if (h.startsWith("#") && !document.getElementById(h.slice(1))) add("e", u, `icon <use> points at missing #${h.slice(1)}`);
  }
  return out;
};

// theme switch through the app's own Light / Dark switch (any instance: one global mode),
// then wait until the swap has finished (theme.js removes html.theme-xf at idle)
const setTheme = async (p, t) => {
  await p.evaluate((t) => { const b = document.querySelector(`[data-theme-option="${t}"]`); if (b && b.getAttribute("aria-checked") !== "true") b.click(); }, t);
  await p.waitForFunction((t) => document.documentElement.getAttribute("data-theme") === t && !document.documentElement.classList.contains("theme-xf"), t, { timeout: 5000 }).catch(() => {});
  await settle(p, 400, 120);
};

const all = [];   // every finding: { k, W, theme, page, popup, at, what }
const keyCount = new Map();
const failedNet = [];
for (const W of WIDTHS) {
  const mobile = W < 600;
  const ctx = await b.newContext({ viewport: { width: W, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
  p.on("response", (r) => { const t = r.request().resourceType(); if ((t === "image" || t === "font") && r.status() >= 400) failedNet.push(`${W}: ${t} ${r.status()} ${r.url().slice(0, 100)}`); });
  p.on("requestfailed", (r) => { const t = r.resourceType(); if (t === "image" || t === "font") failedNet.push(`${W}: ${t} failed ${r.url().slice(0, 100)}`); });
  await p.goto(BASE, { waitUntil: "networkidle" }); await p.evaluate(`(${seedSrc})()`); await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(400);
  await p.locator("#login-username").fill("admin"); await p.locator("#login-password").click(); await p.locator("#login-password").fill("admin123");
  await p.getByRole("button", { name: "Sign In" }).click(); await p.locator("#login-username").waitFor({ state: "detached", timeout: 15000 }); await settle(p, 1500);
  // hide the local-only toast strip, stop motion so colours are measured at rest
  await p.addStyleTag({ content: ".fixed.bottom-0.inset-x-0.z-\\[200\\]{display:none!important} *,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important}" });
  const openNav = async () => { const m = p.locator('[aria-label="All pages"]:visible'); if (await m.count()) { await m.first().click(); await p.waitForTimeout(350); } };
  const closeNav = async () => { if (mobile && await p.locator(".nav-backdrop:visible").count()) { await p.keyboard.press("Escape"); await p.waitForTimeout(250); } };
  await openNav();
  const pages = [...new Set((await p.locator("aside button.sb-item:visible").allInnerTexts()).map((l) => l.split("\n")[0].trim()).filter(Boolean))];
  ok(`${W}: sidebar lists the pages`, pages.length >= 10, pages.join(" | "));
  // the open phone drawer itself is a pop-up: measure it once
  const measure = async (page, popup) => {
    let n = 0;
    for (const theme of THEMES) {
      await setTheme(p, theme);
      const hits = await p.evaluate(probe);
      n += hits.filter((h) => h.at !== "nav").length;   // this page / pop-up fails on every finding in it (nav: one check below)
      for (const h of hits) {
        const key = `${h.k}|${W}|${theme}|${popup ? "" : h.at === "nav" ? "" : page}|${h.what}`;
        if (keyCount.has(key)) { keyCount.get(key).pages.add(page); continue; }
        const f = { ...h, W, theme, page, popup, pages: new Set([page]) }; keyCount.set(key, f); all.push(f);
      }
      if (hits.length && SHOTS) await p.screenshot({ path: `${SHOTS}/vug-${W}-${theme}-${(page + (popup ? "-" + popup : "")).replace(/[^\w]+/g, "_").slice(0, 60)}.png` }).catch(() => {});
    }
    await setTheme(p, "light");
    return n;
  };
  if (mobile) { await measure("Menu", "nav drawer"); await p.keyboard.press("Escape"); await p.waitForTimeout(250); }
  const goto = async (label) => { await openNav(); await p.locator("aside button.sb-item:visible").filter({ hasText: label }).first().click(); await settle(p, 1500); await closeNav(); await p.evaluate(() => window.scrollTo(0, 0)); };
  const dialogs = () => p.evaluate(() => [...document.querySelectorAll(".modal-backdrop, [role=dialog], [aria-modal=true], .fixed.inset-0")].filter((e) => e.offsetParent !== null || getComputedStyle(e).position === "fixed").filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden" && !e.closest(".nav-backdrop, aside"); }).length);
  for (const label of pages) {
    await goto(label);
    let n = await measure(label, "");
    // pop-ups: every safe header action that opens a dialog / panel
    const base = await dialogs();
    const actions = (await p.locator(".page-header .page-header-actions button:visible, .page-header .page-header-actions [role=button]:visible").evaluateAll((els) => els.map((e, i) => ({ i, t: (e.getAttribute("aria-label") || e.innerText || e.title || "").trim().replace(/\s+/g, " ").slice(0, 40), pressed: e.hasAttribute("aria-pressed") || e.getAttribute("role") === "switch" || !!e.closest(".theme-switch"), dis: e.disabled }))));
    for (const a of actions) {
      if (!a.t || a.pressed || a.dis || NO_CLICK.test(a.t)) continue;
      const btn = p.locator(".page-header .page-header-actions button:visible, .page-header .page-header-actions [role=button]:visible").nth(a.i);
      if (!(await btn.count())) continue;
      await btn.click({ timeout: 3000 }).catch(() => {}); await settle(p, 1200);
      if ((await dialogs()) > base || await p.locator("[role=menu]:visible, [role=listbox]:visible").count()) n += await measure(label, a.t);
      // close: Escape, then a visible ✕ / Close / Cancel, then go back to the page
      for (let k = 0; k < 3 && (await dialogs()) > base; k++) {
        if (k === 0) await p.keyboard.press("Escape");
        else await p.locator(".modal-x:visible, [aria-label='Close']:visible, [aria-label^='Close ']:visible, button:visible:text-is('Cancel'), button:visible:text-is('✕'), button:visible:text-is('×')").last().click({ timeout: 2000 }).catch(() => {});
        await settle(p, 600);
      }
      await p.keyboard.press("Escape"); await settle(p, 300);
      if ((await dialogs()) > base) await goto(label);
    }
    ok(`${W}: ${label} (+ ${actions.filter((a) => a.t && !a.pressed && !a.dis && !NO_CLICK.test(a.t)).length} pop-ups) — everything visible, named, on screen`, n === 0,
      all.filter((f) => f.W === W && f.pages.has(label) && f.at !== "nav").slice(0, 6).map((f) => `[${f.k}/${f.theme}${f.popup ? "/" + f.popup : ""}] ${f.what}`).join(" ; "));
  }
  ok(`${W}: no page errors`, errs.length === 0, errs.join(" | "));
  await ctx.close();
}
ok("(e) no image / font request failed", failedNet.length === 0, [...new Set(failedNet)].slice(0, 6).join(" ; "));
const nav = all.filter((f) => f.at === "nav" && !f.popup);
ok("navigation (sidebar / tab bar) clean on every page", nav.length === 0, nav.slice(0, 6).map((f) => `[${f.k}/${f.W}/${f.theme}] ${f.what}`).join(" ; "));
if (process.env.VUG_OUT) fs.writeFileSync(process.env.VUG_OUT, JSON.stringify(all.map((f) => ({ ...f, pages: [...f.pages] })), null, 1));
console.log(`\nvisible-ui findings: ${all.length} (a contrast/invisible ${all.filter((f) => f.k === "a").length}, b names ${all.filter((f) => f.k === "b").length}, c headers ${all.filter((f) => f.k === "c").length}, d viewport ${all.filter((f) => f.k === "d").length}, e images ${all.filter((f) => f.k === "e").length})`);
await done(b);
