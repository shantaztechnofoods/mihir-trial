// "5 Sept 2026" — Chromium's en-IN short month for September is "Sept", not
// "Sep". The old exact map { Sep: 8 } missed it and silently returned January,
// so every September date sorted, aged and reported as 5 Jan. Months are now
// matched on their first three letters, case-insensitively (src/utils/parseDate.js).
process.env.TZ = "Asia/Kolkata";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { appSource } from "./helpers/source.mjs";
const { monthIndex, parseDisplayDate } = await import("../src/utils/parseDate.js");

test("'Sept' and every other month spelling resolve by their first three letters", () => {
  assert.equal(monthIndex("Sept"), 8);
  assert.equal(monthIndex("Sep"), 8);
  assert.equal(monthIndex("sept"), 8);
  assert.equal(monthIndex("SEPTEMBER"), 8);
  assert.equal(monthIndex("Sept."), 8);
  assert.equal(monthIndex("Jan"), 0);
  assert.equal(monthIndex("December"), 11);
  assert.equal(monthIndex("Foo"), null);
  assert.equal(monthIndex(""), null);
  assert.equal(monthIndex("Se"), null);
});

test("'5 Sept 2026' parses as 5 September, not 5 January", () => {
  const d = parseDisplayDate("5 Sept 2026");
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 8);
  assert.equal(d.getDate(), 5);
  // the exact string fmtDate() produces in a Chromium en-IN locale
  const d2 = parseDisplayDate("30 Oct 2026");
  assert.equal(d2.getMonth(), 9); assert.equal(d2.getDate(), 30);
  assert.equal(parseDisplayDate("not a date"), null);
  assert.equal(parseDisplayDate(""), null);
});

test("App.jsx parseDate uses the shared month matcher (no exact-key month map left)", () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = appSource();
  assert.match(app, /import \{ monthIndex, parseDisplayDate \} from "(?:\.\.?\/)+utils\/parseDate\.js";/);
  assert.match(app, /const parseDate = \(str\) => \{\s*\n\s*if \(!str\) return new Date\(\);[\s\S]{0,400}?parseDisplayDate\(str\)/);
  assert.doesNotMatch(app, /Jan:0,Feb:1,Mar:2/, "the exact-key month map is gone");
});
