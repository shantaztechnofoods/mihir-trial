// 2026-11-03 — "Why machines got delayed" counting helper. LOCAL SEED DATA ONLY.
process.env.TZ = "Asia/Kolkata";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { appSource } from "./helpers/source.mjs";
const { countDelayReasons, collectDelayEvents, classifyDelayText, delayPeriodRange } = await import("../src/utils/delayReasons.js");

const NOW = new Date(2026, 10, 3, 12, 0); // 3 Nov 2026
const late = (dept, reason, at) => ({ stage: dept, department: dept, at, date: "x", note: `Accepted into ${dept} by Ramesh (ON HOLD — accepted late${reason ? `: ${reason}` : ""})` });
const machines = [
  { id: 1, history: [
    { stage: "Mechanical", at: "2026-11-01T05:00:00Z", note: "Accepted into Mechanical by Ramesh" },           // not a delay
    late("Mechanical", "Parts missing", "2026-11-01T06:00:00Z"),
    late("Electrical", "Worker on leave", "2026-11-02T06:00:00Z"),
    late("Electrical", "Motor (2HP) not delivered", "2026-11-02T07:00:00Z"),                               // Other, with ")" inside
    late("Trial", "parts missing", "2026-10-20T06:00:00Z"),                                                  // last month
  ] },
  { id: 2, history: [
    { stage: "Mechanical", date: "2 Nov 2026", note: "Put ON HOLD by Super Admin: Other machine first" },
    { stage: "Mechanical", date: "2 Nov 2026", note: "Released from ON HOLD by Super Admin: done" },        // not a delay
    { stage: "Assembly", date: "5 Jan 2026", note: "Put ON HOLD by Suresh: waiting for drawing" },          // this year only
  ] },
];
const handovers = [
  { id: 1, machineId: 1, fromDepartment: "Mechanical", sentAt: "2026-11-02T09:00:00Z", overrunNarration: "Shaft re-machined" },
  { id: 2, machineId: 2, fromDepartment: "Electrical", sentAt: "2026-11-02T09:00:00Z", overrunNarration: "  " },                // blank = ignored
  { id: 3, machineId: 2, fromDepartment: "Electrical", sentAt: "2026-11-02T10:00:00Z", overrunNarration: "Parts missing" },
];

test("quick-button labels are recognised in any case; anything else is Other", () => {
  assert.equal(classifyDelayText("Parts missing"), "Parts missing");
  assert.equal(classifyDelayText(" worker ON leave "), "Worker on leave");
  assert.equal(classifyDelayText("Other machine first"), "Other machine first");
  assert.equal(classifyDelayText("no crane"), "Other");
  assert.equal(classifyDelayText(""), "Other");
});

test("period ranges: this month, last month, this year", () => {
  const r = (k) => delayPeriodRange(k, NOW).map((d) => d.toDateString());
  assert.deepEqual(r("month"), [new Date(2026, 10, 1).toDateString(), new Date(2026, 11, 1).toDateString()]);
  assert.deepEqual(r("lastMonth"), [new Date(2026, 9, 1).toDateString(), new Date(2026, 10, 1).toDateString()]);
  assert.deepEqual(r("year"), [new Date(2026, 0, 1).toDateString(), new Date(2027, 0, 1).toDateString()]);
  assert.deepEqual(delayPeriodRange("lastMonth", new Date(2026, 0, 15)).map((d) => d.getFullYear()), [2025, 2026]);
});

test("collects late accepts, manual holds and finish narrations — never a person's name", () => {
  const ev = collectDelayEvents({ machines, handovers });
  assert.equal(ev.length, 8);
  assert.ok(ev.every((e) => !/Ramesh|Super Admin|Suresh/.test(JSON.stringify(e))), "names are not carried");
});

test("this month: counts by reason and by department", () => {
  const c = countDelayReasons({ machines, handovers, period: "month", now: NOW });
  assert.equal(c.total, 6);
  const by = Object.fromEntries(c.byReason.map((r) => [r.reason, r.count]));
  assert.deepEqual(by, { "Parts missing": 2, "Worker on leave": 1, "Other machine first": 1, "Other": 1, "Took longer than planned": 1 });
  assert.equal(c.byReason[0].reason, "Parts missing", "biggest first");
  assert.deepEqual(c.byReason.find((r) => r.reason === "Other").texts.map((t) => t.text), ["Motor (2HP) not delivered"]);
  assert.deepEqual(c.byReason.find((r) => r.reason === "Took longer than planned").texts.map((t) => t.text), ["Shaft re-machined"]);
  assert.deepEqual(c.byDepartment, [{ department: "Electrical", count: 3 }, { department: "Mechanical", count: 3 }]);
});

test("last month and this year", () => {
  const lm = countDelayReasons({ machines, handovers, period: "lastMonth", now: NOW });
  assert.equal(lm.total, 1);
  assert.deepEqual(lm.byDepartment, [{ department: "Trial", count: 1 }]);
  const yr = countDelayReasons({ machines, handovers, period: "year", now: NOW });
  assert.equal(yr.total, 8);
  assert.equal(yr.byReason.find((r) => r.reason === "Other").count, 2);
});

test("empty data → zero, no crash", () => {
  const c = countDelayReasons({ now: NOW });
  assert.equal(c.total, 0); assert.deepEqual(c.byReason, []); assert.deepEqual(c.byDepartment, []);
  assert.equal(countDelayReasons({ machines: [{ id: 9 }], handovers: [null], now: NOW }).total, 0);
});

test("the note formats the helper reads are still the ones the app writes", () => {
  const app = appSource();
  assert.ok(app.includes("(ON HOLD — accepted late${holdReason ? `: ${holdReason}` : \"\"})"), "late-accept note format");
  assert.ok(app.includes("`Put ON HOLD by ${who}: ${why}`"), "manual hold note format");
  assert.ok(app.includes("overrunNarration: narration"), "finish narration field");
});
