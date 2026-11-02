// Go-live client fixes (2026-11-02) — store-level behaviour, mock-based like
// tests/stores-zero-row.test.mjs (needs --experimental-test-module-mocks; see
// package.json).
//
//  1. outwardStore.fetchOutward pages through the whole table (no 500 cap),
//     ordered by id ascending, until a short page comes back.
//  2. handoverStore.createHandover maps Postgres 23505 (the one-pending-per-
//     machine unique index from migration 053) to the existing "Handover
//     already in progress" message.
//  3. settingsStore.loadSettings reads through rpc('get_org_settings') and
//     falls back to the settings table only when the function is missing.

import { test, mock } from "node:test";
import assert from "node:assert/strict";

let CLIENT = null;

mock.module(new URL("../src/config/env.js", import.meta.url).href, {
  namedExports: {
    isSupabaseEnabled: () => true,
    IS_PROD: false,
    SUPABASE_URL: "https://stub.supabase.co",
    SUPABASE_ANON_KEY: "stub-anon-key",
    USE_SUPABASE: true,
    ALLOW_DEMO: false,
    APP_NAME: "test",
    APP_ENV: "test",
  },
});
mock.module(new URL("../src/supabase/client.js", import.meta.url).href, {
  namedExports: {
    getSupabase: () => CLIENT,
    probeSupabase: async () => ({ ok: true }),
  },
});

const outwardStore  = await import("../src/stores/outwardStore.js");
const handoverStore = await import("../src/stores/handoverStore.js");
const settingsStore = await import("../src/stores/settingsStore.js");

// localStorage stub — the stores cache into it.
globalThis.localStorage = { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } };

// A builder whose resolved value is computed from the recorded ops, so a
// paginated read can answer differently per .range().
function fakeClient({ resolve, rpc = null }) {
  const chains = [];
  function builder(table) {
    const ops = [];
    const b = {};
    for (const m of ["select", "eq", "neq", "is", "in", "order", "limit", "range", "update", "delete", "insert", "upsert"]) {
      b[m] = (...args) => { ops.push({ op: m, args }); return b; };
    }
    const settle = () => Promise.resolve(resolve({ table, ops }));
    b.single = settle; b.maybeSingle = settle;
    b.then = (ok, err) => settle().then(ok, err);
    chains.push({ table, ops });
    return b;
  }
  return { from: (t) => builder(t), rpc: async (name, args) => rpc ? rpc(name, args) : { data: null, error: { code: "42883", message: `function ${name} does not exist` } }, __chains: chains };
}

async function quiet(fn) {
  const real = { info: console.info, warn: console.warn, error: console.error };
  console.info = () => {}; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { Object.assign(console, real); }
}

test("fetchOutward pages 1000 rows at a time, by id ascending, until a short page", async () => {
  const total = 2345;
  CLIENT = fakeClient({
    resolve: ({ ops }) => {
      const range = ops.find((o) => o.op === "range");
      const [from, to] = range.args;
      const rows = [];
      for (let id = from + 1; id <= Math.min(to + 1, total); id++) rows.push({ id, issue_id: `iss-${id}`, event_date: "2026-11-02", type: "bom", ref: "M-10", items: [] });
      return { data: rows, error: null };
    },
  });
  const out = await quiet(() => outwardStore.fetchOutward());
  assert.equal(out.length, total, "every row comes back");
  assert.equal(out[0].id, `iss-${total}`, "newest (highest id) first for the UI");
  const reads = CLIENT.__chains.filter((c) => c.table === "outward_log");
  assert.equal(reads.length, 3, "2345 rows = 3 pages of 1000");
  for (const c of reads) {
    assert.ok(!c.ops.some((o) => o.op === "limit"), "no .limit() cap");
    const order = c.ops.find((o) => o.op === "order");
    assert.deepEqual(order.args, ["id", { ascending: true }]);
  }
  assert.deepEqual(reads.map((c) => c.ops.find((o) => o.op === "range").args), [[0, 999], [1000, 1999], [2000, 2999]]);
});

test("fetchOutward: an exact multiple of the page size ends with one empty page, not a loop", async () => {
  CLIENT = fakeClient({
    resolve: ({ ops }) => {
      const [from, to] = ops.find((o) => o.op === "range").args;
      const rows = [];
      for (let id = from + 1; id <= Math.min(to + 1, 1000); id++) rows.push({ id, issue_id: `iss-${id}`, event_date: "2026-11-02", type: "bom", ref: "M-10", items: [] });
      return { data: rows, error: null };
    },
  });
  const out = await quiet(() => outwardStore.fetchOutward());
  assert.equal(out.length, 1000);
  assert.equal(CLIENT.__chains.length, 2);
});

test("createHandover maps 23505 (one pending handover per machine) to the in-progress message", async () => {
  CLIENT = fakeClient({ resolve: () => ({ data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "handover_events_one_pending_per_machine"' } }) });
  const r = await quiet(() => handoverStore.createHandover({ machineId: 7, bomKey: "M-10", fromDepartment: "Assembly", toDepartment: "Mechanical", expectedDurationMinutes: 10, actualDurationMinutes: 5 }));
  assert.equal(r.success, false);
  assert.equal(r.error, "Handover already in progress for this machine.");
});

test("createHandover: other errors still pass through as error.message", async () => {
  CLIENT = fakeClient({ resolve: () => ({ data: null, error: { code: "42501", message: "permission denied for table handover_events" } }) });
  const r = await quiet(() => handoverStore.createHandover({ machineId: 7, bomKey: "M-10", fromDepartment: "Assembly", toDepartment: "Mechanical" }));
  assert.equal(r.success, false);
  assert.equal(r.error, "permission denied for table handover_events");
});

test("loadSettings reads through get_org_settings and never touches the table when it works", async () => {
  CLIENT = fakeClient({
    resolve: () => { throw new Error("table must not be read"); },
    rpc: async (name) => { assert.equal(name, "get_org_settings"); return { data: { companyName: "Shantaz", waApiKey: undefined }, error: null }; },
  });
  const v = await quiet(() => settingsStore.loadSettings());
  assert.equal(v.companyName, "Shantaz");
  assert.equal(CLIENT.__chains.length, 0);
});

test("loadSettings falls back to the settings table only when the function is missing", async () => {
  CLIENT = fakeClient({
    resolve: ({ table }) => ({ data: { value: { companyName: "From table" } }, error: null }),
    rpc: async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.get_org_settings in the schema cache" } }),
  });
  const v = await quiet(() => settingsStore.loadSettings());
  assert.equal(v.companyName, "From table");
  assert.equal(CLIENT.__chains[0].table, "settings");

  // any OTHER rpc error → local cache, no table read
  localStorage.setItem("erp_settings", JSON.stringify({ companyName: "Cached" }));
  CLIENT = fakeClient({
    resolve: () => { throw new Error("table must not be read"); },
    rpc: async () => ({ data: null, error: { code: "42501", message: "permission denied" } }),
  });
  const v2 = await quiet(() => settingsStore.loadSettings());
  assert.equal(v2.companyName, "Cached");
  assert.equal(CLIENT.__chains.length, 0);
});
