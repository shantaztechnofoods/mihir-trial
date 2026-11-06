// Voice search normaliser (2026-11-06): spoken words -> what a worker types.
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeVoiceQuery as n } from "../src/utils/voiceSearch.js";

test("machine codes: M ten / M-10 / em 10 / m10 -> M-10", () => {
  for (const s of ["M ten", "M-10", "em 10", "m10", "M 10.", "Em ten.", "m - 10", "M10", "emm ten"]) assert.equal(n(s), "M-10", s);
});

test("serial numbers: S N 103 -> SN-103", () => {
  for (const s of ["S N 103", "SN 103", "sn-103", "SN103", "es en 103", "S N one oh three", "S N one zero three", "s n one hundred three", "S. N. 103."]) assert.equal(n(s), "SN-103", s);
});

test("Hindi / Gujarati script letters and numerals", () => {
  assert.equal(n("एम 10"), "M-10");
  assert.equal(n("एम टेन"), "M-10");
  assert.equal(n("एम दस"), "M-10");
  assert.equal(n("M १०"), "M-10");
  assert.equal(n("એમ દસ"), "M-10");
  assert.equal(n("એમ ૧૦"), "M-10");
  assert.equal(n("एस एन १०३"), "SN-103");
  assert.equal(n("एस एन एक शून्य तीन").startsWith("SN-1"), true);
});

test("number words", () => {
  assert.equal(n("twenty five"), "25");
  assert.equal(n("M twenty five"), "M-25");
  assert.equal(n("one hundred twelve"), "112");
  assert.equal(n("ten"), "10");
});

test("plain words stay, command words and punctuation dropped", () => {
  assert.equal(n("Kneading machine."), "kneading machine");
  assert.equal(n("search for kneading machine"), "kneading machine");
  assert.equal(n("Find M ten"), "M-10");
  assert.equal(n("show me SN 103"), "SN-103");
  assert.equal(n("bearing"), "bearing");
});

test("everyday words that sound like letters are not turned into codes", () => {
  assert.equal(n("see you"), "see you");
  assert.equal(n("why are 10"), "why are 10");
  assert.equal(n("मशीन के 10"), "मशीन के 10");
});

test("empty / junk input is safe", () => {
  assert.equal(n(""), "");
  assert.equal(n(null), "");
  assert.equal(n(undefined), "");
  assert.equal(n("   ...  "), "");
});
