// Worker-ease pack (2026-11-06): tap vibration helper, the Machine Tracker
// "Today" line counts, and the offline popup draft (save / restore / clear).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tapHaptic as tapHapticRaw, canVibrate, readHapticPref, writeHapticPref, resetHapticClock, HAPTIC_STORAGE_KEY, HAPTIC_MS, HAPTIC_DEDUPE_MS } from "../src/utils/haptics.js";
const tapHaptic = (o) => { resetHapticClock(); return tapHapticRaw(o); };
import { todayCounts, todayParts, todayText } from "../src/modules/machine-tracker/mtUx.js";
import { draftKey, pickDraft, draftHasInput, writeDraft, readDraft, clearDraft, applyDraft, DRAFT_MAX_AGE_MS, DRAFT_RESTORED_TEXT } from "../src/modules/machine-tracker/mtDraft.js";

const mem = () => { const d = {}; return { getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, removeItem: (k) => { delete d[k]; }, d }; };
const win = ({ phone = true, reduce = false } = {}) => ({
  matchMedia: (q) => ({ matches: q.includes("prefers-reduced-motion") ? reduce : q.includes("pointer: coarse") ? phone : false }),
});
const nav = () => { const calls = []; return { calls, vibrate: (ms) => { calls.push(ms); return true; } }; };

// ── haptics ───────────────────────────────────────────────────────────────
test("haptic: phone with vibrate → one 10 ms pulse", () => {
  const n = nav();
  assert.equal(tapHaptic({ nav: n, win: win(), storage: mem() }), true);
  assert.deepEqual(n.calls, [10]);
  assert.equal(HAPTIC_MS, 10);
});
test("haptic: feature detection — no navigator.vibrate (iPhone Safari) → nothing, no throw", () => {
  assert.equal(canVibrate({ nav: {}, win: win() }), false);
  assert.equal(tapHaptic({ nav: {}, win: win(), storage: mem() }), false);
  assert.equal(tapHaptic({ nav: undefined, win: undefined, storage: undefined }), false);
});
test("haptic: never on desktop (mouse / hover), even when vibrate exists", () => {
  const n = nav();
  assert.equal(tapHaptic({ nav: n, win: win({ phone: false }), storage: mem() }), false);
  assert.deepEqual(n.calls, []);
});
test("haptic: reduced motion skips it", () => {
  const n = nav();
  assert.equal(tapHaptic({ nav: n, win: win({ reduce: true }), storage: mem() }), false);
  assert.deepEqual(n.calls, []);
});
test("haptic: Settings switch — default on, off is remembered per device", () => {
  const st = mem();
  assert.equal(readHapticPref(st), true);
  writeHapticPref(false, st);
  assert.equal(st.d[HAPTIC_STORAGE_KEY], "off");
  assert.equal(readHapticPref(st), false);
  const n = nav();
  assert.equal(tapHaptic({ nav: n, win: win(), storage: st }), false);
  writeHapticPref(true, st);
  assert.equal(tapHaptic({ nav: n, win: win(), storage: st }), true);
  // blocked storage → still default on, never throws
  const bad = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(readHapticPref(bad), true);
  assert.equal(writeHapticPref(false, bad), false);
});
test("haptic: one tap = one buzz (confirm + its success toast within the window)", () => {
  resetHapticClock();
  const n = nav(); const st = mem();
  assert.equal(tapHapticRaw({ nav: n, win: win(), storage: st, now: 1000 }), true);
  assert.equal(tapHapticRaw({ nav: n, win: win(), storage: st, now: 1000 + HAPTIC_DEDUPE_MS - 1 }), false);
  assert.equal(tapHapticRaw({ nav: n, win: win(), storage: st, now: 1000 + HAPTIC_DEDUPE_MS }), true);
  assert.deepEqual(n.calls, [10, 10]);
  const toastSrc = readFileSync(new URL("../src/shared/ui/toast.js", import.meta.url), "utf8");
  assert.match(toastSrc, /onSuccess = \(\) => tapHaptic\(\)/, "success toasts use the shared helper");
});
test("haptic: a vibrate that throws is swallowed", () => {
  assert.equal(tapHaptic({ nav: { vibrate: () => { throw new Error("x"); } }, win: win(), storage: mem() }), false);
});
test("haptic is called only after validation in Accept / Finish & Transfer / Save (source check)", () => {
  const src = readFileSync(new URL("../src/modules/machine-tracker/MachinePage.jsx", import.meta.url), "utf8");
  assert.equal((src.match(/tapHaptic\(\);/g) || []).length, 4);
  for (const fn of ["submitFinishTransfer", "submitAcceptHandover", "submitDuringWork", "submitStartChk"]) {
    const body = src.slice(src.indexOf(`const ${fn} = async`), src.indexOf(`const ${fn} = async`) + 6000);
    const hap = body.indexOf("tapHaptic();");
    assert.ok(hap > 0, `${fn} calls tapHaptic`);
    const firstAwait = body.indexOf("await ");
    assert.ok(firstAwait > hap, `${fn}: haptic fires on the tap, before the save is awaited`);
    assert.ok(body.lastIndexOf("validateChecklistAnswers", hap) > 0, `${fn}: haptic fires only after validation passed`);
  }
});

// ── today line ────────────────────────────────────────────────────────────
const NOW = new Date(2026, 10, 6, 15, 0);   // local 6 Nov 2026 15:00
const at = (h, d = 6) => new Date(2026, 10, d, h, 0).toISOString();
const HANDOVERS = [
  { id: 1, machineId: 11, fromDepartment: "Assembly", toDepartment: "Mechanical", status: "accepted", sentAt: at(9), acceptedAt: at(10) },
  { id: 2, machineId: 12, fromDepartment: "Mechanical", toDepartment: "Electrical", status: "accepted", sentAt: at(9), acceptedAt: at(11) },
  { id: 3, machineId: 13, fromDepartment: "Assembly", toDepartment: "Mechanical", status: "accepted", sentAt: at(9, 5), acceptedAt: at(12, 5) },   // yesterday
  { id: 4, machineId: 14, fromDepartment: "Mechanical", toDepartment: "Electrical", status: "pending", sentAt: at(13) },
  { id: 5, machineId: 15, fromDepartment: "Mechanical", toDepartment: "Electrical", status: "cancelled", sentAt: at(13) },   // pulled back
  { id: 6, machineId: 16, fromDepartment: "Assembly", toDepartment: "Mechanical", status: "pending", sentAt: at(8) },
];
const MACHINES = [
  { id: 11, currentDepartment: "Mechanical", stage: "Mechanical", status: "active" },
  { id: 12, currentDepartment: "Electrical", stage: "Electrical", status: "active", holdActive: true },
  { id: 13, currentDepartment: "Mechanical", stage: "Mechanical", status: "active", late: true },
  { id: 14, currentDepartment: "Mechanical", stage: "Mechanical", status: "active", pendingHandoverId: 4 },
  { id: 16, currentDepartment: "Assembly", stage: "Assembly", status: "active", pendingHandoverId: 6, late: true },
  { id: 17, currentDepartment: "Mechanical", stage: "Mechanical", status: "completed", late: true },   // done
  { id: 18, stage: "BOM Issued", status: "active", late: true, holdActive: true },                     // on rack
  { id: 19, currentDepartment: "Mechanical", stage: "Mechanical", status: "active", holdActive: true, late: true },   // hold wins over late
];
const isLate = (m) => !!m.late;

test("today: admin (everything) counts accepted / sent forward / late / on hold", () => {
  const c = todayCounts({ handovers: HANDOVERS, machines: MACHINES, depts: null, now: NOW, isLate });
  assert.deepEqual(c, { accepted: 2, sent: 4, late: 2, held: 2 });
  assert.equal(todayText(c), "Today · 2 accepted · 4 sent forward · 2 late · 2 on hold");
});
test("today: department user sees only his department(s)", () => {
  const c = todayCounts({ handovers: HANDOVERS, machines: MACHINES, depts: ["Mechanical"], now: NOW, isLate });
  // accepted into Mechanical today: #1. sent from Mechanical today (not cancelled): #2, #4.
  // late: #13, and #16 (pending hand-over addressed to Mechanical). on hold: #19.
  assert.deepEqual(c, { accepted: 1, sent: 2, late: 2, held: 1 });
  const e = todayCounts({ handovers: HANDOVERS, machines: MACHINES, depts: ["Electrical"], now: NOW, isLate });
  assert.deepEqual(e, { accepted: 1, sent: 0, late: 0, held: 1 });
  assert.deepEqual(todayCounts({ handovers: HANDOVERS, machines: MACHINES, depts: [], now: NOW, isLate }), { accepted: 0, sent: 0, late: 0, held: 0 });
});
test("today: empty input and merged omit", () => {
  assert.deepEqual(todayCounts(), { accepted: 0, sent: 0, late: 0, held: 0 });
  const c = { accepted: 3, sent: 2, late: 1, held: 1 };
  assert.equal(todayText(c), "Today · 3 accepted · 2 sent forward · 1 late · 1 on hold");
  assert.deepEqual(todayParts(c, ["late", "sent"]).map((p) => p.key), ["accepted", "held"]);
  assert.equal(todayText(c, ["late"]), "Today · 3 accepted · 2 sent forward · 1 on hold");
});

// ── offline draft ─────────────────────────────────────────────────────────
const freshAccept = { handover: { id: 7, machineId: 99 }, password: "", sigSvg: null, busy: false, error: "", acceptMain: "Ravi",
  pendingItemsToRaise: [], newPendingText: "", holdReason: "",
  checklistTemplate: { id: "t" }, checklistAnswers: [{ id: "a", label: "Bolts", checked: false, remark: "" }, { id: "b", label: "Oil", checked: false, remark: "" }],
  acceptTeamMembers: ["Ravi"] };

test("draft: save → restore → clear (accept)", () => {
  const st = mem();
  const filled = { ...freshAccept, acceptTeamMembers: ["Ravi", "Sonu"], sigSvg: "<svg/>", password: "secret", busy: true,
    checklistAnswers: [{ id: "a", label: "Bolts", checked: true, remark: "" }, { id: "b", label: "Oil", checked: false, remark: "low" }], holdReason: "Parts missing" };
  const d = pickDraft("accept", filled, 7);
  assert.equal(d.data.password, undefined, "password is never stored");
  assert.equal(d.data.busy, undefined);
  assert.ok(draftHasInput(d, freshAccept));
  assert.ok(writeDraft(st, "accept", 99, d, 1000));
  assert.ok(st.d[draftKey("accept", 99)]);
  const back = readDraft(st, "accept", 99, 7, 2000);
  const { state, restored } = applyDraft("accept", freshAccept, back);
  assert.equal(restored, true);
  assert.deepEqual(state.acceptTeamMembers, ["Ravi", "Sonu"]);
  assert.equal(state.sigSvg, "<svg/>");
  assert.equal(state.checklistAnswers[0].checked, true);
  assert.equal(state.checklistAnswers[1].remark, "low");
  assert.equal(state.password, "");
  assert.equal(state.holdReason, "Parts missing");
  clearDraft(st, "accept", 99);
  assert.equal(readDraft(st, "accept", 99, 7, 3000), null);
});
test("draft: untouched popup stores nothing; other hand-over / stale / broken drafts are ignored", () => {
  const st = mem();
  assert.equal(draftHasInput(pickDraft("accept", freshAccept, 7), freshAccept), false);
  writeDraft(st, "accept", 99, pickDraft("accept", { ...freshAccept, sigSvg: "<svg/>" }, 7), 1000);
  assert.equal(readDraft(st, "accept", 99, 8, 2000), null, "a later hand-over of the same machine");
  assert.equal(readDraft(st, "finish", 99, 7, 2000), null, "other action");
  assert.equal(readDraft(st, "accept", 99, 7, 1000 + DRAFT_MAX_AGE_MS + 1), null, "older than a day");
  st.setItem(draftKey("accept", 5), "{not json");
  assert.equal(readDraft(st, "accept", 5, 7, 2000), null);
  assert.equal(readDraft(null, "accept", 99, 7), null);
  assert.equal(writeDraft({ setItem: () => { throw new Error("full"); } }, "accept", 1, { data: {} }), false);
});
test("draft: finish — notes / ticks / owed jobs; checklist only onto the same checklist", () => {
  const fresh = { machine: { id: 3 }, narration: "", answers: [{ id: "x", label: "Clean", checked: false, remark: "" }], owedItems: [] };
  const d = pickDraft("finish", { ...fresh, narration: "Power cut", answers: [{ id: "x", label: "Clean", checked: true, remark: "" }], owedItems: [{ description: "Paint" }] }, "Mechanical|t0");
  const { state, restored } = applyDraft("finish", fresh, d);
  assert.equal(restored, true);
  assert.equal(state.narration, "Power cut");
  assert.equal(state.answers[0].checked, true);
  assert.deepEqual(state.owedItems, [{ description: "Paint" }]);
  const changed = { ...fresh, answers: [{ id: "y", label: "New item", checked: false, remark: "" }] };
  const r2 = applyDraft("finish", changed, d);
  assert.equal(r2.state.answers[0].id, "y", "checklist changed since → fresh list kept");
  assert.equal(r2.state.narration, "Power cut");
  assert.deepEqual(applyDraft("finish", fresh, null), { state: fresh, restored: false });
  assert.equal(DRAFT_RESTORED_TEXT, "Restored your unsaved entry from earlier");
});
