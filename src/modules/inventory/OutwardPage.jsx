// src/modules/inventory/OutwardPage.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useEffect } from "react";
import { LeadIcon, Glyph } from "../../shared/components/LeadIcon.jsx";
import ItemSearchSelect from "../../shared/components/ItemSearchSelect.jsx";
import { rackOfBom, rackCapacityFor, slotLabel, setLabel, pairSlotOf, rackBoms } from "../../utils/rackSlots.js";
import { BOMDrawer, BOMPasteLines, BomChecklistSlots, BomLineCheckPointsModal, BomPhotoField, DeptDurationFields, RackStatusNote, durationsFormFrom, durationsStoreFrom, validateDurationsForm } from "../bom/index.js";
import { fmtDate, parseStoreQty, roundQty } from "../../shared/format.js";
import { Btn, SectionHeader, statusConfig } from "../../shared/ui/primitives.jsx";
import { Topbar } from "../../shared/ui/Topbar.jsx";
import ArchivedSection from "../../shared/components/ArchivedSection.jsx";
import { archivedBomEntries } from "../../utils/archive.js";

// Last "Fill Rack" request the embedded Outward section has acted on.
export let __lastFillRequestN = 0;

export function OutwardPage({ items, handleUpdateStock, bomDefs, onUpdateBOM, onCreateBOM, onRenameBOM, outwardLog, onAddOutward, pendingLog, onClearPending, onCreateMachine, onAbortMachine = null, onRaiseNotIssued = null, machineLog = [], canDo = () => true, onRemoveRackMachine, onDuplicateBOM, onDeleteBOM, onRestoreBOM = null, computeBOMDeletionInfo, settings = {},
  // 2026-10-30 — embedded: render only the BOM Outward section (with every
  // modal it opens) so Machine Tracker can issue a BOM through this exact
  // component — same BOM data, serial check, popups and issue logic. The
  // Outward page itself renders with embedded=false and is unchanged.
  embedded = false,
  checklistTemplates = [], onCreateChecklistTemplate, onUpdateChecklistTemplate, onDeleteChecklistTemplate, onSaveBomChecklist = null,
  // 2026-10-22 — navigate out of Outward (used by BOM Edit → Critical Items
  // "→ Open Inventory" button). Optional; falls back to no-op.
  onNavigate = () => {},
  // Surfaces a rejected stock movement after the issue drawer has closed.
  onStockIssueFailed = () => {},
  // 2026-10-31 — BOM cost & rates (brief §12).
  pos = [], canSetRate = false, onSetItemRate,
  // 2026-10-31 fixed racks: free slot on a BOM's own rack, and Fill requests.
  rackFreeSlotFor = null, rackFreeSlotsFor = null, bomOpenRequest = null }) {
  // Feature 3: confirm + remove rack machine. The button only appears when a
  // remover prop is provided AND the operator has the permission. Stays in
  // local state so the confirmation persists across re-renders of the modal.
  const [removeRackConfirm, setRemoveRackConfirm] = useState(null); // { machineId, serialNo, bomKey }
  // 2026-06-02d — BOM card actions menu (⋮) state. `actionsKey` is the open
  // card; `confirmDeleteBOM` is the safe-delete confirmation modal.
  const [actionsKey,       setActionsKey]       = useState(null);
  const [actionsUp,        setActionsUp]        = useState(false);
  const [confirmDeleteBOM, setConfirmDeleteBOM] = useState(null); // { key, info }
  const [bomActionToast,   setBomActionToast]   = useState(null);
  // Close the actions menu on any outside click.
  useEffect(() => {
    if (!actionsKey) return;
    const close = () => setActionsKey(null);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [actionsKey]);
  const [openBOM,       setOpenBOM]       = useState(null);
  const [activeSerial,  setActiveSerial]  = useState("");
  const [serialModal,   setSerialModal]   = useState(null); // bomKey waiting for S/N
  const [pendingSerial, setPendingSerial] = useState("");
  const [serialErr,     setSerialErr]     = useState("");
  const [bomUnits,      setBomUnits]      = useState({});
  const [manualCode,    setManualCode]    = useState("");
  const [manualQty,     setManualQty]     = useState("");
  const [manualDept,    setManualDept]    = useState("");
  const [manualNotes,   setManualNotes]   = useState("");
  const [manualError,   setManualError]   = useState("");
  const [manualBusy,    setManualBusy]    = useState(false);
  const [toast,         setToast]         = useState(null);
  // Create BOM modal state
  const [showCreate,    setShowCreate]    = useState(false);
  const [createForm,    setCreateForm]    = useState({ key: "", label: "", rackCapacity: "0" });
  // Migration 041 — durations for the new model, pre-filled from settings.
  const [createDurations, setCreateDurations] = useState(() => durationsFormFrom(null, settings));
  const [createPhoto,     setCreatePhoto]     = useState("");
  const [createItems,   setCreateItems]   = useState([]); // [{ code, qty, checkPoints }]
  // Which create-BOM line has its per-BOM check points open (migration 037).
  const [cpEditCode,    setCpEditCode]    = useState(null);
  const [createAddCode, setCreateAddCode] = useState("");
  const [createAddQty,  setCreateAddQty]  = useState("1");
  const [createErr,     setCreateErr]     = useState("");
  // Migration 028 — buffered checklist slots during BOM Create (bomKey not known
  // yet). Flushed into checklist_templates after the BOM row is created, so
  // every row lands with the real bomKey set.
  const [createChecklists, setCreateChecklists] = useState([]); // [{ department, stage, name, items, _localId }]
  const canConfigChecklist = canDo("machines","configDept");

  const allFlat  = Object.entries(items).flatMap(([cat, list]) => list.map((i) => ({ ...i, category: cat })));
  const findItem = (code) => allFlat.find((i) => i.code === code);
  const findCat  = (code) => findItem(code)?.category;

  const showToast = (text, sub) => { setToast({ text, sub }); setTimeout(() => setToast(null), 3500); };

  const inpCls  = `w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-900 placeholder-slate-500 outline-none modal-input`;
  const selStyle = { background: "var(--surface-input)", color: "var(--text)" };

  const OLabel = ({ text, req }) => (
    <div className="text-[11px] font-medium tracking-tight mb-1.5"
         style={{ color: "#2640B0" }}>
      {text}{req && <span className="text-red-400 ml-0.5">*</span>}
    </div>
  );

  // Current rack occupancy for a model = machines still waiting at the "BOM Issued" stage.
  const rackReadyCount = (key) => machineLog.filter((m) => m.bomKey === key && m.stage === "BOM Issued").length;

  const confirmSerial = () => {
    const sn = pendingSerial.trim();
    if (!sn) { setSerialErr("Serial number is required to proceed."); return; }
    const key = serialModal;
    // 2026-10-31 — rack BOMs (M-10 … R-20) are issued from BOM Outward (the
    // operator then picks an empty rack of that model) or from Rack View →
    // Fill Rack. M and R are independent: each issue takes its own serial.
    const rk = rackOfBom(key);
    if (rk && rk.legacy) { setSerialErr(`${key} is retired — use ${rackBoms(rk.family, rk.tier).primary}.`); return; }
    // Rack-capacity gate moved into handleBOMIssue's rack branch — at this
    // step the operator hasn't yet picked rack vs direct production, so we
    // can no longer block here. A full rack still refuses a Save-To-Rack
    // commit; Direct Production remains available.
    // Block duplicate serials on ANY active machine for this model (rack OR
    // in-production). Active = status !== "completed"; completed builds with
    // the same serial are fine because they're history.
    if (machineLog.some((m) => m.bomKey === key && m.status !== "completed" && (m.serialNo || "").toLowerCase() === sn.toLowerCase())) {
      setSerialErr(`Serial "${sn}" is already active for ${key} (rack or in production).`);
      return;
    }
    // 2026-10-30 — READY is final. Re-issuing a READY machine's serial would
    // put that machine back on the rack, so it is refused.
    if (machineLog.some((m) => m.bomKey === key && (m.status === "completed" || m.stage === "Ready") && (m.serialNo || "").toLowerCase() === sn.toLowerCase())) {
      setSerialErr(`Serial "${sn}" is a READY ${key} machine — a finished machine cannot go back to the rack. Use a new serial.`);
      return;
    }
    setActiveSerial(sn);
    setOpenBOM(serialModal);
    setSerialModal(null);
    setSerialErr("");
  };

  // notIssued lines for the pending jobs a new machine starts with: critical
  // items left unverified (with a reason) at this outward.
  const notIssuedOf = (issued) => (issued || [])
    .filter((it) => it && it.criticalInput && it.criticalInput.notIssued)
    .map((it) => ({ code: it.code, name: it.name, unit: it.unit,
                    qty: Number(it.criticalInput.requiredQty) || Number(it.required) || 0,
                    remark: it.criticalInput.remark || "",
                    critical: it.criticalInput.unselected ? !!it.criticalInput.critical : true }));
  // 2026-11-02 — BOMDrawer calls this BEFORE it moves any stock (Supabase
  // mode: the row is awaited; a refused insert aborts the issue with nothing
  // deducted). The drawer then passes the created machine's id in the issue
  // payload so handleBOMIssue does not create it a second time.
  const handleCreateMachineFirst = async (data) => {
    if (!onCreateMachine) return { success: true, machine: null };
    return onCreateMachine(data.bomKey, data.label, data.serialNo, data.date, data.issueId, data.destination || "rack", data.deptDurations || null, notIssuedOf(data.issued), data.rackSlot || null, data.extraPending || []);
  };

  const handleBOMIssue = (data) => {
    const id  = data.issueId || Date.now();
    const entry = {
      id, type: "bom", date: data.date,
      ref: data.bomKey, label: data.label, units: data.units,
      // 2026-10-31 M/R sets — each rack is its own BOM outward: the M fill
      // creates the machine; the R crate is a separate outward of the R BOM
      // under the same serial (ref = R BOM key), and creates no machine.
      note: data.rackSet ? (data.rackSet.mode === "crate" ? `R crate ${data.rackSet.unit} for machine ${data.serialNo} (set ${data.rackSet.label})` : `Rack ${data.rackSet.unit} (set ${data.rackSet.label})`) : (data.note || "—"),
      items: data.issued,
      serialNo: data.serialNo,
      ...(data.rackSet && data.rackSet.mode === "crate" ? { rackCrate: { slotId: data.rackSet.slotId, setId: data.rackSet.setId, machineId: data.rackSet.machineId } } : {}),
    };
    onAddOutward(entry, data.pending);
    if (data.rackSet && data.rackSet.mode === "crate" && onRaiseNotIssued) {
      const notIssuedCrate = notIssuedOf(data.issued);
      const extraCrate = data.extraPending || [];
      if (notIssuedCrate.length || extraCrate.length) onRaiseNotIssued({ machineId: data.rackSet.machineId, notIssued: notIssuedCrate, bomKey: data.bomKey, serialNo: data.serialNo, issueId: id, rackSlot: data.rackSet.slotId || null, extraPending: extraCrate });
    }
    // data.machineId is set when the drawer already created the machine
    // through handleCreateMachineFirst (the normal path); this branch is the
    // legacy order for a caller that did not.
    if (data.serialNo && onCreateMachine && data.machineId == null && !(data.rackSet && data.rackSet.mode === "crate")) {
      // Feature 1: forward the destination so the machine can skip the rack
      // stage when the operator picked Direct Production (R&D / one-off builds).
      // Migration 027 — forward the per-machine duration overrides captured
      // in the Department Durations popup. Null when the operator somehow
      // skipped the popup (shouldn't happen for serial path, but defensive).
      // 2026-10-30 — critical items left unverified at this outward follow the
      // machine as pending jobs (part missing), so they are not forgotten.
      const notIssued = notIssuedOf(data.issued);
      onCreateMachine(data.bomKey, data.label, data.serialNo, data.date, id, data.destination || "rack", data.deptDurations || null, notIssued, data.rackSlot || null, data.extraPending || []);
    }
    const destSuffix = data.destination === "direct" ? " · direct production" : "";
    showToast(data.rackSet ? `${data.rackSet.unit} filled · ${data.bomKey}` : `${data.bomKey} × ${data.units} issued${destSuffix}`, data.serialNo ? `S/N: ${data.serialNo}` : data.label);
    setActiveSerial("");
    setFillTarget(null);
  };

  const handleManualSubmit = async () => {
    if (manualBusy) return;                 // duplicate production-issue guard
    const n   = parseStoreQty(manualQty);
    const inv = findItem(manualCode);
    if (!inv || !(n > 0))     { setManualError("Select an item and enter a valid quantity."); return; }
    if (inv.stock < n)        { setManualError(`Insufficient stock. Available: ${inv.stock} ${inv.unit}.`); return; }
    setManualError("");
    setManualBusy(true);
    try {
      const res = await handleUpdateStock(findCat(manualCode), manualCode, -n, "Manual Out");
      if (res && res.success === false) return;   // movement rejected — don't log a phantom outward
      const entry = {
        id: Date.now(), type: "manual", date: fmtDate(new Date()),
        ref: "MANUAL", label: "Manual Outward",
        note: manualNotes || "—", dept: manualDept || "—",
        items: [{ code: manualCode, name: inv.name, unit: inv.unit, issueQty: n, pendingQty: 0 }],
      };
      onAddOutward(entry, []);
      showToast(`Issued: ${n} ${inv.unit} of ${inv.name}`, manualDept || "Manual");
      setManualCode(""); setManualQty(""); setManualDept(""); setManualNotes("");
    } finally {
      setManualBusy(false);
    }
  };

  // Retired BOMs (KM10 / KM15 / KM20, replaced 2026-10-31) stay in bomDefs for
  // history and labels but can no longer be issued.
  const boms = Object.entries(bomDefs || {}).filter(([, b]) => !(b && b.retiredAt));

  // 2026-10-31 fixed racks — "Fill Rack" on a Machine Tracker slot opens that
  // rack's own BOM (serial first), with the slot reserved for the new set.
  const [fillTarget, setFillTarget] = useState(null); // { key, slotId }
  useEffect(() => {
    if (!embedded || !bomOpenRequest || !bomOpenRequest.key) return;
    // Each Fill click is consumed once — a remount (page switch, Hide/Show)
    // must not reopen the BOM by itself.
    if (bomOpenRequest.n <= __lastFillRequestN) return;
    __lastFillRequestN = bomOpenRequest.n;
    const b = bomDefs?.[bomOpenRequest.key];
    if (!b || b.retiredAt) return;
    const mode = bomOpenRequest.mode || "set";
    setFillTarget({ key: bomOpenRequest.key, mode, slotId: bomOpenRequest.slotId || null, serialNo: bomOpenRequest.serialNo || null, machineId: bomOpenRequest.machineId ?? null });
    if (mode === "crate") {
      // R crate: the machine's serial is already fixed by its M rack — the
      // R BOM opens directly under that serial; no new serial is asked for.
      setSerialModal(null); setActiveSerial(bomOpenRequest.serialNo || ""); setOpenBOM(bomOpenRequest.key);
      return;
    }
    setOpenBOM(null);
    setSerialModal(bomOpenRequest.key); setPendingSerial(""); setSerialErr("");
  }, [bomOpenRequest && bomOpenRequest.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Create BOM helpers ──
  const openCreateBOM = () => {
    setCreateForm({ key: "", label: "", rackCapacity: "0" });
    setCreateDurations(durationsFormFrom(null, settings));
    setCreatePhoto("");
    setCreateItems([]);
    setCreateAddCode("");
    setCreateAddQty("1");
    setCreateErr("");
    setCreateChecklists([]);
    setShowCreate(true);
  };
  const addCreateItem = () => {
    const qty = parseFloat(createAddQty);
    if (!createAddCode) { setCreateErr("Select a component to add"); return; }
    if (!qty || qty <= 0) { setCreateErr("Enter a valid quantity"); return; }
    if (createItems.some((i) => i.code === createAddCode)) { setCreateErr("Component already added"); return; }
    // Migration 037 — the line inherits a COPY of the item's check-point
    // template. A copy, not a reference: editing the line later must not write
    // back to Item Master, and editing Item Master must not silently rewrite
    // BOMs that were already built against the old points.
    const inv = findItem(createAddCode);
    const inherited = Array.isArray(inv?.checkPoints) ? [...inv.checkPoints] : [];
    setCreateItems((p) => [...p, { code: createAddCode, qty, checkPoints: inherited }]);
    setCreateAddCode(""); setCreateAddQty("1"); setCreateErr("");
  };
  // Bulk counterpart of addCreateItem — commits the lines BOMPasteLines has
  // already previewed. addCreateItem refuses a code that is already listed
  // ("Component already added"), so a pasted duplicate must not create a
  // second line either: its quantity is added to the line already there.
  // Functional-form setState per CLAUDE.md §8.
  const applyPastedCreateItems = (lines) => {
    setCreateErr("");
    setCreateItems((p) => {
      const next = p.map((i) => ({ ...i }));
      for (const l of lines) {
        const at = next.findIndex((i) => i.code === l.code);
        // Rounded like the parser does: the stored BOM line must not carry a
        // 0.30000000000000004-class float artifact into the database.
        if (at >= 0) next[at].qty = Math.round(((Number(next[at].qty) || 0) + l.qty) * 10000) / 10000;
        else {
          // Same inheritance as addCreateItem (migration 037).
          const inv = findItem(l.code);
          next.push({ code: l.code, qty: l.qty, checkPoints: Array.isArray(inv?.checkPoints) ? [...inv.checkPoints] : [] });
        }
      }
      return next;
    });
  };
  const removeCreateItem = (code) => setCreateItems((p) => p.filter((i) => i.code !== code));
  const submitCreateBOM = async () => {
    if (!createForm.key.trim()) { setCreateErr("BOM Key is required"); return; }
    if (!createForm.label.trim()) { setCreateErr("Machine Model Name is required"); return; }
    if (createItems.length === 0) { setCreateErr("Add at least one component"); return; }
    const bomKey = createForm.key.trim().toUpperCase().replace(/\s+/g, "-");
    const dErr = validateDurationsForm(createDurations);
    if (dErr) { setCreateErr(dErr); return; }
    const res = onCreateBOM(bomKey, {
      label: createForm.label,
      items: createItems,
      rackCapacity: createForm.rackCapacity,
      deptDurations: durationsStoreFrom(createDurations),
      photoUrl: createPhoto || null,
    });
    if (res?.success === false) { setCreateErr(res.error); return; }
    // Migration 028 — flush buffered checklists after BOM row exists. Each
    // slot gets the real bomKey set. We fire sequentially so an unexpected
    // failure stops at the first and surfaces the error inline. Non-fatal
    // for the BOM itself — the BOM is already saved; this just populates
    // its optional checklists.
    if (onCreateChecklistTemplate && createChecklists.length > 0) {
      for (const slot of createChecklists) {
        try {
          await onCreateChecklistTemplate({ ...slot, bomKey });
        } catch (e) {
          console.warn("[OutwardPage] checklist flush failed", slot, e);
        }
      }
    }
    showToast(`BOM Created: ${bomKey}`, createForm.label);
    setShowCreate(false);
  };

  return (
    <div className={embedded ? "" : "flex-1 overflow-y-auto"}>

      {/* Serial Number Modal */}
      {serialModal && bomDefs?.[serialModal] && (
        <div className="modal-backdrop fixed inset-0 z-[75] flex items-center justify-center" style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(10px)" }}>
          <div className="bg-white rounded-2xl w-full max-w-md mx-4 overflow-hidden" style={{ border: "1px solid var(--border-rim)", boxShadow: "0 32px 80px rgba(17,24,39,0.18)", animation: "slideUp 0.25s ease both" }}>
            <div className="px-6 py-5" style={{ borderBottom: "1px solid rgba(17,24,39,0.08)", background: "rgba(17,24,39,0.03)" }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-[11px] font-black text-slate-900 flex-shrink-0"
                     style={{ background: bomDefs[serialModal].color + "22", border: `1px solid ${bomDefs[serialModal].color}55` }}>
                  {serialModal}
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-900">{serialModal} — {bomDefs[serialModal].label}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {(() => {
                      const cap = rackCapacityFor(serialModal, bomDefs[serialModal]);
                      const ready = rackReadyCount(serialModal);
                      // Capacity > 0 → rack-tracked, the destination popup at
                      //   commit lets the operator pick Save To Rack vs Direct
                      //   Production.
                      // Capacity = 0 / blank → no rack tracking for this BOM,
                      //   the issue routes straight to Active Builds (Direct
                      //   Production) without prompting.
                      if (fillTarget && fillTarget.key === serialModal && fillTarget.slotId) return `Fill ${slotLabel(fillTarget.slotId)} · enter this machine's serial number`;
                      return cap > 0
                        ? `Enter serial · Rack ${ready} / ${cap} ready · choose destination on commit`
                        : "Enter serial · No rack tracking — goes straight to Active Builds (Direct Production)";
                    })()}
                  </div>
                </div>
              </div>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <div className="text-[11px] font-medium text-blue-300 mb-2">Serial Number <span className="text-red-600">*</span></div>
                <input
                  autoFocus
                  value={pendingSerial}
                  onChange={(e) => { setPendingSerial(e.target.value); setSerialErr(""); }}
                  onKeyDown={(e) => e.key === "Enter" && confirmSerial()}
                  placeholder="e.g. SHT-KM10-2024-001"
                  className="w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-sm placeholder-slate-400 outline-none transition-all"
                  style={{ borderColor: serialErr ? "rgba(239,68,68,0.5)" : "rgba(17,24,39,0.10)", fontFamily: "'Inter',system-ui,sans-serif" }}
                />
                {serialErr && <div className="text-[11px] text-red-400 mt-1.5">{serialErr}</div>}
                <div className="text-[10px] text-slate-600 mt-1.5">This serial number will track the machine through all production stages.</div>
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={() => { setSerialModal(null); setPendingSerial(""); setSerialErr(""); setFillTarget(null); }}
                        className="flex-1 py-2.5 rounded-xl text-sm font-bold text-slate-400 border border-slate-200 hover:text-slate-900 hover:border-white/20 transition-all">
                  Cancel
                </button>
                <button onClick={confirmSerial}
                        className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-all"
                        style={{ background: "#2640B0", boxShadow: "0 1px 2px rgba(17,24,39,0.14)", color: "#ffffff" }}>
                  Proceed to Issue →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2026-06-02d — BOM action toast (Duplicate / Delete result) */}
      {bomActionToast && (
        <div className="fixed bottom-6 right-6 z-[65] flex items-center gap-3 px-5 py-3.5 rounded-2xl"
             style={{ background: "var(--surface-raised)", border: "1px solid rgba(46, 80, 214,0.45)", boxShadow: "0 20px 60px rgba(17,24,39,0.14)", animation: "slideUp 0.3s ease both" }}>
          <span className="text-lg">📋</span>
          <div>
            <div className="text-xs font-bold text-slate-900">{bomActionToast.text}</div>
            {bomActionToast.sub && <div className="text-[10px] text-slate-500 mt-0.5">{bomActionToast.sub}</div>}
          </div>
          <button onClick={() => setBomActionToast(null)} className="ml-2 text-slate-600 hover:text-slate-500 text-xs">✕</button>
        </div>
      )}

      {/* 2026-06-02d — Safe BOM archive confirmation (2026-11-05: archive, never delete) */}
      {confirmDeleteBOM && (
        <div className="modal-backdrop fixed inset-0 z-[85] flex items-center justify-center p-4"
             style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(12px)" }}
             onClick={(e) => e.target === e.currentTarget && setConfirmDeleteBOM(null)}>
          <div className="w-full max-w-md rounded-2xl overflow-hidden"
               style={{ background: "var(--surface-elevated)", border: `1px solid ${confirmDeleteBOM.info.canDelete ? "rgba(239,68,68,0.4)" : "rgba(245,158,11,0.4)"}`, boxShadow: "0 40px 80px rgba(17,24,39,0.22)" }}>
            <div className="px-5 py-4 border-b border-slate-200"
                 style={{ background: confirmDeleteBOM.info.canDelete ? "rgba(239,68,68,0.06)" : "rgba(245,158,11,0.06)" }}>
              <div className={`text-sm font-black ${confirmDeleteBOM.info.canDelete ? "text-red-400" : "text-amber-300"}`}>
                {confirmDeleteBOM.info.canDelete ? `Archive BOM '${confirmDeleteBOM.key}'?` : "⚠ Cannot Archive BOM"}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {confirmDeleteBOM.key} · {confirmDeleteBOM.label}
              </div>
            </div>
            <div className="px-5 py-4 space-y-3 text-[11px]">
              {!confirmDeleteBOM.info.canDelete ? (
                <>
                  <div className="text-slate-500">
                    This BOM has <span className="font-bold text-slate-900">{confirmDeleteBOM.info.active.length}</span> active production build{confirmDeleteBOM.info.active.length !== 1 ? "s" : ""} past the rack stage. Complete or cancel them first, then archive.
                  </div>
                  <div className="max-h-32 overflow-y-auto rounded-lg" style={{ background: "#f8f9fb", border: "1px solid rgba(17,24,39,0.04)" }}>
                    {confirmDeleteBOM.info.active.slice(0, 10).map((m) => (
                      <div key={m.id} className="px-3 py-1.5 text-[10px] flex items-center justify-between border-b border-slate-200 last:border-0">
                        <span className="font-mono font-bold text-slate-900">{m.serialNo || "(no serial)"}</span>
                        <span className="text-slate-500">{m.stage}</span>
                      </div>
                    ))}
                    {confirmDeleteBOM.info.active.length > 10 && (
                      <div className="px-3 py-1.5 text-[10px] text-slate-600 text-center">… and {confirmDeleteBOM.info.active.length - 10} more</div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {confirmDeleteBOM.info.rack.length > 0 ? (
                    <>
                      <div className="text-slate-500">
                        <span className="font-bold text-slate-900">{confirmDeleteBOM.info.rack.length}</span> rack machine{confirmDeleteBOM.info.rack.length !== 1 ? "s" : ""} will be removed. Materials will be returned to stock.
                      </div>
                      <ul className="space-y-1 ml-1">
                        <li className="flex gap-2"><span className="text-emerald-400">✓</span><span className="text-slate-400">Reverse stock for {confirmDeleteBOM.info.rack.length} rack build{confirmDeleteBOM.info.rack.length !== 1 ? "s" : ""}</span></li>
                        <li className="flex gap-2"><span className="text-emerald-400">✓</span><span className="text-slate-400">Clear pending materials for these issues</span></li>
                        <li className="flex gap-2"><span className="text-emerald-400">✓</span><span className="text-slate-400">Remove outward entries from reports</span></li>
                        <li className="flex gap-2"><span className="text-emerald-400">✓</span><span className="text-slate-400">Archive the BOM — it stays saved with its checklists and can be restored</span></li>
                        {confirmDeleteBOM.info.completed.length > 0 && (
                          <li className="flex gap-2"><span className="text-blue-400">ℹ</span><span className="text-slate-400">{confirmDeleteBOM.info.completed.length} completed build{confirmDeleteBOM.info.completed.length !== 1 ? "s" : ""} stay in history</span></li>
                        )}
                      </ul>
                    </>
                  ) : confirmDeleteBOM.info.completed.length > 0 ? (
                    <div className="text-slate-500">
                      BOM has <span className="font-bold text-slate-900">{confirmDeleteBOM.info.completed.length}</span> completed build{confirmDeleteBOM.info.completed.length !== 1 ? "s" : ""} in history. They stay visible in Machine Tracker. The BOM is archived, not deleted.
                    </div>
                  ) : (
                    <div className="text-slate-500">
                      This BOM has never been issued. It will be archived: hidden from the BOM list and issuing, kept with its checklists, and restorable from Archived.
                    </div>
                  )}
                  <div className="text-[10px] text-slate-500 pt-1">Nothing is deleted. Restore it any time from the Archived list below the BOMs.</div>
                </>
              )}
            </div>
            <div className="px-5 py-4 border-t border-slate-200 flex items-center gap-2" style={{ background: "#f8f9fb" }}>
              <button autoFocus onClick={() => setConfirmDeleteBOM(null)}
                      className="text-[11px] font-bold px-3 py-1.5 rounded-lg text-slate-400 border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:text-slate-900 transition-all">
                Cancel
              </button>
              <div className="flex-1" />
              {confirmDeleteBOM.info.canDelete && (
                <button onClick={async () => {
                            const cfm = confirmDeleteBOM;
                            setConfirmDeleteBOM(null);
                            if (!onDeleteBOM) return;
                            const res = await onDeleteBOM(cfm.key);
                            if (res?.success) {
                              const parts = [];
                              if (res.rackCount > 0)      parts.push(`${res.rackCount} rack build${res.rackCount !== 1 ? "s" : ""} cleared`);
                              if (res.restored > 0)       parts.push(`${res.restored} component${res.restored !== 1 ? "s" : ""} returned to stock`);
                              if (res.completedCount > 0) parts.push(`${res.completedCount} completed retained in history`);
                              setBomActionToast({ text: `BOM Archived: ${cfm.key}`, sub: parts.join(" · ") || cfm.label });
                              setTimeout(() => setBomActionToast(null), 4500);
                            } else {
                              setBomActionToast({ text: `Failed to archive ${cfm.key}`, sub: res?.error || "unknown error" });
                              setTimeout(() => setBomActionToast(null), 4500);
                            }
                          }}
                        className="inline-flex items-center gap-1.5 text-[11px] font-bold rounded-lg px-4 py-1.5 text-white border transition-all"
                        style={{ background: "#b45309", borderColor: "rgba(217,119,6,0.5)", color: "#ffffff" }}>
                  <LeadIcon e="🗄" />Archive BOM
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Feature 3: confirm-then-remove rack build modal */}
      {removeRackConfirm && (
        <div className="modal-backdrop fixed inset-0 z-[80] flex items-center justify-center p-4"
             style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(12px)" }}
             onClick={(e) => e.target === e.currentTarget && setRemoveRackConfirm(null)}>
          <div className="w-full max-w-sm rounded-2xl overflow-hidden"
               style={{ background: "var(--surface-elevated)", border: "1px solid rgba(239,68,68,0.4)", boxShadow: "0 40px 80px rgba(17,24,39,0.22)" }}>
            <div className="px-5 py-4 border-b border-slate-200" style={{ background: "rgba(239,68,68,0.06)" }}>
              <div className="text-sm font-black text-red-400"><LeadIcon e="🗑" />Remove Machine From Rack?</div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {removeRackConfirm.bomKey}{removeRackConfirm.serialNo ? ` · S/N ${removeRackConfirm.serialNo}` : ""}
              </div>
            </div>
            <div className="px-5 py-4 space-y-2.5 text-[11px]">
              <div className="text-slate-500">This will:</div>
              <ul className="space-y-1 ml-1">
                <li className="flex gap-2"><span className="text-emerald-400">✓</span><span className="text-slate-400">Restore the issued components to inventory</span></li>
                <li className="flex gap-2"><span className="text-emerald-400">✓</span><span className="text-slate-400">Cancel any pending material requests for this build</span></li>
                <li className="flex gap-2"><span className="text-emerald-400">✓</span><span className="text-slate-400">Remove the outward entry from reports</span></li>
                <li className="flex gap-2"><span className="text-emerald-400">✓</span><span className="text-slate-400">Write an audit log entry</span></li>
              </ul>
              <div className="text-[10px] text-slate-500 pt-1">This action cannot be undone.</div>
            </div>
            <div className="px-5 py-4 border-t border-slate-200 flex gap-2" style={{ background: "#f8f9fb" }}>
              <button autoFocus
                      onClick={() => setRemoveRackConfirm(null)}
                      className="text-[11px] font-bold px-3 py-1.5 rounded-lg text-slate-400 border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:text-slate-900 transition-all">
                Cancel
              </button>
              <div className="flex-1" />
              <button onClick={async () => {
                          const cfm = removeRackConfirm;
                          setRemoveRackConfirm(null);
                          const res = await onRemoveRackMachine(cfm.machineId);
                          if (res?.success) {
                            showToast(`Removed ${cfm.bomKey}${cfm.serialNo ? ` · ${cfm.serialNo}` : ""}`, `${res.restored || 0} component(s) returned to stock`);
                            // (Outward has no start-production modal to close.
                            // The two lines that used to try were copied from
                            // Machine Tracker and threw a ReferenceError here
                            // after every successful removal.)
                          } else {
                            showToast("Failed to remove", res?.error || "unknown error", "error");
                          }
                        }}
                      className="inline-flex items-center gap-1.5 text-[11px] font-bold rounded-lg px-4 py-1.5 text-white border transition-all"
                      style={{ background: "#b91c1c", borderColor: "rgba(239,68,68,0.5)", color: "#ffffff" }}>
                <LeadIcon e="🗑" />Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BOMDrawer overlay */}
      {openBOM && bomDefs?.[openBOM] && (() => {
        // 2026-10-31 M/R sets — a Fill opens that rack's OWN BOM (M and R are
        // never merged): mode "set" = the M BOM under a new serial, placing
        // the machine on the set; mode "crate" = the R BOM under the serial
        // of the machine already on the set.
        const ft = fillTarget && fillTarget.key === openBOM && fillTarget.mode ? fillTarget : null;
        const rackSet = ft ? { mode: ft.mode, key: ft.key, slotId: ft.slotId, setId: ft.slotId, unit: slotLabel(ft.slotId), pairUnit: slotLabel(pairSlotOf(ft.slotId)), label: setLabel(ft.slotId), serialNo: ft.serialNo || null, machineId: ft.machineId ?? null } : null;
        const drawerBom = bomDefs[openBOM];
        return (
        <BOMDrawer
          bomKey={openBOM}
          bom={drawerBom}
          rackSet={rackSet}
          units={rackSet ? 1 : (bomUnits[openBOM] || 1)}
          onUnitsChange={(n) => setBomUnits((p) => ({ ...p, [openBOM]: n }))}
          items={items}
          handleUpdateStock={handleUpdateStock}
          onClose={() => { setOpenBOM(null); setActiveSerial(""); setFillTarget(null); }}
          onIssue={handleBOMIssue}
          onCreateMachineFirst={handleCreateMachineFirst}
          onAbortMachine={onAbortMachine}
          onUpdateBOM={onUpdateBOM}
          onRenameBOM={onRenameBOM}
          allBomKeys={Object.keys(bomDefs || {})}
          onAfterRename={(newKey) => setOpenBOM(newKey)}
          serialNo={activeSerial}
          rackReady={rackReadyCount(openBOM)}
          rackFreeSlot={rackFreeSlotFor ? rackFreeSlotFor(openBOM) : null}
          rackFreeSlots={rackFreeSlotsFor ? rackFreeSlotsFor(openBOM) : []}
          reservedSlot={fillTarget && fillTarget.key === openBOM ? fillTarget.slotId : null}
          settings={settings}
          checklistTemplates={checklistTemplates}
          onCreateChecklistTemplate={onCreateChecklistTemplate}
          onUpdateChecklistTemplate={onUpdateChecklistTemplate}
          onDeleteChecklistTemplate={onDeleteChecklistTemplate}
          onSaveBomChecklist={onSaveBomChecklist}
          canConfigChecklist={canConfigChecklist}
          outwardLog={outwardLog}
          onNavigate={onNavigate}
          onStockIssueFailed={onStockIssueFailed}
          pos={pos}
          canSetRate={canSetRate}
          onSetItemRate={onSetItemRate}
        />
        );
      })()}

      {/* Create BOM Modal */}
      {showCreate && (
        <div className="modal-backdrop fixed inset-0 z-[75] flex items-center justify-center p-4"
             style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(10px)" }}
             onClick={(e) => e.target === e.currentTarget && setShowCreate(false)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl overflow-hidden flex flex-col"
               style={{ border: "1px solid var(--border-rim)", boxShadow: "0 32px 80px rgba(17,24,39,0.18)", maxHeight: "90vh", animation: "slideUp 0.25s ease both" }}>
            <div className="px-6 py-4 flex items-center justify-between flex-shrink-0" style={{ borderBottom: "1px solid rgba(17,24,39,0.08)" }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base" style={{ background: "rgba(46, 80, 214,0.15)" }}>📋</div>
                <div>
                  <div className="text-sm font-black text-slate-900">Create New BOM</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Define a new machine model with components and rack capacity</div>
                </div>
              </div>
              <button onClick={() => setShowCreate(false)} className="text-slate-500 hover:text-slate-900 text-lg leading-none">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <OLabel text="BOM Key" req />
                  <input value={createForm.key} onChange={(e) => { setCreateForm((f) => ({ ...f, key: e.target.value.toUpperCase() })); setCreateErr(""); }}
                    placeholder="e.g. MIX-100" className={inpCls + " font-mono"} />
                  <div className="text-[10px] text-slate-600 mt-1">Unique short code. Used as machine prefix.</div>
                </div>
                <div>
                  <OLabel text="Machine Model Name" req />
                  <input value={createForm.label} onChange={(e) => { setCreateForm((f) => ({ ...f, label: e.target.value })); setCreateErr(""); }}
                    placeholder="e.g. Industrial Mixer 100kg" className={inpCls} />
                </div>
                <div className="col-span-2">
                  <OLabel text="Production Rack" />
                  <RackStatusNote bomKey={createForm.key} />
                </div>
              </div>

              {/* Migration 061 — machine photo shown on machine cards. */}
              <BomPhotoField value={createPhoto} onChange={setCreatePhoto} />

              {/* Migration 041 — department durations for this model */}
              <div className="rounded-xl p-4" style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.08)" }}>
                <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-1">Department Durations</div>
                <div className="text-[10px] text-slate-600 mb-3">Deadline for each department on every machine of this model. Outward copies these onto the machine without asking again.</div>
                <DeptDurationFields value={createDurations} onChange={(v) => { setCreateDurations(v); setCreateErr(""); }} />
              </div>

              <div className="rounded-xl p-4" style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.08)" }}>
                {/* Paste from Excel sits beside the Components heading; its
                    open panel is w-full so flex-wrap drops it onto its own line. */}
                <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
                  <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Components ({createItems.length})</div>
                  <BOMPasteLines inventory={allFlat} existingLines={createItems} onApply={applyPastedCreateItems} />
                </div>
                {createItems.length === 0 ? (
                  <div className="text-[11px] text-slate-600 italic py-3 text-center">No components added yet. Use the row below to add.</div>
                ) : (
                  <div className="space-y-1.5 mb-3">
                    {createItems.map((ci) => {
                      const inv = findItem(ci.code);
                      return (
                        <div key={ci.code} className="grid items-center gap-2 px-3 py-2 rounded-lg"
                             style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.04)", gridTemplateColumns: "var(--bom-create-cols, minmax(0,1fr) 120px 100px 40px)" }}>
                          <div>
                            <div className="text-[11px] font-semibold text-slate-900">{inv?.name || ci.code}</div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <div className="text-[9px] font-mono text-slate-600">{ci.code}</div>
                              {/* Migration 037 — per-BOM check points for this line. */}
                              <button type="button" onClick={() => setCpEditCode(ci.code)}
                                      title="Check points for this BOM"
                                      className="text-[9px] font-bold px-1.5 py-0.5 rounded transition-all"
                                      style={{
                                        background: (ci.checkPoints || []).length ? "rgba(217,119,6,0.12)" : "rgba(17,24,39,0.05)",
                                        color:      (ci.checkPoints || []).length ? "#b45309" : "#64748b",
                                        border:     `1px solid ${(ci.checkPoints || []).length ? "rgba(217,119,6,0.3)" : "rgba(17,24,39,0.12)"}`,
                                      }}>
                                <LeadIcon e="✅" />{(ci.checkPoints || []).length || "+"}
                              </button>
                            </div>
                          </div>
                          <div className="text-[10px] text-slate-500 text-center">{inv?.category || "—"}</div>
                          <div className="flex items-center gap-1.5 justify-end">
                            <input type="number" min="0.1" step="0.1" value={ci.qty}
                              onChange={(e) => setCreateItems((p) => p.map((i) => i.code === ci.code ? { ...i, qty: parseFloat(e.target.value) || 0 } : i))}
                              className="w-16 bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs text-slate-900 text-right outline-none modal-input"
                              style={{ fontFamily: "'Inter',system-ui,sans-serif" }} />
                            <span className="text-[9px] text-slate-600">{inv?.unit || ""}</span>
                          </div>
                          <button onClick={() => removeCreateItem(ci.code)}
                            className="text-red-400 hover:text-red-300 text-[10px] font-bold px-2 py-1 rounded hover:bg-red-500/10 transition-all">✕</button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Migration 037 — per-BOM check points for the selected line. */}
                {cpEditCode && (() => {
                  const line = createItems.find((i) => i.code === cpEditCode);
                  if (!line) return null;
                  const inv = findItem(cpEditCode);
                  return (
                    <BomLineCheckPointsModal
                      code={cpEditCode}
                      itemName={inv?.name || cpEditCode}
                      bomLabel={createForm.label || createForm.key}
                      current={line.checkPoints || []}
                      template={inv?.checkPoints || []}
                      onClose={() => setCpEditCode(null)}
                      onSave={(pts) => {
                        setCreateItems((p) => p.map((i) => i.code === cpEditCode ? { ...i, checkPoints: pts } : i));
                        setCpEditCode(null);
                      }}
                    />
                  );
                })()}

                <div className="flex items-center gap-2 flex-wrap pt-2" style={{ borderTop: "1px dashed rgba(17,24,39,0.10)" }}>
                  <div className="flex-1 min-w-[200px] mt-2">
                    <ItemSearchSelect
                      items={allFlat}
                      value={createAddCode}
                      onChange={setCreateAddCode}
                      excludeCodes={createItems.map((c) => c.code)}
                      placeholder="Search component by name or code…"
                    />
                  </div>
                  <input type="number" min="0.1" step="0.1" value={createAddQty}
                    onChange={(e) => setCreateAddQty(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addCreateItem()}
                    placeholder="Qty"
                    className="w-20 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-900 outline-none mt-2 modal-input text-right"
                    style={{ fontFamily: "'Inter',system-ui,sans-serif" }} />
                  <button onClick={addCreateItem}
                    className="px-4 py-2 rounded-lg text-xs font-bold text-white mt-2"
                    style={{ background: "#2640B0", color: "#ffffff" }}>+ Add</button>
                </div>
              </div>

              {/* Migration 028 — Department Checklists section (optional).
                  Buffered into `createChecklists` and flushed by submitCreateBOM
                  once the BOM row exists so each template lands with the real
                  bomKey. Hidden when the user lacks machines.configDept. */}
              {canConfigChecklist && (
                <div className="rounded-xl p-4" style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.08)" }}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                      Department Checklists (optional) {createChecklists.length ? `· ${createChecklists.length} set` : ""}
                    </div>
                  </div>
                  <BomChecklistSlots
                    bomKey={null}
                    allTemplates={checklistTemplates}
                    pending={createChecklists}
                    setPending={setCreateChecklists}
                  />
                </div>
              )}

              {createErr && (
                <div className="px-3 py-2 rounded-lg text-[11px] text-red-300"
                     style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)" }}>
                  <LeadIcon e="⚠" />{createErr}
                </div>
              )}
            </div>

            <div className="px-6 py-4 flex gap-2 flex-shrink-0" style={{ borderTop: "1px solid rgba(17,24,39,0.08)", background: "#f8f9fb" }}>
              <button onClick={() => setShowCreate(false)}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-900 transition-all"
                style={{ background: "rgba(17,24,39,0.04)", border: "1px solid var(--border-rim)" }}>
                Cancel
              </button>
              <button onClick={submitCreateBOM}
                className="flex-1 py-2.5 rounded-xl text-xs font-black text-slate-900 transition-all"
                style={{ background: "#15803d", boxShadow: "0 1px 2px rgba(17,24,39,0.14)", color: "#ffffff" }}>
                ✓ Create BOM
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] flex items-center gap-3 px-5 py-3.5 rounded-2xl"
             style={{ background: "var(--surface-raised)", border: "1px solid rgba(217, 119, 6,0.45)", boxShadow: "0 20px 60px rgba(17,24,39,0.14)", animation: "slideUp 0.3s ease both" }}>
          <span className="text-lg">📤</span>
          <div>
            <div className="text-xs font-black text-slate-900">{toast.text}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">{toast.sub}</div>
          </div>
          <button onClick={() => setToast(null)} className="ml-2 text-slate-600 hover:text-slate-500 text-xs">✕</button>
        </div>
      )}

      {!embedded && <Topbar title="Outward" subtitle="BOM dispatch & material issue" />}

      <div className={embedded ? "" : "p-6 space-y-6"}>

        {/* ── BOM Cards ── */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-sm font-extrabold text-slate-900"><LeadIcon e="📤" />BOM Outward</h2>
            <span className="text-[10px] font-bold text-amber-700 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">{boms.length} BOMs</span>
            <div className="flex-1" />
            {canDo("outward","editBOM") && onCreateBOM && (
              <button onClick={openCreateBOM}
                className="text-[11px] font-bold px-3 py-1.5 rounded-lg text-white transition-all"
                style={{ background: "#2640B0", boxShadow: "0 1px 2px rgba(17,24,39,0.14)", color: "#ffffff" }}>
                + New BOM
              </button>
            )}
          </div>
          <div className={embedded ? "grid gap-2 grid-cols-[repeat(auto-fill,minmax(210px,1fr))]" : "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"}>
            {boms.map(([bomKey, bom]) => {
              const units     = bomUnits[bomKey] || 1;
              const feasibleN = bom.items.filter(({ code, qty }) => { const inv = findItem(code); return inv && inv.stock >= qty * units; }).length;
              const allFeas   = feasibleN === bom.items.length;
              const noRackTracking = !(rackCapacityFor(bomKey, bom) > 0);
              const openBomFlow = () => { setSerialModal(bomKey); setPendingSerial(""); setSerialErr(""); };
              // 2026-06-02d — ⋮ actions menu. One element, used by both the full
              // Outward card and the compact Machine Tracker row.
              const actionsMenu = (
                      <div className="relative flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            // Open upward when the menu (~190px) would run past the
                            // bottom of the screen (last BOM row on a phone).
                            try { const r = e.currentTarget.getBoundingClientRect(); setActionsUp(window.innerHeight - r.bottom < 200 && r.top > 200); } catch {}
                            setActionsKey(actionsKey === bomKey ? null : bomKey);
                          }}
                          title="BOM actions" aria-label="BOM actions"
                          className="bom-kebab w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-all"
                          aria-haspopup="menu" aria-expanded={actionsKey === bomKey}>
                          ⋮
                        </button>
                        {actionsKey === bomKey && (
                          <div role="menu" onMouseDown={(e) => e.stopPropagation()}
                               className={`absolute right-0 ${actionsUp ? "bottom-full mb-1" : "top-full mt-1"} z-30 w-44 rounded-lg overflow-hidden`}
                               style={{ background: "var(--surface-elevated)", border: "1px solid var(--border-rim)", boxShadow: "0 24px 60px rgba(17,24,39,0.18)" }}>
                            <button onClick={() => { setActionsKey(null); if (canDo("outward","bom")) openBomFlow(); }}
                                    className="w-full text-left px-3 py-2 text-[11px] font-bold text-slate-500 hover:bg-slate-50 hover:text-slate-900 transition-all flex items-center gap-2">
                              <span>📤</span>Open BOM (Issue)
                            </button>
                            <button onClick={() => { setActionsKey(null); setOpenBOM(bomKey); }}
                                    className="w-full text-left px-3 py-2 text-[11px] font-bold text-slate-500 hover:bg-slate-50 hover:text-slate-900 transition-all flex items-center gap-2">
                              <span><Glyph e="✏️" size={14} /></span>Edit BOM
                            </button>
                            {onDuplicateBOM && canDo("outward","bom") && (
                              <button onClick={() => {
                                        setActionsKey(null);
                                        const res = onDuplicateBOM(bomKey);
                                        if (res?.success) {
                                          setBomActionToast({ text: `Duplicated → ${res.newKey}`, sub: bom.label });
                                          setTimeout(() => setBomActionToast(null), 3000);
                                        }
                                      }}
                                      className="w-full text-left px-3 py-2 text-[11px] font-bold text-slate-500 hover:bg-slate-50 hover:text-slate-900 transition-all flex items-center gap-2">
                                <span>📑</span>Duplicate BOM
                              </button>
                            )}
                            {/* Archive BOM (was Delete BOM; 2026-11-05 nothing is
                                ever deleted — the BOM gets retired_at). Gating mirrors Duplicate so the
                                two destructive/configuration actions follow
                                the same permission rule. handleDeleteBOM in
                                App.jsx enforces:
                                  never issued     → direct delete + audit
                                  rack machines    → confirm + reverse stock
                                                     via handleRemoveRackMachine
                                                     + delete BOM definition
                                  active production → block, list blocking
                                                       serials in the modal
                                  completed builds  → retained (denormalised
                                                       bomKey on machine_log)
                                The action is ALWAYS rendered when the operator
                                has bom-edit permission; the destructive rules
                                are enforced by the confirm modal that follows. */}
                            {onDeleteBOM && computeBOMDeletionInfo && canDo("outward","bom") && (
                              <button onClick={() => {
                                        setActionsKey(null);
                                        const info = computeBOMDeletionInfo(bomKey);
                                        setConfirmDeleteBOM({ key: bomKey, label: bom.label, info });
                                      }}
                                      className="w-full text-left px-3 py-2 text-[11px] font-bold text-red-400 hover:bg-red-500/10 transition-all flex items-center gap-2 border-t border-slate-200">
                                <span><Glyph e="🗄" size={14} /></span>Archive BOM
                              </button>
                            )}
                          </div>
                        )}
                      </div>
              );
              // 2026-10-30 — Machine Tracker shows a compact row: the BOM name,
              // Open BOM and the same ⋮ menu. Same openBomFlow, so the serial
              // check, issue popups and stock updates are exactly Outward's.
              if (embedded) return (
                <div key={bomKey} title={bom.label}
                     onClick={() => canDo("outward","bom") && openBomFlow()}
                     className={`section-card relative flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 transition-all ${canDo("outward","bom") ? "cursor-pointer hover:bg-slate-50" : "opacity-60 cursor-not-allowed"}`}
                     // The open ⋮ menu hangs over the rows below. Lift this row
                     // above them, or a click on "Edit BOM" lands on the row
                     // underneath and opens the wrong BOM.
                     style={{ borderLeft: `4px solid ${bom.color}`, zIndex: actionsKey === bomKey ? 40 : undefined }}>
                  <span className="flex-1 min-w-0 truncate text-[13px] font-bold text-slate-900">{bomKey}</span>
                  <button type="button"
                          onClick={(e) => { e.stopPropagation(); if (canDo("outward","bom")) openBomFlow(); }}
                          disabled={!canDo("outward","bom")}
                          className="text-[11px] font-bold text-blue-500 hover:text-blue-700 hover:bg-blue-50 px-2 py-1 rounded-md whitespace-nowrap flex-shrink-0 disabled:opacity-50">
                    Open BOM →
                  </button>
                  {actionsMenu}
                </div>
              );
              return (
                // 2026-06-05h — overflow-hidden REMOVED. The actions menu
                // (Open / Edit / Duplicate / Delete BOM) is absolutely positioned
                // inside the card and is taller than what fits within the card
                // bounds. With overflow-hidden on, the bottom items — Delete
                // BOM specifically — were clipped invisibly, which is why
                // operators reported "Delete BOM is missing from the ⋮ menu"
                // even though the JSX renders it. The rack-card menu on
                // Machine Tracker doesn't have overflow-hidden and shows all
                // items fine; this aligns the BOM card with that pattern.
                // The card has no descendants that would visually overflow
                // its rounded corners, so removing overflow-hidden has no
                // visual side effect.
                <div key={bomKey} onClick={() => canDo("outward","bom") && openBomFlow()}
                     className={`section-card transition-all duration-200 group relative ${canDo("outward","bom") ? "cursor-pointer hover:bg-slate-50" : "opacity-60 cursor-not-allowed"}`}
                     style={{ borderLeft: `4px solid ${bom.color}` }}
                     onMouseEnter={(e) => { e.currentTarget.style.boxShadow = `0 4px 16px ${bom.color}18`; }}
                     onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "none"; }}>
                  <div className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center text-[11px] font-black text-slate-900 flex-shrink-0"
                           style={{ background: bom.color + "22", border: `1px solid ${bom.color}50` }}>{bomKey}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-slate-900">{bomKey}</div>
                        <div className="text-[10px] text-slate-500">{bom.label}</div>
                      </div>
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                            style={{ background: allFeas ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)", color: allFeas ? "#15803d" : "#dc2626", border: `1px solid ${allFeas ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)"}` }}>
                        {feasibleN}/{bom.items.length} ready
                      </span>
                      {actionsMenu}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-3">
                      {bom.items.slice(0, 4).map(({ code, qty }) => {
                        const inv = findItem(code); const ok = inv && inv.stock >= qty * units;
                        return (
                          <span key={code} className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                                style={{ background: ok ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)", color: ok ? "#15803d" : "#dc2626", border: `1px solid ${ok ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}` }}>
                            {code} {inv ? `(${inv.stock})` : ""}
                          </span>
                        );
                      })}
                      {bom.items.length > 4 && <span className="text-[9px] text-slate-600">+{bom.items.length - 4} more</span>}
                    </div>
                    <div className="mt-3 pt-3 border-t border-slate-200 flex items-center justify-between gap-2">
                      <span className="text-[10px] text-slate-600">{bom.items.length} components</span>
                      {/* Capacity-blank BOMs skip the rack entirely. Surface
                          that on the card so operators know the destination
                          popup won't appear and the issue lands directly in
                          Active Builds. */}
                      {noRackTracking && (
                        <span className="text-[8.5px] font-bold px-1.5 py-0.5 rounded-full"
                              style={{ background: "rgba(139,92,246,0.12)", color: "#6d28d9", border: "1px solid rgba(139,92,246,0.3)" }}>
                          ▶ Direct production
                        </span>
                      )}
                      <span className="text-[10px] font-bold text-blue-400 group-hover:text-blue-300 transition-colors ml-auto">Open BOM →</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {/* 2026-11-05 — archived BOMs (never deleted): collapsed, Restore guarded
              by the same permission as Archive. Not on the embedded Machine
              Tracker strip. KM10/KM15/KM20 (replaced by M-10/M-15/M-20) are
              listed for reference but not restorable. */}
          {!embedded && (
            <ArchivedSection kind="BOM" testId="boms" rows={archivedBomEntries(bomDefs)}
                             getKey={([k]) => k} getName={([k, b]) => `${k}${b?.label && b.label !== k ? ` · ${b.label}` : ""}`}
                             getMeta={([, b]) => `${b?.replacedBy ? `Replaced by ${b.replacedBy} · ` : ""}Archived ${b?.retiredAt ? fmtDate(new Date(b.retiredAt)) : ""} · ${(b?.items || []).length} components`}
                             canRestore={!!onRestoreBOM && canDo("outward","bom")} canRestoreRow={([, b]) => !b?.replacedBy}
                             onRestore={async ([k]) => {
                               const res = await onRestoreBOM(k);
                               if (res?.success) { setBomActionToast({ text: `BOM Restored: ${k}`, sub: "Back in the BOM list" }); setTimeout(() => setBomActionToast(null), 3500); }
                               return res;
                             }} />
          )}
        </div>

        {/* ── Pending Stock banner ── */}
        {!embedded && pendingLog && pendingLog.length > 0 && (
          <div className="flex items-center gap-4 px-5 py-3.5 rounded-xl"
               style={{ background: "rgba(217, 119, 6,0.06)", border: "1px solid rgba(217, 119, 6,0.22)" }}>
            <span className="text-xl flex-shrink-0">⏳</span>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-amber-700">{pendingLog.length} item{pendingLog.length !== 1 ? "s" : ""} moved to Pending Stock</div>
              <div className="text-[11px] text-slate-500 mt-0.5">Partially-issued BOM materials are tracked in the Pending Stock module.</div>
            </div>
            {canDo("pending","clear") && (
            <button onClick={onClearPending}
                    className="text-[10px] font-bold text-slate-500 hover:text-red-400 transition-colors flex-shrink-0">
              Clear
            </button>
            )}
          </div>
        )}

        {/* ── Manual Outward ── */}
        {!embedded && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-5">
            <h2 className="text-sm font-extrabold text-slate-900"><LeadIcon e="✋" />Manual Outward</h2>
            <span className="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">Ad-hoc Issue</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <OLabel text="Select Item" req />
              <ItemSearchSelect
                items={Object.entries(items).flatMap(([cat, list]) => list.map((it) => ({ ...it, category: cat })))}
                value={manualCode}
                onChange={setManualCode}
                showStock={true}
                placeholder="Search inventory item by name or code…"
              />
            </div>
            <div>
              <OLabel text="Quantity" req />
              <input type="number" min="0" step="any" value={manualQty} onChange={(e) => setManualQty(e.target.value)}
                     onKeyDown={(e) => e.key === "Enter" && handleManualSubmit()}
                     placeholder="Enter quantity" className={inpCls}
                     style={{ fontVariantNumeric: "tabular-nums", fontFamily: "'Inter',system-ui,sans-serif" }} />
            </div>
            <div>
              <OLabel text="Department / Machine" />
              <input value={manualDept} onChange={(e) => setManualDept(e.target.value)} placeholder="e.g. Production, M-04" className={inpCls} />
            </div>
            <div>
              <OLabel text="Notes" />
              <input value={manualNotes} onChange={(e) => setManualNotes(e.target.value)} placeholder="e.g. Breakdown repair" className={inpCls} />
            </div>
          </div>

          {manualCode && (() => {
            const inv = findItem(manualCode); const n = parseStoreQty(manualQty);
            if (!inv) return null;
            const newS = n > 0 ? roundQty(Math.max(0, inv.stock - n)) : null;
            const sufficient = !n || inv.stock >= n;
            return (
              <div className="mt-4 p-4 rounded-xl grid grid-cols-3 gap-3"
                   style={{ background: sufficient ? "rgba(17,24,39,0.03)" : "rgba(239,68,68,0.04)", border: sufficient ? "1px solid rgba(17,24,39,0.08)" : "1px solid rgba(239,68,68,0.3)" }}>
                <div>
                  <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.06em] mb-1">Current</div>
                  <div className={`text-xl font-black font-mono ${statusConfig[inv.status].text}`} style={{ fontFamily: "'Inter',system-ui,sans-serif" }}>
                    {inv.stock} <span className="text-xs text-slate-500">{inv.unit}</span>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.06em] mb-1">Issuing</div>
                  <div className="text-xl font-black font-mono text-amber-700" style={{ fontFamily: "'Inter',system-ui,sans-serif" }}>
                    −{n > 0 ? n : 0} <span className="text-xs text-slate-500">{inv.unit}</span>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.06em] mb-1">Remaining</div>
                  <div className={`text-xl font-black font-mono ${sufficient ? "text-slate-900" : "text-red-400"}`} style={{ fontFamily: "'Inter',system-ui,sans-serif" }}>
                    {newS !== null ? newS : inv.stock} <span className="text-xs text-slate-500">{inv.unit}</span>
                  </div>
                </div>
              </div>
            );
          })()}

          {manualError && (
            <div className="mt-3 p-3 rounded-xl text-[10px] text-red-400 font-bold"
                 style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.3)" }}>
              <LeadIcon e="⚠" />{manualError}
            </div>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <Btn variant="ghost" size="sm" onClick={() => { setManualCode(""); setManualQty(""); setManualDept(""); setManualNotes(""); setManualError(""); }}>Clear</Btn>
            {canDo("outward","manual") && (
              <button onClick={handleManualSubmit} disabled={manualBusy}
                      className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold text-white border transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ background: "#B45309", borderColor: "rgba(217, 119, 6,0.5)", boxShadow: "0 1px 2px rgba(17,24,39,0.14)", color: "#ffffff" }}>
                {manualBusy ? "⏳ Issuing…" : "📤 Issue Stock"}
              </button>
            )}
          </div>
        </div>

        )}

        {/* ── Outward History ── */}
        {!embedded && outwardLog && outwardLog.length > 0 && (
          <div className="section-card p-5">
            <SectionHeader><LeadIcon e="📋" />Outward History</SectionHeader>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-slate-200">
                  {["Date","Type","Ref","Details","Qty","Note"].map((h) => (
                    <th key={h} className="text-left text-[10px] font-bold text-slate-600 uppercase tracking-wide px-4 py-2">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {outwardLog.map((entry) => (
                    <tr key={entry.id} className="border-b border-slate-200 hover:bg-transparent transition-colors">
                      <td className="px-4 py-2 text-[10px] text-slate-500 font-mono">{entry.date}</td>
                      <td className="px-4 py-2">
                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                              style={{ background: entry.type === "bom" ? "rgba(217, 119, 6,0.1)" : "rgba(46, 80, 214,0.1)", color: entry.type === "bom" ? "#B45309" : "#2640B0", border: `1px solid ${entry.type === "bom" ? "rgba(217, 119, 6,0.2)" : "rgba(46, 80, 214,0.2)"}` }}>
                          {entry.type === "bom" ? "BOM" : "Manual"}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-[10px] font-bold font-mono text-slate-900">{entry.ref}</td>
                      <td className="px-4 py-2 text-[10px] text-slate-400">
                        {entry.type === "bom" ? `${entry.label} × ${entry.units}` : entry.items?.[0]?.name || "—"}
                        {(() => {
                          const crit = (entry.items || []).filter((i) => i && i.criticalInput);
                          if (!crit.length) return null;
                          const title = crit.map((i) => {
                            if (i.criticalInput.notIssued) return `${i.name}: not issued — ${i.criticalInput.remark || "no reason"}`;
                            if (i.criticalInput.type === "serial") return `${i.name}: ${(i.criticalInput.serials || []).join(", ")}`;
                            return `${i.name}: confirmed`;
                          }).join(" | ");
                          return (
                            <span title={title}
                                  className="ml-2 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                                  style={{ background: "rgba(217, 119, 6,0.1)", color: "#B45309", border: "1px solid rgba(217, 119, 6,0.3)" }}>
                              <LeadIcon e="🔒" />{crit.length} critical
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-2 text-[10px] font-bold font-mono text-amber-700">
                        {entry.items ? `${entry.items.reduce((s, i) => s + (i.issueQty || 0), 0)} units` : "—"}
                      </td>
                      <td className="px-4 py-2 text-[10px] text-slate-500">{entry.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
