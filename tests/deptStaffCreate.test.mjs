import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_ROLES } from "../src/auth/authStore.js";

const page = readFileSync("src/modules/users-roles/UserManagementPage.jsx", "utf8");
const mig = readFileSync("supabase/migrations/059_service_caller_and_dept_staff.sql", "utf8");

test("Department Staff role: floor permissions only", () => {
  const r = DEFAULT_ROLES.dept_staff;
  assert.ok(r);
  assert.equal(r.label, "Department Staff");
  assert.deepEqual(r.pages, ["machines"]);
  assert.equal(r.actions.machines.accept, true);
  assert.equal(r.actions.machines.finishTransfer, true);
  assert.equal(r.actions.machines.updateStage, false);
  assert.equal(r.actions.machines.configDept, false);
  assert.equal(r.actions.outward.bom, false);
  assert.equal(r.actions.users.create, false);
  assert.equal(r.actions.inventory.add, false);
});

test("existing roles are unchanged", () => {
  assert.equal(DEFAULT_ROLES.Production.actions.outward.bom, true);
  assert.equal(DEFAULT_ROLES.Admin.actions.users.create, true);
  assert.ok(DEFAULT_ROLES["Production Head"]);
});

test("Add New User defaults to the short Department Staff form", () => {
  assert.match(page, /kind: "department"/);
  assert.match(page, /DEPARTMENT_STAFF_ROLE = "dept_staff"/);
  assert.match(page, /roleKey: staff \? DEPARTMENT_STAFF_ROLE : form\.role/);
  // role dropdown only for editing or the "Other role" tab
  assert.match(page, /\(editUser \|\| form\.kind === "other"\) && \(/);
  // exactly one department is required
  assert.match(page, /Pick a department/);
  assert.match(page, /role="radiogroup"/);
});

test("migration 059 fixes service-role detection and adds the role", () => {
  assert.match(mig, /request\.jwt\.claims/);
  assert.match(mig, /current_user = 'service_role'/);
  assert.match(mig, /'dept_staff'/);
  assert.match(mig, /ON CONFLICT \(key\) DO NOTHING/);
});
