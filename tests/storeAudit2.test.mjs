// Store audit 2: an item code that a BOM / pending shortfall / open PO points
// at cannot be renamed, and Add/Edit Item ignores a second Save tap while the
// first write is still running.
// Run: node --test tests/storeAudit2.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appSource } from "./helpers/source.mjs";

const APP = appSource();
const modal = (() => {
  const i = APP.indexOf("function AddItemModal(");
  assert.ok(i >= 0);
  return APP.slice(i, APP.indexOf("const nameRef  = useRef(null);", i));
})();

test("AddItemModal refuses a code change when the item is referenced", () => {
  assert.match(modal, /codeLockReason = ""/);
  assert.match(modal, /else if \(isEdit && codeLockReason && c !== own\) e\.code = `Code cannot change — \$\{codeLockReason\}`/);
});

test("Edit Item passes the lock reason: BOM, then pending, then open PO", () => {
  const i = APP.indexOf("initialValues={{ ...editingItem.item, machine: editingItem.category }}");
  assert.ok(i >= 0);
  const call = APP.slice(i, i + 900);
  assert.match(call, /codeLockReason=\{/);
  assert.match(call, /used in BOM/);
  assert.match(call, /it has open pending stock/);
  assert.match(call, /!\["rejected", "received"\]\.includes\(p\.status\)/);
});

test("AddItemModal Save has an in-flight guard that is released when the save settles", () => {
  assert.match(modal, /const savingRef = useRef\(false\);/);
  assert.match(modal, /if \(savingRef\.current\) return;/);
  assert.match(modal, /savingRef\.current = true;\s*Promise\.resolve\(onSave\(form\.machine,/);
  assert.match(modal, /\}\)\)\.finally\(\(\) => \{ savingRef\.current = false; \}\);/);
});
