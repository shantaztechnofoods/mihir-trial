// src/modules/bom/BOMDrawer.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useMemo } from "react";
import { LeadIcon, Glyph } from "../../shared/components/LeadIcon.jsx";
import ItemSearchSelect from "../../shared/components/ItemSearchSelect.jsx";
import { receivedPoRates, bomCostLines, bomCostSummary, validateBomLines, formatINR } from "../../utils/bomCost.js";
import { rackCapacityFor, slotLabel } from "../../utils/rackSlots.js";
import { BomChecklistSlots } from "./BomChecklistSlots.jsx";
import { BomCostPanel } from "./BomCostPanel.jsx";
import { CHECKLIST_DEPTS, bomHasAllDurations, durationsFormFrom, durationsStoreFrom, validateDurationsForm } from "./bomDurations.js";
import { BomPhotoField, DeptDurationFields, RackStatusNote } from "./BomFields.jsx";
import { BomLineCheckPointsModal } from "./BomLineCheckPointsModal.jsx";
import { BOMPasteLines } from "./BOMPasteLines.jsx";
import { PendingJobRows, cleanPendingJobs, emptyPendingJob, normalizePendingJob } from "../pending-jobs/index.js";
import { fmtDate, roundQty } from "../../shared/format.js";
import { OrgStep } from "../../shared/ui/OrgLayout.jsx";
import { Btn } from "../../shared/ui/primitives.jsx";

export function BOMDrawer({ bomKey, bom, units, onUnitsChange, items, handleUpdateStock, onClose, onIssue, onCreateMachineFirst = null, onAbortMachine = null, onUpdateBOM, onRenameBOM, allBomKeys = [], onAfterRename, serialNo = "", rackReady = 0, settings = {}, checklistTemplates = [], onCreateChecklistTemplate, onUpdateChecklistTemplate, onDeleteChecklistTemplate, canConfigChecklist = false,
  // Feature 2 — Req 2: history of outward issues for serial-number deduplication.
  outwardLog = [],
  // 2026-10-22 — navigate to another page (e.g. Inventory from the Critical
  // Items review). Optional; falls back to a no-op so BOMDrawer still works
  // when the host page doesn't wire it in.
  onNavigate = () => {},
  // Called when a stock movement is rejected during the issue commit. The
  // drawer has already closed by then, so the message has to go somewhere that
  // outlives it — the persistent save-error banner on the app shell.
  onStockIssueFailed = () => {},
  // 2026-10-31 — cost & rates panel (brief §12).
  pos = [], canSetRate = false, onSetItemRate,
  // 2026-10-31 fixed racks — the free slot on this BOM's own rack (null when
  // the rack is full or the BOM has no rack), and the slot a Fill reserved.
  rackFreeSlot = null, reservedSlot = null,
  // 2026-10-31 M/R sets — { mode, key, slotId, setId, unit, pairUnit, label,
  // serialNo, machineId } when this drawer fills one rack from the Rack View:
  // mode "set" issues the M BOM and places a new machine on the set; mode
  // "crate" issues the R BOM under the serial of the machine already there.
  // Units are fixed at 1, the BOM cannot be edited here, and the issue goes
  // to that rack only (no destination choice).
  rackSet = null,
  // 2026-10-31 — every empty unit of this BOM's rack; BOM Outward asks the
  // operator to pick one.
  rackFreeSlots = [] }) {
  const [showCostPanel, setShowCostPanel] = useState(false);
  const [materialBlock, setMaterialBlock] = useState(false);
  // Pre-issue check — which rows have their checklist / serials open, and
  // whether only the items still to resolve are listed.
  const [cpOpen, setCpOpen] = useState({});
  const [cpRemainingOnly, setCpRemainingOnly] = useState(false);
  const [editValidationErr, setEditValidationErr] = useState("");
  const [search,       setSearch]       = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [catCollapsed, setCatCollapsed] = useState({});
  const [issueQtys,    setIssueQtys]    = useState({});
  const [checked,      setChecked]      = useState({});
  const [editMode,     setEditMode]     = useState(false);
  const [editItems,    setEditItems]    = useState(() => bom.items.map((i) => ({ ...i })));
  const [editPhoto,    setEditPhoto]    = useState(() => bom.photoUrl || "");
  const [editRackCap,  setEditRackCap]  = useState(() => bom.rackCapacity ?? 0);
  // Migration 041 — department durations live on the BOM.
  const [editDurations, setEditDurations] = useState(() => durationsFormFrom(bom.deptDurations, settings));
  const [editDurErr,    setEditDurErr]    = useState("");
  const [editKey,      setEditKey]      = useState(bomKey);
  const [editLabel,    setEditLabel]    = useState(bom.label || "");
  // 2026-10-22 — the two "clearly visible options" at the top of BOM Edit
  // for existing BOMs: Checklist panel + Critical Items list. Both are
  // collapsed by default so the common edit (components + rack) stays
  // uncluttered; a prominent chip at the top of Edit opens either panel.
  const [showChecklistPanel, setShowChecklistPanel] = useState(false);
  const [showCriticalPanel,  setShowCriticalPanel]  = useState(false);
  const [renameErr,    setRenameErr]    = useState("");
  const [issuing,      setIssuing]      = useState(false);
  const [addCode,      setAddCode]      = useState("");
  const [addBaseQty,   setAddBaseQty]   = useState("1");
  const [addErr,       setAddErr]       = useState("");
  const [issueNote,    setIssueNote]    = useState("");
  // 2026-11-01 — parts owed on this machine that are NOT BOM lines. They are
  // raised as pending jobs against the machine's serial when the BOM is
  // issued; no stock moves and nothing is added to the Item Master.
  const [extraPending, setExtraPending] = useState([]);
  const [confirmIssue, setConfirmIssue] = useState(false);
  // Feature 1 (2026-06-01h, refined 2026-06-02c): destination for the issued
  // build. Default "rack" preserves the existing workflow. "direct" skips the
  // rack stage and lands the machine in Assembly so R&D / prototype / custom
  // one-off jobs don't detour through rack-replenishment. The choice is now
  // surfaced as a dedicated popup at commit time (showDestChoice) because the
  // earlier inline radio in the summary bar was missed by operators.
  const [destination,    setDestination]    = useState("rack");
  const [showDestChoice, setShowDestChoice] = useState(false);
  const [destError,      setDestError]      = useState("");      // surfaced inside the dest-choice popup when rack is full
  // Migration 026 — per-line critical-item confirmation. Keyed by item code.
  // Checkbox items store { confirmed: bool }, serial items store { serials: string[] }
  // (length === issueQty when valid). Non-critical items never appear here.
  // The confirmation UI lives in a dedicated modal that opens when the operator
  // clicks "Issue Stock" — shown ONLY during BOM Outward, never during BOM
  // create / edit. Non-critical outward keeps its existing inline confirm flow.
  // 2026-10-30 — each entry may also carry { remark }: why a critical item
  // was NOT verified. An unverified critical item is allowed through only with
  // a remark, and is then left out of the issue (see doIssue).
  const [criticalInputs,    setCriticalInputs]    = useState({});
  const [criticalErr,       setCriticalErr]       = useState("");
  // One popup for the whole pre-issue check: the check points of every line
  // going out AND the critical-item confirmations. Until 2026-10-30 these were
  // two popups in a row, and the second one refused to continue until every
  // critical item was ticked — so a BOM could not be issued at all while one
  // part was still on order.
  const [showCPBrief,   setShowCPBrief]   = useState(false);
  // Which edit-mode BOM line has its per-BOM check points open.
  const [cpEditCode,    setCpEditCode]    = useState(null);
  // Feature 2 — Req 2: set of all serial numbers already issued historically.
  // Used to block reuse of the same serial across multiple outward events.
  const usedSerials = useMemo(() => {
    const set = new Set();
    (outwardLog || []).forEach((rec) => {
      (rec.items || []).forEach((line) => {
        if (line?.criticalInput?.type === "serial") {
          (line.criticalInput.serials || []).forEach((s) => { if (s) set.add(String(s).toLowerCase().trim()); });
        }
      });
    });
    return set;
  }, [outwardLog]);
  // Migration 027 — per-machine department duration popup. Fires AFTER the
  // critical-item popup (or straight after Issue Stock when no critical lines
  // exist) and BEFORE doIssue commits. Default values come from the live
  // workflow settings so operators can accept-and-move for the common case;
  // any machine-specific override they type here is baked onto the machine
  // record once, at BOM Outward. We intentionally expose NO general edit UI
  // afterwards — the spec requires a controlled process for later corrections.
  const [showDurationModal, setShowDurationModal] = useState(false);
  // Migration 041 — pre-filled from the BOM's own durations when it has them,
  // else from the global settings. When the BOM has all four, the popup is not
  // shown at all: the saved durations are copied onto the machine as-is.
  const bomDurationsSet = bomHasAllDurations(bom);
  const [durationForm,      setDurationForm]      = useState(() => durationsFormFrom(bom?.deptDurations, settings));
  const [durationErr, setDurationErr] = useState("");

  const allFlat  = Object.entries(items).flatMap(([cat, list]) => list.map((i) => ({ ...i, category: cat })));
  const findInv  = (code) => allFlat.find((i) => i.code === code);
  const selStyle = { background: "var(--surface-input)", color: "var(--text)" };

  const sourceItems = editMode ? editItems : bom.items;

  const enriched = sourceItems.map(({ code, qty, checkPoints }) => {
    const inv      = findInv(code);
    // Migration 037 — the BOM line's own check points win. A line saved before
    // 037 has none, so we fall back to the item's current template rather than
    // showing the operator nothing on a BOM built earlier.
    const linePoints = Array.isArray(checkPoints) ? checkPoints
                     : (Array.isArray(inv?.checkPoints) ? inv.checkPoints : []);
    const required = roundQty(qty * units);
    const available = inv?.stock ?? 0;
    const maxIssue  = Math.min(required, available);
    const userQty   = issueQtys[code];
    const issueQty  = userQty !== undefined ? Math.max(0, Math.min(userQty, available)) : maxIssue;
    const pendingQty = roundQty(Math.max(0, required - issueQty));
    const overQty    = Math.max(0, issueQty - required);
    const status    = available >= required ? "green" : available > 0 ? "orange" : "red";
    return { code, baseQty: qty, required, available, issueQty, pendingQty, overQty, status,
             name: inv?.name || code, unit: inv?.unit || "—", category: inv?.category || "Other", inv,
             checkPoints: linePoints };
  });

  const isItemChecked = (code) => checked[code] !== false;

  const filtered = enriched.filter(({ name, code, status }) => {
    const q = search.toLowerCase();
    return (!q || name.toLowerCase().includes(q) || code.toLowerCase().includes(q)) &&
           (filterStatus === "all" || status === filterStatus);
  });

  const categories = [...new Set(filtered.map((i) => i.category))].sort();

  const checkedE   = enriched.filter((i) => isItemChecked(i.code));
  const readyN     = enriched.filter((i) => i.status === "green").length;
  const partialN   = enriched.filter((i) => i.status === "orange").length;
  const missingN   = enriched.filter((i) => i.status === "red").length;
  const totalIssuing   = checkedE.reduce((s, i) => s + i.issueQty, 0);
  const totalPending   = checkedE.reduce((s, i) => s + i.pendingQty, 0);
  const totalOverIssue = checkedE.reduce((s, i) => s + (i.overQty || 0), 0);
  const hasOverIssue   = checkedE.some((i) => (i.overQty || 0) > 0);
  // 2026-11-02 — a pending item added at BOM Outward needs an item name and a
  // pending quantity (Critical / Normal is always set). Blank rows are ignored.
  // A row counts as started as soon as anything is typed in it (name, quantity
  // or part serial), so a half-filled row can never be dropped silently.
  const startedPending = (Array.isArray(extraPending) ? extraPending : []).map(normalizePendingJob)
    .filter((j) => j.itemName.trim() || j.itemCode.trim() || String(j.qty).trim() || j.partSerialNo.trim() || j.saved);
  const extraPendingProblem = startedPending.some((j) => !j.itemName.trim() || !(Number(j.qty) > 0))
    ? "Each pending item needs an item name and a quantity."
    : startedPending.some((j) => !j.saved)
      ? "Press Save on each pending item before issuing." : "";
  const canSubmit      = checkedE.some((i) => i.issueQty > 0) && !extraPendingProblem;

  const SC = { green: "#22c55e", orange: "#D97706", red: "#ef4444" };
  const SB = { green: "rgba(34,197,94,0.1)", orange: "rgba(217, 119, 6,0.1)", red: "rgba(239,68,68,0.1)" };
  const SL = { green: "Available", orange: "Partial", red: "Missing" };

  // Critical-item lines that are both checked and being issued this round.
  // Non-critical lines are untouched. Serial-mode requires one serial per unit;
  // checkbox-mode requires a single confirmation. Non-empty whitespace-trimmed
  // serials only. The ready flag gates the Confirm button.
  //
  // 2026-10-31 — on a rack BOM (M / R) a critical item the operator UNTICKED
  // in the list is still part of the critical check: it must be explained
  // ("Not verified" + reason) and is then Not Issued (no stock, pending job),
  // exactly like a ticked line marked Not verified. Without a reason it stays
  // blocked as unticked. Non-rack BOMs keep the old behaviour.
  const rackBomForCheck = rackCapacityFor(bomKey, bom) > 0;
  const untickedCritical = rackBomForCheck
    ? enriched.filter((i) => !isItemChecked(i.code) && i.inv && i.inv.isCritical && (Number(i.required) || 0) > 0)
    : [];
  const criticalLines = [...checkedE.filter((i) => i.issueQty > 0 && i.inv && i.inv.isCritical), ...untickedCritical];
  const isCriticalLineReady = (line) => {
    if (!isItemChecked(line.code)) return false;   // unticked → never "verified"
    const type = line.inv.outwardInputType === "serial" ? "serial" : "checkbox";
    const state = criticalInputs[line.code] || {};
    if (type === "checkbox") return !!state.confirmed;
    const serials = (state.serials || []).map((s) => (s || "").trim()).filter(Boolean);
    const unique = new Set(serials.map((s) => s.toLowerCase()));
    if (serials.length !== line.issueQty || unique.size !== serials.length) return false;
    // Feature 2 — block serials already used in outward history.
    if (serials.some((s) => usedSerials.has(s.toLowerCase()))) return false;
    return true;
  };
  // An unverified critical line may go ahead only when the operator says why.
  // A serial line with some serials typed is neither verified nor skipped —
  // the half-entered list is almost certainly a mistake, so it must be
  // finished or cleared.
  const criticalRemark   = (line) => String((criticalInputs[line.code] || {}).remark || "").trim();
  const hasPartialSerials = (line) => line.inv.outwardInputType === "serial"
    && ((criticalInputs[line.code] || {}).serials || []).some((x) => String(x || "").trim());
  const isCriticalLineSkipped = (line) => !isCriticalLineReady(line) && !hasPartialSerials(line) && !!criticalRemark(line);
  const isCriticalLineResolved = (line) => isCriticalLineReady(line) || isCriticalLineSkipped(line);
  const allCriticalResolved = criticalLines.every(isCriticalLineResolved);
  const skippedCodes = new Set(criticalLines.filter(isCriticalLineSkipped).map((l) => l.code));
  // Every line the pre-issue popup covers: anything with check points, plus
  // every critical line (a critical item with no check points still needs its
  // confirmation).
  const verifyLines = [...checkedE.filter((i) => i.issueQty > 0 && ((i.checkPoints || []).length > 0 || (i.inv && i.inv.isCritical))), ...untickedCritical];

  // Panel split: Electrical → right, everything else → left
  const leftCats  = categories.filter((c) => c !== "Electrical");
  const rightCats = categories.filter((c) => c === "Electrical");

  const colHeader = (
    <div className="sticky top-0 z-10 grid gap-0 px-3 sm:px-6 py-2.5 text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em] sm:tracking-[0.16em]"
         style={{ gridTemplateColumns: "var(--bom-cols)", background: "#f8f9fb", borderBottom: "1px solid rgba(17,24,39,0.08)" }}>
      <div /><div>Item / Code</div>
      <div className="text-right">Have</div>
      <div className="text-right">Need</div>
      <div className="text-right pr-2">Issue</div>
      <div className="text-right pr-4">Pending</div>
    </div>
  );

  const renderCategory = (cat) => {
    const catItems  = filtered.filter((i) => i.category === cat);
    if (!catItems.length) return null;
    const collapsed = catCollapsed[cat];
    const cReady    = catItems.filter((i) => i.status === "green").length;
    const cPartial  = catItems.filter((i) => i.status === "orange").length;
    const cMissing  = catItems.filter((i) => i.status === "red").length;
    return (
      <div key={cat}>
        <button onClick={() => setCatCollapsed((p) => ({ ...p, [cat]: !p[cat] }))}
                className="w-full flex items-center gap-3 px-6 py-2 hover:bg-transparent transition-colors"
                style={{ borderBottom: "1px solid rgba(17,24,39,0.04)" }}>
          <span className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em] w-28 text-left">{cat}</span>
          <div className="flex gap-1.5">
            {cReady   > 0 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background:"rgba(34,197,94,0.1)",  color:"#15803d",  border:"1px solid rgba(34,197,94,0.2)"  }}>{cReady}✓</span>}
            {cPartial > 0 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background:"rgba(217, 119, 6,0.1)", color:"#B45309", border:"1px solid rgba(217, 119, 6,0.2)" }}>{cPartial}~</span>}
            {cMissing > 0 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background:"rgba(239,68,68,0.1)",  color:"#dc2626",  border:"1px solid rgba(239,68,68,0.2)"  }}>{cMissing}✗</span>}
          </div>
          <span className="ml-auto text-[10px] text-slate-600">{collapsed ? "▶" : "▼"} {catItems.length} items</span>
        </button>
        {!collapsed && catItems.map((item) => {
          const rowChecked = isItemChecked(item.code);
          const sc = SC[item.status];
          const partialFill = item.available > 0 && item.available < item.required ? (item.available / item.required) * 100 : 0;
          return (
            <div key={item.code}
                 className={`grid gap-0 items-center px-3 sm:px-6 py-2 border-b border-slate-200 transition-all hover:bg-transparent ${!rowChecked ? "opacity-35" : ""}`}
                 style={{ gridTemplateColumns: "var(--bom-cols)", background: rowChecked && item.status !== "green" ? `${sc}07` : "" }}>
              <div><input type="checkbox" checked={rowChecked} onChange={(e) => setChecked((p) => ({ ...p, [item.code]: e.target.checked }))} className="accent-blue-500 w-3.5 h-3.5" /></div>
              <div className="min-w-0 pr-3">
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: sc }} />
                  <span className="text-[11px] font-semibold text-slate-900 truncate">{item.name}</span>
                </div>
                <div className="flex items-center gap-2 pl-3 mt-0.5">
                  <span className="text-[9px] font-mono text-slate-600">{item.code}</span>
                  {partialFill > 0 && (
                    <div className="flex-1 h-1 bg-slate-50 rounded-full overflow-hidden max-w-[60px]">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, partialFill)}%`, background: sc }} />
                    </div>
                  )}
                </div>
              </div>
              <div className="text-right">
                <span className="text-[11px] font-bold font-mono" style={{ color: sc, fontFamily:"'Inter',system-ui,sans-serif" }}>{item.available}</span>
                <div className="text-[9px] text-slate-600">{item.unit}</div>
              </div>
              <div className="text-right">
                <span className="text-[11px] font-bold font-mono text-slate-500" style={{ fontFamily:"'Inter',system-ui,sans-serif" }}>{item.required}</span>
                <div className="text-[9px] text-slate-600">{item.unit}</div>
              </div>
              <div className="flex justify-end pr-2">
                {/* onWheel blurs on purpose. A focused number input changes its
                    value on wheel scroll, and this one sits in a long scrolling
                    list, under modals that do not trap focus, on tablets where
                    people scroll with a thumb — so a quantity can be scrolled
                    away without anyone touching it, and `parseInt("") || 0`
                    turns an emptied field into a committed zero. Blurring means
                    scrolling scrolls and typing types. */}
                <input type="number" min="0" step="any" max={item.available} value={item.issueQty}
                       onChange={(e) => setIssueQtys((p) => ({ ...p, [item.code]: Math.min(item.available, Math.max(0, roundQty(parseFloat(e.target.value)||0))) }))}
                       onWheel={(e) => e.currentTarget.blur()}
                       disabled={!rowChecked}
                       className="w-full max-w-[58px] bg-slate-50 border rounded-lg px-2 py-1 text-xs text-slate-900 outline-none text-right modal-input disabled:opacity-30 transition-colors"
                       style={{ fontFamily:"'Inter',system-ui,sans-serif", borderColor: rowChecked && item.overQty > 0 ? "rgba(251,191,36,0.55)" : rowChecked && item.issueQty < item.required ? "rgba(217, 119, 6,0.45)" : "rgba(17,24,39,0.10)" }} />
              </div>
              <div className="text-right pr-4">
                {item.overQty > 0
                  ? <><span className="text-[11px] font-bold font-mono" style={{color:"#b45309",fontFamily:"'Inter',system-ui,sans-serif"}}>+{item.overQty}</span><div className="text-[9px] font-bold" style={{color:"#b45309"}}>over</div></>
                  : item.pendingQty > 0
                    ? <><span className="text-[11px] font-bold font-mono text-amber-700" style={{fontFamily:"'Inter',system-ui,sans-serif"}}>{item.pendingQty}</span><div className="text-[9px] text-slate-600">{item.unit}</div></>
                    : <span className="text-[10px] text-green-400 font-bold">✓</span>
                }
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // Rack tracking gate. The BOM definition's rackCapacity decides whether the
  // operator is offered a choice at all:
  //   capacity > 0 (rack-tracked BOM)  → show Save To Rack / Direct Production
  //                                       popup, let the operator pick.
  //   capacity = 0 or blank (no rack) → no rack card exists for this BOM, so
  //                                       skip the popup and route straight to
  //                                       Direct Production. Capacity is the
  //                                       *configuration* signal, not a runtime
  //                                       fallback.
  // Single additional bypass: no serial (manual outward path) — there is no
  // machine to route.
  const rackTracked = rackCapacityFor(bomKey, bom) > 0;
  // Validate the duration-form state (migration 027). Each department must have
  // non-negative integer days + hours (0 ≤ hours < 24). A fully-zero row is
  // allowed — the operator may legitimately not track that department.
  const normalizeDuration = (dh) => {
    const d = Math.max(0, Math.floor(Number(dh?.days)  || 0));
    const h = Math.max(0, Math.floor(Number(dh?.hours) || 0));
    return { days: d, hours: h };
  };
  const validateDurationForm = () => {
    for (const dept of ["Assembly", "Mechanical", "Electrical", "Trial"]) {
      const { hours } = durationForm[dept] || {};
      if (Number(hours) >= 24) return `${dept}: hours must be less than 24 — use days for anything 24h or longer.`;
    }
    return "";
  };
  const buildDeptDurations = () => {
    const out = {};
    for (const dept of ["Assembly", "Mechanical", "Electrical", "Trial"]) {
      const n = normalizeDuration(durationForm[dept]);
      out[dept] = { minutes: n.days * 24 * 60 + n.hours * 60 };
    }
    return out;
  };

  // A rack (Rack View Fill, BOM Outward → Empty Rack, or an R crate) takes
  // its OWN BOM with every line ticked, in the Item Master and issued in full
  // — EXCEPT a critical item marked Not verified with a reason (2026-10-31):
  // that line is Not Issued (no stock moves) and becomes a pending job on the
  // machine, and the machine still goes on the rack ("BOM Ready · X Pending").
  const rackIncomplete = () => enriched.filter((i) => !skippedCodes.has(i.code) && (!isItemChecked(i.code) || !i.inv || i.pendingQty > 0 || i.issueQty < i.required));
  const doIssue = async (chosenDest, { durationConfirmed = false, slot = null } = {}) => {
    if (issuing) return;                    // duplicate production-issue guard
    // 2026-10-31 M/R sets — a rack is filled only with its OWN BOM complete:
    // every line ticked, in the Item Master and issued in full. A critical
    // item marked "not issued" also blocks it (Direct Production keeps its
    // pending-job rule).
    if (rackSet) {
      const bad = rackIncomplete();
      if (bad.length > 0) {
        setDestError(`Cannot fill ${rackSet.unit} — every ${bomKey} component must be issued in full: ${bad.map((i) => `${i.name} (${!i.inv ? "not in Item Master" : !isItemChecked(i.code) ? "unticked" : `need ${i.required}, issuing ${i.issueQty}`})`).join(", ")}. Nothing has been issued.`);
        setShowDestChoice(false); setShowCPBrief(false); setMaterialBlock(true);
        return;
      }
      if (rackSet.mode === "set" && rackFreeSlot !== rackSet.setId) {
        setDestError(`${rackSet.label} is no longer empty — another machine was just placed there. Close this and pick an empty rack.`);
        setShowDestChoice(false); setMaterialBlock(true);
        return;
      }
    }
    // Critical-item gate (migration 026). Every critical line that is being
    // issued this round must have its confirmation ready (checkbox ticked, or
    // a unique non-empty serial per unit) before any stock is moved.
    if (!allCriticalResolved) {
      const missing = criticalLines.filter((l) => !isCriticalLineResolved(l)).map((l) => l.name).join(", ");
      setCriticalErr(`Verify these critical items, or write why they are not being issued: ${missing}`);
      setShowCPBrief(true);
      return;
    }
    // Nothing would actually leave the store — every line is a skipped critical
    // item. Creating a machine with no material issued is never intended.
    if (!checkedE.some((i) => i.issueQty > 0 && !skippedCodes.has(i.code))) {
      setCriticalErr("Nothing would be issued — every item is marked as not available. Verify at least one item, or cancel.");
      setShowCPBrief(true);
      return;
    }
    // Duration-config gate (migration 027). Appears only when this outward
    // will create a machine (= has a serial number). Operator sees it right
    // after the critical modal; it defaults to the live workflow settings so
    // one click is enough for the common case. Non-serial manual outward
    // skips this — there's no machine to attach the deadlines to.
    // An R crate creates no machine, so there are no deadlines to set.
    if (rackSet && rackSet.mode === "crate") durationConfirmed = true;
    if (serialNo && !durationConfirmed && !bomDurationsSet) {
      setDurationErr("");
      setShowDurationModal(true);
      return;
    }
    if (serialNo && !chosenDest && rackSet) {
      // A set fill has one destination: the selected set. No popup.
      return doIssue("rack", { durationConfirmed: true });
    }
    if (serialNo && !chosenDest && checkedE.some((i) => i.pendingQty > 0 && !skippedCodes.has(i.code))) {
      // Short → same gate as below, before any destination is offered.
      return doIssue(rackTracked ? "rack" : "direct", { durationConfirmed: true });
    }
    if (serialNo && !chosenDest) {
      if (!rackTracked) {
        // Capacity blank → auto-route. Skip the popup entirely and commit
        // straight to direct production so capacity-blank BOMs flow directly
        // into Active Builds without any rack detour.
        return doIssue("direct", { durationConfirmed: true });
      }
      setDestError("");
      setShowDestChoice(true);
      return;
    }
    const finalDest = chosenDest || destination || (rackTracked ? "rack" : "direct");
    // 2026-10-31 — material gate: a build may not go straight into production
    // with components still short. A fixed-rack BOM can still be saved to its
    // rack (the shortfall goes to Pending Stock and Start assembly stays
    // blocked until it arrives); Direct Production needs every line in full.
    // Critical items deliberately not issued keep their existing pending-job
    // rule and are not counted here.
    const shortLines = checkedE.filter((i) => i.pendingQty > 0 && !skippedCodes.has(i.code));
    // 2026-10-31 rack units: a rack is filled only with the machine's COMPLETE
    // BOM stock, and Direct Production needs it too — so no machine is created
    // while any component is short (rack or direct). Critical items
    // deliberately not issued keep their existing pending-job rule.
    if (serialNo && shortLines.length > 0) {
      setDestError(`Materials short: ${shortLines.map((i) => `${i.name} (need ${i.required}, have ${i.available})`).join(", ")}. ${rackTracked ? "A rack is filled only with the complete BOM stock." : "R&D builds go to Direct Production only, with every component."} Receive the stock first.`);
      setShowDestChoice(false); setMaterialBlock(true);
      return;
    }
    // Rack-capacity gate, scoped to the rack branch: the BOM's own fixed rack
    // has two slots; both taken → no rack save.
    if (finalDest === "rack") {
      if (rackTracked && !rackFreeSlot && !reservedSlot) {
        setDestError(`Rack is full — the ${bomKey} rack has both slots taken. Start assembly or release a machine to free a slot.`);
        setShowDestChoice(true);
        return;
      }
      if (rackTracked && !rackSet && slot && !rackFreeSlots.includes(slot)) {
        setDestError(`${slotLabel(slot)} is no longer empty — pick another rack.`);
        setShowDestChoice(true);
        return;
      }
      if (serialNo && rackTracked && !rackSet && !slot) {
        // BOM Outward: the operator picks the exact empty rack.
        setDestError(""); setShowDestChoice(true);
        return;
      }
      const bad = rackTracked && !rackSet ? rackIncomplete() : [];
      if (bad.length > 0) {
        setDestError(`Cannot put ${bomKey} on a rack — every component must be issued in full: ${bad.map((i) => `${i.name} (${!i.inv ? "not in Item Master" : !isItemChecked(i.code) ? (i.inv.isCritical ? "unticked — tick it, or mark it Not verified with a reason" : "unticked") : `need ${i.required}, issuing ${i.issueQty}`})`).join(", ")}. Nothing has been issued.`);
        setShowDestChoice(false); setMaterialBlock(true);
        return;
      }
    }
    // ── Guard: a confirmed critical line may not commit as zero ─────────────
    //
    // On 2026-10-29 a BOM was issued with four lines. The screen showed TUBE
    // HEATER as HAVE 6 / NEED 2 / ISSUE 2, its critical checkbox was ticked in
    // the confirmation modal, and the footer read "Issuing 11 units". By the
    // time this function ran its commit loop that line held issueQty 0 and
    // pendingQty 2: the stock never moved, a Pending Stock shortfall was filed
    // for a part that was sitting on the shelf, and the outward log recorded
    // three items instead of four. Nothing was shown to the operator. The
    // pending_log row carried the item's real name, unit and category, which
    // proves the item was found and `issueQtys` had been zeroed — most likely
    // by a wheel scroll over the focused quantity box (now blurred on wheel
    // above), though that is the leading explanation rather than a proven one.
    //
    // Whatever zeroes it, the contract is simple and worth enforcing on its
    // own: an operator who has just physically verified a controlled part, or
    // typed its serial numbers, has said that part is going into this machine.
    // Committing it as zero contradicts what they confirmed, so refuse and say
    // so rather than quietly turning it into a shortfall.
    const contradicted = criticalLines.filter((l) => {
      if (skippedCodes.has(l.code)) return false;   // not being issued by design
      const line = checkedE.find((e) => e.code === l.code);
      return line && line.issueQty <= 0;
    });
    if (contradicted.length > 0) {
      setCriticalErr(
        `${contradicted.map((l) => l.name).join(", ")}: you confirmed ${contradicted.length === 1 ? "this item" : "these items"}, ` +
        `but the quantity to issue is now 0. Nothing has been issued. Check the quantity column and try again.`
      );
      setShowCPBrief(true);
      return;
    }

    setShowDestChoice(false);
    setDestError("");
    setCriticalErr("");
    setIssuing(true);
    const issued = []; const pending = [];
    // Collect every stock move first, then commit them together. The old code
    // fired each move fire-and-forget and called onIssue() regardless, so a
    // rejected move (insufficient stock, concurrent edit, RLS refusal) still
    // created the machine + outward log claiming stock had left the store when
    // it had not. Now we AWAIT all moves: if any fail we roll back the ones that
    // succeeded and abort — no machine, no phantom issue — and tell the operator.
    const moves = [];
    // Unticked critical lines with a reason are recorded as Not Issued (no
    // stock moves, pending job raised); unticked lines without one never get
    // here (the critical check blocks them).
    [...checkedE, ...untickedCritical.filter((l) => skippedCodes.has(l.code))].forEach((item) => {
      // A critical item left unverified (with its reason) is NOT issued: no
      // stock moves. It is written to the outward record with quantity 0 and
      // the remark, and (2026-10-30) raised as a pending job against the new
      // machine — see handleCreateMachine — so it is followed up, not
      // remembered. requiredQty is the BOM requirement, not the stock-capped
      // issue quantity.
      if (skippedCodes.has(item.code)) {
        const type = item.inv?.outwardInputType === "serial" ? "serial" : "checkbox";
        issued.push({ ...item, issueQty: 0, pendingQty: 0,
          criticalInput: { type, confirmed: false, notIssued: true, remark: criticalRemark(item), requiredQty: item.required ?? item.issueQty } });
        return;
      }
      if (item.issueQty > 0 && item.inv) {
        moves.push({ category: item.inv.category, code: item.code, qty: item.issueQty, name: item.name });
      }
      if (item.issueQty > 0) {
        // Attach criticalInput so handleAddOutward can persist it in the
        // outward_log.items jsonb array (no second migration needed).
        let criticalInput = null;
        if (item.inv?.isCritical) {
          const type  = item.inv.outwardInputType === "serial" ? "serial" : "checkbox";
          const state = criticalInputs[item.code] || {};
          if (type === "checkbox") {
            criticalInput = { type, confirmed: !!state.confirmed };
          } else {
            const serials = (state.serials || []).map((s) => (s || "").trim()).filter(Boolean);
            criticalInput = { type, serials };
          }
        }
        issued.push({ ...item, criticalInput });
      }
      if (item.pendingQty > 0) pending.push({ ...item });
    });
    // 2026-11-02 — EVERY BOM line the operator left unselected (Critical or
    // Non-Critical) becomes a Pending Job on the machine, with the BOM
    // quantity and a reason ("Not selected at BOM Outward" unless one was
    // typed). Critical lines already handled above (unticked + reason) are
    // skipped here; nothing is deducted from stock for any of them.
    const handledCodes = new Set(issued.map((i) => i.code));
    enriched.forEach((item) => {
      if (isItemChecked(item.code) || handledCodes.has(item.code) || !((Number(item.required) || 0) > 0)) return;
      const type = item.inv?.outwardInputType === "serial" ? "serial" : "checkbox";
      issued.push({ ...item, issueQty: 0, pendingQty: 0,
        criticalInput: { type, confirmed: false, notIssued: true, unselected: true, critical: !!item.inv?.isCritical,
          remark: criticalRemark(item) || "Not selected at BOM Outward", requiredQty: item.required } });
    });

    // Migration 027 — carry the per-machine duration overrides into the issue
    // payload. Only emitted when a serial is present (= machine will be
    // created). Non-serial manual outward sends nothing, matching legacy flow.
    const deptDurations = serialNo ? buildDeptDurations() : null;
    const issueId = Date.now();
    const issueRackSlot = finalDest === "rack" ? (rackSet ? rackSet.slotId : slot) : null;
    const extraJobs = cleanPendingJobs(extraPending);

    // 2026-11-02 — the machine record FIRST, before any stock moves. In
    // Supabase mode handleCreateMachine awaits the insert; if it is refused
    // nothing has left the store and nothing else is written. An R crate
    // (rackSet.mode "crate") fills an existing machine and creates none.
    const needsMachine = !!serialNo && !(rackSet && rackSet.mode === "crate");
    let createdMachine = null;
    if (needsMachine && onCreateMachineFirst) {
      let mr = null;
      try {
        mr = await onCreateMachineFirst({ bomKey, label: bom.label, serialNo, date: fmtDate(new Date()), issueId, destination: finalDest, deptDurations, issued, rackSlot: issueRackSlot, extraPending: extraJobs });
      } catch (err) { mr = { success: false, error: err?.message || String(err) }; }
      if (!mr || mr.success === false) {
        setIssuing(false);
        setCriticalErr(`Issue aborted — the machine record could not be saved: ${(mr && mr.error) || "unknown error"}. Nothing has been issued.`);
        setShowCPBrief(true);
        return;
      }
      createdMachine = mr.machine || null;
    }

    // Run the deductions and wait for every answer.
    const results = await Promise.all(moves.map((m) =>
      Promise.resolve(handleUpdateStock(m.category, m.code, -m.qty, `BOM: ${bomKey}`))
        .then((res) => ({ m, ok: !(res && res.success === false), err: res?.error }))
        .catch((err) => ({ m, ok: false, err: err?.message || String(err) }))
    ));
    const failures = results.filter((r) => !r.ok);
    if (failures.length > 0) {
      // Roll back the components that DID move, so we never leave the store
      // short without a machine to account for it. Best-effort — these reversals
      // succeed in local mode and almost always in Supabase mode too.
      await Promise.all(results.filter((r) => r.ok).map((r) =>
        Promise.resolve(handleUpdateStock(r.m.category, r.m.code, +r.m.qty, `BOM rollback: ${bomKey}`)).catch(() => {})
      ));
      // The machine row already exists (created above, before the moves). It
      // is taken back out so the rack never shows a set with no materials
      // behind it; a failed delete is reported by the handler itself.
      if (createdMachine && onAbortMachine) {
        try { await onAbortMachine(createdMachine.id, `stock movement refused: ${failures.map((f) => f.m.name).join(", ")}`); } catch (err) { console.error("[BOMDrawer] abort machine failed", err); }
      }
      setIssuing(false);
      const msg = `Issue aborted — stock movement failed:\n${failures.map((f) => `${f.m.name}: ${f.err || "rejected"}`).join("\n")}`;
      onStockIssueFailed?.(bomKey, failures.map((f) => `${f.m.name}: ${f.err || "rejected"}`));
      setCriticalErr(msg);
      setShowCPBrief(true);
      return;
    }

    onIssue({ bomKey, label: bom.label, units, issued, pending, note: issueNote, date: fmtDate(new Date()), serialNo, destination: finalDest, deptDurations, rackSet: rackSet || null, rackSlot: finalDest === "rack" ? (rackSet ? rackSet.slotId : slot) : null,
              extraPending: extraJobs, issueId, machineId: createdMachine ? createdMachine.id : null });
    onClose();
  };

  const addItemToBOM = () => {
    const inv = findInv(addCode); const qty = parseFloat(addBaseQty);
    if (!inv)           { setAddErr("Select a valid item"); return; }
    if (!qty || qty<=0) { setAddErr("Enter valid quantity"); return; }
    if (editItems.some((i) => i.code === addCode)) { setAddErr("Item already in BOM"); return; }
    setAddErr(""); setEditItems((p) => [...p, { code: addCode, qty }]);
    setAddCode(""); setAddBaseQty("1");
  };

  // Bulk counterpart of addItemToBOM — commits the lines BOMPasteLines has
  // already previewed. addItemToBOM refuses a code that is already in the BOM
  // ("Item already in BOM"), so a pasted duplicate must not create a second
  // line either: its quantity is added to the line that is already there.
  // Functional-form setState per CLAUDE.md §8 — a paste can land while the
  // operator is still editing quantities above.
  const applyPastedBOMLines = (lines) => {
    setAddErr("");
    setEditItems((p) => {
      const next = p.map((i) => ({ ...i }));
      for (const l of lines) {
        const at = next.findIndex((i) => i.code === l.code);
        // Rounded like the parser does: the stored BOM line must not carry a
        // 0.30000000000000004-class float artifact into the database.
        if (at >= 0) next[at].qty = Math.round(((Number(next[at].qty) || 0) + l.qty) * 10000) / 10000;
        else {
          // Migration 037 — a pasted line inherits the item's check-point
          // template too, so bulk-built BOMs reach Outward with the same
          // instructions a hand-added line would carry.
          const inv = findInv(l.code);
          next.push({ code: l.code, qty: l.qty, checkPoints: Array.isArray(inv?.checkPoints) ? [...inv.checkPoints] : [] });
        }
      }
      return next;
    });
  };

  const saveBOMEdit = () => {
    setRenameErr("");
    const newKey   = (editKey || "").trim().toUpperCase().replace(/\s+/g, "-");
    const newLabel = (editLabel || "").trim();
    if (!newKey)   { setRenameErr("BOM Key is required"); return; }
    if (!newLabel) { setRenameErr("Machine Model Name is required"); return; }
    if (newKey !== bomKey && allBomKeys.some((k) => k === newKey)) {
      setRenameErr("A BOM with this key already exists"); return;
    }
    const dErr = validateDurationsForm(editDurations);
    if (dErr) { setEditDurErr(dErr); return; }
    setEditDurErr("");
    // 2026-10-31 — duplicate lines and zero quantities never reach the store.
    const v = validateBomLines(editItems, findInv);
    if (!v.ok) { setEditValidationErr(v.errors.join(" ")); return; }
    setEditValidationErr("");
    // First save items + rack capacity + durations under the existing key
    onUpdateBOM(bomKey, {
      ...bom,
      items: editItems.filter((i) => i.qty > 0),
      rackCapacity: Math.max(0, parseInt(editRackCap, 10) || 0),
      deptDurations: durationsStoreFrom(editDurations),
      photoUrl: editPhoto || null,
    });
    // Then rename if key or label changed
    if ((newKey !== bomKey || newLabel !== bom.label) && onRenameBOM) {
      const res = onRenameBOM(bomKey, newKey, newLabel);
      if (res?.success === false) { setRenameErr(res.error || "Rename failed"); return; }
      if (newKey !== bomKey && onAfterRename) onAfterRename(newKey);
    }
    setEditMode(false);
  };

  const resetEditState = () => {
    setEditItems(bom.items.map((i) => ({ ...i })));
    setEditRackCap(bom.rackCapacity ?? 0);
    setEditDurations(durationsFormFrom(bom.deptDurations, settings));
    setEditPhoto(bom.photoUrl || "");
    setEditDurErr("");
    setEditKey(bomKey);
    setEditLabel(bom.label || "");
    setRenameErr("");
  };

  return (
    <div className="bom-drawer fixed inset-0 z-[70] flex flex-col" style={{ background: "var(--surface-page)" }}>

      {/* ── Header ── wraps on a phone: title first, then units / cost /
             edit / close on their own row (they used to run off-screen). */}
      <div className="flex-shrink-0" style={{ background: "var(--surface-card)", borderBottom: "1px solid var(--border-subtle)" }}>
        <div className="flex flex-wrap items-center gap-x-3 sm:gap-x-4 gap-y-2.5 px-4 sm:px-6 py-3 sm:py-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-[11px] font-black text-slate-900 flex-shrink-0"
               style={{ background: bom.color + "22", border: `1px solid ${bom.color}55` }}>{bomKey}</div>
          <div className="flex-1 min-w-[170px]">
            <div className="text-sm font-black text-slate-900 leading-snug">{bomKey} — {bom.label}</div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {serialNo && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background:"rgba(46, 80, 214,0.12)", color:"#2640B0", border:"1px solid rgba(46, 80, 214,0.25)" }}>S/N: {serialNo}</span>
              )}
              <span className="text-[10px] text-slate-500">{enriched.length} components</span>
              {readyN > 0   && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: "rgba(34,197,94,0.12)",  color: "#15803d",  border: "1px solid rgba(34,197,94,0.22)"  }}>{readyN} ready</span>}
              {partialN > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: "rgba(217, 119, 6,0.12)", color: "#B45309", border: "1px solid rgba(217, 119, 6,0.22)" }}>{partialN} partial</span>}
              {missingN > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: "rgba(239,68,68,0.12)",  color: "#dc2626",  border: "1px solid rgba(239,68,68,0.22)"  }}>{missingN} missing</span>}
            </div>
          </div>

          {rackSet && (
            <span data-rack-set className="text-[10.5px] font-black px-2.5 py-1 rounded-lg" style={{ background: "rgba(29,78,216,0.08)", color: "#1d4ed8", border: "1px solid rgba(29,78,216,0.25)" }}>
              {rackSet.mode === "crate" ? (rackSet.slotId ? `Filling ${rackSet.unit} crate · ${bomKey} BOM · same serial as ${rackSet.pairUnit}` : `${bomKey} crate · same serial ${rackSet.serialNo} · machine not on a rack`) : `Filling ${rackSet.unit} · ${bomKey} BOM`}
            </span>
          )}
          {/* Units stepper — a machine set is always one machine. */}
          {!rackSet && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "rgba(17,24,39,0.04)", border: "1px solid rgba(17,24,39,0.10)" }}>
            <span className="text-[10px] text-slate-400 mr-1">Units</span>
            <button onClick={() => onUnitsChange(Math.max(1, units - 1))} className="w-6 h-6 rounded text-sm font-bold text-slate-600 hover:text-slate-900 hover:bg-white/10 transition-all">−</button>
            <span className="text-sm font-black text-slate-900 w-8 text-center font-mono" style={{ fontFamily: "'Inter',system-ui,sans-serif" }}>{units}</span>
            <button onClick={() => onUnitsChange(units + 1)} className="w-6 h-6 rounded text-sm font-bold text-slate-600 hover:text-slate-900 hover:bg-white/10 transition-all">+</button>
          </div>
          )}

          {(() => {
            const cs = bomCostSummary(bomCostLines(sourceItems, findInv, receivedPoRates(pos), units));
            return (
              <button data-bom-cost onClick={() => setShowCostPanel((v) => !v)} title="Component rates and BOM cost"
                      className="text-[11px] font-bold px-3 py-1.5 rounded-lg border transition-all"
                      style={showCostPanel ? { background: "rgba(21,128,61,0.10)", color: "#15803d", borderColor: "rgba(21,128,61,0.35)" }
                                           : { background: "var(--surface-card)", color: cs.complete ? "#15803d" : "#b91c1c", borderColor: "var(--border-rim)" }}>
                <LeadIcon e="💰" />{formatINR(cs.knownTotal)}{cs.complete ? "" : ` · ${cs.missingRate + cs.missingItem} missing`}
              </button>
            );
          })()}
          {!rackSet && (
          <button onClick={() => { if (editMode) { setEditMode(false); resetEditState(); } else { resetEditState(); setEditMode(true); } }}
                  className={`text-[11px] font-bold px-3 py-1.5 rounded-lg border transition-all ${editMode ? "bg-amber-500/10 text-amber-700 border-amber-500/30" : "bg-slate-50 text-slate-400 border-slate-200 hover:text-slate-900"}`}>
            {editMode ? "✕ Cancel" : "✏️ Edit BOM"}
          </button>
          )}
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900 text-[11px] font-bold px-3 py-1.5 rounded-lg hover:bg-slate-50 border border-slate-200 transition-all">✕ Close</button>
        </div>

        {showCostPanel && (
          <div className="px-6 pb-4" style={{ maxHeight: "46vh", overflowY: "auto" }}>
            <BomCostPanel lines={sourceItems} findInv={findInv} pos={pos} units={units} canSetRate={canSetRate} onSetItemRate={onSetItemRate} />
          </div>
        )}

        {/* Search + filter bar */}
        {!editMode && (
          <div className="flex items-center gap-2 px-4 sm:px-6 pb-4 flex-wrap">
            <div className="relative flex-1 min-w-[180px]">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 text-xs"><Glyph e="🔍" size={14} /></span>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items, codes..."
                     className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-7 pr-3 py-1.5 text-xs text-slate-700 placeholder-slate-400 outline-none focus:border-blue-500/30" />
            </div>
            {["all","green","orange","red"].map((f) => (
              <button key={f} onClick={() => setFilterStatus(f)}
                      className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg border transition-all"
                      style={ filterStatus === f
                        ? { background: f === "all" ? "rgba(46, 80, 214,0.15)" : SB[f], borderColor: f === "all" ? "rgba(46, 80, 214,0.4)" : SC[f] + "55", color: f === "all" ? "#2640B0" : SC[f] }
                        : { background: "transparent", borderColor: "rgba(17,24,39,0.06)", color: "#64748b" } }>
                {f === "all" ? `All (${enriched.length})` : `${SL[f]} (${enriched.filter(i=>i.status===f).length})`}
              </button>
            ))}
            <button onClick={() => { const all = {}; enriched.forEach(i => { all[i.code] = true; }); setChecked(all); }} className="text-[10px] text-blue-400 font-bold px-2 py-1.5 hover:text-blue-300 transition-all">✓ All</button>
            <button onClick={() => setChecked({})} className="text-[10px] text-slate-500 font-bold px-2 py-1.5 hover:text-slate-500 transition-all">✗ None</button>
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-hidden flex flex-col">

        {editMode ? (
          /* ── Edit Mode — full width, unchanged ── */
          <div className="flex-1 overflow-y-auto"><div className="org-bom-edit p-4 sm:p-6 space-y-4 max-w-3xl">
            <div className="text-[10px] font-bold text-amber-700 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3">
              <LeadIcon e="✏️" />Edit Mode — Modify items, quantities, then Save BOM to apply changes permanently.
            </div>

            {/* 2026-11-03 — Edit BOM organised into numbered steps. Same
                state, same handlers, same Save BOM; only the order and the
                headings changed. */}
            {/* ── 1 Details ── */}
            <OrgStep n={1} id="details" title="Details" hint="BOM key, machine model name and its production rack.">
              <div className="space-y-3">
            {/* Rename — BOM Key + Machine Model Name */}
            <div className="rounded-xl p-4" style={{ background: "rgba(139,92,246,0.05)", border: "1px solid rgba(139,92,246,0.22)" }}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-base"><Glyph e="✏️" size={15} /></span>
                <div className="text-[11px] font-bold text-slate-900">BOM Identity</div>
                <span className="text-[9px] text-purple-300 px-1.5 py-0.5 rounded-full" style={{ background: "rgba(139,92,246,0.15)" }}>Rename safe</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] font-medium text-purple-200 mb-1.5">BOM Key</div>
                  <input value={editKey} onChange={(e) => { setEditKey(e.target.value.toUpperCase()); setRenameErr(""); }}
                    placeholder="e.g. KM-10"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 font-mono outline-none modal-input" />
                </div>
                <div>
                  <div className="text-[10px] font-medium text-purple-200 mb-1.5">Machine Model Name</div>
                  <input value={editLabel} onChange={(e) => { setEditLabel(e.target.value); setRenameErr(""); }}
                    placeholder="e.g. Kneading Machine 10L"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 outline-none modal-input" />
                </div>
              </div>
              <div className="text-[10px] text-slate-500 mt-2">
                Renaming updates Machine Tracker, Outward log and Pending entries to match. Existing audit history is preserved.
              </div>
              {renameErr && <div className="text-[10px] text-red-400 mt-2"><LeadIcon e="⚠" />{renameErr}</div>}
            </div>

            {/* Production rack — fixed floor racks only (2026-10-30). */}
            <RackStatusNote bomKey={bomKey} />
              </div>
            </OrgStep>

            {/* ── 2 Parts ── */}
            <OrgStep n={2} id="parts" title="Parts" hint="Components and quantity for one machine. Add one by one or paste from Excel."
                     status={<span className="org-step-pill">{editItems.length} part{editItems.length === 1 ? "" : "s"}</span>}>
              <div className="space-y-3">
            {(() => {
              const bomCriticalCount = (editItems || [])
                .map(({ code }) => findInv(code))
                .filter((inv) => inv && inv.isCritical).length;
              return (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setShowCriticalPanel((v) => !v)}
                    className="flex items-center gap-2 text-[12px] font-bold px-4 py-2 rounded-xl border transition-all"
                    style={{
                      background: showCriticalPanel ? "rgba(217, 119, 6,0.14)" : "rgba(217, 119, 6,0.05)",
                      borderColor: showCriticalPanel ? "rgba(217, 119, 6,0.55)" : "rgba(217, 119, 6,0.25)",
                      color: "#B45309",
                    }}
                  >
                    <span className="text-base">🔒</span>
                    <span>Critical Items</span>
                    <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full"
                          style={{ background: "rgba(217, 119, 6,0.2)", color: "#b45309" }}>
                      {bomCriticalCount} in BOM
                    </span>
                    <span className="text-[11px] text-slate-400">{showCriticalPanel ? "▲ Hide" : "▼ View"}</span>
                  </button>
                </div>
              );
            })()}

            {/* ── Critical Items in this BOM (2026-10-22) ────────────────
                   Read-only summary of components whose Item Master row is
                   flagged Critical (migration 026, items.is_critical).
                   Shows name, code, and Outward Input Type (Checkbox /
                   Serial). "Edit in Inventory" navigates the operator to
                   the authoritative Item Master editor — critical-item
                   configuration lives on items, not on BOMs, so there is
                   no duplicate critical-item store or screen. */}
            {showCriticalPanel && (() => {
              const criticalItemsInBom = (editItems || [])
                .map(({ code, qty }) => ({ code, qty, inv: findInv(code) }))
                .filter((r) => r.inv && r.inv.isCritical);
              return (
                <div className="rounded-xl p-4" style={{ background: "rgba(217, 119, 6,0.05)", border: "1px solid rgba(217, 119, 6,0.3)" }}>
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <span className="text-base">🔒</span>
                    <div className="text-[11px] font-bold text-slate-900">Critical Items in this BOM</div>
                    <span className="text-[9px] text-amber-700 px-1.5 py-0.5 rounded-full" style={{ background: "rgba(217, 119, 6,0.15)" }}>
                      Configured on items — not duplicated here
                    </span>
                  </div>
                  {criticalItemsInBom.length === 0 ? (
                    <div className="rounded-lg px-3 py-2.5 text-[11px]"
                         style={{ background: "rgba(17,24,39,0.03)", color: "#6b7280", border: "1px dashed rgba(17,24,39,0.10)" }}>
                      No components in this BOM are flagged <strong>Critical</strong>. To mark one, open <strong>Inventory → Edit Item</strong> and set <em>Critical Item = Yes</em>.
                    </div>
                  ) : (
                    <div className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(17,24,39,0.10)" }}>
                      <div className="grid grid-cols-12 gap-2 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-500"
                           style={{ background: "rgba(17,24,39,0.03)" }}>
                        <div className="col-span-3">Code</div>
                        <div className="col-span-5">Name</div>
                        <div className="col-span-2 text-right">Qty / Unit</div>
                        <div className="col-span-2 text-right">Input Type</div>
                      </div>
                      {criticalItemsInBom.map(({ code, qty, inv }) => {
                        const type = inv.outwardInputType === "serial" ? "Serial Number" : "Checkbox";
                        return (
                          <div key={code} className="grid grid-cols-12 gap-2 items-center px-3 py-2 border-t border-slate-200">
                            <div className="col-span-3 text-[10px] font-mono text-blue-300">{code}</div>
                            <div className="col-span-5">
                              <div className="text-[11px] font-semibold text-slate-900 truncate">{inv.name}</div>
                              <div className="text-[9px] text-slate-500">{inv.category || "—"}</div>
                            </div>
                            <div className="col-span-2 text-right text-[11px] font-mono text-slate-500">
                              {qty} <span className="text-slate-600">{inv.unit || ""}</span>
                            </div>
                            <div className="col-span-2 text-right">
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                                    style={{ background: "rgba(217, 119, 6,0.15)", color: "#b45309", border: "1px solid rgba(217, 119, 6,0.3)" }}>
                                {type}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
                    <div className="text-[10px] text-slate-500">
                      Critical Items are configured per item in the Inventory module (Items master). This panel is a view-only summary scoped to <strong>{bomKey}</strong>.
                    </div>
                    <button onClick={() => onNavigate("inventory")}
                            className="text-[11px] font-black text-white px-3 py-1.5 rounded-lg transition-all"
                            style={{ background: "#B45309", boxShadow: "0 1px 2px rgba(17,24,39,0.14)", color: "#ffffff" }}>
                      → Open Inventory to edit
                    </button>
                  </div>
                </div>
              );
            })()}

            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(17,24,39,0.08)" }}>
              <div className="grid gap-0 px-4 py-2 text-[10px] font-medium text-slate-500 uppercase tracking-wide"
                   style={{ gridTemplateColumns: "var(--bom-edit-cols, minmax(0,1fr) 100px 120px 60px)", background: "rgba(17,24,39,0.03)" }}>
                <div>Item</div><div className="text-center">Category</div><div className="text-center">Qty / Unit</div><div />
              </div>
              {editItems.map((ei, idx) => {
                const inv = findInv(ei.code);
                return (
                  <div key={ei.code} className={`grid gap-0 items-center px-4 py-3 hover:bg-transparent ${idx > 0 ? "border-t border-slate-200" : ""}`}
                       style={{ gridTemplateColumns: "var(--bom-edit-cols, minmax(0,1fr) 100px 120px 60px)" }}>
                    <div>
                      <div className="text-[11px] font-semibold text-slate-900">{inv?.name || ei.code}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <div className="text-[9px] font-mono text-slate-600">{ei.code}</div>
                        {/* Migration 037 — per-BOM check points for this line.
                            A line saved before 037 shows the item's template
                            count so the operator starts from something. */}
                        {(() => {
                          const pts = Array.isArray(ei.checkPoints) ? ei.checkPoints
                                    : (Array.isArray(inv?.checkPoints) ? inv.checkPoints : []);
                          return (
                            <button type="button" onClick={() => setCpEditCode(ei.code)}
                                    title="Check points for this BOM"
                                    className="text-[9px] font-bold px-1.5 py-0.5 rounded transition-all"
                                    style={{
                                      background: pts.length ? "rgba(217,119,6,0.12)" : "rgba(17,24,39,0.05)",
                                      color:      pts.length ? "#b45309" : "#64748b",
                                      border:     `1px solid ${pts.length ? "rgba(217,119,6,0.3)" : "rgba(17,24,39,0.12)"}`,
                                    }}>
                              <LeadIcon e="✅" />{pts.length || "+"}
                            </button>
                          );
                        })()}
                      </div>
                    </div>
                    <div className="text-[10px] text-slate-500 text-center">{inv?.category || "—"}</div>
                    <div className="flex items-center gap-1.5 justify-center">
                      <input type="number" min="0.1" step="0.1" value={ei.qty}
                             onChange={(e) => setEditItems((p) => p.map((i) => i.code === ei.code ? { ...i, qty: parseFloat(e.target.value) || 0 } : i))}
                             className="w-16 bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs text-slate-900 outline-none text-right modal-input"
                             style={{ fontFamily: "'Inter',system-ui,sans-serif" }} />
                      <span className="text-[9px] text-slate-600">{inv?.unit || ""}</span>
                    </div>
                    <div className="flex justify-center">
                      <button onClick={() => setEditItems((p) => p.filter((i) => i.code !== ei.code))}
                              className="text-red-400 hover:text-red-300 text-[10px] font-bold px-2 py-1 rounded hover:bg-red-500/10 transition-all">✕</button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Add item */}
            <div className="rounded-xl p-4" style={{ background: "var(--surface-raised)", border: "1px dashed var(--border-rim)" }}>
              {/* Paste from Excel sits beside the add-line label; its open
                  panel is w-full so flex-wrap drops it onto its own line. */}
              <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
                <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">+ Add Component</div>
                <BOMPasteLines inventory={allFlat} existingLines={editItems} onApply={applyPastedBOMLines} />
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <ItemSearchSelect
                    items={allFlat}
                    value={addCode}
                    onChange={setAddCode}
                    excludeCodes={editItems.map((e) => e.code)}
                    placeholder="Search inventory item by name or code…"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input type="number" min="0.1" step="0.1" value={addBaseQty} onChange={(e) => setAddBaseQty(e.target.value)}
                         placeholder="Qty" className="w-20 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-900 outline-none modal-input"
                         style={{ fontFamily: "'Inter',system-ui,sans-serif" }} />
                  <button onClick={addItemToBOM} className="px-4 py-2 rounded-lg text-xs font-bold text-white"
                          style={{ background: "#2640B0", boxShadow: "0 1px 2px rgba(17,24,39,0.14)", color: "#ffffff" }}>Add</button>
                </div>
              </div>
              {addErr && <div className="text-[10px] text-red-400 mt-2"><LeadIcon e="⚠" />{addErr}</div>}
            </div>
              </div>
            </OrgStep>

            {/* ── 3 Time per department ── */}
            <OrgStep n={3} id="time" title="Time per department"
                     hint="Deadline for each department on every machine of this model. Used at Outward without asking the store again.">
            {/* Migration 041 — department durations for this model. Copied onto
                every machine at Outward, so the operator is not asked again. */}
            <div data-org-durations>
              <div className="text-[11px] font-bold text-slate-500 mb-2">Department Durations <span className="font-medium">· days + hours</span></div>
              <DeptDurationFields value={editDurations} onChange={(v) => { setEditDurations(v); setEditDurErr(""); }} />
              {editDurErr && <div className="text-[10px] text-red-500 font-bold mt-2"><LeadIcon e="⚠" />{editDurErr}</div>}
            </div>
            </OrgStep>

            {/* ── 4 Checklists ── */}
            {(() => {
              const tpl = (checklistTemplates || []).filter((t) => t && t.active !== false && t.bomKey === bomKey);
              const bomChecklistCount = tpl.length;
              const deptsWithList = CHECKLIST_DEPTS.filter((d) => tpl.some((t) => t.department === d));
              return (
            <OrgStep n={4} id="checklists" title="Checklists" hint="What each department must check for this machine model. ✓ = checklist ready."
                     status={<span className="org-step-pill" data-done={deptsWithList.length === CHECKLIST_DEPTS.length ? "1" : "0"}>{deptsWithList.length} of {CHECKLIST_DEPTS.length} ✓</span>}>
              <div className="space-y-3">
                <div className="org-dept-glance" data-org-checklist-glance>
                  {CHECKLIST_DEPTS.map((d) => {
                    const n = tpl.filter((t) => t.department === d).length;
                    return (
                      <button key={d} type="button" data-dept={d} data-has-checklist={n ? "1" : "0"}
                              onClick={() => setShowChecklistPanel(true)}>
                        <span className="org-dept-glance-mark" aria-hidden="true">{n ? "✓" : "–"}</span>
                        <span className="org-dept-glance-name">{d}</span>
                        <span className="org-dept-glance-note">{n ? `${n} checklist${n === 1 ? "" : "s"}` : "No checklist"}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setShowChecklistPanel((v) => !v)}
                    className="flex items-center gap-2 text-[12px] font-bold px-4 py-2 rounded-xl border transition-all"
                    style={{
                      background: showChecklistPanel ? "rgba(139,92,246,0.14)" : "rgba(139,92,246,0.05)",
                      borderColor: showChecklistPanel ? "rgba(139,92,246,0.55)" : "rgba(139,92,246,0.25)",
                      color: "#6d28d9",
                    }}
                  >
                    <span className="text-base">📋</span>
                    <span>Checklist</span>
                    <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full"
                          style={{ background: "rgba(139,92,246,0.2)", color: "#6d28d9" }}>
                      {bomChecklistCount} {bomChecklistCount === 1 ? "set" : "sets"}
                    </span>
                    <span className="text-[11px] text-slate-400">{showChecklistPanel ? "▲ Hide" : "▼ Manage"}</span>
                  </button>
                </div>

            {/* Migration 028 — Department Checklists for THIS BOM. Writes are
                immediate (template rows get bomKey set) because the BOM
                already exists. Hidden when the user lacks machines.configDept.
                2026-10-22: panel is now toggled from the top "Checklist" chip
                so Edit mode stays visually clean until the operator asks for
                it. BomChecklistSlots renders the Before Receive / During
                Work / Before Dispatch grid for each department unchanged. */}
            {canConfigChecklist && showChecklistPanel && (
              <div className="rounded-xl p-4" style={{ background: "rgba(139,92,246,0.04)", border: "1px solid rgba(139,92,246,0.22)" }}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-base">📋</span>
                  <div className="text-[11px] font-bold text-slate-900">Department Checklists for {bomKey}</div>
                  <span className="text-[9px] text-purple-300 px-1.5 py-0.5 rounded-full" style={{ background: "rgba(139,92,246,0.15)" }}>Saved per BOM · past responses untouched</span>
                </div>
                <BomChecklistSlots
                  bomKey={bomKey}
                  allTemplates={checklistTemplates}
                  onSave={onCreateChecklistTemplate}
                  onUpdate={onUpdateChecklistTemplate}
                  onDelete={onDeleteChecklistTemplate}
                />
              </div>
            )}
            {!canConfigChecklist && showChecklistPanel && (
              <div className="rounded-xl p-4 text-[11px] text-slate-400"
                   style={{ background: "rgba(17,24,39,0.03)", border: "1px dashed rgba(17,24,39,0.10)" }}>
                You don't have permission to view or change checklists. Ask an admin with <code>machines.configDept</code>.
              </div>
            )}
              </div>
            </OrgStep>
              );
            })()}

            {/* ── 5 Machine photo ── */}
            <OrgStep n={5} id="photo" title="Machine photo" hint="Shown on every machine card of this model so workers recognise it."
                     status={<span className="org-step-pill" data-done={editPhoto ? "1" : "0"}>{editPhoto ? "✓ Added" : "Not added"}</span>}>
            {/* Migration 061 — machine photo shown on machine cards. */}
            <BomPhotoField value={editPhoto} onChange={setEditPhoto} />
            </OrgStep>

            {editValidationErr && (
              <div className="text-[11px] font-semibold rounded-xl px-4 py-2.5" style={{ background: "rgba(185,28,28,0.08)", color: "#b91c1c", border: "1px solid rgba(185,28,28,0.25)" }}><LeadIcon e="⚠" />{editValidationErr}</div>
            )}
            {(() => { const w = validateBomLines(editItems, findInv).warnings; return w.length ? (
              <div className="text-[10px] rounded-xl px-4 py-2" style={{ background: "rgba(180,83,9,0.08)", color: "#b45309", border: "1px solid rgba(180,83,9,0.25)" }}>{w.map((x, i) => <div key={i}><LeadIcon e="⚠" />{x}</div>)}</div>
            ) : null; })()}
            <div className="org-edit-footer">
              <button onClick={() => { setEditMode(false); resetEditState(); }}
                      className="text-xs font-bold text-slate-400 px-5 py-2.5 rounded-xl border border-slate-200 hover:text-slate-900 hover:border-white/20 transition-all">Discard Changes</button>
              <button onClick={saveBOMEdit}
                      className="text-xs font-black text-slate-900 px-8 py-2.5 rounded-xl transition-all"
                      style={{ background: "#15803d", boxShadow: "0 1px 2px rgba(17,24,39,0.14)", color: "#ffffff" }}>✓ Save BOM</button>
            </div>
          </div></div>

        ) : categories.length === 0 ? (
          <div className="flex-1 py-20 text-center text-slate-600 text-sm">No items match your search or filter.</div>
        ) : (
          /* ── Issue Mode — two-panel layout ── */
          <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
            {/* LEFT: Mechanical, In-House, and any other non-Electrical categories */}
            <div className="flex-1 overflow-y-auto min-w-0" style={{ borderRight: "1px solid rgba(17,24,39,0.04)" }}>
              {colHeader}
              {leftCats.length > 0 ? leftCats.map(renderCategory) : (
                <div className="py-10 text-center text-slate-600 text-xs">No items</div>
              )}
            </div>
            {/* RIGHT: Electrical */}
            {rightCats.length > 0 && (
              <div className="flex-1 overflow-y-auto min-w-0">
                {colHeader}
                {rightCats.map(renderCategory)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Sticky summary bar ── */}
      {!editMode && (
        <div className="bom-summary flex-shrink-0" style={{ background: "var(--surface-card)", borderTop: "1px solid var(--border-subtle)" }}>
          {/* Migration 026 — critical items get a dedicated BOM-Outward popup
              (rendered below, see "Critical Item Confirmation" modal). The
              inline panel that used to live here was moved out so the
              confirmation is impossible to miss and the summary bar stays
              focused on quantities + the issue action. */}
          <div className="px-4 sm:px-6 pt-3">
            <input value={issueNote} onChange={(e) => setIssueNote(e.target.value)}
                   placeholder="Issue reference / note (optional)..."
                   className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-xs text-slate-700 placeholder-slate-400 outline-none focus:border-blue-500/30" />
            {/* ── Pending items (2026-11-01) ──
                A part owed on this machine that is not a BOM line: ordered
                separately, promised later, or not in the Item Master at all.
                Each one becomes a pending job on the machine's serial when
                the BOM is issued, tracked across departments until it is
                completed. Nothing is deducted from stock and no Item Master
                record is created. Needs a serial — the job hangs off the
                machine, so there must be a machine. */}
            {/* 2026-11-04 — also on Fill Rack (owner: both BOM entry points must
                behave the same). Hidden only for an R crate with no machine. */}
            {serialNo && !(rackSet && rackSet.mode === "crate" && rackSet.machineId == null) && (
              <div className="mt-2" data-extra-pending>
                {extraPending.length === 0 ? (
                  <button type="button" data-add-pending-item onClick={() => setExtraPending([emptyPendingJob()])}
                          className="text-[11px] font-bold px-3 py-1.5 rounded-lg border transition-all"
                          style={{ background: "rgba(180,83,9,0.08)", border: "1px solid rgba(180,83,9,0.4)", color: "#b45309" }}
                          title="Record a part owed on this machine that is not part of the BOM">
                    + Add Pending Item
                  </button>
                ) : (
                  <div className="rounded-xl p-2.5" style={{ background: "rgba(180,83,9,0.05)", border: "1px solid rgba(180,83,9,0.28)" }}>
                    <div className="flex items-baseline justify-between gap-2 mb-1.5 flex-wrap">
                      <div className="text-[11px] font-black" style={{ color: "#b45309" }}>
                        Pending items for S/N {serialNo}
                      </div>
                      <div className="text-[10px] text-slate-500">No stock is deducted · nothing is added to Item Master</div>
                    </div>
                    <PendingJobRows rows={extraPending} onChange={setExtraPending} inventory={allFlat}
                                    addLabel="+ Add Pending Item" mode="item" />
                    {extraPendingProblem && <div data-pending-item-problem className="mt-1.5 text-[11px] font-semibold" style={{ color: "#b45309" }}>{extraPendingProblem}</div>}
                  </div>
                )}
              </div>
            )}
            {/* The inline destination radio was removed (2026-06-02c) because
                operators couldn't see it. The destination choice now appears as
                a dedicated popup at commit time — see "Destination popup" below
                near doIssue. */}
          </div>
          {confirmIssue && hasOverIssue && (
            <div className="mx-6 mt-2 px-4 py-2.5 rounded-xl" style={{ background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.28)" }}>
              <div className="text-[10px] font-black mb-1.5" style={{color:"#b45309"}}><LeadIcon e="⚠" />Over-Issue Warning — issuing more than BOM requires:</div>
              <div className="flex flex-wrap gap-3">
                {checkedE.filter((i) => i.overQty > 0).map((i) => (
                  <span key={i.code} className="text-[9px] font-bold font-mono" style={{color:"#b45309"}}>
                    {i.name}: +{i.overQty} {i.unit} extra
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-x-4 gap-y-2.5 px-4 sm:px-6 py-3 flex-wrap">
            {/* Pills */}
            <div className="flex items-center gap-x-3 gap-y-1 flex-1 basis-full sm:basis-auto flex-wrap text-[11px]">
              <span className="text-slate-500"><span className="font-black text-slate-900">{checkedE.length}</span> selected</span>
              <span className="text-slate-700">·</span>
              <span className="text-slate-400">Issuing <span className="font-black text-green-400">{totalIssuing}</span> units</span>
              {totalPending > 0 && (
                <><span className="text-slate-700">·</span>
                <span className="font-bold text-amber-700"><LeadIcon e="⚠" />{totalPending} units pending</span></>
              )}
              {hasOverIssue && (
                <><span className="text-slate-700">·</span>
                <span className="font-bold" style={{color:"#b45309"}}><LeadIcon e="⚠" />{totalOverIssue} over-issued</span></>
              )}
              {missingN > 0 && (
                <><span className="text-slate-700">·</span>
                <span className="text-red-400 font-bold">{missingN} items fully missing</span></>
              )}
            </div>
            <button onClick={onClose} className="text-xs font-bold text-slate-500 px-4 py-2.5 rounded-xl border border-slate-200 hover:text-slate-900 hover:border-white/20 transition-all">Cancel</button>
            {!confirmIssue ? (
              <button onClick={() => {
                        // Anything to check (check points or critical items) →
                        // the single pre-issue popup. Nothing to check → the
                        // lightweight inline confirm, as before.
                        if (verifyLines.length > 0) {
                          setCriticalErr("");
                          setShowCPBrief(true);
                        } else {
                          setConfirmIssue(true);
                        }
                      }}
                      disabled={!canSubmit}
                      className="text-xs font-black px-6 py-2.5 rounded-xl border transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ background: canSubmit ? "#2640B0" : "#9ca3af", color: "#ffffff", boxShadow: canSubmit ? "0 1px 2px rgba(17,24,39,0.14)" : "none", borderColor: "transparent" }}>
                <LeadIcon e="📤" />Issue Stock
              </button>
            ) : (
              <div className="flex items-center gap-2">
                {hasOverIssue
                  ? <span className="text-[10px] font-bold" style={{color:"#b45309"}}><LeadIcon e="⚠" />Confirm over-issue?</span>
                  : <span className="text-[10px] font-bold text-amber-700">Confirm issue?</span>
                }
                <button onClick={() => setConfirmIssue(false)} className="text-xs font-bold text-slate-500 px-3 py-2 rounded-lg border border-slate-200 hover:text-slate-900 transition-all">No</button>
                <button onClick={() => doIssue()} disabled={issuing}
                        className="text-xs font-black text-slate-900 px-5 py-2 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ background: hasOverIssue ? "#b45309" : "linear-gradient(135deg,#16a34a,#15803d)", boxShadow: hasOverIssue ? "0 0 14px rgba(217,119,6,0.4)" : "0 0 14px rgba(34,197,94,0.3)", color: "#ffffff" }}>
                  {issuing ? "⏳ Issuing…" : hasOverIssue ? "⚠ Confirm Over-Issue" : "✓ Confirm Issue"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Migration 037 — per-BOM check points, opened from an edit-mode line.
          Saves onto editItems, which the Save handler already persists, so the
          points land on this BOM only and never touch Item Master. */}
      {editMode && cpEditCode && (() => {
        const line = editItems.find((i) => i.code === cpEditCode);
        if (!line) return null;
        const inv = findInv(cpEditCode);
        const current = Array.isArray(line.checkPoints) ? line.checkPoints
                      : (Array.isArray(inv?.checkPoints) ? inv.checkPoints : []);
        return (
          <BomLineCheckPointsModal
            code={cpEditCode}
            itemName={inv?.name || cpEditCode}
            bomLabel={bom.label || bomKey}
            current={current}
            template={inv?.checkPoints || []}
            onClose={() => setCpEditCode(null)}
            onSave={(pts) => {
              setEditItems((p) => p.map((i) => i.code === cpEditCode ? { ...i, checkPoints: pts } : i));
              setCpEditCode(null);
            }}
          />
        );
      })()}

      {/* ── Pre-issue check (2026-10-30) ─────────────────────────────────────
          One popup for everything the store operator must look at before
          stock leaves: each line's check points (migration 037) and, for
          critical items, the physical-verification tick or serial numbers
          (migration 026). A critical item may be left unverified — it is not
          in the store, or not ordered yet — but only with a written reason;
          that item is then not issued. Non-critical lines show their check
          points for reference and are issued as usual. */}
      {!editMode && showCPBrief && (() => {
        const skippedN   = criticalLines.filter(isCriticalLineSkipped).length;
        const verifiedN  = criticalLines.filter(isCriticalLineReady).length;
        const unresolved = criticalLines.filter((l) => !isCriticalLineResolved(l));
        const closePopup = () => { if (!issuing) { setShowCPBrief(false); setCriticalErr(""); } };
        return (
        <div className="modal-backdrop fixed inset-0 z-[60] flex items-center justify-center p-4"
             style={{ background: "rgba(17,24,39,0.5)", backdropFilter: "blur(14px)" }}
             onClick={(e) => e.target === e.currentTarget && closePopup()}>
          <div className="w-full max-w-2xl rounded-2xl overflow-hidden flex flex-col"
               style={{ maxHeight: "90vh", background: "var(--surface-elevated)",
                        border: "1px solid rgba(217,119,6,0.4)", boxShadow: "0 40px 100px rgba(17,24,39,0.25)" }}>

            <div className="px-6 py-5 border-b border-slate-200 flex items-start justify-between gap-3 flex-shrink-0"
                 style={{ background: "linear-gradient(90deg,rgba(217,119,6,0.12),rgba(217,119,6,0.05))" }}>
              <div>
                <div className="text-[15px] font-semibold text-slate-900"><LeadIcon e="📋" />Check these before issuing</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {bom.label || bomKey}{serialNo ? ` · S/N ${serialNo}` : ""} · {verifyLines.length} item{verifyLines.length === 1 ? "" : "s"} to check
                  {criticalLines.length > 0 && ` · ${criticalLines.length} critical`}
                </div>
              </div>
              <button onClick={closePopup} disabled={issuing} aria-label="Close"
                      className="w-7 h-7 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-500 flex items-center justify-center text-xs font-bold flex-shrink-0 disabled:opacity-40">
                ✕
              </button>
            </div>

            {/* 2026-10-31 — compact list: one row per item with the two
                choices inline; checklist / serials open only when needed. */}
            {criticalLines.length > 0 && (
              <div className="px-4 sm:px-6 py-2.5 border-b border-slate-200 flex items-center justify-between gap-3 flex-wrap flex-shrink-0 text-[11.5px]">
                <div className="flex items-center gap-2 flex-wrap" data-cp-summary>
                  <span className="font-black px-2 py-0.5 rounded-full" style={{ background: "rgba(34,197,94,0.12)", color: "#15803d" }}>✓ {verifiedN} verified</span>
                  <span className="font-black px-2 py-0.5 rounded-full" style={{ background: "rgba(217,119,6,0.12)", color: "#b45309" }}>✗ {skippedN} not issued</span>
                  <span className="font-black px-2 py-0.5 rounded-full" style={{ background: unresolved.length ? "rgba(239,68,68,0.10)" : "rgba(17,24,39,0.05)", color: unresolved.length ? "#dc2626" : "#64748b" }}>{unresolved.length} remaining</span>
                </div>
                <label className="inline-flex items-center gap-1.5 text-slate-600 cursor-pointer select-none">
                  <input type="checkbox" checked={cpRemainingOnly} onChange={(e) => setCpRemainingOnly(e.target.checked)} className="w-3.5 h-3.5" />
                  Remaining only
                </label>
              </div>
            )}
            <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-2">
              {verifyLines.filter((l) => !cpRemainingOnly || (l.inv && l.inv.isCritical && !isCriticalLineResolved(l))).map((l, rowIdx) => {
                const critical = !!(l.inv && l.inv.isCritical);
                const type     = critical && l.inv.outwardInputType === "serial" ? "serial" : "checkbox";
                const state    = criticalInputs[l.code] || {};
                const verified = critical && isCriticalLineReady(l);
                const skipped  = critical && isCriticalLineSkipped(l);
                const choseNot = critical && state.choice === "not";
                const setLine  = (patch) => { setCriticalErr(""); setCriticalInputs((prev) => ({ ...prev, [l.code]: { ...(prev[l.code] || {}), ...patch } })); };
                const points   = l.checkPoints || [];
                const open     = !!cpOpen[l.code];
                const toggle   = () => setCpOpen((prev) => ({ ...prev, [l.code]: !prev[l.code] }));
                // Verified: the checkbox item is confirmed; a serial item opens
                // its serial boxes (verified once every unit has a serial).
                const markVerified = () => {
                  if (!isItemChecked(l.code)) setChecked((prev) => ({ ...prev, [l.code]: true }));
                  if (type === "checkbox") setLine({ choice: "verified", confirmed: true, remark: "" });
                  else { setLine({ choice: "verified", remark: "" }); setCpOpen((prev) => ({ ...prev, [l.code]: true })); }
                };
                // Not verified: cleared, and the reason box appears in the row.
                const markNot = () => setLine({ choice: "not", confirmed: false, serials: [] });
                const status = !critical ? null : verified ? "verified" : skipped ? "not" : "todo";
                const chip = { verified: ["✓ Verified", "#15803d", "rgba(34,197,94,0.12)"], not: ["Not issued", "#b45309", "rgba(217,119,6,0.14)"], todo: ["To verify", "#64748b", "rgba(17,24,39,0.06)"] }[status || "todo"];
                const showSerials = critical && type === "serial" && (open || state.choice === "verified") && !choseNot;
                return (
                  <div key={l.code} data-cp-row={l.code} data-cp-status={status || "info"}
                       className="py-2 px-2 rounded-lg" style={{ borderTop: rowIdx ? "1px solid rgba(17,24,39,0.07)" : "none", background: status === "verified" ? "rgba(34,197,94,0.04)" : status === "not" ? "rgba(217,119,6,0.05)" : "transparent" }}>
                    <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                      <button type="button" onClick={toggle} aria-expanded={open} disabled={!points.length && type !== "serial"}
                              className="w-5 h-5 flex-shrink-0 rounded text-[10px] text-slate-500 hover:bg-slate-100 disabled:opacity-0"
                              title={points.length ? `${points.length} checklist point${points.length === 1 ? "" : "s"}` : ""}>{open ? "▾" : "▸"}</button>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-bold text-slate-900 truncate">
                          {l.name}
                          {critical && <span className="ml-1.5 text-[8.5px] font-black px-1 py-0.5 rounded align-middle" style={{ background: "rgba(239,68,68,0.12)", color: "#dc2626" }}>CRITICAL</span>}
                        </div>
                        <div className="text-[9.5px] text-slate-500"><span className="font-mono">{l.code}</span> · {isItemChecked(l.code) ? `${l.issueQty} ${l.unit}` : `${l.required} ${l.unit} · unticked in list`}{points.length ? ` · ${points.length} check point${points.length === 1 ? "" : "s"}` : ""}</div>
                      </div>
                      {critical ? (
                        <div className="flex items-center gap-1.5 flex-shrink-0 ml-7 sm:ml-0">
                          <span className="text-[9.5px] font-black px-1.5 py-0.5 rounded whitespace-nowrap" style={{ color: chip[1], background: chip[2] }}>{chip[0]}</span>
                          <button type="button" data-cp="verified" onClick={markVerified} disabled={issuing}
                                  className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border whitespace-nowrap"
                                  style={state.choice === "verified" || verified ? { background: "#15803d", color: "#fff", borderColor: "#15803d" } : { background: "#fff", color: "#15803d", borderColor: "rgba(21,128,61,0.4)" }}>
                            ✓ Physically verified
                          </button>
                          <button type="button" data-cp="not" onClick={markNot} disabled={issuing}
                                  className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border whitespace-nowrap"
                                  style={choseNot ? { background: "#b45309", color: "#fff", borderColor: "#b45309" } : { background: "#fff", color: "#b45309", borderColor: "rgba(180,83,9,0.4)" }}>
                            ✗ Not verified
                          </button>
                        </div>
                      ) : (
                        <span className="text-[9.5px] text-slate-500 flex-shrink-0">Issued as usual</span>
                      )}
                    </div>

                    {choseNot && (
                      <div className="mt-1.5 ml-7">
                        <input value={state.remark || ""} autoFocus
                               onChange={(e) => setLine({ remark: e.target.value })}
                               placeholder="Reason (required) — e.g. Not in store, ordered for Monday"
                               className="w-full bg-white rounded-lg px-3 py-1.5 text-[12px] text-slate-900 outline-none modal-input"
                               style={{ border: `1px solid ${criticalRemark(l) ? "rgba(217,119,6,0.45)" : "rgba(239,68,68,0.55)"}` }} />
                        <div className="text-[9.5px] text-slate-500 mt-0.5">Not issued now — its stock is not deducted. The other items are issued as usual.</div>
                      </div>
                    )}

                    {open && points.length > 0 && (
                      <ul className="mt-1.5 ml-7 space-y-1">
                        {points.map((cp, i) => (
                          <li key={i} className="text-[11.5px] text-slate-700 leading-snug flex gap-1.5"><span className="text-slate-400">•</span>{cp}</li>
                        ))}
                      </ul>
                    )}

                    {showSerials && (
                      <div className="mt-1.5 ml-7">
                        <div className="text-[9.5px] text-slate-500 mb-1">One unique serial number per unit ({l.issueQty}).</div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                          {Array.from({ length: l.issueQty }).map((_, idx) => {
                            const val = (state.serials && state.serials[idx]) || "";
                            const alreadyUsed = val.trim() && usedSerials.has(val.toLowerCase().trim());
                            const dupeInBatch = val.trim() && (state.serials || []).filter((x, i) => i !== idx && x && x.toLowerCase().trim() === val.toLowerCase().trim()).length > 0;
                            return (
                              <div key={idx} className="flex flex-col gap-0.5">
                                <input value={val}
                                       onChange={(e) => { const next = (state.serials || []).slice(); next[idx] = e.target.value; setLine({ serials: next, choice: "verified" }); }}
                                       placeholder={`Serial #${idx + 1}`}
                                       className="bg-slate-50 rounded-md px-2 py-1 text-[11px] text-slate-900 outline-none modal-input"
                                       style={{ border: (alreadyUsed || dupeInBatch) ? "1px solid rgba(239,68,68,0.7)" : "1px solid rgba(17,24,39,0.10)" }} />
                                {alreadyUsed && <span className="text-[9px] text-red-500 font-semibold">Already issued</span>}
                                {dupeInBatch && !alreadyUsed && <span className="text-[9px] text-amber-700 font-semibold">Duplicate in list</span>}
                              </div>
                            );
                          })}
                        </div>
                        {hasPartialSerials(l) && !verified && (
                          <div className="text-[10px] font-semibold mt-1" style={{ color: "#dc2626" }}>Complete every serial number, or choose Not verified and give a reason.</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {cpRemainingOnly && unresolved.length === 0 && (
                <div className="py-6 text-center text-[12px] font-semibold" style={{ color: "#15803d" }}>✓ Every critical item is verified or explained.</div>
              )}

              {criticalErr && (
                <div className="text-[11px] font-bold px-3 py-2 rounded-md whitespace-pre-line"
                     style={{ background: "rgba(239,68,68,0.08)", color: "#dc2626", border: "1px solid rgba(239,68,68,0.3)" }}>
                  <LeadIcon e="⚠" />{criticalErr}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between gap-3 flex-shrink-0 flex-wrap"
                 style={{ background: "#f8f9fb" }}>
              <div className="text-[10.5px] text-slate-500">
                {criticalLines.length === 0
                  ? "These points are set for this BOM."
                  : unresolved.length > 0
                    ? `${unresolved.length} critical item${unresolved.length === 1 ? "" : "s"} still to verify or explain`
                    : `${verifiedN} verified${skippedN ? ` · ${skippedN} not issued` : ""} · other items are issued as usual`}
              </div>
              <div className="flex gap-2">
                <Btn variant="ghost" size="sm" onClick={closePopup} disabled={issuing}>Back</Btn>
                <button onClick={() => {
                          if (!allCriticalResolved) {
                            setCriticalErr(`Verify these critical items, or write why they are not being issued: ${unresolved.map((x) => x.name).join(", ")}`);
                            return;
                          }
                          setShowCPBrief(false);
                          // Critical items present → straight on to the issue
                          // engine (durations, destination, commit). Otherwise
                          // the lightweight inline confirm, as before.
                          if (criticalLines.length > 0) doIssue();
                          else setConfirmIssue(true);
                        }}
                        disabled={issuing || !allCriticalResolved}
                        className="text-xs font-black px-5 py-2.5 rounded-xl text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ background: !allCriticalResolved ? "#94a3b8" : skippedN ? "#b45309" : "linear-gradient(135deg,#16a34a,#15803d)", color: "#ffffff" }}>
                  {issuing ? "⏳ Issuing…"
                    : !allCriticalResolved ? "🔒 Verify or explain each critical item"
                    : criticalLines.length === 0 ? "✓ Checked, continue"
                    : skippedN ? `✓ Continue — ${skippedN} not issued`
                    : "✓ Confirm Outward"}
                </button>
              </div>
            </div>
          </div>
        </div>
        );
      })()}

      {/* 2026-10-31 — material gate for R&D / Direct Production BOMs: shown
          instead of committing when components are short. */}
      {materialBlock && (
        <div className="modal-backdrop fixed inset-0 z-[90] flex items-center justify-center p-4"
             style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(12px)" }}
             onClick={(e) => e.target === e.currentTarget && setMaterialBlock(false)}>
          <div role="alertdialog" aria-label="Materials short" className="w-full max-w-md rounded-2xl p-6 space-y-3"
               style={{ background: "var(--surface-elevated)", border: "1px solid rgba(185,28,28,0.4)", boxShadow: "0 40px 80px rgba(17,24,39,0.22)" }}>
            <div className="text-sm font-black" style={{ color: "#b91c1c" }}><LeadIcon e="⚠" />Cannot issue</div>
            <div className="text-[12px] leading-relaxed" style={{ color: "var(--text-muted)" }}>{destError}</div>
            <div className="flex justify-end">
              <button onClick={() => setMaterialBlock(false)} className="text-xs font-bold px-4 py-2 rounded-lg border border-slate-200">OK</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Destination popup (2026-06-02c) ─────────────────────────────────
          Surfaces the rack-vs-direct choice as an unmistakable two-button
          modal. Triggered by doIssue() when there's a serial number and no
          destination has been chosen yet. Either button commits the issue
          with the chosen destination. */}
      {showDestChoice && (
        <div className="modal-backdrop fixed inset-0 z-[90] flex items-center justify-center p-4"
             style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(12px)" }}
             onClick={(e) => e.target === e.currentTarget && !issuing && setShowDestChoice(false)}>
          <div className="w-full max-w-md rounded-2xl overflow-hidden"
               style={{ background: "var(--surface-elevated)", border: "1px solid rgba(46, 80, 214,0.4)", boxShadow: "0 40px 80px rgba(17,24,39,0.22)" }}>
            <div className="px-6 py-5 border-b border-slate-200"
                 style={{ background: "linear-gradient(90deg,rgba(46, 80, 214,0.10),rgba(38, 64, 176,0.05))" }}>
              <div className="text-sm font-black text-slate-900">Where should this build go?</div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {bomKey}{serialNo ? ` · S/N ${serialNo}` : ""}
              </div>
            </div>
            {destError && (
              <div className="mx-5 mt-4 px-3 py-2 rounded-lg text-[11px] font-semibold"
                   style={{ background: "rgba(239,68,68,0.08)", color: "#dc2626", border: "1px solid rgba(239,68,68,0.3)" }}>
                <LeadIcon e="⚠" />{destError}
              </div>
            )}
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-xl p-4 border" style={{ background: "rgba(34,197,94,0.06)", borderColor: "rgba(34,197,94,0.4)" }}>
                <div className="text-2xl mb-1.5">📦</div>
                <div className="text-sm font-black text-emerald-300 mb-1">Empty Rack</div>
                <div className="text-[10px] text-slate-400 leading-relaxed mb-2">
                  {rackTracked ? (rackFreeSlots.length ? "Pick the rack this machine goes into:" : `No empty ${bomKey} rack — start assembly or send a machine on to free one.`) : "This BOM has no rack."}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {rackTracked && rackFreeSlots.map((id, i) => (
                    <button key={id} data-dest="rack" data-slot-choice={id} onClick={() => doIssue("rack", { durationConfirmed: true, slot: id })} disabled={issuing} autoFocus={i === 0}
                            className="text-[12px] font-black px-3 py-2 rounded-lg text-white disabled:opacity-50" style={{ background: "#15803d" }}>
                      {slotLabel(id)}
                    </button>
                  ))}
                </div>
              </div>
              <button data-dest="direct" onClick={() => doIssue("direct", { durationConfirmed: true })} disabled={issuing || checkedE.some((i) => i.pendingQty > 0 && !skippedCodes.has(i.code))}
                      title={checkedE.some((i) => i.pendingQty > 0 && !skippedCodes.has(i.code)) ? "Components are short — Direct Production needs every component issued in full" : undefined}
                      className="text-left rounded-xl p-4 transition-all border disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ background: "rgba(139,92,246,0.08)", borderColor: "rgba(139,92,246,0.4)" }}>
                <div className="text-2xl mb-1.5">▶</div>
                <div className="text-sm font-black text-purple-300 mb-1">Direct Production</div>
                <div className="text-[10px] text-slate-400 leading-relaxed">
                  Skips rack — machine appears in Active Builds at the Assembly stage immediately. For R&D, prototype, custom builds.
                </div>
              </button>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between"
                 style={{ background: "#f8f9fb" }}>
              <div className="text-[10px] text-slate-500">Choose a destination to commit the issue.</div>
              <button onClick={() => !issuing && setShowDestChoice(false)} disabled={issuing}
                      className="text-[11px] font-bold px-3 py-1.5 rounded-lg text-slate-400 border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:text-slate-900 transition-all disabled:opacity-50">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Department Durations popup (migration 027, 2026-10-20) ──────────
          Fires AFTER the critical-item popup and BEFORE the destination
          popup / final commit. Captures per-machine deadlines for the four
          departments in days + hours. Defaults come from the live workflow
          settings (same source as the Settings → Department Workflow page),
          so operators can accept-and-move for the common case. The chosen
          values are saved onto the machine record at creation and are not
          exposed to further routine editing — any later correction must go
          through a controlled process (per spec, intentionally not built). */}
      {!editMode && showDurationModal && (
        <div className="modal-backdrop fixed inset-0 z-[88] flex items-center justify-center p-4"
             style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(12px)" }}
             onClick={(e) => e.target === e.currentTarget && !issuing && setShowDurationModal(false)}>
          <div className="w-full max-w-xl rounded-2xl overflow-hidden flex flex-col"
               style={{ maxHeight: "92vh", background: "var(--surface-elevated)",
                        border: "1px solid rgba(46, 80, 214,0.5)",
                        boxShadow: "0 40px 100px rgba(17,24,39,0.22), 0 0 60px rgba(46, 80, 214,0.08)" }}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between flex-shrink-0"
                 style={{ background: "linear-gradient(90deg,rgba(46, 80, 214,0.14),rgba(38, 64, 176,0.06))" }}>
              <div>
                <div className="text-sm font-black text-slate-900 flex items-center gap-2">
                  <LeadIcon e="⏱️" />Department Durations
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {bomKey}{serialNo ? ` · S/N ${serialNo}` : ""} · lock-in deadlines for this machine
                </div>
              </div>
              <button onClick={() => !issuing && setShowDurationModal(false)} disabled={issuing}
                      className="w-7 h-7 rounded-lg bg-slate-50 hover:bg-red-500/20 hover:text-red-400 text-slate-500 transition-all flex items-center justify-center text-xs font-bold disabled:opacity-40">
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              <div className="text-[11px] text-slate-400 mb-1">
                These durations are saved against this specific machine and drive its
                Machine Tracker deadlines. Pre-filled from settings — override as needed.
                Once Outward is confirmed, these values are locked.
              </div>
              {["Assembly", "Mechanical", "Electrical", "Trial"].map((dept) => {
                const row = durationForm[dept] || { days: 0, hours: 0 };
                const setField = (k, v) => {
                  const n = Math.max(0, Math.floor(Number(v) || 0));
                  setDurationErr("");
                  setDurationForm((prev) => ({ ...prev, [dept]: { ...prev[dept], [k]: n } }));
                };
                return (
                  <div key={dept} className="rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap"
                       style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.10)" }}>
                    <div className="min-w-[110px]">
                      <div className="text-[12px] font-bold text-slate-900">{dept}</div>
                      <div className="text-[9px] text-slate-500 uppercase tracking-wider">deadline</div>
                    </div>
                    <div className="flex items-center gap-2 flex-1 justify-end">
                      <div className="flex items-center gap-1.5">
                        <input type="number" min="0" step="1" value={row.days}
                               onChange={(e) => setField("days", e.target.value)}
                               className="w-16 bg-slate-50 border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-900 outline-none text-right modal-input"
                               style={{ fontFamily: "'Inter',system-ui,sans-serif" }} />
                        <span className="text-[11px] text-slate-500">days</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <input type="number" min="0" max="23" step="1" value={row.hours}
                               onChange={(e) => setField("hours", e.target.value)}
                               className="w-16 bg-slate-50 border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-900 outline-none text-right modal-input"
                               style={{ fontFamily: "'Inter',system-ui,sans-serif" }} />
                        <span className="text-[11px] text-slate-500">hours</span>
                      </div>
                    </div>
                  </div>
                );
              })}
              {durationErr && (
                <div className="text-[11px] font-bold px-3 py-2 rounded-md"
                     style={{ background: "rgba(239,68,68,0.08)", color: "#dc2626", border: "1px solid rgba(239,68,68,0.3)" }}>
                  <LeadIcon e="⚠" />{durationErr}
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between flex-shrink-0"
                 style={{ background: "#f8f9fb" }}>
              <div className="text-[10px] text-slate-500">
                Locked after Outward — plan carefully.
              </div>
              <div className="flex gap-2">
                <button onClick={() => !issuing && setShowDurationModal(false)} disabled={issuing}
                        className="text-[11px] font-bold px-3 py-1.5 rounded-lg text-slate-400 border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:text-slate-900 transition-all disabled:opacity-50">
                  Back
                </button>
                <button onClick={() => {
                          const vErr = validateDurationForm();
                          if (vErr) { setDurationErr(vErr); return; }
                          setShowDurationModal(false);
                          // Hand off to the existing engine. doIssue will now
                          // route to destination popup (serial + rack-tracked)
                          // or commit directly (direct production).
                          doIssue(undefined, { durationConfirmed: true });
                        }}
                        disabled={issuing}
                        className="text-xs font-black text-white px-4 py-1.5 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ background: "#2640B0",
                                 boxShadow: "0 1px 2px rgba(17,24,39,0.14)", color: "#ffffff" }}>
                  ✓ Save Durations & Continue
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
