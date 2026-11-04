// Go-live module on/off switch (src/utils/modules.js + its wiring in App.jsx).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MODULE_IDS, LIVE_MODULES, ALWAYS_ON_MODULES, parseModuleList, effectiveEnabledModules,
  isModuleOn, envLockedModules, normaliseModuleSelection, SETTINGS_TAB_MODULE,
} from "../src/utils/modules.js";

const APP = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const NAV_BLOCK = APP.slice(APP.indexOf("const navItems = ["), APP.indexOf("];", APP.indexOf("const navItems = [")));
const NAV_ORDER = [...NAV_BLOCK.matchAll(/\{ id: "([a-z]+)",/g)].map((m) => m[1]);

test("default: nothing set ⇒ every module ON (Trial unchanged)", () => {
  assert.equal(effectiveEnabledModules(undefined, ""), null);
  assert.equal(effectiveEnabledModules([], undefined), null);
  for (const id of [...MODULE_IDS, "machines_settings", "something_else"]) assert.equal(isModuleOn(id, null), true, id);
});

test("module ids = every sidebar nav id + reports", () => {
  assert.ok(NAV_ORDER.length >= 16, "nav ids parsed from App.jsx");
  assert.deepEqual([...NAV_ORDER, "reports"].sort(), [...MODULE_IDS].sort());
});

test("Live list: only Machine Tracker + reports + settings/users/roles", () => {
  const eff = effectiveEnabledModules(LIVE_MODULES, "");
  for (const id of MODULE_IDS) assert.equal(isModuleOn(id, eff), LIVE_MODULES.includes(id), id);
  assert.equal(isModuleOn("machines_settings", eff), true, "Machine Tracker settings follow machines");
  assert.equal(isModuleOn("outward", eff), false);
});

test("redirect after login lands on Machine Tracker in Live", () => {
  const eff = effectiveEnabledModules(LIVE_MODULES, LIVE_MODULES.join(","));
  const allowAll = () => true;                 // super admin
  const first = NAV_ORDER.find((id) => isModuleOn(id, eff) && allowAll(id));
  assert.equal(first, "machines");
});

test("env ceiling wins over settings; always-on can't be switched off", () => {
  const eff = effectiveEnabledModules(["machines", "inventory", "dashboard"], "machines,reports");
  assert.deepEqual([...eff].sort(), ["machines", "roles", "settings", "users"]);
  const eff2 = effectiveEnabledModules(["machines"], "");
  for (const id of ALWAYS_ON_MODULES) assert.equal(isModuleOn(id, eff2), true);
  assert.deepEqual(envLockedModules("machines,reports").includes("inventory"), true);
  assert.deepEqual(envLockedModules("machines,reports").includes("settings"), false);
  assert.deepEqual(envLockedModules(""), []);
});

test("parsing ignores junk and unknown ids", () => {
  assert.deepEqual(parseModuleList(" Machines , foo,reports,,"), ["machines", "reports"]);
  assert.equal(parseModuleList("foo,bar"), null);
  assert.equal(parseModuleList(42), null);
  assert.deepEqual(normaliseModuleSelection(["reports", "machines"]), ["machines", "reports", "settings", "users", "roles"]);
});

test("App wiring: page-level gates use canOpenPage; embedded gates stay on canView", () => {
  assert.match(APP, /const canOpenPage = useCallback\(\(id\) => moduleOn\(id\) && typeof canView === "function" && canView\(id\)/);
  assert.match(APP, /\{canOpenPage\(activePage\)\s*\n\s*\? \(pages\[activePage\]/, "page router");
  assert.match(APP, /canView=\{canOpenPage\}\s*\n\s*onSearchOpen/, "sidebar");
  assert.match(APP, /navItems\.filter\(\(item\) => canOpenPage\(item\.id\)\)\.length > 1/, "phone tab bar");
  assert.match(APP, /const firstAllowed = navItems\.find\(\(item\) => canOpenPage\(item\.id\)\)/, "redirect");
  // BOM issue inside Machine Tracker must never depend on the Outward module switch.
  assert.match(APP, /bomSection=\{canView\("outward"\) && canDo\("outward", "bom"\) \? <OutwardPage \{\.\.\.outwardPageProps\} embedded \/> : null\}/);
  assert.doesNotMatch(APP, /bomSection=\{canOpenPage/);
  // Machine Tracker gets the raw role check (its 📄 Reports menu is canView("reports")).
  assert.match(APP, /<MachinePage[^\n]*canView=\{canView\}/);
  // Modules tab: super admin only, audited.
  assert.match(APP, /isSuperAdmin && onSaveModules \? \[\{ id: "modules"/);
  assert.match(APP, /type: "modules_changed"/);
  assert.match(APP, /Are you sure\?/);
});

test("Settings tabs of OFF modules hide", () => {
  assert.deepEqual(SETTINGS_TAB_MODULE, { po: "pipeline", inventory: "inventory", notifications: "whatsapp" });
  assert.match(APP, /const visibleTabs = restrictTabs \? moduleTabs\.filter/);
});

test("a stale Settings form can't flip modules", () => {
  assert.match(APP, /if \(Object\.prototype\.hasOwnProperty\.call\(before, "enabledModules"\)\) newSettings\.enabledModules = before\.enabledModules;/);
});
