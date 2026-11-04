// 2026-11-04 — hardening batch 2 (fix/harden-2): double-submit guard,
// latest-response-wins refetch, local error boundaries, safe local init.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeInFlight, makeLatest, BUSY_RESULT } from "../src/utils/inFlight.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
const sb = fs.readFileSync(path.join(root, "src/components/SafeBoundary.jsx"), "utf8");
const quiet = async (fn) => { const w = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = w; } };
const deferred = () => { let res, rej; const p = new Promise((a, b) => { res = a; rej = b; }); return { p, res, rej }; };

test("makeInFlight: 20 rapid taps on one record → exactly one write; others get BUSY", async () => {
  const G = makeInFlight();
  let writes = 0; const d = deferred();
  const accept = G.guard((a) => `accept:${a.handoverId}`, async () => { writes++; await d.p; return { success: true }; });
  const calls = Array.from({ length: 20 }, () => accept({ handoverId: 7 }));
  d.res();
  const out = await quiet(() => Promise.all(calls));
  assert.equal(writes, 1);
  assert.equal(out.filter((r) => r.success).length, 1);
  assert.equal(out.filter((r) => r === BUSY_RESULT).length, 19);
  assert.equal(G.size(), 0, "key released after settle");
});

test("makeInFlight: different records never block each other", async () => {
  const G = makeInFlight();
  let writes = 0;
  const hold = G.guard((a) => `hold:${a.machineId}`, async () => { writes++; return { success: true }; });
  await Promise.all([1, 2, 3, 4, 5].map((id) => hold({ machineId: id })));
  assert.equal(writes, 5);
});

test("makeInFlight: key is released after a failure/throw, so a real retry works", async () => {
  const G = makeInFlight();
  let n = 0;
  const del = G.guard((id) => `del:${id}`, async () => { n++; if (n === 1) throw new Error("network"); return { success: true }; });
  await assert.rejects(() => del(1));
  assert.deepEqual(await del(1), { success: true });
});

test("makeInFlight: a key function that throws does not block the call", async () => {
  const G = makeInFlight();
  const f = G.guard(() => { throw new Error("bad args"); }, async () => ({ success: true }));
  assert.deepEqual(await f(), { success: true });
});

test("makeLatest: an older, slower refetch never overwrites a newer one", async () => {
  const latest = makeLatest(); const applied = [];
  const old = deferred(); const fresh = deferred();
  const a = latest(old.p, (v) => applied.push(v));
  const b = latest(fresh.p, (v) => applied.push(v));
  fresh.res("new"); await b;
  old.res("old"); await a;
  assert.deepEqual(applied, ["new"]);
  // a failed refetch is swallowed (logged), never an unhandled rejection
  const c = await quiet(() => latest(Promise.reject(new Error("offline")), () => applied.push("x")));
  assert.equal(c, undefined);
});

test("App: every risky mutation prop goes through the double-submit guard", () => {
  for (const [prop, g] of [
    ["onAcceptHandover", "acceptHandover"], ["onPullBackHandover", "pullBackHandover"],
    ["onSetMachineHold", "setMachineHold"], ["onDeleteMachine", "deleteMachine"],
    ["onUpdateStage", "updateStage"], ["onResolvePendingItem", "resolvePending"],
    ["onRaisePendingItem", "raisePending"], ["onSubmitDuringWorkChecklist", "duringWorkCheck"],
    ["onUploadAttachment", "uploadAttachment"], ["onDeleteAttachment", "deleteAttachment"],
    ["onDeleteItem", "deleteItemRow"], ["onDeleteVendor", "deleteVendor"],
  ]) {
    assert.ok(app.includes(`${prop}={guarded.${g}}`), `${prop} guarded`);
  }
  assert.ok(app.includes("onRemoveRackMachine: guarded.removeRackMachine"));
  assert.ok(app.includes("onDeleteBOM: guarded.deleteBOM"));
  assert.equal((app.match(/onFulfillPending=\{guarded\.fulfillPending\}/g) || []).length, 2);
  assert.ok(!/onAcceptHandover=\{handleAcceptHandover\}/.test(app), "no unguarded accept prop left");
});

test("App: realtime refetches are latest-wins", () => {
  for (const k of ["pos", "inward", "outward", "mach", "pending", "handovers", "pendingItems", "responses", "ratings", "attachments", "items"])
    assert.ok(app.includes(`latestRef.current.${k}(`), `rt ${k}`);
});

test("App: overlays outside the page boundary and every machine card have their own SafeBoundary", () => {
  for (const n of ["global-search", "notifications", "ready-popup", "machine-card", "staff-working-card", "staff-awaiting-card"])
    assert.ok(app.includes(`name="${n}"`), n);
  assert.match(sb, /Something went wrong/);
  assert.match(sb, /Reload/);
  assert.match(sb, /console\.error/);
  assert.match(sb, /getDerivedStateFromError/);
});

test("App: local-mode state initialisers can no longer put null / wrong-shape JSON into state", () => {
  assert.ok(!/if \(s\) return JSON\.parse\(s\); \} catch \{\} return/.test(app), "no raw JSON.parse initialiser left");
  assert.ok(app.includes('readLocalJson("erp_machines", NO_LOCAL_LIST)'));
  assert.ok(app.includes('readLocalJson("erp_bomdefs", NO_LOCAL_MAP)'));
});
