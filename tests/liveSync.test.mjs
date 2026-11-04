// 2026-11-04 (fix/live-sync) — the realtime subscription map and the pure
// live-record helpers. Every table the client reads must be either live
// (subscribed, with App passing its callback) or explicitly listed as static.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { appSource } from "./helpers/source.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const rtSrc = fs.readFileSync(path.join(root, "src/realtime/useRealtimeTables.js"), "utf8");
const app = appSource();

// The hook imports supabase/env modules; read the frozen maps from source text
// instead of importing (keeps this test free of module mocks).
const objLit = (name) => {
  const m = rtSrc.match(new RegExp(`export const ${name} = Object\\.freeze\\(\\{([\\s\\S]*?)\\n\\}\\);`));
  assert.ok(m, `${name} present`);
  const out = {};
  for (const line of m[1].split("\n")) { const k = line.match(/^\s*([a-z_]+):\s*"([^"]+)"/); if (k) out[k[1]] = k[2]; }
  return out;
};
const LIVE = objLit("REALTIME_TABLE_CALLBACKS");
const STATIC = objLit("REALTIME_STATIC_TABLES");

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : /\.(js|jsx)$/.test(e.name) ? [path.join(d, e.name)] : []);
const readTables = new Set();
for (const f of walk(path.join(root, "src"))) for (const m of fs.readFileSync(f, "utf8").matchAll(/\.from\("([a-z_]+)"\)/g)) readTables.add(m[1]);

test("every table the client reads is live or explicitly static", () => {
  assert.ok(readTables.size >= 20, `found ${readTables.size} tables`);
  for (const t of readTables) assert.ok(LIVE[t] || STATIC[t], `table "${t}" is neither subscribed nor listed in REALTIME_STATIC_TABLES`);
  for (const t of Object.keys(LIVE)) assert.ok(!STATIC[t], `${t} listed twice`);
});

test("the five newly published tables are live", () => {
  for (const t of ["bom_definitions", "checklist_templates", "settings", "vendors", "follow_ups"]) assert.ok(LIVE[t], t);
});

test("users / roles / audit_log stay out of realtime", () => {
  for (const t of ["users", "roles", "audit_log"]) { assert.ok(STATIC[t], t); assert.ok(!LIVE[t], t); }
});

test("every live table is wired in the hook with the mapped callback", () => {
  for (const [t, cb] of Object.entries(LIVE)) assert.match(rtSrc, new RegExp(`wire\\("${t}",\\s+${cb}\\);`), t);
});

test("App passes a callback for every live table", () => {
  const call = app.match(/useRealtimeTables\(\{([\s\S]*?)\n\s*\}\);/);
  assert.ok(call, "useRealtimeTables call");
  for (const cb of new Set(Object.values(LIVE))) assert.match(call[1], new RegExp(`\\b${cb}:\\s+\\w+,`), cb);
});

test("new handlers are latest-wins and the catch-up covers them", () => {
  for (const k of ["boms", "templates", "settings", "vendors", "followups"]) assert.ok(app.includes(`latestRef.current.${k}(`), k);
  for (const cb of ["onBomsChange", "onChecklistTemplatesChange", "onSettingsChange", "onVendorsChange", "onFollowUpsChange"])
    assert.match(rtSrc.match(/cbRef\.current = \{[^}]*\}/)[0], new RegExp(cb));
  assert.match(rtSrc, /if \(!isSupabaseEnabled\(\)\) return;/);
});

test("local mode: storage-event sync is gated off in Supabase mode and covers every synced key", async () => {
  const { LOCAL_SYNC_KEYS } = await import("../src/realtime/liveRecord.js");
  const eff = app.slice(app.indexOf("const setters = {"), app.indexOf('window.removeEventListener("storage", onStorage)'));
  assert.match(app.slice(app.indexOf("const setters = {") - 300, app.indexOf("const setters = {")), /if \(isSupabaseEnabled\(\)\) return;/);
  for (const k of Object.keys(LOCAL_SYNC_KEYS)) assert.ok(eff.includes(`${k}:`), k);
});

test("reconcileOpenRecord", async () => {
  const { reconcileOpenRecord: r } = await import("../src/realtime/liveRecord.js");
  const m = { id: 1, stage: "Mechanical", holdActive: false, note: "a" };
  assert.equal(r(m, [m], { watch: ["stage"] }).state, "same");
  assert.equal(r(m, [], { watch: ["stage"] }).state, "same", "empty list (still loading) never closes a popup");
  assert.equal(r(m, [{ id: 2 }], { watch: ["stage"] }).state, "gone");
  assert.equal(r(m, [{ ...m, note: "b" }], { watch: ["stage"] }).state, "updated");
  assert.equal(r(m, [{ ...m, stage: "Electrical" }], { watch: ["stage"] }).state, "changed");
  assert.equal(r(m, [{ ...m, id: "1", holdActive: true }], { watch: ["holdActive"] }).state, "changed", "string / number ids match");
  assert.equal(r(null, [m]).state, "same");
});

test("mergeRemoteSettings keeps local PO companies when the remote row has none", async () => {
  const { mergeRemoteSettings: mr } = await import("../src/realtime/liveRecord.js");
  const prev = { companyName: "A", po: { companies: [{ id: 1 }] } };
  assert.deepEqual(mr(prev, { companyName: "B", po: { companies: [] } }), { companyName: "B", po: prev.po });
  assert.deepEqual(mr(prev, { companyName: "B", po: { companies: [{ id: 2 }] } }).po.companies, [{ id: 2 }]);
  assert.equal(mr(prev, null), prev);
});

test("parseLocalSync ignores unknown keys, bad JSON and wrong shapes", async () => {
  const { parseLocalSync: p } = await import("../src/realtime/liveRecord.js");
  assert.deepEqual(p("erp_machines", "[1]"), [1]);
  assert.equal(p("erp_machines", "{}"), null);
  assert.equal(p("erp_machines", "{bad"), null);
  assert.equal(p("erp_machines", null), null);
  assert.equal(p("erp_session", "{}"), null, "session is never synced");
  assert.equal(p("erp_users", "[]"), null, "users are never synced");
  assert.deepEqual(p("erp_settings", '{"a":1}'), { a: 1 });
  assert.equal(p("erp_settings", "[]"), null);
});
