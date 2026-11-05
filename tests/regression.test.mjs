// Static-shape regression tests for src/App.jsx.
//
// Why this file exists
// --------------------
// On 2026-07-19, commit 2b71bbc ("Fix critical stock/pending bugs; add
// Gemini-backed AI Assistant") silently removed 4,582 lines from
// src/App.jsx — wiping the entire BOM lifecycle, Production Rack View,
// Item CRUD wiring, PO default-rate feature, POSearchCenter, and ~20
// other operational-UI surfaces. The commit message mentioned only an
// ItemDetailModal fix + AI Assistant backend swap. All 102 of the other
// unit tests still passed because they test pure utilities (gst, auth,
// itemImport), not the integration surface in App.jsx. The regressed
// bundle shipped to production and was serving the broken UI for
// 2+ months before anyone noticed.
//
// What this file guards
// ---------------------
// If a change rips out a critical handler, nav item, audit event type,
// user-visible string, or page component from src/App.jsx, THIS SUITE
// FAILS LOUDLY. The CI job then blocks the merge.
//
// If a legitimate rename or refactor needs to update the inventory below,
// the author must update this file in the same PR — the inventory
// doubles as a sanctioned-changes checklist.
//
// Rules
// -----
//  * These are STATIC SHAPE checks (string / regex grep). They do NOT
//    import or evaluate App.jsx — React isn't available in Node.
//  * They catch wholesale deletion, not subtle bugs. Unit tests
//    (auth / gst / itemImport) catch logic bugs; this file catches
//    structural regressions.
//  * Keep the inventory conservative: add an entry only when you want
//    future deletions of that symbol to be blocked.

//
// 2026-11-04 — module-folder split. The code that lived in src/App.jsx now
// lives in src/app (shell), src/modules/<module> and src/shared (see
// docs/ARCHITECTURE.md). Every check below now scans ALL the screen code
// (APP_SRC = every file under src/app, src/modules, src/shared), so a symbol
// counts as present wherever it was moved to — but not if it only survives in
// a store/util comment.
// The inventory itself is unchanged. The size floors now apply to the
// split folders as a whole AND to every module folder separately.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { uiSource, srcFiles } from "./helpers/source.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, "..");
const APP_JSX   = resolve(ROOT, "src", "app", "App.jsx");
const BUILD_INFO = resolve(ROOT, "src", "shared", "buildInfo.js");
const MAIN_JSX  = resolve(ROOT, "src", "main.jsx");
const STORES    = resolve(ROOT, "src", "stores");
// The screen code — every .js/.jsx file under src/app, src/modules and src/shared
// (all of the former src/App.jsx, plus the old src/pages + src/components) — is
// the corpus the inventory is checked against. Stores / utils / auth are NOT
// included on purpose: a symbol removed from the UI must not be "found" in a
// store comment. (Store exports are checked separately below.)
const APP_SRC   = Symbol("screen code: src/app + src/modules + src/shared");
let uiCache = null;
function read(path) { return path === APP_SRC ? (uiCache ??= uiSource()) : readFileSync(path, "utf8"); }
function has(src, needle) { return src.includes(needle); }

// ─── File-size floor (first line of defense against mass deletion) ──────────

const SPLIT_DIRS = ["src/app", "src/modules", "src/shared"];
const splitFiles = () => SPLIT_DIRS.flatMap((d) => srcFiles(d));

test("regression: the former App.jsx code (src/app + src/modules + src/shared) is substantially populated (>= 10,000 lines)", () => {
  const lines = splitFiles().reduce((n, f) => n + read(resolve(ROOT, f)).split("\n").length, 0);
  assert.ok(
    lines >= 10000,
    `src/app + src/modules + src/shared shrank to ${lines} lines — expected >= 10,000. ` +
    `A sudden drop of this size has historically meant accidental ` +
    `wholesale deletion (see 2b71bbc post-mortem in CLAUDE.md).`
  );
});

test("regression: the former App.jsx code is not pathologically small on disk (>= 400 KB)", () => {
  const bytes = splitFiles().reduce((n, f) => n + statSync(resolve(ROOT, f)).size, 0);
  assert.ok(
    bytes >= 400 * 1024,
    `src/app + src/modules + src/shared is ${bytes} bytes — expected >= 400 KB.`
  );
});

// Per-folder floors (about half of each folder's size at the split). A module
// losing half its code in one change is the 2b71bbc pattern at module scale.
const FOLDER_FLOORS = {
  "src/app": 2500,
  "src/shared": 1500,
  "src/modules/machine-tracker": 3000,
  "src/modules/trial-certificate": 400,
  "src/modules/inventory": 2000,
  "src/modules/bom": 1200,
  "src/modules/purchase": 1500,
  "src/modules/reports": 1500,
  "src/modules/settings": 600,
  "src/modules/whatsapp": 900,
  "src/modules/dashboard": 250,
  "src/modules/analytics": 100,
  "src/modules/ai-assistant": 100,
  "src/modules/pending-jobs": 150,
  "src/modules/audit-trail": 200,
  "src/modules/users-roles": 500,
};
for (const [dir, floor] of Object.entries(FOLDER_FLOORS)) {
  test(`regression: ${dir} is substantially populated (>= ${floor} lines)`, () => {
    const lines = srcFiles(dir).reduce((n, f) => n + read(resolve(ROOT, f)).split("\n").length, 0);
    assert.ok(lines >= floor, `${dir} shrank to ${lines} lines — expected >= ${floor}.`);
  });
}

test("regression: src/app/App.jsx (state wiring + handlers) is substantially populated (>= 2,000 lines)", () => {
  const lines = read(APP_JSX).split("\n").length;
  assert.ok(lines >= 2000, `src/app/App.jsx shrank to ${lines} lines — expected >= 2,000.`);
});

test("regression: every module folder has index.js (public exports) and README.md", () => {
  for (const dir of Object.keys(FOLDER_FLOORS).filter((d) => d.startsWith("src/modules/"))) {
    assert.ok(existsSync(resolve(ROOT, dir, "index.js")), `${dir}/index.js missing`);
    assert.ok(existsSync(resolve(ROOT, dir, "README.md")), `${dir}/README.md missing`);
  }
});

// ─── Top-level App-root handlers (BOM / Rack / Machine / Item / PO) ─────────

const APP_HANDLERS = [
  // Go-live module on/off switch (Settings → Modules)
  "handleSaveModules",
  // BOM lifecycle
  "handleCreateBOM",
  "handleDuplicateBOM",
  "handleRenameBOM",
  "handleDeleteBOM",
  "computeBOMDeletionInfo",
  "handleUpdateBOM",

  // Machine / production flow
  "handleCreateMachine",
  "handleUpdateMachineStage",
  "handleStartProduction",
  "handleRemoveRackMachine",

  // Item CRUD
  "handleCreateItemRow",
  "handleUpdateItemRow",
  "handleDeleteItemRow",
  "handleBulkAddItems",
  "handleUpdateStock",

  // PO lifecycle
  "handleCreatePO",
  "handleUpdatePO",
  "handleReceivePO",
  "handleDeletePO",
  "handleReverseReceive",
  "handleSetItemDefaultRate",

  // Vendor
  "handleAddVendor",
  "handleEditVendor",
  "handleDeleteVendor",
  "handleBulkAddVendors",

  // Inward / Outward / Pending
  "handleAddOutward",
  "handleInwardComplete",
  "handleFulfillPending",
  "handleFulfillGroup",
  "handleClearPending",

  // Settings / audit / followups
  "handleSaveSettings",
  "handleConfirmOrder",
  "handleFollowUpDone",

  // Phase A — Department Workflow
  "handleFinishTransfer",
  "handleAcceptHandover",
  "handleRegisterSignature",
  // Phase B — Checklists / Pending items / Attachments / Ratings
  "handleCreateChecklistTemplate",
  "handleUpdateChecklistTemplate",
  "handleDeleteChecklistTemplate",
  // 2026-11-05 — BOM screen → Checklists (one BOM's own list, point by point).
  "handleSaveBomChecklist",
  "handleResolvePendingItem",
  "handleUploadAttachment",
  "handleDeleteAttachment",
  "handleOverrideRating",
];

for (const name of APP_HANDLERS) {
  test(`regression: src/ still defines ${name}`, () => {
    const src = read(APP_SRC);
    const re = new RegExp(`const\\s+${name}\\s*=`);
    assert.ok(
      re.test(src),
      `App.jsx no longer defines ${name}. If this was intentional, ` +
      `remove the entry from APP_HANDLERS in tests/regression.test.mjs.`
    );
  });
}

// ─── Page components ────────────────────────────────────────────────────────

const PAGE_COMPONENTS = [
  "ModulesPanel",
  "DashboardPage",
  "InventoryPage",
  "InwardPage",
  "OutwardPage",
  "PendingPage",
  "OrderPipelinePage",
  "MachinePage",
  "VendorsPage",
  "AnalyticsPage",
  "AIPage",
  "HistoryPage",
  "SettingsPage",
  "BOMDrawer",
  "ItemDetailModal",
  "POModal",
  "POSearchCenter",

  // Phase A — Signature Pad component (module-scope). Protects against the
  // Finish & Transfer / Accept modals losing their signature capture surface.
  "SignaturePad",
  // Phase B / Phase C
  "AttachmentLink",
  "ChecklistAdminPanel",
  "BomChecklistsPanel",
  "ReportCenterPage",
  "WhatsAppPage",
  "ReportKPI",
  "ReportTable",
  // BOM "Paste from Excel" — the bulk add-component surface shared by
  // BOMDrawer Edit and the Create BOM modal. Losing it silently sends the
  // operator back to adding forty BOM lines one at a time.
  "BOMPasteLines",
  // 2026-11-03 — the four PDF reports (Company full = AtoZMachineReport).
  "AtoZMachineReport",
  "CustomerMachineReport",
  "OnHoldReport",
  "PendingJobsReport",
  "ReportSheet",
];

for (const name of PAGE_COMPONENTS) {
  test(`regression: src/ still defines ${name}`, () => {
    const src = read(APP_SRC);
    const re = new RegExp(`function\\s+${name}\\b`);
    assert.ok(re.test(src), `App.jsx no longer defines ${name}.`);
  });
}

// ─── Navigation items (sidebar must list all 15 ERP modules) ────────────────

const NAV_IDS = [
  "dashboard", "inventory", "inward", "outward", "pending",
  "pipeline",  "machines",  "vendors", "analytics",
  "ai", "whatsapp", "history", "audit", "settings", "users", "roles",
];

test("regression: sidebar navItems contains all 16 modules", () => {
  const src = read(APP_SRC);
  // Scoped grep: must appear inside the navItems array definition.
  const navBlock = src.match(/const navItems\s*=\s*\[([\s\S]*?)\n\];/);
  assert.ok(navBlock, "navItems array not found in App.jsx");
  for (const id of NAV_IDS) {
    const re = new RegExp(`id:\\s*["']${id}["']`);
    assert.ok(re.test(navBlock[1]), `navItems missing module id="${id}"`);
  }
});

// ─── Audit event types (business-event taxonomy) ────────────────────────────
// These strings travel into Supabase audit_log and into History/Reports.
// Removing one silently drops a whole class of event from the audit trail.

const AUDIT_EVENT_TYPES = [
  "bom_created", "bom_duplicated", "bom_renamed", "bom_deleted",
  "machine_created", "machine_stage", "machine_completed", "production_started",
  "pending_fulfilled",
  "po_created", "po_received", "po_deleted", "po_deleted_received",
  "inward_manual",
  // Added by the full-system-check audit — item master-data mutations and
  // company settings changes now emit audit events too.
  "item_created", "item_updated", "item_deleted",
  "settings_updated",
  // Go-live — Settings → Modules on/off (super admin).
  "modules_changed",
  // Phase A — Department Workflow handover events.
  "handover_sent", "handover_accepted", "handover_overrun_narrated",
  "signature_registered",
  // Phase B — checklists / pending items / attachments / ratings
  "checklist_template_created", "checklist_template_updated", "checklist_template_deleted",
  "machine_hold_set", "machine_hold_released", "machine_deleted", "pending_item_raised", "pending_item_resolved", "pending_item_received", "pending_item_completed_on_receipt", "pending_item_issued", "acting_main_assigned", "handover_pulled_back",
  // Migration 036 — a production head releases a machine off the rack.
  "handover_released",
  // Migration 045 — rack slots (brief §14).
  "rack_slot_assigned", "rack_slot_released", "rack_crate_filled", "trial_certificate_updated", "admin_cleanup",
  // 2026-11-02 — BOM issue aborted after the machine row was created (stock refused).
  "machine_issue_aborted",
  "attachment_uploaded", "attachment_deleted",
  "department_rated", "rating_overridden",
  // Migration 028 — BOM-wise reusable checklist submission audit split by stage.
  // Replaces the generic "checklist_submitted" string with three stage-specific
  // event types so Reports can filter the Checklist History tab precisely.
  "checklist_submitted_finish", "checklist_submitted_accept", "checklist_submitted_during_work",
  // 2026-11-03 — Assembly "Before Starting Work" checklist at rack Assemble.
  "checklist_submitted_assembly_start",
  // 2026-11-05 — BOM screen → Checklists edits (add / edit / remove / reorder / copy).
  "bom_checklist_changed",
  // Migration 029 — department-employees admin audit.
  "user_departments_updated",
];

for (const type of AUDIT_EVENT_TYPES) {
  test(`regression: audit event type "${type}" still emitted`, () => {
    const src = read(APP_SRC);
    assert.ok(
      has(src, `"${type}"`),
      `Audit event type "${type}" is no longer emitted anywhere in App.jsx.`
    );
  });
}

// ─── User-visible strings (minification-safe markers for live-bundle checks) ─

const USER_FACING_STRINGS = [
  // Rack / destination flow
  "Save To Rack",
  "Direct Production",
  "Production Rack View",
  // "Edit Rack Capacity" / "Delete Rack" removed 2026-10-30: racks are the
  // fixed floor racks only, never created or sized per BOM.
  "Remove from rack",
  "Rack is full",

  // Pending actions
  "Issue All Available",
  "Give All",
  "Give Material",

  // Inventory
  "Add Stock",
  "Remove Stock",

  // Build marker (keeps post-deploy verification working)
  "APP_BUILD",

  // Phase A — Department Workflow
  "Finish & Transfer",
  "Awaiting accept",
  "Accept into",
  "Department Workflow Settings",
  "Acceptance timeout",
  "Per-department work time limits",
  "Delay reason",
  // Phase B — Checklists / Pending items / Attachments / Ratings
  "Department Checklists",
  "Pending Handover Items",
  "Attachments",
  // 2026-10-30 — pending jobs: part received → work completed (replaces "Mark resolved")
  "Work completed", "Part received", "Pending Jobs", "Cannot be Ready",
  "Pending Acceptance",
  "Acting Main Employee", "Delay reason (required)",
  // 2026-10-30 — calendar, pull back, on-hold reason, voice languages, report settings
  "Working calendar", "+ Add holiday", "Pull back", "Reason for late acceptance",
  // 2026-11-03 (owner) — "Speak in:" language chips removed on purpose: no
  // language picker anywhere; server transcription detects the language.
  "Report Settings", "PDF / print language", "Receive remark / reason",
  "Customer Progress Report",
  // Machine Tracker UX pass
  "Pending Acceptance",
  "Accept Machine",
  "ON HOLD",
  "On HOLD",
  "Add Checklist",
  "Add Question",
  "Save Checklist",
  "Checklist Questions",
  // Easier-ops UX pass (2026-10-19)
  "Overdue",
  "Confirm Acceptance",
  "Transfer rules",
  "Require password re-entry at Accept Machine",
  "⚙️ Settings",
  // Phase C — Report Center
  "Report Center",
  // 2026-10-29 — nine tabs became four. Delay-wise / HOLD-wise / Pending-wise
  // / Rating-wise were four views of one question (where is production losing
  // time) and are now four tables stacked under "Where it sticks"; their
  // table titles are asserted below instead of the old tab labels. Nothing was
  // removed from the page — only the labels changed.
  "Where it sticks",
  "Took longer than allowed",
  "Accepted late",
  "Issues raised and still open",
  "Department ratings",
  "Factory",
  "Save as PDF",
  // Critical Item (migration 026)
  "Critical Item",
  "Outward Input Type",
  "Checkbox Confirmation",
  "Serial Number Entry",
  "Critical Item Confirmation",
  // Dedicated BOM-Outward popup — modal footer + per-unit prompt
  "Confirm Outward",
  "Enter one unique serial number per unit",
  // Pending Stock Confirmation popup (2026-10-20)
  "Pending Stock Confirmation",
  "Confirm & Issue",
  // Department Durations popup (migration 027, 2026-10-20)
  "Department Durations",
  "Save Durations & Continue",
  "Locked after Outward",
  // BOM Checklist Builder (migration 028, 2026-10-21)
  "Department Checklists (optional)",
  "After Acceptance",
  "During Work",
  "Before Transfer",
  "During-Work Checks",
  "Save Checklist",
  "+ Add Step",
  "Must do",
  // Department-Employees + Main Employee signature (migration 029, 2026-10-22)
  "Department Employees",
  "Main / Responsible Employee",
  "Main Employee signature",
  // 2026-10-31 — compact one-row team picker replaced "Workers from" /
  // "+ Add ERP user" / "+ Add factory worker"; the card shows "Team per department".
  "Main / Responsible Employee",
  // 2026-11-02 — "Working employees" left the Transfer popup on purpose (no employee names at Transfer).
  "Quantity received now",
  "Team per department",
  "Admin Data Cleanup",
  // 2026-11-02 — cleanup disabled for go-live; "Preview deletion" is gone on purpose.
  "Data Cleanup is disabled.",
  // BOM Edit — Checklist + Critical Items review chips (2026-10-22)
  "Critical Items in this BOM",
  "Department Checklists for ",
  "Open Inventory to edit",
  // 2026-11-05 — BOM screen → Checklists + Settings switched-off fold.
  "Make a list for this BOM",
  "Copy to other BOMs…",
  "Before receive",
  "Before transfer",
  "Switched off (",
  // A-to-Z Machine Report (2026-10-23). The tab that opens it is now labelled
  // "One machine"; the report's own heading is unchanged.
  "A-to-Z Machine Report",
  "One machine",
  // 2026-11-01 — formal, numbered report section titles
  "Department journey",
  "Stage History",
  // 2026-10-29 report rework. "BOM Components" and "Materials Issued" were
  // deliberately removed: the full BOM already lives on the BOM screen, and
  // reprinting every line made the report long without making it more useful.
  // They are replaced by one audited section plus the trial certificate, which
  // the report never showed at all. These assertions take their place so the
  // sections cannot quietly disappear the way the old ones were meant not to.
  // 2026-10-29 — BOM issue guards. A confirmed critical line committing as
  // zero silently filed a Pending Stock shortfall for a part that was on the
  // shelf, and the outward log recorded three of four items. These three
  // assertions pin the guard, the wheel-blur on the quantity box, and the
  // stock-rejection channel so none of them can be quietly dropped.
  "but the quantity to issue is now 0",
  "onWheel",
  "did not leave stores",
  "Critical parts fitted",
  "Serial numbers / verification",
  "Given later from Pending Stock",
  "Material arrived",
  "Machine Trial Certificate",
  // Feature 1 — Responsive modals (2026-10-27)
  "Finish & Transfer",
  // Feature 2 — Serial number protection (2026-10-27)
  "Already issued",
  "Duplicate in list",
  // Feature 3 — Employee Members (2026-10-27)
  "Employee Members",
  "Manage display names for factory workers",
  "Add Employee",
  "Active (appears in dropdowns)",
  // Feature 4 — Transfer multi-select (2026-10-27)
  "factory workers without ERP logins",
  // Feature 5 — Accept multi-select (2026-10-27)
  "Receiving employees",
  "accept-side team",
  // Machine Tracker Settings page (2026-10-27)
  "Machine Tracker Settings",
  "machines_settings",
  // Migration 032 — Trial Certificate (2026-10-27)
  "Machine Trial Certificate",
  "Khakhra Mode",
  "Bhakhri Mode",
  "Check Points",
  "Trial By",
  "Check By Service Engineer",
  "Electrical Load",
  "trialCertificate",
  // Trial Certificate preview step (2026-10-27)
  "Preview Certificate",
  // BOM "Paste from Excel" (2026-10-29). The bulk add-component path in both
  // BOM editors: chip → textarea → preview → commit. Each string below is one
  // of the three things the preview has to be able to tell the operator
  // (lines that will be added, rows that matched no item, rows with a bad
  // quantity) or the copy that explains the accepted paste format. Deleting
  // any of them would leave the paste flow silently unexplained.
  "Paste from Excel",
  "A header row is skipped.",
  "ready to add",
  "already in this BOM",
  "merged from rows",
  "Nothing to add from this paste.",
  "Not found in Item Master",
  "Correct the code in Excel and paste again.",
  "Bad quantity (",
  "Quantity must be more than 0.",
  // 2026-11-03 — voice notes (🎤 Record) in Machine Tracker
  "🎤 Voice note",
  // 2026-11-04 (owner) — the 🎤 writes text only: "Recording… " became
  // "Listening… "; the saved-note Remove ("Are you sure? Remove this voice
  // note?") went with the audio. Old notes still play (VoicePlayButton).
  "Listening… ",
  "tidySpoken(",
  "appendSpoken(",
  // 2026-11-03 — browser live dictation inside the recorder was dropped (it
  // needed a language choice); "Typing by voice not supported…" went with it.
  "VoiceNoteRecorder",
  "VoicePlayButton",
  "data-staff-voice",
  // 2026-11-03 — voice notes always become text (server transcription)
  "transcribeVoice(",
  "VOICE_WRITING_TEXT",
  "VOICE_WRITE_PROMPT",
  "data-voice-writing",
  // 2026-11-03 — compact checklists (✕ Not done → reason box) + small in-box mic
  "ChecklistRows",
  "flagChecklist(",
  "data-check-no",
  "data-check-reason",
  "Why not done?",
  "Must do",
  "data-voice-record",
  "data-voice-stop",
];

for (const s of USER_FACING_STRINGS) {
  test(`regression: user-visible string "${s}" present in App.jsx`, () => {
    const src = read(APP_SRC);
    assert.ok(has(src, s), `User-visible string "${s}" removed from App.jsx.`);
  });
}

// ─── Store exports (persistence API surface) ────────────────────────────────

const STORE_SURFACE = [
  // bomsStore
  { file: "bomsStore.js",    exports: ["fetchBOMs", "createBOM", "updateBOM", "renameBOM", "deleteBOM"] },
  // machinesStore
  { file: "machinesStore.js",exports: ["fetchMachines", "createMachine", "updateMachine", "updateMachineBomKey", "deleteMachine", "appendMachineHistory", "STALE_MACHINE_MSG"] },
  // itemsStore
  { file: "itemsStore.js",   exports: ["fetchItems", "createItem", "updateItem", "deleteItem", "updateStockAndHistory", "addItemHistory"] },
  // posStore
  { file: "posStore.js",     exports: ["fetchPOs", "createPO", "updatePO", "deletePO"] },
  // inwardStore
  { file: "inwardStore.js",  exports: ["fetchInward", "createInward", "bulkCreateInward", "deleteInwardByPO"] },
  // outwardStore
  { file: "outwardStore.js", exports: ["fetchOutward", "createOutward", "updateOutwardRef", "deleteOutwardByIssueId"] },
  // pendingStore
  { file: "pendingStore.js", exports: ["fetchPending", "bulkCreatePending", "updatePending", "deletePending", "clearAllPending", "updatePendingBomKey"] },
  // vendorsStore
  { file: "vendorsStore.js", exports: ["listVendors", "createVendor", "updateVendor", "deleteVendor", "archiveVendor", "bulkCreateVendors"] },
  // followupsStore
  { file: "followupsStore.js", exports: ["fetchFollowUps", "createFollowUp", "updateFollowUp", "deleteFollowUpsByPO"] },
  // settingsStore
  { file: "settingsStore.js", exports: ["loadSettings", "saveSettings"] },
  // Phase A stores
  { file: "handoverStore.js",   exports: ["fetchHandovers", "fetchPendingHandovers", "createHandover", "acceptHandover", "cancelHandover", "adminCancelHandover", "fetchHandoverById"] },
  { file: "signaturesStore.js", exports: ["getMySignature", "saveMySignature", "reauthenticateByPassword"] },
  // Phase B stores
  { file: "checklistsStore.js",   exports: ["fetchTemplates", "createTemplate", "updateTemplate", "deleteTemplate", "fetchResponses", "createResponse"] },
  { file: "pendingItemsStore.js", exports: ["fetchPendingItems", "createPendingItem", "resolvePendingItem", "receivePendingItem", "pendingItemStage"] },
  { file: "attachmentsStore.js",  exports: ["fetchAllAttachments", "fetchAttachmentsForMachine", "uploadAttachment", "signedUrlFor", "deleteAttachment", "inferKind"] },
  { file: "ratingsStore.js",      exports: ["fetchRatings", "createRating", "overrideRating"] },
];

for (const { file, exports: names } of STORE_SURFACE) {
  for (const name of names) {
    test(`regression: ${file} exports ${name}`, () => {
      const src = read(resolve(STORES, file));
      const re = new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${name}\\b`);
      assert.ok(re.test(src), `${file} no longer exports ${name}.`);
    });
  }
}

// ─── BOM "Paste from Excel" wiring ──────────────────────────────────────────
// The parser is unit-tested separately in tests/bomPaste.test.mjs. These
// checks guard the wiring, which no unit test can see: App.jsx must still
// import the parser, both BOM editors must still own a commit handler, and
// the shared preview component must still be mounted in both of them.

test("regression: the ERP imports the BOM paste parser", () => {
  const src = read(APP_SRC);
  assert.ok(
    /import\s*\{[^}]*parseBomPaste[^}]*\}\s*from\s*["'](?:\.{1,2}\/)+utils\/bomPaste\.js["']/.test(src),
    "No source file imports parseBomPaste from utils/bomPaste.js any more — the BOM Paste-from-Excel flow is dead."
  );
});

for (const name of ["applyPastedBOMLines", "applyPastedCreateItems"]) {
  test(`regression: src/ still defines ${name}`, () => {
    const src = read(APP_SRC);
    assert.ok(
      new RegExp(`const\\s+${name}\\s*=`).test(src),
      `App.jsx no longer defines ${name} — a pasted BOM block would have nowhere to commit to.`
    );
  });
}

test("regression: BOMPasteLines is mounted in both BOM editors", () => {
  const src = read(APP_SRC);
  const mounts = src.match(/<BOMPasteLines\b/g) || [];
  assert.ok(
    mounts.length >= 2,
    `<BOMPasteLines> is mounted ${mounts.length} time(s) — expected at least 2 ` +
    `(BOMDrawer Edit mode + the Create BOM modal).`
  );
});

// ─── Auth imports (prevent silent-lockout regression recurrence) ────────────

test("regression: App.jsx reads full useAuth contract (lockout retry screen)", () => {
  const src = read(APP_SRC);
  // The 8a2669b fix depends on these being destructured from useAuth().
  for (const prop of ["isLoading", "authLoadError", "retryAuthLoad", "supabaseMode"]) {
    assert.ok(has(src, prop), `App.jsx no longer destructures ${prop} from useAuth(); the silent-lockout retry screen will be dead.`);
  }
});

// ─── Bug-regression guards (specific crash patterns that must not return) ───

test("regression: chipName() is never called with a user object (xe.startsWith crash)", () => {
  // Bug introduced 2026-10-27: chipName(mainUser) passed a user object instead
  // of the ID string, crashing with "xe.startsWith is not a function" the moment
  // a worker was auto-selected in the Finish & Transfer modal. Fix: chipName(mainId).
  const src = read(APP_SRC);
  assert.ok(
    !has(src, "chipName(mainUser)"),
    "chipName(mainUser) is back in App.jsx — this passes a user OBJECT to a function " +
    "that calls id.startsWith(), causing a TypeError crash in the Finish & Transfer modal. " +
    "Call chipName(mainId) instead."
  );
});

// ─── Build marker invariant (deploys stay observable) ───────────────────────

test("regression: APP_BUILD / APP_BUILD_TAG match (deploy-marker consistency)", () => {
  const app  = read(BUILD_INFO);
  const main = read(MAIN_JSX);
  const appTag  = app.match(/APP_BUILD\s*=\s*"([^"]+)"/);
  const mainTag = main.match(/APP_BUILD_TAG\s*=\s*"([^"]+)"/);
  assert.ok(appTag,  "APP_BUILD constant missing from src/shared/buildInfo.js");
  assert.ok(mainTag, "APP_BUILD_TAG constant missing from main.jsx");
  assert.equal(
    appTag[1], mainTag[1],
    `APP_BUILD ("${appTag[1]}") and APP_BUILD_TAG ("${mainTag[1]}") disagree. ` +
    `Both must be bumped together so Settings badge and console banner stay in sync.`
  );
});

// 2026-11-02 — Cobalt Ink design system. One cool-neutral palette for every
// module: soft blue-grey paper, white cards, deep-ink rail, a single cobalt
// accent. Red is reserved for danger/critical; status colours and the rack
// model colours are untouched, and printed reports stay white.
test("theme: cobalt ink design system is the last word in index.css", () => {
  const css = read("src/index.css");
  const theme = css.slice(css.indexOf("COBALT INK"));
  assert.ok(theme.length > 1500, "the cobalt block is present");
  assert.match(theme, /--surface-page:\s+#F4F6FA;/);
  assert.match(theme, /--surface-card:\s+#ffffff;/);
  assert.match(theme, /--border-subtle:\s+rgba\(15, 23, 42, 0\.09\);/);
  assert.match(theme, /--text-dim:\s+#46516A;/);
  for (const u of ["\\.bg-slate-50", "\\.bg-slate-100", "\\.border-slate-200", "\\.text-slate-500", "\\.text-slate-600"])
    assert.match(theme, new RegExp(u + "\\s"), u);
  assert.doesNotMatch(theme, /\.text-slate-(100|200|300)\s/, "light text on dark surfaces is untouched");
  assert.doesNotMatch(theme, /^\.bg-white\s*\{/m, "cards stay pure white");
  // the old golden palette is gone
  assert.doesNotMatch(css, /champagne|--mt-gold:\s+#A8842C|#F8F4EA/i, "no champagne / gold surface left");
  // brand is cobalt, not red
  assert.match(css, /--brand:\s+#2E50D6;/);
  // reports print on white paper
  assert.match(theme, /@media print \{[\s\S]*?background-image: none !important;/);
});
