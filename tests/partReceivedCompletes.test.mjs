// 2026-11-03 — owner decision: for a PART job, receiving the part IS the
// completion. Work / comment jobs keep "Work completed", now with a required
// remark. No migration and no RLS change: the client runs the two existing,
// separately-allowed writes (receive_pending_part RPC, then the resolve update).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
const handler = (() => {
  const i = app.indexOf("const handleReceivePendingItem = async");
  return app.slice(i, app.indexOf("const handleIssuePendingPart", i));
})();

test("full receipt of a part job also completes it (resolve after the receive RPC), with an audit event", () => {
  assert.match(handler, /if \(res\.fullyReceived && pendingItemIsPart\(p\) && mayComplete\) \{/);
  assert.match(handler, /const completionNote = String\(notes \|\| ""\)\.trim\(\) \|\| "Part received";/);
  assert.match(handler, /await resolvePendingItem\(id, \{ resolvedBy: currentUser\.id, resolvedInDepartment, notes: completionNote \}\)/);
  assert.match(handler, /type: "pending_item_completed_on_receipt"/);
  // completion happens only AFTER a successful receipt
  assert.ok(handler.indexOf("receivePendingPart(") < handler.indexOf("resolvePendingItem("), "receive first, then complete");
  // the same roles the resolve RLS policy allows (Finish & Transfer, or admin)
  assert.match(handler, /const mayComplete = currentUser\?\.role === "super_admin" \|\| currentUser\?\.role === "Admin" \|\| canFinishTransfer\(authCanDo\);/);
});

test("part jobs have no Work completed button anywhere; work jobs keep it", () => {
  const gates = app.match(/onResolvePendingItem && (?:p\.status === "open" && )?!pendingItemIsPart\(p\) && \(/g) || [];
  assert.equal(gates.length, 3, "Pending Jobs tab/drawer, staff dashboard, machine panel");
  assert.equal((app.match(/action: "complete"/g) || []).length, 3, "three Work completed buttons remain for work jobs");
  assert.equal((app.match(/📦 Part received/g) || []).length, 3);
});

test("Work completed requires a remark; a part job cannot be completed from the popup", () => {
  assert.match(app, /const remarkMissing = !isReceive && !String\(jobAction\.notes \|\| ""\)\.trim\(\);/);
  assert.match(app, /const partNotReceived = !isReceive && pendingItemIsPart\(p\) && !p\.receivedAt;/);
  assert.match(app, /if \(remarkMissing\) \{ flagMissing\(\); return; \}/);
  assert.match(app, /else if \(remarkMissing\) flagField\("\[data-job-remark\]"\);/);
  assert.match(app, /if \(isReceive\) flagField\(qtyProblem \? "\[data-receive-qty-box\]" : "\[data-receive-verify\]"\);/);
});

test("DB: resolve policy + update guard allow the separate resolve write for the receiving department user (no migration)", () => {
  const rls = fs.readFileSync(path.join(root, "supabase/migrations/058_department_rls.sql"), "utf8");
  assert.match(rls, /CREATE POLICY pending_handover_items_resolve ON public\.pending_handover_items FOR UPDATE\n  USING \(status = 'open' AND public\.pending_can_act\(machine_id, assigned_department\)\)\n  WITH CHECK \(status = 'resolved' AND resolved_by = auth\.uid\(\) AND has_permission\('machines','finishTransfer'\)\);/);
  const guard = fs.readFileSync(path.join(root, "supabase/migrations/043_pending_item_receive_department.sql"), "utf8");
  // open -> resolved may change only the completion columns: so it must be its own update, after the receipt
  assert.match(guard, /complete_keys text\[\] := ARRAY\['status','resolved_at','resolved_by','resolved_in_department','resolution_notes'\];/);
  const files = fs.readdirSync(path.join(root, "supabase/migrations"));
  assert.ok(!files.some((f) => /part_received_complete/i.test(f)), "no migration for this change");
});
