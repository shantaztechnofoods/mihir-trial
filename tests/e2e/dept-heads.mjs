// Department heads (2026-11-05). LOCAL TEST DATA ONLY (localStorage mode, no
// real accounts or passwords). Checks: Settings → Department Workflow →
// "Department heads" picks a user or a typed name per department, saves to
// settings.departmentHeads with a settings_updated audit row, says it does not
// change permissions, works at 1440 and 390 with 44px targets; the Dashboard
// production line shows "Assembly · Sonu bhai" and hides unset heads.
import { launch, login, loginAdmin, gotoMachineTracker, settle, makeOk, ls } from "./lib/helpers.mjs";

const seed = () => {
  const pw = (s) => btoa(unescape(encodeURIComponent(s)));
  localStorage.clear();
  localStorage.setItem("erp_users", JSON.stringify([
    { id: "super_admin_001", username: "admin", password: pw("admin123"), fullName: "Super Admin", role: "super_admin", status: "active" },
    { id: "u_sonu", username: "sonu", password: pw("sonu123"), fullName: "Sonu bhai", role: "Production", status: "active", departments: ["Assembly"] },
    { id: "u_head", username: "head", password: pw("head123"), fullName: "Prakash (Head)", role: "Production Head", status: "active", departments: [] },
    { id: "u_old", username: "oldguy", password: pw("old123"), fullName: "Old Worker", role: "Production", status: "disabled", departments: [] },
  ]));
  localStorage.removeItem("erp_roles");
  localStorage.setItem("erp_bomdefs", JSON.stringify({ "M-10": { label: "Kneading Machine 10kg", rackCapacity: 4, items: [{ code: "N-1", qty: 4 }] } }));
  localStorage.setItem("erp_machines", JSON.stringify([
    { id: 1, bomKey: "M-10", bomLabel: "Kneading Machine 10kg", serialNo: "SN-101", status: "active", createdDate: "30 Oct 2026", history: [],
      stage: "Assembly", currentDepartment: "Assembly", departmentEnteredAt: new Date(Date.now() - 2 * 3600e3).toISOString() },
  ]));
  localStorage.setItem("erp_handovers", "[]");
  localStorage.setItem("erp_pending_handover_items", "[]");
  localStorage.setItem("erp_checklist_responses", "[]"); localStorage.setItem("erp_dept_ratings", "[]"); localStorage.setItem("erp_attachments", "[]");
  localStorage.setItem("erp_ready_seen_super_admin_001", String(Date.now()));
};

const { ok, done } = makeOk();
const shots = process.env.SHOT_DIR || "/tmp";
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const openDashboard = async (p) => { await p.locator("button, a").filter({ hasText: /^Dashboard/ }).first().click(); await settle(p, 1200); };
const openHeads = async (p) => {
  await gotoMachineTracker(p);
  await p.locator("button[data-mt-settings]", { hasText: /^Settings$/ }).first().click(); await settle(p, 1000);
  return p.locator('[data-org-group="dept-heads"]');
};
const heads = async (p) => ((await ls(p, "erp_settings")) || {}).departmentHeads || {};
const label = (p, k) => p.locator(`[data-production-line] [data-stage="${k}"] .dash-line-label`).innerText();

// ── Admin: set heads in Settings, see them on the Dashboard ─────────────────
{
  const { b, p, errs } = await launch(`(${seed})();`, { width: 1440, height: 900 });
  await loginAdmin(p);
  const g = await openHeads(p);
  ok("Department heads group is in Department Workflow settings", await g.count() === 1);
  ok("note says display only", /Shown on Dashboard\. Does not change permissions\./.test(await g.locator("[data-dept-heads-note]").innerText()));
  const rows = await g.locator("[data-dept-head-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-dept-head-row")));
  ok("one row per real department, in line order", rows.join(",") === "Assembly,Mechanical,Electrical,Trial", rows.join(","));
  const opts = await g.locator("#dept-head-assembly option").allInnerTexts();
  ok("picker lists active users, not disabled ones", opts.some((o) => /Sonu bhai/.test(o)) && opts.some((o) => /Prakash/.test(o)) && !opts.some((o) => /Old Worker/.test(o)), opts.join(" | "));
  ok("picker has a visible label (Assembly)", await p.locator('label[for="dept-head-assembly"]').innerText() === "Assembly");

  // Pick an existing user → saves straight away.
  await g.locator("#dept-head-assembly").selectOption("u_sonu"); await settle(p, 1200);
  ok("picking a user says Saved", /Saved/.test(await g.locator('[data-dept-head-row="Assembly"]').innerText()));
  let h = await heads(p);
  ok("stored in settings.departmentHeads with userId + name", h.Assembly && h.Assembly.userId === "u_sonu" && h.Assembly.name === "Sonu bhai", JSON.stringify(h));

  // Type a name for a head without a login.
  await g.locator("#dept-head-trial").selectOption("__typed"); await settle(p, 300);
  await g.getByRole("button", { name: "Save name" }).click(); await settle(p, 300);
  ok("empty typed name shows an error, nothing saved", /Type the head's name/.test(await g.locator('[data-dept-head-row="Trial"]').innerText()) && !(await heads(p)).Trial);
  await g.locator("#dept-head-trial-name").fill("Ramesh ji");
  ok("error clears as soon as you type", !/Type the head's name/.test(await g.locator('[data-dept-head-row="Trial"]').innerText()));
  await g.getByRole("button", { name: "Save name" }).click(); await settle(p, 1200);
  h = await heads(p);
  ok("typed head saved with no userId", h.Trial && h.Trial.userId === null && h.Trial.name === "Ramesh ji", JSON.stringify(h));

  const audit = (await ls(p, "erp_audit")) || [];
  ok("audit: settings_updated lists departmentHeads", audit.some((a) => a.type === "settings_updated" && ((a.details && a.details.changedFields) || []).includes("departmentHeads")));
  ok("no role / department / user changed", JSON.stringify(((await ls(p, "erp_users")) || []).find((u) => u.id === "u_sonu").departments) === '["Assembly"]'
    && ((await ls(p, "erp_users")) || []).find((u) => u.id === "u_sonu").role === "Production");

  const sizes = await g.locator("select, input, button:not(.org-group-head)").evaluateAll((els) => els.filter((e) => e.offsetParent).map((e) => Math.round(e.getBoundingClientRect().height)));
  ok("controls are >= 44px at 1440", sizes.length >= 5 && sizes.every((x) => x >= 44), sizes.join(","));
  ok("no sideways scroll at 1440 (settings)", await noOverflow(p));
  await g.evaluate((e) => e.scrollIntoView({ block: "center" })); await p.mouse.move(0, 0); await p.waitForTimeout(250);
  await g.screenshot({ path: `${shots}/settings-dept-heads-1440.png` });

  // Phone width.
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(400);
  ok("no sideways scroll at 390 (settings)", await noOverflow(p));
  const box = await g.boundingBox();
  ok("group fits the phone at 390", box && box.x >= 0 && box.x + box.width <= 390.5, JSON.stringify(box));
  const psizes = await g.locator("select, input, button:not(.org-group-head)").evaluateAll((els) => els.filter((e) => e.offsetParent).map((e) => Math.round(e.getBoundingClientRect().height)));
  ok("controls are >= 44px at 390", psizes.every((x) => x >= 44), psizes.join(","));
  await g.evaluate((e) => e.scrollIntoView({ block: "start" })); await p.evaluate(() => window.scrollBy(0, -8)); await p.waitForTimeout(250);
  await g.screenshot({ path: `${shots}/settings-dept-heads-390.png` });
  await p.setViewportSize({ width: 1440, height: 900 }); await p.waitForTimeout(300);

  // Dashboard shows the heads; unset departments show no head.
  await openDashboard(p);
  ok("dashboard: Assembly · Sonu bhai", /^Assembly · Sonu bhai$/.test((await label(p, "Assembly")).trim()), await label(p, "Assembly"));
  ok("dashboard: Trial · Ramesh ji", /^Trial · Ramesh ji$/.test((await label(p, "Trial")).trim()), await label(p, "Trial"));
  ok("dashboard: Mechanical has no head shown", (await label(p, "Mechanical")).trim() === "Mechanical");
  ok("dashboard: Rack / Ready never show a head", (await label(p, "Rack")).trim() === "Rack" && (await label(p, "Ready")).trim() === "Ready");
  ok("stage button names the head for screen readers", /Assembly, head Sonu bhai/.test(await p.locator('[data-stage="Assembly"]').getAttribute("aria-label")));
  await p.mouse.move(0, 0); await p.waitForTimeout(250);
  await p.locator("[data-production-line] .dash-line-strip").screenshot({ path: `${shots}/dashboard-heads-1440.png` });
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(400);
  ok("dashboard: no sideways scroll at 390", await noOverflow(p));
  const under = await p.locator('[data-stage="Assembly"] .dash-line-head-name').evaluate((e) => getComputedStyle(e).display);
  ok("dashboard 390: head sits on its own line under the department", under === "block", under);
  await p.locator("[data-production-line] .dash-line-strip").scrollIntoViewIfNeeded();
  await p.locator("[data-production-line] .dash-line-strip").screenshot({ path: `${shots}/dashboard-heads-390.png` });
  await p.setViewportSize({ width: 1440, height: 900 }); await p.waitForTimeout(300);

  // Survives a reload; clearing hides it again.
  await p.reload({ waitUntil: "networkidle" }); await settle(p, 1500);
  if (await p.locator("#login-username").count()) await loginAdmin(p);
  const g2 = await openHeads(p);
  ok("after reload the pickers show the saved heads", await g2.locator("#dept-head-assembly").inputValue() === "u_sonu"
    && await g2.locator("#dept-head-trial").inputValue() === "__typed" && await g2.locator("#dept-head-trial-name").inputValue() === "Ramesh ji");
  await g2.locator("#dept-head-assembly").selectOption(""); await settle(p, 1200);
  ok("Not set removes the head", !(await heads(p)).Assembly && /Removed/.test(await g2.locator('[data-dept-head-row="Assembly"]').innerText()));
  await openDashboard(p);
  ok("dashboard: Assembly head hidden after clearing", (await label(p, "Assembly")).trim() === "Assembly");
  ok("no page errors (admin)", errs.length === 0, errs.join(" | "));
  await b.close();
}

// ── Production Head: sees the head on the Dashboard, cannot open the settings ──
{
  const { b, p, errs } = await launch(`(${seed})(); (() => { const s = JSON.parse(localStorage.getItem("erp_settings") || "{}");
    s.departmentHeads = { Mechanical: { userId: null, name: "Raju" } }; localStorage.setItem("erp_settings", JSON.stringify(s)); })();`, { width: 1280, height: 800 });
  await login(p, "head", "head123"); await openDashboard(p);
  ok("production head sees Mechanical · Raju", (await label(p, "Mechanical")).trim() === "Mechanical · Raju", await label(p, "Mechanical"));
  await gotoMachineTracker(p);
  ok("production head has no Machine Tracker Settings button (canDo machines.configDept)", await p.locator("button[data-mt-settings]").count() === 0);
  ok("no page errors (head)", errs.length === 0, errs.join(" | "));
  await b.close();
}

// ── MT UX pack (2026-11-06): head's "My work today", next step, near-limit strip ──
const headSeed = `(${seed})(); (() => {
  const pw = (s) => btoa(unescape(encodeURIComponent(s)));
  const us = JSON.parse(localStorage.getItem("erp_users"));
  us.push({ id: "u_ravi", username: "ravi", password: pw("ravi123"), fullName: "Ravi (Mechanical head)", role: "Production", status: "active", departments: ["Mechanical"] });
  localStorage.setItem("erp_users", JSON.stringify(us));
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
  localStorage.setItem("erp_machines", JSON.stringify([
    { id: 1, bomKey: "M-10", bomLabel: "Kneading Machine 10kg", serialNo: "SN-101", status: "active", stage: "Mechanical", currentDepartment: "Mechanical", departmentEnteredAt: ago(124), deptDurations: { Mechanical: { minutes: 150 } }, createdDate: "30 Oct 2026", history: [] },
    { id: 2, bomKey: "M-10", bomLabel: "Kneading Machine 10kg", serialNo: "SN-102", status: "active", stage: "Mechanical", currentDepartment: "Mechanical", departmentEnteredAt: ago(120), deptDurations: { Mechanical: { minutes: 60 } }, createdDate: "30 Oct 2026", history: [] },
    { id: 3, bomKey: "M-10", bomLabel: "Kneading Machine 10kg", serialNo: "SN-103", status: "active", stage: "Assembly", currentDepartment: "Assembly", departmentEnteredAt: ago(300), pendingHandoverId: 31, createdDate: "30 Oct 2026", history: [] },
    { id: 4, bomKey: "M-10", bomLabel: "Kneading Machine 10kg", serialNo: "SN-104", status: "active", stage: "Electrical", currentDepartment: "Electrical", departmentEnteredAt: ago(50), createdDate: "30 Oct 2026", history: [] },
  ]));
  localStorage.setItem("erp_handovers", JSON.stringify([
    { id: 31, machineId: 3, bomKey: "M-10", serialNo: "SN-103", fromDepartment: "Assembly", toDepartment: "Mechanical", status: "pending", sentAt: ago(10), acceptTimeoutMinutes: 240 },
    { id: 32, machineId: 4, bomKey: "M-10", serialNo: "SN-104", fromDepartment: "Mechanical", toDepartment: "Electrical", status: "accepted", sentAt: ago(60), acceptedAt: ago(50), acceptTimeoutMinutes: 240 },
  ]));
  localStorage.setItem("erp_checklist_templates", JSON.stringify([{ id: 901, name: "Mechanical checks", department: "Mechanical", stage: "during_work", bomKey: null, active: true, version: 1,
    items: [{ id: "a", text: "Belt tension" }, { id: "b", text: "Bolts tight" }, { id: "c", text: "Guard fitted" }] }]));
  const s = JSON.parse(localStorage.getItem("erp_settings") || "{}");
  s.departmentHeads = { Mechanical: { userId: "u_ravi", name: "Ravi" }, Electrical: { userId: "super_admin_001", name: "Super Admin" } };
  s.department_workflow = { ...(s.department_workflow || {}), weekly_off_days: [], holidays: [] };
  localStorage.setItem("erp_settings", JSON.stringify(s));
})();`;
{
  const { b, p, errs } = await launch(headSeed, { width: 1440, height: 900 });
  await login(p, "ravi", "ravi123"); await gotoMachineTracker(p);
  const panel = p.locator("[data-mywork]");
  ok("head: 'My work today' opens on Machine Tracker", await panel.count() === 1 && /My work today/.test(await panel.innerText()));
  ok("head: summary '3 machines · 1 late · 1 to accept'", /Mechanical · 3 machines · 1 late · 1 to accept/.test(await p.locator("[data-mywork-summary]").innerText()), await p.locator("[data-mywork-summary]").innerText());
  const order = await p.locator("[data-mywork-card]").evaluateAll((els) => els.map((e) => e.getAttribute("data-mywork-card")));
  ok("head: most urgent first (late SN-102, then the one to accept)", order.join(",") === "2,3,1", order.join(","));
  ok("head: to-accept machine's next step is Accept into Mechanical", (await p.locator('[data-mywork-next="3"]').innerText()).trim() === "Accept into Mechanical");
  ok("head: working machine's next step is 'Fill checklist (3 left)'", (await p.locator('[data-mywork-next="1"]').innerText()).trim() === "Fill checklist (3 left)");
  ok("staff card: same next step, Finish becomes a secondary", (await p.locator('[data-staff-during="1"]').getAttribute("data-next-step")) === "checklist" && await p.locator('[data-staff-actions="1"] .mtx-sec-row [data-staff-finish="1"]').count() === 1);
  ok("head: footer 'Today you sent 1 machine forward'", /Today you sent 1 machine forward/.test(await p.locator("[data-mywork-sent]").innerText()));
  ok("head (floor login): no All departments toggle — cannot widen a department login", await p.locator("[data-mywork-scope]").count() === 0);
  const strip = p.locator("[data-near-limit]");
  ok("near-limit strip: one strip with a count for 2 machines", await strip.count() === 1 && (await strip.getAttribute("data-near-limit-count")) === "2");
  ok("near-limit strip: least time left first, calm text", /^M-10 \(SN-102\) · late by 1h in Mechanical$/.test((await p.locator("[data-near-limit-open]").innerText()).trim()), await p.locator("[data-near-limit-open]").innerText());
  ok("near-limit strip: '+1 more'", /\+1 more/.test(await p.locator("[data-near-limit-more]").innerText()));
  ok("near-limit: no modal opened", await p.locator(".modal-backdrop").count() === 0);
  await p.mouse.move(0, 0); await p.waitForTimeout(300);
  await p.screenshot({ path: `${shots}/mywork-head-1440.png` });
  await p.locator('[data-mywork-next="1"]').click(); await p.waitForTimeout(400);
  ok("next step opens the same During-Work Checks sheet", await p.locator("[data-during-checklist]").count() > 0);
  await p.keyboard.press("Escape"); await p.waitForTimeout(400);
  await p.locator("[data-near-limit-dismiss]").click(); await p.waitForTimeout(300);
  ok("dismiss hides the strip", await p.locator("[data-near-limit]").count() === 0);
  await p.reload({ waitUntil: "networkidle" }); await settle(p, 1500);
  if (await p.locator("#login-username").count()) await login(p, "ravi", "ravi123");
  await gotoMachineTracker(p);
  ok("dismissal remembered after reload (once per machine per stage)", await p.locator("[data-near-limit]").count() === 0 && await p.locator("[data-mywork]").count() === 1);
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(500);
  ok("390: no sideways scroll on Machine Tracker", await noOverflow(p));
  const nb = await p.locator('[data-mywork-next="2"]').boundingBox();
  ok("390: next step is full width and >= 48px", nb && nb.height >= 48 && nb.width >= 320, JSON.stringify(nb));
  const firstTop = await p.locator("[data-mywork-card]").first().boundingBox();
  ok("390: own machines are at the top (first card within the first screen)", firstTop && firstTop.y < 844, JSON.stringify(firstTop));
  await p.screenshot({ path: `${shots}/mywork-head-390.png` });
  ok("no page errors (dept head)", errs.length === 0, errs.join(" | "));
  await b.close();
}
{
  // An admin picked as a department head: his department by default, toggle to All departments.
  const { b, p, errs } = await launch(headSeed, { width: 1440, height: 900 });
  await loginAdmin(p); await gotoMachineTracker(p);
  ok("admin head: My work today for Electrical", await p.locator("[data-mywork-head]").count() === 1 && /Electrical · 1 machine/.test(await p.locator("[data-mywork-summary]").innerText()));
  ok("admin head: default is My department", (await p.locator('[data-mywork-scope="mine"]').getAttribute("aria-pressed")) === "true");
  await p.locator('[data-mywork-scope="all"]').click(); await settle(p, 800);
  ok("admin head: All departments brings back every machine", (await p.locator('[data-mywork-scope="all"]').getAttribute("aria-pressed")) === "true" && await p.locator("[data-mywork-card]").count() === 0);
  ok("no page errors (admin head)", errs.length === 0, errs.join(" | "));
  await b.close();
}
{
  // An admin who is NOT a head keeps today's default; a plain department user gets own machines on the phone only.
  const plain = headSeed.replace('Electrical: { userId: "super_admin_001", name: "Super Admin" }', "").replace('Mechanical: { userId: "u_ravi", name: "Ravi" }, ', "");
  const { b, p, errs } = await launch(plain, { width: 1440, height: 900 });
  await loginAdmin(p); await gotoMachineTracker(p);
  ok("admin (not a head): no My work panel, current default kept", await p.locator("[data-mywork]").count() === 0);
  await b.close();
  const r = await launch(plain, { width: 1440, height: 900 });
  await login(r.p, "ravi", "ravi123"); await gotoMachineTracker(r.p);
  ok("department user at 1440: own-machines strip hidden (phone only)", await r.p.locator("[data-mywork]").evaluate((e) => getComputedStyle(e).display) === "none");
  ok("department user: no near-limit strip (heads only)", await r.p.locator("[data-near-limit]").count() === 0);
  await r.p.setViewportSize({ width: 390, height: 844 }); await r.p.waitForTimeout(500);
  ok("department user at 390: 'Your machines' cards at the top", await r.p.locator("[data-mywork]").isVisible() && await r.p.locator("[data-mywork-card]").count() === 3 && await r.p.locator("[data-mywork-sent]").count() === 0);
  ok("no page errors (plain)", errs.length === 0 && r.errs.length === 0, [...errs, ...r.errs].join(" | "));
  await done(r.b);
}
