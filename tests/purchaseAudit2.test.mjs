// Purchase audit 2: Delete PO leaves no follow-ups behind, rejected POs are
// not "open value", duplicate vendor names are refused, PO search survives a
// PO without a vendor name.
// Run: node --test tests/purchaseAudit2.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appSource } from "./helpers/source.mjs";

const APP = appSource();
const body = (start, end) => {
  const i = APP.indexOf(start);
  assert.ok(i >= 0, `missing ${start}`);
  const j = APP.indexOf(end, i + start.length);
  return APP.slice(i, j < 0 ? undefined : j);
};

test("Delete PO also removes that PO's follow-ups (local + Supabase)", () => {
  const h = body("const handleDeletePO = (id) => {", "const handleReverseReceive");
  assert.match(h, /setFollowUps\(\(prev\) => prev\.filter\(\(f\) => f\.poId !== id\)\)/);
  assert.match(h, /if \(isSupabaseEnabled\(\)\) deleteFollowUpsByPO\(id\)/);
  assert.match(h, /logAudit\(/);
});

test("Dashboard Open PO Value leaves out rejected POs and missing amounts", () => {
  const d = body("function DashboardPage(", "const curr    = getCurrSymbol");
  assert.match(d, /openPOs\s*=\s*pos\.filter\(\(p\) => !\["received", "rejected"\]\.includes\(p\.status\)\)/);
  assert.match(d, /Number\(p\.amount\) \|\| 0/);
  assert.match(APP, /sub: `\$\{openPOs\.length\} open`/);
});

test("Purchase page Open Value leaves out rejected POs", () => {
  const p = body("function PurchasePage(", "const overdueN");
  assert.match(p, /!\["received", "rejected"\]\.includes\(p\.status\)\)\.reduce\(\(s, p\) => s \+ \(Number\(p\.amount\) \|\| 0\)/);
});

test("Purchase page search does not throw on a PO without a vendor", () => {
  const p = body("function PurchasePage(", "const totalAmt");
  assert.match(p, /String\(po\.vendor \|\| ""\)\.toLowerCase\(\)/);
  assert.doesNotMatch(p, /po\.vendor\.toLowerCase\(\)/);
});

test("Vendor form refuses a duplicate name (case / spaces ignored, own name allowed on edit)", () => {
  const m = body("function VendorModal(", "const ILabel");
  assert.match(m, /existingNames = \[\]/);
  assert.match(m, /already exists/);
  // Re-run the same key rule the form uses.
  const key = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
  assert.equal(key("  Bharat  Lubricants "), key("bharat lubricants"));
  assert.match(APP, /<VendorModal\s+initialVendor=\{editingVendor\}\s+existingNames=\{vendorList\.map\(\(v\) => v\.name\)\}/);
});
