// Finish & Transfer: "Main Employee must be one of the selected workers" fix.
// Transfer logs no worker names but records the signed-in user as main
// employee; an empty worker list must reach Postgres as NULL (constraint
// handover_main_in_worked exempts NULL, not '{}'). DB side:
// tests/db/055_hold_receive_tests.sql (last checks).
import { test, mock } from "node:test";
import assert from "node:assert/strict";

let CLIENT = null;
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
mock.module(new URL("../src/config/env.js", import.meta.url).href, {
  namedExports: { isSupabaseEnabled: () => true, IS_PROD: false, SUPABASE_URL: "x", SUPABASE_ANON_KEY: "x", USE_SUPABASE: true, ALLOW_DEMO: false, APP_NAME: "t", APP_ENV: "test" },
});
mock.module(new URL("../src/supabase/client.js", import.meta.url).href, {
  namedExports: { getSupabase: () => CLIENT, probeSupabase: async () => ({ ok: true }) },
});
const { createHandover } = await import("../src/stores/handoverStore.js");

const capture = () => {
  const box = { row: null };
  CLIENT = { from: () => ({ insert: (row) => { box.row = row; return { select: () => ({ single: async () => ({ data: { id: 1, ...row }, error: null }) }) }; } }) };
  return box;
};
const base = { machineId: 1, bomKey: "M-10", serialNo: "S1", fromDepartment: "Assembly", toDepartment: "Mechanical", sentBy: "u1", expectedDurationMinutes: 10, actualDurationMinutes: 5, status: "pending" };

test("Transfer with no worker names + signed-in main employee: worked_by is NULL, main_employee_id kept", async () => {
  const box = capture();
  const r = await createHandover({ ...base, workedBy: [], workedBySnapshot: null, mainEmployeeId: "u1", mainEmployeeRef: "u1", mainEmployeeName: "Ramesh" });
  assert.equal(r.success, true);
  assert.equal(box.row.worked_by, null);
  assert.equal(box.row.main_employee_id, "u1");
  assert.equal(box.row.main_employee_name, "Ramesh");
});

test("a non-empty worker list is still stored as given (older records / other callers)", async () => {
  const box = capture();
  await createHandover({ ...base, workedBy: ["u1", "u2"], mainEmployeeId: "u1" });
  assert.deepEqual(box.row.worked_by, ["u1", "u2"]);
});

test("the database constraint message still maps to a clear error", async () => {
  CLIENT = { from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'violates check constraint "handover_main_in_worked"' } }) }) }) }) };
  const r = await createHandover({ ...base, workedBy: ["u2"], mainEmployeeId: "u1" });
  assert.equal(r.success, false);
  assert.match(r.error, /Main Employee must be one of the selected workers/);
});
