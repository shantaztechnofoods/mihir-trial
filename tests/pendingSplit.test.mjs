// Pending Jobs split: Pending Parts / Pending Work / Completed. No migration —
// part vs work and "done" are derived from existing fields.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
mock.module(new URL("../src/config/env.js", import.meta.url).href, {
  namedExports: { isSupabaseEnabled: () => false, IS_PROD: false, SUPABASE_URL: "", SUPABASE_ANON_KEY: "", USE_SUPABASE: false, ALLOW_DEMO: true, APP_NAME: "t", APP_ENV: "test" },
});
mock.module(new URL("../src/supabase/client.js", import.meta.url).href, { namedExports: { getSupabase: () => null, probeSupabase: async () => ({ ok: false }) } });
const { pendingItemIsPart, pendingItemIsDone, pendingItemIsOpen } = await import("../src/stores/pendingItemsStore.js");
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");

test("a job naming an item is a part; anything else is work", () => {
  assert.equal(pendingItemIsPart({ itemName: "Gearbox" }), true);
  assert.equal(pendingItemIsPart({ itemCode: "GBX" }), true);
  assert.equal(pendingItemIsPart({ itemName: "  ", itemCode: "" , description: "Wire the lamp" }), false);
});

test("part: partially received stays pending; fully received (received_at) is completed", () => {
  const base = { id: 1, status: "open", itemName: "Gearbox", qty: 100 };
  assert.equal(pendingItemIsOpen({ ...base, receivedQty: 50 }), true);
  assert.equal(pendingItemIsDone({ ...base, receivedQty: 50 }), false);
  const full = { ...base, receivedQty: 100, receivedAt: "2026-11-02T10:00:00Z" };
  assert.equal(pendingItemIsOpen(full), false);
  assert.equal(pendingItemIsDone(full), true);
});

test("work: open until Work completed (resolved); receiving never completes work", () => {
  const w = { id: 2, status: "open", description: "Fit cover" };
  assert.equal(pendingItemIsOpen(w), true);
  assert.equal(pendingItemIsOpen({ ...w, receivedAt: "x" }), true);
  assert.equal(pendingItemIsDone({ ...w, status: "resolved" }), true);
  assert.equal(pendingItemIsOpen({ ...w, status: "resolved" }), false);
});

test("a resolved part is also completed (history kept)", () => {
  assert.equal(pendingItemIsDone({ status: "resolved", itemName: "X" }), true);
});

test("tab and drawer render the same board: parts, work, collapsible completed, separate counts", () => {
  assert.match(app, /data-jobs-section=\{key\}/);
  assert.match(app, /block\("parts", "Pending Parts"/);
  assert.match(app, /block\("work", "Pending Work"/);
  assert.match(app, /<details data-jobs-section=\{detailsKey\}/);
  assert.match(app, /renderJobBoard\(allJobsScoped/);
  assert.match(app, /renderJobBoard\(all, \{ detailsKey: "drawer-completed" \}\)/);
  assert.match(app, /data-jobs-head-parts/); assert.match(app, /data-jobs-head-work/); assert.match(app, /data-jobs-head-done/);
});

test("every open-job count uses the same rule; existing Part received / Work completed actions kept; nothing deleted", () => {
  assert.doesNotMatch(app, /\(pendingHandoverItems \|\| \[\]\)\s*\.filter\(\(p\) => p\.status === "open"\)/);
  assert.match(app, /const openJobsScoped = \(pendingHandoverItems \|\| \[\]\)\s*\.filter\(pendingItemIsOpen\)/);
  assert.match(app, /onClick=\{\(\) => setJobAction\(\{ item: p, action: "receive"/);
  assert.match(app, /onClick=\{\(\) => setJobAction\(\{ item: p, action: "complete"/);
  assert.match(app, /data-job-kind=\{pendingItemIsPart\(p\) \? "part" : "work"\}/);
  assert.doesNotMatch(app, /deletePendingItem|\.from\("pending_handover_items"\)\.delete/);
});
