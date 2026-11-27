// settingsStore.saveSettingsKeys (migration 072) — mock-based, like goLiveStores.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

let CLIENT = null;
let ENABLED = true;
const mem = {};
globalThis.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };

mock.module(new URL("../src/config/env.js", import.meta.url).href, {
  namedExports: { isSupabaseEnabled: () => ENABLED, IS_PROD: false, SUPABASE_URL: "https://stub.supabase.co", SUPABASE_ANON_KEY: "k", USE_SUPABASE: true, ALLOW_DEMO: false, APP_NAME: "test", APP_ENV: "test" },
});
mock.module(new URL("../src/supabase/client.js", import.meta.url).href, {
  namedExports: { getSupabase: () => CLIENT, probeSupabase: async () => ({ ok: true }) },
});
const { saveSettingsKeys } = await import("../src/stores/settingsStore.js");

test("local mode: caches the full settings, no RPC", async () => {
  ENABLED = false; CLIENT = { rpc: () => { throw new Error("must not call"); } };
  const r = await saveSettingsKeys({ departmentHeads: { Trial: { userId: null, name: "Sonu" } } }, [{ key: "departmentHeads", value: {} }]);
  assert.equal(r.success, true);
  assert.equal(JSON.parse(mem.erp_settings).departmentHeads.Trial.name, "Sonu");
});

test("supabase mode: one save_org_setting call per key, never a table upsert", async () => {
  ENABLED = true;
  const calls = [];
  CLIENT = { rpc: async (fn, args) => { calls.push([fn, args]); return { data: { ok: true }, error: null }; }, from: () => { throw new Error("no table write"); } };
  const r = await saveSettingsKeys({ a: 1 }, [{ key: "report.master", value: { access: {} } }, { key: "departmentHeads", value: {} }]);
  assert.equal(r.success, true);
  assert.deepEqual(calls, [["save_org_setting", { p_key: "report.master", p_value: { access: {} } }], ["save_org_setting", { p_key: "departmentHeads", p_value: {} }]]);
});

test("refusal surfaces the error; missing function gets a clear message", async () => {
  CLIENT = { rpc: async () => ({ data: null, error: { code: "42501", message: "Only Super Admin or Admin can change this setting" } }) };
  assert.deepEqual(await saveSettingsKeys({}, [{ key: "departmentHeads", value: {} }]), { success: false, error: "Only Super Admin or Admin can change this setting" });
  CLIENT = { rpc: async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }) };
  assert.match((await saveSettingsKeys({}, [{ key: "departmentHeads", value: {} }])).error, /072/);
});
