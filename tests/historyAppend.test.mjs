// Migration 063 client side — appendMachineHistory (atomic append + compare-and-set,
// fallback to the whole-row update when the function is not deployed yet) and the
// photo-resize planner. Runs with --experimental-test-module-mocks.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { appSource } from "./helpers/source.mjs";

let CLIENT = null;
mock.module(new URL("../src/config/env.js", import.meta.url).href, {
  namedExports: { isSupabaseEnabled: () => true, IS_PROD: false, SUPABASE_URL: "https://stub.supabase.co", SUPABASE_ANON_KEY: "stub", USE_SUPABASE: true, ALLOW_DEMO: false, APP_NAME: "test", APP_ENV: "test" },
});
mock.module(new URL("../src/supabase/client.js", import.meta.url).href, {
  namedExports: { getSupabase: () => CLIENT, probeSupabase: async () => ({ ok: true }) },
});
const ms = await import("../src/stores/machinesStore.js");
const ir = await import("../src/utils/imageResize.js");

// rpc answers come from `rpcAnswers` in order; table writes resolve to `write`.
function fakeClient({ rpcAnswers = [], write = { data: [{ id: 1 }], error: null } } = {}) {
  const rpcCalls = [], updates = [];
  const builder = () => {
    const b = {};
    for (const m of ["select", "eq", "order", "limit"]) b[m] = () => b;
    b.update = (row) => { updates.push(row); return b; };
    b.then = (ok, err) => Promise.resolve(write).then(ok, err);
    return b;
  };
  return {
    from: builder,
    rpc: async (name, args) => { rpcCalls.push({ name, args }); return rpcAnswers.shift() || { data: null, error: { message: "no answer" } }; },
    rpcCalls, updates,
  };
}
const row = (over = {}) => ({ id: 7, bom_key: "M-10", stage: "Mechanical", status: "active", history: [{ note: "a" }, { note: "b" }], hold_active: false, ...over });

test("append: sends only the new entries + snake_case updates + expected stage + audit", async () => {
  ms._resetAppendRpcCache();
  CLIENT = fakeClient({ rpcAnswers: [{ data: { ok: true, stale: false, audited: true, machine: row() }, error: null }] });
  const r = await ms.appendMachineHistory(7, {
    entries: [{ note: "b" }], fullHistory: [{ note: "a" }, { note: "b" }], expectedStage: "Assembly",
    updates: { stage: "Mechanical", currentDepartment: "Mechanical", pendingHandoverId: null, holdActive: false, holdReason: "" },
    audit: { type: "machine_stage", action: "x", ref: "M-10", serialNo: "SN", details: { a: 1 } },
  });
  assert.equal(r.success, true); assert.equal(r.audited, true); assert.equal(r.rpc, true);
  assert.deepEqual(r.machine.history, [{ note: "a" }, { note: "b" }]);
  const { name, args } = CLIENT.rpcCalls[0];
  assert.equal(name, "machine_append_history");
  assert.deepEqual(args.p_entries, [{ note: "b" }], "only the new entry is sent, never the whole array");
  assert.deepEqual(args.p_updates, { stage: "Mechanical", current_department: "Mechanical", pending_handover_id: null, hold_active: false, hold_reason: "" });
  assert.equal(args.p_expected_stage, "Assembly");
  assert.deepEqual(args.p_audit, { type: "machine_stage", module: "Machine", action: "x", ref: "M-10", serial_no: "SN", details: { a: 1 } });
  assert.equal(CLIENT.updates.length, 0, "no whole-row update");
});

test("append: stale answer → success:false, stale:true, the friendly message and the DB row", async () => {
  ms._resetAppendRpcCache();
  CLIENT = fakeClient({ rpcAnswers: [{ data: { ok: false, stale: true, machine: row({ stage: "Electrical" }) }, error: null }] });
  const r = await ms.appendMachineHistory(7, { entries: [{ note: "c" }], fullHistory: [], expectedStage: "Mechanical", updates: { stage: "Trial" } });
  assert.equal(r.success, false); assert.equal(r.stale, true);
  assert.equal(r.error, "Someone else just changed this machine — refreshed");
  assert.equal(ms.STALE_MACHINE_MSG, r.error);
  assert.equal(r.machine.stage, "Electrical");
  assert.equal(CLIENT.updates.length, 0, "stale never falls back to an overwrite");
});

test("append: function missing (before 063) → old whole-row update with the full history, then cached", async () => {
  ms._resetAppendRpcCache();
  CLIENT = fakeClient({ rpcAnswers: [{ data: null, error: { code: "PGRST202", message: "Could not find the function public.machine_append_history" } }] });
  const full = [{ note: "a" }, { note: "new" }];
  const r1 = await ms.appendMachineHistory(7, { entries: [{ note: "new" }], fullHistory: full, updates: { holdActive: true, holdReason: "why" } });
  assert.equal(r1.success, true);
  assert.deepEqual(CLIENT.updates[0].history, full);
  assert.equal(CLIENT.updates[0].hold_active, true); assert.equal(CLIENT.updates[0].hold_reason, "why");
  const r2 = await ms.appendMachineHistory(7, { entries: [{ note: "n2" }], fullHistory: [{ note: "n2" }] });
  assert.equal(r2.success, true);
  assert.equal(CLIENT.rpcCalls.length, 1, "missing function is remembered — no second rpc");
  assert.equal(CLIENT.updates.length, 2);
});

test("append: a real refusal (42501) is reported, not retried as an overwrite", async () => {
  ms._resetAppendRpcCache();
  CLIENT = fakeClient({ rpcAnswers: [{ data: null, error: { code: "42501", message: "You can only change machines in your own department" } }] });
  const r = await ms.appendMachineHistory(7, { entries: [{ note: "x" }], fullHistory: [{ note: "x" }] });
  assert.equal(r.success, false); assert.match(r.error, /own department/);
  assert.equal(CLIENT.updates.length, 0);
});

test("missing-function detection", () => {
  assert.ok(ms.isMissingFunctionError({ code: "PGRST202" }));
  assert.ok(ms.isMissingFunctionError({ code: "42883" }));
  assert.ok(ms.isMissingFunctionError({ message: "function public.machine_append_history(bigint) does not exist" }));
  assert.ok(!ms.isMissingFunctionError({ code: "42501", message: "denied" }));
  assert.ok(!ms.isMissingFunctionError(null));
});

test("App wiring: hold, stage, start, materials, transfer, accept use the append path; pull-back keeps its path", () => {
  const app = appSource();
  const between = (a, b) => { const i = app.indexOf(a); const j = app.indexOf(b, i + 1); assert.ok(i > 0 && j > i, a); return app.slice(i, j); };
  const hold = between("const handleSetMachineHold = async", "const handleDeleteMachine = async");
  assert.match(hold, /machineAppendHistory\(m\.id, \{/);
  assert.ok(!/machineUpdate\(/.test(hold), "hold no longer sends the whole history");
  assert.match(hold, /appendAuditWithUser\(holdAuditEntry, dbAudited \? \{ mirror: false \} : undefined\)/);
  const stage = between("const handleUpdateMachineStage = async", "// SERIAL-BASED start production.");
  assert.ok(!/machineUpdate\(/.test(stage));
  const start = between("const handleStartProduction = (machineIds) =>", "logAudit({");
  assert.match(start, /expectedStage: "BOM Issued"/);
  assert.match(start, /STALE_MACHINE_MSG/);
  assert.match(between("const notifyMachineComplete = ", "// ── Phase A"), /machineAppendHistory\(m\.id/);
  assert.match(app, /machineAppendHistory\(machineId, \{ entries: \[sentEntry\]/);
  assert.match(app, /machineAppendHistory\(handover\.machineId, \{\s*entries: \[historyEntry\]/);
  assert.match(app, /machineUpdate\(machine\.id, \{ pendingHandoverId: null, history: \[\.\.\.\(machine\.history \|\| \[\]\), \{ stage: machine\.stage, date: dateStr, note \}\] \}\)/, "pull-back / sender-undo unchanged");
});

test("migration 063 is additive and locked down", () => {
  const sql = fs.readFileSync(new URL("../supabase/migrations/063_machine_history_append.sql", import.meta.url), "utf8");
  assert.match(sql, /SECURITY DEFINER SET search_path = public/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.machine_append_history\(bigint, jsonb, jsonb, text, jsonb\) FROM PUBLIC, anon;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.machine_append_history\(bigint, jsonb, jsonb, text, jsonb\) TO authenticated;/);
  assert.match(sql, /history\s+= COALESCE\(history, '\[\]'::jsonb\) \|\| v_entries/);
  assert.match(sql, /FOR UPDATE/);
  assert.ok(!/DROP (TABLE|POLICY|COLUMN)|ALTER TABLE|TRUNCATE|DELETE FROM/i.test(sql), "no destructive statements");
  assert.ok(fs.existsSync(new URL("../supabase/migrations/063_machine_history_append_rollback.sql", import.meta.url)));
});

// ── photo resize planner ──
test("photo: targetSize never upscales and keeps the aspect ratio", () => {
  assert.deepEqual(ir.targetSize(4000, 3000), { width: 2000, height: 1500, scale: 0.5 });
  assert.deepEqual(ir.targetSize(3000, 6000), { width: 1000, height: 2000, scale: 1 / 3 });
  assert.equal(ir.targetSize(800, 600).scale, 1);
  assert.deepEqual(ir.targetSize(800, 600), { width: 800, height: 600, scale: 1 });
});

test("photo: planResize rules", () => {
  const MB = 1024 * 1024;
  assert.deepEqual(ir.planResize({ type: "image/jpeg", size: 12 * MB, width: 4032, height: 3024 }), { action: "resize", width: 2000, height: 1500, outType: "image/jpeg" });
  assert.equal(ir.planResize({ type: "image/jpeg", size: 400 * 1024, width: 1600, height: 1200 }).action, "keep", "already small → untouched");
  assert.equal(ir.planResize({ type: "image/png", size: 300 * 1024, width: 2400, height: 1600, hasAlpha: true }).action, "keep", "small PNG screenshot kept");
  assert.equal(ir.planResize({ type: "image/png", size: 6 * MB, width: 3000, height: 2000, hasAlpha: true }).outType, "image/png", "big transparent PNG stays PNG");
  assert.equal(ir.planResize({ type: "image/png", size: 6 * MB, width: 3000, height: 2000, hasAlpha: false }).outType, "image/jpeg", "big opaque PNG → JPEG");
  const sameSize = ir.planResize({ type: "image/jpeg", size: 5 * MB, width: 1800, height: 1200 });
  assert.equal(sameSize.width, 1800, "re-encode at the same size, never larger");
  assert.equal(ir.planResize({ type: "video/mp4", size: 40 * MB, width: 0, height: 0 }).action, "keep");
  assert.equal(ir.planResize({ type: "application/pdf", size: 9 * MB, width: 10, height: 10 }).action, "keep");
  assert.equal(ir.JPEG_QUALITY, 0.85); assert.equal(ir.MAX_EDGE, 2000);
});

test("photo: rename + non-browser fallback returns the same file", async () => {
  assert.equal(ir.renameForType("IMG_0001.HEIC.jpeg", "image/jpeg"), "IMG_0001.HEIC.jpg");
  assert.equal(ir.renameForType("shot.png", "image/png"), "shot.png");
  assert.equal(ir.renameForType("", "image/jpeg"), "photo.jpg");
  const f = { name: "a.jpg", type: "image/jpeg", size: 9e6 };
  assert.equal(await ir.shrinkImageFile(f), f, "no DOM (node) → original file, never throws");
  assert.equal(await ir.shrinkImageFile(null), null);
});

test("photo: wired into attachments, BOM photo and item photos (not design files)", () => {
  const att = fs.readFileSync(new URL("../src/stores/attachmentsStore.js", import.meta.url), "utf8");
  const sto = fs.readFileSync(new URL("../src/utils/storage.js", import.meta.url), "utf8");
  assert.ok(att.indexOf("file = await shrinkImageFile(file);") > 0 && att.indexOf("file = await shrinkImageFile(file);") < att.indexOf("if (file.size > MAX_BYTES)"), "attachments shrink before the size check");
  assert.match(sto, /if \(folder !== "designs"\) file = await shrinkImageFile\(file\);/);
});
