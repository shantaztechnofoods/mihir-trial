// BOM machine photo (migration 061) — bomsStore photoUrl <-> photo_url.
//
// Local mode: photoUrl is kept as-is in localStorage (erp_bomdefs).
// Supabase mode: photoUrl maps to photo_url, and a pre-061 schema (column
// missing) retries the write without photo_url, exactly like dept_durations.
// Runs under --experimental-test-module-mocks (second node --test group).

import { test, mock } from "node:test";
import assert from "node:assert/strict";

let ENABLED = false;
let CLIENT = null;

mock.module(new URL("../src/config/env.js", import.meta.url).href, {
  namedExports: {
    isSupabaseEnabled: () => ENABLED,
    IS_PROD: false, SUPABASE_URL: "https://stub.supabase.co", SUPABASE_ANON_KEY: "stub",
    USE_SUPABASE: false, ALLOW_DEMO: false, APP_NAME: "test", APP_ENV: "test",
  },
});
mock.module(new URL("../src/supabase/client.js", import.meta.url).href, {
  namedExports: { getSupabase: () => CLIENT, probeSupabase: async () => ({ ok: true }) },
});

// Minimal localStorage for node.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};

const boms = await import("../src/stores/bomsStore.js");
const quiet = async (fn) => {
  const real = { info: console.info, warn: console.warn, error: console.error };
  const warns = [];
  console.info = () => {}; console.warn = (...a) => warns.push(a.join(" ")); console.error = () => {};
  try { return { res: await fn(), warns }; } finally { Object.assign(console, real); }
};

const PHOTO = "https://x.supabase.co/storage/v1/object/public/item-media/bom-photos/abc-m10.jpg";

test("local mode: createBOM / updateBOM / fetchBOMs keep photoUrl", async () => {
  ENABLED = false; store.clear();
  await quiet(() => boms.createBOM("M-10", { label: "Kneader", items: [], photoUrl: PHOTO }));
  let all = (await quiet(() => boms.fetchBOMs())).res;
  assert.equal(all["M-10"].photoUrl, PHOTO);
  await quiet(() => boms.updateBOM("M-10", { ...all["M-10"], photoUrl: null }));
  all = (await quiet(() => boms.fetchBOMs())).res;
  assert.equal(all["M-10"].photoUrl, null);
});

test("local mode: rename keeps the photo", async () => {
  ENABLED = false; store.clear();
  await quiet(() => boms.createBOM("M-10", { label: "Kneader", items: [], photoUrl: PHOTO }));
  await quiet(() => boms.renameBOM("M-10", "M-11", "Kneader 11"));
  const all = (await quiet(() => boms.fetchBOMs())).res;
  assert.equal(all["M-11"].photoUrl, PHOTO);
});

test("row mapping: photoUrl -> photo_url and back", () => {
  assert.equal(boms.bomRowFromDef("M-10", { label: "K", items: [], photoUrl: PHOTO }).photo_url, PHOTO);
  assert.equal(boms.bomRowFromDef("M-10", { label: "K", items: [], photoUrl: "" }).photo_url, null);
  // A def without the key never sends photo_url (cannot wipe a stored photo).
  assert.equal("photo_url" in boms.bomRowFromDef("M-10", { label: "K", items: [] }), false);
  assert.equal(boms.bomDefFromRow({ key: "M-10", label: "K", items: [], photo_url: PHOTO }).photoUrl, PHOTO);
  assert.equal(boms.bomDefFromRow({ key: "M-10", label: "K", items: [] }).photoUrl, null);
});

// Fake client: first write fails with `firstError`, later writes succeed.
function fakeClient(firstError) {
  const writes = [];
  return {
    writes,
    from: () => {
      let row = null;
      const b = {
        insert: (r) => { row = r; return b; },
        update: (r) => { row = r; return b; },
        eq: () => b, select: () => b,
        then: (ok, err) => {
          writes.push(row);
          const res = writes.length === 1 && firstError ? { data: null, error: firstError } : { data: [{ key: "M-10" }], error: null };
          return Promise.resolve(res).then(ok, err);
        },
      };
      return b;
    },
  };
}

test("supabase: pre-061 schema retries update without photo_url, keeps dept_durations", async () => {
  ENABLED = true;
  CLIENT = fakeClient({ code: "PGRST204", message: "Could not find the 'photo_url' column of 'bom_definitions' in the schema cache" });
  const { res, warns } = await quiet(() => boms.updateBOM("M-10", { label: "K", items: [], photoUrl: PHOTO, deptDurations: { Assembly: { minutes: 60 } } }));
  assert.equal(res.success, true);
  assert.equal(CLIENT.writes.length, 2);
  assert.equal(CLIENT.writes[0].photo_url, PHOTO);
  assert.equal("photo_url" in CLIENT.writes[1], false);
  assert.deepEqual(CLIENT.writes[1].dept_durations, { Assembly: { minutes: 60 } });
  assert.ok(warns.some((w) => /061 photo_url/.test(w)));
});

test("supabase: create sends photo_url when the column exists", async () => {
  ENABLED = true;
  CLIENT = fakeClient(null);
  const { res } = await quiet(() => boms.createBOM("M-10", { label: "K", items: [], photoUrl: PHOTO }));
  assert.equal(res.success, true);
  assert.equal(CLIENT.writes.length, 1);
  assert.equal(CLIENT.writes[0].photo_url, PHOTO);
});
