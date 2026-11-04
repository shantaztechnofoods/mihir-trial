// Purchase audit fixes (Order Pipeline follow-ups + PO GST labels).
// Run: node --test tests/purchaseAudit.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isoToDisplayDate, parseDisplayDate } from "../src/utils/parseDate.js";
import { poTaxLines, calculateGSTBreakdown } from "../src/utils/gst.js";
import { buildPOHtml } from "../src/utils/poTemplate.js";
import { uiSource } from "./helpers/source.mjs";

const APP = uiSource();

// ── Bug 1: custom follow-up / ETA date showed "NaNd left" ──────────────────

test("isoToDisplayDate turns a date-picker value into the stored display form", () => {
  assert.equal(isoToDisplayDate("2026-11-20"), "20 Nov 2026");
  const back = parseDisplayDate(isoToDisplayDate("2026-09-05"));
  assert.equal(back.getFullYear(), 2026);
  assert.equal(back.getMonth(), 8);
  assert.equal(back.getDate(), 5);
});

test("isoToDisplayDate leaves display dates, blanks and junk untouched", () => {
  assert.equal(isoToDisplayDate("5 Nov 2026"), "5 Nov 2026");
  assert.equal(isoToDisplayDate(""), "");
  assert.equal(isoToDisplayDate(null), null);
  assert.equal(isoToDisplayDate(undefined), undefined);
  assert.equal(isoToDisplayDate("2026-02-31"), "2026-02-31");
});

test("Order Pipeline formats custom follow-up / ETA dates and heals old ISO rows", () => {
  assert.match(APP, /onFollowUpDone\(fuModal\.id, fuFreq, fuFreq === "custom" \? isoToDisplayDate\(fuCustom\)/);
  assert.match(APP, /onConfirmOrder\(moModal\.id, eta === "custom" \? isoToDisplayDate\(etaCustom\)/);
  assert.match(APP, /parseDate\(isoToDisplayDate\(f\.nextFollowUp\)\)/);
});

// ── Bug 2: hard-coded "GST (18%)" on PO view / card / template ─────────────

const li = [{ code: "A", name: "A", qty: 2, rate: 500, amount: 1000 }];

test("interstate PO shows a single IGST line at its own rate", () => {
  const lines = poTaxLines({ purchaseType: "inter_gst_12", gst: 120, igst: 120, cgst: 0, sgst: 0, lineItems: li });
  assert.deepEqual(lines, [{ key: "igst", label: "IGST (12%)", amount: 120 }]);
});

test("local PO shows CGST + SGST at half the rate each", () => {
  const lines = poTaxLines({ purchaseType: "local_gst_18", gst: 180, cgst: 90, sgst: 90, igst: 0, lineItems: li });
  assert.deepEqual(lines.map((l) => l.label), ["CGST (9%)", "SGST (9%)"]);
  assert.deepEqual(lines.map((l) => l.amount), [90, 90]);
});

test("local 5% PO labels 2.5% halves; split derived when cgst/sgst were not stored", () => {
  const lines = poTaxLines({ purchaseType: "local_gst_5", gst: 50, cgst: 0, sgst: 0, igst: 0, lineItems: li });
  assert.deepEqual(lines, [
    { key: "cgst", label: "CGST (2.5%)", amount: 25 },
    { key: "sgst", label: "SGST (2.5%)", amount: 25 },
  ]);
});

test("multi-rate / import types show the tax name without a %", () => {
  assert.deepEqual(poTaxLines({ purchaseType: "local_gst_multi", gst: 100, lineItems: li }).map((l) => l.label), ["CGST", "SGST"]);
  assert.deepEqual(poTaxLines({ purchaseType: "import_purchase", gst: 100, lineItems: li }).map((l) => l.label), ["IGST"]);
});

test("exempt PO shows GST (Exempt) at ₹0", () => {
  assert.deepEqual(poTaxLines({ purchaseType: "exempt_purchase", gst: 0, lineItems: li }), [{ key: "gst", label: "GST (Exempt)", amount: 0 }]);
});

test("legacy PO without a purchase type keeps an honest single GST line", () => {
  assert.equal(poTaxLines({ gst: 180, lineItems: li })[0].label, "GST (18%)");
  assert.equal(poTaxLines({ gst: 120, lineItems: li })[0].label, "GST (12%)");
  assert.equal(poTaxLines({ gst: 133, lineItems: li })[0].label, "GST");
  assert.equal(poTaxLines({ lineItems: li })[0].amount, 180);
});

test("no hard-coded GST (18%) label is left on PO screens or template", () => {
  assert.doesNotMatch(APP, /GST \(18%\)/);
  const html = buildPOHtml({ id: "PO-4", purchaseType: "inter_gst_12", gst: 120, igst: 120, amount: 1120, lineItems: li }, {}, {});
  assert.match(html, /IGST \(12%\)/);
  assert.doesNotMatch(html, /GST \(18%\)/);
});

test("CGST/SGST split has no floating-point tail", () => {
  const b = calculateGSTBreakdown(55.61, "local_gst_18");
  assert.equal(b.cgst + b.sgst, b.gst);
  for (const v of [b.cgst, b.sgst, b.gst, b.total]) assert.equal(Math.round(v * 100) / 100, v);
});
