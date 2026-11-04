// Machine Tracker Settings + Edit BOM organised into sections (2026-11-03).
// Layout only: checks the new headings exist and the key controls are still
// reachable at desktop and phone width. LOCAL TEST DATA ONLY.
import fs from "fs";
import { launch, loginAdmin, gotoMachineTracker, makeOk } from "./lib/helpers.mjs";
const src = fs.readFileSync(new URL("./go-live-workflows.mjs", import.meta.url), "utf8");
const m = src.match(/const seed = \(\) => \{[\s\S]*?\n\};\n/); const seed = eval("(" + m[0].replace("const seed = ", "").replace(/;\s*$/, "") + ")");
const { ok, done } = makeOk();
const { b, p, errs } = await launch(seed);
await loginAdmin(p); await gotoMachineTracker(p);

// ── Machine Tracker → ⚙️ Settings ──────────────────────────────────────────
await p.locator("button[data-mt-settings]", { hasText: /^Settings$/ }).first().click(); await p.waitForTimeout(800);
const groups = await p.locator("[data-org-group] .org-group-title").allInnerTexts();
ok("settings groups in order", JSON.stringify(groups) === JSON.stringify(["Deadlines & HOLD rules", "Employees per department", "Working calendar", "Advanced"]), JSON.stringify(groups));
ok("every group has a one-line helper", await p.locator("[data-org-group] .org-group-hint").count() === 4);
ok("deadline inputs reachable (4 depts x 3 + timeout 2)", await p.locator('[data-org-group="deadlines"] input[type=number]:visible').count() === 14);
ok("weekly-off Tue button and + Add holiday visible", await p.getByRole("button", { name: "Tue" }).isVisible() && await p.getByRole("button", { name: "+ Add holiday" }).isVisible());
ok("Department Employees rows present", await p.locator('[data-org-group="employees"]').getByText("Department Employees").count() === 1);
const adv = p.locator('[data-org-group="advanced"]');
ok("Advanced starts closed", (await adv.getAttribute("data-open")) === "0" && !(await adv.getByText("Require password re-entry at Accept Machine").isVisible()));
await adv.locator(".org-group-head").click(); await p.waitForTimeout(200);
ok("Advanced opens and shows Transfer rules", await adv.getByText("Require password re-entry at Accept Machine").isVisible());
const hb = await p.locator('[data-org-group="deadlines"] .org-group-head').boundingBox();
ok("group headers are >= 44px", hb && hb.height >= 44, JSON.stringify(hb));
ok("Department Checklists and Employees tabs still there", await p.getByRole("button", { name: /Department Checklists/ }).count() === 1 && await p.getByRole("button", { name: /Employees/ }).count() >= 1);
await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(400);
ok("settings: no sideways scroll at 390px", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
const ib = await p.locator('[data-org-group="deadlines"] .org-dur-row input').first().boundingBox();
ok("settings: day input >= 44px tall on phone", ib && ib.height >= 44, JSON.stringify(ib));
await p.setViewportSize({ width: 1200, height: 1000 }); await p.waitForTimeout(300);

// ── Outward → BOM ⋮ → Edit BOM → ✏️ Edit BOM ───────────────────────────────
await p.locator("button, a").filter({ hasText: /^Outward/ }).first().click(); await p.waitForTimeout(1000);
await p.locator('button[title="BOM actions"]').first().click(); await p.waitForTimeout(200);
await p.getByRole("menu").getByText("Edit BOM").click(); await p.waitForTimeout(800);
await p.getByRole("button", { name: /Edit BOM/ }).first().click(); await p.waitForTimeout(500);
const steps = await p.locator("[data-org-step] .org-step-title").allInnerTexts();
ok("BOM edit steps 1-5 in order", JSON.stringify(steps) === JSON.stringify(["Details", "Parts", "Time per department", "Checklists", "Machine photo"]), JSON.stringify(steps));
ok("step headings carry numbers 1-5", JSON.stringify(await p.locator("[data-org-step] .org-step-num").allInnerTexts()) === JSON.stringify(["1","2","3","4","5"]));
const sbd = await p.getByRole("button", { name: /Save BOM/ }).boundingBox();
ok("Save BOM is right-sized on desktop (44-56px tall, not full width)", sbd && sbd.height >= 44 && sbd.height <= 56 && sbd.width < 400, JSON.stringify(sbd));
ok("Details holds BOM key + model name", await p.locator('[data-org-step="details"] input').count() >= 2);
ok("Parts holds Add + Paste from Excel + Critical Items", await p.locator('[data-org-step="parts"]').getByRole("button", { name: "Add", exact: true }).count() === 1
   && await p.locator('[data-org-step="parts"]').getByRole("button", { name: "Paste from Excel" }).count() === 1 && await p.locator('[data-org-step="parts"]').getByText("Critical Items").count() >= 1);
ok("Time step has days + hours for 4 departments", await p.locator('[data-org-step="time"] input[type=number]').count() === 8);
const glance = p.locator("[data-org-checklist-glance] button");
ok("checklist glance shows 4 departments", await glance.count() === 4);
ok("Machine photo field in step 5", await p.locator('[data-org-step="photo"] [data-bom-photo-field]').count() === 1);
ok("one Save BOM + Discard Changes", await p.getByRole("button", { name: /Save BOM/ }).count() === 1 && await p.getByRole("button", { name: "Discard Changes" }).count() === 1);
// Checklist editor: Enter adds the next step, buttons are big, Must do visible.
await glance.first().click(); await p.waitForTimeout(300);
await p.locator('[data-cl-dept="Assembly"] button').first().click(); await p.waitForTimeout(300);
const in0 = p.locator("[data-cl-step-input]").first(); await in0.fill("Check bolts"); await in0.press("Enter"); await p.waitForTimeout(200);
ok("Enter adds a new step and focuses it", await p.locator("[data-cl-step-input]").count() === 2 && await p.evaluate(() => document.activeElement?.getAttribute("data-cl-step-input")) === "1");
ok("Must do toggle visible on each step", await p.locator("[data-cl-step-row]").getByText("Must do").count() === 2);
const rb = await p.getByRole("button", { name: "Remove step" }).first().boundingBox();
ok("move / remove buttons >= 44px", rb && rb.width >= 44 && rb.height >= 44, JSON.stringify(rb));
await p.keyboard.type("Oil level");
await p.getByRole("button", { name: /Save Checklist/ }).click(); await p.waitForTimeout(500);
ok("saved checklist shows ✓ for Assembly at a glance", (await p.locator('[data-org-checklist-glance] button[data-dept="Assembly"]').getAttribute("data-has-checklist")) === "1");
await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(400);
ok("BOM edit: no sideways scroll at 390px", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
const sb = await p.getByRole("button", { name: /Save BOM/ }).boundingBox();
ok("BOM edit: Save BOM 44-56px tall and not full width on phone", sb && sb.height >= 44 && sb.height <= 56 && sb.width < 390 - 32, JSON.stringify(sb));
ok("no page errors", errs.length === 0, errs.join(" | "));
await done(b);
