// Go-live client fixes (2026-11-02) — source assertions on src/App.jsx and
// src/realtime/useRealtimeTables.js, in the style of tests/rackSlots.test.mjs.
// These lock in the ORDER of writes and the absence of unsafe patterns; the
// behaviour itself is exercised in the Playwright smoke (local mode).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { appSource, readSrc } from "./helpers/source.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const app = appSource();
const rt  = fs.readFileSync(path.join(root, "src/realtime/useRealtimeTables.js"), "utf8");
const fn  = (name, until) => app.slice(app.indexOf(name), app.indexOf(until, app.indexOf(name)));

test("H: no user-supplied SVG is injected as markup — signatures render through an <img> data URI", () => {
  assert.doesNotMatch(app, /dangerouslySetInnerHTML/, "no dangerouslySetInnerHTML anywhere in App.jsx");
  // 2026-11-04 module split: src/components moved to src/shared/components (POSettings to modules/purchase)
  for (const f of ["src/shared/components", "src/utils", "src/stores"]) {
    const dir = path.join(root, f);
    for (const file of fs.readdirSync(dir)) {
      if (!/\.(js|jsx)$/.test(file)) continue;
      assert.doesNotMatch(fs.readFileSync(path.join(dir, file), "utf8"), /dangerouslySetInnerHTML|\.innerHTML\s*=/, `${f}/${file}`);
    }
  }
  assert.doesNotMatch(readSrc("src/modules/purchase/POSettings.jsx"), /dangerouslySetInnerHTML|\.innerHTML\s*=/, "POSettings.jsx");
  assert.match(app, /const svgDataUri = \(svg\) => `data:image\/svg\+xml;charset=utf-8,\$\{encodeURIComponent\(String\(svg \|\| ""\)\)\}`;/);
  // 2026-11-04 — every signature prints once, in the signature register, as an <img> data URI.
  assert.match(app, /src: svgDataUri\(h\.mainEmployeeSignatureSvg\)/);
  assert.match(app, /src: svgDataUri\(h\.acceptedSignatureSvg\)/);
  assert.match(app, /<img src=\{r\.src\} alt=\{`Signature: \$\{r\.name \|\| r\.role\}`\} \/>/);
});

test("K: Remove From Rack goes through rack_remove_machine in Supabase mode, audits after success, local path intact", () => {
  const body = fn("const handleRemoveRackMachine = async (machineId) => {", "// Adds a \"materials fully issued\" note");
  assert.match(body, /if \(!authCanDo\("outward", "delete"\)\)/, "permission check kept");
  assert.match(body, /c\.rpc\("rack_remove_machine", \{ p_machine_id: Number\(machineId\) \}\)/);
  const rpcAt = body.indexOf('rpc("rack_remove_machine"');
  const auditAt = body.indexOf('type: "machine_rack_removed"');
  assert.ok(rpcAt > 0 && auditAt > rpcAt, "audit entry follows the RPC");
  assert.match(body, /res\.already_removed/);
  assert.match(body, /res\.outward_ids/); assert.match(body, /res\.pending_ids/); assert.match(body, /line\.after_stock/);
  // the Supabase branch applies stock locally only — no second movement
  const supa = body.slice(body.indexOf("if (isSupabaseEnabled()) {"), body.indexOf("// Local mode — the client-side sequence below is unchanged."));
  assert.ok(!supa.includes("handleUpdateStock("), "no stock movement recorded client-side on the RPC path");
  assert.ok(!supa.includes("machineDelete(") && !supa.includes("deleteOutwardByIssueId(") && !supa.includes("pendingDelete("), "no manual delete sequence on the RPC path");
  // local mode still reverses stock line by line
  assert.match(body, /const res = await handleUpdateStock\(cat, li\.code, \+qty, reversalRef\);/);
});

test("J + B: BOM issue creates the machine row first (awaited), audits only after it exists, aborts on refused stock", () => {
  const create = fn("const handleCreateMachine = async (", "const handleAbortMachineCreate = async (");
  const insertAt = create.indexOf("const r = await machineCreate(newMachine);");
  const auditDef = create.indexOf("const auditCreated = (machineId) => logAudit({");
  assert.ok(insertAt > 0 && auditDef > 0, "insert awaited; audit is deferred into a closure");
  const after = create.slice(insertAt);
  assert.match(after, /if \(!r\.success\) \{[\s\S]*?return \{ success: false, error: r\.error \|\| "Machine not saved" \};/);
  assert.ok(after.indexOf("auditCreated(realId)") > after.indexOf("if (!r.success)"), "audit after the insert succeeded");
  assert.match(create, /if \(!isSupabaseEnabled\(\)\) \{\s*setMachineLog\(\(prev\) => \[newMachine, \.\.\.prev\]\);\s*auditCreated\(newMachine\.id\);/, "local mode logs immediately");
  // the drawer: machine before moves, abort after a refused move, id handed on
  const drawer = readSrc("src/modules/bom/BOMDrawer.jsx");
  const machineFirst = drawer.indexOf("mr = await onCreateMachineFirst({");
  const moves = drawer.indexOf("const results = await Promise.all(moves.map((m) =>");
  assert.ok(machineFirst > 0 && machineFirst < moves, "machine row is created before the stock moves run");
  assert.match(drawer, /Issue aborted — the machine record could not be saved/);
  assert.match(drawer, /if \(createdMachine && onAbortMachine\) \{/);
  assert.match(drawer, /machineId: createdMachine \? createdMachine\.id : null/);
  assert.match(app, /if \(data\.serialNo && onCreateMachine && data\.machineId == null && !\(data\.rackSet && data\.rackSet\.mode === "crate"\)\)/, "handleBOMIssue does not create it twice");
  const abort = fn("const handleAbortMachineCreate = async (", "// 2026-11-01 — issues and pending jobs are TRACKING");
  assert.match(abort, /type: "machine_issue_aborted"/);
  assert.ok(!abort.includes("handleUpdateStock("), "abort never touches stock");
});

test("C + B: admin stage override refuses an open hand-over, is gated in the UI, and audits after the DB answer", () => {
  const body = fn("const handleUpdateMachineStage = async (machineId, newStage) => {", "// SERIAL-BASED start production.");
  assert.match(body, /const openHandover = !!\(machine && machine\.pendingHandoverId\)\s*\|\| \(handovers \|\| \[\]\)\.some\(\(h\) => h && h\.status === "pending" && String\(h\.machineId\) === String\(machineId\)\);/);
  assert.match(body, /hand-over awaiting acceptance/);
  // 063: the awaited write is the append-only compare-and-set call (the store falls back to machineUpdate before 063).
  assert.match(body, /const r = await machineAppendHistory\(machineId, \{/);
  assert.match(body, /expectedStage: machine\.stage,/, "stage change is compare-and-set on the stage the operator saw");
  assert.match(body, /if \(r\.stale\) \{[\s\S]*?STALE_MACHINE_MSG[\s\S]*?rtMach\(\);/, "stale answer refreshes and tells the user");
  assert.ok(body.indexOf("auditStage(dbAudited);") > body.indexOf("const r = await machineAppendHistory("), "audit after the awaited update");
  assert.match(body, /rtMach\(\);\s*return \{ success: false, error: r\.error \|\| "Stage not saved" \};/, "optimistic row rolled back by refetch");
  assert.match(app, /isAdminUser && canDo\("machines","updateStage"\) && !machine\.pendingHandoverId\s*\n\s*&& !\(handovers \|\| \[\]\)\.some\(\(h\) => h && h\.status === "pending" && String\(h\.machineId\) === String\(machine\.id\)\) && \(/);
  assert.match(app, /const r = await onUpdateStage\(machine\.id, newStage\);/);
});

test("D: Accept finds the machine (refetching once) BEFORE the handover is flipped", () => {
  const body = fn("const handleAcceptHandover = async ({", "const handleRegisterSignature = async");
  const lookup = body.indexOf("let machine = machineLog.find((m) => String(m.id) === String(handover.machineId));");
  const refetch = body.indexOf("const fresh = await fetchMachines();");
  const refuse = body.indexOf("was not found — refresh the page and try again. The handover has not been accepted.");
  // 2026-11-05 — the accept write sits behind the resume check (": await handoverAccept(").
  const accept = body.indexOf("await handoverAccept(handoverId, {");
  assert.ok(lookup > 0 && refetch > lookup && refuse > refetch && refuse < accept, "lookup → refetch → refuse all precede the accept write");
  assert.ok(!body.includes("if (isSupabaseEnabled() && machine) {"), "promote is no longer skipped silently when the machine is missing");
});

test("A: Machine-module writes that used to fail silently now reach flashSaveError", () => {
  for (const [name, until] of [
    ["const raiseNotIssuedJobs = (", "const handleCreateMachine = async ("],
    ["const handleFinishTransfer = async ({", "// Accept flow: verify password"],
    ["const handleAcceptHandover = async ({", "const handleRegisterSignature = async"],
  ]) {
    const body = fn(name, until);
    // every console.warn about a failed save is followed by a visible error within a few lines
    for (const m of body.matchAll(/console\.warn\("\[App\][^"]*(save failed|not saved)[^"]*"[^\n]*\n/g)) {
      const tail = body.slice(m.index, m.index + 400);
      assert.match(tail, /flashSaveError\(/, `${name} — ${m[0].trim()}`);
    }
  }
  assert.match(app, /flashSaveError\("Department rating not saved"/);
  assert.match(app, /flashSaveError\("Checklist not saved"/);
  assert.match(app, /flashSaveError\("Pending item not saved"/);
});

test("G: realtime covers the four Machine Tracker side tables and catches up on visibility / online", () => {
  for (const t of ["pending_handover_items", "checklist_responses", "department_ratings", "machine_attachments"]) assert.match(rt, new RegExp(`wire\\("${t}",`));
  assert.match(rt, /document\.addEventListener\("visibilitychange", onVis\)/);
  assert.match(rt, /window\.addEventListener\("online", onOnline\)/);
  assert.match(rt, /timer = setTimeout\(\(\) => \{/, "debounced");
  assert.match(app, /onPendingItemsChange:\s+rtPendingItems,/);
  assert.match(app, /onChecklistResponsesChange:\s+rtResponses,/);
  assert.match(app, /onRatingsChange:\s+rtRatings,/);
  assert.match(app, /onAttachmentsChange:\s+rtAttachments,/);
});
