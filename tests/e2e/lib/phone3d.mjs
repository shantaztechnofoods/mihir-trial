// Shared by tests/e2e/dashboard-3d-phone*.mjs — Dashboard 3D view on a phone (2026-11-27, phone v2). LOCAL TEST DATA ONLY
// (localStorage mode, no real accounts or passwords).
// Matrix: 1, 3 and 11 machines × 360 / 390 / 430 px × light / dark. Each:
// phone layout (swipeable line + pager), no page sideways scroll, fewer than 120
// draw calls (merged scene), pixel ratio <= 1.5, no shadow map, idle = 0 frames,
// tags never overlap, every word >= 12 px, tap → the same card inside the screen,
// Line removes the scene. Then, at 4x CPU throttle (CDP), the time to the first
// 3D frame (logged) and a swipe through all six departments: 0 WebGL frames and
// animation frames max <= 50 ms, p95 <= 25 ms (same bar as frame-budget; up to 3 tries).
import { launch, loginAdmin, settle } from "./helpers.mjs";

const MAX_FRAME = Number(process.env.FRAME_MAX_MS || 50);
const MAX_P95 = Number(process.env.FRAME_P95_MS || 25);
const MAX_CALLS = 120;
const shots = process.env.SHOT_DIR || "/tmp";

export const seedFor = (n, theme) => `(() => {
  const n = ${n}, theme = ${JSON.stringify(theme)};
  const h = (x) => new Date(Date.now() - x * 3600e3).toISOString();
  const pw = (s) => btoa(unescape(encodeURIComponent(s)));
  localStorage.clear();
  localStorage.setItem("erp_users", JSON.stringify([{ id: "super_admin_001", username: "admin", password: pw("admin123"), fullName: "Super Admin", role: "super_admin", status: "active" }]));
  localStorage.setItem("erp_theme_mode", theme);
  localStorage.setItem("erp_dash_line_open", "1");
  localStorage.setItem("erp_bomdefs", JSON.stringify({ "M-10": { label: "Kneading Machine 10kg", rackCapacity: 4, items: [{ code: "N-1", qty: 4 }] },
    "R-15": { label: "Roti Maker 15", rackCapacity: 2, items: [{ code: "N-1", qty: 2 }] } }));
  // dept, hours in dept, extra — a mix of on time, near limit, late and on hold
  const plan = [["Assembly", 2], ["Mechanical", 100], ["Trial", 2, { holdActive: true, holdReason: "Heater awaited", holdAt: h(1) }],
    ["Assembly", 20], ["Electrical", 1], ["Mechanical", 3], ["Electrical", 30], ["Assembly", 5], ["Mechanical", 19], ["Electrical", 4], ["Trial", 60]];
  const ms = plan.slice(0, n).map(([d, hrs, extra], i) => ({ id: i + 1, bomKey: i % 3 === 2 ? "R-15" : "M-10", bomLabel: i % 3 === 2 ? "Roti Maker 15" : "Kneading Machine 10kg",
    serialNo: "SN-" + (101 + i), stage: d, currentDepartment: d, departmentEnteredAt: h(hrs), status: "active", createdDate: "20 Nov 2026", history: [], ...(extra || {}) }));
  ms.push({ id: 90, bomKey: "M-10", bomLabel: "Kneading Machine 10kg", serialNo: "SN-190", stage: "Ready", status: "completed", currentDepartment: "Ready", completedDate: "27 Nov 2026", history: [{ stage: "Ready", at: h(0.01) }] });
  localStorage.setItem("erp_machines", JSON.stringify(ms));
  localStorage.setItem("erp_handovers", "[]"); localStorage.setItem("erp_pending_handover_items", "[]");
  localStorage.setItem("erp_checklist_responses", "[]"); localStorage.setItem("erp_dept_ratings", "[]"); localStorage.setItem("erp_attachments", "[]");
  const s = JSON.parse(localStorage.getItem("erp_settings") || "{}");
  s.department_workflow = { dept_durations: { Assembly: { minutes: 1440 }, Mechanical: { minutes: 1440 }, Electrical: { minutes: 1440 }, Trial: { minutes: 1440 } }, accept_timeout_minutes: 120 };
  localStorage.setItem("erp_settings", JSON.stringify(s));
  localStorage.setItem("erp_ready_seen_super_admin_001", String(Date.now()));
})();`;

const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const openDashboard = async (p) => { await p.locator("button, a").filter({ hasText: /^Dashboard/ }).first().click(); await settle(p, 1200); };
const open3d = async (p) => {
  // Tap via the DOM (a shared CI box can be slow to build the scene; the wait below is the real check).
  const t0 = Date.now();
  await p.locator('[data-line-views] [data-view="3d"]').evaluate((b) => b.click());
  await p.waitForFunction(() => (window.__dash3d && window.__dash3d.frames > 0) || document.querySelector("[data-line-3d-note]"), null, { timeout: 90000, polling: 250 }).catch(() => {});
  console.log(`MEASURE mount ${Date.now() - t0}ms`);
  await settle(p, 800);
  return p.evaluate(() => !!window.__dash3d);
};

// ── The matrix ──────────────────────────────────────────────────────────────
export async function runMatrix(ok, theme) {
for (const n of [1, 3, 11]) {
  const { b, p, errs } = await launch(seedFor(n, theme), { width: 390, height: 844 });
  await loginAdmin(p);
  if (await p.locator("[data-production-line]").count() === 0) await openDashboard(p);
  ok(`${n}m ${theme}: theme applied`, await p.evaluate(() => document.documentElement.getAttribute("data-theme")) === theme);
  for (const w of [360, 390, 430]) {
    const tag = `${n}m ${w} ${theme}`;
    await p.setViewportSize({ width: w, height: 844 }); await p.waitForTimeout(300);
    ok(`${tag}: Line is the default, 3D toggle shown`, await p.locator('[data-line-views] [data-view="line"]').getAttribute("aria-pressed") === "true" && await p.locator("[data-floor-3d]").count() === 0);
    if (!(await open3d(p))) { ok(`${tag}: no WebGL → short message, back on Line`, /WebGL|could not/.test(await p.locator("[data-line-3d-note]").innerText())); continue; }
    ok(`${tag}: phone layout (swipeable line + pager)`, await p.locator("[data-floor-3d][data-phone] [data-3d-scroll]").count() === 1 && await p.locator("[data-3d-pager]").count() === 1);
    ok(`${tag}: no page sideways scroll`, await noOverflow(p));
    const inf = await p.evaluate(() => window.__dash3d.info());
    ok(`${tag}: under ${MAX_CALLS} draw calls, DPR <= 1.5, no shadow map`, inf.calls < MAX_CALLS && inf.dpr <= 1.5 && inf.shadows === false, JSON.stringify(inf));
    const f0 = await p.evaluate(() => { window.__idleApi = window.__dash3d; return window.__dash3d.frames; }); await p.waitForTimeout(1000);
    const idle = await p.evaluate(() => ({ same: window.__idleApi === window.__dash3d, frames: window.__dash3d.frames }));
    ok(`${tag}: idle draws 0 frames (and no remount)`, idle.same && idle.frames === f0, JSON.stringify({ f0, ...idle }));
    const tags = await p.locator("[data-floor-3d] .f3-tag").count();
    ok(`${tag}: one tag per machine (${n})`, tags === n, String(tags));
    const fs = await p.locator("[data-floor-3d] .f3-tag:not([data-hidden]) b, [data-floor-3d] .f3-tt, [data-floor-3d] .f3-kl, [data-floor-3d] .f3-cs, [data-3d-pager]").evaluateAll((els) => Math.min(...els.map((e) => parseFloat(getComputedStyle(e).fontSize))));
    ok(`${tag}: every word >= 12px`, fs >= 12, String(fs));
    const over = await p.locator("[data-floor-3d] .f3-tag:not([data-hidden])").evaluateAll((els) => { const r = els.map((e) => e.getBoundingClientRect()); for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) { const a = r[i], c = r[j]; if (a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1) return true; } return false; });
    ok(`${tag}: tags never overlap`, !over);
    // Each department in turn (pager), screenshot of the busiest one.
    await p.locator("[data-floor-3d]").scrollIntoViewIfNeeded();
    await p.locator("[data-3d-pager] button").last().click(); await p.waitForTimeout(700);
    await p.screenshot({ path: `${shots}/phone3d-${n}m-${w}-${theme}.png` });
    const first = p.locator("[data-floor-3d] .f3-tag:not([data-hidden])").first();
    await first.scrollIntoViewIfNeeded(); await first.click(); await settle(p, 500);
    const pb = await p.locator("[data-3d-popover]").boundingBox();
    ok(`${tag}: tap opens the same card, inside the screen`, pb && pb.x >= 0 && pb.x + pb.width <= w + 0.5 && await p.locator("[data-3d-popover] [data-open-mt]").count() === 1, JSON.stringify(pb));
    if (w === 390) await p.screenshot({ path: `${shots}/phone3d-${n}m-${w}-${theme}-card.png` });
    await p.keyboard.press("Escape"); await settle(p, 300);
    await p.locator('[data-line-views] [data-view="line"]').click(); await settle(p, 400);
    ok(`${tag}: Line removes the scene (disposed)`, await p.locator("[data-floor-3d], .f3-gl canvas").count() === 0 && await p.evaluate(() => !window.__dash3d));
  }
  ok(`${n}m ${theme}: no page errors`, errs.length === 0, errs.join(" | "));
  await b.close();
}
}

// ── 4x CPU throttle: first 3D frame + a swipe through the line ───────────────
export async function run4x(ok) {
  const { b, p, errs } = await launch(seedFor(11, "light"), { width: 390, height: 844 });
  await loginAdmin(p);
  if (await p.locator("[data-production-line]").count() === 0) await openDashboard(p);
  await p.locator("[data-production-line]").scrollIntoViewIfNeeded();
  // The Dashboard preloads the 3D chunks on idle (2026-11-27) — wait for that, as a person would have.
  const pre = await p.waitForFunction(() => { const n = performance.getEntriesByType("resource").map((r) => r.name); return n.some((u) => /Line3DView-.*\.js/.test(u)) && n.some((u) => /\/line3d-.*\.js/.test(u)); }, null, { timeout: 20000 }).then(() => true, () => false);
  ok("3D chunks preloaded on idle after the Dashboard shows", pre);
  const cdp = await p.context().newCDPSession(p);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const tm = await p.evaluate(() => new Promise((res) => {
    const t0 = performance.now(); let poster = -1;
    document.querySelector('[data-line-views] [data-view="3d"]').click();
    const tick = () => {
      const now = performance.now();
      if (poster < 0 && document.querySelector("[data-3d-poster], [data-floor-3d] canvas")) poster = Math.round(now - t0);
      if (window.__dash3d && window.__dash3d.frames > 0) {
        const at = (n) => { const m = performance.getEntriesByName(n).pop(); return m ? Math.round(m.startTime - t0) : -1; };
        res({ poster, env: at("dash3d-env"), scene: at("dash3d-scene"), built: at("dash3d-built"), programs: window.__dash3d.info().programs, compiled: at("dash3d-compiled"), first: at("dash3d-first") });
      } else if (document.querySelector("[data-line-3d-note]") || now - t0 > 60000) res({ poster, first: -1 });
      else requestAnimationFrame(tick);
    };
    tick();
  }));
  const firstMs = tm.first;
  console.log(`MEASURE phases-4x ${JSON.stringify(tm)}`);
  ok(`4x CPU: something useful on screen <= 300 ms after the tap (poster at ${tm.poster} ms)`, tm.poster >= 0 && tm.poster <= 300, JSON.stringify(tm));
  ok(`4x CPU: first 3D frame drawn (${firstMs} ms after the tap)`, firstMs > 0, JSON.stringify(tm));
  console.log(`MEASURE first-frame-4x ${firstMs}ms`);
  await settle(p, 1500);
  if (firstMs > 0) {
    await p.locator("[data-floor-3d]").scrollIntoViewIfNeeded(); await p.waitForTimeout(500);
    let best = null;
    for (let t = 0; t < 3; t++) {
      await p.evaluate(() => { const sc = document.querySelector("[data-3d-scroll]"); sc.scrollTo({ left: 0, behavior: "auto" }); });
      await p.waitForTimeout(400);
      const r = await p.evaluate(() => new Promise((res) => {
        const sc = document.querySelector("[data-3d-scroll]"), f0 = window.__dash3d.frames, d = [];
        let last = 0, on = true;
        const loop = (t) => { if (!on) return; if (last) d.push(t - last); last = t; requestAnimationFrame(loop); };
        requestAnimationFrame(loop);
        let k = 0; const next = () => { const btn = document.querySelectorAll("[data-3d-pager] button")[1]; if (k++ < 5 && !btn.disabled) { btn.click(); setTimeout(next, 650); } else setTimeout(() => { on = false; const s = d.slice().sort((a, b) => a - b); res({ webgl: window.__dash3d.frames - f0, n: d.length, max: Math.round(Math.max(0, ...d) * 10) / 10, p95: Math.round((s[Math.floor(s.length * 0.95)] || 0) * 10) / 10, end: Math.round(sc.scrollLeft), room: sc.scrollWidth - sc.clientWidth }); }, 400); };
        next();
      }));
      if (!best || r.max < best.max) best = r;
      if (r.max <= MAX_FRAME && r.p95 <= MAX_P95 && r.webgl === 0) { best = r; break; }
    }
    console.log(`MEASURE swipe-4x ${JSON.stringify(best)}`);
    ok("4x CPU: the swipe reaches the last department", best.end >= best.room - 2, JSON.stringify(best));
    ok("4x CPU: swiping draws 0 WebGL frames", best.webgl === 0, JSON.stringify(best));
    ok(`4x CPU: swipe frames max <= ${MAX_FRAME} ms, p95 <= ${MAX_P95} ms`, best.max <= MAX_FRAME && best.p95 <= MAX_P95, JSON.stringify(best));
  }
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  ok("4x run: no page errors", errs.length === 0, errs.join(" | "));
  await b.close();
}
