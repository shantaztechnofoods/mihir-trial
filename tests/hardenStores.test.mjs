// 2026-11-04 — hardening (fix/harden-1): stores read EVERY row, not the first
// 1000 that PostgREST returns by default, and a corrupt local cache cannot
// crash a load. Mock-based like tests/goLiveStores.test.mjs (needs
// --experimental-test-module-mocks; see package.json).
import { test, mock } from "node:test";
import assert from "node:assert/strict";

let CLIENT = null;
mock.module(new URL("../src/config/env.js", import.meta.url).href, {
  namedExports: {
    isSupabaseEnabled: () => true, IS_PROD: false, SUPABASE_URL: "https://stub.supabase.co",
    SUPABASE_ANON_KEY: "stub-anon-key", USE_SUPABASE: true, ALLOW_DEMO: false, APP_NAME: "test", APP_ENV: "test",
  },
});
mock.module(new URL("../src/supabase/client.js", import.meta.url).href, {
  namedExports: { getSupabase: () => CLIENT, probeSupabase: async () => ({ ok: true }) },
});

globalThis.localStorage = { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } };

const machines   = await import("../src/stores/machinesStore.js");
const handovers  = await import("../src/stores/handoverStore.js");
const pendingIt  = await import("../src/stores/pendingItemsStore.js");
const checklists = await import("../src/stores/checklistsStore.js");
const atts       = await import("../src/stores/attachmentsStore.js");
const ratings    = await import("../src/stores/ratingsStore.js");
const pending    = await import("../src/stores/pendingStore.js");
const pos        = await import("../src/stores/posStore.js");
const inward     = await import("../src/stores/inwardStore.js");
const vendors    = await import("../src/stores/vendorsStore.js");
const items      = await import("../src/stores/itemsStore.js");
const followups  = await import("../src/stores/followupsStore.js");

// Every table has `total` rows; each read answers its .range() window, or
// the first 1000 when there is no .range() (what PostgREST does).
function fakeClient(total, { failAll = false } = {}) {
  const reads = [];
  const builder = (table) => {
    const ops = []; const b = {};
    for (const m of ["select", "eq", "neq", "is", "in", "order", "limit", "range", "update", "delete", "insert", "upsert"]) b[m] = (...a) => { ops.push({ op: m, args: a }); return b; };
    const settle = () => {
      reads.push({ table, ops });
      if (failAll) return Promise.resolve({ data: null, error: { code: "42501", message: "denied" } });
      const r = ops.find((o) => o.op === "range");
      const [from, to] = r ? r.args : [0, 999];
      const rows = [];
      for (let i = from + 1; i <= Math.min(to + 1, total); i++) rows.push({ id: i, key: `k${i}`, code: `C${i}`, category: "Cat", name: `n${i}`, machine_id: 1, pending_item_id: i, items: [] });
      return Promise.resolve({ data: rows, error: null });
    };
    b.single = settle; b.maybeSingle = settle; b.then = (ok, err) => settle().then(ok, err);
    return b;
  };
  return { from: builder, rpc: async () => ({ data: null, error: { code: "42883", message: "no fn" } }), storage: { from: () => ({}) }, __reads: reads };
}
async function quiet(fn) {
  const real = { info: console.info, warn: console.warn, error: console.error };
  console.info = () => {}; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { Object.assign(console, real); }
}

const cases = [
  ["machine_log",            () => machines.fetchMachines()],
  ["handover_events",        () => handovers.fetchHandovers()],
  ["pending_handover_items", () => pendingIt.fetchPendingItems()],
  ["checklist_responses",    () => checklists.fetchResponses()],
  ["machine_attachments",    () => atts.fetchAllAttachments()],
  ["department_ratings",     () => ratings.fetchRatings()],
  ["pending_log",            () => pending.fetchPending()],
  ["purchase_orders",        () => pos.fetchPOs()],
  ["inward_log",             () => inward.fetchInward()],
  ["vendors",                () => vendors.listVendors()],
  ["follow_ups",             () => followups.fetchFollowUps()],
];
for (const [table, run] of cases) {
  test(`${table}: all 2,345 rows load (no silent 1000-row truncation)`, async () => {
    CLIENT = fakeClient(2345);
    const out = await quiet(run);
    assert.equal(out.length, 2345);
    const own = CLIENT.__reads.filter((r) => r.table === table);
    assert.equal(own.length, 3, "three ranged pages");
    // deterministic paging: a unique tiebreaker order is present
    assert.ok(own[0].ops.some((o) => o.op === "order" && o.args[0] === "id"), "orders by id as tiebreaker");
  });
}

test("pending_item_receipts are paged too and attached to their job", async () => {
  CLIENT = fakeClient(1500);
  const out = await quiet(() => pendingIt.fetchPendingItems());
  assert.equal(CLIENT.__reads.filter((r) => r.table === "pending_item_receipts").length, 2);
  assert.ok(Array.isArray(out[0].receipts));
});

test("items: all 2,345 items load, grouped by category", async () => {
  CLIENT = fakeClient(2345);
  const g = await quiet(() => items.fetchItems());
  assert.equal(Object.values(g).reduce((s, l) => s + l.length, 0), 2345);
});

test("a failed load with a corrupt local cache falls back to [] instead of crashing", async () => {
  CLIENT = fakeClient(10, { failAll: true });
  localStorage.setItem("erp_machines", "{corrupt");
  localStorage.setItem("erp_handovers", "null");
  localStorage.setItem("erp_pending_handover_items", '{"not":"a list"}');
  assert.deepEqual(await quiet(() => machines.fetchMachines()), []);
  assert.deepEqual(await quiet(() => handovers.fetchHandovers()), []);
  const p = await quiet(() => pendingIt.fetchPendingItems());
  assert.ok(Array.isArray(p));
});
