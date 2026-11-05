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
  await done(b);
}
