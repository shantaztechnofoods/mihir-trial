// 2026-11-04 — Stores read-only Machine Tracker overview + migration 065.
// Static checks; the behavioural DB proof is tests/db/065_store_read_tests.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const mig = readFileSync("supabase/migrations/065_store_machine_read.sql", "utf8");
const app = readFileSync("src/App.jsx", "utf8");
const mp  = app.slice(app.indexOf("function MachinePage("), app.indexOf("function MachinePage(") + 420000);

test("065 adds SELECT-only policies for the stores reader", () => {
  assert.match(mig, /FUNCTION public\.store_machine_reader\(\)/);
  assert.match(mig, /can_view_page\('machines'\)/);
  assert.match(mig, /role_key = 'Store Manager'/);
  assert.match(mig, /has_permission\('inward', 'submit'\)/);
  assert.match(mig, /POLICY machine_select_stores ON public\.machine_log FOR SELECT/);
  assert.match(mig, /POLICY pending_handover_items_select_stores ON public\.pending_handover_items FOR SELECT/);
  // nothing that writes
  const sql = mig.replace(/--.*$/gm, "");
  assert.doesNotMatch(sql, /FOR (INSERT|UPDATE|DELETE|ALL)/);
  assert.doesNotMatch(sql, /machine_in_scope|machine_can_act|pending_can_act/);
  assert.ok(existsSync("supabase/migrations/065_store_machine_read_rollback.sql"));
});

test("Stores overview replaces the no-department dead-end only for stores users", () => {
  assert.match(mp, /const isStoresViewer = staffMode && !isProdHead && \(currentUser\?\.role === "Store Manager" \|\| !!canDo\("inward", "submit"\)\);/);
  const i = mp.indexOf("if (!isProdHead && !hasDepartments && isStoresViewer) {");
  const j = mp.indexOf("if (!isProdHead && !hasDepartments) {");
  assert.ok(i > 0 && j > i, "stores overview comes before the generic no-department message");
  assert.ok(mp.includes("No department assigned yet — ask your admin"), "others keep the message");
  const block = mp.slice(i, j);
  assert.match(block, /data-stores-overview/);
  assert.match(block, /data-stores-parts/);
  assert.match(block, /data-stores-rack/);
  // read-only: no buttons, no handler calls
  assert.doesNotMatch(block, /<button/);
  assert.doesNotMatch(block, /onClick|onFinishTransfer|onAcceptHandover|setHoldModal|holdBtn\(/);
});
