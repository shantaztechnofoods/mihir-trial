// Unit tests for pickTemplate + extended snapshotResponse + duplicateTemplateItems.
// Zero React / zero DOM — pure helpers only.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickTemplate, snapshotResponse, duplicateTemplateItems, validateChecklistAnswers,
} from "../src/utils/checklistLogic.js";

// ─── pickTemplate ──────────────────────────────────────────────────────────

test("pickTemplate: BOM+dept+stage exact match wins", () => {
  const t1 = { id: 1, department: "Assembly", bomKey: "MIX-100", stage: "before_receive", active: true, items: [], updatedAt: "2026-10-01T00:00:00Z" };
  const t2 = { id: 2, department: "Assembly", bomKey: null,      stage: null,              active: true, items: [], updatedAt: "2026-10-20T00:00:00Z" };
  const got = pickTemplate([t1, t2], "MIX-100", "Assembly", "before_receive");
  assert.equal(got?.id, 1);
});

test("pickTemplate: legacy dept-only template fills before_dispatch when no scoped row exists", () => {
  const legacy = { id: 7, department: "Mechanical", bomKey: null, stage: null, active: true, items: [], updatedAt: "2026-09-01T00:00:00Z" };
  const got = pickTemplate([legacy], "MIX-100", "Mechanical", "before_dispatch");
  assert.equal(got?.id, 7);
});

test("pickTemplate: legacy dept-only template does NOT fill before_receive (new 028 stage)", () => {
  const legacy = { id: 7, department: "Mechanical", bomKey: null, stage: null, active: true, items: [], updatedAt: "2026-09-01T00:00:00Z" };
  const got = pickTemplate([legacy], "MIX-100", "Mechanical", "before_receive");
  assert.equal(got, null);
});

test("pickTemplate: legacy dept-only template does NOT fill during_work", () => {
  const legacy = { id: 7, department: "Mechanical", bomKey: null, stage: null, active: true, items: [], updatedAt: "2026-09-01T00:00:00Z" };
  const got = pickTemplate([legacy], "MIX-100", "Mechanical", "during_work");
  assert.equal(got, null);
});

test("pickTemplate: inactive templates are skipped even when exact match", () => {
  const t = { id: 9, department: "Trial", bomKey: "A-1", stage: "before_dispatch", active: false, items: [], updatedAt: "2026-10-20T00:00:00Z" };
  assert.equal(pickTemplate([t], "A-1", "Trial", "before_dispatch"), null);
});

test("pickTemplate: multiple active rows → newest updatedAt wins", () => {
  const older = { id: 1, department: "Electrical", bomKey: "X", stage: "before_dispatch", active: true, items: [], updatedAt: "2026-01-01T00:00:00Z" };
  const newer = { id: 2, department: "Electrical", bomKey: "X", stage: "before_dispatch", active: true, items: [], updatedAt: "2026-10-20T00:00:00Z" };
  const got = pickTemplate([older, newer], "X", "Electrical", "before_dispatch");
  assert.equal(got?.id, 2);
});

test("pickTemplate: no match → null", () => {
  assert.equal(pickTemplate([], "A", "Assembly", "before_receive"), null);
  assert.equal(pickTemplate(null, "A", "Assembly", "before_receive"), null);
  assert.equal(pickTemplate([{ id: 1, department: "Trial", active: true }], "A", "Assembly", "before_dispatch"), null);
});

test("pickTemplate: different BOM's scoped row is never picked", () => {
  const other = { id: 1, department: "Assembly", bomKey: "OTHER", stage: "before_dispatch", active: true, items: [], updatedAt: "2026-10-20T00:00:00Z" };
  assert.equal(pickTemplate([other], "MIX-100", "Assembly", "before_dispatch"), null);
});

// ─── snapshotResponse ──────────────────────────────────────────────────────

test("snapshotResponse carries bomKey + stage + templateVersion + templateName", () => {
  const template = { id: 42, name: "Trial pre-dispatch", version: 3 };
  const r = snapshotResponse({
    machineId: 11, handoverId: 22,
    department: "Trial", stage: "before_dispatch", bomKey: "MIX-100",
    template, answers: [{ id: "a1", label: "test", checked: true, required: true, remark: "" }],
    submittedBy: "user-abc",
  });
  assert.equal(r.machineId, 11);
  assert.equal(r.handoverId, 22);
  assert.equal(r.department, "Trial");
  assert.equal(r.stage, "before_dispatch");
  assert.equal(r.bomKey, "MIX-100");
  assert.equal(r.templateId, 42);
  assert.equal(r.templateVersion, 3);
  assert.equal(r.templateName, "Trial pre-dispatch");
  assert.equal(r.answers.length, 1);
  assert.equal(r.submittedBy, "user-abc");
});

test("snapshotResponse: null stage / null bomKey when not supplied", () => {
  const r = snapshotResponse({ machineId: 1, department: "Assembly", template: null, answers: [] });
  assert.equal(r.stage, null);
  assert.equal(r.bomKey, null);
  assert.equal(r.templateId, null);
});

// ─── duplicateTemplateItems ────────────────────────────────────────────────

test("duplicateTemplateItems clones items with fresh ids and preserves label + required", () => {
  const src = [
    { id: "x1", label: "Check A", required: true },
    { id: "x2", label: "Check B", required: false },
  ];
  const out = duplicateTemplateItems(src);
  assert.equal(out.length, 2);
  assert.equal(out[0].label, "Check A");
  assert.equal(out[0].required, true);
  assert.equal(out[1].label, "Check B");
  assert.equal(out[1].required, false);
  assert.notEqual(out[0].id, "x1");
  assert.notEqual(out[1].id, "x2");
});

test("duplicateTemplateItems handles junk input", () => {
  assert.deepEqual(duplicateTemplateItems(null), []);
  assert.deepEqual(duplicateTemplateItems(undefined), []);
  assert.deepEqual(duplicateTemplateItems("not an array"), []);
});

// ─── validateChecklistAnswers (unchanged by 028, re-asserted for safety) ──

test("validateChecklistAnswers still requires remark on unchecked rows", () => {
  const ok = validateChecklistAnswers([{ checked: true }, { checked: false, remark: "note" }]);
  assert.equal(ok.ok, true);
  const bad = validateChecklistAnswers([{ checked: false, remark: "" }]);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.missing, [0]);
});

// 2026-10-31 — a department-wide template for the stage (bom_key null,
// stage set — what Settings → Department Checklists creates) applies to a
// BOM that has no template of its own. Live Mechanical showed none.
test("pickTemplate: department-wide stage template is used when the BOM has none", () => {
  const t = [
    { id: 4, department: "Mechanical", bomKey: null, stage: "before_dispatch", active: true, name: "Mechanical · Before Dispatch", items: [{ text: "x" }] },
    { id: 3, department: "Mechanical", bomKey: null, stage: "before_receive", active: true, name: "Mechanical · Before Receive", items: [{ text: "y" }] },
    { id: 9, department: "Mechanical", bomKey: "M-15", stage: "before_dispatch", active: true, name: "M-15 own", items: [{ text: "z" }] },
  ];
  assert.equal(pickTemplate(t, "M-10", "Mechanical", "before_dispatch")?.id, 4);
  assert.equal(pickTemplate(t, "M-10", "Mechanical", "before_receive")?.id, 3);
  assert.equal(pickTemplate(t, "M-15", "Mechanical", "before_dispatch")?.id, 9, "a BOM's own template still wins");
  assert.equal(pickTemplate(t, "M-10", "Mechanical", "during_work"), null);
});

// ─── BOM screen → Checklists (2026-11-05) ──────────────────────────────────
// Runtime is unchanged: a BOM's own row REPLACES the common row (no merge).
// These lock that rule and prove the BOM screen edits exactly that row.
import {
  bomChecklistSlot, addChecklistPoint, editChecklistPoint, removeChecklistPoint, moveChecklistPoint,
} from "../src/utils/checklistLogic.js";

const FIX = [
  { id: 9,  department: "Mechanical", bomKey: null,   stage: "before_dispatch", active: true,  items: [{ id: "c1", label: "Common A" }], updatedAt: "2026-10-01T00:00:00Z" },
  { id: 10, department: "Mechanical", bomKey: null,   stage: "before_receive",  active: true,  items: [{ id: "c2", label: "Common B" }], updatedAt: "2026-10-01T00:00:00Z" },
  { id: 20, department: "Mechanical", bomKey: "M-10", stage: "before_dispatch", active: true,  items: [{ id: "b1", label: "M-10 own 1" }, { id: "b2", label: "M-10 own 2" }], updatedAt: "2026-11-01T00:00:00Z" },
  { id: 21, department: "Mechanical", bomKey: "M-10", stage: "before_receive",  active: false, items: [{ id: "b3", label: "old off" }], updatedAt: "2026-10-05T00:00:00Z" },
  { id: 5,  department: "Electrical", bomKey: null,   stage: null,              active: false, items: [{ id: "e1", label: "switched off" }] },
];

test("runtime unchanged: Finish & Transfer shows ONLY the BOM's own list when it has one (no merge)", () => {
  const t = pickTemplate(FIX, "M-10", "Mechanical", "before_dispatch");
  assert.equal(t.id, 20);
  assert.deepEqual(t.items.map((i) => i.label), ["M-10 own 1", "M-10 own 2"]);
});
test("runtime unchanged: Accept shows the common list when the BOM's own row is switched off", () => {
  assert.equal(pickTemplate(FIX, "M-10", "Mechanical", "before_receive").id, 10);
});
test("runtime unchanged: a BOM with no own row gets the common list; switched-off common rows are never shown", () => {
  assert.equal(pickTemplate(FIX, "M-15", "Mechanical", "before_dispatch").id, 9);
  assert.equal(pickTemplate(FIX, "M-15", "Electrical", "before_dispatch"), null);
});

test("bomChecklistSlot: own row / fallback / inactiveOwn", () => {
  const a = bomChecklistSlot(FIX, "M-10", "Mechanical", "before_dispatch");
  assert.equal(a.own.id, 20); assert.equal(a.fallback, null); assert.equal(a.inactiveOwn, null);
  const b = bomChecklistSlot(FIX, "M-10", "Mechanical", "before_receive");
  assert.equal(b.own, null); assert.equal(b.fallback.id, 10); assert.equal(b.inactiveOwn.id, 21);
  const c = bomChecklistSlot(FIX, "M-15", "Electrical", "before_receive");
  assert.deepEqual(c, { own: null, fallback: null, inactiveOwn: null });
});

test("bomChecklistSlot always agrees with pickTemplate (the list the BOM screen shows = what workers see)", () => {
  for (const bom of ["M-10", "M-15", null]) for (const d of ["Mechanical", "Electrical", "Assembly"]) for (const st of ["before_receive", "before_dispatch"]) {
    const s = bomChecklistSlot(FIX, bom, d, st);
    assert.equal((s.own || s.fallback)?.id ?? null, pickTemplate(FIX, bom, d, st)?.id ?? null, `${bom}/${d}/${st}`);
  }
});

test("point helpers: add / edit / remove / move keep ids and Must do", () => {
  const base = [{ id: "a", label: "One", required: true }, { id: "b", label: "Two", required: false }];
  const added = addChecklistPoint(base, "  Three  ");
  assert.equal(added.length, 3); assert.equal(added[2].label, "Three"); assert.equal(added[2].required, false); assert.ok(added[2].id);
  assert.equal(addChecklistPoint(base, "   "), base, "blank text adds nothing");
  const edited = editChecklistPoint(base, 0, "One fixed");
  assert.deepEqual(edited[0], { id: "a", label: "One fixed", required: true });
  assert.deepEqual(editChecklistPoint(base, 0, "  "), base, "blank edit keeps the old text");
  assert.deepEqual(removeChecklistPoint(base, 0).map((i) => i.id), ["b"]);
  assert.deepEqual(moveChecklistPoint(base, 1, -1).map((i) => i.id), ["b", "a"]);
  assert.deepEqual(moveChecklistPoint(base, 0, -1).map((i) => i.id), ["a", "b"], "out of range is a no-op");
  assert.equal(base[0].label, "One", "input never mutated");
});
