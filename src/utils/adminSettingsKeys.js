// src/utils/adminSettingsKeys.js — which settings saves Admin may make (2026-11-27).
//
// public.settings accepts direct writes from Super Admin only. Admin edits two
// things in Settings: Report Master (settings.report.master) and Department
// heads (settings.departmentHeads). Those go through the save_org_setting() RPC
// (migration 072), one key at a time, merged on the server.
//
// adminSettingsPatch(before, next) returns the list of RPC writes when a save
// changes ONLY those two keys, or null when anything else changed (that save
// keeps the old whole-row path, which the database refuses for non-Super-Admin).
// Pure — no React, no store.

export const ADMIN_SETTINGS_KEYS = Object.freeze(["report.master", "departmentHeads"]);
export const ADMIN_SETTINGS_ROLES = Object.freeze(["super_admin", "Admin"]);

const IGNORED = new Set(["enabledModules", "__newHolidayDate", "__newHolidayName"]);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const withoutMaster = (r, defaults) => {
  const { master: _m, ...rest } = { ...(defaults || {}), ...(r && typeof r === "object" ? r : {}) };
  return rest;
};

export function adminSettingsPatch(before = {}, next = {}, reportDefaults = {}) {
  const b = before || {}, n = next || {};
  const keys = new Set([...Object.keys(b), ...Object.keys(n)]);
  const writes = [];
  for (const k of keys) {
    if (IGNORED.has(k) || same(b[k], n[k])) continue;
    if (k === "departmentHeads") {
      writes.push({ key: "departmentHeads", value: n.departmentHeads && typeof n.departmentHeads === "object" ? n.departmentHeads : {} });
    } else if (k === "report") {
      // The page fills report defaults in; that alone is not a change.
      if (!same(withoutMaster(b.report, reportDefaults), withoutMaster(n.report, reportDefaults))) return null;
      const m = n.report && n.report.master;
      if (!same(b.report && b.report.master, m)) {
        if (!m || typeof m !== "object") return null;
        writes.push({ key: "report.master", value: m });
      }
    } else {
      return null;
    }
  }
  return writes;
}
