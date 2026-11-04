import { test } from "node:test";
import assert from "node:assert/strict";
import { rackViewLog, PHYSICAL_RACK_LAYOUT, rackOfBom, rackBoms, rackCapacityFor, familySlotIds, buildFamilyRacks, firstFreeSlot, canAssignSlot, slotLabel, slotStatusOf, pairSlotOf, setSlotOf, setLabel, bomFillCheck, rCrateIssues, freeSlotsFor } from "../src/utils/rackSlots.js";

const fam10 = PHYSICAL_RACK_LAYOUT.families[0];
const m = (id, over = {}) => ({ id, bomKey: "KM10", serialNo: `S${id}`, stage: "BOM Issued", status: "active", createdDate: `2026-10-${String(10 + id).padStart(2, "0")}`, ...over });

test("six fixed racks, two slots each, one BOM per rack", () => {
  const racks = PHYSICAL_RACK_LAYOUT.families.flatMap((f) => PHYSICAL_RACK_LAYOUT.tiers.map((t) => `${t}-${f.label}`));
  assert.deepEqual(racks, ["M-10", "R-10", "M-15", "R-15", "M-20", "R-20"]);
  for (const k of ["M-10", "R-10", "M-15", "R-15", "M-20", "R-20"]) assert.equal(rackCapacityFor(k), 2, k);
  assert.deepEqual(familySlotIds(fam10), ["M-10-1#1", "M-10-1#2", "R-10-1#1", "R-10-1#2"]);
  assert.equal(slotLabel("M-10-1#2"), "M-10 (2)");
  assert.equal(slotLabel("R-20-1#1"), "R-20 (1)");
});

test("rack ↔ BOM mapping is exact; every other BOM is Direct Production only", () => {
  const exp = { "M-10": ["10", "M"], "R-10": ["10", "R"], "M-15": ["15", "M"], "R-15": ["15", "R"], "M-20": ["20", "M"], "R-20": ["20", "R"] };
  for (const [k, [fam, tier]] of Object.entries(exp)) { const r = rackOfBom(k); assert.equal(r.family.label, fam, k); assert.equal(r.tier, tier, k); assert.equal(r.legacy, false); }
  for (const k of ["AM900", "ARM1800", "TM600", "VK", "PILOT-KM10", "TRIAL-01", "KM-10", "M10", "R 10", "NEW-RND-1"]) {
    assert.equal(rackOfBom(k), null, k); assert.equal(rackCapacityFor(k), 0, k);
  }
  // Retired keys keep their machines on the M rack (history), never the R rack.
  for (const [k, fam] of [["KM10", "10"], ["KM15", "15"], ["KM20", "20"]]) { const r = rackOfBom(k); assert.equal(r.tier, "M"); assert.equal(r.family.label, fam); assert.equal(r.legacy, true); }
  assert.deepEqual(rackBoms(fam10, "M"), { primary: "M-10", keys: ["M-10", "KM10"] });
  assert.deepEqual(rackBoms(fam10, "R"), { primary: "R-10", keys: ["R-10"] });
});

const mm = (id, bomKey, over = {}) => m(id, { bomKey, ...over });

test("a machine only ever lands on its own rack", () => {
  const log = [mm(1, "M-10"), mm(2, "R-10"), mm(3, "M-10"), mm(4, "M-10")];
  const { placed, overflow } = buildFamilyRacks(fam10, log);
  assert.equal(placed["M-10-1#1"].machine.id, 1);
  assert.equal(placed["M-10-1#2"].machine.id, 3);
  assert.equal(placed["R-10-1#1"].machine.id, 2);
  assert.equal(placed["R-10-1#2"], undefined, "an M-10 set never spills onto the R-10 rack");
  assert.deepEqual(overflow.map((x) => x.id), [4]);
  // A wrong-rack pin is ignored and the set re-flows onto its own rack.
  const p2 = buildFamilyRacks(fam10, [mm(5, "R-10", { rackSlot: "M-10-1#1" })]).placed;
  assert.equal(p2["M-10-1#1"], undefined); assert.equal(p2["R-10-1#1"].machine.id, 5);
});

test("legacy KM10 machine keeps its saved slot (live fcbf: M-10-1#2)", () => {
  const log = [mm(64, "KM10", { serialNo: "fcbf", rackSlot: "M-10-1#2" })];
  const { placed } = buildFamilyRacks(fam10, log);
  assert.equal(placed["M-10-1#2"].machine.serialNo, "fcbf");
  assert.equal(placed["M-10-1#2"].pinned, true);
  assert.equal(firstFreeSlot("M-10", log), "M-10-1#1");
});

test("slot status: set / assembling / assembled / empty; machine past Assembly is off the rack", () => {
  const awaiting = new Set(["5"]);
  const log = [mm(4, "M-10", { rackSlot: "M-10-1#1", stage: "Assembly" }), mm(5, "M-10", { rackSlot: "M-10-1#2", stage: "Assembly" }), mm(6, "R-10", { stage: "Mechanical", rackSlot: "R-10-1#1" })];
  const { columns, placed } = buildFamilyRacks(fam10, log, awaiting);
  assert.equal(columns[0][0].slots[0].status, "assembling");
  assert.equal(columns[0][0].slots[1].status, "assembled");
  assert.equal(columns[0][0].name, "M-10");
  assert.equal(columns[0][1].name, "R-10");
  assert.equal(placed["R-10-1#1"], undefined);
  assert.equal(slotStatusOf(null), "empty");
});

test("firstFreeSlot: preferred slot on own rack only; full rack → null; no rack → null", () => {
  const log = [mm(1, "M-10", { rackSlot: "M-10-1#1" })];
  assert.equal(firstFreeSlot("M-10", log), "M-10-1#2");
  assert.equal(firstFreeSlot("M-10", log, new Set(), "R-10-1#2"), "M-10-1#2", "an R slot is never preferred for an M BOM");
  assert.equal(firstFreeSlot("R-10", log, new Set(), "R-10-1#2"), "R-10-1#2");
  assert.equal(firstFreeSlot("AM900", log), null);
  const full = [mm(1, "M-10", { rackSlot: "M-10-1#1" }), mm(2, "M-10", { rackSlot: "M-10-1#2" })];
  assert.equal(firstFreeSlot("M-10", full), null);
  assert.equal(firstFreeSlot("R-10", full), "R-10-1#1");
});

test("M and R units are independent: own machine, own serial, nothing mirrored", () => {
  const log = [mm(1, "M-10", { serialNo: "M1", rackSlot: "M-10-1#1" }), mm(2, "R-10", { serialNo: "R9", rackSlot: "R-10-1#1" })];
  const { placed } = buildFamilyRacks(fam10, log);
  assert.equal(placed["M-10-1#1"].machine.serialNo, "M1");
  assert.equal(placed["R-10-1#1"].machine.serialNo, "R9");
  assert.equal(placed["R-10-1#2"], undefined, "an M machine never appears on an R unit");
  assert.equal(placed["M-10-1#2"], undefined);
  assert.deepEqual(freeSlotsFor("M-10", log), ["M-10-1#2"]);
  assert.deepEqual(freeSlotsFor("R-10", log), ["R-10-1#2"]);
  assert.deepEqual(freeSlotsFor("AM900", log), []);
  assert.equal(firstFreeSlot("R-10", log, new Set(), "R-10-1#2"), "R-10-1#2", "the rack the operator picked is used");
  assert.equal(firstFreeSlot("M-10", log, new Set(), "R-10-1#2"), "M-10-1#2", "an R unit is never used for an M BOM");
});

test("canAssignSlot: no double assignment, own model's sets only, only rack machines", () => {
  const log = [mm(1, "M-10", { rackSlot: "M-10-1#1" }), mm(2, "M-10"), mm(3, "M-15")];
  assert.equal(canAssignSlot(log[1], "M-10-1#1", log).ok, false);
  assert.equal(canAssignSlot(log[1], "R-10-1#1", log).ok, false, "the R unit of a taken set is taken too");
  assert.equal(canAssignSlot(log[1], "M-10-1#2", log).ok, true);
  assert.equal(canAssignSlot(log[2], "M-10-1#2", log).ok, false, "M-15 set cannot go on the M-10 / R-10 racks");
  assert.equal(canAssignSlot({ ...log[1], stage: "Mechanical" }, "M-10-1#2", log).ok, false);
  assert.equal(canAssignSlot(mm(9, "AM900"), "M-10-1#2", log).ok, false);
});

test("bomFillCheck: each rack checks its OWN BOM — missing, retired, empty, short, unknown, ok", () => {
  const inv = { A: { code: "A", stock: 5 }, B: { code: "B", stock: 1 } };
  const stockOf = (c) => inv[c];
  const defs = { "M-10": { items: [{ code: "A", qty: 2 }] }, "R-10": { items: [] }, "M-15": { items: [{ code: "B", qty: 2 }] }, "M-20": { items: [{ code: "ZZ", qty: 1 }] }, KM10: { items: [{ code: "A", qty: 1 }], retiredAt: "x" } };
  assert.equal(bomFillCheck("M-10", defs, stockOf).ok, true);
  const r10 = bomFillCheck("R-10", defs, stockOf); assert.equal(r10.ok, false); assert.equal(r10.empty, true); assert.match(r10.why, /R-10 BOM has no components/);
  assert.deepEqual(bomFillCheck("M-15", defs, stockOf).short.map((l) => l.code), ["B"]);
  assert.equal(bomFillCheck("M-20", defs, stockOf).ok, false, "a component not in the Item Master blocks the rack");
  assert.equal(bomFillCheck("KM10", defs, stockOf).ok, false, "a retired BOM is never filled");
  assert.equal(bomFillCheck("R-20", defs, stockOf).ok, false);
});

test("rCrateIssues: the R crate is a separate R BOM outward under the same serial", () => {
  const log = [
    { id: 1, type: "bom", ref: "M-10", serialNo: "S1" },
    { id: 2, type: "bom", ref: "R-10", serialNo: "s1" },
    { id: 3, type: "bom", ref: "R-10", serialNo: "S2" },
    { id: 4, type: "manual", ref: "R-10", serialNo: "S1" },
  ];
  assert.deepEqual(rCrateIssues(log, "R-10", "S1").map((e) => e.id), [2]);
  assert.deepEqual(rCrateIssues(log, "R-10", "S3"), []);
  assert.deepEqual(rCrateIssues(log, "R-10", ""), []);
});

test("rackViewLog: a released machine leaves its slot even if rack_slot was not cleared", () => {
  const log = [m(1, { stage: "Assembly", rackSlot: "M-10-1#1" }), m(2, { stage: "Assembly", rackSlot: "M-10-1#2" })];
  const hos = [{ machineId: 1, releaseRequired: true, releasedAt: "2026-10-31T01:00:00Z", status: "pending" },
               { machineId: 2, releaseRequired: true, releasedAt: null, status: "pending" }];
  const v = rackViewLog(log, hos);
  assert.equal(v[0].rackSlot, null);
  assert.equal(v[1].rackSlot, "M-10-1#2");
  const { placed } = buildFamilyRacks(fam10, v, new Set(["2"]));
  assert.equal(placed["M-10-1#1"], undefined);
  assert.equal(placed["M-10-1#2"].machine.id, 2);
  assert.equal(firstFreeSlot("KM10", v, new Set(["2"])), "M-10-1#1");
});

// 2026-10-31 hotfix guard: App.jsx once called physicalRackSlots() without
// importing it (ReferenceError in BOM Create / Edit). Every rackSlots export
// that App.jsx calls must be in its import list.
test("App.jsx imports every rackSlots helper it uses", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  const lib = fs.readFileSync(path.join(root, "src/utils/rackSlots.js"), "utf8");
  const exported = [...lib.matchAll(/export (?:function|const) (\w+)/g)].map((m) => m[1]);
  const imp = app.match(/import \{([^}]*)\} from "\.\/utils\/rackSlots\.js"/);
  assert.ok(imp, "App.jsx must import from utils/rackSlots.js");
  const imported = new Set(imp[1].split(",").map((x) => x.trim()));
  for (const name of exported) {
    const used = new RegExp(`\\b${name}\\b`).test(app.replace(imp[0], ""));
    const locallyDefined = new RegExp(`(function|const|let) ${name}\\b`).test(app);
    if (used && !locallyDefined) assert.ok(imported.has(name), `App.jsx uses ${name} but does not import it`);
  }
});

// 2026-10-31 fixed racks — App wiring guards.
test("App: retired BOMs are not issuable; Fill opens only the rack's own BOM; material gates", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  assert.match(app, /const boms = Object\.entries\(bomDefs \|\| \{\}\)\.filter\(\(\[, b\]\) => !\(b && b\.retiredAt\)\)/);
  assert.match(app, /onFillRack\(sl\.id, rack\.bom\.primary\)/, "Fill passes the rack's own BOM");
  assert.match(app, /const chk = bomFillCheck\(bomKey, bomDefs, stockOf\);\n    if \(!chk\.ok\) return \{ success: false/, "Fill refuses unless that rack's BOM is complete and in stock");
  assert.match(app, /if \(serialNo && shortLines\.length > 0\)/, "no machine (rack or direct) while any component is short");
  assert.match(app, /no assembly while BOM components are still pending/);
  assert.match(app, /if \(bomOpenRequest\.n <= __lastFillRequestN\) return;/, "a Fill request opens the BOM once");
});

// 2026-10-31 M/R sets — guards for the approved rack fixes and the
// separate-BOM / shared-serial pairing.
test("App: independent M/R units, BOM Outward rack picker, remove, release scope and permissions", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  assert.doesNotMatch(app, /mergeSetBomItems|setFillCheck/, "M and R BOMs are never merged");
  assert.match(app, /const drawerBom = bomDefs\[openBOM\];/, "the drawer always shows the rack's own BOM");
  // Fill Rack on any empty unit opens that rack's own BOM and fills that unit
  assert.match(app, /if \(tierOfSlot\(slotId\) !== r\.tier\) return \{ success: false/);
  assert.match(app, /setBomOpenRequest\(\{ key: bomKey, slotId, mode: "set", n: Date\.now\(\) \}\);/);
  assert.doesNotMatch(app, /mode: "crate", serialNo: holder\.serialNo/, "no serial is copied to the paired rack");
  // BOM Outward: the operator picks the exact empty rack; it is used for the machine
  assert.match(app, /data-slot-choice=\{id\} onClick=\{\(\) => doIssue\("rack", \{ durationConfirmed: true, slot: id \}\)\}/);
  assert.match(app, /if \(serialNo && rackTracked && !rackSet && !slot\) \{/);
  assert.match(app, /rackSlot: finalDest === "rack" \? \(rackSet \? rackSet\.slotId : slot\) : null/);
  assert.match(app, /const preferred = preferredSlot \|\| \(reserved/);
  // no popup when the rack was chosen in the Rack View
  assert.match(app, /if \(serialNo && !chosenDest && rackSet\) \{\n      \/\/ A set fill has one destination: the selected set\. No popup\.\n      return doIssue\("rack"/);
  // remove from rack returns only this machine's own BOM outwards
  assert.match(app, /rackKeyNorm\(e\.ref\) === rackKeyNorm\(machine\.bomKey\)\) : \[\];/);
  assert.match(app, /const handleRemoveRackMachine = async \(machineId\) => \{\n    if \(!authCanDo\("outward", "delete"\)\)/);
  assert.match(app, /Nothing was removed — the set is still on the rack\./);
  // release only for rack machines; permissions
  assert.match(app, /payload\.releaseRequired = !!machine\.rackSlot && RACK_RELEASE_HOPS\.some\(/);
  assert.match(app, /const handleStartProduction = \(machineIds\) => \{\n    if \(!authCanDo\("machines", "updateStage"\)\)/);
  assert.match(app, /if \(!canFinishTransfer\(authCanDo\)\) return \{ success: false/);
  // Not issued with a reason does not block a rack
  assert.match(app, /const rackIncomplete = \(\) => enriched\.filter\(\(i\) => !skippedCodes\.has\(i\.code\) && \(!isItemChecked\(i\.code\) \|\| !i\.inv \|\| i\.pendingQty > 0 \|\| i\.issueQty < i\.required\)\);/);
  // 2026-11-01 — the crate face states the same fact in fewer words; the
  // count still rides on data-bom-ready and the long form is the tooltip.
  assert.match(app, /data-bom-ready=\{niN\}/);
  assert.match(app, /BOM Ready · \$\{niN\} Pending — parts still owed on this machine/);
  assert.match(app, /\$\{niN\} part\$\{niN === 1 \? "" : "s"\} missing/);
  assert.match(app, /const mv = await handleUpdateStock\(cat, p\.itemCode, -qty, ref\);/);
  assert.match(app, /data-pending-action="issue"/);
});

test("migration 047 guards one machine per set and M-slot pairing in the database", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const up = fs.readFileSync(path.join(root, "supabase/migrations/047_rack_set_guard.sql"), "utf8");
  const up48 = fs.readFileSync(path.join(root, "supabase/migrations/048_rack_set_serial_guard.sql"), "utf8");
  assert.match(up48, /already used by machine/);
  const up49 = fs.readFileSync(path.join(root, "supabase/migrations/049_rack_unit_guard.sql"), "utf8");
  assert.doesNotMatch(up49, /regexp_replace\([^)]*'\^R-', 'M-'\)/, "049: an R unit is not read as its M unit");
  assert.doesNotMatch(up49, /\b(DROP TABLE|TRUNCATE|DELETE FROM|ALTER POLICY|CREATE POLICY|DROP POLICY)\b/i);
  assert.doesNotMatch(up48, /\b(DROP TABLE|TRUNCATE|DELETE FROM|ALTER POLICY|CREATE POLICY|DROP POLICY)\b/i);
  const down = fs.readFileSync(path.join(root, "supabase/migrations/047_rack_set_guard_rollback.sql"), "utf8");
  assert.match(up, /pg_advisory_xact_lock/);
  assert.match(up, /CREATE TRIGGER machine_log_rack_set_guard/);
  assert.match(up, /machine_log_rack_slot_is_set/);
  assert.doesNotMatch(up, /\b(DROP TABLE|TRUNCATE|DELETE FROM|ALTER POLICY|CREATE POLICY|DROP POLICY)\b/i, "additive only, no RLS change");
  assert.match(down, /DROP TRIGGER IF EXISTS machine_log_rack_set_guard/);
});

// 2026-10-31 live bug (M-10, S/N asdf123): a critical item unticked in the list
// and marked Not verified with a reason was rejected as "unticked".
test("App: unticked critical item on a rack BOM is Not Issued once it has a reason", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  assert.match(app, /const untickedCritical = rackBomForCheck\n    \? enriched\.filter\(\(i\) => !isItemChecked\(i\.code\) && i\.inv && i\.inv\.isCritical/);
  assert.match(app, /const criticalLines = \[\.\.\.checkedE\.filter\(\(i\) => i\.issueQty > 0 && i\.inv && i\.inv\.isCritical\), \.\.\.untickedCritical\];/);
  assert.match(app, /if \(!isItemChecked\(line\.code\)\) return false;   \/\/ unticked → never "verified"/);
  // only the explained unticked lines are recorded (as Not Issued); others are never issued
  assert.match(app, /\[\.\.\.checkedE, \.\.\.untickedCritical\.filter\(\(l\) => skippedCodes\.has\(l\.code\)\)\]\.forEach\(\(item\) => \{/);
  // rack check still blocks unticked / short / unknown lines that are not explained
  assert.match(app, /const rackIncomplete = \(\) => enriched\.filter\(\(i\) => !skippedCodes\.has\(i\.code\) && \(!isItemChecked\(i\.code\) \|\| !i\.inv \|\| i\.pendingQty > 0 \|\| i\.issueQty < i\.required\)\);/);
});

// 2026-10-31 — Assembly returns the machine to its rack; an Admin transfers it
// to Mechanical from the Rack View (no Production Manager login yet).
test("App: finish Assembly returns a rack machine to its rack; admin transfers from Rack View", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  assert.match(app, /const rackReturn = !!machine\.rackSlot && fromDepartment === "Assembly" && isRackReleaseHop\(fromDepartment, toDepartment\);/);
  assert.match(app, /rackReturn \? `✓ Assembled · Return to \$\{slotLabel\(machine\.rackSlot\)\}` : `Finish & Transfer → \$\{toDepartment\}`/);
  assert.match(app, /const canSendFromRack = canDo\("machines", "release"\) \|\| isAdminUser;/);
  assert.match(app, /label: "→ Transfer to Mechanical"/);
  assert.match(app, /if \(!authCanDo\("machines", "release"\) && !isAdmin\) return \{ success: false/);
  assert.match(app, /if \(!h\.releaseRequired \|\| h\.releasedAt\) return \{ success: false/);
  // the machine card no longer offers the direct release button: the only
  // release call left in the page is the Rack View transfer (2026-10-31 —
  // the dead `{false && …}` branch on the card was removed outright).
  assert.doesNotMatch(app, /\{false && canDo\("machines", "release"\)/);
  // Two release calls, both in the Rack View: the details panel's Transfer
  // and the same transfer offered on the assembled crate's own face.
  const releaseCalls = app.match(/await onReleaseHandover\(/g) || [];
  // 2026-11-03 (owner-approved) — a third, deliberate path: the receiving
  // department head takes the machine off the rack ("Take from Rack" on the
  // staff dashboard), which releases and opens Accept in one go.
  assert.equal(releaseCalls.length, 3, "release from the Rack View (panel + crate face) + department Take from Rack");
  assert.match(app, /const r = await onReleaseHandover\(h\.id\);\s*setRackTakeBusy\(null\);/);
  assert.match(app, /const r = await onReleaseHandover\(ho\.id\);/);
  assert.match(app, /const r = await onReleaseHandover\(faceHo\.id\);/);
  // signature, checklist and pending-work sections stay in the popup; the
  // worker / main-employee pickers are gone (2026-11-02: Transfer logs no names)
  assert.match(app, /Anything still pending from \{fromDepartment\}\?/);
  // 2026-11-02 — Transfer has NO signature; the transferer is recorded from the login
  assert.doesNotMatch(app, /data-transfer-sign|Sign to confirm this department's work|Signature required/);
  // 2026-11-03 — the "Transferred by … recorded automatically" note box was removed
  // (owner: fewer words); the transferer is still recorded from the login (below).
  assert.doesNotMatch(app, /recorded automatically from your login/);
  assert.match(app, /mainEmployeeSignatureSvg: null,   \/\/ Transfer needs no signature/);
  assert.match(app, /mainEmployeeName: transferrerName,/);
  // Accept keeps its mandatory signature
  assert.match(app, /Draw your signature and press Save Signature before confirming\./);
  assert.match(app, /A digital signature is required to accept a handover\./);
});

// 2026-10-31 live bug (M-10 (2), S/N 123456789): a pulled-back (cancelled)
// hand-over kept the rack showing "Assembled · Ready" with an active
// Transfer button, which then failed with "Already released, or no longer
// waiting". Only a PENDING hand-over parks a machine on the rack; a release
// updates the hand-over first, then clears the slot (awaited), and a second
// release of the same hand-over is refused.
test("rack status: a cancelled or released hand-over never shows 'assembled'", () => {
  const log = [m(1, { bomKey: "M-10", stage: "Assembly", rackSlot: "M-10-1#2" })];
  const pending = new Set(["1"]);
  assert.equal(buildFamilyRacks(fam10, log, pending).columns[0][0].slots[1].status, "assembled");
  // the App only puts PENDING, unreleased hand-overs into awaitingReleaseIds; a
  // cancelled one is not in the set → the machine is simply "assembling" again
  assert.equal(buildFamilyRacks(fam10, log, new Set()).columns[0][0].slots[1].status, "assembling");
  // released → off the rack entirely
  const v = rackViewLog(log, [{ machineId: 1, releaseRequired: true, releasedAt: "2026-10-31T09:00:00Z", status: "pending" }]);
  assert.equal(buildFamilyRacks(fam10, v, new Set()).columns[0][0].slots[1].status, "empty");
});

test("App: release is pending-only, guarded against duplicates, and clears the rack slot awaited", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  assert.match(app, /const isAwaitingRelease = \(h\) => !!\(h && h\.status === "pending" && h\.releaseRequired && !h\.releasedAt\);/);
  assert.match(app, /if \(h\.status !== "pending"\) return \{ success: false, error: h\.status === "cancelled" \? "This hand-over was pulled back/);
  assert.match(app, /if \(releaseBusyRef\.current\.has\(handoverId\)\) return \{ success: false, error: "Transfer already in progress" \};/);
  assert.match(app, /const cleared = await clearRackSlot\(machine, `released to/);
  assert.match(app, /const clearRackSlot = async \(machine, why\) => \{/);
  assert.match(app, /const r = await machineUpdate\(machine\.id, \{ rackSlot: null \}\);/);
  // the rack panel only ever offers Transfer for a PENDING hand-over
  assert.match(app, /const ho = sl\.status === "assembled" \? \(handovers \|\| \[\]\)\.find\(\(h\) => h && h\.status === "pending" && String\(h\.machineId\) === String\(m\.id\)\) : null;/);
});

// 2026-10-31 — direct hand-over acceptance from the machine card (same modal
// and handler as Transfer & Accept; duplicate acceptance refused).
test("App: Accept Machine on the card reuses the accept modal and refuses duplicates", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  // 2026-11-02 — Accept is on every machine card that waits for the receiving
  // department, on whichever tab (no hop to Transfer & Accept needed). Same
  // role/department check; an overdue (ON HOLD) hand-over is released by
  // accepting it, which still demands the hold reason.
  assert.match(app, /const cardCanAccept = !!h && h\.status === "pending" && !machine\.holdActive && canAcceptHandover\(canDo, h\.toDepartment\) && !!onAcceptHandover;/);
  assert.doesNotMatch(app, /const cardCanAccept = mtTab/);
  assert.match(app, /machineOverdue \? "✓ Accept · release from hold" : "✓ Accept Machine"/);
  assert.match(app, /data-card-accept=\{h\.id\}\n\s+onClick=\{\(\) => \{ if \(!acceptModal\) openAcceptModal\(h\); \}\}/);
  assert.match(app, /if \(!live \|\| live\.status !== "pending"\) \{ setAcceptModal\(null\); showToast\("Already accepted"/);
  // the Transfer & Accept section still offers its own button
  assert.match(app, /<button onClick=\{\(\) => openAcceptModal\(h\)\}/);
});

// 2026-10-31 — direct pending-job tracking from the machine card (same rows
// and actions as the Pending Jobs tab; the action modal keeps its busy guard
// and explicit confirmation).
test("App: Pending Jobs button on the card opens the shared job rows with existing actions", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  assert.match(app, /const renderJobGroup = \(m, list, key\) => \{/);
  assert.match(app, /\{renderJobBoard\(allJobsScoped, \{ detailsKey: "completed" \}\)\}/, "the Pending Jobs tab uses the shared board (parts / work / completed)");
  // 2026-11-01 — the same chip also carries the open-issue count
  assert.match(app, /data-card-jobs=\{machine\.id\} data-card-issues=\{machineOpenItems\.length \|\| undefined\}\s*\n\s*onClick=\{\(\) => setJobsDrawer\(machine\.id\)\}/);
  assert.match(app, /\{renderJobBoard\(all, \{ detailsKey: "drawer-completed" \}\)\}/, "the drawer uses the shared board");
  assert.match(app, /onClick=\{\(\) => setJobAction\(\{ item: p, action: "receive"/);
  assert.match(app, /onClick=\{\(\) => setJobAction\(\{ item: p, action: "complete"/);
  assert.match(app, /if \(jobAction\.busy\) return;/, "double submit guard kept");
});

// 2026-10-31 — Part received collects the Item Master verification for the
// item (critical serial per unit / critical checkbox / normal physical-receipt
// tick) before anything is recorded; the popup sits above the jobs drawer.
test("App: Part received asks for the item's configured verification and gates the save", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  assert.match(app, /const inputType = inv && inv\.isCritical && inv\.outwardInputType === "serial" \? "serial" : "checkbox";/);
  // a pending item the operator classified Critical is critical even when it is not in the Item Master
  assert.match(app, /const critical = !!\(inv && inv\.isCritical\) \|\| !!p\.critical;/);
  assert.match(app, /const receiveReady = !isReceive \|\| p\.receivedAt \|\| \(!qtyProblem && !serialProblem && \(critical && inputType === "serial" \? true : !!jobAction\.verified\)\);/);
  // 2026-11-03 — the refused save also turns the missing box red (flagMissing)
  assert.match(app, /if \(isReceive && !receiveReady\) \{ setJobAction\(\(prev\) => prev \? \{ \.\.\.prev, error: receiveWhy \} : prev\); flagMissing\(\); return; \}/);
  assert.match(app, /data-job-submit onClick=\{submit\} disabled=\{jobAction\.busy \|\| \(isReceive && !receiveReady\) \|\| remarkMissing \|\| partNotReceived\}/);
  assert.match(app, /await onReceivePendingItem\(p\.id, \{ qty: recvQty, notes: jobAction\.notes\.trim\(\), verification \}\)/);
  assert.match(app, /const handleReceivePendingItem = async \(id, \{ qty, notes, verification = null \}\) => \{/);
  // popup above the Pending Jobs drawer (z-66) and the rack panel (z-65)
  const i = app.indexOf("{jobAction && (() => {");
  assert.ok(/className="modal-backdrop fixed inset-0 z-\[96\]/.test(app.slice(i, i + 9000)), "job action modal is top-most");
  // the stylesheet's .modal-backdrop { z-index: 50 } outranks the utility, so the value must be inline
  assert.ok(/backdropFilter: "blur\(12px\)", zIndex: 96 \}/.test(app.slice(i, i + 9000)), "job action modal z-index is inline (beats .modal-backdrop z-index:50)");
});

// 2026-10-31 — compact team picker; any Settings employee may be Main.
test("App: compact team picker, non-login Main Employee, migration 050", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  const store = fs.readFileSync(path.join(root, "src/stores/handoverStore.js"), "utf8");
  // 2026-11-02 — Finish & Transfer no longer asks for / logs employee names
  // (the picker, "Main Employee" select and acting-main block are gone from the
  // popup). The transferer is the signed-in user, who signs; ACCEPT keeps its
  // own employee logging untouched.
  assert.doesNotMatch(app, /data-team-picker/);
  assert.doesNotMatch(app, /data-main-select/);
  assert.match(app, /mainEmployeeId: currentUser\.id,\n\s+mainEmployeeRef: currentUser\.id,/);
  assert.match(app, /workedBy:          \[\],             \/\/ Transfer logs no employee names/);
  assert.match(app, /acceptTeamMembers = reconcileTeam\(/, "Accept still logs its team");
  assert.doesNotMatch(app, /must have ERP login/, "no login-only restriction text");
  assert.match(store, /row\.main_employee_ref\s+= h\.mainEmployeeRef \|\| null;/);
  const up = fs.readFileSync(path.join(root, "supabase/migrations/050_handover_main_employee_ref.sql"), "utf8");
  assert.match(up, /ADD COLUMN IF NOT EXISTS main_employee_ref\s+text/);
  assert.doesNotMatch(up, /\b(DROP TABLE|TRUNCATE|DELETE FROM|ALTER POLICY|CREATE POLICY|DROP POLICY)\b/i);
});

// 2026-10-31 — Trial → Ready: only "I have checked this certificate" is
// required; incomplete certificates save and can be completed later. On Hold
// card and filter use the same machine list.
test("App: trial certificate confirmation-only gate, edit-later path, On Hold filter consistency", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  assert.match(app, /const incomplete = \[\];\n  if \(!String\(cert\.trialByName/);
  assert.match(app, /const missing = \[\];\n/, "nothing is mandatory on the certificate");
  assert.match(app, /data-cert-submit\n\s+disabled=\{busy \|\| !confirmed\}/);
  assert.match(app, /function TrialCertificateModal\(\{ machine, nowTick, workflow, busy, onClose, onSubmit, initialCert = null, editOnly = false, company = null \}\)/);
  assert.match(app, /onSubmit=\{trialCertModal\.editOnly \? saveTrialCertificate : submitTrialCertificate\}/);
  assert.match(app, /const handleUpdateTrialCertificate = async \(machineId, cert\) => \{/);
  assert.match(app, /data-cert-edit onClick=\{\(\) => setTrialCertModal\(\{ machine, editOnly: true \}\)\}/);
  // On Hold: the box counts the same list its click opens (Transfer & Accept,
  // hold filter), and clicking it again returns to all machines.
  assert.match(app, /\{ key: "hold",\s+tab: "transfer",\s+label: "On HOLD",\s+value: onHold\.length,/);
  assert.match(app, /mtTab === "transfer" \? \(filter === "hold" \? onHold : filter === "pendingAccept" \? pendingAccept : active\)/);
  assert.match(app, /h\.status === "pending" && \(h\.id === m\.pendingHandoverId \|\| String\(h\.machineId\) === String\(m\.id\)\)/);
});

// 2026-10-31 — Report Center: opened from the Machine Tracker top bar (no
// sidebar entry); seven reports; serial filter; Excel/CSV + PDF; settings for
// signature / stamp, page layout and displayed fields.
test("App: Report Center navigation, seven reports, filters, exports and settings", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  assert.doesNotMatch(app, /\{ id: "reports",\s+Icon: TrendingUp,\s+label: "Report Center"/, "no sidebar entry");
  assert.match(app, /data-open-reports onClick=\{\(\) => onNavigate\("reports"\)\}/, "Reports button on the Machine Tracker top bar");
  for (const id of ["factory", "owner", "department", "stuck", "machine", "monthly", "customer"]) assert.match(app, new RegExp(`\\{ id: "${id}",\\s+label: "`), `report tab ${id}`);
  assert.match(app, /const \[serialFilter, setSerialFilter\] = useState\(""\);/);
  assert.match(app, /data-filter-model/); assert.match(app, /data-filter-serial/);
  assert.match(app, /data-export-excel/); assert.match(app, /data-export-pdf/);
  assert.match(app, /const departmentRows = DEPARTMENT_SEQUENCE/); assert.match(app, /const monthlyRows = \(\(\) => \{/); assert.match(app, /const ownerRows = \(\(\) => \{/);
  assert.match(app, /signatureImage: "", signatureLabel: "Authorised Signatory", pageSize: "A4", orientation: "portrait"/);
  assert.match(app, /@page \{ size: \$\{rc\.pageSize \|\| "A4"\} \$\{rc\.orientation \|\| "portrait"\}; margin: 12mm; \}/);
  // 2026-11-01 — the issues section always prints ("none recorded" when empty)
  // so a reader can tell "no issues" from "section switched off".
  assert.match(app, /if \(show\.showPendingJobs === false\) return null;/);
  // customer PDF is printed / saved, never linked
  assert.doesNotMatch(app, /share(able)? link/i);
});

// 2026-10-31 — Admin Data Cleanup (migration 051) was an admin-only panel in
// Settings → Data & Backup that deleted test machines through the
// admin_cleanup_machines function.
// 2026-11-02 (migration 053, go-live) — DISABLED. The function is revoked for
// everyone; the panel stays mounted at the same gate but renders only the
// "Data Cleanup is disabled" notice: no keep-list, no preview, no password,
// no execute button, and no RPC call anywhere in the app.
test("App + migration 053: Admin Data Cleanup is disabled — notice only, no RPC path", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  // still mounted at the same admin gate, still wired (symbol kept for the regression inventory)
  assert.match(app, /\(isSuperAdmin \|\| canDo\("machines", "configDept"\)\) && \(\s*<AdminCleanupPanel machineLog=\{machineLog\} currentUser=\{currentUser\} onDone=\{onAdminCleanup\} \/>/);
  assert.match(app, /machineLog=\{machineLog\} onAdminCleanup=\{handleAdminCleanupDone\}/);
  assert.match(app, /function AdminCleanupPanel\(/);
  const panel = app.slice(app.indexOf("function AdminCleanupPanel("), app.indexOf("function SettingsPage("));
  assert.match(panel, /data-cleanup-disabled/);
  assert.match(panel, /Data Cleanup is disabled\./);
  // nothing in the panel can reach the database
  for (const forbidden of ["rpc(", "getSupabase", "reauthenticateByPassword", "functions.invoke", "fetch("])
    assert.ok(!panel.includes(forbidden), `panel never calls ${forbidden}`);
  for (const h of ["data-cleanup-preview", "data-cleanup-password", "data-cleanup-typed", "data-cleanup-execute", "data-cleanup-summary", "data-keep-all", "data-keep-none"])
    assert.doesNotMatch(app, new RegExp(h), `${h} control is gone`);
  // the function name appears nowhere in src/ except comments
  const srcDir = path.join(root, "src");
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const f of walk(srcDir).filter((f) => /\.(js|jsx)$/.test(f))) {
    const code = fs.readFileSync(f, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    assert.ok(!/admin_cleanup_machines/.test(code), `${path.relative(root, f)} does not call admin_cleanup_machines`);
  }
});

// 2026-10-31 — Machine Tracker redesign: four production stages ending at
// Ready (no "Completed" stage), three primary tabs with no duplicated summary
// box, a clearable filter chip so the On Hold card is self-explanatory, one
// card per machine with no repeated controls, and a cream/gold page scope.
test("App: Machine Tracker — Ready is the final stage, filters clear, cards are not duplicated", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  const css = fs.readFileSync(path.join(root, "src/index.css"), "utf8");

  // 1 — stages: Mechanical → Electrical → Trial → Ready, Ready last
  assert.match(app, /const DISPLAY_STAGES = \["Mechanical", "Electrical", "Trial", "Ready"\];/);
  assert.match(app, /const displayStageOf = \(m\) => \(m && m\.status === "completed" \? "Ready" : \(m && m\.stage\) \|\| ""\);/);
  assert.match(app, /const dispIdx = DISPLAY_STAGES\.indexOf\(dispStage\);/);
  assert.doesNotMatch(app, /"Completed":\s+"#15803d"/, "no Completed stage colour");
  // the machine card's "✓ Completed" stage badge is gone (the pending-job
  // chips of the same wording are a different thing and stay)
  assert.doesNotMatch(app, /border:"1px solid rgba\(34,197,94,0\.25\)" \}\}>\s*\n\s*✓ Completed/);
  // the status column itself is untouched — history and rack guards read it
  assert.match(app, /const isComplete = machine\.status === "completed";/);

  // 2 — the three screens are reached from the summary boxes; no tab row
  // the page-level tab row is gone (the Rack View panel keeps its own tabs)
  assert.doesNotMatch(app, /\{ id: "transfer",\s+label: "Transfer & Accept"/, "the Machine Tracker tab row is gone");
  assert.doesNotMatch(app, /\{ id: "pending",\s+label: "Pending Jobs"/);
  for (const [key, tab] of [["pendingAccept", "transfer"], ["hold", "transfer"], ["onRack", "production"],
                            ["active", "production"], ["completed", "production"], ["jobs", "pending"]])
    assert.match(app, new RegExp(`\\{ key: "${key}",\\s+tab: "${tab}",`), `${key} box opens ${tab}`);
  assert.match(app, /xl:grid-cols-6 gap-3" data-mt-nav/);
  assert.match(app, /\{ key: "completed",\s+tab: "production", label: "Ready",/);

  // 3 — On Hold (and every other card filter) toggles and can be cleared
  assert.match(app, /\{ key: "hold",\s+tab: "transfer",\s+label: "On HOLD",\s+value: onHold\.length,/);
  assert.match(app, /if \(isOn\) \{ setMtTab\("production"\); setFilter\("all"\); return; \}/);
  assert.match(app, /data-view-clear onClick=\{\(\) => \{ setMtTab\("production"\); setFilter\("all"\); \}\}/);
  assert.match(app, /const MT_FILTER_LABELS = \{[\s\S]*?hold: "On HOLD"/);

  // 4 — one card, no repeated actions; the working ones are all still there
  assert.match(app, /className=\{`mt-card overflow-hidden\$\{isComplete \? " mt-card-ready" : ""\}`\}/);
  assert.doesNotMatch(app, /jobs? owed\n/, "the owed badge no longer repeats the Pending Jobs button");
  assert.match(app, /\{!isComplete && machine\.trialCertificate && canFinishTransfer\(canDo\) && onUpdateTrialCertificate && \(/);
  for (const action of ["Report Issue", "Finish & Transfer →", "✓ Accept Machine", "data-card-jobs", "data-card-accept", '{isExpanded ? "Hide" : "History"}'])
    assert.ok(app.includes(action), `card keeps ${action}`);

  // 5/6 — premium scope and aligned header
  assert.match(app, /className="flex-1 overflow-y-auto mt-premium"/);
  // The tracker shares the ERP's palette (white cards, one set of hairlines);
  // only the card shell and the accent filter chips are its own.
  assert.match(css, /\.mt-premium \.mt-card \{[\s\S]*?background: var\(--surface-card\);/);
  assert.match(css, /\.mt-premium \.mt-chip \{/);
  assert.match(css, /--mt-gold:\s+#2E50D6;/);
  assert.match(css, /@media \(max-width: 640px\) \{[\s\S]*?\.mt-premium/);
  assert.match(app, /<Topbar title="Machine Tracker" subtitle="Mechanical → Electrical → Trial → Ready">/);
  assert.match(app, /data-open-reports[\s\S]{0,200}h-9 px-3 rounded-lg/);
  assert.match(app, /tabular-nums hidden sm:flex/, "clock visible from small screens up");
});

// 2026-11-01 — "+ Add Pending Item" at BOM Outward (migration 052). A part
// owed on a machine that is not a BOM line: an Item Master code or a name
// typed by hand, Critical or Normal, an optional part serial. It is raised as
// a pending job on the machine's serial, moves with it across departments,
// keeps its own history, and never touches stock or the Item Master.
test("App + migration 052: pending items added at BOM Outward", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  const sql = fs.readFileSync(path.join(root, "supabase/migrations/052_pending_item_outward.sql"), "utf8");
  const store = fs.readFileSync(path.join(root, "src/stores/pendingItemsStore.js"), "utf8");

  // 1 — the option exists in BOM Outward, and only where a machine exists
  assert.match(app, /data-add-pending-item onClick=\{\(\) => setExtraPending\(\[emptyPendingJob\(\)\]\)\}/);
  assert.match(app, /\{serialNo && !rackSet && \([\s\S]{0,400}?data-extra-pending/);
  assert.match(app, /<PendingJobRows rows=\{extraPending\} onChange=\{setExtraPending\} inventory=\{allFlat\}\s*\n\s*addLabel="\+ Add Pending Item" mode="item" \/>/);

  // 2/3 — Item Master code or a hand-typed name; Critical / Normal; part serial
  assert.match(app, /const emptyPendingJob = \(\) => \(\{ description: "", itemCode: "", itemName: "", qty: "", reason: "", critical: false, partSerialNo: "", criticalMode: "both" \}\);/);
  // 2026-11-02 — slim form: no item code / inventory list / reason / note in item mode
  const itemForm = app.slice(app.indexOf("data-pending-item-form>"), app.indexOf("{codes.length > 0 && ("));
  assert.match(itemForm, /Item name \*/);
  assert.match(itemForm, /Quantity \*/);
  assert.match(itemForm, /data-pending-item-save/);
  assert.doesNotMatch(itemForm, /Part \/ item code|Reason|Note \(optional\)|datalist|list=\{/);
  assert.match(app, /data-job-serial[\s\S]{0,200}?Part serial no\. \(optional\)/);
  assert.match(app, /data-job-critical=\{k\}/);
  assert.match(app, /critical: !!j\.critical,\s*\n\s*partSerialNo: \(j\.critical && critModeOf\(j\) === "checks"\) \? "" : \(j\.partSerialNo \|\| ""\)\.trim\(\),/);

  // 4 — raised against the machine, one job per row, carried to the store
  assert.match(app, /onCreateMachine\(data\.bomKey, data\.label, data\.serialNo, data\.date, id, data\.destination \|\| "rack", data\.deptDurations \|\| null, notIssued, data\.rackSlot \|\| null, data\.extraPending \|\| \[\]\)/);
  assert.match(app, /const raiseNotIssued = \(machineId\) => raiseNotIssuedJobs\(\{ machineId, notIssued, bomKey, serialNo, issueId, rackSlot, extraPending \}\);/);
  assert.match(app, /critical: !!j\.critical, partSerialNo: j\.partSerialNo \|\| "", source: "bom_outward",/);
  assert.match(app, /type: "pending_item_raised", module: "Machine",\s*\n\s*action: `\$\{j\.critical \? "Critical" : "Normal"\} pending item added at Outward/);
  assert.match(store, /if \(p\.critical !== undefined\)\s+row\.critical\s+= !!p\.critical;/);
  assert.match(store, /partSerialNo:\s+r\.part_serial_no \|\| "",/);
  // no Item Master write and no stock move on this path
  const raiseFn = app.slice(app.indexOf("const raiseNotIssuedJobs ="), app.indexOf("const handleCreateMachine ="));
  for (const forbidden of ["handleUpdateStock", "onUpdateBOM", "setItems", "stockMovement", "deductStock"])
    assert.ok(!raiseFn.includes(forbidden), `pending items never ${forbidden}`);

  // 5 — outstanding items stay visible once the machine is Ready
  assert.match(app, /data-job-after-ready[\s\S]{0,520}?still outstanding after Ready/);
  assert.match(app, /const allJobsScoped = \(pendingHandoverItems \|\| \[\]\)\s*\n\s*\.filter\(\(p\) => !scopeMine \|\| myDepartments\.includes\(p\.assignedDepartment\)\);/);
  assert.ok(!/allJobsScoped[\s\S]{0,200}status !== "completed"/.test(app), "the jobs list is not filtered by machine status");
  assert.match(app, /data-job-critical-chip/);

  // migration: additive only, no table or policy rewrite
  assert.match(sql, /ADD COLUMN IF NOT EXISTS critical\s+boolean NOT NULL DEFAULT false,/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS part_serial_no text,/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS source\s+text;/);
  for (const forbidden of [/DROP TABLE/, /DELETE FROM/, /TRUNCATE/, /CREATE POLICY/, /ALTER POLICY/, /DROP POLICY/])
    assert.doesNotMatch(sql, forbidden, `migration never ${forbidden}`);
});

// 2026-11-01 — one way in. The three top tabs are gone; the summary boxes are
// the navigation for every role, each box opening the screen where its bucket
// is worked. Accept lives on Transfer & Accept only, and Update Stage (an
// admin correction) is behind History instead of on every card.
test("App: Machine Tracker navigation is the summary boxes, for staff and admin alike", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");

  // no tab row; boxes carry all three destinations and are shown to every role
  assert.doesNotMatch(app, /\{ id: "production", label: "Production" \}/);
  assert.match(app, /data-mt-nav/);
  const nav = app.slice(app.indexOf("Summary boxes = the navigation"), app.indexOf("data-mt-nav") + 2000);
  // 2026-11-01 — the boxes are the admin tracker's navigation. Non-admins now
  // get the department dashboard (staffMode, see tests/staffMode.test.mjs),
  // so the boxes are gated by staffMode there — never by isFloorLogin.
  assert.ok(!/isFloorLogin/.test(nav.slice(0, nav.indexOf("data-mt-nav"))), "the nav is not hidden from a floor login");
  for (const tab of ["transfer", "production", "pending"]) assert.ok(nav.includes(`tab: "${tab}"`), `a box opens ${tab}`);

  // counts come from the same scoped lists the click opens
  assert.match(app, /value: pendingAccept\.length,/);
  assert.match(app, /value: onHold\.length,/);
  assert.match(app, /value: onRackMachines\.length,/);
  assert.match(app, /value: openJobsScoped\.length,/);

  // the box you are on takes you back to all machines
  assert.match(app, /const isOn = mtTab === c\.tab && \(c\.tab === "pending" \|\| filter === c\.key\);/);
  assert.match(app, /aria-current=\{isOn \? "page" : undefined\}/);
  assert.match(app, /data-view-header/);

  // Accept: on the card itself (2026-11-02), whichever tab shows it
  assert.match(app, /const cardCanAccept = !!h && h\.status === "pending" &&/);
  // Update Stage: admin-only AND behind History
  assert.match(app, /\{isExpanded && !isComplete && futureStages\.length > 0 && isAdminUser && canDo\("machines","updateStage"\)/);
  // untouched: Rack View and the actions the floor works with
  assert.match(app, /Production Rack View/);
  for (const keep of ["Report Issue", "Finish & Transfer →", "data-card-jobs", "data-open-reports", "✓ Accept Machine"])
    assert.ok(app.includes(keep), `${keep} still present`);
});

// 2026-11-01 — the rack crate face. Same squares, sizes, colours, names and
// layout; what is printed on them is now ordered (rack → state → machine →
// what is missing → what is next) and conditional on the rack's own state.
test("App: rack crate face is condition-aware and the panel is untouched", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  const css = fs.readFileSync(path.join(root, "src/index.css"), "utf8");
  const rackSlots = fs.readFileSync(path.join(root, "src/utils/rackSlots.js"), "utf8");
  const face = app.slice(app.indexOf("Crate face (2026-11-01)"), app.indexOf("Rack details panel"));

  // unchanged shell: same button, same crate classes, same name plate, same size
  assert.match(app, /className="rack-crate text-left rounded-xl p-2 pt-3\.5 relative focus-visible:ring-2"/);
  assert.match(app, /onClick=\{\(\) => setRackPanel\(sl\.id\)\}/);
  assert.match(css, /\.rack-crate \{[\s\S]*?min-height: 132px;/, "crate size unchanged");

  // one line per condition, and nothing from the production stage list
  assert.match(face, /sl\.status === "empty"\s+\? "Empty"/);
  assert.match(face, /\? \(short > 0 \? "Waiting for material" : "Ready for Assembly"\)/);
  assert.match(face, /: sl\.status === "assembling" \? "In assembly"/);
  assert.match(face, /: "Assembly complete"/);
  assert.doesNotMatch(face, /Mechanical → |DISPLAY_STAGES|Stage \{dispIdx/, "no production stages on a rack card");
  assert.doesNotMatch(face, /Ready for a BOM/, "the empty rack offers the action instead of a label");

  // assembly progress and missing parts, only where they belong
  assert.match(face, /sl\.status === "assembling" && \([\s\S]{0,420}?data-rack-progress="assembling"/);
  // 2026-11-01 (C3): measured bench time only — no fixed-width bar
  assert.match(face, /⏱ \{inAssemblyFor \|\| "just started"\} on the bench/);
  assert.doesNotMatch(app, /width: niN \? "60%" : "85%"/);
  assert.match(face, /\$\{niN\} part\$\{niN === 1 \? "" : "s"\} missing/);
  assert.match(face, /\(sl\.status === "set" \|\| sl\.status === "assembling"\) && \(/);

  // the two on-face actions call the same handlers, with the same permissions
  assert.match(face, /data-rack-fill=\{sl\.id\} onClick=\{faceFill\} disabled=\{!faceCanFill\}/);
  assert.match(face, /data-rack-send=\{sl\.id\} onClick=\{faceSend\}/);
  assert.match(app, /const faceCanFill  = !!faceFillChk && faceFillChk\.ok && canDo\("outward", "bom"\) && !!onFillRack;/);
  assert.match(app, /const faceCanSend  = !!faceHo && \(canDo\("machines", "release"\) \|\| isAdminUser\) && !!onReleaseHandover;/);
  assert.match(app, /const r = onFillRack\(sl\.id, rack\.bom\.primary\);/);
  assert.match(app, /const r = await onReleaseHandover\(faceHo\.id\);/);
  assert.match(face, /\{m \? \(/, "serial, progress and parts only when a machine is on the rack");
  assert.match(face, /→ Send to \{faceHo\.toDepartment\}/);

  // a machine that has left the rack for production frees it on sight
  assert.match(rackSlots, /const offRack = \(m\) => m && m\.rackSlot && \(/);
  assert.match(rackSlots, /\|\| \(m\.stage !== "BOM Issued" && m\.stage !== "Assembly"\)/);
  assert.match(rackSlots, /\|\| m\.status === "completed"\);/);

  // the details panel keeps every action it had
  for (const keep of ['data-action={b.key}', 'key: "fill", label: "＋ Fill Rack"', 'key: "assemble"', 'key: "send"',
                      'data-action="remove"', 'Rack details panel', 'rackPanelTab === "bom"', 'Stock Status'])
    assert.ok(app.includes(keep), `${keep} still present`);
});

// 2026-11-01 hotfix — the crate face runs bomFillCheck against the Item
// Master, so the lookup must live in the page's own scope, not inside the
// details-panel block where only the panel could see it. Referencing it from
// the face threw "itemByCode is not defined" and the whole page error-boundaried.
test("App: itemByCode is page-scoped, so the rack crate face can read stock", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  assert.equal((app.match(/const itemByCode\b/g) || []).length, 1, "exactly one definition");
  assert.match(app, /const itemByCode = useMemo\(\(\) => \{[\s\S]{0,260}?\}, \[items\]\);/);
  // defined before both readers: the crate face and the details panel
  const def = app.indexOf("const itemByCode = useMemo");
  assert.ok(def > 0 && def < app.indexOf("bomFillCheck(rack.bom.primary, bomDefs, (c) => itemByCode[c])"),
    "declared above the crate face that uses it");
  assert.equal((app.match(/bomFillCheck\(rack\.bom\.primary, bomDefs, \(c\) => itemByCode\[c\]\)/g) || []).length, 2,
    "both the face and the panel use the same lookup");
});

// 2026-11-01 — Pull Back from the rack details panel: the same modal, the same
// admin permission and the same handler as the Production card, which keeps
// its own button. Pull Back cancels a pending hand-over and locks nothing.
test("App: Pull Back is offered in the rack panel and on the card, with no lock", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  // rack panel
  assert.match(app, /\{ho && isAdminUser && onPullBackHandover && \(\s*<button type="button" data-action="pullback"/);
  assert.match(app, /onClick=\{\(\) => \{ setRackPanel\(null\); setPullBack\(\{ handover: ho, reason: "", busy: false, error: "" \}\); \}\}/);
  // the card keeps its button(s)
  assert.ok((app.match(/isAdminUser && onPullBackHandover && \(/g) || []).length >= 3, "card + transfer list + rack panel");
  // one modal, above the rack panel
  assert.equal((app.match(/\{pullBack && \(\(\) => \{/g) || []).length, 1);
  assert.match(app, /modal-backdrop fixed inset-0 z-\[72\][\s\S]{0,200}?!pullBack\.busy && setPullBack\(null\)/);
  // the handler cancels the hand-over and adds history; it sets no lock/hold flag
  const start = app.indexOf("const handlePullBackHandover");
  const fn = app.slice(start, app.indexOf("\n  const ", start + 10));
  assert.match(fn, /status: "cancelled"/);
  assert.match(fn, /pendingHandoverId: null/);
  assert.match(fn, /type: "handover_pulled_back"/);
  // wasOnHold is an audit fact about the past, not a state that blocks anything
  assert.doesNotMatch(fn.replace(/wasOnHold/g, ""), /locked|blocked|\bonHold:|\bhold:/i, "pull back sets no lock or hold");
});

// 2026-11-01 — the machine card shows one statement of progress (the stepper).
// The "Stage X of 4" chip, the % bar and the always-on Started line repeated
// it; Started/Ready dates live in the serial's tooltip and in History.
test("App: machine card carries no duplicate progress indicators", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  assert.doesNotMatch(app, /Stage \{dispIdx \+ 1\} of \{DISPLAY_STAGES\.length\}/);
  assert.doesNotMatch(app, /\{pct\}%<\/span>/);
  assert.doesNotMatch(app, /<span className="text-slate-500">due \{dueTxt\}<\/span>/);
  assert.match(app, /title=\{`Started \$\{machine\.createdDate\}/);
  assert.match(app, /· due \$\{dueTxt\}/, "due time kept in the timer tooltip");
  // the stepper, timer, delay and every action are still there
  for (const keep of ["DISPLAY_STAGES.map((stage, idx)", "DELAYED ${formatDuration(t.overrunMinutes)}", "paused — closed day",
                      "Report Issue", "Finish & Transfer →", "data-card-jobs", "data-cert-edit", '{isExpanded ? "Hide" : "History"}'])
    assert.ok(app.includes(keep), `${keep} still present`);
});

// 2026-11-01 — a company-level machine report reachable from the machine
// itself, and Machine Tracker popups that fit every screen with a way out.
test("App: machine report, reachable from the card, and popups that always close", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  const css = fs.readFileSync(path.join(root, "src/index.css"), "utf8");
  const rep = app.slice(app.indexOf("function AtoZMachineReport("), app.indexOf("function ReportCenterPage("));

  // report: letterhead, facts, at-a-glance, numbered sections, red open issues, sign-off
  // D1: sentence case, no capitals (2026-11-04: through the shared title block)
  assert.match(rep, /<RptTitleBlock title="Machine production report"/);
  assert.match(rep, /<div className="mr-doctitle rpt-doctitle"/);
  assert.match(rep, /getActiveCompany\(settings\)/);
  assert.match(rep, /data-report-glance/);
  // 2026-11-01 (D1–D10) — engineering-document layout; numbered sections
  for (const [n, t] of [["01", "Critical parts fitted"], ["02", "Department journey"], ["03", "Trial certificate and results"],
                        ["04", "Issues and pending jobs"], ["05", "Stage history"], ["06", "Attachments"], ["07", "Release sign-off"]])
    assert.match(rep, new RegExp(`n="${n}" title="${t}"`), `${n} ${t}`);
  assert.match(rep, /Appendix A · Checklist answers/);
  assert.match(rep, /const jobs = \[\.\.\.openJobs\.slice\(\)\.sort\(byTime\), \.\.\.resolvedJobs\.slice\(\)\.sort\(byTime\)\];/);
  assert.match(rep, /data-report-issue=\{open \? "open" : "resolved"\} className=\{`mr-issue \$\{open \? "is-open" : "is-done"\}`\}/);
  assert.match(rep, /<JobHistory item=\{p\} users=\{allUsers\} compact reportDates \/>/, "how and when each issue was resolved");
  // every evidence section is still composed, plus the checklist appendix
  for (const s of ["<Hdr />", "<CriticalParts />", "<Journey />", "<TrialCertificate />", "<PendingJobsHistory />", "<StageHistory />", "<AttachmentsList />", "<SignOff />", "<ChecklistAppendix />"])
    assert.ok(rep.includes(s), s);

  // reachable from the tracker: Ready card + History panel, full-screen viewer with Back / Print / Close
  assert.match(app, /data-card-report=\{machine\.id\} onClick=\{\(\) => setReportMachineId\(machine\.id\)\}/);
  assert.match(app, /data-history-report=\{machine\.id\} onClick=\{\(\) => setReportMachineId\(machine\.id\)\}/);
  assert.match(app, /data-report-back onClick=\{\(\) => setReportMachineId\(null\)\}/);
  assert.match(app, /data-report-print onClick=\{printMachineReport\}/);
  assert.match(app, /checklistResponses=\{checklistResponses\}\s*\n?\s*outwardLog=\{outwardLog\}/);
  assert.match(app, /machines:\s+<MachinePage\s+machineLog=\{machineLog\} checklistResponses=\{checklistResponses\}/);
  assert.match(css, /body\.print-machine-report \.mt-premium > :not\(\.mt-report-modal\) \{ display: none !important; \}/);

  // every tracker popup that lacked one now has a visible close, disabled while saving
  for (const close of ["setJobAction(null)} disabled={!!jobAction.busy}", "setFinishModal(null)} disabled={transferBusy}",
                       "setAcceptModal(null)} disabled={!!busy}", "setDuringWorkModal(null)} disabled={!!busy}",
                       "<ModalX onClose={() => setRemoveRackConfirm(null)} />", "<ModalX disabled={raiseBusy}"])
    assert.ok(app.includes(close), close);
  // Escape closes the top-most popup; declared after the last popup state it reads
  assert.ok(app.indexOf('if (e.key !== "Escape") return;') > app.indexOf("const [rackPanel, setRackPanel] = useState(null);"));
  // popups fit the screen and become bottom sheets on phones
  assert.match(css, /\.mt-premium \.modal-backdrop > div \{\s*max-height: calc\(100dvh - 24px\);\s*overflow-y: auto;/);
  assert.match(css, /@media \(max-width: 639\.98px\) \{\s*\.mt-premium \.modal-backdrop \{\s*align-items: flex-end !important;/);
});

// 2026-11-01 — machine report, engineering-document layout (D1–D10). The
// redesign must not drop anything the old report printed: every field below
// was on the previous version and must still be read here. Plus the A4 rules.
test("Machine report: every recorded field is still printed, and the A4 rules hold", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  const css = fs.readFileSync(path.join(root, "src/index.css"), "utf8");
  const rep = app.slice(app.indexOf("function AtoZMachineReport("), app.indexOf("function ReportCenterPage("));

  const mustRead = [
    // header + references
    "company.logo", "company.name", "company.address", "company.gst", "machine.serialNo", "machine.bomLabel",
    "machine.createdDate", "machine.completedDate", "machine.rackSlot", "machine.issueId", "reportRef",
    // critical parts
    "ci.notIssued", "ci.remark", "ci.serials", "ci.confirmed", "r.via", "r.when", "otherLines",
    // hand-overs
    "h.sentAt", "h.acceptedAt", "h.acceptTimeoutMinutes", "h.expectedDurationMinutes", "h.actualDurationMinutes",
    "h.overrunMinutes", "h.overrunNarration", "workerIdsOf(h)", "h.mainEmployeeId", "h.mainEmployeeSignatureSvg",
    "h.workedBySnapshot", "rating.rating", "h.sentBy", "h.acceptedBy",
    // checklists (all stages, every answer, remarks)
    "a.label", "a.checked", "a.required", "a.remark", "cr.templateName", "cr.templateVersion", "cr.submittedAt", "cr.submittedBy",
    "during_work",
    // issues
    "p.description", "p.itemCode", "p.itemName", "p.qty", "p.partSerialNo", "p.critical", "p.raisedInDepartment",
    "p.raisedAt", "p.assignedDepartment", "p.raisedInHandoverId", "<JobHistory item={p}",
    // trial certificate, stage history, attachments
    "<TrialCertificateSheet machine={machine} cert={machine.trialCertificate} embedded />", "h.stage", "h.note", "h.date",
    // 2026-11-04 — every captured signature, the Trial Certificate's included
    "h.acceptedSignatureSvg", "trialCertSignatureRows(machine", "c.trialBySignature", "c.checkBySignature", "c.trialByName", "c.checkByName",
    "a.name", "a.department", "a.createdAt",
  ];
  for (const f of mustRead) assert.ok(rep.includes(f), `report still reads ${f}`);
  // the Settings → Report Settings toggles still apply
  for (const t of ["show.showEmployees", "show.showChecklists", "show.showRatings", "show.showPendingJobs"]) assert.ok(rep.includes(t), t);

  // D10: one date style, durations in words, ratings as numbers
  // 2026-11-04 — one shared style for every report: "04 Nov 2026, 09:32" (24 h).
  assert.match(rep, /const fmtDT = rptFmtDT;/);
  assert.match(rep, /const rptFmtDT = .*\$\{rpt2\(d\.getHours\(\)\)\}:\$\{rpt2\(d\.getMinutes\(\)\)\}/);
  assert.match(rep, /\$\{dur\(h\.actualDurationMinutes\)\} of \$\{dur\(h\.expectedDurationMinutes\)\}/);
  assert.match(rep, /const rate = \(r\) =>/);
  assert.doesNotMatch(rep, /formatRatingBadge\(/, "no star badges");
  // D7: every captured signature at one size
  // 2026-11-02 — the signature is an <img> data URI (no markup injection); same box.
  assert.match(css, /\.mr-doc \.mr-sig svg, \.mr-doc \.mr-sig img \{ display: block; height: 30px; width: auto; max-width: 130px; \}/);

  // D8: A4, running header via a repeating thead, page numbers, clean breaks, PDF named after the reference
  assert.match(css, /@page machine-report \{\s*size: A4 portrait;/);
  assert.match(css, /@bottom-right \{ content: "Page " counter\(page\) " of " counter\(pages\);/);
  assert.match(css, /\.mr-doc \{ page: machine-report;/);
  assert.match(rep, /<thead><tr><td><div className="mr-runhead">/);
  // Pagination: no forced page breaks (they left pages 2 and 5 nearly empty);
  // headings stay with their content and blocks are kept whole instead.
  assert.doesNotMatch(css, /break-before: page/);
  assert.match(css, /\.mr-doc \.mr-appendix \{ margin-top: 16pt; padding-top: 8pt; border-top:/);
  assert.match(css, /\.mr-doc \.mr-sec > \.mr-h \+ \* \{ break-before: avoid;/);
  assert.match(css, /\.mr-doc \.mr-cert table, \.mr-doc \.mr-cert \.tc-note, \.mr-doc \.mr-cert \.tc-sigs \{ break-inside: avoid;/);
  assert.match(css, /\.mr-doc \.mr-check \{[^}]*break-inside: avoid;/);
  assert.match(css, /\.mr-doc \.mr-tr, \.mr-doc \.mr-issue, \.mr-doc \.mr-hop/);
  assert.match(app, /printWithTitle\(machineReportRef\(m\), \{ bodyClass: "print-machine-report" \}\)/);
  assert.match(app, /if \(tab === "machine"\) \{[\s\S]{0,500}?printWithTitle\(machineReportRef\(m\)\);/);

  // D9: the same sheet in Report Center, labelled rows on a phone
  assert.match(app, /<div className="mr-paper">\s*\n\s*<AtoZMachineReport/);
  assert.match(css, /\.mr-doc \.mr-td\[data-l\]::before \{ content: attr\(data-l\);/);
});
