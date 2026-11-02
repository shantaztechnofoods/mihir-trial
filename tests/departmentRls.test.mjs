import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

// Static checks only: the behavioural proof is tests/db/058_department_tests.sql.
const mig = readFileSync("supabase/migrations/058_department_rls.sql", "utf8");
const edge = readFileSync("supabase/functions/admin-create-user/index.ts", "utf8");
const page = readFileSync("src/pages/UserManagementPage.jsx", "utf8");

test("058 defines the department helpers, derived from the DB profile", () => {
  for (const fn of ["my_departments", "dept_unscoped", "eff_dept", "in_dept", "machine_in_scope", "machine_can_act", "pending_can_act"])
    assert.match(mig, new RegExp(`FUNCTION public\\.${fn}\\(`), fn);
  assert.match(mig, /FROM public\.users/);
  assert.match(mig, /SECURITY DEFINER/);
});

test("058 scopes every operational table and keeps super admin unscoped", () => {
  for (const t of ["machine_log", "handover_events", "pending_handover_items", "pending_item_receipts",
    "checklist_responses", "department_ratings", "machine_attachments", "audit_log"])
    assert.match(mig, new RegExp(`ON public\\.${t}\\b`), t);
  assert.match(mig, /super_admin/);
});

test("058 makes user management super-admin only", () => {
  assert.match(mig, /is_super_admin\(\)/);
  assert.match(mig, /ON public\.users/);
});

test("058 ships a rollback", () => {
  assert.ok(existsSync("supabase/migrations/058_department_rls_rollback.sql"));
});

test("departments can be assigned at user creation", () => {
  assert.match(edge, /departments/);
  assert.match(edge, /Unknown department/);
  assert.match(page, /departments: form\.departments/);
  assert.match(page, /persistDepartments/);
});
