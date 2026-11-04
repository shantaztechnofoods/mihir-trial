// 2026-11-04 — owner bug: the BOM screen opened from the rack's "Fill Rack"
// had no "+ Add Pending Item" while the same BOM from the top BOM Outward did.
// Both entry points must show the same controls and the pending item must land
// on the new machine. LOCAL TEST DATA ONLY (localStorage-mode build).
import { launch, login, gotoMachineTracker, makeOk, ls } from "./lib/helpers.mjs";
const seed = () => {
  const pw = (s) => btoa(unescape(encodeURIComponent(s)));
  localStorage.clear();
  localStorage.setItem("erp_users", JSON.stringify([{ id: "super_admin_001", username: "admin", password: pw("admin123"), fullName: "Super Admin", role: "super_admin", status: "active" }]));
  const it = (id, code, name) => ({ id, code, name, unit: "Nos", stock: 20, min: 1, status: "safe", trend: [20, 20, 20, 20, 20], history: [], isCritical: false, outwardInputType: "checkbox", checkPoints: [] });
  localStorage.setItem("erp_items", JSON.stringify({ Mechanical: [it(1, "BLT-1", "Bolt set"), it(2, "FRM-10", "Frame 10kg")] }));
  const dur = { Assembly: { minutes: 480 }, Mechanical: { minutes: 480 }, Electrical: { minutes: 480 }, Trial: { minutes: 240 } };
  localStorage.setItem("erp_bomdefs", JSON.stringify({ "M-10": { label: "Kneading Machine 10kg", rackCapacity: 2, deptDurations: dur, items: [{ code: "BLT-1", qty: 2 }, { code: "FRM-10", qty: 1 }] } }));
  for (const k of ["erp_machines", "erp_handovers", "erp_pending_handover_items"]) localStorage.setItem(k, "[]");
};
const { ok, done } = makeOk();
const { b, p, errs } = await launch(seed, { width: 1440, height: 900 });
await login(p, "admin", "admin123");
const controls = () => p.evaluate(() => ({
  addPending: !!document.querySelector("[data-add-pending-item]"),
  issue: [...document.querySelectorAll("button")].some((x) => /Issue Stock/.test(x.innerText)),
  note: !!document.querySelector("input[placeholder^='Issue reference']"),
  // #110 drew the 💰 emoji as a line icon, so the button is found by its data hook
  cost: !!document.querySelector("button[data-bom-cost]"),
}));
const fillSerial = async (sn) => { await p.locator("input[placeholder^='e.g. SHT']").fill(sn); await p.getByRole("button", { name: /Proceed to Issue/ }).click(); await p.waitForTimeout(900); };

// ── A. top BOM Outward ──
await p.locator("button, a").filter({ hasText: /^Outward/ }).first().click(); await p.waitForTimeout(900);
await p.getByText("Open BOM →").first().click(); await p.waitForTimeout(600);
await fillSerial("SN-TOP-1");
const top = await controls();
ok("top BOM Outward: + Add Pending Item, note, cost and Issue Stock are shown", top.addPending && top.note && top.cost && top.issue, JSON.stringify(top));
await p.locator("button", { hasText: /✕ Close/ }).first().click(); await p.waitForTimeout(400);

// ── B. Fill Rack from the Machine Tracker rack view ──
await gotoMachineTracker(p);
await p.locator('[data-slot="M-10-1#1"]').first().click(); await p.waitForTimeout(500);
await p.locator('.rack-panel [data-action="fill"]').click(); await p.waitForTimeout(900);
await fillSerial("SN-RACK-1");
const rack = await controls();
ok("Fill Rack BOM shows the SAME controls as the top BOM Outward", JSON.stringify(rack) === JSON.stringify(top), JSON.stringify(rack));

await p.locator("[data-add-pending-item]").click(); await p.waitForTimeout(250);
await p.locator("[data-job-name]").fill("Special coupling"); await p.locator("[data-job-qty-input]").fill("2");
await p.locator("[data-pending-item-save]").click(); await p.waitForTimeout(250);
ok("Fill Rack: the pending item saves as a summary row", await p.locator("[data-pending-item-saved]").count() === 1);
await p.getByRole("button", { name: /Issue Stock/ }).first().click(); await p.waitForTimeout(1500);
const confirm = p.getByRole("button", { name: /Confirm Issue/ });
if (await confirm.count()) { await confirm.click(); await p.waitForTimeout(1500); }
const ms = await ls(p, "erp_machines"); const jobs = await ls(p, "erp_pending_handover_items");
const m = (ms || []).find((x) => x.serialNo === "SN-RACK-1");
ok("Fill Rack created the machine on that rack (BOM Issued, slot M-10-1#1)", !!m && m.stage === "BOM Issued" && m.rackSlot === "M-10-1#1", JSON.stringify(m && [m.stage, m.rackSlot]));
const j = (jobs || []).find((x) => x.itemName === "Special coupling");
ok("the pending item is a job on THAT machine (qty 2, source bom_outward, Stores)", !!j && m && String(j.machineId) === String(m.id) && Number(j.qty) === 2 && j.source === "bom_outward" && j.assignedDepartment === "Stores", JSON.stringify(j));
ok("exactly one job (no duplicate)", (jobs || []).filter((x) => x.itemName === "Special coupling").length === 1);
const audit = (await ls(p, "erp_audit")) || [];
ok("audit logs pending_item_raised for SN-RACK-1", audit.some((a) => a.type === "pending_item_raised" && a.serialNo === "SN-RACK-1"));
ok("no page errors", errs.length === 0, errs.join(" | "));
await done(b);
