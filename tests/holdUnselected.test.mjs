// 2026-11-02 — unselected BOM lines → pending jobs, manual ON HOLD, department
// receiving (migration 055). Static checks on the app wiring + the machines
// store mapping. The database side is tests/db/055_hold_receive_tests.sql.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

let CLIENT = null;
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
mock.module(new URL("../src/config/env.js", import.meta.url).href, {
  namedExports: { isSupabaseEnabled: () => true, IS_PROD: false, SUPABASE_URL: "x", SUPABASE_ANON_KEY: "x", USE_SUPABASE: true, ALLOW_DEMO: false, APP_NAME: "t", APP_ENV: "test" },
});
mock.module(new URL("../src/supabase/client.js", import.meta.url).href, {
  namedExports: { getSupabase: () => CLIENT, probeSupabase: async () => ({ ok: true }) },
});
const { fetchMachines, updateMachine } = await import("../src/stores/machinesStore.js");
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
const mig = fs.readFileSync(path.join(root, "supabase/migrations/055_machine_hold.sql"), "utf8");

test("store: hold columns map both ways and updateMachine writes them without stripping", async () => {
  let sent = null;
  CLIENT = { from: () => ({ update: (row) => { sent = row; return { eq: () => ({ select: async () => ({ data: [{ id: 1 }], error: null }) }) }; } }) };
  const r = await updateMachine(1, { holdActive: true, holdReason: "waiting for motor" });
  assert.equal(r.success, true);
  assert.equal(sent.hold_active, true);
  assert.equal(sent.hold_reason, "waiting for motor");
  assert.equal("hold_by" in sent, false, "hold_by / hold_at are stamped by the database, never sent");
  assert.equal("hold_at" in sent, false);
  CLIENT = { from: () => ({ select: () => ({ order: async () => ({ data: [{ id: 2, bom_key: "M", stage: "Assembly", status: "active", history: [], hold_active: true, hold_reason: "qc", hold_by: "u1", hold_at: "2026-11-02T00:00:00Z" }], error: null }) }) }) };
  const f = await fetchMachines();
  const m = f[0];
  assert.ok(m, "machine mapped");
  assert.deepEqual([m.holdActive, m.holdReason, m.holdBy], [true, "qc", "u1"]);
});

test("store: a hold that cannot be saved (column missing) fails instead of silently succeeding", async () => {
  CLIENT = { from: () => ({ update: () => ({ eq: () => ({ select: async () => ({ data: null, error: { message: 'column "hold_active" does not exist', code: "42703" } }) }) }) }) };
  const r = await updateMachine(1, { holdActive: true, holdReason: "x" });
  assert.equal(r.success, false);
});

test("App: every unselected BOM line (critical or not) becomes a not-issued pending job with a reason", () => {
  assert.match(app, /EVERY BOM line the operator left unselected/);
  assert.match(app, /isItemChecked\(item\.code\) \|\| handledCodes\.has\(item\.code\)/);
  assert.match(app, /remark: criticalRemark\(item\) \|\| "Not selected at BOM Outward"/);
  assert.match(app, /critical: it\.criticalInput\.unselected \? !!it\.criticalInput\.critical : true/);
  assert.match(app, /critical: it\.critical !== false && !\(it\.criticalInput && it\.criticalInput\.unselected && !it\.criticalInput\.critical\)/);
  // crate path shares the same builder
  assert.match(app, /const notIssuedCrate = notIssuedOf\(data\.issued\);/);
  // they are pending JOBS (machine card), never Pending Stock rows
  const block = app.slice(app.indexOf("EVERY BOM line the operator left unselected"), app.indexOf("Migration 027 — carry the per-machine"));
  assert.doesNotMatch(block, /pending\.push/);
});

test("App: manual ON HOLD / Release on the machine card, permission-gated, audited, blocks transfer + accept", () => {
  assert.match(app, /data-card-hold=\{machine\.id\}/);
  assert.match(app, /data-card-release-hold=\{machine\.id\}/);
  assert.match(app, /isAdminUser \|\| canFinishTransfer\(canDo\) \|\| canDo\("machines", "updateStage"\)/);
  assert.match(app, /const handleSetMachineHold = async/);
  assert.match(app, /type: hold \? "machine_hold_set" : "machine_hold_released"/);
  assert.match(app, /Write why the machine is being put on hold/);
  assert.match(app, /This machine is ON HOLD — release the hold before transferring it/);
  assert.match(app, /This machine is ON HOLD — release the hold before accepting it/);
  assert.match(app, /!machine\.pendingHandoverId && !machine\.holdActive && canFinishTransfer\(canDo\)/);
  // the automatic overdue logic is untouched and still feeds On HOLD
  assert.match(app, /isHoldOverdue\(h\.sentAt, h\.acceptTimeoutMinutes, nowTick\)/);
  assert.match(app, /if \(m\.holdActive\) return true;/);
});

test("App: Part received is department-aware, not Stores-only; Admin unrestricted", () => {
  assert.match(app, /const canReceiveJob = \(p\) =>/);
  assert.equal((app.match(/canReceiveJob\(p\)/g) || []).length, 3, "all three Part received buttons use the same gate");
  assert.match(app, /if \(isAdminUser\) return true;/);
  assert.match(app, /You can only record received parts for your own department's jobs/);
});

test("migration 055: additive, guarded, department rule, rollback present", () => {
  assert.doesNotMatch(mig.replace(/--.*$/gm, ""), /\b(DROP TABLE|TRUNCATE|DELETE FROM)\b/i);
  assert.match(mig, /ADD COLUMN IF NOT EXISTS hold_active boolean\s+NOT NULL DEFAULT false/);
  assert.match(mig, /CREATE TRIGGER machine_hold_guard BEFORE UPDATE ON public\.machine_log/);
  assert.match(mig, /CREATE TRIGGER handover_hold_guard BEFORE INSERT OR UPDATE ON public\.handover_events/);
  assert.match(mig, /v_role IN \('super_admin', 'Admin'\)/);
  assert.match(mig, /receive_pending_part/);
  assert.ok(fs.existsSync(path.join(root, "supabase/migrations/055_machine_hold_rollback.sql")));
});
