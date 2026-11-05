// Owner rule (2026-11-05): nothing in the ERP is ever deleted — master data is
// archived and restorable. Pure helpers (src/utils/archive.js) + static guards
// on the stores / screens. Store write shapes: tests/archiveStores.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  isBomArchived, isItemArchived, isVendorArchived, isTemplateArchived, splitArchived,
  archivedBomEntries, archiveBomDef, restoreBomDef, archiveItemRow, restoreItemRow,
  archivedItemsFromGrouped, withoutArchivedItems, archiveConfirmTitle, restoreConfirmTitle,
} from "../src/utils/archive.js";

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const code = (s) => s.split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");

test("archive predicates", () => {
  assert.equal(isBomArchived({ retiredAt: "2026-11-05T09:13:00Z" }), true);
  assert.equal(isBomArchived({ retiredAt: null }), false);
  assert.equal(isBomArchived(null), false);
  assert.equal(isItemArchived({ archived: true }), true);
  assert.equal(isItemArchived({ isActive: false }), true);
  assert.equal(isItemArchived({ code: "X" }), false);
  assert.equal(isVendorArchived({ archived: true }), true);
  assert.equal(isVendorArchived({ archived: false }), false);
  assert.equal(isTemplateArchived({ active: false }), true);
  assert.equal(isTemplateArchived({ active: true }), false);
  assert.equal(isTemplateArchived({}), false, "missing active = on");
});

test("splitArchived never drops a row", () => {
  const list = [{ id: 1 }, { id: 2, archived: true }, { id: 3 }];
  const { active, archived } = splitArchived(list, isVendorArchived);
  assert.deepEqual(active.map((x) => x.id), [1, 3]);
  assert.deepEqual(archived.map((x) => x.id), [2]);
  assert.equal(active.length + archived.length, list.length);
  assert.deepEqual(splitArchived(null, isVendorArchived), { active: [], archived: [] });
});

test("BOM archive → restore round trip keeps every field", () => {
  const def = { label: "Rack M-10", items: [{ code: "A", qty: 2 }], rackCapacity: 2, photoUrl: "u", deptDurations: { Assembly: { minutes: 60 } } };
  const a = archiveBomDef(def, "2026-11-05T09:13:00Z");
  assert.equal(a.retiredAt, "2026-11-05T09:13:00Z");
  assert.deepEqual({ ...a, retiredAt: undefined }, { ...def, retiredAt: undefined });
  const r = restoreBomDef({ ...a, replacedBy: "M-11" });
  assert.equal(r.retiredAt, null);
  assert.equal(r.replacedBy, null);
  assert.deepEqual(r.items, def.items);
  assert.equal(def.retiredAt, undefined, "input not mutated");
});

test("archivedBomEntries lists only archived BOMs, newest first", () => {
  const defs = { "M-10": { label: "a" }, KM10: { retiredAt: "2026-10-31T00:00:00Z", replacedBy: "M-10" }, "R-20": { retiredAt: "2026-11-05T09:13:00Z" } };
  assert.deepEqual(archivedBomEntries(defs).map(([k]) => k), ["R-20", "KM10"]);
  assert.deepEqual(archivedBomEntries(undefined), []);
});

test("item archive helpers", () => {
  const it = { code: "X1", name: "Bolt", stock: 5 };
  const a = archiveItemRow(it, "t");
  assert.equal(a.archived, true); assert.equal(a.archivedAt, "t"); assert.equal(a.stock, 5);
  const r = restoreItemRow(a);
  assert.equal(r.archived, undefined); assert.equal(r.isActive, true); assert.equal(r.stock, 5);
  const grouped = { Hardware: [it, a], Motors: [{ code: "M1" }] };
  assert.deepEqual(archivedItemsFromGrouped(grouped).map((x) => `${x.category}:${x.item.code}`), ["Hardware:X1"]);
  assert.deepEqual(withoutArchivedItems(grouped), { Hardware: [it], Motors: [{ code: "M1" }] });
});

test("named confirmation titles", () => {
  assert.equal(archiveConfirmTitle("BOM", "M-10"), "Archive BOM 'M-10'?");
  assert.equal(restoreConfirmTitle("item", "Bolt"), "Restore item 'Bolt'?");
});

// ── Static guards ───────────────────────────────────────────────────────────
test("no store issues a DELETE on master / history tables", () => {
  for (const [file, table] of [["bomsStore", "bom_definitions"], ["itemsStore", "items"], ["vendorsStore", "vendors"], ["checklistsStore", "checklist_templates"]]) {
    const src = code(read(`src/stores/${file}.js`));
    assert.doesNotMatch(src, new RegExp(`from\\("${table}"\\)\\.delete\\(`), `${file} must not delete from ${table}`);
    assert.doesNotMatch(src, /\.delete\(\)/, `${file} has no .delete() call at all`);
  }
});

test("store delete* names archive instead (kept for the regression inventory)", () => {
  assert.match(read("src/stores/bomsStore.js"), /export async function deleteBOM\(key\) \{ return archiveBOM\(key\); \}/);
  assert.match(read("src/stores/checklistsStore.js"), /export async function deleteTemplate\(id\) \{\s*return updateTemplate\(id, \{ active: false \}\);/);
  assert.match(read("src/stores/vendorsStore.js"), /export async function deleteVendor[\s\S]*?return archiveVendor\(v\);/);
});

test("Clear Demo Data: Trial-only (ERP_INSTANCE), BOMs unticked, archives instead of deleting", () => {
  const inv = read("src/modules/inventory/InventoryPage.jsx");
  assert.match(inv, /import \{ ERP_INSTANCE \} from "..\/..\/config\/env.js"/);
  assert.match(inv, /\{ERP_INSTANCE === "trial" && canDo\("inventory","delete"\) && \(\s*<button onClick=\{\(\) => setShowClearDemo\(true\)\}/, "button rendered only on Trial");
  assert.match(inv, /\{showClearDemo && ERP_INSTANCE === "trial" && \(/, "modal rendered only on Trial");
  assert.match(inv, /const \[wipeBoms,\s+setWipeBoms\]\s+= useState\(false\)/, "BOMs box unticked by default");
  assert.match(inv, /toUpperCase\(\) === "ARCHIVE"/, "typed confirmation is ARCHIVE");
  assert.doesNotMatch(code(inv), /Delete all BOMs|Delete all items|This cannot be undone/);
  assert.match(inv, /filter\(\(\[, d\]\) => !\(d && d\.retiredAt\)\)/, "already-archived BOMs skipped");
});

test("screens say Archive, list Archived (N) and offer Restore", () => {
  const out = read("src/modules/inventory/OutwardPage.jsx");
  assert.match(out, /Archive BOM/); assert.doesNotMatch(code(out), />\s*Delete BOM\s*</);
  assert.match(out, /<ArchivedSection kind="BOM"/);
  assert.match(out, /canRestore=\{!!onRestoreBOM && canDo\("outward","bom"\)\}/);
  const inv = read("src/modules/inventory/InventoryPage.jsx");
  assert.match(inv, /<ArchivedSection kind="item"/);
  assert.match(inv, /canRestore=\{!!onRestoreItem && canDo\("inventory","delete"\)\}/);
  const ven = read("src/modules/purchase/VendorsPage.jsx");
  assert.match(ven, /<ArchivedSection kind="vendor"/);
  assert.match(ven, /canRestore=\{!!onRestoreVendor && canDo\("vendors","delete"\)\}/);
  const sec = read("src/shared/components/ArchivedSection.jsx");
  assert.match(sec, /Archived \(\{rows\.length\}\)/);
  assert.match(sec, /restoreConfirmTitle\(kind, getName\(confirm\)\)/, "named confirmation");
  assert.match(sec, /cancelRef\.current\?\.focus\(\)/, "Cancel focused by default");
  assert.match(sec, /e\.key === "Escape"/, "Escape closes");
  assert.match(read("src/modules/settings/ChecklistAdminPanel.jsx"), /data-cl-switch-on/);
});

test("App handlers archive + restore with audit events", () => {
  const app = read("src/app/App.jsx");
  for (const t of ["bom_archived", "bom_restored", "item_archived", "item_restored", "vendor_archived", "vendor_restored", "checklist_template_archived", "checklist_template_restored"])
    assert.ok(app.includes(`"${t}"`), t);
  for (const h of ["handleRestoreBOM", "handleRestoreItemRow", "handleRestoreVendor"]) assert.ok(app.includes(`const ${h} = async`), h);
  assert.ok(app.includes("onRestoreBOM: guarded.restoreBOM"));
  assert.ok(app.includes("onRestoreItem={guarded.restoreItemRow}"));
  assert.ok(app.includes("onRestoreVendor={guarded.restoreVendor}"));
  assert.doesNotMatch(code(app), /deleteVendor\(id\)/, "vendor is never hard-deleted");
});

test("migration 070 guards the tables and keeps a rollback", () => {
  const m = read("supabase/migrations/070_no_hard_delete.sql");
  for (const t of ["bom_definitions", "items", "vendors", "checklist_templates", "item_history", "machine_log", "handover_events", "pending_handover_items", "checklist_responses"])
    assert.ok(m.includes(`'${t}'`), t);
  assert.match(m, /RAISE EXCEPTION 'Deleting is not allowed — archive instead'/);
  assert.match(m, /current_setting\('app\.allow_hard_delete', true\)/);
  assert.match(m, /ON UPDATE CASCADE ON DELETE RESTRICT/);
  assert.match(m, /DROP CONSTRAINT IF EXISTS checklist_templates_bom_key_fkey/);
  assert.ok(fs.existsSync(new URL("../supabase/migrations/070_no_hard_delete_rollback.sql", import.meta.url)));
  assert.ok(fs.existsSync(new URL("../tests/db/070_no_hard_delete_tests.sql", import.meta.url)));
});
