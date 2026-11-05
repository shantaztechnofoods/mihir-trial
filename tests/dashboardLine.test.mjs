// Dashboard "Production line today" (2026-11-05) — stage mapping + colour rules.
// Pure helper: src/modules/dashboard/productionLine.js. Dates avoid Tuesdays
// (the factory's weekly off, when department timers pause).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LINE_STAGES, lineStageOf, timeLevel, stageTone, humanTarget, lineLegend,
  buildProductionLine, stageStatusLines, DEFAULT_LINE_TARGET_MINUTES,
} from "../src/modules/dashboard/productionLine.js";

const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime(); // Nov 2026, local time
const iso = (ms) => new Date(ms).toISOString();
const NOW = at(6, 12); // Friday 6 Nov 2026, 12:00
const ONE_DAY = { department_workflow: { dept_durations: {
  Assembly: { minutes: 1440 }, Mechanical: { minutes: 1440 }, Electrical: { minutes: 1440 }, Trial: { minutes: 1440 } },
  accept_timeout_minutes: 120 } };
const stage = (r, key) => r.stages.find((s) => s.key === key);

test("dashboard line: six stages in the real line order", () => {
  assert.deepEqual(LINE_STAGES.map((s) => s.key), ["Rack", "Assembly", "Mechanical", "Electrical", "Trial", "Ready"]);
  assert.equal(lineStageOf("BOM Issued"), "Rack");
  assert.equal(lineStageOf("Mechanical"), "Mechanical");
  assert.equal(lineStageOf("Packing"), null);
  // Machine Tracker filters the stages open on (existing filter keys only).
  assert.deepEqual(LINE_STAGES.map((s) => s.filter), ["onRack", "active", "active", "active", "active", "completed"]);
});

test("dashboard line: time level — late over target, near over 75 %, else on time", () => {
  assert.equal(timeLevel(1441, 1440), "late");
  assert.equal(timeLevel(1440, 1440), "near");
  assert.equal(timeLevel(1081, 1440), "near");
  assert.equal(timeLevel(1080, 1440), "ok");
  assert.equal(timeLevel(0, 1440), "ok");
  assert.equal(timeLevel(1500, 0), "late", "no target → default 1 day");
  assert.equal(DEFAULT_LINE_TARGET_MINUTES, 1440);
});

test("dashboard line: stage tone — late/hold beat near beat ok; empty is idle", () => {
  assert.equal(stageTone({ key: "Mechanical", late: 1, near: 2, ok: 3 }), "late");
  assert.equal(stageTone({ key: "Mechanical", hold: 1 }), "late");
  assert.equal(stageTone({ key: "Mechanical", near: 1, ok: 3 }), "near");
  assert.equal(stageTone({ key: "Mechanical", ok: 2 }), "ok");
  assert.equal(stageTone({ key: "Mechanical" }), "idle");
  assert.equal(stageTone({ key: "Ready", count: 2 }), "ok");
});

test("dashboard line: legend uses the real shared target in words", () => {
  assert.equal(humanTarget(1440), "1 day");
  assert.equal(humanTarget(2880), "2 days");
  assert.equal(humanTarget(1080), "18 h");
  const lg = lineLegend({ Assembly: 1440, Mechanical: 1440, Electrical: 1440, Trial: 1440 });
  assert.deepEqual([lg.onTime, lg.near, lg.late, lg.target], ["under 1 day", "over 18 h", "over 1 day", "1 day"]);
  const mixed = lineLegend({ Assembly: 2880, Trial: 480 });
  assert.equal(mixed.same, false);
  assert.equal(mixed.late, "over target");
});

test("dashboard line: maps machines + hand-overs to stages, colours and attention", () => {
  const machines = [
    { id: 1, serialNo: "SN-1", bomLabel: "Roti Maker", stage: "BOM Issued", status: "active" },                                   // rack
    { id: 2, serialNo: "SN-2", stage: "Assembly", currentDepartment: "Assembly", status: "active", pendingHandoverId: "h2" },     // parked on rack
    { id: 3, serialNo: "SN-3", stage: "Mechanical", currentDepartment: "Mechanical", status: "active", departmentEnteredAt: iso(at(5, 6)) },  // 30 h → late 6h
    { id: 4, serialNo: "SN-4", stage: "Electrical", currentDepartment: "Electrical", status: "active", departmentEnteredAt: iso(at(5, 17)) }, // 19 h → near, 5h left
    { id: 5, serialNo: "SN-5", stage: "Electrical", currentDepartment: "Electrical", status: "active", departmentEnteredAt: iso(at(6, 8)) },  // 4 h → ok
    { id: 6, serialNo: "SN-6", stage: "Trial", currentDepartment: "Trial", status: "active", departmentEnteredAt: iso(at(6, 9)), holdActive: true, holdReason: "Heater awaited" },
    { id: 7, serialNo: "SN-7", stage: "Electrical", currentDepartment: "Electrical", status: "active", departmentEnteredAt: iso(at(5, 9)), pendingHandoverId: "h7" }, // sent to Trial 30 min ago
    { id: 8, serialNo: "SN-8", stage: "Mechanical", currentDepartment: "Mechanical", status: "active", pendingHandoverId: "h8" },  // sent to Electrical 5 h ago → ON HOLD
    { id: 9, serialNo: "SN-9", stage: "Ready", status: "completed", history: [{ stage: "Ready", at: iso(at(6, 10)) }] },           // ready today
    { id: 10, serialNo: "SN-10", stage: "Ready", status: "completed", history: [{ stage: "Ready", at: iso(at(4, 10)) }] },         // ready earlier
  ];
  const handovers = [
    { id: "h2", machineId: 2, status: "pending", fromDepartment: "Assembly", toDepartment: "Mechanical", releaseRequired: true, releasedAt: null, sentAt: iso(at(3, 9)), acceptTimeoutMinutes: 120 },
    { id: "h7", machineId: 7, status: "pending", fromDepartment: "Electrical", toDepartment: "Trial", sentAt: iso(at(6, 11, 30)), acceptTimeoutMinutes: 120 },
    { id: "h8", machineId: 8, status: "pending", fromDepartment: "Mechanical", toDepartment: "Electrical", sentAt: iso(at(6, 7)), acceptTimeoutMinutes: 120 },
    { id: "old", machineId: 3, status: "accepted", toDepartment: "Mechanical", sentAt: iso(at(5, 5)) },
  ];
  const r = buildProductionLine({ machines, handovers, settings: ONE_DAY, now: NOW });

  assert.deepEqual(r.stages.map((s) => [s.key, s.count]),
    [["Rack", 2], ["Assembly", 0], ["Mechanical", 1], ["Electrical", 3], ["Trial", 2], ["Ready", 1]]);
  assert.equal(r.readyToday, 1);
  assert.equal(r.readyTotal, 2);

  assert.equal(stage(r, "Mechanical").tone, "late");
  assert.equal(stage(r, "Mechanical").worstLateMinutes, 360);
  assert.equal(stage(r, "Electrical").tone, "late", "SN-8 not accepted in time = ON HOLD → red");
  assert.equal(stage(r, "Electrical").near, 1);
  assert.equal(stage(r, "Electrical").incoming, 1);
  assert.equal(stage(r, "Trial").tone, "late", "manual hold");
  assert.equal(stage(r, "Trial").incoming, 1);
  assert.equal(stage(r, "Assembly").tone, "idle");
  assert.equal(stage(r, "Rack").tone, "idle");
  assert.equal(stage(r, "Ready").tone, "ok");

  // Words on every coloured state — never colour alone.
  assert.deepEqual(stageStatusLines(stage(r, "Mechanical")).map((l) => l.text), ["Late 6h"]);
  assert.deepEqual(stageStatusLines(stage(r, "Trial")).map((l) => l.text), ["On hold – Heater awaited", "1 waiting to accept"]);
  assert.deepEqual(stageStatusLines(stage(r, "Electrical")).map((l) => l.text), ["On hold – Not accepted in time", "Near limit · 5h left", "1 waiting to accept"]);
  assert.deepEqual(stageStatusLines(stage(r, "Assembly")).map((l) => l.text), ["Empty"]);
  assert.deepEqual(stageStatusLines(stage(r, "Ready")).map((l) => l.text), ["1 ready today"]);
  for (const s of r.stages) for (const l of stageStatusLines(s)) {
    if (l.tone !== "idle") assert.ok(l.icon && l.text, `${s.key}: coloured line needs icon + words`);
  }

  // Needs attention: holds first (longest overdue first), then late; only late / on-hold machines.
  assert.deepEqual(r.attention.map((a) => [a.serial, a.kind]), [["SN-8", "hold"], ["SN-6", "hold"], ["SN-3", "late"]]);
  const late = r.attention.find((a) => a.serial === "SN-3");
  assert.equal(late.department, "Mechanical");
  assert.equal(late.minutesInDept, 1800);
  assert.equal(late.overMinutes, 360);
  const held = r.attention.find((a) => a.serial === "SN-8");
  assert.equal(held.waitingAccept, true);
  assert.equal(held.minutesInDept, 300);
  assert.equal(held.reason, "Not accepted in time");
});

test("dashboard line: machine's own target snapshot wins; Tuesday does not count", () => {
  // Entered Monday 12:00; now Wednesday 12:00 → 24 working hours (Tuesday closed).
  const mon = new Date(2026, 10, 9, 12).getTime(), wed = new Date(2026, 10, 11, 12).getTime();
  const m = { id: 1, stage: "Assembly", currentDepartment: "Assembly", status: "active", departmentEnteredAt: iso(mon) };
  assert.equal(stage(buildProductionLine({ machines: [m], settings: ONE_DAY, now: wed }), "Assembly").tone, "near");
  const own = { ...m, deptDurations: { Assembly: { minutes: 600 } } };
  assert.equal(stage(buildProductionLine({ machines: [own], settings: ONE_DAY, now: wed }), "Assembly").tone, "late");
});

test("dashboard line: empty / missing data never throws", () => {
  const r = buildProductionLine({});
  assert.equal(r.stages.length, 6);
  assert.ok(r.stages.every((s) => s.count === 0 && s.tone === "idle"));
  assert.deepEqual(r.attention, []);
  assert.equal(buildProductionLine({ machines: [null, { id: 1, stage: "Nowhere", status: "active" }] }).inProduction, 1);
});

// Department heads (2026-11-05) — display label from settings.departmentHeads.
import { readDepartmentHeads, headNameFor, setDepartmentHead, HEAD_DEPARTMENTS } from "../src/utils/departmentHeads.js";

test("dashboard line: department heads show on their stage, hidden when not set", () => {
  const settings = { ...ONE_DAY, departmentHeads: {
    Assembly: { userId: "u_sonu", name: "Sonu bhai" },
    Trial: { userId: null, name: "  Ramesh   ji " },          // typed name (no login), tidied
    Electrical: { userId: "u_x", name: "   " },             // blank → not set
    Packing: { userId: null, name: "Nobody" },              // unknown department → ignored
  } };
  const r = buildProductionLine({ machines: [], handovers: [], settings, now: NOW });
  assert.equal(stage(r, "Assembly").head, "Sonu bhai");
  assert.equal(stage(r, "Trial").head, "Ramesh ji");
  assert.equal(stage(r, "Electrical").head, "");
  assert.equal(stage(r, "Mechanical").head, "");
  assert.equal(stage(r, "Rack").head, "");
  assert.equal(stage(r, "Ready").head, "");
  // No settings / no heads → every stage hidden.
  const none = buildProductionLine({ machines: [], handovers: [], settings: null, now: NOW });
  assert.ok(none.stages.every((s) => s.head === ""));
  assert.deepEqual(Object.keys(readDepartmentHeads(settings)), ["Assembly", "Trial"]);
  assert.equal(headNameFor(settings, "Assembly"), "Sonu bhai");
});

test("department heads: real department list, set and clear one head", () => {
  assert.deepEqual([...HEAD_DEPARTMENTS], ["Assembly", "Mechanical", "Electrical", "Trial"]);
  let h = setDepartmentHead({}, "Mechanical", { userId: 7, name: "Raju" });
  assert.deepEqual(h, { Mechanical: { userId: "7", name: "Raju" } });
  h = setDepartmentHead(h, "Assembly", { userId: null, name: "Sonu bhai" });
  assert.deepEqual(h.Assembly, { userId: null, name: "Sonu bhai" });
  h = setDepartmentHead(h, "Mechanical", null);
  assert.deepEqual(Object.keys(h), ["Assembly"]);
  assert.equal(readDepartmentHeads({ departmentHeads: "junk" }).Assembly, undefined);
  assert.equal(readDepartmentHeads({ departmentHeads: { Assembly: "Old string" } }).Assembly.name, "Old string");
});
