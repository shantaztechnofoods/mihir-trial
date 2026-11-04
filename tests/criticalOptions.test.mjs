// BOM Outward → Add Pending Item: Critical = Yes option (Check Points / Serial Number / Both).
// The option is kept inside critical_checks jsonb as { mode, points } — no migration.
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
const base = { machineId: 7, description: "x", kind: "owed", itemName: "Gearbox", qty: 1, critical: true, source: "bom_outward" };
const cap = () => { const box = {}; CLIENT = { from: () => ({ insert: (row) => { box.row = row; return { select: () => ({ single: async () => ({ data: { id: 1, machine_id: 7, ...row }, error: null }) }) }; } }) }; return box; };

test("store: Serial Number option (no check points) still saves the option and the serial", async () => {
  const box = cap();
  const r = await createPendingItem({ ...base, partSerialNo: "GB-77", criticalChecks: { mode: "serial", points: [] } });
  assert.equal(r.success, true);
  assert.deepEqual(box.row.critical_checks, { mode: "serial", points: [] });
  assert.equal(box.row.part_serial_no, "GB-77");
  assert.deepEqual(r.item.criticalChecks, { mode: "serial", points: [] });
  assert.equal(r.item.partSerialNo, "GB-77");
});

test("store: Check Points option keeps every point and its tick; Both keeps points and serial", async () => {
  const pts = [{ text: "Nameplate", ok: true }, { text: "No damage", ok: false }];
  let box = cap();
  let r = await createPendingItem({ ...base, criticalChecks: { mode: "checks", points: pts } });
  assert.deepEqual(r.item.criticalChecks, { mode: "checks", points: pts });
  assert.equal("part_serial_no" in box.row, false);
  box = cap();
  r = await createPendingItem({ ...base, partSerialNo: "S9", criticalChecks: { mode: "both", points: pts } });
  assert.deepEqual(r.item.criticalChecks, { mode: "both", points: pts });
  assert.equal(r.item.partSerialNo, "S9");
});

test("store: Critical = No sends no critical_checks", async () => {
  const box = cap();
  await createPendingItem({ ...base, critical: false, criticalChecks: null });
  assert.equal("critical_checks" in box.row, false);
});

test("form: Critical = Yes shows the option dropdown with the three options; fields follow the choice", () => {
  assert.match(app, /const CRITICAL_MODES = \[\["checks", "Check Points"\], \["serial", "Serial Number"\], \["both", "Both"\]\]/);
  assert.match(app, /\{r\.critical && \(\s*<select value=\{critModeOf\(r\)\}[^>]*data-critical-mode/);
  assert.match(app, /\(!r\.critical \|\| critModeOf\(r\) !== "checks"\) && \(\s*<input value=\{r\.partSerialNo\}/);
  assert.match(app, /\{r\.critical && critModeOf\(r\) !== "serial" && \(\(\) => \{/);
});

test("save/issue: the option travels with the item, serial dropped under Check Points, points dropped under Serial", () => {
  assert.match(app, /partSerialNo: \(j\.critical && critModeOf\(j\) === "checks"\) \? "" :/);
  assert.match(app, /critModeOf\(j\) === "serial" \? \[\] :/);
  assert.match(app, /criticalChecks = \{ mode, points: pts \};/);
  assert.match(app, /criticalChecks: j\.criticalChecks \|\| null,/);          // BOM Issue → createPendingItem
  assert.doesNotMatch(app, /inventory[^\n]{0,60}critModeOf/);                   // no Item Master dependency
});

test("tracking: Pending Jobs shows the chosen option; Part Received still lists saved points", () => {
  assert.match(app, /data-job-mode/);
  assert.match(app, /Critical option: /);
  assert.match(app, /data-receive-saved-checks/);
});
