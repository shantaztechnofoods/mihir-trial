// BOM screen → Checklists (2026-11-05). LOCAL TEST DATA ONLY (offline mode).
// Edit BOM → step 4 shows, per department, "Before receive" + "Before transfer":
// the BOM's own list editable point by point, or the common list greyed with
// "Make a list for this BOM". Last point removed → row switched off, never
// deleted. Copy to other BOMs. Settings folds switched-off templates.
// SHOT_DIR=<dir> also saves screenshots at 390x844 and 1440x900.
import fs from "fs";
import { launch, loginAdmin, makeOk, ls, settle } from "./lib/helpers.mjs";
const src = fs.readFileSync(new URL("./go-live-workflows.mjs", import.meta.url), "utf8");
const m = src.match(/const seed = \(\) => \{[\s\S]*?\n\};\n/); const baseSeed = eval("(" + m[0].replace("const seed = ", "").replace(/;\s*$/, "") + ")");
const seed = new Function(`(${baseSeed.toString()})();
  const defs = JSON.parse(localStorage.getItem("erp_bomdefs") || "{}");
  const first = Object.keys(defs)[0];
  if (first && !defs["M-15"]) { defs["M-15"] = JSON.parse(JSON.stringify(defs[first])); defs["M-15"].name = "Roti maker 15"; }
  if (first && !defs["M-20"]) { defs["M-20"] = JSON.parse(JSON.stringify(defs[first])); defs["M-20"].name = "Roti maker 20"; }
  localStorage.setItem("erp_bomdefs", JSON.stringify(defs));
  const it = (a) => a.map((label, i) => ({ id: "s" + i + label.length, label, required: i === 0 }));
  localStorage.setItem("erp_checklist_templates", JSON.stringify([
    { id: 101, department: "Mechanical", bomKey: "M-10", stage: "before_receive",  name: "Mechanical · Before receive", active: true, version: 1, items: it(["Frame welded and square", "All bolts tightened", "Tawa surface clean, no scratches", "Moving parts greased"]) },
    { id: 102, department: "Mechanical", bomKey: "M-10", stage: "before_dispatch", name: "Mechanical · Before transfer", active: true, version: 1, items: it(["Body covers fitted", "Chain tension checked", "No loose wires near moving parts"]) },
    { id: 9,   department: "Mechanical", bomKey: null,   stage: "before_dispatch", name: "Mechanical common", active: true, version: 1, items: it(["Workplace cleaned"]) },
    { id: 10,  department: "Assembly",   bomKey: null,   stage: "before_receive",  name: "Assembly common", active: true, version: 1, items: it(["All parts received from store", "BOM sheet attached"]) },
    { id: 5,   department: "Electrical", bomKey: null,   stage: null,              name: "Old electrical", active: false, version: 1, items: it(["asdf"]) },
    { id: 6,   department: "Electrical", bomKey: null,   stage: null,              name: "Old electrical 2", active: false, version: 1, items: it(["a"]) },
  ]));`);
const SHOT = process.env.SHOT_DIR || "";
if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
const { ok, done } = makeOk();
const { b, p, errs } = await launch(seed);
await loginAdmin(p);
if (SHOT) { await p.setViewportSize({ width: 1440, height: 900 }); await settle(p, 300); }

const openEditBom = async () => {
  await p.locator("button, a").filter({ hasText: /^Outward/ }).first().click(); await settle(p, 1200);
  await p.locator('button[title="BOM actions"]').first().click(); await p.waitForTimeout(200);
  await p.getByRole("menu").getByText("Edit BOM").click(); await settle(p, 800);
  await p.getByRole("button", { name: /Edit BOM/ }).first().click(); await settle(p, 600);
};
await openEditBom();
const panel = p.locator("[data-bom-checklists]");
ok("Checklists panel inside BOM edit step 4", await p.locator('[data-org-step="checklists"] [data-bom-checklists]').count() === 1);
ok("4 department tabs in order", JSON.stringify(await panel.locator(".bcl-tab").allInnerTexts()) === JSON.stringify(["Mechanical", "Assembly", "Electrical", "Trial"]));
const recv = panel.locator('[data-bcl-slot="Mechanical:before_receive"]');
const disp = panel.locator('[data-bcl-slot="Mechanical:before_dispatch"]');
ok("Before receive + Before transfer lists", await recv.locator(".bcl-slot-title").innerText() === "Before receive" && await disp.locator(".bcl-slot-title").innerText() === "Before transfer");
ok("BOM's own Mechanical list shown (4 points)", await recv.locator("[data-bcl-point]").count() === 4);
ok("'Workers see this list' line", await recv.getByText("Workers see this list at Accept.").count() === 1 && await disp.getByText("Workers see this list at Finish & Transfer.").count() === 1);
await panel.locator('[data-bcl-slot]').first().scrollIntoViewIfNeeded();
if (SHOT) await panel.screenshot({ path: `${SHOT}/bom-checklists-1440x900-panel.png` }).catch(() => {});

// Add a point
await recv.locator(".bcl-add input").fill("Check belt tension"); await recv.getByRole("button", { name: "Add point" }).click(); await settle(p, 600);
let t = (await ls(p, "erp_checklist_templates")).find((x) => x.id === 101);
ok("Add saves into the same BOM row", t.items.length === 5 && t.items[4].label === "Check belt tension" && t.active === true);
// Blank add → box flagged, nothing saved
await recv.getByRole("button", { name: "Add point" }).click(); await p.waitForTimeout(150);
ok("blank Add point flags the box only", await recv.locator(".bcl-add input.field-bad").count() === 1 && (await ls(p, "erp_checklist_templates")).find((x) => x.id === 101).items.length === 5);
// Edit — inline, the next row must not move; blank text is flagged, not saved
const nextTop = async () => (await recv.locator("[data-bcl-point]").nth(2).boundingBox())?.y;
const before = await nextTop();
await recv.getByRole("button", { name: "Edit point" }).nth(1).click();
const after = await nextTop();
ok("inline edit: next row does not move", before != null && Math.abs(before - after) < 1, `${before} -> ${after}`);
await recv.locator('input[aria-label="Point text"]').fill("  "); await recv.getByRole("button", { name: "Save point" }).click(); await p.waitForTimeout(100);
ok("blank edit flags the box and keeps editing", await recv.locator('input[aria-label="Point text"].field-bad').count() === 1);
await recv.locator('input[aria-label="Point text"]').fill("All bolts tightened to torque"); await recv.getByRole("button", { name: "Save point" }).click(); await settle(p, 600);
t = (await ls(p, "erp_checklist_templates")).find((x) => x.id === 101);
ok("Edit changes the text and keeps the id", t.items[1].label === "All bolts tightened to torque" && t.items[1].id);
// Move
await recv.getByRole("button", { name: "Move up" }).nth(1).click(); await settle(p, 600);
t = (await ls(p, "erp_checklist_templates")).find((x) => x.id === 101);
ok("Move up reorders", t.items[0].label === "All bolts tightened to torque");
// Remove (confirm accepted)
await recv.getByRole("button", { name: "Remove point" }).last().click(); await p.waitForTimeout(200);
const dlg = p.locator("[data-bcl-confirm]");
const confirmText = await dlg.innerText().catch(() => "");
ok("confirm: Cancel has focus, red 'Remove point' button", await p.evaluate(() => document.activeElement?.textContent) === "Cancel" && await dlg.getByRole("button", { name: "Remove point" }).count() === 1);
if (SHOT) await p.screenshot({ path: `${SHOT}/bom-checklists-1440x900-confirm.png` });
await p.keyboard.press("Escape"); await p.waitForTimeout(150);
ok("Escape cancels (nothing removed)", await dlg.count() === 0 && (await ls(p, "erp_checklist_templates")).find((x) => x.id === 101).items.length === 5);
await recv.getByRole("button", { name: "Remove point" }).last().click(); await p.waitForTimeout(150);
await dlg.getByRole("button", { name: "Remove point" }).click(); await settle(p, 600);
t = (await ls(p, "erp_checklist_templates")).find((x) => x.id === 101);
ok("Remove asks 'Are you sure?' with the point text", /Are you sure\?/.test(confirmText) && confirmText.includes("Check belt tension"), confirmText.replace(/\n/g, " "));
ok("Remove takes the point out", t.items.length === 4 && !t.items.some((i) => i.label === "Check belt tension"));
const audit = (await ls(p, "erp_audit_log")) || (await ls(p, "erp_audit")) || [];
ok("audit 'bom_checklist_changed' written", JSON.stringify(audit).includes("bom_checklist_changed"));

// Assembly: no own list → common greyed + Make a list
await panel.locator('.bcl-tab[data-dept="Assembly"]').click(); await p.waitForTimeout(200);
const aRecv = panel.locator('[data-bcl-slot="Assembly:before_receive"]');
ok("common list shown greyed when the BOM has none", await aRecv.locator("[data-bcl-common]").count() === 1 && await aRecv.getByText("All parts received from store").count() === 1);
if (SHOT) await panel.screenshot({ path: `${SHOT}/bom-checklists-1440x900-common.png` }).catch(() => {});
await aRecv.getByRole("button", { name: "Make a list for this BOM" }).click(); await settle(p, 600);
let all = await ls(p, "erp_checklist_templates");
const made = all.find((x) => x.bomKey === "M-10" && x.department === "Assembly" && x.stage === "before_receive");
ok("Make a list copies the common points into a new BOM row", made && made.items.length === 2 && made.active === true && all.find((x) => x.id === 10).items.length === 2);
ok("now editable with Add point", await aRecv.locator(".bcl-add input").count() === 1 && await aRecv.locator("[data-bcl-point]").count() === 2);
// Remove both → last one switches the row off (kept, not deleted)
for (let i = 0; i < 2; i++) { await aRecv.getByRole("button", { name: "Remove point" }).first().click(); await p.waitForTimeout(150); await p.locator("[data-bcl-confirm]").getByRole("button", { name: "Remove point" }).click(); await settle(p, 500); }
all = await ls(p, "erp_checklist_templates");
const off = all.find((x) => x.id === made.id);
ok("last point removed → row switched off, never deleted", off && off.active === false && off.items.length === 1, JSON.stringify(all.filter((x) => x.department === "Assembly")));
ok("common list applies again", await aRecv.locator("[data-bcl-common]").count() === 1);

// Copy to other BOMs
await panel.locator('.bcl-tab[data-dept="Mechanical"]').click(); await p.waitForTimeout(200);
await disp.getByRole("button", { name: "Copy to other BOMs…" }).click(); await p.waitForTimeout(150);
await disp.locator("[data-bcl-copy] label", { hasText: "M-15" }).click();
await disp.locator("[data-bcl-copy] label", { hasText: "M-20" }).click();
if (SHOT) await panel.screenshot({ path: `${SHOT}/bom-checklists-1440x900-copy.png` }).catch(() => {});
await disp.getByRole("button", { name: /^Copy to 2 BOMs/ }).click(); await p.waitForTimeout(150);
ok("copy asks first, naming the BOMs", (await p.locator("[data-bcl-confirm]").innerText()).includes("M-15, M-20"));
await p.locator("[data-bcl-confirm]").getByRole("button", { name: /^Copy to 2 BOMs/ }).click(); await settle(p, 800);
all = await ls(p, "erp_checklist_templates");
const c15 = all.find((x) => x.bomKey === "M-15" && x.department === "Mechanical" && x.stage === "before_dispatch" && x.active);
const c20 = all.find((x) => x.bomKey === "M-20" && x.department === "Mechanical" && x.stage === "before_dispatch" && x.active);
ok("Copy writes the list onto both BOMs", c15 && c20 && c15.items.length === 3 && c20.items[0].label === "Body covers fitted");
ok("copied points get fresh ids", c15 && c15.items[0].id !== all.find((x) => x.id === 102).items[0].id);
ok("source BOM row untouched by copy", all.find((x) => x.id === 102).items.length === 3);
ok("no row was deleted", all.length >= 6);

// Sizes
const ib = await recv.locator(".bcl-add input").boundingBox();
const ab = await recv.getByRole("button", { name: "Add point" }).boundingBox();
ok("input 40-44px, Add point 48px (desktop)", ib && ib.height >= 40 && ib.height <= 46 && ab && Math.round(ab.height) === 48, `${ib?.height} / ${ab?.height}`);
await p.setViewportSize({ width: 1440, height: 900 }); await settle(p, 400);
await panel.scrollIntoViewIfNeeded();
if (SHOT) await p.screenshot({ path: `${SHOT}/bom-checklists-1440x900.png` });

// Phone
await p.setViewportSize({ width: 390, height: 844 }); await settle(p, 500);
await panel.scrollIntoViewIfNeeded();
ok("phone: no sideways scroll", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
const pb = await recv.getByRole("button", { name: "Remove point" }).first().boundingBox();
ok("phone: point buttons 44x44 and inside the screen", pb && pb.height >= 44 && pb.width >= 44 && pb.x + pb.width <= 390, JSON.stringify(pb));
ok("phone: reorder arrows hidden (edit + remove only)", await recv.getByRole("button", { name: "Move up" }).first().isHidden());
const tb = await recv.locator("[data-bcl-point] .bcl-text").first().boundingBox();
ok("phone: point text keeps >= 150px width", tb && tb.width >= 150, JSON.stringify(tb));
const pin = await recv.locator(".bcl-add input").boundingBox();
ok("phone: add box usable width (>= 150px)", pin && pin.width >= 150, JSON.stringify(pin));
if (SHOT) {
  await p.screenshot({ path: `${SHOT}/bom-checklists-390x844.png` });
  await disp.scrollIntoViewIfNeeded(); await p.screenshot({ path: `${SHOT}/bom-checklists-390x844-transfer.png` });
}
await p.setViewportSize({ width: 360, height: 780 }); await settle(p, 400);
ok("360px: no sideways scroll", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await p.setViewportSize({ width: 1200, height: 1000 }); await settle(p, 300);

// Settings → Department Checklists: switched-off fold
await p.getByRole("button", { name: /Discard Changes/ }).click().catch(() => {});
await p.keyboard.press("Escape").catch(() => {});
await p.goto(p.url()); await settle(p, 1200);
await p.locator("button, a").filter({ hasText: /^Settings/ }).first().click(); await settle(p, 800);
await p.getByRole("button", { name: /Department Checklists/ }).first().click(); await settle(p, 500);
const fold = p.locator("[data-cl-switched-off]");
const offCount = (await ls(p, "erp_checklist_templates")).filter((x) => x.active === false).length;
ok("Settings: 'Switched off (N)' fold present with the right count", (await fold.locator("button").first().innerText()).includes(`Switched off (${offCount})`));
ok("Settings: switched-off rows hidden until opened", await p.getByText("Old electrical", { exact: true }).count() === 0);
await fold.locator("button").first().click(); await p.waitForTimeout(200);
ok("Settings: opening shows them (still there, not deleted)", await p.getByText("Old electrical", { exact: true }).count() === 1);
if (SHOT) await p.screenshot({ path: `${SHOT}/settings-switched-off-1200.png`, fullPage: false });
ok("no page errors", errs.length === 0, errs.join(" | "));
await done(b);
