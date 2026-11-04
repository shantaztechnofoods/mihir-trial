// 2026-11-04 — hardening for ~300 users (fix/harden-*): pure guards.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchAllRows, withRetry, isTransientError, readLocalJson, PAGE_SIZE } from "../src/utils/fetchAll.js";
import { makeCoalescer } from "../src/realtime/coalesce.js";

const quiet = async (fn) => { const w = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = w; } };
const noSleep = async () => {};

// A fake query builder: rows 1..total, answers each .range(from,to).
function fakeTable(total, { failPages = new Map(), shiftAt = null } = {}) {
  const calls = [];
  const make = () => ({
    range(from, to) {
      calls.push([from, to]);
      const page = from / PAGE_SIZE;
      const left = failPages.get(page) || 0;
      if (left > 0) { failPages.set(page, left - 1); return Promise.resolve({ data: null, error: { message: "TypeError: Failed to fetch" } }); }
      const rows = [];
      // shiftAt: simulate a row inserted at the top while paging → every row
      // after page 0 moves down one place, so the first row of page 1 repeats.
      const off = shiftAt != null && page >= shiftAt ? -1 : 0;
      for (let i = from + 1 + off; i <= Math.min(to + 1 + off, total); i++) rows.push({ id: i });
      return Promise.resolve({ data: rows, error: null });
    },
  });
  return { make, calls };
}

test("fetchAllRows reads past the silent 1000-row cap", async () => {
  const t = fakeTable(2500);
  const { data, error } = await fetchAllRows(t.make, { sleep: noSleep });
  assert.equal(error, null);
  assert.equal(data.length, 2500);
  assert.deepEqual(t.calls, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test("fetchAllRows: exact multiple of the page size stops on the empty page", async () => {
  const t = fakeTable(2000);
  const { data } = await fetchAllRows(t.make, { sleep: noSleep });
  assert.equal(data.length, 2000);
  assert.equal(t.calls.length, 3);
});

test("fetchAllRows de-duplicates a row that shifted across a page boundary", async () => {
  const t = fakeTable(1500, { shiftAt: 1 });
  const { data } = await fetchAllRows(t.make, { sleep: noSleep });
  assert.equal(new Set(data.map((r) => r.id)).size, data.length);
});

test("fetchAllRows retries a page on a transient network error, then succeeds", async () => {
  const t = fakeTable(1200, { failPages: new Map([[1, 2]]) });
  const { data, error } = await quiet(() => fetchAllRows(t.make, { sleep: noSleep }));
  assert.equal(error, null);
  assert.equal(data.length, 1200);
});

test("fetchAllRows returns the error (not partial data) when retries run out", async () => {
  const t = fakeTable(1200, { failPages: new Map([[1, 9]]) });
  const { data, error } = await quiet(() => fetchAllRows(t.make, { sleep: noSleep }));
  assert.equal(data, null);
  assert.match(error.message, /Failed to fetch/);
});

test("fetchAllRows stops at the page safety cap", async () => {
  const make = () => ({ range: (f, to) => Promise.resolve({ data: Array.from({ length: to - f + 1 }, (_, i) => ({ id: f + i })), error: null }) });
  const { data } = await quiet(() => fetchAllRows(make, { maxPages: 3, sleep: noSleep }));
  assert.equal(data.length, 3000);
});

test("isTransientError: network / 5xx / 429 / timeouts yes; RLS, missing column, bad input no", () => {
  for (const e of [{ message: "TypeError: Failed to fetch" }, { status: 503 }, { status: 429 }, { code: "57014" }, { code: "08006" }, { message: "fetch failed" }, new Error("Load failed")])
    assert.equal(isTransientError(e), true, JSON.stringify(e));
  for (const e of [null, { code: "42501", message: "new row violates row-level security policy" }, { code: "42703" }, { status: 400 }, { code: "23505" }])
    assert.equal(isTransientError(e), false, JSON.stringify(e));
});

test("withRetry backs off exponentially and never retries a permanent error", async () => {
  const waits = [];
  let n = 0;
  const r = await quiet(() => withRetry(async () => (++n < 3 ? { error: { status: 502 } } : { data: 1, error: null }), { sleep: async (ms) => waits.push(ms), random: () => 0 }));
  assert.equal(r.data, 1);
  assert.deepEqual(waits, [300, 600]);
  let m = 0;
  const p = await withRetry(async () => { m++; return { error: { code: "42501" } }; }, { sleep: noSleep });
  assert.equal(m, 1);
  assert.equal(p.error.code, "42501");
  // A thrown exception is treated like an error result, not an unhandled crash.
  const t = await quiet(() => withRetry(async () => { throw new TypeError("Failed to fetch"); }, { retries: 1, sleep: noSleep }));
  assert.match(t.error.message, /Failed to fetch/);
});

test("readLocalJson never throws and keeps the expected shape", () => {
  const m = new Map();
  const prev = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
  m.set("bad", "{not json");      assert.deepEqual(readLocalJson("bad", []), []);
  m.set("null", "null");          assert.deepEqual(readLocalJson("null", []), []);
  m.set("obj", '{"a":1}');        assert.deepEqual(readLocalJson("obj", []), []);
  m.set("arr", "[1,2]");          assert.deepEqual(readLocalJson("arr", []), [1, 2]);
  assert.deepEqual(readLocalJson("arr", {}), {});
  assert.deepEqual(readLocalJson("obj", {}), { a: 1 });
  assert.deepEqual(readLocalJson("missing", []), []);
  globalThis.localStorage = { getItem: () => { throw new Error("SecurityError"); } };
  assert.deepEqual(readLocalJson("x", []), []);
  if (prev === undefined) delete globalThis.localStorage; else globalThis.localStorage = prev;
});

test("makeCoalescer collapses a burst of 50 realtime events into one refetch", () => {
  let clock = 0; const timers = new Map(); let seq = 0;
  const setT = (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: clock + ms }); return id; };
  const clearT = (id) => timers.delete(id);
  const advance = (ms) => { clock += ms; for (const [id, t] of [...timers]) if (t.at <= clock) { timers.delete(id); t.fn(); } };
  const got = [];
  const run = makeCoalescer((p) => got.push(p), { wait: 300, maxWait: 1500, setT, clearT, now: () => clock });
  for (let i = 0; i < 50; i++) { run(i); advance(10); }
  advance(300);
  assert.deepEqual(got, [49]);
  // A continuous stream still refetches at least every maxWait.
  got.length = 0;
  for (let i = 0; i < 40; i++) { run(i); advance(100); }
  assert.ok(got.length >= 2, `expected periodic flushes, got ${got.length}`);
  // cancel() drops a pending refetch (channel teardown).
  got.length = 0; run("x"); run.cancel(); advance(2000);
  assert.deepEqual(got, []);
});
