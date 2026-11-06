// MT UX pack (2026-11-06): next step, hold-reason composition, near-limit rule
// (80 %, once per machine per stage, dismissal per user) and the head's view.
import test from "node:test";
import assert from "node:assert/strict";
import {
  nextStepFor, checklistLeftFor, HOLD_REASON_CHIPS, composeHoldReason, holdReasonError,
  nearLimitList, nearLimitKey, readDismissed, writeDismissed, dismissStorageKey, nearLimitText, shortLeft,
  headDepartmentsFor, sortByUrgency, myWorkSummary, summaryText, sentTodayCount,
} from "../src/modules/machine-tracker/mtUx.js";

const mem = () => { const d = {}; return { getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, d }; };

test("next step: Accept → Fill checklist (n left) → Finish → next dept; Resume when held", () => {
  assert.deepEqual(nextStepFor({ toAccept: true, canAccept: true, acceptDept: "Mechanical" }), { kind: "accept", label: "Accept into Mechanical" });
  assert.deepEqual(nextStepFor({ checklistLeft: 3, nextDept: "Electrical", canFinish: true }), { kind: "checklist", label: "Fill checklist (3 left)" });
  assert.deepEqual(nextStepFor({ checklistLeft: 0, nextDept: "Electrical", canFinish: true }), { kind: "finish", label: "Finish → Electrical" });
  assert.deepEqual(nextStepFor({ held: true, canResume: true, toAccept: true, canAccept: true }), { kind: "resume", label: "Resume" });
});

test("next step: never offers what the user may not do", () => {
  assert.equal(nextStepFor({ held: true, canResume: false, nextDept: "Trial", canFinish: true }), null, "held + no hold permission → nothing (finish stays blocked)");
  assert.equal(nextStepFor({ toAccept: true, canAccept: false }), null);
  assert.equal(nextStepFor({ nextDept: "Trial", canFinish: false }), null);
  assert.equal(nextStepFor({ nextDept: null, canFinish: true }), null, "no next department (Ready) → no Finish");
  assert.equal(nextStepFor({}), null);
});

test("checklist left: template points until a During-Work response is saved in this department since arrival", () => {
  const tpl = { items: [{ text: "a" }, { text: "b" }, { text: "c" }] };
  const m = { id: 7, currentDepartment: "Mechanical", departmentEnteredAt: "2026-11-06T04:00:00Z" };
  assert.equal(checklistLeftFor(tpl, [], m), 3);
  assert.equal(checklistLeftFor(null, [], m), 0);
  assert.equal(checklistLeftFor(tpl, [{ machineId: 7, department: "Mechanical", stage: "during_work", submittedAt: "2026-11-06T05:00:00Z" }], m), 0);
  assert.equal(checklistLeftFor(tpl, [{ machineId: 7, department: "Mechanical", stage: "during_work", submittedAt: "2026-11-05T05:00:00Z" }], m), 3, "a response from an earlier visit does not count");
  assert.equal(checklistLeftFor(tpl, [{ machineId: 7, department: "Assembly", stage: "during_work", submittedAt: "2026-11-06T05:00:00Z" }], m), 3, "another department's response does not count");
  assert.equal(checklistLeftFor(tpl, [{ machineId: 7, department: "Mechanical", stage: "before_receive", submittedAt: "2026-11-06T05:00:00Z" }], m), 3, "another checklist stage does not count");
});

test("hold reasons: chips + note are stored as text in the one reason field", () => {
  assert.deepEqual([...HOLD_REASON_CHIPS], ["Material not arrived", "Part defective", "No power", "Worker absent", "Waiting for QC", "Other"]);
  assert.equal(composeHoldReason("Material not arrived", "motor from vendor"), "Material not arrived — motor from vendor");
  assert.equal(composeHoldReason("No power", ""), "No power");
  assert.equal(composeHoldReason("Other", "  customer   asked "), "customer asked");
  assert.equal(composeHoldReason("", "typed only"), "typed only", "no chip → the typed text exactly as before");
  assert.equal(composeHoldReason("Not a chip", "x"), "x");
  assert.equal(holdReasonError("Other", ""), "Write the reason.");
  assert.ok(holdReasonError("", "  "));
  assert.equal(holdReasonError("Worker absent", ""), "");
  assert.equal(holdReasonError("", "free text"), "");
});

const row = (id, actual, target, extra = {}) => ({ m: { id, bomKey: "M-10", serialNo: `SN-${id}`, departmentEnteredAt: "2026-11-06T04:00:00Z", ...extra }, dept: "Assembly", target,
  t: { actualMinutes: actual, overrunMinutes: Math.max(0, actual - target), isOverrun: actual > target } });

test("near-limit: shows from 80 % of target, least time left first, never for held machines", () => {
  const list = nearLimitList([row(1, 79, 100), row(2, 80, 100), row(3, 95, 100), row(4, 130, 100), row(5, 90, 100, { holdActive: true }), row(6, 90, 0)], new Set());
  assert.deepEqual(list.map((r) => r.m.id), [4, 3, 2]);
  assert.equal(list[2].leftMinutes, 20);
  assert.equal(list[0].late, true);
});

test("near-limit: dismissed once per machine per stage, per user, remembered", () => {
  const st = mem();
  const r = row(2, 85, 100);
  let seen = readDismissed(st, "u1");
  assert.equal(nearLimitList([r], seen).length, 1);
  seen = writeDismissed(st, "u1", seen, [nearLimitKey(r.m, r.dept)]);
  assert.equal(nearLimitList([r], readDismissed(st, "u1")).length, 0, "after reload: stays dismissed");
  assert.equal(nearLimitList([{ ...r, t: { ...r.t, actualMinutes: 140, isOverrun: true } }], readDismissed(st, "u1")).length, 0, "no repeat nagging when it goes late");
  assert.equal(nearLimitList([r], readDismissed(st, "u2")).length, 1, "another user still sees it");
  const nextStage = { ...r, dept: "Mechanical", m: { ...r.m, departmentEnteredAt: "2026-11-07T04:00:00Z" } };
  assert.equal(nearLimitList([nextStage], readDismissed(st, "u1")).length, 1, "a new stage warns again (once)");
  assert.ok(st.d[dismissStorageKey("u1")]);
  assert.equal(readDismissed({ getItem: () => "{bad" }, "u1").size, 0, "broken storage → nothing dismissed, no crash");
});

test("near-limit text is short and calm", () => {
  const list = nearLimitList([row(103, 1200, 1500)], new Set());
  assert.equal(nearLimitText(list[0]), "M-10 (SN-103) · 5h left in Assembly");
  assert.equal(shortLeft(40), "40m left");
  assert.equal(shortLeft(70, true), "late by 1h 10m");
});

test("head departments: Settings mapping by user id, or a head role with departments; Production Head is not one", () => {
  const heads = { Assembly: { userId: "u_sonu", name: "Sonu" }, Trial: { userId: null, name: "Typed" } };
  assert.deepEqual(headDepartmentsFor({ id: "u_sonu", role: "Production" }, heads, ["Assembly"]), ["Assembly"]);
  assert.deepEqual(headDepartmentsFor({ id: "u_x", role: "Production" }, heads, ["Assembly"]), []);
  assert.deepEqual(headDepartmentsFor({ id: "u_y", role: "Electrical Head" }, {}, ["Electrical"]), ["Electrical"]);
  assert.deepEqual(headDepartmentsFor({ id: "u_ph", role: "Production Head" }, {}, ["Assembly"]), []);
  assert.deepEqual(headDepartmentsFor(null, heads), []);
});

test("my work today: urgent first, summary line, sent forward today", () => {
  const rows = [
    { key: "a", target: 100, t: { actualMinutes: 10 } },
    { key: "b", toAccept: true },
    { key: "c", late: true, target: 100, t: { actualMinutes: 150 } },
    { key: "d", target: 100, t: { actualMinutes: 90 } },
    { key: "e", held: true },
  ];
  assert.deepEqual(sortByUrgency(rows).map((r) => r.key), ["c", "b", "d", "e", "a"]);
  assert.equal(summaryText(myWorkSummary([{ late: true }, { toAccept: true }, {}])), "3 machines · 1 late · 1 to accept");
  assert.equal(summaryText(myWorkSummary([{}])), "1 machine");
  const now = new Date(2026, 10, 6, 15, 0);
  const hs = [
    { fromDepartment: "Assembly", sentAt: new Date(2026, 10, 6, 9, 0).toISOString(), status: "accepted" },
    { fromDepartment: "Assembly", sentAt: new Date(2026, 10, 6, 11, 0).toISOString(), status: "pending" },
    { fromDepartment: "Assembly", sentAt: new Date(2026, 10, 6, 12, 0).toISOString(), status: "cancelled" },
    { fromDepartment: "Assembly", sentAt: new Date(2026, 10, 5, 12, 0).toISOString(), status: "accepted" },
    { fromDepartment: "Mechanical", sentAt: new Date(2026, 10, 6, 12, 0).toISOString(), status: "accepted" },
  ];
  assert.equal(sentTodayCount(hs, ["Assembly"], now), 2);
});
