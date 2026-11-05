// Owner rule (2026-11-05): the stores ARCHIVE, they never DELETE. Runs the real
// store code against a fake Supabase client (same technique as
// tests/stores-zero-row.test.mjs; needs --experimental-test-module-mocks) and
// asserts the exact write each archive / restore sends.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

let CLIENT = null;
mock.module(new URL("../src/config/env.js", import.meta.url).href, {
  namedExports: { isSupabaseEnabled: () => true, IS_PROD: false, SUPABASE_URL: "https://stub.supabase.co", SUPABASE_ANON_KEY: "stub", USE_SUPABASE: true, ALLOW_DEMO: false, APP_NAME: "test", APP_ENV: "test" },
});
mock.module(new URL("../src/supabase/client.js", import.meta.url).href, {
  namedExports: { getSupabase: () => CLIENT, probeSupabase: async () => ({ ok: true }) },
});

const bomsStore       = await import("../src/stores/bomsStore.js");
const itemsStore      = await import("../src/stores/itemsStore.js");
const vendorsStore    = await import("../src/stores/vendorsStore.js");
const checklistsStore = await import("../src/stores/checklistsStore.js");

// Fake builder: records every call; writes resolve to `write`, reads to `read`.
function fakeClient({ write = { data: [{ key: "K", id: "1" }], error: null }, read = { data: null, error: null } } = {}) {
  const chains = [];
  const builder = (table) => {
    const ops = []; let isWrite = false; const b = {};
    for (const m of ["select", "eq", "neq", "not", "is", "in", "order", "limit", "range", "update", "delete", "insert", "upsert"])
      b[m] = (...args) => { if (["update", "delete", "insert", "upsert"].includes(m)) isWrite = true; ops.push({ op: m, args }); return b; };
    const settle = () => Promise.resolve(isWrite ? write : read);
    b.single = settle; b.maybeSingle = settle; b.then = (ok, err) => settle().then(ok, err);
    chains.push({ table, ops });
    return b;
  };
  return { from: builder, rpc: async () => ({ data: null, error: null }), __chains: chains };
}
const quiet = async (fn) => { const r = { i: console.info, w: console.warn, e: console.error, l: console.log }; console.info = console.warn = console.error = console.log = () => {}; try { return await fn(); } finally { Object.assign(console, { info: r.i, warn: r.w, error: r.e, log: r.l }); } };
const ops = (c) => c.__chains.flatMap((ch) => ch.ops.map((o) => ({ table: ch.table, ...o })));
const noDelete = (c) => assert.ok(!ops(c).some((o) => o.op === "delete"), "no DELETE was sent");

test("bomsStore.deleteBOM / archiveBOM: UPDATE retired_at, never DELETE", async () => {
  for (const fn of [bomsStore.deleteBOM, bomsStore.archiveBOM]) {
    CLIENT = fakeClient();
    const r = await quiet(() => fn("M-10"));
    assert.equal(r.success, true);
    noDelete(CLIENT);
    const up = ops(CLIENT).find((o) => o.op === "update");
    assert.equal(up.table, "bom_definitions");
    assert.ok(typeof up.args[0].retired_at === "string" && up.args[0].retired_at.length > 10);
    assert.ok(ops(CLIENT).some((o) => o.op === "eq" && o.args[0] === "key" && o.args[1] === "M-10"));
  }
});

test("bomsStore.restoreBOM clears retired_at + replaced_by", async () => {
  CLIENT = fakeClient();
  const r = await quiet(() => bomsStore.restoreBOM("M-10"));
  assert.equal(r.success, true);
  assert.deepEqual(ops(CLIENT).find((o) => o.op === "update").args[0], { retired_at: null, replaced_by: null });
});

test("bomsStore archive that matches zero rows is reported (RLS wall)", async () => {
  CLIENT = fakeClient({ write: { data: [], error: null } });
  const r = await quiet(() => bomsStore.archiveBOM("NOPE"));
  assert.equal(r.success, false); assert.equal(r.noRows, true);
});

test("itemsStore.deleteItem archives (is_active=false) and never DELETEs, even on an old schema", async () => {
  CLIENT = fakeClient({ write: { data: [{ id: "1" }], error: null } });
  const r = await quiet(() => itemsStore.deleteItem("Hardware", "X1"));
  assert.equal(r.success, true);
  noDelete(CLIENT);
  const up = ops(CLIENT).find((o) => o.op === "update" && o.table === "items");
  assert.equal(up.args[0].is_active, false);
  assert.ok(up.args[0].deactivated_at);
  // Pre-008 schema (no is_active column): the old code fell back to a hard
  // DELETE. Now it fails loudly instead.
  CLIENT = fakeClient({ write: { data: null, error: { code: "42703", message: "column is_active does not exist" } } });
  const r2 = await quiet(() => itemsStore.deleteItem("Hardware", "X1"));
  assert.equal(r2.success, false);
  noDelete(CLIENT);
});

test("itemsStore.restoreItem sets is_active=true", async () => {
  CLIENT = fakeClient({ write: { data: [{ id: "1", code: "X1", name: "Bolt", category: "Hardware", stock: 5 }], error: null } });
  const r = await quiet(() => itemsStore.restoreItem("Hardware", "X1"));
  assert.equal(r.success, true);
  assert.equal(r.item.code, "X1");
  const up = ops(CLIENT).find((o) => o.op === "update" && o.table === "items");
  assert.deepEqual(up.args[0], { is_active: true, deactivated_at: null, deactivated_by: null });
});

test("itemsStore.fetchArchivedItems reads is_active=false", async () => {
  CLIENT = fakeClient({ read: { data: [{ id: "1", code: "X9", name: "Old", category: "Hardware", stock: 0 }], error: null } });
  const rows = await quiet(() => itemsStore.fetchArchivedItems());
  assert.ok(ops(CLIENT).some((o) => o.op === "eq" && o.args[0] === "is_active" && o.args[1] === false));
  assert.equal(rows[0]?.item?.code, "X9");
  assert.equal(rows[0]?.category, "Hardware");
});

test("vendorsStore.deleteVendor archives; restoreVendor un-archives", async () => {
  CLIENT = fakeClient({ write: { data: { id: "v1", name: "Acme", notes: "__archived__ x" }, error: null } });
  const r = await quiet(() => vendorsStore.deleteVendor({ id: "v1", name: "Acme", notes: "x" }));
  assert.equal(r.success, true); assert.equal(r.vendor.archived, true);
  noDelete(CLIENT);
  assert.match(ops(CLIENT).find((o) => o.op === "update").args[0].notes, /^__archived__/);
  CLIENT = fakeClient({ write: { data: { id: "v1", name: "Acme", notes: "x" }, error: null } });
  const r2 = await quiet(() => vendorsStore.restoreVendor({ id: "v1", name: "Acme", notes: "x", archived: true }));
  assert.equal(r2.success, true); assert.equal(r2.vendor.archived, false);
  assert.equal(ops(CLIENT).find((o) => o.op === "update").args[0].notes, "x");
});

test("checklistsStore.deleteTemplate switches off (active=false), never DELETEs", async () => {
  CLIENT = fakeClient({ write: { data: [{ id: 5 }], error: null }, read: { data: { version: 2 }, error: null } });
  const r = await quiet(() => checklistsStore.deleteTemplate(5));
  assert.equal(r.success, true);
  noDelete(CLIENT);
  assert.equal(ops(CLIENT).find((o) => o.op === "update").args[0].active, false);
});
