// Owner rule (2026-11-05): nothing in the ERP is ever deleted. LOCAL TEST DATA ONLY.
// BOM: Archive BOM → leaves the BOM cards, shows under "Archived (N)", keeps its
// checklist link → Restore (named confirm) → back in the list; audit has
// bom_archived + bom_restored. Item: Archive → Archived (N) → Restore. Vendor:
// Archive → Archived (N) → Restore. "Clear Demo Data" is gone from Item Master.
import { launch, loginAdmin, makeOk, ls, settle } from "./lib/helpers.mjs";

const seed = () => {
  const pwd = (s) => btoa(unescape(encodeURIComponent(s)));
  localStorage.clear();
  localStorage.setItem("erp_users", JSON.stringify([{ id: "super_admin_001", username: "admin", password: pwd("admin123"), fullName: "Super Admin", role: "super_admin", status: "active" }]));
  localStorage.setItem("erp_bomdefs", JSON.stringify({
    "M-10": { label: "Kneading Machine 10kg", rackCapacity: 2, items: [{ code: "GBX", qty: 1 }] },
    "T-ARC": { label: "Archive Test Model", rackCapacity: 0, items: [{ code: "GBX", qty: 2 }] },
  }));
  localStorage.setItem("erp_machines", "[]");
  localStorage.setItem("erp_items", JSON.stringify({ Mechanical: [
    { id: 1, code: "GBX", name: "Gearbox", unit: "Nos", stock: 10, min: 1, status: "safe", trend: [10, 10, 10, 10, 10], history: [], isCritical: false },
    { id: 2, code: "OLD-1", name: "Old Bracket", unit: "Nos", stock: 3, min: 0, status: "safe", trend: [3, 3, 3, 3, 3], history: [], isCritical: false },
  ] }));
  localStorage.setItem("erp_vendors", JSON.stringify([{ id: "v1", name: "Acme Steel", category: "Steel", status: "preferred" }]));
  localStorage.setItem("erp_checklist_templates", JSON.stringify([
    { id: 901, department: "Assembly", name: "T-ARC before dispatch", items: [{ id: "a", label: "Bolts tight" }], active: true, bomKey: "T-ARC", stage: "before_dispatch", version: 1 },
  ]));
  localStorage.setItem("erp_audit", "[]");
};
const nav = async (p, label) => { await p.locator("button, a").filter({ hasText: new RegExp(`^${label}`) }).first().click(); await settle(p, 1000); };
const audits = async (p) => ((await ls(p, "erp_audit")) || []).map((a) => a.type);

const { ok, done } = makeOk();
const { b, p, errs } = await launch(`(${seed})();`);
await loginAdmin(p);

// ── Item Master: the bulk wipe button is gone ───────────────────────────────
await nav(p, "Item Master");
ok("Item Master has no 'Clear Demo Data' button", await p.getByText("Clear Demo Data").count() === 0);

// ── BOM: archive → Archived (N) → restore ──────────────────────────────────
await nav(p, "Outward");
ok("T-ARC is in the BOM list before archiving", await p.getByText("Archive Test Model").count() >= 1);
const cards = p.locator('button[title="BOM actions"]');
const cardsBefore = await cards.count();
let idx = -1;
for (let i = 0; i < await cards.count(); i++) {
  const txt = await cards.nth(i).locator("xpath=ancestor::*[contains(@class,'section-card') or contains(@class,'rounded')][1]").innerText().catch(() => "");
  if (/T-ARC|Archive Test Model/.test(txt)) { idx = i; break; }
}
if (idx < 0) idx = (await cards.count()) - 1;
await cards.nth(idx).click(); await settle(p, 300);
const menuArchive = p.getByText("Archive BOM", { exact: false }).first();
ok("BOM ⋮ menu offers 'Archive BOM' (no 'Delete BOM')", await menuArchive.count() === 1 && await p.getByText("Delete BOM").count() === 0);
await menuArchive.click(); await settle(p, 300);
ok("archive confirmation names the BOM", await p.getByText("Archive BOM 'T-ARC'?").count() === 1);
ok("Cancel is focused by default", await p.evaluate(() => (document.activeElement?.textContent || "").trim() === "Cancel"));
await p.getByRole("button", { name: /Archive BOM$/ }).last().click(); await settle(p, 800);
let defs = await ls(p, "erp_bomdefs");
ok("BOM row is kept with retiredAt (not deleted)", defs["T-ARC"] && typeof defs["T-ARC"].retiredAt === "string", JSON.stringify(defs["T-ARC"]));
ok("BOM items are kept", defs["T-ARC"]?.items?.length === 1);
ok("archived BOM left the BOM cards (one card fewer)", await cards.count() === cardsBefore - 1, `${cardsBefore} → ${await cards.count()}`);
const tpl = ((await ls(p, "erp_checklist_templates")) || []).find((t) => t.id === 901);
ok("its checklist keeps the BOM link", tpl && tpl.bomKey === "T-ARC" && tpl.active === true, JSON.stringify(tpl));
const arch = p.locator('[data-archived-section="boms"]');
ok("'Archived (1)' section shows, collapsed", await arch.count() === 1 && /Archived \(1\)/.test(await arch.innerText()) && await arch.locator("[data-archived-row]").count() === 0);
await arch.getByRole("button", { name: /Archived \(1\)/ }).click(); await settle(p, 200);
ok("expanded: T-ARC listed with Restore", await arch.locator('[data-archived-row="T-ARC"]').count() === 1 && await arch.getByRole("button", { name: "Restore" }).count() === 1);
await arch.getByRole("button", { name: "Restore" }).click(); await settle(p, 200);
ok("restore confirmation names the BOM", await p.getByText("Restore BOM 'T-ARC · Archive Test Model'?").count() === 1);
ok("restore dialog: Cancel focused", await p.evaluate(() => (document.activeElement?.textContent || "").trim() === "Cancel"));
await p.keyboard.press("Escape"); await settle(p, 200);
ok("Escape closes without restoring", await p.getByText("Restore BOM 'T-ARC · Archive Test Model'?").count() === 0 && typeof (await ls(p, "erp_bomdefs"))["T-ARC"].retiredAt === "string");
await arch.getByRole("button", { name: "Restore" }).click(); await settle(p, 200);
await p.getByRole("button", { name: "Restore BOM" }).click(); await settle(p, 800);
defs = await ls(p, "erp_bomdefs");
ok("restored: retiredAt cleared", defs["T-ARC"] && !defs["T-ARC"].retiredAt);
ok("restored BOM is back in the list", await cards.count() === cardsBefore);
ok("Archived section gone when empty", await p.locator('[data-archived-section="boms"]').count() === 0);
let types = await audits(p);
ok("audit: bom_archived + bom_restored (no bom_deleted)", types.includes("bom_archived") && types.includes("bom_restored") && !types.includes("bom_deleted"), types.join(","));

// ── Item: archive → Archived (N) → restore ─────────────────────────────────
await nav(p, "Item Master");
await p.locator("tr.wu-imrow").filter({ hasText: "OLD-1" }).first().click(); await settle(p, 500);
await p.getByRole("button", { name: /Archive$/ }).first().click(); await settle(p, 300);
ok("item archive confirmation names the item", await p.getByText("Archive item 'Old Bracket'?").count() === 1);
await p.getByRole("button", { name: /Archive item/ }).click(); await settle(p, 800);
ok("archived item left the table", await p.locator("tr.wu-imrow").filter({ hasText: "OLD-1" }).count() === 0);
const arcStore = (await ls(p, "erp_items_archived")) || [];
ok("archived item row is kept (moved, not dropped)", arcStore.some((x) => x.item?.code === "OLD-1" && x.item?.stock === 3), JSON.stringify(arcStore));
const ia = p.locator('[data-archived-section="items"]');
ok("Item Master shows 'Archived (1)'", await ia.count() === 1 && /Archived \(1\)/.test(await ia.innerText()));
await ia.getByRole("button", { name: /Archived \(1\)/ }).click(); await settle(p, 200);
await ia.getByRole("button", { name: "Restore" }).click(); await settle(p, 200);
await p.getByRole("button", { name: "Restore item" }).click(); await settle(p, 800);
ok("restored item is back in the table", await p.locator("tr.wu-imrow").filter({ hasText: "OLD-1" }).count() === 1);
ok("item stock unchanged after round trip", ((await ls(p, "erp_items")).Mechanical || []).find((i) => i.code === "OLD-1")?.stock === 3);

// ── Vendor: archive → Archived (N) → restore ───────────────────────────────
await nav(p, "Vendors");
await p.locator('button[title="Archive Acme Steel"]').click(); await settle(p, 300);
ok("vendor archive confirmation names the vendor", await p.getByText("Archive vendor 'Acme Steel'?").count() === 1);
await p.getByRole("button", { name: "Archive vendor" }).click(); await settle(p, 800);
ok("vendor kept with archived flag", ((await ls(p, "erp_vendors")) || []).some((v) => v.id === "v1" && v.archived === true));
const va = p.locator('[data-archived-section="vendors"]');
ok("Vendors shows 'Archived (1)'", await va.count() === 1);
await va.getByRole("button", { name: /Archived \(1\)/ }).click(); await settle(p, 200);
await va.getByRole("button", { name: "Restore" }).click(); await settle(p, 200);
await p.getByRole("button", { name: "Restore vendor" }).click(); await settle(p, 800);
ok("vendor restored", ((await ls(p, "erp_vendors")) || []).some((v) => v.id === "v1" && !v.archived) && await p.locator('[data-archived-section="vendors"]').count() === 0);
types = await audits(p);
for (const t of ["item_archived", "item_restored", "vendor_archived", "vendor_restored"]) ok(`audit has ${t}`, types.includes(t));
ok("nothing logged as deleted", !types.some((t) => /_deleted$|^vendor_delete$/.test(t)), types.join(","));

// ── Phone width: Archived section usable, no sideways scroll ──────────────
await p.setViewportSize({ width: 390, height: 844 }); await nav(p, "Outward").catch(() => {});
ok("no sideways scroll at 390px", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
ok("no page errors", errs.length === 0, errs.join(" | "));
await done(b);
