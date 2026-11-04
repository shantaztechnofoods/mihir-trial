// URGENT FIX 2026-11-02 — Accept into Department: mandatory Digital Signature.
// Store payload (mocked Supabase) + static checks on src/App.jsx.
// DB side: tests/db/057_accept_tests.sql.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appSource } from "./helpers/source.mjs";

let CLIENT = null;
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
mock.module(new URL("../src/config/env.js", import.meta.url).href, {
  namedExports: { isSupabaseEnabled: () => true, IS_PROD: false, SUPABASE_URL: "x", SUPABASE_ANON_KEY: "x", USE_SUPABASE: true, ALLOW_DEMO: false, APP_NAME: "t", APP_ENV: "test" },
});
mock.module(new URL("../src/supabase/client.js", import.meta.url).href, {
  namedExports: { getSupabase: () => CLIENT, probeSupabase: async () => ({ ok: true }) },
});
const { acceptHandover } = await import("../src/stores/handoverStore.js");

test("accept writes signature, name, department, time and the employees to the hand-over row", async () => {
  const box = { row: null };
  CLIENT = { from: () => ({ update: (row) => { box.row = row; const q = { eq: () => q, select: () => ({ maybeSingle: async () => ({ data: { id: 5, status: "accepted", ...row }, error: null }) }) }; return q; } }) };
  const r = await acceptHandover(5, { acceptedBy: "u1", acceptedBySignatureId: null, acceptedByTeamSnapshot: [{ name: "Samir" }, { name: "Mahesh" }],
    acceptedSignatureSvg: "<svg>x</svg>", acceptedByName: "Samir, Mahesh", acceptedInDepartment: "Mechanical" });
  assert.equal(r.success, true);
  assert.equal(box.row.accepted_signature_svg, "<svg>x</svg>");
  assert.equal(box.row.accepted_by_name, "Samir, Mahesh");
  assert.equal(box.row.accepted_in_department, "Mechanical");
  assert.deepEqual(box.row.accepted_by_team_snapshot, [{ name: "Samir" }, { name: "Mahesh" }]);
  assert.ok(box.row.accepted_at);
  assert.equal(r.handover.acceptedSignatureSvg, "<svg>x</svg>");
  assert.equal(r.handover.acceptedByName, "Samir, Mahesh");
});

test("local (offline) accept keeps the signature too", async () => {
  const src = readFileSync(new URL("../src/stores/handoverStore.js", import.meta.url), "utf8");
  assert.match(src, /acceptedSignatureSvg: acceptedSignatureSvg \|\| null, acceptedByName: acceptedByName \|\| null/);
});

const app = appSource();
const main = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
const slice = (a, b) => { const i = app.indexOf(a); assert.ok(i > 0, a); const j = app.indexOf(b, i); assert.ok(j > i, b); return app.slice(i, j); };

test("the Accept popup always shows the signature pad, whether or not a signature is stored", () => {
  const open = slice("const openAcceptModal = async", "const submitAcceptHandover");
  assert.doesNotMatch(open, /getMySignature|needSig/);
  const modal = slice("Phase A — Accept modal", "data-accept-confirm");
  assert.match(modal, /data-accept-signature/);
  assert.match(modal, /Digital signature/);
  assert.match(modal, /<SignaturePad onSave=\{\(svg\) => setField\(\{ sigSvg: svg/);
  assert.doesNotMatch(modal, /needSig/);
});

test("Confirm Acceptance stays disabled until a signature is saved and a receiving employee is selected", () => {
  const btn = slice("data-accept-confirm", "Confirm Acceptance");
  assert.match(btn, /!sigSvg/);
  assert.match(btn, /acceptDeptEmps\.length > 0 && selectedTeam\.filter\(Boolean\)\.length === 0/);
  const submit = slice("const submitAcceptHandover", "// ── Phase 1 — My Work");
  assert.match(submit, /Select the employees receiving this machine\./);
  assert.match(submit, /if \(!sigSvg\)/);
  assert.match(submit, /signatureSvg: sigSvg/);
  // the stored per-user signature is no longer overwritten by an acceptance
  assert.doesNotMatch(submit, /onRegisterSignature/);
});

test("handler refuses without a drawn signature and records name, department, time and signature", () => {
  const h = slice("const handleAcceptHandover = async", "// Phase B — raise any pending items");
  assert.match(h, /A digital signature is required to accept a handover\./);
  assert.doesNotMatch(h, /Register your signature before accepting/);
  assert.match(h, /acceptedSignatureSvg: signatureSvg/);
  assert.match(h, /acceptedByName,/);
  assert.match(h, /acceptedInDepartment: handover\.toDepartment/);
  assert.match(h, /by: acceptedByName, department: newStage, at: nowIso, handoverId, signed: true/);
});

test("the signature is visible in the machine report and the machine history", () => {
  // 2026-11-04 — printed once, in the report's signature register (name, department, date, image).
  const rep = slice("  const sigRows = [", "// D7 — the release sign-off");
  assert.match(rep, /svgDataUri\(h\.acceptedSignatureSvg\)/);
  assert.match(rep, /h\.acceptedByName \|\| userName\(h\.acceptedBy\)/);
  assert.match(rep, /dept: h\.acceptedInDepartment \|\| h\.toDepartment, when: h\.acceptedAt/);
  const reg = slice("function RptSignatureRegister(", "function trialCertSignatureRows(");
  assert.match(reg, /data-report-accept-signature/);
  assert.match(reg, /<img src=\{r\.src\}/);
  assert.match(app, /data-history-accept-signature/);
  assert.match(app, /svgDataUri\(ho\.acceptedSignatureSvg\)/);
});

test("Finish & Transfer stays signature-free", () => {
  const fin = slice("const submitFinishTransfer = async", "const openAcceptModal = async");
  assert.doesNotMatch(fin, /SignaturePad|sigSvg|Save Signature/);
  assert.doesNotMatch(app, /data-transfer-sign/);
  assert.match(app, /mainEmployeeSignatureSvg: null,   \/\/ Transfer needs no signature/);
});

test("build tags match", () => {
  const a = app.match(/APP_BUILD = "([^"]+)"/)[1];
  assert.match(main, new RegExp(a));
});
