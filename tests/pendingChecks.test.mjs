// Critical check points saved with a pending item (migration 056).
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { appSource } from "./helpers/source.mjs";

let CLIENT = null;
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
mock.module(new URL("../src/config/env.js", import.meta.url).href, {
  namedExports: { isSupabaseEnabled: () => true, IS_PROD: false, SUPABASE_URL: "x", SUPABASE_ANON_KEY: "x", USE_SUPABASE: true, ALLOW_DEMO: false, APP_NAME: "t", APP_ENV: "test" },
});
mock.module(new URL("../src/supabase/client.js", import.meta.url).href, {
  namedExports: { getSupabase: () => CLIENT, probeSupabase: async () => ({ ok: true }) },
});
const { createPendingItem } = await import("../src/stores/pendingItemsStore.js");
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const app = appSource();
const checks = { points: [{ text: "Nameplate matches order", ok: true }, { text: "No visible damage", ok: false }] };
const job = { machineId: 7, description: "x", kind: "owed", itemName: "Gearbox", qty: 1, critical: true, source: "bom_outward", criticalChecks: checks };

test("store: critical_checks is written and read back", async () => {
  let sent = null;
  CLIENT = { from: () => ({ insert: (row) => { sent = row; return { select: () => ({ single: async () => ({ data: { id: 1, machine_id: 7, ...row }, error: null }) }) }; } }) };
  const r = await createPendingItem(job);
  assert.equal(r.success, true);
  assert.deepEqual(sent.critical_checks, checks);
  assert.deepEqual(r.item.criticalChecks, checks);
});

test("store: no checks → no critical_checks column sent; Critical=No behaviour untouched", async () => {
  let sent = null;
  CLIENT = { from: () => ({ insert: (row) => { sent = row; return { select: () => ({ single: async () => ({ data: { id: 2, machine_id: 7, ...row }, error: null }) }) }; } }) };
  const r = await createPendingItem({ ...job, critical: false, criticalChecks: null, partSerialNo: "GB-1" });
  assert.equal("critical_checks" in sent, false);
  assert.equal(r.item.criticalChecks, null);
  assert.equal(sent.part_serial_no, "GB-1");
});

test("store: before migration 056 the job is still saved (only the checks column is dropped)", async () => {
  const sentRows = [];
  CLIENT = { from: () => ({ insert: (row) => { sentRows.push(row); return { select: () => ({ single: async () => "critical_checks" in row ? { data: null, error: { code: "42703", message: 'column "critical_checks" does not exist' } } : { data: { id: 3, machine_id: 7, ...row }, error: null } }) }; } }) };
  const r = await createPendingItem(job);
  assert.equal(r.success, true);
  assert.equal(sentRows.length, 2);
  assert.equal(r.item.critical, true);
});

test("App: manual check points for Critical = Yes only; no Item Master lookup; serial optional; carried through issue", () => {
  assert.match(app, /\{r\.critical && critModeOf\(r\) !== "serial" && \(\(\) => \{\s*\n\s*const pts = Array\.isArray\(r\.cpList\)/);
  assert.match(app, /data-critical-check-input/);
  assert.match(app, /data-critical-check-add/);
  const form = app.slice(app.indexOf("data-pending-item-form>"), app.indexOf("{codes.length > 0 && ("));
  assert.doesNotMatch(form, /checkPoints|hit\.|codes\.find/);   // no Item Master matching in the manual form
  assert.match(app, /criticalChecks: j\.critical\s*\n\s*\? \{ mode: critModeOf\(j\), points:/);
  assert.match(app, /criticalChecks: j\.criticalChecks \|\| null,/);
  assert.match(app, /data-receive-saved-checks/);
  assert.match(app, /data-job-checks/);
});

test("migration 056 is additive and has a rollback", () => {
  const m = fs.readFileSync(path.join(root, "supabase/migrations/056_pending_item_critical_checks.sql"), "utf8").replace(/--.*$/gm, "");
  assert.match(m, /ADD COLUMN IF NOT EXISTS critical_checks jsonb/);
  assert.doesNotMatch(m, /DROP|DELETE|TRUNCATE|UPDATE/i);
  assert.ok(fs.existsSync(path.join(root, "supabase/migrations/056_pending_item_critical_checks_rollback.sql")));
});
