// Pending-part receiving (2026-11-02, migration 054) — store behaviour plus
// static checks on the app wiring. Needs --experimental-test-module-mocks
// (see package.json). The database side is tests/db/054_receipt_tests.sql.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { appSource } from "./helpers/source.mjs";

let ENABLED = false;
let CLIENT = null;
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };

mock.module(new URL("../src/config/env.js", import.meta.url).href, {
  namedExports: { isSupabaseEnabled: () => ENABLED, IS_PROD: false, SUPABASE_URL: "x", SUPABASE_ANON_KEY: "x", USE_SUPABASE: false, ALLOW_DEMO: false, APP_NAME: "t", APP_ENV: "test" },
});
mock.module(new URL("../src/supabase/client.js", import.meta.url).href, {
  namedExports: { getSupabase: () => CLIENT, probeSupabase: async () => ({ ok: true }) },
});
const store = await import("../src/stores/pendingItemsStore.js");
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const app = appSource();

const seed = (extra = {}) => {
  const job = { id: 1, machineId: 7, status: "open", qty: 100, receivedQty: 0, receipts: [], receivedAt: null, itemCode: "GBX", ...extra };
  mem.set("erp_pending_handover_items", JSON.stringify([job]));
  return job;
};

test("remaining pending = qty − received; zero once received or completed; null without a quantity", () => {
  const r = store.pendingItemRemaining;
  assert.equal(r({ status: "open", qty: 100, receivedQty: 0 }), 100);
  assert.equal(r({ status: "open", qty: 100, receivedQty: 50 }), 50);
  assert.equal(r({ status: "open", qty: 100, receivedQty: 100, receivedAt: "2026-11-02" }), 0);
  assert.equal(r({ status: "resolved", qty: 100, receivedQty: 0 }), 0);
  assert.equal(r({ status: "open", qty: null }), null);
  // a job fully received before migration 054 has received_qty 0 but a received_at
  assert.equal(r({ status: "open", qty: 5, receivedQty: 0, receivedAt: "2026-10-31" }), 0);
});

test("stage reports a partly received job separately from awaiting / received", () => {
  assert.equal(store.pendingItemStage({ status: "open", receivedQty: 0 }), "awaiting");
  assert.equal(store.pendingItemStage({ status: "open", receivedQty: 50 }), "partial");
  assert.equal(store.pendingItemStage({ status: "open", receivedAt: "x", receivedQty: 100 }), "received");
  assert.equal(store.pendingItemStage({ status: "resolved" }), "completed");
});

test("history keeps one entry per receipt, in order, none overwritten", () => {
  const h = store.pendingItemHistory({
    raisedAt: "a", raisedInDepartment: "Stores", reason: "short", description: "d", status: "open",
    receipts: [{ qtyReceived: 50, receivedAt: "b", receivedBy: "u1", remainingQty: 50 }, { qtyReceived: 30, receivedAt: "c", receivedBy: "u2", remainingQty: 20 }],
  });
  assert.deepEqual(h.map((e) => e.kind), ["reported", "received", "received"]);
  assert.deepEqual(h.slice(1).map((e) => e.label), ["Part received × 50", "Part received × 30"]);
});

test("local mode: 100 pending, 50 received → 50 pending, job open, a receipt row", async () => {
  ENABLED = false; seed();
  const r = await store.receivePendingPart(1, { qty: 50, notes: "lot 1", verification: { kind: "checkbox", verified: true }, department: "Stores", receivedBy: "u1", receivedByName: "A" });
  assert.equal(r.success, true);
  assert.equal(r.remainingQty, 50);
  assert.equal(r.fullyReceived, false);
  const job = JSON.parse(mem.get("erp_pending_handover_items"))[0];
  assert.equal(job.receivedQty, 50); assert.equal(job.receivedAt, null); assert.equal(job.qty, 100);
  assert.equal(job.receipts.length, 1);
  assert.equal(job.receipts[0].qtyReceived, 50);
  assert.equal(job.receipts[0].receivedByName, "A");
  assert.equal(job.receipts[0].remainingQty, 50);
});

test("local mode: second receipt completes the receive step and keeps the first receipt", async () => {
  ENABLED = false; seed();
  await store.receivePendingPart(1, { qty: 50, receivedBy: "u1" });
  const r2 = await store.receivePendingPart(1, { qty: 50, receivedBy: "u2" });
  assert.equal(r2.fullyReceived, true);
  const job = JSON.parse(mem.get("erp_pending_handover_items"))[0];
  assert.equal(job.receipts.length, 2);
  assert.ok(job.receivedAt);
  assert.equal(job.receipts[0].receivedBy, "u1");
  const again = await store.receivePendingPart(1, { qty: 1, receivedBy: "u1" });
  assert.equal(again.success, false, "a fully received job takes no more receipts");
});

test("local mode: refuses zero, negative, non-numeric and over-quantity receipts", async () => {
  ENABLED = false; seed();
  for (const bad of [0, -3, "abc", null, undefined]) assert.equal((await store.receivePendingPart(1, { qty: bad })).success, false);
  const over = await store.receivePendingPart(1, { qty: 101 });
  assert.equal(over.success, false);
  assert.match(over.error, /Only 100 is still pending/);
  assert.equal(JSON.parse(mem.get("erp_pending_handover_items"))[0].receipts.length, 0);
});

test("Supabase mode: one atomic RPC call carries qty, notes, verification, department", async () => {
  ENABLED = true;
  let call = null;
  CLIENT = { rpc: async (name, args) => { call = { name, args }; return { data: { receipt_id: 9, received_qty: 50, remaining_qty: 50, fully_received: false, stock_inwarded: true, stock_after: 60, received_at: "t" }, error: null }; } };
  const r = await store.receivePendingPart(1, { qty: 50, notes: "n", verification: { kind: "serial", serials: ["a"] }, department: "Stores", receivedBy: "u1" });
  assert.equal(call.name, "receive_pending_part");
  assert.deepEqual(call.args, { p_item_id: 1, p_qty: 50, p_notes: "n", p_verification: { kind: "serial", serials: ["a"] }, p_department: "Stores" });
  assert.equal(r.stockInwarded, true); assert.equal(r.remainingQty, 50); assert.equal(r.fullyReceived, false);
  CLIENT = { rpc: async () => ({ data: null, error: { message: "Only 50 is still pending — you entered 60" } }) };
  const bad = await store.receivePendingPart(1, { qty: 60 });
  assert.equal(bad.success, false); assert.match(bad.error, /Only 50/);
  ENABLED = false;
});

test("app: the receive popup asks for the received quantity and the handler uses the atomic path", () => {
  assert.match(app, /data-receive-qty value=\{qtyText\}/);
  assert.match(app, /const qtyProblem = !isReceive \? ""/);
  assert.match(app, /Only this quantity is added to stock/);
  assert.match(app, /await receivePendingPart\(id, \{ qty: recvQty,/);
  // stock: Supabase → the database function inwarded it (just re-read); local → inward the received quantity only
  assert.match(app, /handleUpdateStock\(cat, p\.itemCode, \+recvQty,/);
  assert.match(app, /else if \(stockInwarded\) \{\s*\n\s*reconcileItems\(\);/);
  // double click is refused in the handler
  assert.match(app, /if \(receivePartRef\.current\.has\(id\)\) return/);
  // the job keeps its record: audit carries receipt id and remaining quantity
  assert.match(app, /details: \{ itemId: id, receiptId: receipt\.id,[^}]*qtyReceived: recvQty,[^}]*remainingQty: res\.remainingQty/);
  // a part issued from store cannot be issued again on top of a partial receipt
  assert.match(app, /already partly received — record the rest with Part received/);
});

test("app: critical receiving needs verification; manual critical items get optional serials", () => {
  assert.match(app, /const critical = !!\(inv && inv\.isCritical\) \|\| !!p\.critical;/);
  assert.match(app, /data-receive-serials-manual/);
  assert.match(app, /Serial "\$\{used\}" has already been recorded\./);
});

test("app: Pending Jobs view shows every department's job with origin, qty progress and completion details", () => {
  assert.match(app, /const all = \(pendingHandoverItems \|\| \[\]\)\.filter\(\(p\) => String\(p\.machineId\) === String\(jobsDrawer\)\);/);
  assert.match(app, /data-job-origin/);
  assert.match(app, /<b>\{pendingItemRemaining\(p\)\} pending<\/b>/);
  assert.match(app, /Completed jobs \(\{donePartsL\.length \+ doneWorkL\.length\}\)/);
  assert.match(app, /data-card-jobs-done=\{machine\.id\}/);
  // completed jobs record who and when (existing columns, unchanged)
  assert.match(app, /resolvedBy: currentUser\?\.id, resolvedAt: new Date\(\)\.toISOString\(\)/);
});

test("app: Add Pending Item at BOM Outward — item name, Critical Yes/No, pending quantity", () => {
  assert.match(app, /mode="item" \/>/);
  assert.match(app, /Each pending item needs an item name and a quantity\./);
  assert.match(app, /const canSubmit      = checkedE\.some\(\(i\) => i\.issueQty > 0\) && !extraPendingProblem;/);
  assert.match(app, /source: "not_issued"/);
});

test("app: Finish & Transfer logs no employee names, keeps checklist reasons and Add Pending Job; Accept unchanged", () => {
  assert.doesNotMatch(app, /data-team-picker/);
  assert.match(app, /workedBy: \[\], mainEmployeeId: currentUser\?\.id \|\| null,/);
  assert.match(app, /Anything still pending from \{fromDepartment\}\?/);
  assert.match(app, /incompleteChecklistJobs\(checklistAnswers, "Before Transfer"\)/);
  assert.match(app, /acceptTeamMembers/);
  assert.match(app, /Pick at least one employee|Select at least one employee|acceptTeamMembers\.filter\(Boolean\)\.length === 0/);
});

test("migration 054 is additive, append-only and atomic", () => {
  const sql = fs.readFileSync(path.join(root, "supabase/migrations/054_pending_item_receipts.sql"), "utf8");
  assert.doesNotMatch(sql, /\b(DROP TABLE|DELETE FROM)\b|^\s*TRUNCATE\s/im);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS received_qty numeric NOT NULL DEFAULT 0/);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public\.pending_item_receipts FROM anon, authenticated;/);
  assert.match(sql, /SECURITY DEFINER SET search_path = public/);
  assert.match(sql, /FOR UPDATE;/);
  assert.match(sql, /record_stock_movement\(\s*\n?\s*v_job\.item_code, 'purchase_in', p_qty/);
});
