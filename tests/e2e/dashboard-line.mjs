// Dashboard "Production line today" (2026-11-05). LOCAL TEST DATA ONLY
// (localStorage mode, no real accounts or passwords).
// Checks: fold/unfold header (aria-expanded, 44px, remembered, keyboard, reduced motion),
// who sees the panel (admin / production head yes, purchase manager no),
// words + icons on every coloured state, Needs attention list, a stage opens
// Machine Tracker on its filter, no page sideways scroll on phones.
import { launch, login, loginAdmin, settle, makeOk } from "./lib/helpers.mjs";

const seed = () => {
  const h = (n) => new Date(Date.now() - n * 3600e3).toISOString();
  const pw = (s) => btoa(unescape(encodeURIComponent(s)));
  localStorage.clear();
  localStorage.setItem("erp_users", JSON.stringify([
    { id: "super_admin_001", username: "admin", password: pw("admin123"), fullName: "Super Admin", role: "super_admin", status: "active" },
    { id: "u_head", username: "head", password: pw("head123"), fullName: "Prakash (Head)", role: "Production Head", status: "active", departments: [] },
    { id: "u_buy", username: "buyer", password: pw("buyer123"), fullName: "Buyer", role: "Purchase Manager", status: "active" },
  ]));
  localStorage.removeItem("erp_roles");
  localStorage.setItem("erp_bomdefs", JSON.stringify({ "M-10": { label: "Kneading Machine 10kg", rackCapacity: 4, items: [{ code: "N-1", qty: 4 }] },
    "M-15": { label: "Roti Maker 15", rackCapacity: 2, items: [{ code: "N-1", qty: 2 }] } }));
  const m = (id, extra) => ({ id, bomKey: "M-10", bomLabel: "Kneading Machine 10kg", serialNo: `SN-${100 + id}`, status: "active", createdDate: "30 Oct 2026", history: [], ...extra });
  localStorage.setItem("erp_machines", JSON.stringify([
    m(1, { stage: "BOM Issued" }),
    m(2, { stage: "Assembly", currentDepartment: "Assembly", departmentEnteredAt: h(3), pendingHandoverId: 22 }),            // parked on rack
    m(3, { stage: "Assembly", currentDepartment: "Assembly", departmentEnteredAt: h(2) }),                                   // on time
    m(4, { stage: "Mechanical", currentDepartment: "Mechanical", departmentEnteredAt: h(100) }),                             // late (> 1 day even with a closed day)
    m(5, { bomKey: "M-15", bomLabel: "Roti Maker 15", stage: "Electrical", currentDepartment: "Electrical", departmentEnteredAt: h(1) }),
    m(6, { bomKey: "M-15", bomLabel: "Roti Maker 15", stage: "Trial", currentDepartment: "Trial", departmentEnteredAt: h(2), holdActive: true, holdReason: "Heater awaited", holdAt: h(1) }),
    m(7, { stage: "Electrical", currentDepartment: "Electrical", departmentEnteredAt: h(6), pendingHandoverId: 27 }),        // sent to Trial, waiting accept
    m(8, { stage: "Ready", status: "completed", currentDepartment: "Ready", completedDate: "31 Oct 2026", history: [{ stage: "Ready", at: h(0.01) }] }),
    m(9, { stage: "Ready", status: "completed", currentDepartment: "Ready", completedDate: "31 Oct 2026", history: [{ stage: "Ready", at: h(200) }] }),
  ]));
  localStorage.setItem("erp_handovers", JSON.stringify([
    { id: 22, machineId: 2, bomKey: "M-10", serialNo: "SN-102", fromDepartment: "Assembly", toDepartment: "Mechanical", status: "pending", sentAt: h(1), acceptTimeoutMinutes: 120, releaseRequired: true, releasedAt: null },
    { id: 27, machineId: 7, bomKey: "M-10", serialNo: "SN-107", fromDepartment: "Electrical", toDepartment: "Trial", status: "pending", sentAt: new Date(Date.now() - 10 * 60e3).toISOString(), acceptTimeoutMinutes: 120 },
  ]));
  localStorage.setItem("erp_pending_handover_items", "[]");
  localStorage.setItem("erp_checklist_responses", "[]"); localStorage.setItem("erp_dept_ratings", "[]"); localStorage.setItem("erp_attachments", "[]");
  const s = JSON.parse(localStorage.getItem("erp_settings") || "{}");
  s.department_workflow = { dept_durations: { Assembly: { minutes: 1440 }, Mechanical: { minutes: 1440 }, Electrical: { minutes: 1440 }, Trial: { minutes: 1440 } }, accept_timeout_minutes: 120 };
  localStorage.setItem("erp_settings", JSON.stringify(s));
  // The admin "Ready machines" popup is a different feature; mark it seen so it does not cover the dashboard.
  localStorage.setItem("erp_ready_seen_super_admin_001", String(Date.now()));
};

const { ok, done } = makeOk();
const shots = process.env.SHOT_DIR || "/tmp";
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const openDashboard = async (p) => { await p.locator("button, a").filter({ hasText: /^Dashboard/ }).first().click(); await settle(p, 1200); };

// ── Admin ───────────────────────────────────────────────────────────────────
{
  const { b, p, errs } = await launch(`(${seed})();`, { width: 1440, height: 900 });
  await loginAdmin(p); await openDashboard(p);
  const panel = p.locator("[data-production-line]");
  ok("admin: panel shows on the Dashboard", await panel.count() === 1);
  const first = await p.locator(".p-6 > *").first().getAttribute("data-production-line");
  ok("admin: panel is the first thing on the page", first !== null);
  const stages = await p.locator("[data-production-line] [data-stage]").evaluateAll((els) => els.map((e) => e.getAttribute("data-stage")));
  ok("six stages in line order", stages.join(",") === "Rack,Assembly,Mechanical,Electrical,Trial,Ready", stages.join(","));
  const count = (k) => p.locator(`[data-stage="${k}"] [data-count]`).getAttribute("data-count");
  ok("counts: rack 2, assembly 1, mechanical 1, electrical 1, trial 2, ready today 1",
    [await count("Rack"), await count("Assembly"), await count("Mechanical"), await count("Electrical"), await count("Trial"), await count("Ready")].join(",") === "2,1,1,1,2,1");
  ok("ready today line", /Ready today:\s*1/.test(await p.locator("[data-ready-today]").innerText()));
  const tone = (k) => p.locator(`[data-stage="${k}"]`).getAttribute("data-tone");
  ok("mechanical red (late) with words", await tone("Mechanical") === "late" && /Late \d/.test(await p.locator('[data-stage="Mechanical"]').innerText()));
  ok("trial red (on hold) with reason in words", await tone("Trial") === "late" && /On hold – Heater awaited/.test(await p.locator('[data-stage="Trial"]').innerText()));
  ok("trial shows the machine waiting to accept", /1 waiting to accept/.test(await p.locator('[data-stage="Trial"]').innerText()));
  ok("assembly green with words", await tone("Assembly") === "ok" && /On time/.test(await p.locator('[data-stage="Assembly"]').innerText()));
  const coloured = await p.locator('[data-production-line] .dash-line-flag:not([data-tone="idle"])').evaluateAll((els) => els.every((e) => e.querySelector("svg") && e.textContent.trim().length > 0));
  ok("every coloured state has an icon + words", coloured);
  ok("legend line under the strip", /On time \(under 1 day\).*Near limit \(over 18 h\).*Late \(over 1 day\).*On hold/s.test(await p.locator(".dash-line-legend").innerText()));
  const rows = await p.locator("[data-needs-attention] .dash-line-row").evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ")));
  ok("needs attention: on-hold SN-106 then late SN-104", rows.length === 2 && /SN-106.*On hold – Heater awaited/.test(rows[0]) && /SN-104.*Mechanical.*Late/.test(rows[1]), rows.join(" | "));
  ok("no sideways scroll at 1440", await noOverflow(p));
  await p.mouse.move(0, 0); await p.waitForTimeout(300);
  await p.screenshot({ path: `${shots}/dashboard-line-1440x900.png` });

  // ── Fold / unfold (2026-11-05): like Machine Tracker's "Issue a BOM" ──
  const tog = p.locator("[data-line-toggle]");
  const exp = () => tog.getAttribute("aria-expanded");
  ok("fold: header is a <button> with aria-expanded=true on a laptop", await tog.evaluate((e) => e.tagName) === "BUTTON" && await exp() === "true");
  ok("fold: header button is a >= 44px target", ((await tog.boundingBox()) || {}).height >= 44);
  ok("fold: open shows 'Hide ▲' like the BOM section", /Hide\s*▼/.test(await tog.innerText()) && await p.locator(".dash-line-arrow[data-open]").count() === 1);
  const motion = await p.evaluate(() => ({ body: getComputedStyle(document.querySelector("[data-line-body]")).animationDuration,
    arrow: getComputedStyle(document.querySelector(".dash-line-arrow")).transitionDuration }));
  ok("fold: motion <= 200 ms", parseFloat(motion.body) <= 0.2 && parseFloat(motion.arrow) <= 0.2, JSON.stringify(motion));
  await tog.click(); await settle(p, 600);
  ok("fold: click folds (aria-expanded=false, body gone)", await exp() === "false" && await p.locator("[data-line-body]").count() === 0 && await p.locator("[data-production-line] [data-stage]").count() === 0);
  ok("fold: folded header keeps title + Ready today", /Production line today/.test(await tog.innerText()) && /Ready today:\s*1/.test(await tog.innerText()));
  ok("fold: folded summary '1 late · 1 on hold'", (await p.locator("[data-line-summary]").innerText()).trim() === "1 late · 1 on hold", await p.locator("[data-line-summary]").innerText());
  ok("fold: folded shows 'Show ▼'", /Show\s*▼/.test(await tog.innerText()) && await p.locator(".dash-line-arrow[data-open]").count() === 0);
  ok("fold: remembered in this browser", await p.evaluate(() => localStorage.getItem("erp_dash_line_open")) === "0");
  await p.mouse.move(0, 0); await p.waitForTimeout(250);
  await p.screenshot({ path: `${shots}/dashboard-line-1440x900-closed.png` });
  await p.reload({ waitUntil: "networkidle" }); await settle(p, 800);
  if (await p.locator("[data-line-toggle]").count() === 0) await openDashboard(p);
  ok("fold: still folded after reload", await p.locator("[data-line-toggle]").getAttribute("aria-expanded") === "false");
  await p.locator("[data-line-toggle]").focus(); await p.keyboard.press("Enter"); await settle(p, 600);
  ok("fold: Enter key unfolds", await exp() === "true" && await p.locator("[data-production-line] [data-stage]").count() === 6);
  await p.keyboard.press("Space"); await settle(p, 400);
  ok("fold: Space key folds", await exp() === "false");
  await p.keyboard.press("Space"); await settle(p, 400);
  ok("fold: open again, remembered as open", await exp() === "true" && await p.evaluate(() => localStorage.getItem("erp_dash_line_open")) === "1");
  await p.emulateMedia({ reducedMotion: "reduce" });
  const rm = await p.evaluate(() => ({ body: getComputedStyle(document.querySelector("[data-line-body]")).animationName,
    arrow: getComputedStyle(document.querySelector(".dash-line-arrow")).transitionDuration }));
  ok("fold: reduced motion → no animation", rm.body === "none" && parseFloat(rm.arrow) <= 0.001, JSON.stringify(rm));
  await p.emulateMedia({ reducedMotion: "no-preference" });

  // A stage opens Machine Tracker on its existing filter.
  await p.locator('[data-stage="Ready"]').click(); await settle(p, 1500);
  ok("Ready stage opens Machine Tracker (completed machines)", /finished — Ready is the final stage/.test(await p.locator("body").innerText()));

  // Phone
  await openDashboard(p);
  for (const [w, hgt] of [[390, 844], [360, 780]]) {
    await p.setViewportSize({ width: w, height: hgt }); await p.waitForTimeout(400);
    ok(`no sideways scroll at ${w}`, await noOverflow(p));
    const box = await p.locator("[data-production-line]").boundingBox();
    ok(`panel fits the phone at ${w}`, box && box.x >= 0 && box.x + box.width <= w + 0.5, JSON.stringify(box));
    const cols = await p.locator('[data-production-line] [data-stage]').evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size);
    ok(`strip is a 3 × 2 grid at ${w}`, cols === 2, String(cols));
    const tall = await p.locator('[data-production-line] [data-stage]').evaluateAll((els) => els.every((e) => e.getBoundingClientRect().height >= 44));
    ok(`stages are >= 44px tap targets at ${w}`, tall);
  }
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(300);
  await p.locator("[data-production-line]").scrollIntoViewIfNeeded();
  await p.mouse.move(200, 30); await p.evaluate(() => document.activeElement && document.activeElement.blur()); await p.waitForTimeout(250);
  await p.screenshot({ path: `${shots}/dashboard-line-390x844.png` });
  await p.screenshot({ path: `${shots}/dashboard-line-390x844-full.png`, fullPage: true });
  await p.locator("[data-line-toggle]").click(); await settle(p, 600);
  ok("fold at 390: folds, no sideways scroll", await p.locator("[data-line-toggle]").getAttribute("aria-expanded") === "false" && await noOverflow(p));
  const tb = await p.locator("[data-line-toggle]").boundingBox();
  ok("fold at 390: header button fits and is >= 44px", tb && tb.height >= 44 && tb.x >= 0 && tb.x + tb.width <= 390.5, JSON.stringify(tb));
  await p.locator("[data-production-line]").scrollIntoViewIfNeeded();
  await p.mouse.move(200, 30); await p.evaluate(() => document.activeElement && document.activeElement.blur()); await p.waitForTimeout(250);
  await p.screenshot({ path: `${shots}/dashboard-line-390x844-closed.png` });
  ok("no page errors (admin)", errs.length === 0, errs.join(" | "));
  await b.close();
}

// ── Production Head: may open Machine Tracker → sees it ──────────────────────
{
  // Phone, nothing remembered yet → starts folded (same as the BOM section).
  const { b, p, errs } = await launch(`(${seed})();`, { width: 390, height: 844 });
  await login(p, "head", "head123"); await settle(p, 1200);   // lands on the Dashboard (sidebar is a drawer on a phone)
  ok("production head sees the panel", await p.locator("[data-production-line]").count() === 1);
  ok("phone default: folded, summary shown", await p.locator("[data-line-toggle]").getAttribute("aria-expanded") === "false" && await p.locator("[data-line-summary]").count() === 1);
  await p.locator("[data-line-toggle]").click(); await settle(p, 600);
  ok("phone: tap unfolds the six stages", await p.locator("[data-production-line] [data-stage]").count() === 6);
  ok("no page errors (head)", errs.length === 0, errs.join(" | "));
  await b.close();
}

// ── Purchase Manager: Dashboard yes, Machine Tracker no → no panel ───────────
{
  const { b, p, errs } = await launch(`(${seed})();`, { width: 1280, height: 800 });
  await login(p, "buyer", "buyer123"); await openDashboard(p);
  ok("purchase manager is on the Dashboard", /real-time overview/.test(await p.locator("body").innerText()));
  ok("purchase manager does NOT see the production line", await p.locator("[data-production-line]").count() === 0);
  ok("no page errors (buyer)", errs.length === 0, errs.join(" | "));
  await b.close();
}
await done({ close: async () => {} });
