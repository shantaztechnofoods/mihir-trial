// Admin save for Report Master + Department heads (2026-11-27, migration 072).
// Pure helper + migration shape + App wiring. Store behaviour is in
// tests/adminSettingsStore.test.mjs (module mocks).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adminSettingsPatch, ADMIN_SETTINGS_KEYS } from "../src/utils/adminSettingsKeys.js";
import { SETTINGS_DEFAULTS } from "../src/shared/settingsDefaults.js";
import { canEditReportMaster } from "../src/modules/reports/reportMaster.js";

const D = SETTINGS_DEFAULTS.report;
const base = { companyName: "Shantaz", report: { language: "en" }, departmentHeads: { Assembly: { userId: null, name: "Ram" } } };

test("only the two keys are allowed", () => {
  assert.deepEqual([...ADMIN_SETTINGS_KEYS], ["report.master", "departmentHeads"]);
  assert.equal(canEditReportMaster("Admin"), true);
});

test("department heads change → one departmentHeads write", () => {
  const heads = { Assembly: { userId: null, name: "Shyam" } };
  assert.deepEqual(adminSettingsPatch(base, { ...base, departmentHeads: heads }, D), [{ key: "departmentHeads", value: heads }]);
});

test("Report Master change, with page-filled report defaults → one report.master write", () => {
  const master = { sections: { company: { journey: false } }, access: { company: ["Admin"] } };
  const next = { ...base, report: { ...D, ...base.report, master } };
  assert.deepEqual(adminSettingsPatch(base, next, D), [{ key: "report.master", value: master }]);
});

test("both keys at once → two writes", () => {
  const master = { sections: {}, access: {} };
  const next = { ...base, report: { ...base.report, master }, departmentHeads: {} };
  assert.deepEqual(adminSettingsPatch(base, next, D).map((w) => w.key).sort(), ["departmentHeads", "report.master"]);
});

test("no change → empty list; ignored scratch / modules keys", () => {
  assert.deepEqual(adminSettingsPatch(base, { ...base }, D), []);
  assert.deepEqual(adminSettingsPatch(base, { ...base, enabledModules: ["x"], __newHolidayDate: "2026-01-01" }, D), []);
});

test("any other change → null (keeps the whole-row save)", () => {
  assert.equal(adminSettingsPatch(base, { ...base, companyName: "Other" }, D), null);
  assert.equal(adminSettingsPatch(base, { ...base, waApiKey: "x" }, D), null);
  assert.equal(adminSettingsPatch(base, { ...base, report: { ...base.report, language: "hi", master: {} } }, D), null);
  assert.equal(adminSettingsPatch(base, { ...base, report: { ...base.report, master: "bad" } }, D), null);
});

test("migration 072: SECURITY DEFINER, Admin + super_admin only, two keys, anon revoked, no policy change", () => {
  const sql = readFileSync(new URL("../supabase/migrations/072_admin_settings_keys.sql", import.meta.url), "utf8");
  const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.match(code, /CREATE OR REPLACE FUNCTION public\.save_org_setting\(p_key text, p_value jsonb\)/);
  assert.match(code, /SECURITY DEFINER SET search_path = public/);
  assert.match(code, /status = 'active'/);
  assert.match(code, /v_role NOT IN \('super_admin', 'Admin'\)/);
  assert.match(code, /p_key NOT IN \('report\.master', 'departmentHeads'\)/);
  assert.match(code, /FOR UPDATE/);
  assert.match(code, /REVOKE ALL ON FUNCTION public\.save_org_setting\(text, jsonb\) FROM PUBLIC, anon/);
  assert.doesNotMatch(code, /CREATE POLICY|DROP POLICY|ALTER POLICY/);
  assert.match(readFileSync(new URL("../supabase/migrations/072_admin_settings_keys_rollback.sql", import.meta.url), "utf8"), /DROP FUNCTION IF EXISTS public\.save_org_setting\(text, jsonb\)/);
});

test("App routes Admin saves through saveSettingsKeys", () => {
  const app = readFileSync(new URL("../src/app/App.jsx", import.meta.url), "utf8");
  assert.match(app, /currentUser\?\.role === "Admin" \? adminSettingsPatch\(before, newSettings, SETTINGS_DEFAULTS\.report\) : null/);
  assert.match(app, /adminWrites \? await saveSettingsKeys\(newSettings, adminWrites\) : await saveSettings\(newSettings\)/);
});
