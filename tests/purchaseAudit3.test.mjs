// Purchase audit 3: PO receive that auto-fulfils pending shortfalls writes a
// pending_fulfilled audit row; Edit PO keeps po.date in the "4 Nov 2026" form
// and shows a legacy PO's date in the picker.
// Run: node --test tests/purchaseAudit3.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isoToDisplayDate, parseDisplayDate } from "../src/utils/parseDate.js";

const APP = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const slice = (start, end) => {
  const i = APP.indexOf(start);
  assert.ok(i >= 0, `missing ${start}`);
  return APP.slice(i, APP.indexOf(end, i + start.length));
};

test("PO receive logs pending_fulfilled for stock that went to shortfalls", () => {
  const h = slice("const handleReceivePO = async (id) => {", "const handleDeletePO");
  assert.match(h, /type: "pending_fulfilled", module: "Pending"/);
  assert.match(h, /auto: "po", po: id/);
  assert.match(h, /Object\.entries\(lineDeductions\)\.forEach/);
});

test("Edit PO saves po.date in display form, not the raw picker value", () => {
  assert.match(APP, /date:\s+isoToDisplayDate\(form\.poDate \|\| todayIso\(\)\),/);
  assert.doesNotMatch(APP, /date:\s+form\.poDate \|\| todayIso\(\),/);
  assert.equal(isoToDisplayDate("2026-11-04"), "4 Nov 2026");
});

test("Edit PO turns a legacy display date into yyyy-mm-dd for the picker", () => {
  const m = slice("if (isEdit) return {", "return {\n      vendor:    prefill");
  assert.match(m, /const d = parseDisplayDate\(v\);/);
  const d = parseDisplayDate("4 Sept 2026");
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  assert.equal(iso, "2026-09-04");
});
