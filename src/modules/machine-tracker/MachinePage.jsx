// src/modules/machine-tracker/MachinePage.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useEffect, useRef, useMemo } from "react";
import { Wrench, User, Boxes, AlertOctagon, Trash2, Bell } from "lucide-react";
import { celebrate } from "../../utils/worldMotion.js";
import { LeadIcon, LeadLabel, Glyph } from "../../shared/components/LeadIcon.jsx";
import SafeBoundary from "../../shared/components/SafeBoundary.jsx";
import { DEPARTMENT_SEQUENCE, readDeptWorkflowSettings, isClosedDay, nextDepartment, computeElapsedMinutes, computeOverrun, isHoldOverdue, heldMinutes, isRackReleaseHop, formatDuration, canAcceptHandover, canFinishTransfer, canStartAssembly, canConfigureDept, workerIdsOf } from "../../utils/handoverLogic.js";
import { pendingItemIsPart, pendingItemIsDone, pendingItemIsOpen, pendingItemStage, pendingItemRemaining } from "../../stores/pendingItemsStore.js";
import { formatRatingBadge, summarizeMachineRatings } from "../../utils/ratingLogic.js";
import { startChecklistResponse, toggleAnswer, setAnswerRemark, validateChecklistAnswers, checklistProblemText, pickTemplate, setAllAnswers } from "../../utils/checklistLogic.js";
import { reconcileTeam, readTeamMemory, writeTeamMemory } from "../../utils/teamMemory.js";
import { reconcileOpenRecord } from "../../realtime/liveRecord.js";
import { useOnline } from "../../shared/components/OfflineBanner.jsx";
import { pulseOffline } from "../../utils/online.js";
import { isVoiceAttachment, voiceNotesFor } from "../../utils/voiceNote.js";
import { PHYSICAL_RACK_LAYOUT, physicalRackFamily, rackCapacityFor, buildFamilyRacks, slotLabel, rackViewLog, pairSlotOf, bomFillCheck, rCrateIssues, rackBoms } from "../../utils/rackSlots.js";
import { BomPhotoThumb } from "../bom/index.js";
import { ChecklistBulkBar, ChecklistRows, flagChecklist } from "./checklists.jsx";
import { MT_FILTER_LABELS, RACK_UNIT_COLORS, RACK_UNIT_STATUS, RACK_UNIT_STATUS_ORDER } from "./constants.js";
import { DelayReasonsCard, rackFillShortWhy } from "./DelayReasonsCard.jsx";
import { AttachmentLink, ModalX, SenderUndoButton } from "./parts.jsx";
import { StaffMyDashboard } from "./StaffMyDashboard.jsx";
import { CRITICAL_MODES, JobHistory, PendingJobRows, cleanPendingJobs, emptyPendingJob, flagField, pendingItemsProblem } from "../pending-jobs/index.js";
import { AtoZMachineReport, CustomerMachineReport, OnHoldReport, PendingJobsReport, RPT_PERIODS, machineReportRef, printWithTitle, rptCompany } from "../reports/index.js";
import { TrialCertificateModal, TrialCertificatePrintModal } from "../trial-certificate/index.js";
import { waAlertTime, waDispatch } from "../whatsapp/index.js";
import { fmtDate, svgDataUri } from "../../shared/format.js";
import { DISPLAY_STAGES, DISPLAY_STAGE_COLORS, MACHINE_STAGES, STAGE_COLORS, displayStageOf } from "../../shared/machineStages.js";
import { SignaturePad } from "../../shared/ui/SignaturePad.jsx";
import { Topbar } from "../../shared/ui/Topbar.jsx";
import { VoiceNoteLine, VoiceNoteRecorder, VoicePlayButton } from "../../shared/voice/VoiceNote.jsx";
import Count from "../../shared/ui/Count.jsx";
import { toast as sonnerToast } from "../../shared/ui/toast.js";
import { useMtMotion, leftToDoText } from "./mtMotion.js";
import "./mtMotion.css";

// Staff view building blocks (phone first). Defined once at module level so a
// re-render (the 60 s timer tick, a toast, a dialog opening) updates the cards
// in place instead of re-creating them — the cards no longer re-play their
// entrance and the counts can roll. Same markup as before; `mid` (machine id)
// lets the motion layer follow a card from one section to the next.
function StaffSection({ title, count, hint, children }) {
  return (
    <div className="wu-section" data-staff-section={title}>
      <div className="wu-section-head">
        <h2 className="wu-section-title">{title}</h2>
        <span className={`wu-count${count ? " is-on" : ""}`} aria-label={`${count} machines`}><Count value={count} aria-hidden="true" /></span>
        {hint && <span className="wu-section-hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
// Empty state: a small line drawing + one line saying what happens next.
function StaffEmpty({ text }) {
  return (
    <div className="wu-empty">
      <svg viewBox="0 0 64 48" width="56" height="42" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
        <path d="M8 18l24-10 24 10-24 10z" /><path d="M8 18v16l24 10 24-10V18" /><path d="M32 28v16" />
      </svg>
      <span>{text}</span>
    </div>
  );
}
function StaffCard({ children, tone, mid }) {
  return <div className="mt-card no-lift wu-card" data-tone={tone || undefined} data-mt-mid={mid != null ? mid : undefined}>{children}</div>;
}
// The grey Confirm button says what is still missing, in words (display only).
function LeftToDo({ text, ...rest }) {
  if (!text) return null;
  return (
    <div className="mt-left" role="status" {...rest}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
      <span>{text}</span>
    </div>
  );
}

export function MachinePage({ machineLog, outwardLog = [], onIssuePendingPart = null, onUpdateTrialCertificate = null, canView = () => true, onUpdateStage, onNavigate = () => {}, canDo = () => true, bomDefs = {}, onStartProduction, onRemoveRackMachine, onUpdateBOM,
  // 2026-10-30 — the BOM Outward section (an embedded OutwardPage), or null
  // when this role may not issue a BOM.
  bomSection = null,
  // Shortfall rows from BOM Outward. Used to show, on the rack, which
  // components a machine sitting there is still waiting for — the store needs
  // that before anyone tries to start production on it. Optional: [] simply
  // hides the indicator.
  pendingLog = [],
  // Phase A props (optional — the page keeps working if any are missing)
  handovers = [], settings = {}, onFinishTransfer, onAcceptHandover, onRegisterSignature, currentUser = null,
  // Phase B props (optional — fall back to [] when migrations not applied)
  checklistTemplates = [], pendingHandoverItems = [], attachments = [], deptRatings = [],
  // 2026-11-01 — for the full machine report opened from a card.
  checklistResponses = [],
  // 2026-10-30 — Item Master, so a pending job can name the missing part by code.
  items = {},
  onUploadAttachment, onDeleteAttachment, onResolvePendingItem, onReceivePendingItem, onPullBackHandover, onSetMachineHold, onDeleteMachine = null,
  // Migration 028 — During-Work checklist handler. Optional; button hides when
  // no template is configured for the machine's current department.
  onSubmitDuringWorkChecklist,
  // Migration 029 — list of all users (for the Finish-modal worker + Main
  // Employee pickers). Empty array when Supabase isn't enabled or the list
  // hasn't loaded yet; UI falls back to a text hint in that case.
  allUsers = [],
  // Phase 1 — raise a pending item mid-work (Trial finds a fault that belongs
  // to an earlier department). Optional: the button hides when absent.
  onRaisePendingItem,
  // Migration 036 — a production head releases a machine off the rack.
  onReleaseHandover,
  // 2026-10-31 — rack slots (brief §14): pin a rack machine to one slot, or
  // reserve an empty slot for the next BOM set issued for that model.
  onAssignRackSlot, onReserveRackSlot, onFillRack,
  // Material-arrived badge. A critical part issued later from Pending Stock is
  // already recorded as a `pending_fulfilled` audit row, but nothing told the
  // department waiting on it that it had arrived — they found out by asking.
  // Read-only: the badge is derived, nothing new is stored.
  auditLog = [],
  // 2026-11-03 — { filter, n }: the admin Ready popup's "View in Machine
  // Tracker" opens this page on a given filter (n changes per request).
  filterRequest = null }) {
  const [filter,   setFilter]   = useState("active");
  // 2026-10-30 — page layout: two tabs (Production / Transfer & Accept), the
  // Departments Called panel behind a header bell, and a collapsible BOM
  // section. Each remembers nothing it shouldn't: the BOM fold is the only
  // per-browser preference.
  const [mtTab,       setMtTab]       = useState("production");
  const [searchQ,     setSearchQ]     = useState("");
  useEffect(() => {
    if (!filterRequest || !filterRequest.filter) return;
    setMtTab("production"); setSearchQ(""); setFilter(filterRequest.filter);
  }, [filterRequest?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const [showCalled,  setShowCalled]  = useState(false);
  // Open by default on a wide screen; on a phone the six BOM cards would push
  // the machines a full screen down, so it starts folded there. An explicit
  // choice is remembered either way.
  const [bomOpen,     setBomOpen]     = useState(() => {
    try { const v = localStorage.getItem("erp_mt_bom_open"); if (v !== null) return v === "1"; } catch {}
    return typeof window === "undefined" || window.innerWidth >= 768;
  });
  const toggleBom = () => setBomOpen((v) => { try { localStorage.setItem("erp_mt_bom_open", v ? "0" : "1"); } catch {} return !v; });
  const [expanded, setExpanded] = useState(null);
  const [stageMap, setStageMap] = useState({});
  // Phase 1 — "Update Stage" is a legacy Phase-A escape hatch that skips the
  // whole handover chain (no signature, no checklist, no rating, no handover
  // row). It stays for admins to correct mistakes and is hidden from operators,
  // who use Finish & Transfer. Role keys mirror authStore.DEFAULT_ROLES.
  const isAdminUser = currentUser?.role === "super_admin" || currentUser?.role === "Admin";
  // Phase 1 — raise-issue modal: { machine } while open.
  const [raiseModal, setRaiseModal] = useState(null);
  // 2026-11-01 — machine whose full report is open (id), or null.
  const [reportMachineId, setReportMachineId] = useState(null);
  // Prints only the report: the body class hides the rest of the page.
  const printMachineReport = () => {
    const m = machineLog.find((x) => String(x.id) === String(reportMachineId));
    printWithTitle(machineReportRef(m), { bodyClass: "print-machine-report" });
  };
  // 2026-11-03 — the four PDF reports. reportsMenu = the "Reports" chooser is
  // open; reportDoc = { kind: "customer"|"company"|"hold"|"pending", machineId }
  // is the report on screen (the Company report also opens via reportMachineId).
  const [reportsMenu, setReportsMenu] = useState(false);
  const [reportDoc, setReportDoc] = useState(null);
  const [reportPick, setReportPick] = useState("");
  const [holdPeriod, setHoldPeriod] = useState("this_month");
  const [pendIncludeDone, setPendIncludeDone] = useState(false);
  const [pendDept, setPendDept] = useState("");
  const openReport = (kind, machineId = null) => { setReportsMenu(false); setReportMachineId(null); setReportDoc({ kind, machineId }); };
  const closeReports = () => { setReportDoc(null); setReportMachineId(null); };
  const printReportDoc = () => {
    if (!reportDoc) return;
    const m = machineLog.find((x) => String(x.id) === String(reportDoc.machineId));
    const day = new Date().toISOString().slice(0, 10);
    const title = reportDoc.kind === "customer" ? `CR-${m ? `${m.bomKey}-${m.serialNo || m.id}` : day}`
      : reportDoc.kind === "company" ? machineReportRef(m)
      : reportDoc.kind === "hold" ? `On-hold-report-${holdPeriod}-${day}` : `Pending-jobs-report-${day}`;
    printWithTitle(title, { bodyClass: "print-machine-report" });
  };
  // 2026-10-30 — pending jobs: part lookup + receive/complete actions.
  // Item Master by code — the rack crate face and the rack details panel both
  // ask it for stock when they run bomFillCheck. It used to live inside the
  // panel's own block, where the crate face could not see it (2026-11-01).
  const itemByCode = useMemo(() => {
    const by = {};
    Object.values(items || {}).forEach((l) => (Array.isArray(l) ? l : []).forEach((i) => { if (i && i.code) by[i.code] = i; }));
    return by;
  }, [items]);
  const inventoryFlat = useMemo(() => Object.entries(items || {}).flatMap(([cat, list]) => (list || []).map((i) => ({ code: i.code, name: i.name, unit: i.unit, category: cat }))), [items]);
  const [attachAsk, setAttachAsk] = useState(null); // { kind: "upload"|"delete", machine, file, a, busy }
  const [jobAction, setJobAction] = useState(null); // { item, action: "receive"|"complete", notes, busy, error }
  // 2026-10-31 — machine whose pending jobs are open in the card drawer.
  const [jobsDrawer, setJobsDrawer] = useState(null); // machine id
  const [jobsView,  setJobsView]  = useState("open"); // Pending Jobs tab: open | done | all
  const [pullBack,  setPullBack]  = useState(null);   // { handover, reason, busy, error } — admin pull back
  const [undoAsk,   setUndoAsk]   = useState(null);   // { handover, busy } — 2026-11-03 sender Undo (5 min)
  const [deleteModal, setDeleteModal] = useState(null); // { machine, reason, busy, error } — Super Admin machine deletion (2026-11-03)
  const [holdModal, setHoldModal]  = useState(null);   // { machine, release, reason, busy, error } — manual ON HOLD / release (2026-11-02)
  const [raiseText,  setRaiseText]  = useState("");
  const [raiseDept,  setRaiseDept]  = useState("");
  const [raiseErr,   setRaiseErr]   = useState("");
  const [raiseBusy,  setRaiseBusy]  = useState(false);
  const [raisePart,  setRaisePart]  = useState(emptyPendingJob()); // optional missing part on a reported issue
  // 2026-11-04 (owner) — the 🎤 inside a text box only writes TEXT into
  // that box (no audio saved), so it is offered wherever the box is shown.
  const canVoice = true;
  const voiceUserName = (id) => {
    if (!id) return "";
    const u = (allUsers || []).find((x) => x.id === id);
    if (u) return u.fullName || u.username || "";
    return currentUser && currentUser.id === id ? (currentUser.fullName || currentUser.username || "") : "";
  };

  const [toast,    setToast]    = useState(null);
  // Phase 1 motion (visual only): cards glide between sections, the route
  // pill slides, closing sheets animate out. See ./mtMotion.js.
  const mtRootRef = useRef(null);
  useMtMotion(mtRootRef);
  const [issuePopup, setIssuePopup] = useState(null); // pendingHandoverItem for the detail popup
  const [startProd, setStartProd] = useState(null); // rack object { key, label, ready, capacity }
  const [startSel,  setStartSel]  = useState(() => new Set()); // selected rack-machine ids
  const [startErr,  setStartErr]  = useState("");
  // 2026-06-02 — confirm-modal state for rack remove. Feature 3 (rack remove)
  // shipped without these declarations in MachinePage, so referencing them
  // inside the Start Production modal threw ReferenceError and blanked the
  // page on any rack-card click. This restores the state + the confirm modal
  // render so both Outward and Machine Tracker can remove rack machines.
  const [removeRackConfirm, setRemoveRackConfirm] = useState(null); // { machineId, serialNo, bomKey }


  // Phase A — department workflow state.
  const workflow = readDeptWorkflowSettings(settings);
  // Minute-tick to re-render HOLD badges + overrun chips without a cron. Zero
  // network traffic; just forces a React re-render every 60s. Clock drift is
  // minor over a 2h accept window.
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);
  const [finishModal, setFinishModal] = useState(null); // { machine, toDepartment, narration }
  // Migration 032 — Trial Certificate modal state.
  const [trialCertModal,     setTrialCertModal]     = useState(null); // { machine, editOnly? }
  const [trialCertViewModal, setTrialCertViewModal] = useState(null); // machine object
  // Migration 028 — During-Work checklist runtime modal.
  const [duringWorkModal, setDuringWorkModal] = useState(null); // { machine, template, answers, busy, error }
  // 2026-11-03 — Assembly "Before Starting Work" checklist, asked when a rack
  // machine's Assemble is pressed. { queue: [machine], idx, ids, template, answers, marks, busy, error, after }
  const [startChk, setStartChk] = useState(null);
  const [acceptModal, setAcceptModal] = useState(null); // { handover, password, sigSvg, busy, error }
  // 2026-11-03 — offline: Confirm Acceptance is disabled (popup keeps the
  // signature / team / ticks) and a tap pulses the "No internet" banner.
  const online = useOnline();
  const [transferBusy, setTransferBusy] = useState(false);

  // Pending handovers filtered to those awaiting acceptance.
  const pendingHandovers = (handovers || []).filter((h) => h && h.status === "pending");
  // Migration 036 — sent, but parked on the rack until a production head
  // releases it to the receiving department. Pre-036 rows read as false.
  // 2026-10-31 — only a PENDING hand-over parks a machine on the rack. A
  // pulled-back (cancelled) or released one must not keep the rack showing
  // "Assembled · Ready" with an active Transfer button.
  const isAwaitingRelease = (h) => !!(h && h.status === "pending" && h.releaseRequired && !h.releasedAt);
  const askableHandovers  = pendingHandovers.filter((h) => !isAwaitingRelease(h));
  const overdueHandovers = pendingHandovers.filter((h) =>
    !isAwaitingRelease(h) && isHoldOverdue(h.sentAt, h.acceptTimeoutMinutes, nowTick));

  // ── WhatsApp trigger: deadline exceeded (once per handover) ──
  const waDeadlineAlertedRef = React.useRef(new Set());
  useEffect(() => {
    if (!settings.waNotifyDeadline || !settings.waApiKey || !overdueHandovers.length) return;
    const newOverdue = overdueHandovers.filter((h) => !waDeadlineAlertedRef.current.has(h.id));
    if (!newOverdue.length) return;
    (async () => {
      try {
        for (const h of newOverdue) {
          const machine = machineLog.find((m) => String(m.id) === String(h.machineId));
          const waited = Math.round((Date.now() - new Date(h.sentAt).getTime()) / 60000);
          const msg = `🔴 Deadline Exceeded\nMachine: ${machine?.bomKey || "?"}${machine?.serialNo ? ` [${machine.serialNo}]` : ""}\n${h.fromDepartment} → ${h.toDepartment}\nWaiting: ${waited} min (limit ${h.acceptTimeoutMinutes || "?"} min)`;
          const params = [
            "Deadline Exceeded",
            `${machine?.bomKey || "?"}${machine?.serialNo ? ` (${machine.serialNo})` : ""}`,
            `${h.fromDepartment} to ${h.toDepartment}`,
            `Waiting ${waited} min, limit ${h.acceptTimeoutMinutes || "?"} min`,
            waAlertTime(),
          ];
          const phones = [settings.waOwnerPhone, settings.waGroupNumbers].filter(Boolean).join(",");
          waDispatch(settings, phones, msg, params);
          waDeadlineAlertedRef.current.add(h.id);
        }
      } catch (e) { console.warn("[WhatsApp] deadline effect error", e); }
    })();
  }, [overdueHandovers, settings.waNotifyDeadline, settings.waApiKey, settings.waOwnerPhone, settings.waGroupNumbers, settings.waPhoneId, machineLog]);

  // Smart Notifications — priority: "urgent" 🔴 / "warning" 🟡 / "info" 🟢 (default)
  const showToast = (text, sub, priority) => {
    const p = priority || "info";
    const dur = p === "urgent" ? 6000 : p === "warning" ? 4500 : 3000;
    setToast({ text, sub, priority: p });
    setTimeout(() => setToast(null), dur);
  };
  // Big red message when any save did not reach the server.
  useEffect(() => {
    const onFail = () => showToast("❌ NOT SAVED", "Check your internet, then press the button again.", "urgent");
    window.addEventListener("erp-save-failed", onFail);
    return () => window.removeEventListener("erp-save-failed", onFail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open the Finish & Transfer modal for a given machine.
  // Everyone who may be recorded as having worked in a department today:
  // ERP logins assigned to it, plus the factory workers from Settings →
  // Employees. Same two filters the Finish-modal picker renders from, pulled
  // out so the remembered-crew pre-selection is reconciled against exactly the
  // list the operator is about to see — never against a stale idea of it.
  const eligibleWorkerIds = (dept) => {
    if (!dept) return [];
    const logins = (allUsers || [])
      .filter((u) => u && u.status !== "disabled" && Array.isArray(u.departments) && u.departments.includes(dept))
      .map((u) => u.id);
    const workers = (settings?.employeeMembers || [])
      .filter((m) => m && m.active && Array.isArray(m.departments) && m.departments.includes(dept))
      .map((m) => `emp:${m.id}`);
    return [...logins, ...workers];
  };

  const openFinishModal = (machine) => {
    const toDepartment = nextDepartment(machine.currentDepartment || machine.stage);
    if (!toDepartment) {
      showToast("No further department", `${machine.bomKey} is at ${machine.stage} — no transfer possible.`);
      return;
    }
    const fromDepartment = machine.currentDepartment || machine.stage;
    // Migration 032 — Trial → Ready uses the full Trial Certificate form instead of the normal finish modal.
    if (fromDepartment === "Trial" && toDepartment === "Ready") {
      setTrialCertModal({ machine });
      return;
    }
    // Migration 028 — BOM-scoped checklist lookup, with legacy dept-only
    // fallback for machines whose BOM hasn't configured its own before_dispatch
    // slot yet. See src/utils/checklistLogic.js:pickTemplate for the cascade.
    const template = pickTemplate(checklistTemplates, machine.bomKey, fromDepartment, "before_dispatch");
    const answers  = template ? startChecklistResponse(template) : [];
    // 2026-11-02 — Transfer does not ask for or log employee names. The
    // transfer is recorded under the logged-in user (sentBy) and their own
    // signature; the department that is handing over is the responsibility
    // record. (Accept keeps its employee logging exactly as before.)
    setFinishModal({ machine, toDepartment, narration: "", template, answers,
                     workedBy: [], mainEmployeeId: currentUser?.id || null,
                     // Phase 1 — jobs this department still owes after handing over.
                     owedItems: [] });
  };

  // Migration 028 — During-Work runtime. Opens the modal only when a template
  // exists for this machine's current department. Non-blocking: operator can
  // submit anytime between Accept and Finish & Transfer.
  const openDuringWorkModal = (machine) => {
    const dept = machine.currentDepartment || machine.stage;
    const template = pickTemplate(checklistTemplates, machine.bomKey, dept, "during_work");
    if (!template) return;
    setDuringWorkModal({ machine, template, answers: startChecklistResponse(template), busy: false, error: "" });
  };
  const submitDuringWork = async () => {
    if (!duringWorkModal || duringWorkModal.busy) return;
    const { machine, template, answers } = duringWorkModal;
    const chk = validateChecklistAnswers(answers);
    if (!chk.ok) {
      setDuringWorkModal((prev) => prev ? { ...prev, error: checklistProblemText(chk) } : prev);
      flagChecklist("[data-during-checklist]");
      return;
    }
    setDuringWorkModal((prev) => prev ? { ...prev, busy: true, error: "" } : prev);
    const r = await onSubmitDuringWorkChecklist?.({ machine, template, answers });
    if (r && r.success === false) {
      setDuringWorkModal((prev) => prev ? { ...prev, busy: false, error: r.error || "Save failed" } : prev);
      return;
    }
    setDuringWorkModal(null);
    showToast("During-Work checks saved", `${machine.bomKey}${machine.serialNo ? ` · S/N ${machine.serialNo}` : ""} · ${machine.currentDepartment || machine.stage}`);
  };

  // 2026-11-03 — Assemble on a rack machine first asks the Assembly
  // "Before Starting Work" checklist (template stage before_receive) for every
  // selected machine whose BOM has one; only then is onStartProduction called,
  // unchanged. No template → starts exactly as before.
  const startChkTemplate = (m) => pickTemplate(checklistTemplates, m.bomKey, "Assembly", "before_receive");
  const startWithChecklist = (ids, after) => {
    const queue = machineLog.filter((m) => ids.includes(m.id) && m.stage === "BOM Issued" && startChkTemplate(m));
    if (!queue.length || !onSubmitDuringWorkChecklist) { after(onStartProduction ? onStartProduction(ids) : { success: false }); return; }
    const t = startChkTemplate(queue[0]);
    setStartChk({ queue, idx: 0, ids, template: t, answers: startChecklistResponse(t), busy: false, error: "", after });
  };
  const submitStartChk = async () => {
    if (!startChk || startChk.busy) return;
    const { queue, idx, ids, template, answers, after } = startChk;
    const chk = validateChecklistAnswers(answers);
    if (!chk.ok) {
      setStartChk((prev) => prev ? { ...prev, error: checklistProblemText(chk) } : prev);
      flagChecklist("[data-start-checklist]");
      return;
    }
    setStartChk((prev) => prev ? { ...prev, busy: true, error: "" } : prev);
    const machine = queue[idx];
    const r = await onSubmitDuringWorkChecklist({ machine, template, answers, stage: "before_receive", department: "Assembly" });
    if (r && r.success === false) { setStartChk((prev) => prev ? { ...prev, busy: false, error: r.error || "NOT SAVED" } : prev); return; }
    if (idx + 1 < queue.length) {
      const t = startChkTemplate(queue[idx + 1]);
      setStartChk({ ...startChk, idx: idx + 1, template: t, answers: startChecklistResponse(t), busy: false, error: "" });
      return;
    }
    setStartChk(null);
    after(onStartProduction ? onStartProduction(ids) : { success: false });
  };

  // 2026-10-31 — complete / correct an already-saved certificate (no transfer).
  const saveTrialCertificate = async ({ cert }) => {
    if (!trialCertModal || transferBusy) return;
    const { machine } = trialCertModal;
    setTransferBusy(true);
    try {
      const res = onUpdateTrialCertificate ? await onUpdateTrialCertificate(machine.id, cert) : { success: false, error: "Not available" };
      if (res && res.success === false) { showToast("Could not save", res.error || "Unknown error", "urgent"); return; }
      setTrialCertModal(null);
      showToast(`${machine.bomKey}${machine.serialNo ? ` · S/N ${machine.serialNo}` : ""}`, "Trial Certificate updated.");
    } finally {
      setTransferBusy(false);
    }
  };
  // Migration 032 — Trial Certificate submit handler. Called by TrialCertificateModal.
  const submitTrialCertificate = async ({ cert, narration, actualDurationMinutes, expectedDurationMinutes }) => {
    if (!trialCertModal || transferBusy) return;
    const { machine } = trialCertModal;
    setTransferBusy(true);
    try {
      const res = await onFinishTransfer({
        machineId: machine.id,
        fromDepartment: "Trial",
        toDepartment: "Ready",
        expectedDurationMinutes,
        actualDurationMinutes,
        overrunNarration: narration || null,
        checklistTemplate: null,
        checklistAnswers: [],
        workedBy: [],
        workedBySnapshot: null,
        mainEmployeeId: null,
        mainEmployeeSignatureSvg: null,
        trialCertificate: cert,
      });
      if (res && res.success === false) {
        showToast("Transfer failed", res.error || "Unknown error", "urgent");
        return;
      }
      setTrialCertModal(null);
      celebrate("Sent");   // world UI: success moment (visual only)
      sonnerToast.success(`${machine.bomKey} sent to Ready`, { description: `${machine.serialNo ? `S/N ${machine.serialNo} · ` : ""}Trial Certificate saved. Awaiting Ready acceptance.` });
    } finally {
      setTransferBusy(false);
    }
  };

  const submitFinishTransfer = async () => {
    if (!finishModal || transferBusy) return;
    const { machine, toDepartment, narration, template, answers,
            owedItems = [] } = finishModal;
    const fromDepartment = machine.currentDepartment || machine.stage;
    // Migration 027 — prefer the per-machine override captured at Outward.
    // Falls back to the live workflow setting for machines created before
    // the duration popup existed (deptDurations=null).
    const expectedCfg = (machine.deptDurations && machine.deptDurations[fromDepartment])
      || workflow.dept_durations[fromDepartment];
    const expectedDurationMinutes = (expectedCfg && expectedCfg.minutes) || 0;
    const { actualMinutes, overrunMinutes, isOverrun } = computeOverrun(
      machine.departmentEnteredAt, expectedDurationMinutes, nowTick
    );
    if (isOverrun && !narration.trim()) {
      flagField("[data-transfer-delay]");
      return;
    }
    // Phase B — enforce "every unchecked item has a remark" before submit.
    if (template && Array.isArray(answers) && answers.length) {
      const chk = validateChecklistAnswers(answers);
      if (!chk.ok) {
        flagChecklist("[data-transfer-checklist]");
        return;
      }
    }
    { const pp = pendingItemsProblem(owedItems); if (pp) { flagField("[data-transfer-pending]"); return; } }
    // 2026-11-02 — no signature and no worker / main-employee names are
    // collected at Transfer; the signed-in user is recorded as the transferer.
    if (!currentUser?.id) { showToast("Not signed in", "Sign in again to transfer.", "warning"); return; }
    const transferrerName = currentUser.fullName || currentUser.username || null;
    setTransferBusy(true);
    try {
      const res = await onFinishTransfer({
        machineId: machine.id,
        fromDepartment,
        toDepartment,
        expectedDurationMinutes,
        actualDurationMinutes: actualMinutes,
        overrunNarration: narration.trim() || null,
        checklistTemplate: template || null,
        checklistAnswers:  Array.isArray(answers) ? answers : [],
        workedBy:          [],             // Transfer logs no employee names
        workedBySnapshot:  null,
        // Phase 1 — jobs this department still owes on the machine it is
        // handing over. Recorded against fromDepartment, not the receiver.
        owedItems:         cleanPendingJobs(owedItems),
        // The signer is the logged-in user who is transferring (not a picked employee).
        mainEmployeeId: currentUser.id,
        mainEmployeeRef: currentUser.id,
        mainEmployeeName: transferrerName,
        mainEmployeeSignatureSvg: null,   // Transfer needs no signature (Accept still does)
        actingMainEmployeeId: null,
      });
      if (res && res.success === false) {
        showToast("Transfer failed", res.error || "Unknown error", "urgent");
        return;
      }
      setFinishModal(null);
      celebrate("Sent");   // world UI: success moment (visual only)
      const backToRack = !!machine.rackSlot && fromDepartment === "Assembly" && isRackReleaseHop(fromDepartment, toDepartment);
      sonnerToast.success(backToRack ? `${machine.bomKey}${machine.serialNo ? ` — ${machine.serialNo}` : ""} · Assembled · Ready` : `${machine.bomKey} sent to ${toDepartment}`,
        { description: backToRack ? `Back on ${slotLabel(machine.rackSlot)} — an admin sends it to ${toDepartment} from the Rack View`
          : `${machine.serialNo ? `S/N ${machine.serialNo} · ` : ""}${overrunMinutes > 0 ? `Awaiting accept · Overrun ${formatDuration(overrunMinutes)}` : "Awaiting accept"}` });
    } finally {
      setTransferBusy(false);
    }
  };

  const openAcceptModal = async (handover) => {
    // Migration 028 — Before Receive checklist. Pick a template scoped to
    // this BOM + receiving department; if none, operator sees no checklist.
    const machine = (machineLog || []).find((m) => m.id === handover.machineId) || null;
    const bomKey  = handover.bomKey || machine?.bomKey || null;
    const toDept  = handover.toDepartment;
    const checklistTemplate = pickTemplate(checklistTemplates, bomKey, toDept, "before_receive");
    const checklistAnswers  = checklistTemplate ? startChecklistResponse(checklistTemplate) : [];

    // Remembered crew for the receiving department. Accept records plain
    // names (not ids), so the memory is reconciled against the active
    // employee names for this department — anyone deactivated or moved is
    // dropped rather than silently re-ticked.
    const recalled = readTeamMemory("accept", toDept);
    const acceptTeamMembers = reconcileTeam(
      recalled.members,
      (settings?.employeeMembers || [])
        .filter((m) => m && m.active && Array.isArray(m.departments) && m.departments.includes(toDept))
        .map((m) => m.name),
    );
    // 2026-11-02 — the signature pad is ALWAYS shown: every acceptance carries
    // its own drawn signature (data-accept-signature), never a stored one.
    const acceptMe = currentUser?.fullName || currentUser?.username || "";
    const hasDeptEmps = (settings?.employeeMembers || []).some((m) => m && m.active && Array.isArray(m.departments) && m.departments.includes(toDept));
    const acceptMain = hasDeptEmps ? acceptMe : "";
    const acceptTeamFinal = hasDeptEmps && acceptMe ? [acceptMe, ...acceptTeamMembers.filter((n) => n !== acceptMe)] : acceptTeamMembers;
    setAcceptModal({ handover, password: "", sigSvg: null, busy: false, error: "", acceptMain,
                     pendingItemsToRaise: [], newPendingText: "", holdReason: "",
                     checklistTemplate, checklistAnswers, acceptTeamMembers: acceptTeamFinal });
  };

  const submitAcceptHandover = async () => {
    if (!acceptModal || acceptModal.busy) return;
    // A hand-over accepted meanwhile (other device, double click) is refused
    // before any write.
    const live = (handovers || []).find((x) => x.id === acceptModal.handover.id);
    if (!live || live.status !== "pending") { setAcceptModal(null); showToast("Already accepted", "This machine was accepted already — the list has been refreshed.", "warning"); return; }
    const { handover, password, sigSvg, checklistTemplate, checklistAnswers,
            acceptTeamMembers = [], holdReason = "" } = acceptModal;
    // 2026-10-30 — a machine accepted after its acceptance window (ON HOLD)
    // needs the reason for the late acceptance; it goes into the machine's
    // permanent history and the audit trail.
    const acceptingLate = isHoldOverdue(handover.sentAt, handover.acceptTimeoutMinutes, nowTick);
    if (acceptingLate && !holdReason.trim()) {
      setAcceptModal((prev) => prev ? { ...prev, error: "This machine is ON HOLD — write why it is being accepted late.", errorField: "This machine is ON HOLD — write why it is being accepted late." } : prev); flagField("[data-late-reasons]");
      return;
    }
    // 2026-10-30 — the receiving employees must be named when the department
    // has employees configured. Acceptance is a record of who took the machine.
    const deptHasEmps = (settings?.employeeMembers || []).some((m) => m && m.active && Array.isArray(m.departments) && m.departments.includes(handover.toDepartment));
    if (deptHasEmps && acceptTeamMembers.filter(Boolean).length === 0) {
      setAcceptModal((prev) => prev ? { ...prev, error: "Select the employees receiving this machine.", errorField: "Select the employees receiving this machine." } : prev); flagField("[data-accept-people]");
      return;
    }
    // 2026-11-02 — the digital signature is mandatory on every acceptance.
    if (!sigSvg) {
      setAcceptModal((prev) => prev ? { ...prev, error: "Draw your signature and press Save Signature before confirming.", errorField: "Draw your signature and press Save Signature before confirming." } : prev); flagField("[data-accept-signature]");
      return;
    }
    // Password is only required when the admin has opted into
    // require_password_at_accept. Default: single-click acceptance.
    if (workflow.require_password_at_accept && !password) {
      setAcceptModal((prev) => prev ? { ...prev, error: "Please enter your password." } : prev);
      return;
    }
    // Migration 028 — Before-Receive checklist gate. Same validation shape
    // as Finish & Transfer: every unchecked item must carry a non-empty
    // remark. Required items that are unchecked without remark block Accept.
    if (checklistTemplate && Array.isArray(checklistAnswers) && checklistAnswers.length) {
      const chk = validateChecklistAnswers(checklistAnswers);
      if (!chk.ok) {
        { const m = `Checklist incomplete — ${checklistProblemText(chk)}`; setAcceptModal((prev) => prev ? { ...prev, error: m, errorField: m } : prev); flagChecklist("[data-accept-checklist]"); }
        return;
      }
    }
    { const pp = pendingItemsProblem(acceptModal.pendingItemsToRaise); if (pp) { setAcceptModal((prev) => prev ? { ...prev, error: pp, errorField: pp } : prev); flagField("[data-accept-pending]"); return; } }
    setAcceptModal((prev) => prev ? { ...prev, busy: true, error: "" } : prev);
    const pendingItemsToRaise = cleanPendingJobs(acceptModal.pendingItemsToRaise);
    const res = await onAcceptHandover({ handoverId: handover.id, password, pendingItemsToRaise, holdReason: holdReason.trim(),
                                         // Pass through so the handler can snapshot the Before-Receive response.
                                         checklistTemplate, checklistAnswers,
                                         stage: "before_receive", department: handover.toDepartment,
                                         // Feature 5 — accept-side team snapshot.
                                         acceptTeamMembers: acceptTeamMembers.filter(Boolean),
                                         // This acceptance's own signature (snapshotted on the hand-over row).
                                         signatureSvg: sigSvg });
    // Remember the receiving crew for the next machine into this department.
    // Only on a confirmed accept.
    if (res && res.success !== false) {
      writeTeamMemory("accept", handover.toDepartment, acceptTeamMembers.filter(Boolean));
    }
    if (!res || res.success === false) {
      setAcceptModal((prev) => prev ? { ...prev, busy: false, error: res?.error || "Accept failed." } : prev);
      return;
    }
    setAcceptModal(null);
    celebrate(handover.toDepartment === "Ready" ? "Ready" : "Accepted", { big: handover.toDepartment === "Ready" });   // world UI: success moment (visual only; confetti only for Ready)
    sonnerToast.success(`${handover.bomKey} accepted`,
      { description: `Accepted into ${handover.toDepartment}${handover.serialNo ? ` · S/N ${handover.serialNo}` : ""}${pendingItemsToRaise.length ? ` · ${pendingItemsToRaise.length} pending item${pendingItemsToRaise.length === 1 ? "" : "s"} raised` : ""}` });
  };

  // ── Phase 1 — My Work ──────────────────────────────────────────────────
  // A worker in Mechanical does not need 37 machines; they need the handful
  // that is theirs. users.departments (migration 029) already records who
  // belongs where, it just was not being used to scope this page.
  // myDepartments is empty for admins and for anyone not assigned to a
  // department, and those users see everything exactly as before.
  const myDepartments = Array.isArray(currentUser?.departments) ? currentUser.departments.filter(Boolean) : [];
  const hasDepartments = myDepartments.length > 0;
  // 2026-11-02 — who may press "Part received" on a job. Mirrors
  // receive_pending_part() (migration 055): Admin — any job; others need
  // Finish & Transfer AND the job assigned to one of their departments (or on
  // a machine now in one; a user with no department assignment is unscoped, as
  // everywhere else here); a Stores job also goes to the inward permission.
  const canReceiveJob = (p) => {
    if (isAdminUser) return true;
    const mach = (machineLog || []).find((x) => String(x.id) === String(p?.machineId));
    const inDept = !hasDepartments || myDepartments.includes(p?.assignedDepartment) || (mach && myDepartments.includes(mach.currentDepartment || mach.stage));
    return (canFinishTransfer(canDo) && !!inDept) || (p?.assignedDepartment === "Stores" && !!canDo("inward", "submit"));
  };
  // A floor login is one that works machines through the handover chain and is
  // not an admin. It is LOCKED to its own departments: no "All machines"
  // switch, and no machines at all when no department has been assigned.
  // Failing open here was a real bug — a Production login created without a
  // department saw the whole factory, which is the opposite of the intent and
  // is easy to cause by forgetting one click.
  const isFloorLogin = !isAdminUser
    && (canDo("machines", "accept") || canDo("machines", "finishTransfer"));
  // 2026-11-01 — department-wise staff experience. Anyone who is not an admin
  // gets the compact department dashboard below (staffMode) instead of the
  // full tracker: their own departments, the machines waiting on them, their
  // pending jobs, and only the actions their role allows. Machine history,
  // ratings and the full machine report are admin-only. The Production Head
  // has no department: they get the rack view plus the machines awaiting
  // release, nothing else. Every button in that layout opens the SAME modal
  // and calls the SAME handler as the admin tracker — nothing is duplicated.
  const staffMode  = !isAdminUser;
  const isProdHead = staffMode && (currentUser?.role === "Production Head" || (canDo("machines", "release") && !isFloorLogin));
  // 2026-11-04 (owner) — the Assembly head presses "Assemble" himself, so an
  // Assembly floor login also gets the Production Rack View (Fill / Send /
  // Remove stay behind their own permissions there).
  const canStartAsm = canStartAssembly(canDo, myDepartments);
  const isAssemblyFloor = staffMode && !isProdHead && canStartAsm;
  // 2026-11-03 — staff "My Dashboard" panel (read-only; see StaffMyDashboard).
  const [myDashOpen, setMyDashOpen] = useState(false);
  const canReleaseFromRack = canDo("machines", "release") || isAdminUser;
  const [rackTakeBusy, setRackTakeBusy] = useState(null);
  // 2026-11-03 — ARRIVAL ALERT (client-side only, nothing stored but the
  // on/off choice). When a NEW hand-over for one of my departments appears
  // (To accept, or On the rack for you) the phone vibrates, plays a short
  // two-tone chime, speaks the message, and a big banner shows. Fed by the
  // same `handovers` state the realtime / refresh path already updates.
  const [arrivalOn, setArrivalOn] = useState(() => { try { return localStorage.getItem("erp_arrival_alert") !== "0"; } catch { return true; } });
  const toggleArrival = () => setArrivalOn((v) => { try { localStorage.setItem("erp_arrival_alert", v ? "0" : "1"); } catch {} return !v; });
  const [arrival, setArrival] = useState(null); // { id, rack, text }
  const arrivalSeenRef = useRef(null);
  const arrivalMountRef = useRef(Date.now());
  const arrivalWatch = (staffMode && !isProdHead && hasDepartments)
    ? (handovers || []).filter((h) => h && h.status === "pending" && myDepartments.includes(h.toDepartment))
    : [];
  const arrivalKey = arrivalWatch.map((h) => String(h.id)).sort().join("|");
  const handoversLoaded = (handovers || []).length > 0 || (Date.now() - arrivalMountRef.current) > 8000;
  // Vibrate + two-tone chime + spoken message (Hindi voice if the phone has
  // one, else Indian English). Used by the arrival and near-deadline alerts.
  const ringAlert = (hiText, enText, noVibrate) => {
    if (!noVibrate) { try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch { /* not supported */ } }
    // Browsers allow sound only after the user has touched the page once:
    // until then, keep the sound for the first touch.
    let activated = false;
    try { activated = navigator.userActivation ? !!navigator.userActivation.hasBeenActive : true; } catch { activated = false; }
    if (!activated) {
      const once = () => {
        window.removeEventListener("pointerdown", once, true); window.removeEventListener("keydown", once, true);
        ringAlert(hiText, enText, true);
      };
      try { window.addEventListener("pointerdown", once, true); window.addEventListener("keydown", once, true); } catch { /* ignore */ }
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        const ctx = new AC();
        if (ctx.state === "suspended" && ctx.resume) ctx.resume().catch(() => {});
        [[659.25, 0], [880, 0.18]].forEach(([f, at]) => {
          const o = ctx.createOscillator(); const g = ctx.createGain();
          o.type = "sine"; o.frequency.value = f;
          const t0 = ctx.currentTime + at;
          g.gain.setValueAtTime(0.0001, t0);
          g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
          o.connect(g); g.connect(ctx.destination); o.start(t0); o.stop(t0 + 0.34);
        });
        setTimeout(() => { try { ctx.close && ctx.close(); } catch {} }, 900);
      }
    } catch { /* no audio */ }
    setTimeout(() => {
      try {
        const ss = window.speechSynthesis;
        if (!ss || typeof window.SpeechSynthesisUtterance !== "function") return;
        const voices = (ss.getVoices && ss.getVoices()) || [];
        const hi = voices.find((v) => /^hi[-_]IN/i.test(v.lang || "")) || voices.find((v) => /^hi\b/i.test(v.lang || ""));
        const en = voices.find((v) => /^en[-_]IN/i.test(v.lang || ""));
        const u = new window.SpeechSynthesisUtterance(hi ? hiText : enText);
        u.lang = hi ? "hi-IN" : "en-IN";
        if (hi) u.voice = hi; else if (en) u.voice = en;
        ss.speak(u);
      } catch { /* no speech */ }
    }, 650);
  };
  useEffect(() => {
    const ids = arrivalKey ? arrivalKey.split("|") : [];
    const prev = arrivalSeenRef.current;
    if (prev === null) {
      // The very first load (or a Supabase hydration still on its way) is
      // the baseline — nothing "arrived".
      if (handoversLoaded) arrivalSeenRef.current = new Set(ids);
      return;
    }
    arrivalSeenRef.current = new Set(ids);
    const fresh = ids.filter((id) => !prev.has(id));
    if (!fresh.length) return;
    const h = arrivalWatch.find((x) => String(x.id) === fresh[fresh.length - 1]);
    if (!h) return;
    const m = (machineLog || []).find((x) => String(x.id) === String(h.machineId)) || null;
    const name = (m && m.bomKey) || h.bomKey || "Machine";
    const serial = (m && m.serialNo) || h.serialNo || "";
    const rack = isAwaitingRelease(h);
    setArrival({ id: h.id, rack, text: `📥 ${name}${serial ? ` · ${serial}` : ""} has come to ${h.toDepartment} — ${rack ? "Take from Rack" : "Accept"}` });
    if (!arrivalOn) return;
    ringAlert(`आपकी मशीन आ गई है — ${name}${serial ? `, सीरियल ${serial}` : ""}`,
              `Your machine has arrived — ${name}${serial ? `, serial ${serial}` : ""}`);
  }, [arrivalKey, handoversLoaded]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!arrival) return;
    const t = setTimeout(() => setArrival(null), 15000);
    return () => clearTimeout(t);
  }, [arrival]);
  const openArrival = () => {
    const a = arrival; setArrival(null);
    if (!a) return;
    try {
      const el = (a.machineId != null && document.querySelector(`[data-staff-timer="${a.machineId}"]`))
        || document.querySelector(`[data-staff-accept="${a.id}"]`) || document.querySelector(`[data-staff-take="${a.id}"]`)
        || document.querySelector(a.rack ? "[data-staff-section='On the rack for you']" : "[data-staff-section='To accept']");
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      const card = el.closest(".mt-card") || el;
      card.classList.add("arrival-flash");
      setTimeout(() => card.classList.remove("arrival-flash"), 2400);
      if (el.tagName === "BUTTON") el.focus({ preventScroll: true });
    } catch { /* ignore */ }
  };
  // The first department that actually does work — machines are started onto
  // it from the rack. Derived, so adding a stage ahead of Assembly keeps this
  // correct.
  const FIRST_WORK_DEPARTMENT = DEPARTMENT_SEQUENCE.find((d) => d !== "BOM Issued");
  const [scope, setScope] = useState(() => (!isAdminUser && hasDepartments) ? "mine" : "all");
  const scopeMine = isFloorLogin || (scope === "mine" && hasDepartments);
  // Only office and admin logins get to switch; a floor login has nothing to
  // switch to.
  const showScopeSwitch = !isFloorLogin && hasDepartments;
  const inMyDept = (m) => myDepartments.includes(m.currentDepartment || m.stage);

  // Machine Tracker shows ONLY machines that have STARTED production (left the rack).
  // Rack machines sit at stage "BOM Issued" and appear solely in the Production Rack View.
  const startedAll = machineLog.filter((m) => m.stage !== "BOM Issued");
  // What "mine" means, bucket by bucket:
  //   take in  — a handover addressed to one of my departments
  //   working  — the machine is sitting in one of my departments
  //   go fix   — an open fault called to one of my departments, wherever the
  //              machine happens to be
  //   owed     — a job my department still owes, wherever the machine is
  const handoverToMine = (m) => {
    const h = (handovers || []).find((x) => x.id === m.pendingHandoverId && x.status === "pending");
    return !!(h && myDepartments.includes(h.toDepartment));
  };
  const openItemsFor = (m, kind) => (pendingHandoverItems || []).filter((p) =>
    String(p.machineId) === String(m.id) && pendingItemIsOpen(p)
    && (kind === "owed" ? p.kind === "owed" : p.kind !== "owed")
    && myDepartments.includes(p.assignedDepartment));
  // "Take in" means the machine is actually waiting on this department. One
  // parked on the rack has not been released yet, so it is not theirs to pick
  // up and it stays out of this list until the production head says so.
  const myTakeIn  = startedAll.filter((m) => {
    if (m.status === "completed" || !handoverToMine(m)) return false;
    const h = (handovers || []).find((x) => x.id === m.pendingHandoverId && x.status === "pending");
    return !isAwaitingRelease(h);
  });
  const myWorking = startedAll.filter((m) => m.status !== "completed" && !m.pendingHandoverId && inMyDept(m));
  const myToFix   = startedAll.filter((m) => m.status !== "completed" && openItemsFor(m, "fault").length > 0);
  const myOwed    = startedAll.filter((m) => m.status !== "completed" && openItemsFor(m, "owed").length > 0);
  const myMachineIds = new Set([...myTakeIn, ...myWorking, ...myToFix, ...myOwed].map((m) => m.id));
  const started   = scopeMine ? startedAll.filter((m) => myMachineIds.has(m.id)) : startedAll;
  const active    = started.filter((m) => m.status !== "completed");
  const completed = started.filter((m) => m.status === "completed");
  // Phase A/B status filters. Distinct categories per the 2026-10-19 UX pass:
  //   Pending Acceptance = pending AND still within accept deadline
  //   Overdue            = pending AND past accept deadline (deadline
  //                        exceeded, no explicit hold placed)
  //   On HOLD            = explicit workflow HOLD state (reserved for a
  //                        future handover.status='held' value — not
  //                        silently derived from Overdue)
  // All computed from live state; recompute on every minute tick (nowTick).
  // 2026-10-31 — match by machine id too: machine_log.pending_handover_id can
  // be null while a pending hand-over for the machine exists (legacy rows,
  // a pull-back followed by a resend), which made the On Hold card count a
  // machine the On Hold filter then did not list.
  const machineHandover = (m) => (handovers || []).find((h) => h.status === "pending" && (h.id === m.pendingHandoverId || String(h.machineId) === String(m.id)));
  // Migration 036 — a handover waiting on the rack has been sent but not yet
  // released by a production head. Nobody has been asked to accept it, so its
  // acceptance clock must not run: for Shantaz a machine can sit on the rack
  // for days and that is normal, not late.
  const pendingAccept   = started.filter((m) => {
    const h = machineHandover(m);
    return !m.holdActive && h && !isAwaitingRelease(h) && !isHoldOverdue(h.sentAt, h.acceptTimeoutMinutes, nowTick);
  });
  // ON HOLD = a hand-over nobody accepted in time (automatic) OR a machine
  // somebody put on hold by hand from its card (2026-11-02, migration 055).
  const onHold          = started.filter((m) => {
    if (m.status === "completed") return false;
    if (m.holdActive) return true;
    const h = machineHandover(m);
    return h && !isAwaitingRelease(h) && isHoldOverdue(h.sentAt, h.acceptTimeoutMinutes, nowTick);
  });
  const onRackMachines  = started.filter((m) => {
    const h = machineHandover(m);
    return h && isAwaitingRelease(h);
  });
  // 2026-11-03 — NEAR-DEADLINE REMINDER (staff). The department timer on the
  // staff card — same target, same computeOverrun (closed days pause it). At
  // 80% of the target the chip turns amber with the time left; over 100% it
  // is red. One alert per machine per threshold, remembered in localStorage
  // so a refresh does not repeat it.
  const deptTimerOf = (m) => {
    const dept   = m.currentDepartment || m.stage;
    const cfg    = (m.deptDurations && m.deptDurations[dept]) || workflow.dept_durations[dept];
    const target = (cfg && cfg.minutes) || 0;
    const t      = m.departmentEnteredAt ? computeOverrun(m.departmentEnteredAt, target, nowTick) : null;
    const level  = !t || !target ? 0 : t.isOverrun ? 100 : t.actualMinutes >= target * 0.8 ? 80 : 0;
    return { dept, target, t, level, leftMinutes: t ? Math.max(0, target - t.actualMinutes) : 0 };
  };
  const deadlineWatch = (staffMode && !isProdHead && hasDepartments)
    ? myWorking.map((m) => ({ m, ...deptTimerOf(m) })).filter((x) => x.level > 0)
    : [];
  const deadlineKey = deadlineWatch.map((x) => `${x.m.id}|${x.dept}|${x.m.departmentEnteredAt}|${x.level}`).sort().join("~");
  useEffect(() => {
    if (!deadlineKey) return;
    let fired = [];
    try { fired = JSON.parse(localStorage.getItem("erp_deadline_alerts") || "[]"); if (!Array.isArray(fired)) fired = []; } catch { fired = []; }
    const seen = new Set(fired);
    const fresh = deadlineWatch.filter((x) => !seen.has(`${x.m.id}|${x.dept}|${x.m.departmentEnteredAt}|${x.level}`));
    if (!fresh.length) return;
    fresh.forEach((x) => fired.push(`${x.m.id}|${x.dept}|${x.m.departmentEnteredAt}|${x.level}`));
    try { localStorage.setItem("erp_deadline_alerts", JSON.stringify(fired.slice(-300))); } catch { /* ignore */ }
    const x = fresh.find((y) => y.level === 100) || fresh[0];
    const name = x.m.bomKey || "Machine"; const serial = x.m.serialNo || "";
    const late = x.level === 100;
    setArrival({ machineId: x.m.id, deadline: true, text: late
      ? `⏰ ${name}${serial ? ` · ${serial}` : ""} is late in ${x.dept} — by ${formatDuration(x.t.overrunMinutes)}`
      : `⏳ ${name}${serial ? ` · ${serial}` : ""} — ${formatDuration(x.leftMinutes)} left in ${x.dept}` });
    if (!arrivalOn) return;
    const hrs = Math.round(x.leftMinutes / 60);
    const hiLeft = hrs >= 1 ? `${hrs} घंटे बाकी` : `${x.leftMinutes} मिनट बाकी`;
    const enLeft = hrs >= 1 ? `${hrs} hour${hrs === 1 ? "" : "s"} left` : `${x.leftMinutes} minutes left`;
    if (late) ringAlert(`${name} ${serial} का समय खत्म हो गया है`, `${name} ${serial} time is over`);
    else ringAlert(`${name} ${serial} का समय खत्म होने वाला है, ${hiLeft}`, `${name} ${serial} time is almost over, ${enLeft}`);
  }, [deadlineKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Transfer & Accept lists every machine still moving through the line —
  // the ones to finish & transfer, release, or accept — whatever summary
  // tile was last clicked on the Production tab.
  // 2026-10-30 / 2026-10-31 — one machine's jobs with their actions. Used by
  // the Pending Jobs tab and by the "Pending Jobs" drawer opened from a
  // machine card (same rows, same Part received / Work completed actions).
  const renderJobGroup = (m, list, key) => {
    const canAct = canFinishTransfer(canDo);
    return (
                  <div key={key} className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(17,24,39,0.10)" }}>
                    <div className="px-3 py-2 flex items-center gap-2 flex-wrap" style={{ background: "rgba(17,24,39,0.03)" }}>
                      <span className="text-[12px] font-black text-slate-900">{m?.bomKey || "Machine"}</span>
                      {m?.serialNo && <span className="text-[11px] font-mono font-bold text-slate-700">S/N {m.serialNo}</span>}
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(99,102,241,0.1)", color: "#4338ca" }}>
                        now in {m?.status === "completed" ? "Ready" : (m?.currentDepartment || m?.stage || "—")}
                      </span>
                      {m?.status === "completed" && list.some((p) => p.status === "open") && (
                        <span data-job-after-ready className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                              style={{ background: "rgba(217,119,6,0.12)", color: "#b45309", border: "1px solid rgba(217,119,6,0.35)" }}
                              title="This machine has reached Ready but still has outstanding items">
                          still outstanding after Ready
                        </span>
                      )}
                      <span className="text-[10px] text-slate-500 ml-auto">{list.length} job{list.length === 1 ? "" : "s"}</span>
                    </div>
                    <div className="divide-y" style={{ borderColor: "rgba(17,24,39,0.06)" }}>
                      {list.map((p) => {
                        const stage = pendingItemStage(p);
                        const chip = pendingItemIsDone(p)
                          ? { label: pendingItemIsPart(p) && p.status !== "resolved" ? "✓ Fully received" : "✓ Completed", bg: "rgba(22,163,74,0.1)", fg: "#15803d" }
                          : stage === "received"
                          ? { label: "Part received · finish work", bg: "rgba(37,99,235,0.1)", fg: "#1d4ed8" }
                          : stage === "partial"
                          ? { label: `Partly received · ${pendingItemRemaining(p)} left`, bg: "rgba(37,99,235,0.1)", fg: "#1d4ed8" }
                          : { label: p.itemCode || p.itemName ? "Awaiting part" : "Awaiting work", bg: "rgba(217,119,6,0.12)", fg: "#b45309" };
                        return (
                          <div key={p.id} data-job-row={p.id} data-job-kind={pendingItemIsPart(p) ? "part" : "work"} className="px-3 py-2.5 flex items-start gap-3 flex-wrap">
                            <div className="flex-1 min-w-[200px]">
                              <div className="text-[12px] text-slate-800 font-semibold">{p.description}</div>
                              {(p.itemCode || p.itemName) && (
                                <div className="mt-1 text-[10.5px] text-slate-500" data-job-part>
                                  Part {p.itemCode
                                    ? <><span className="font-mono font-bold text-slate-700">{p.itemCode}</span>{p.itemName ? ` · ${p.itemName}` : ""}</>
                                    : <span className="font-bold text-slate-700">{p.itemName}</span>}
                                  {p.qty != null ? ` × ${p.qty}` : ""}
                                  {p.qty != null && (Number(p.receivedQty) || 0) > 0 ? <span data-job-qty> · {p.receivedQty} received · <b>{pendingItemRemaining(p)} pending</b></span> : null}
                                  {p.partSerialNo ? <> · part S/N <span className="font-mono font-bold text-slate-700">{p.partSerialNo}</span></> : null}
                                  {!p.itemCode && p.itemName ? " · not in Item Master" : ""}
                                </div>
                              )}
                              {p.critical && p.criticalChecks && p.criticalChecks.mode && (
                                <div data-job-mode className="mt-1 text-[10.5px] text-slate-500">
                                  Critical option: {(CRITICAL_MODES.find(([k]) => k === p.criticalChecks.mode) || [])[1]}
                                </div>
                              )}
                              {p.criticalChecks && Array.isArray(p.criticalChecks.points) && p.criticalChecks.points.length > 0 && (
                                <div data-job-checks className="mt-1 text-[10.5px] text-slate-600">
                                  Check points at Outward: {p.criticalChecks.points.filter((x) => x.ok).length}/{p.criticalChecks.points.length} ticked
                                  {" — "}{p.criticalChecks.points.map((x) => `${x.ok ? "✓" : "☐"} ${x.text}`).join(" · ")}
                                </div>
                              )}
                              {/* Permanent history: original reason, receive remark, completion. */}
                              <JobHistory item={p} users={allUsers} />
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {p.raisedInDepartment && (
                                <span data-job-origin className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(99,102,241,0.1)", color: "#4338ca" }}
                                      title="Department where this job was raised">
                                  from {p.raisedInDepartment}
                                </span>
                              )}
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(239,68,68,0.1)", color: "#b91c1c" }}>
                                {p.assignedDepartment || "Unassigned"}
                              </span>
                              {p.critical && (
                                <span data-job-critical-chip className="text-[10px] font-black px-2 py-0.5 rounded-full"
                                      style={{ background: "rgba(220,38,38,0.12)", color: "#b91c1c", border: "1px solid rgba(220,38,38,0.4)" }}
                                      title="Classified critical when it was raised">CRITICAL</span>
                              )}
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: chip.bg, color: chip.fg }}>{chip.label}</span>
                              {onReceivePendingItem && pendingItemIsPart(p) && canReceiveJob(p) && p.status === "open" && !p.receivedAt && (
                                <button data-needs-net type="button" onClick={() => setJobAction({ item: p, action: "receive", notes: "", busy: false, error: "" })}
                                        className="text-[10.5px] font-bold px-2.5 py-1 rounded-lg border transition-all"
                                        style={{ background: "rgba(37,99,235,0.08)", border: "1px solid rgba(37,99,235,0.35)", color: "#1d4ed8" }}>
                                  <LeadLabel text="📦 Part received" />
                                </button>
                              )}
                              {canAct && onResolvePendingItem && p.status === "open" && !pendingItemIsPart(p) && (
                                <button data-needs-net type="button" onClick={() => setJobAction({ item: p, action: "complete", notes: "", busy: false, error: "" })}
                                        className="text-[10.5px] font-bold px-2.5 py-1 rounded-lg border transition-all"
                                        style={{ background: "rgba(22,163,74,0.08)", border: "1px solid rgba(22,163,74,0.35)", color: "#15803d" }}>
                                  Work completed
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
    );
  };
  // 2026-11-02 — Pending Jobs board: PENDING PARTS, PENDING WORK, then a
  // collapsible COMPLETED section. A job is a part when it names an item; a
  // part is completed when fully received (partial receipts stay pending),
  // work when marked Work completed. Used by the Pending Jobs tab and the
  // machine drawer; rows and actions come from renderJobGroup.
  const renderJobBoard = (items, { detailsKey = "completed" } = {}) => {
    const list = Array.isArray(items) ? items : [];
    const openParts = list.filter((p) => pendingItemIsOpen(p) && pendingItemIsPart(p));
    const openWork  = list.filter((p) => pendingItemIsOpen(p) && !pendingItemIsPart(p));
    const donePartsL = list.filter((p) => pendingItemIsDone(p) && pendingItemIsPart(p));
    const doneWorkL  = list.filter((p) => pendingItemIsDone(p) && !pendingItemIsPart(p));
    const byMach = (arr) => Object.entries(arr.reduce((acc, p) => { (acc[String(p.machineId)] = acc[String(p.machineId)] || []).push(p); return acc; }, {}))
      .map(([id, l]) => ({ id, m: machineLog.find((x) => String(x.id) === id) || null, list: l.slice().sort((a, b) => String(a.raisedAt || "").localeCompare(String(b.raisedAt || ""))) }))
      .sort((a, b) => (a.m?.serialNo || "").localeCompare(b.m?.serialNo || ""));
    const block = (key, title, icon, tone, arr, empty) => (
      <section data-jobs-section={key} className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[12.5px] font-black" style={{ color: tone }}><LeadLabel text={`${icon} ${title}`} /></span>
          <span data-jobs-count={key} className="text-[10.5px] font-black px-2 py-0.5 rounded-full" style={{ background: `${tone}1a`, color: tone }}>{arr.length}</span>
        </div>
        {arr.length === 0
          ? <div className="rounded-lg px-3 py-2.5 text-[11px] font-semibold" style={{ background: "rgba(22,163,74,0.06)", color: "#15803d" }}>{empty}</div>
          : byMach(arr).map(({ id, m, list: l }) => renderJobGroup(m, l, `${key}-${id}`))}
      </section>
    );
    return (
      <div data-jobs-board className="space-y-4">
        {block("parts", "Pending Parts", "📦", "#b45309", openParts, "✓ No part is pending.")}
        {block("work", "Pending Work", "🛠", "#1d4ed8", openWork, "✓ No work is pending.")}
        <details data-jobs-section={detailsKey} className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          <summary className="cursor-pointer font-bold py-1">
            Completed jobs ({donePartsL.length + doneWorkL.length})
            <span data-jobs-count="done-parts" className="ml-2 font-semibold">parts {donePartsL.length}</span>
            <span data-jobs-count="done-work" className="ml-2 font-semibold">work {doneWorkL.length}</span>
          </summary>
          <div className="mt-2 space-y-3">
            {donePartsL.length + doneWorkL.length === 0
              ? <div className="text-[11px] italic px-1">Nothing completed yet.</div>
              : <>
                  {donePartsL.length > 0 && <div data-jobs-done-group="parts"><div className="text-[11px] font-black mb-1" style={{ color: "#15803d" }}>Completed parts</div><div className="space-y-2">{byMach(donePartsL).map(({ id, m, list: l }) => renderJobGroup(m, l, `dp-${id}`))}</div></div>}
                  {doneWorkL.length > 0 && <div data-jobs-done-group="work"><div className="text-[11px] font-black mb-1" style={{ color: "#15803d" }}>Completed work</div><div className="space-y-2">{byMach(doneWorkL).map(({ id, m, list: l }) => renderJobGroup(m, l, `dw-${id}`))}</div></div>}
                </>}
          </div>
        </details>
      </div>
    );
  };
  const searchText = searchQ.trim().toLowerCase();
  const searchHit = (m) => [m.bomKey, m.label, m.bomLabel, m.serialNo, m.currentDepartment, m.stage, m.id]
    .some((v) => String(v ?? "").toLowerCase().includes(searchText));
  const listForTab = () => (searchText ? started.filter(searchHit)
    : mtTab === "pending" ? []
    : mtTab === "transfer" ? (filter === "hold" ? onHold : filter === "pendingAccept" ? pendingAccept : active)
    : filtered);
  // 2026-10-30 — Pending Jobs: every open job in the factory (a floor login
  // sees only what is assigned to its own departments), grouped by machine.
  const openJobsScoped = (pendingHandoverItems || [])
    .filter(pendingItemIsOpen)
    .filter((p) => !scopeMine || myDepartments.includes(p.assignedDepartment));
  const filtered  = filter === "active" ? active
                   : filter === "completed" ? completed
                   : filter === "pendingAccept" ? pendingAccept
                   : filter === "hold" ? onHold
                   : filter === "onRack" ? onRackMachines
                   : started;

  const stageIdx = (s) => MACHINE_STAGES.indexOf(s);

  // ─── Production Rack view (computed from existing data) ────────────────────
  // Rack Ready Qty = count of machines for this bomKey still at "BOM Issued" stage.
  //
  // Inclusion rule (per the manufacturing flow spec):
  //   - A BOM appears in Rack View only when it is rack-tracked
  //     (rackCapacity > 0). Capacity = 0 / blank means "no rack tracking for
  //     this BOM" — those BOMs route directly to Active Builds and must NOT
  //     show a rack card.
  //   - Orphan rack machines (BOM was deleted, but rack-stage entries still
  //     exist for the now-missing key) are kept visible so the operator can
  //     remove them and reclaim stock. They show up as cards with capacity
  //     reported as 0 but ready > 0; the state is still "partial".
  const rackData = (() => {
    const allKeys = new Set([
      ...Object.keys(bomDefs || {}),
      ...machineLog.map((m) => m.bomKey).filter(Boolean),
    ]);
    return [...allKeys].sort()
      .map((key) => {
        const def      = bomDefs[key] || {};
        const ready    = machineLog.filter((m) => m.bomKey === key && m.stage === "BOM Issued").length;
        const capacity = rackCapacityFor(key, def);
        const empty    = Math.max(0, capacity - ready);
        let state;
        if (capacity > 0 && ready >= capacity)        state = "full";
        else if (ready > 0)                           state = "partial";
        else                                          state = "empty";
        return {
          key, label: def.label || key,
          capacity, ready, empty, state,
          configured: capacity > 0,
        };
      })
      // Filter: only rack-tracked BOMs (configured) get a card. Non-rack BOMs
      // are hidden unless they have orphan rack machines waiting for clean-up.
      .filter((r) => r.configured || r.ready > 0);
  })();
  // replenishAlerts was the data source for the now-removed banner — kept the
  // line as a comment so the rationale is recoverable from blame. (Computed
  // on-demand inside the card render if ever needed again.)

  // Rack machines (serial-wise, oldest first) waiting to start for a model.
  const rackMachinesFor = (key) =>
    machineLog.filter((m) => m.bomKey === key && m.stage === "BOM Issued")
              .sort((a, b) => (a.createdDate || "").localeCompare(b.createdDate || ""));

  // Components a rack machine is still waiting for. Pending rows are written by
  // BOM Outward carrying the same issueId as the machine it created, so that is
  // the exact match; serial + bomKey is the fallback for rows written before
  // issueId was threaded through. Rows already fulfilled are dropped by the
  // App's fulfil handlers, so anything still here is genuinely outstanding.
  const pendingForMachine = (m) => {
    if (!m || !Array.isArray(pendingLog) || pendingLog.length === 0) return [];
    const byIssue = m.issueId ? pendingLog.filter((p) => p.issueId && p.issueId === m.issueId) : [];
    if (byIssue.length) return byIssue;
    if (!m.serialNo) return [];
    return pendingLog.filter((p) => p.serialNo && p.serialNo === m.serialNo && p.bomKey === m.bomKey);
  };

  const openStartProd = (rack, preselectId = null) => {
    if (rack.ready === 0) return;
    setStartProd(rack);
    setStartSel(preselectId != null ? new Set([preselectId]) : new Set());
    setStartErr("");
  };
  // 2026-10-31 — Fill / Assign Machine for one empty slot (brief §14).
  const [fillSlot, setFillSlot] = useState(null); // { slotId, family, rack }
  // 2026-10-31 rack units — the unit whose details panel is open, and its tab.
  const [rackPanel, setRackPanel] = useState(null);
  // 2026-11-03 — "Are you sure?" before a rack machine is sent on (owner rule
  // for actions that cannot be undone). { name, to, run, busy } — run is the
  // unchanged send handler, called only after Yes.
  const [rackSendAsk, setRackSendAsk] = useState(null);
  // 2026-11-03 — the admin "Update Stage" correction sits behind a small toggle in History.
  const [stageEditFor, setStageEditFor] = useState(null);
  const [rackPanelTab, setRackPanelTab] = useState("bom");
  // 2026-11-01 — Escape closes the top-most popup, in the same order they
  // stack on screen; a popup that is saving ignores it, like its Cancel.
  // Declared after every popup's state so its dependency list is initialised.
  // 2026-11-04 (MT audit) — the same list closes the top-most popup on the
  // phone's Back button (below), so Back never throws a worker out of the
  // ERP with a half-filled Accept / Finish screen.
  const popupSteps = () => [
        [startChk,           () => !startChk?.busy && setStartChk(null)],
        [jobAction,          () => !jobAction?.busy && setJobAction(null)],
        [reportMachineId,    () => setReportMachineId(null)],
        [reportDoc,          () => setReportDoc(null)],
        [reportsMenu,        () => setReportsMenu(false)],
        [trialCertModal,    () => setTrialCertModal(null)],
        [trialCertViewModal, () => setTrialCertViewModal(null)],
        [finishModal,        () => !transferBusy && setFinishModal(null)],
        [acceptModal,        () => !acceptModal?.busy && setAcceptModal(null)],
        [duringWorkModal,    () => !duringWorkModal?.busy && setDuringWorkModal(null)],
        [removeRackConfirm,  () => setRemoveRackConfirm(null)],
        [pullBack,           () => !pullBack?.busy && setPullBack(null)],
        [undoAsk,            () => !undoAsk?.busy && setUndoAsk(null)],
        [holdModal,          () => !holdModal?.busy && setHoldModal(null)],
        [deleteModal,        () => !deleteModal?.busy && setDeleteModal(null)],
        [raiseModal,        () => !raiseBusy && setRaiseModal(null)],
        [jobsDrawer,         () => setJobsDrawer(null)],
        [rackPanel,          () => setRackPanel(null)],
        [issuePopup,         () => setIssuePopup(null)],
        [showCalled,         () => setShowCalled(false)],
        [myDashOpen,         () => setMyDashOpen(false)],
      ];
  const closeTopPopupRef = useRef(null);
  closeTopPopupRef.current = () => { const top = popupSteps().find(([open]) => !!open); if (top) top[1](); return !!top; };
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (closeTopPopupRef.current()) e.stopPropagation();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Back button: while a popup is open there is one extra history entry; Back
  // pops it and closes the top popup (a popup that is saving stays, and the
  // entry is pushed again). No URL change, nothing else in history.
  const anyPopupOpen = popupSteps().some(([open]) => !!open);
  const [backArmed, setBackArmed] = useState(false);
  useEffect(() => {
    if (!anyPopupOpen || backArmed) return;
    try { window.history.pushState({ erpPopup: 1 }, ""); } catch { /* ignore */ }
    setBackArmed(true);
  }, [anyPopupOpen, backArmed]);
  useEffect(() => {
    const onPop = () => { setBackArmed(false); closeTopPopupRef.current(); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // 2026-11-04 (fix/live-sync) — an open popup holds the machine / hand-over /
  // pending job it was opened for. When someone else changes that record (live
  // update), the popup shows the fresh copy; if the change makes the popup's
  // question moot (moved department, hold flipped, already accepted, deleted)
  // it closes and says so. A popup that is saving its own change is left alone.
  useEffect(() => {
    const MOVE = ["stage", "currentDepartment", "status", "pendingHandoverId"];
    let note = null;
    const sync = (modal, setModal, { key = "machine", list = machineLog, watch = MOVE, busy = false, replace = true } = {}) => {
      if (!modal || busy || modal.busy) return;
      const stale = key ? modal[key] : modal;
      const r = reconcileOpenRecord(stale, list, { watch });
      if (r.state === "gone" || r.state === "changed") { setModal(null); note = r.state; return; }
      if (r.state === "updated" && replace) setModal((prev) => (prev && (key ? prev[key] : prev) === stale ? (key ? { ...prev, [key]: r.fresh } : r.fresh) : prev));
    };
    sync(finishModal, setFinishModal, { busy: transferBusy, watch: [...MOVE, "holdActive"] });
    sync(trialCertModal, setTrialCertModal, { busy: transferBusy, replace: false });
    sync(trialCertViewModal, setTrialCertViewModal, { key: null, watch: [] });
    sync(duringWorkModal, setDuringWorkModal);
    sync(holdModal, setHoldModal, { watch: ["holdActive", "status"] });
    sync(deleteModal, setDeleteModal, { watch: [] });
    sync(raiseModal, setRaiseModal, { busy: raiseBusy, watch: ["status"] });
    sync(attachAsk && attachAsk.machine ? attachAsk : null, setAttachAsk, { watch: [], replace: false });
    sync(acceptModal, setAcceptModal, { key: "handover", list: handovers, watch: ["status"], replace: false });
    sync(pullBack, setPullBack, { key: "handover", list: handovers, watch: ["status"], replace: false });
    sync(undoAsk, setUndoAsk, { key: "handover", list: handovers, watch: ["status"], replace: false });
    sync(jobAction, setJobAction, { key: "item", list: pendingHandoverItems, watch: ["status", "receivedAt"] });
    if (note) showToast("Changed by someone — refreshed", note === "gone" ? "That record was removed on another screen." : "It was updated on another screen. Please check and try again.", "warning");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineLog, handovers, pendingHandoverItems]);
  // Pending part awaiting "Confirm issue" in the rack panel, and the one in flight.
  const [pendIssueAsk, setPendIssueAsk] = useState(null);
  const [pendIssueBusy, setPendIssueBusy] = useState(null);
  const [fillErr,  setFillErr]  = useState("");

  // ── Physical rack layout (see PHYSICAL_RACK_LAYOUT) ──
  // Splits each family's waiting sets across its real racks, oldest first,
  // two per rack. Purely a view over rackMachinesFor(): nothing about how a
  // set gets onto or off the rack changes.
  // 2026-10-31 — slot-level view (brief §14). Machines whose Assembly →
  // Mechanical hand-over is parked on the rack are "assembled" in their slot.
  const awaitingReleaseIds = new Set((handovers || [])
    .filter((h) => h && h.status === "pending" && h.releaseRequired && !h.releasedAt)
    .map((h) => String(h.machineId)));
  // A machine whose rack hand-over has been released has left the rack, even
  // if clearing machine_log.rack_slot was refused (RLS: only updateStage may
  // write machine_log; a Production Head releases without it). The released
  // hand-over is the source of truth, so the slot reads Empty either way.
  const rackView = rackViewLog(machineLog, handovers);
  // Rack → model → BOM mapping. More than one BOM can normalise to the same
  // model ("KM10" and "KM-10"). A BOM whose components are all in the Item
  // Master is the usable one; any other is shown with a warning and is never
  // offered as the default. Nothing is renamed or deleted here.
  const itemCodeSet = new Set(Object.values(items || {}).flatMap((l) => Array.isArray(l) ? l.map((i) => i && i.code) : []));
  const rackBomsFor = (f) => Object.keys(bomDefs || {})
    .filter((k) => physicalRackFamily(k)?.id === f.id)
    .map((k) => {
      const lines = (bomDefs[k]?.items || []);
      const missing = lines.filter((l) => !itemCodeSet.has(l && l.code)).length;
      return { key: k, label: bomDefs[k]?.label || k, components: lines.length, missing, valid: lines.length > 0 && missing === 0 };
    })
    .sort((a, b) => (b.valid - a.valid) || a.key.localeCompare(b.key));
  // 2026-10-31 fixed racks — the one BOM a rack takes, and whether the store
  // can build a set of it right now (BOM-wise stock vs required).
  const stockByCode = {};
  Object.values(items || {}).forEach((l) => (Array.isArray(l) ? l : []).forEach((i) => { if (i && i.code) stockByCode[i.code] = Number(i.stock) || 0; }));
  // 2026-10-31 M/R sets — each rack keeps its own BOM. The R crate of a set is
  // a separate R BOM outward under the machine's serial:
  //   none     the R BOM has no components (nothing to fill yet)
  //   pending  the R BOM has components and its crate is not filled yet
  //   filled   an R BOM outward exists for this machine's serial
  const invByCode = {};
  Object.values(items || {}).forEach((l) => (Array.isArray(l) ? l : []).forEach((i) => { if (i && i.code) invByCode[i.code] = i; }));
  // Parts not issued at BOM Outward (Not verified + reason) that are still
  // open on a machine — shown on its rack as "BOM Ready · X Pending".
  const notIssuedOpenFor = (m) => (m ? (pendingHandoverItems || []).filter((p) => p && String(p.machineId) === String(m.id) && p.status !== "resolved" && /^Part not issued at BOM Outward/.test(p.description || "")) : []);
  const rCrateStateOf = (familyId, m) => {
    const fam = PHYSICAL_RACK_LAYOUT.families.find((x) => x.id === familyId);
    const rKey = fam ? rackBoms(fam, "R").primary : null;
    if (!m || !rKey) return { state: "none", rKey };
    const def = bomDefs[rKey];
    const has = !!def && !def.retiredAt && (def.items || []).some((l) => l && l.code);
    if (rCrateIssues(outwardLog, rKey, m.serialNo).length) return { state: "filled", rKey };
    return { state: has ? "pending" : "none", rKey };
  };
  const rackBomInfo = (rack) => {
    const key = rack.bom && rack.bom.primary;
    const def = key ? bomDefs[key] : null;
    if (!key || !def || def.retiredAt) return { key, def: null, exists: false };
    const lines = (def.items || []).filter((l) => l && l.code);
    const short = lines.filter((l) => (stockByCode[l.code] ?? 0) < (Number(l.qty) || 0)).map((l) => ({ code: l.code, need: Number(l.qty) || 0, have: stockByCode[l.code] ?? 0, unknown: !itemCodeSet.has(l.code) }));
    const sets = lines.length ? Math.min(...lines.map((l) => Math.floor((stockByCode[l.code] ?? 0) / Math.max(1, Number(l.qty) || 1)))) : 0;
    return { key, def, exists: true, components: lines.length, short, sets };
  };
  const physicalFamilies = PHYSICAL_RACK_LAYOUT.families.map((f) => {
    const built = buildFamilyRacks(f, rackView, awaitingReleaseIds);
    const columns = built.columns.map((pair) => pair.map((rack) => ({
      ...rack,
      machines: rack.slots.filter((sl) => sl.machine).map((sl) => sl.machine),
      // Start Production opens on the model of the sets this rack holds.
      bomRack: rack.ready ? rackData.find((r) => r.key === rack.slots.find((sl) => sl.status === "set").machine.bomKey) : null,
    })));
    return { ...f, columns, overflow: built.overflow.length, overflowMachines: built.overflow };
  });
  // Models with no place in the physical layout keep their old card, but only
  // while a set is actually waiting — so it can still be started.
  const otherRacks = rackData.filter((r) => !physicalRackFamily(r.key) && r.ready > 0);
  const toggleStartSel = (id) => setStartSel((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const confirmStartProd = () => {
    if (!startProd || !onStartProduction) return;
    const ids = [...startSel];
    if (ids.length === 0) { setStartErr("Select at least one machine (serial) to start."); return; }
    // 2026-10-31 — no assembly while BOM components are still pending.
    const shortSel = machineLog.filter((m) => ids.includes(m.id) && pendingForMachine(m).length > 0);
    if (shortSel.length) { setStartErr(`Cannot start — still waiting for components: ${shortSel.map((m) => m.serialNo || m.bomKey).join(", ")}. Receive the pending stock first.`); return; }
    const key = startProd.key;
    startWithChecklist(ids, (res) => {
      if (res?.success === false) { setStartErr(res.error || "Failed to start production"); return; }
      showToast(`${key} — ${res.count} machine(s) into production`, (res.serials || []).join(", ") || "Assembly stage active");
      setStartProd(null); setStartErr("");
    });
  };

  const handleStageUpdate = async (machine) => {
    const newStage = stageMap[machine.id];
    if (!newStage || newStage === machine.stage) return;
    const r = await onUpdateStage(machine.id, newStage);
    if (r && r.success === false) { showToast("Stage not changed", r.error || "", "urgent"); return; }
    showToast(`${machine.bomKey} — ${machine.serialNo}`, `Stage: ${machine.stage} → ${newStage}`);
    setStageMap((p) => ({ ...p, [machine.id]: "" }));
  };

  return (
    /* mt-premium (2026-10-31): cream/ivory surfaces and gold hairlines scoped
       to this page only — the rest of the ERP keeps its standard white. */
    <div className="flex-1 overflow-y-auto mt-premium" ref={mtRootRef}>

      {/* Arrival alert banner (staff only) — tap to go to that machine's card. */}
      {staffMode && arrival && (
        <div className="arrival-banner" role="alert" data-arrival-banner
             data-arrival-tone={arrival.deadline ? (String(arrival.text).startsWith("⏰") ? "bad" : "wait") : "ok"}>
          <button type="button" className="arrival-banner-main" onClick={openArrival} data-arrival-open>
            <LeadLabel text={arrival.text} />
          </button>
          <button type="button" className="arrival-banner-close" aria-label="Close" onClick={() => setArrival(null)}>✕</button>
        </div>
      )}

      {toast && (() => {
        const prio = toast.priority || "info";
        const icon = prio === "urgent" ? "🔴" : prio === "warning" ? "🟡" : "🟢";
        const borderColor = prio === "urgent" ? "rgba(239,68,68,0.6)" : prio === "warning" ? "rgba(234,179,8,0.5)" : "rgba(34,197,94,0.45)";
        const bg = prio === "urgent" ? "rgba(239,68,68,0.07)" : prio === "warning" ? "rgba(234,179,8,0.06)" : "transparent";
        return (
        <div className="fixed bottom-6 right-6 z-[60] flex items-center gap-3 px-5 py-3.5 rounded-2xl"
             style={{ background: `var(--surface-raised)`, border: `2px solid ${borderColor}`, boxShadow: `0 20px 60px rgba(17,24,39,0.14)`, animation: "slideUp 0.3s ease both" }}>
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-base flex-shrink-0" style={{ background: bg }}>
            <Glyph e={icon} size={16} />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-900">{toast.text}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">{toast.sub}</div>
          </div>
          <button onClick={() => setToast(null)} className="ml-2 text-slate-600 hover:text-slate-500 text-xs">✕</button>
        </div>
        );
      })()}

      <Topbar title="Machine Tracker" subtitle="Mechanical → Electrical → Trial → Ready">
        {/* 2026-10-31 — the Report Center opens from here (no sidebar entry). */}
        {/* 2026-11-03 — one Reports menu: the four PDF reports, plus the full
            Report Center link inside it. */}
        {canView("reports") && (
          <button type="button" data-reports-menu onClick={() => { setReportsMenu(true); setReportPick((prev) => prev || String(((machineLog || []).slice().reverse()[0] || {}).id || "")); }}
                  className="h-9 px-3 rounded-lg text-[12px] font-black flex items-center gap-1.5"
                  style={{ background: "rgba(46, 80, 214,0.10)", color: "#2640B0", border: "1px solid rgba(46, 80, 214,0.35)" }}
                  title="Customer, company, on hold and pending jobs reports">
            <LeadIcon e="📄" />Reports
          </button>
        )}
        {/* Departments Called, behind a bell. Same count and same scope as the
            panel it opens; hidden for a floor login, as the panel always was. */}
        {!staffMode && (() => {
          const calledN = (pendingHandoverItems || [])
            .filter(pendingItemIsOpen)
            .filter((p) => !scopeMine || myDepartments.includes(p.assignedDepartment)).length;
          return (
            <button type="button" onClick={() => setShowCalled((v) => !v)}
                    aria-label={`Departments called: ${calledN} open`}
                    title={calledN ? `${calledN} open issue${calledN === 1 ? "" : "s"} — departments called` : "No department has been called"}
                    className="relative w-9 h-9 rounded-lg flex items-center justify-center transition-all"
                    style={{ border: "1px solid var(--border-subtle)", background: showCalled ? "rgba(220,38,38,0.08)" : "var(--surface-card)",
                             color: calledN ? "#dc2626" : "var(--text-dim)" }}>
              <Bell size={17} aria-hidden="true" />
              {calledN > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-black text-white flex items-center justify-center"
                      style={{ background: "#dc2626", boxShadow: "0 0 0 2px var(--surface-card)" }}>{calledN}</span>
              )}
            </button>
          );
        })()}
        {/* Admin-only quick jump to the Department Workflow Settings tab:
            deadlines, HOLD rules, checklist templates, signature + password
            policy. Hidden from non-admin operators. */}
        {canConfigureDept(canDo) && (
          <button data-mt-settings onClick={() => onNavigate("machines_settings")}
                  title="Open Machine Tracker settings (deadlines, HOLD rules, checklists, employees)"
                  className="h-9 px-3 rounded-lg text-[12px] font-black inline-flex items-center gap-1.5 transition-all"
                  style={{ background: "rgba(46, 80, 214,0.1)", border: "1px solid rgba(46, 80, 214,0.35)", color: "#2640B0" }}>
            <LeadLabel text="⚙️ Settings" />
          </button>
        )}
      </Topbar>

      <div className="p-4 sm:p-6 space-y-5">

        {/* Search: type a machine name or serial number, the list shows it. */}
        {!staffMode && (
          <div className="relative" data-mt-search>
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[18px] pointer-events-none"><Glyph e="🔍" size={18} /></span>
            <input type="search" value={searchQ} data-mt-search-input
                   onChange={(e) => {
                     const v = e.target.value; setSearchQ(v); if (v.trim()) setMtTab("production");
                     if (v.trim()) setTimeout(() => { try { document.querySelector("[data-view-header]")?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch { /* ignore */ } }, 80);
                   }}
                   placeholder="Search machine or serial no."
                   className="w-full rounded-2xl bg-white border-2 border-slate-300 focus:border-blue-600 outline-none pl-12 pr-12 text-[16px] font-semibold text-slate-900"
                   style={{ minHeight: 52 }} />
            {searchQ && (
              <button type="button" aria-label="Clear search" onClick={() => setSearchQ("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-slate-100 text-slate-600 font-black">✕</button>
            )}
          </div>
        )}

        {/* 2026-11-03 — admin "Today" line: the day in one sentence, from the
            same lists the count boxes use. Each chip applies that box's filter. */}
        {!staffMode && (() => {
          const parts = [
            { key: "hold",          tab: "transfer",   icon: "🔴", n: onHold.length,        word: "late",              color: "#b91c1c", bg: "rgba(239,68,68,0.08)",  bd: "rgba(239,68,68,0.40)" },
            { key: "pendingAccept", tab: "transfer",   icon: "🟠", n: pendingAccept.length, word: "waiting to accept", color: "#b45309", bg: "rgba(217,119,6,0.08)",  bd: "rgba(217,119,6,0.40)" },
            { key: "completed",     tab: "production", icon: "🟢", n: completed.length,     word: "ready",             color: "#15803d", bg: "rgba(21,128,61,0.08)",  bd: "rgba(21,128,61,0.35)" },
          ].filter((x) => x.n > 0);
          return (
            <div className="mt-today flex items-center gap-2 flex-wrap" data-mt-today>
              <span className="text-[16px] font-black mr-1" style={{ color: "var(--text-strong)" }}>Today:</span>
              {parts.length === 0 && (
                <span className="text-[16px] font-black" style={{ color: "#15803d" }} data-mt-today-ok><LeadIcon e="✅" />All machines on time</span>
              )}
              {isClosedDay(nowTick) && (
                <span data-mt-closed-day className="min-h-[36px] px-3 rounded-full text-[13px] font-bold inline-flex items-center gap-1.5"
                      style={{ background: "rgba(99,102,241,0.08)", color: "#4338ca", border: "1px solid rgba(99,102,241,0.30)" }}>
                  ⏸ Closed day — all timers paused
                </span>
              )}
              {parts.map((x) => {
                const isOn = !searchText && mtTab === x.tab && filter === x.key;
                return (
                  <button key={x.key} type="button" data-mt-today-chip={x.key} aria-pressed={isOn}
                          onClick={() => {
                            setSearchQ(""); setMtTab(x.tab); setFilter(x.key);
                            setTimeout(() => { try { document.querySelector("[data-view-header]")?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch { /* ignore */ } }, 80);
                          }}
                          className="min-h-[44px] px-4 rounded-full text-[15px] font-bold inline-flex items-center gap-1.5 transition-all active:scale-[0.97]"
                          style={{ background: x.bg, color: x.color, border: `${isOn ? 2 : 1}px solid ${isOn ? x.color : x.bd}` }}>
                    <Glyph e={x.icon} />
                    <span className="tabular-nums">{x.n}</span> {x.word}
                  </button>
                );
              })}
            </div>
          );
        })()}

        {/* ── BOM Outward (2026-10-30) ──
            The Outward page's own BOM section, embedded: issuing here and
            issuing from Outward are the same component and the same code. */}
        {bomSection && (
          // No overflow-hidden: it clipped the BOM ⋮ menu. no-lift: this card
          // holds the BOM popups (serial, drawer, delete) — a hover transform
          // here re-anchors them to the card and they flicker. See index.css.
          <div className="section-card no-lift" id="mt-bom-section">
            <button type="button" onClick={toggleBom} aria-expanded={bomOpen}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left">
              <span className="text-[13px] font-bold" style={{ color: "var(--text-strong)" }}>Issue a BOM</span>
              <span className="text-[11px] font-semibold" style={{ color: "var(--text-dim)" }}>{bomOpen ? "Hide ▲" : "Show ▼"}</span>
            </button>
            {bomOpen && <div className="px-4 pb-4">{bomSection}</div>}
          </div>
        )}

        {/* ── Department-wise staff dashboard (2026-11-01) ──
            Everyone who is not an admin works from this compact view instead of
            the factory tracker: their own departments, the machines waiting
            on them, their open jobs, and only the actions their role allows.
            Every button opens the same modal the admin tracker opens
            (openAcceptModal / openFinishModal / openDuringWorkModal /
            setRaiseModal / setJobsDrawer / setJobAction) — the handlers,
            signatures and checklists are untouched. No machine history,
            ratings or reports: those stay admin-only. */}
        {staffMode && (() => {
          // World UI (2026-11-04): one button anatomy, tone by meaning (classes in world-ui.css).
          const btn = "min-h-[48px] w-full sm:w-auto text-[15px] wu-btn";
          const canAccept  = canAcceptHandover(canDo) && !!onAcceptHandover;
          const canFinish  = canFinishTransfer(canDo) && !!onFinishTransfer;
          const canJobs    = canFinishTransfer(canDo);
          const canReport  = !!onRaisePendingItem && canDo("machines", "accept");
          const machineOf  = (h) => (machineLog || []).find((m) => String(m.id) === String(h.machineId)) || null;
          const titleOf    = (m, h) => `${(m && m.bomKey) || (h && h.bomKey) || "Machine"}${(m && m.serialNo) || (h && h.serialNo) ? ` · S/N ${(m && m.serialNo) || h.serialNo}` : ""}`;
          const openJobsOf = (m) => (pendingHandoverItems || []).filter((p) => String(p.machineId) === String(m.id) && pendingItemIsOpen(p));
          const toAccept   = askableHandovers.filter((h) => myDepartments.includes(h.toDepartment));
          // 2026-11-03 — the receiving department takes the machine off the
          // rack itself: release + Accept (people, signature, checklist) in one go.
          const rackForMe  = (handovers || []).filter((h) => h.status === "pending" && isAwaitingRelease(h) && myDepartments.includes(h.toDepartment));
          const canTakeFromRack = canReleaseFromRack && !!onReleaseHandover;
          const sentOn     = startedAll.filter((m) => { if (m.status === "completed") return false; const h = machineHandover(m); return h && myDepartments.includes(h.fromDepartment) && !myDepartments.includes(h.toDepartment); });
          const myJobs     = (pendingHandoverItems || []).filter((p) => pendingItemIsOpen(p) && myDepartments.includes(p.assignedDepartment));
          const awaitingRelease = startedAll.filter((m) => { const h = machineHandover(m); return !!(h && isAwaitingRelease(h)); });
          // Section / Empty / Card: module-level (StaffSection, StaffEmpty, StaffCard above).
          const Section = StaffSection;
          const Empty = StaffEmpty;
          const Card  = StaffCard;
          // Where the machine is on the line (display only — read from its stage).
          const LINE = ["Assembly", "Mechanical", "Electrical", "Trial", "Ready"];
          const stageLine = (stage) => {
            const at = LINE.indexOf(stage);
            if (at < 0) return null;
            return (
              <div className="wu-line" data-wu-stages aria-label={`Stage: ${stage}`}>
                {LINE.map((d, i) => <span key={d} className={i < at ? "is-done" : i === at ? "is-now" : ""} title={d} />)}
                <em>Step {at + 1} of {LINE.length}</em>
              </div>
            );
          };
          // 2026-11-03 — "▶ 🎤 2": the machine has voice notes; tap plays the latest.
          const voiceBadge = (m) => {
            const vs = m ? voiceNotesFor(attachments, m.id) : [];
            if (!vs.length) return null;
            return <span data-staff-voice={m.id} className="inline-flex" title="Play the latest voice note"><VoicePlayButton attachment={vs[0]} label={`🎤 ${vs.length}`} /></span>;
          };
          // 2026-11-04 (MT audit) — a manual ON HOLD shows here exactly as on
          // the admin card: red badge with the reason, no Finish / Accept /
          // Take (the handlers refuse them anyway), and the same Hold /
          // Release button for the same permission.
          const canHoldM = !!onSetMachineHold && (isAdminUser || canFinishTransfer(canDo) || canDo("machines", "updateStage"));
          const holdBadge = (m) => (m && m.holdActive) ? (
            <div data-staff-hold-badge={m.id} className="wu-hold-badge">
              <LeadIcon e="⏸" />ON HOLD{m.holdReason ? ` · ${m.holdReason}` : ""}
            </div>
          ) : null;
          const holdBtn = (m) => (canHoldM && m) ? (
            <button data-needs-net type="button" className={`${btn} ${m.holdActive ? "wu-soft-ok" : "wu-soft"}`}
                    {...(m.holdActive ? { "data-staff-release-hold": m.id } : { "data-staff-hold": m.id })}
                    onClick={() => setHoldModal({ machine: m, release: !!m.holdActive, reason: "", busy: false, error: "" })}>
              <LeadLabel text={m.holdActive ? "▶ Release ON HOLD" : "⏸ ON HOLD"} />
            </button>
          ) : null;
          const heldNote = (m, what) => (
            <div data-staff-held={m.id} className="wu-held">
              <LeadIcon e="⏸" />On hold — release the hold to {what}
            </div>
          );
          // Migration 061 — the BOM's machine photo (64px) at the left of the
          // card's title block, so workers recognise the machine at a glance.
          // World UI: picture first on every card; a machine without a BOM photo
          // gets a quiet machine tile so all cards line up the same way.
          const withPhoto  = (m, h, body) => {
            const url = (bomDefs || {})[(m && m.bomKey) || (h && h.bomKey)]?.photoUrl;
            return (
              <div className="wu-card-top">
                <BomPhotoThumb url={url} size={64} className="wu-photo"
                               fallback={<span className="wu-photo wu-photo-ph" aria-hidden="true"><Wrench size={24} strokeWidth={1.7} /></span>} />
                <div className="min-w-0 flex-1">{body}</div>
              </div>
            );
          };
          // Route: Rack → Accept → Work → Send, with counts. Tap a step to jump to it.
          const route = [
            { key: "rack",   label: "Rack",   n: rackForMe.length,  sec: "On the rack for you" },
            { key: "accept", label: "Accept", n: toAccept.length,   sec: "To accept" },
            { key: "work",   label: "Work",   n: myWorking.length,  sec: "In your department" },
            { key: "send",   label: "Send",   n: sentOn.length,     sec: "Sent on" },
          ];
          const canActOn = { rack: canTakeFromRack && canAccept, accept: canAccept, work: true };
          const nowStep = (route.find((r) => r.key !== "send" && r.n > 0 && canActOn[r.key]) || route.find((r) => r.n > 0) || route[3]).key;
          const goStep = (sec) => { try { document.querySelector(`[data-staff-section='${sec}']`)?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch { /* ignore */ } };
          // No department: say so and show nothing else. A Store Manager still
          // keeps the BOM section above when the role may issue a BOM.
          if (!isProdHead && !hasDepartments) {
            return (
              <div className="rounded-2xl p-8 text-center" data-staff-no-dept
                   style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.4)" }}>
                <div className="text-[16px] font-black" style={{ color: "#b45309" }}>No department assigned yet — ask your admin</div>
                <div className="text-[13px] text-slate-600 mt-1.5 max-w-md mx-auto">
                  Your machines appear here once an admin sets your department in User Management.
                </div>
              </div>
            );
          }
          return (
            <div className="wu-staff" data-staff-dashboard>
              {/* World UI header: who I am, the route with counts, My Dashboard. */}
              <div className="wu-staff-hero" data-staff-hero>
                <div className="wu-hero-row">
                  <div className="min-w-0 flex-1">
                    <span className="wu-hero-k">
                      {isProdHead ? "Production Head" : `Your department${myDepartments.length === 1 ? "" : "s"}:`}
                    </span>
                    <span className="wu-hero-dept">
                      {isProdHead ? "Rack release" : myDepartments.join(", ")}
                    </span>
                    {currentUser?.fullName && <span className="wu-hero-name">{currentUser.fullName}</span>}
                  </div>
                  {!isProdHead && (
                    <button type="button" data-arrival-toggle aria-pressed={arrivalOn} onClick={toggleArrival}
                            aria-label={arrivalOn ? "Arrival alert on — tap to turn off" : "Arrival alert off — tap to turn on"}
                            title={arrivalOn ? "Alert sound ON" : "Alert sound OFF"}
                            className={`wu-alert${arrivalOn ? " is-on" : ""}`}>
                      <LeadLabel text={arrivalOn ? "🔔 On" : "🔕 Off"} />
                    </button>
                  )}
                </div>
                {!isProdHead && hasDepartments && (
                  <nav className="wu-route" aria-label="Your work, step by step" data-staff-route>
                    {route.map((r, i) => (
                      <React.Fragment key={r.key}>
                        {i > 0 && <span className="wu-route-sep" aria-hidden="true" />}
                        <button type="button" data-staff-route-step={r.key} onClick={() => goStep(r.sec)}
                                className={`wu-step${r.key === nowStep ? " is-now" : ""}${r.n ? " has" : ""}`}
                                aria-current={r.key === nowStep ? "step" : undefined}>
                          <span className="wu-step-n tabular-nums"><Count value={r.n} /></span>
                          <span className="wu-step-l">{r.label}</span>
                        </button>
                      </React.Fragment>
                    ))}
                  </nav>
                )}
                {/* My Dashboard — opens the read-only scorecard for my departments */}
                {!isProdHead && hasDepartments && (
                  <button type="button" data-my-dashboard-open onClick={() => setMyDashOpen(true)} className="wu-mydash">
                    <LeadIcon e="📊" />My Dashboard
                  </button>
                )}
              </div>

              {/* Production Head: machines assembled on the rack, waiting to be sent on */}
              {isProdHead && (
                <Section title="Awaiting release from rack" count={awaitingRelease.length} hint="assembled — send to the next department">
                  {awaitingRelease.length === 0 && <Empty text="Nothing is waiting on the rack." />}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {awaitingRelease.map((m) => <SafeBoundary key={m.id} name="staff-awaiting-card" label="this machine card" render={() => {
                      const h = machineHandover(m);
                      return (
                        <Card key={m.id} mid={m.id}>
                          {withPhoto(m, h, <div>
                            <div className="wu-title">{titleOf(m, h)}</div>
                            <div className="wu-meta">
                              {m.bomLabel || ""}{m.rackSlot ? ` · ${slotLabel(m.rackSlot)}` : " · on the rack"} · to {h.toDepartment}
                            </div>
                          </div>)}
                          {/* The release itself happens only in the Rack View
                              (details panel / crate face — same handler, same
                              gate). This opens that machine's rack panel. */}
                          {canReleaseFromRack && onReleaseHandover && (
                            <button type="button" data-staff-release={h.id} className={`${btn} wu-rack`}
                                    onClick={() => {
                                      if (m.rackSlot) { setRackPanel(m.rackSlot); return; }
                                      try { document.querySelector(".rack-shelf")?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch {}
                                    }}>
                              → Send to {h.toDepartment}
                            </button>
                          )}
                        </Card>
                      );
                    }} />)}
                  </div>
                </Section>
              )}

              {/* On the rack for my department: take it myself */}
              {!isProdHead && rackForMe.length > 0 && (
                <Section title="On the rack for you" count={rackForMe.length}>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {rackForMe.map((h) => {
                      const m = machineOf(h);
                      return (
                        <Card key={h.id} tone="rack" mid={(m && m.id) || h.machineId}>
                          {withPhoto(m, h, <div>
                            <div className="wu-title">{titleOf(m, h)}</div>
                            <div className="wu-meta">
                              {m?.bomLabel ? `${m.bomLabel} · ` : ""}<span className="whitespace-nowrap">{m?.rackSlot ? `Rack ${slotLabel(m.rackSlot)}` : "on the rack"}</span>
                            </div>
                            {holdBadge(m)}
                          </div>)}
                          {m && m.holdActive ? heldNote(m, "take it") : canTakeFromRack && canAccept ? (
                            <button data-needs-net type="button" data-staff-take={h.id} className={`${btn} wu-rack`}
                                    disabled={!!acceptModal || rackTakeBusy === h.id}
                                    onClick={async () => {
                                      if (acceptModal || rackTakeBusy) return;
                                      setRackTakeBusy(h.id);
                                      const r = await onReleaseHandover(h.id);
                                      setRackTakeBusy(null);
                                      if (!r || r.success === false) { showToast("Could not take", r?.error || "", "urgent"); return; }
                                      openAcceptModal({ ...h, ...(r.handover || {}), releasedAt: (r.handover && r.handover.releasedAt) || new Date().toISOString() });
                                    }}>
                              <LeadLabel text={rackTakeBusy === h.id ? "⏳ Please wait…" : "📥 Take from Rack"} />
                            </button>
                          ) : (
                            <div className="wu-note wu-note-rack">Waiting for your head to take it</div>
                          )}
                          {m && m.holdActive && holdBtn(m)}
                        </Card>
                      );
                    })}
                  </div>
                </Section>
              )}

              {/* To accept */}
              {!isProdHead && (
                <Section title="To accept" count={toAccept.length} hint="handed to your department">
                  {toAccept.length === 0 && <Empty text="No machine is waiting for you to accept." />}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {toAccept.map((h) => {
                      const m = machineOf(h);
                      const late = isHoldOverdue(h.sentAt, h.acceptTimeoutMinutes, nowTick);
                      const waited = h.sentAt ? formatDuration(Math.max(0, Math.floor((nowTick - Date.parse(h.sentAt)) / 60000))) : "";
                      return (
                        <Card key={h.id} tone={late ? "bad" : "wait"} mid={(m && m.id) || h.machineId}>
                          {withPhoto(m, h, <div>
                            <div className="wu-title">{titleOf(m, h)}</div>
                            <div className="wu-meta">
                              {m?.bomLabel ? `${m.bomLabel} · ` : ""}from {h.fromDepartment}{waited ? ` · waiting ${waited}` : ""}
                            </div>
                            {stageLine(h.toDepartment)}
                            {late && <div className="wu-note wu-note-bad"><LeadIcon e="🚦" />ON HOLD — accept deadline passed</div>}
                            {holdBadge(m)}
                            {voiceBadge(m) && <div className="mt-2">{voiceBadge(m)}</div>}
                          </div>)}
                          {canAccept && m && m.holdActive && heldNote(m, "accept it")}
                          {m && m.holdActive && holdBtn(m)}
                          {canAccept && !(m && m.holdActive) && (
                            <button data-needs-net type="button" data-staff-accept={h.id} className={`${btn} wu-ok wu-main`}
                                    disabled={!!acceptModal} onClick={() => { if (!acceptModal) openAcceptModal(h); }}>
                              ✓ Accept into {h.toDepartment}
                            </button>
                          )}
                        </Card>
                      );
                    })}
                  </div>
                </Section>
              )}

              {/* In your department */}
              {!isProdHead && (
                <Section title="In your department" count={myWorking.length} hint="machines you are working on">
                  {myWorking.length === 0 && <Empty text="No machine is in your department right now." />}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {myWorking.map((m) => <SafeBoundary key={m.id} name="staff-working-card" label="this machine card" render={() => {
                      const dept   = m.currentDepartment || m.stage;
                      const next   = nextDepartment(dept);
                      const { target, t, level, leftMinutes } = deptTimerOf(m);
                      const jobs   = openJobsOf(m);
                      const during = !!onSubmitDuringWorkChecklist && !!pickTemplate(checklistTemplates, m.bomKey, dept, "during_work");
                      return (
                        <Card key={m.id} mid={m.id}>
                          {withPhoto(m, null, <div>
                            <div className="wu-title">{titleOf(m)}</div>
                            <div className="wu-meta">{m.bomLabel || ""}{m.bomLabel ? " · " : ""}in {dept}</div>
                            {stageLine(dept)}
                            <div className="flex items-center gap-2 flex-wrap mt-2">
                              {t && (
                                <span className={`wu-timer ${t.isOverrun ? "is-bad" : level === 80 ? "is-wait" : "is-ok"}`} data-staff-timer={m.id} data-timer-level={level}
                                      title={`⏱ ${formatDuration(t.actualMinutes)}${target ? ` / ${formatDuration(target)}` : ""}`}>
                                  <LeadLabel text={t.isOverrun ? `⏰ Late by ${formatDuration(t.overrunMinutes)}`
                                    : level === 80 ? `⏳ ${formatDuration(leftMinutes)} left`
                                    : `⏱ ${formatDuration(t.actualMinutes)}${target ? ` / ${formatDuration(target)}` : ""}`} />
                                </span>
                              )}
                              {jobs.length > 0 && (
                                <button type="button" data-staff-jobs={m.id} onClick={() => setJobsDrawer(m.id)} className="wu-chip wu-chip-bad">
                                  <LeadIcon e="⚠" />{jobs.length} open job{jobs.length === 1 ? "" : "s"}
                                </button>
                              )}
                              {voiceBadge(m)}
                            </div>
                            {holdBadge(m)}
                          </div>)}
                          <div className="wu-actions">
                            {during && (
                              <button type="button" data-staff-during={m.id} className={`${btn} wu-soft`} onClick={() => openDuringWorkModal(m)}>
                                <LeadIcon e="📋" />During-Work Checks
                              </button>
                            )}
                            {canReport && (
                              <button type="button" data-staff-issue={m.id} className={`${btn} wu-soft-bad`}
                                      onClick={() => { setRaiseModal({ machine: m }); setRaiseText(""); setRaiseDept(""); setRaiseErr(""); setRaisePart(emptyPendingJob()); }}>
                                Report Issue
                              </button>
                            )}
                            {m.trialCertificate && canFinish && onUpdateTrialCertificate && (
                              <button type="button" className={`${btn} wu-soft`}
                                      onClick={() => setTrialCertModal({ machine: m, editOnly: true })}>
                                <LeadIcon e="✎" />Certificate
                              </button>
                            )}
                            {next && canFinish && m.holdActive && heldNote(m, "finish it")}
                            {next && canFinish && !m.holdActive && (
                              <button data-needs-net type="button" data-staff-finish={m.id} className={`${btn} wu-ok wu-main`} onClick={() => openFinishModal(m)}>
                                ✓ Finish → {next}
                              </button>
                            )}
                            {holdBtn(m)}
                          </div>
                        </Card>
                      );
                    }} />)}
                  </div>
                </Section>
              )}

              {/* Sent on — read-only, so the department knows its transfer went through */}
              {!isProdHead && sentOn.length > 0 && (
                <Section title="Sent on" count={sentOn.length} hint="waiting for the next department to accept">
                  <div className="flex flex-col gap-2">
                    {sentOn.map((m) => { const h = machineHandover(m);
                      // 2026-11-03 — Sender Undo: the button shows itself only for the
                      // sender, within 5 min, while not yet accepted (senderUndoState).
                      return (
                      <div key={m.id} data-sent-on={m.id} data-mt-mid={m.id} className="wu-sent">
                        <div className="flex-1 min-w-0">
                          <span className="font-black">{titleOf(m, h)}</span> <span style={{ color: "var(--text-dim)" }}>→ {h.toDepartment} · awaiting accept</span>
                        </div>
                        {canFinish && onPullBackHandover && (
                          <SenderUndoButton handover={h} user={currentUser} onUndo={(ho) => setUndoAsk({ handover: ho, busy: false })} />
                        )}
                      </div>
                    ); })}
                  </div>
                </Section>
              )}

              {/* Pending jobs for your department */}
              {!isProdHead && (
                <Section title="Pending jobs for your department" count={myJobs.length} hint="parts and work still open — never blocks a transfer">
                  {myJobs.length === 0 && <Empty text="No open job for your department." />}
                  <div className="flex flex-col gap-2">
                    {myJobs.map((p) => {
                      const m = (machineLog || []).find((x) => String(x.id) === String(p.machineId)) || null;
                      const stage = pendingItemStage(p);
                      return (
                        <div key={p.id} className="mt-card no-lift wu-card wu-job" data-staff-job={p.id}>
                          <div>
                            <div className="wu-title wu-title-sm">{p.description}</div>
                            <div className="wu-meta">
                              {m ? `${m.bomKey}${m.serialNo ? ` · S/N ${m.serialNo}` : ""}` : "Machine"}
                              {(p.itemCode || p.itemName) ? ` · part ${p.itemCode || p.itemName}${p.qty != null ? ` × ${p.qty}` : ""}` : ""}
                              {p.critical ? " · CRITICAL" : ""}
                              {stage === "received" ? " · part received, finish the work" : ""}
                              {stage === "partial" ? ` · ${p.qty != null ? `${p.receivedQty} of ${p.qty}` : p.receivedQty} received · ${pendingItemRemaining(p) ?? 0} still pending` : ""}
                            </div>
                          </div>
                          {canJobs && (
                            <div className="wu-actions">
                              {onReceivePendingItem && pendingItemIsPart(p) && canReceiveJob(p) && !p.receivedAt && (
                                <button data-needs-net type="button" className={`${btn} wu-soft`}
                                        onClick={() => setJobAction({ item: p, action: "receive", notes: "", busy: false, error: "" })}>
                                  <LeadLabel text="📦 Part received" />
                                </button>
                              )}
                              {onResolvePendingItem && !pendingItemIsPart(p) && (
                                <button data-needs-net type="button" className={`${btn} wu-ok`}
                                        onClick={() => setJobAction({ item: p, action: "complete", notes: "", busy: false, error: "" })}>
                                  ✓ Work completed
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Section>
              )}
            </div>
          );
        })()}

        {/* ── Pending Jobs (2026-10-30) ──
            Every unfinished job and missing part, grouped by machine and serial
            number, with the department that owes it. The responsible department
            records the part as received, then the work as completed, here or on
            the machine card — the same handlers either way. */}
        {!staffMode && mtTab === "pending" && (() => {
          const allJobsScoped = (pendingHandoverItems || [])
            .filter((p) => !scopeMine || myDepartments.includes(p.assignedDepartment));
          const userName = (id) => { if (!id) return ""; const u = (allUsers || []).find((x) => x.id === id); return u ? (u.fullName || u.username || "") : ""; };
          const canAct = canFinishTransfer(canDo);
          const partsOpenN = openJobsScoped.filter(pendingItemIsPart).length;
          const workOpenN  = openJobsScoped.length - partsOpenN;
          const doneN      = allJobsScoped.filter(pendingItemIsDone).length;
          return (
            <div className="section-card p-4 sm:p-5">
              <div className="flex items-center gap-2.5 flex-wrap mb-4">
                <div className="sec-icon" style={{ background: "rgba(220,38,38,0.08)", color: "#dc2626" }}><AlertOctagon size={16} /></div>
                <span className="text-[13px] font-bold" style={{ color: "var(--text-strong)" }}>Pending Jobs</span>
                <span className="sp-pill sp-pill-red" data-jobs-total-open>{openJobsScoped.length} open</span>
                <span data-jobs-head-parts className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(217,119,6,0.12)", color: "#b45309" }}>Parts {partsOpenN} pending</span>
                <span data-jobs-head-work className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(37,99,235,0.1)", color: "#1d4ed8" }}>Work {workOpenN} pending</span>
                <span data-jobs-head-done className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(22,163,74,0.1)", color: "#15803d" }}>{doneN} completed</span>
              </div>
              {renderJobBoard(allJobsScoped, { detailsKey: "completed" })}
            </div>
          );
        })()}

        {/* Nothing to accept — said, rather than an empty tab top. */}
        {!staffMode && mtTab === "transfer" && askableHandovers.length === 0 && (
          <div className="text-[12px] px-4 py-3 rounded-xl" style={{ background: "var(--surface-raised)", color: "var(--text-dim)", border: "1px solid var(--border-subtle)" }}>
            No machine is waiting to be accepted right now. Machines in production are listed below — finish & transfer from each card.
          </div>
        )}

        {/* ── Pending Acceptance section (prominent, top-of-page) ──
            Factory staff see this before any other list. Shows machines
            waiting to be accepted into the receiving department, with a
            large "Accept Machine" button for authorized operators and
            visible countdown to the 2-hour acceptance deadline. */}
        {/* Only handovers someone has actually been asked to accept. One parked
            on the rack (migration 036) is waiting for a production head to
            release it — listing it here put an "Accept Machine" button on it
            and let the receiving department skip the release entirely. Its
            Release button lives on the machine card. */}
        {!staffMode && mtTab === "transfer" && askableHandovers.length > 0 && (
          <div className="rounded-2xl p-5"
               style={{ background: "linear-gradient(135deg,rgba(217, 119, 6,0.08),rgba(234,88,12,0.03))", border: `2px solid ${overdueHandovers.length ? "rgba(239,68,68,0.55)" : "rgba(217, 119, 6,0.45)"}`, boxShadow: overdueHandovers.length ? "0 0 24px rgba(239,68,68,0.15)" : "0 0 16px rgba(217, 119, 6,0.1)" }}>
            <div className="flex items-center gap-4 mb-4 flex-wrap">
              <div className="flex items-baseline gap-3">
                <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-amber-700">Pending Acceptance</div>
                <div className="text-4xl font-black" style={{ color: overdueHandovers.length ? "#dc2626" : "#B45309" }}>{askableHandovers.length}</div>
                <div className="text-[11px] text-slate-400">machine{askableHandovers.length === 1 ? "" : "s"} waiting for the next department</div>
              </div>
              {overdueHandovers.length > 0 && (
                <span className="text-[11px] font-black px-3 py-1 rounded-full"
                      style={{ background: "rgba(239,68,68,0.2)", color: "#dc2626", border: "1px solid rgba(239,68,68,0.5)" }}>
                  <LeadIcon e="🚦" />{overdueHandovers.length} ON HOLD
                </span>
              )}
            </div>
            <div className="space-y-2.5">
              {askableHandovers.map((h) => {
                // Working minutes only (Tuesdays / holidays pause the clock).
                const sentMin   = computeElapsedMinutes(h.sentAt, nowTick);
                const overdue   = isHoldOverdue(h.sentAt, h.acceptTimeoutMinutes, nowTick);
                const heldMin   = heldMinutes(h.sentAt, h.acceptTimeoutMinutes, nowTick);
                const minsLeft  = (h.acceptTimeoutMinutes || 0) - sentMin;
                const approaching = !overdue && minsLeft >= 0 && minsLeft <= 15;   // within 15 min of deadline
                const canAccept = canAcceptHandover(canDo, h.toDepartment);
                const statusLabel = overdue    ? { text: "🚦 ON HOLD",        color: "#dc2626", bg: "rgba(239,68,68,0.18)",  bd: "rgba(239,68,68,0.5)"  }
                                   : approaching ? { text: "⚠ Deadline Soon",  color: "#b45309", bg: "rgba(234,179,8,0.18)",  bd: "rgba(234,179,8,0.5)"  }
                                   :              { text: "⏳ Awaiting Accept", color: "#B45309", bg: "rgba(217, 119, 6,0.14)", bd: "rgba(217, 119, 6,0.4)" };
                return (
                  <div key={h.id}
                       className="flex items-center gap-4 flex-wrap rounded-xl px-4 py-3"
                       style={{ background: overdue ? "rgba(239,68,68,0.08)" : "rgba(17,24,39,0.04)", border: `1px solid ${overdue ? "rgba(239,68,68,0.35)" : "rgba(17,24,39,0.10)"}` }}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[14px] font-black text-slate-900">{h.bomKey}</span>
                        {h.serialNo && <span className="text-[12px] text-blue-300 font-mono">S/N {h.serialNo}</span>}
                        <span className="text-[10px] font-black px-2 py-0.5 rounded-full"
                              style={{ background: statusLabel.bg, color: statusLabel.color, border: `1px solid ${statusLabel.bd}` }}>
                          {statusLabel.text}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-1">
                        <span className="font-semibold text-slate-500">{h.fromDepartment}</span>
                        <span className="mx-1.5 text-slate-500">→</span>
                        <span className="font-bold text-amber-700">{h.toDepartment}</span>
                        <span className="text-slate-500 ml-2">· sent {formatDuration(sentMin)} ago</span>
                        {overdue && <span className="text-red-400 font-bold ml-2">· HOLD for {formatDuration(heldMin)}</span>}
                        {approaching && <span className="text-yellow-300 font-bold ml-2">· {minsLeft} min to deadline</span>}
                        {h.overrunMinutes > 0 && <span className="text-yellow-300 ml-2">· work overrun {formatDuration(h.overrunMinutes)}</span>}
                      </div>
                      {h.overrunNarration && (
                        <div className="text-[11px] text-slate-500 mt-1.5 italic">"{h.overrunNarration}"</div>
                      )}
                    </div>
                    {isAdminUser && onPullBackHandover && (
                      <button type="button" onClick={() => setPullBack({ handover: h, reason: "", busy: false, error: "" })}
                              title="Admin: cancel this hand-over and return the machine to the sending department"
                              className="text-[11px] font-bold px-3 py-2 rounded-lg border transition-all"
                              style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.35)", color: "#b91c1c" }}>
                        ↩ Pull back
                      </button>
                    )}
                    {canAccept && onAcceptHandover ? (
                      <button onClick={() => openAcceptModal(h)} data-needs-net
                              className="text-[12px] font-black text-slate-900 px-5 py-2.5 rounded-xl transition-all hover:scale-105"
                              style={{ background: "#15803d", boxShadow: "0 1px 2px rgba(17,24,39,0.14)", minWidth: 160, color: "#ffffff" }}>
                        ✓ Accept Machine
                      </button>
                    ) : (
                      <span className="text-[10px] text-slate-500 italic px-2 py-1">
                        {!canAccept ? `Only ${h.toDepartment} role can accept` : "Accept action unavailable"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Clickable summary cards (click any card to filter the list) ──
            Five distinct categories matching the owner's spec:
              Pending Acceptance = pending AND within accept deadline
              Overdue            = pending AND past accept deadline
              On HOLD            = explicit workflow HOLD state (reserved,
                                   currently 0 — no silent conversion from
                                   Overdue, future state would need its own
                                   workflow)
              Active Builds      = still in production
              Ready              = reached the final stage
            Clicking a card sets the main-list filter; current filter card
            is outlined. */}
        {/* ── Phase 1 — My Work scope switch ──
            Only shown to people who actually belong to a department. Admins and
            unassigned users never see it and keep the full list. */}
        {/* A floor login with no department assigned must see nothing, not
            everything. Say so plainly rather than silently showing an empty
            page the operator cannot explain. */}
        {!staffMode && isFloorLogin && !hasDepartments && (
          <div className="rounded-2xl p-8 text-center"
               style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.4)" }}>
            <div className="text-sm font-black" style={{ color: "#b45309" }}>No department assigned to this login</div>
            <div className="text-[12px] text-slate-600 mt-1.5 max-w-md mx-auto">
              Until an admin sets a department on this user in User Management, there is no work to show here.
            </div>
          </div>
        )}

        {!staffMode && isFloorLogin && hasDepartments && (
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-[13px] font-black text-slate-800">{myDepartments.join(", ")}</span>
            {(() => {
              const n = myTakeIn.length + myWorking.length + myToFix.length + myOwed.length;
              return (
                <span className="text-[12px] text-slate-600">
                  {n === 0 ? "nothing needs you right now" : `${n} machine${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} you`}
                </span>
              );
            })()}
          </div>
        )}

        {!staffMode && showScopeSwitch && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex rounded-xl p-1" style={{ background: "rgba(17,24,39,0.05)" }}>
              <button type="button" onClick={() => setScope("mine")}
                      aria-pressed={scopeMine}
                      className="text-[12px] font-bold px-4 h-9 rounded-lg transition-all"
                      style={scopeMine
                        ? { background: "var(--surface-raised)", color: "#1C1B19", boxShadow: "0 1px 3px rgba(17,24,39,0.1)" }
                        : { background: "transparent", color: "#6b7280" }}>
                My work
              </button>
              <button type="button" onClick={() => setScope("all")}
                      aria-pressed={!scopeMine}
                      className="text-[12px] font-bold px-4 h-9 rounded-lg transition-all"
                      style={!scopeMine
                        ? { background: "var(--surface-raised)", color: "#1C1B19", boxShadow: "0 1px 3px rgba(17,24,39,0.1)" }
                        : { background: "transparent", color: "#6b7280" }}>
                All machines
              </button>
            </div>
            {scopeMine && (() => {
              const n = myTakeIn.length + myWorking.length + myToFix.length + myOwed.length;
              return (
                <div className="text-[12px] text-slate-600">
                  <span className="font-bold text-slate-800">{myDepartments.join(", ")}</span>
                  {" · "}
                  {n === 0 ? "nothing needs you right now" : `${n} machine${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} you`}
                </div>
              );
            })()}
          </div>
        )}

        {/* ── Migration 036 — released off the rack, waiting to be picked up ──
            The production head has named this machine. It is the clearest
            instruction on the floor, so it sits above everything else. */}
        {!staffMode && mtTab === "transfer" && scopeMine && (() => {
          const justReleased = startedAll.filter((m) => {
            if (m.status === "completed") return false;
            const h = (handovers || []).find((x) => x.id === m.pendingHandoverId && x.status === "pending");
            return h && h.releaseRequired && h.releasedAt && myDepartments.includes(h.toDepartment);
          });
          if (!justReleased.length) return null;
          return (
            <div className="rounded-2xl p-5"
                 style={{ background: "rgba(99,102,241,0.07)", border: "2px solid rgba(99,102,241,0.45)" }}>
              <div className="text-[11px] font-bold uppercase tracking-[0.1em] mb-2" style={{ color: "#4f46e5" }}>
                Pick up from the rack
              </div>
              <div className="space-y-2">
                {justReleased.map((m) => (
                  <button key={m.id} type="button" onClick={() => setExpanded(expanded === m.id ? null : m.id)}
                          className="w-full text-left rounded-xl px-4 py-3 transition-all hover:brightness-95"
                          style={{ background: "var(--surface-raised)", border: "1px solid rgba(99,102,241,0.3)" }}>
                    <div className="text-[15px] font-black text-slate-800">
                      {m.bomKey}{m.serialNo ? ` · ${m.serialNo}` : ""}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Assembled and on the rack — the production head has released it to you
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        })()}

        {/* My Work buckets (Go and fix / Take in / Working on / Still owed)
            removed per request. The department view now relies on the prominent
            Pending Acceptance section above and the machine list below; the
            summary grid was redundant. Block kept but never rendered so the
            myToFix/myWorking/… derivations (used by myMachineIds) stay intact. */}
        {false && scopeMine && (() => {
          const buckets = [
            { key: "fix",     label: "Go and fix",  list: myToFix,   color: "#dc2626", bg: "rgba(239,68,68,0.08)",  border: "rgba(239,68,68,0.4)",  hint: "someone is waiting on you" },
            { key: "takein",  label: "Take in",     list: myTakeIn,  color: "#b45309", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.4)", hint: "handed to you" },
            { key: "working", label: "Working on",  list: myWorking, color: "#1C1B19", bg: "rgba(17,24,39,0.04)",   border: "rgba(17,24,39,0.12)",  hint: "in your department" },
            { key: "owed",    label: "Still owed",  list: myOwed,    color: "#b45309", bg: "rgba(245,158,11,0.06)", border: "rgba(245,158,11,0.3)", hint: "you handed these on" },
          ];
          if (buckets.every((b) => b.list.length === 0)) {
            return (
              <div className="rounded-2xl p-8 text-center"
                   style={{ background: "var(--surface-raised)", border: "1px dashed rgba(17,24,39,0.15)" }}>
                <div className="text-sm font-bold text-slate-700">All clear</div>
                <div className="text-[12px] text-slate-500 mt-1">
                  Nothing is waiting for {myDepartments.join(" or ")} right now.
                </div>
              </div>
            );
          }
          return (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              {buckets.map((b) => (
                <div key={b.key} className="rounded-2xl p-4"
                     style={{ background: b.bg, border: `1px solid ${b.border}` }}>
                  <div className="flex items-baseline gap-2 mb-0.5">
                    <span className="text-[12px] font-black" style={{ color: b.color }}>{b.label}</span>
                    <span className="text-2xl font-black" style={{ color: b.color }}>{b.list.length}</span>
                  </div>
                  <div className="text-[10px] text-slate-500 mb-2.5">{b.hint}</div>
                  <div className="space-y-1.5">
                    {b.list.slice(0, 3).map((m) => (
                      <button key={m.id} type="button" onClick={() => setExpanded(expanded === m.id ? null : m.id)}
                              className="w-full text-left rounded-lg px-2.5 py-2 transition-all hover:brightness-95"
                              style={{ background: "var(--surface-raised)" }}>
                        <div className="text-[12px] font-bold text-slate-800">
                          {m.bomKey}{m.serialNo ? ` · ${m.serialNo}` : ""}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {b.key === "working" ? `here since ${m.departmentEnteredAt ? formatDuration(computeElapsedMinutes(m.departmentEnteredAt, nowTick)) : "—"}`
                            : `in ${m.currentDepartment || m.stage}`}
                        </div>
                      </button>
                    ))}
                    {b.list.length > 3 && (
                      <div className="text-[10px] text-slate-500 px-2">+{b.list.length - 3} more below</div>
                    )}
                    {b.list.length === 0 && (
                      <div className="text-[10px] text-slate-400 px-1">Nothing</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}

        {/* ── Phase 1 — Departments that have been called ──
            Open faults grouped by the department that must come and fix them.
            Without this the responsible department never learns it is needed:
            the item sat inside one machine's History panel where only someone
            already looking at that machine would see it.
            Hidden for a floor login: its own "Go and fix" bucket above already
            lists exactly the faults called to its department, so this factory
            overview would just be a second copy of the same machines. */}
        {!staffMode && showCalled && (
          // Opened from the header bell. The panel inside is the same one that
          // used to sit on the page, unchanged; it just no longer takes the
          // first screen.
          <div className="fixed inset-0 z-40 flex items-start justify-end p-3 sm:p-6 sm:pt-20"
               style={{ background: "rgba(17,24,39,0.30)" }}
               onClick={(e) => e.target === e.currentTarget && setShowCalled(false)}>
            <div className="w-full max-w-4xl max-h-[82vh] overflow-y-auto rounded-2xl relative"
                 style={{ background: "var(--surface-card)", boxShadow: "0 30px 80px rgba(17,24,39,0.25)" }}>
              <button type="button" onClick={() => setShowCalled(false)} aria-label="Close"
                      className="absolute top-3 right-3 z-10 w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 text-xs font-bold">✕</button>
        {(() => {
          const openAssigned = (pendingHandoverItems || [])
            .filter(pendingItemIsOpen)
            // A floor login is only shown what has been called to its own
            // departments; the rest of the factory is not its business.
            .filter((p) => !scopeMine || myDepartments.includes(p.assignedDepartment));
          if (openAssigned.length === 0) return null;
          const byDept = openAssigned.reduce((acc, p) => {
            const d = p.assignedDepartment || "Unassigned";
            (acc[d] = acc[d] || []).push(p);
            return acc;
          }, {});
          const machineOf = (id) => machineLog.find((m) => String(m.id) === String(id)) || null;
          // This panel sits above the machines, and with a handful of open
          // issues it filled the entire first screen — you opened Machine
          // Tracker and could not see a single machine. It is a heads-up, not
          // the page.
          //
          // Same information, about half the height: the count is a chip rather
          // than a 3xl numeral wedged between two words (which read as a broken
          // sentence — "DEPARTMENTS CALLED 7 open issues"), tighter padding, a
          // denser grid, and two issues per department before "+n more" instead
          // of four. Nothing is lost; the full list is one click away on the
          // machine itself, which is where it gets dealt with anyway.
          return (
            <div className="section-card status-strip status-strip-red p-4">
              <div className="flex items-center gap-2.5 flex-wrap mb-3">
                <div className="sec-icon" style={{ background: "rgba(220,38,38,0.08)", color: "#dc2626" }}>
                  <AlertOctagon size={16} />
                </div>
                <span className="text-[12px] font-bold" style={{ color: "var(--text-strong)" }}>
                  Departments Called
                </span>
                <span className="sp-pill sp-pill-red">{openAssigned.length} open</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
                {Object.entries(byDept).map(([dept, list]) => (
                  <div key={dept} className="rounded-lg p-2.5"
                       style={{ background: "var(--surface-raised)", border: "1px solid rgba(239,68,68,0.25)" }}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[11px] font-black text-slate-800">{dept}</span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                            style={{ background: "rgba(239,68,68,0.12)", color: "#b91c1c" }}>{list.length}</span>
                    </div>
                    <div className="space-y-1">
                      {list.slice(0, 2).map((p) => {
                        const mm = machineOf(p.machineId);
                        return (
                          <button key={p.id} type="button"
                                  onClick={() => setIssuePopup({ ...p, _machine: mm })}
                                  className="w-full text-left rounded-lg px-2 py-1.5 transition-all hover:brightness-95 flex items-center gap-1"
                                  style={{ background: "rgba(239,68,68,0.05)" }}>
                            <div className="flex-1 min-w-0">
                              <div className="text-[11px] text-slate-700 leading-snug">{p.description}</div>
                              <div className="text-[9px] text-slate-500 mt-0.5">
                                {mm ? `${mm.bomKey}${mm.serialNo ? ` · ${mm.serialNo}` : ""}` : `Machine #${p.machineId}`}
                              </div>
                            </div>
                            <span className="text-slate-400 text-[11px] flex-shrink-0">→</span>
                          </button>
                        );
                      })}
                      {list.length > 2 && (
                        <button type="button" onClick={() => setIssuePopup({ ...list[2], _machine: machineOf(list[2].machineId), _showAll: list.map((p) => ({ ...p, _machine: machineOf(p.machineId) })) })}
                                className="text-[10px] font-semibold px-2 py-0.5 rounded transition-all hover:underline"
                                style={{ color: "#b91c1c" }}>
                          +{list.length - 2} more →
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })() || (
          <div className="p-8 text-center text-[12px]" style={{ color: "var(--text-dim)" }}>
            No department has been called — nothing is open.
          </div>
        )}
            </div>
          </div>
        )}

        {/* ── Issue detail popup ── */}
        {issuePopup && (() => {
          const items = issuePopup._showAll || [issuePopup];
          const fmtTime = (t) => { if (!t) return "—"; try { const d = new Date(t); return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }); } catch { return "—"; } };
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setIssuePopup(null)}>
              <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.4)" }} />
              <div className="relative w-full max-w-md max-h-[80vh] overflow-y-auto rounded-2xl p-5"
                   style={{ background: "var(--surface-card)", border: "1px solid var(--border-subtle)", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}
                   onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[13px] font-bold" style={{ color: "var(--text-strong)" }}>
                    {items.length === 1 ? "Issue Detail" : `${items.length} Open Issues`}
                  </span>
                  <button onClick={() => setIssuePopup(null)} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-700 transition-all"
                          style={{ background: "rgba(0,0,0,0.05)" }}>✕</button>
                </div>
                <div className="space-y-3">
                  {items.map((p, idx) => {
                    const mm = p._machine;
                    return (
                      <div key={p.id || idx} className="rounded-xl p-3.5"
                           style={{ background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.2)" }}>
                        <div className="text-[12px] font-bold text-slate-800 mb-2">{p.description || "No description"}</div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                          <div><span className="text-slate-500">Machine:</span> <span className="font-semibold text-slate-800">{mm ? mm.bomKey : `#${p.machineId}`}</span></div>
                          {mm?.serialNo && <div><span className="text-slate-500">S/N:</span> <span className="font-mono text-slate-700">{mm.serialNo}</span></div>}
                          <div><span className="text-slate-500">To solve:</span> <span className="font-bold" style={{ color: "#b91c1c" }}>{p.assignedDepartment || "—"}</span></div>
                          <div><span className="text-slate-500">Reported by:</span> <span className="text-slate-700">{p.raisedInDepartment || "—"}</span></div>
                          <div><span className="text-slate-500">When:</span> <span className="text-slate-700">{fmtTime(p.raisedAt)}</span></div>
                          {mm?.currentDepartment && <div><span className="text-slate-500">Now at:</span> <span className="text-slate-700">{mm.currentDepartment}</span></div>}
                          {p.priority && <div><span className="text-slate-500">Priority:</span> <span className="font-bold text-slate-800">{p.priority}</span></div>}
                        </div>
                        <button type="button"
                                onClick={() => { if (mm) { setFilter("active"); setExpanded(mm.id); setIssuePopup(null); } }}
                                className="mt-3 w-full text-center text-[11px] font-bold py-2 rounded-lg transition-all"
                                style={{ background: "rgba(46, 80, 214,0.1)", color: "#2640B0", border: "1px solid rgba(46, 80, 214,0.3)" }}>
                          View machine →
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Factory-wide status tiles are an office/admin overview. A floor login
            works off its own "My Work" buckets above and does not need the
            whole factory's counts — hidden to keep the phone view to the few
            machines that actually need the operator. */}
        {/* ── Summary boxes = the navigation (2026-11-01) ──
            The three top tabs are gone. Each box both counts a bucket and
            opens the screen where that bucket is worked:
              Pending Acceptance / On HOLD → Transfer & Accept
              On Rack / Active Builds / Ready → Production
              Pending Jobs → Pending Jobs
            Clicking the box you are already on goes back to all machines, so
            there is never a filtered list with no way out. Every count comes
            from the same list its click opens — and from the SCOPED lists, so
            a floor login sees its own work and an admin sees the factory.
            Shown to every role: with the tabs gone this is how the floor
            navigates too. */}
        {!staffMode && (() => {
          const cards = [
            { key: "pendingAccept", tab: "transfer",   label: "Pending Acceptance", value: pendingAccept.length,   sub: "waiting for next dept",   color: "#b45309", strip: "status-strip-yellow" },
            { key: "hold",          tab: "transfer",   label: "On HOLD",            value: onHold.length,          sub: "overdue or put on hold",    color: "#dc2626", strip: "status-strip-red" },
            { key: "onRack",        tab: "production", label: "On Rack",            value: onRackMachines.length,  sub: "awaiting head release",   color: "#4338ca", strip: "status-strip-purple" },
            { key: "active",        tab: "production", label: "Active Builds",      value: active.length,          sub: "in production",           color: "#b45309", strip: "status-strip-blue" },
            { key: "completed",     tab: "production", label: "Ready",              value: completed.length,       sub: "finished — final stage",  color: "#15803d", strip: "status-strip-green" },
            { key: "jobs",          tab: "pending",    label: "Pending Jobs",       value: openJobsScoped.length,  sub: "parts & work still open", color: "#b91c1c", strip: "status-strip-red" },
          ];
          return (
            <div className="mt-kpis grid grid-cols-3 xl:grid-cols-6 gap-3" data-mt-nav>
              {cards.map((c) => {
                const isOn = mtTab === c.tab && (c.tab === "pending" || filter === c.key);
                return (
                  <button key={c.key} data-summary-card={c.key} aria-current={isOn ? "page" : undefined}
                          onClick={() => {
                            if (isOn) { setMtTab("production"); setFilter("all"); return; }
                            setMtTab(c.tab);
                            if (c.tab !== "pending") setFilter(c.key);
                          }}
                          className={`kpi-tile status-strip ${c.strip} text-left`}
                          style={isOn ? { borderColor: c.color, boxShadow: `0 0 0 1px ${c.color}, 0 4px 16px -4px ${c.color}55` } : {}}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="mt-kpi-label text-[9.5px] font-bold uppercase tracking-[0.08em]" style={{ color: c.color }}>{c.label}</div>
                      <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />
                    </div>
                    <div className="mt-kpi-value text-[26px] font-extrabold leading-none tabular-nums tracking-[-0.02em]" style={{ color: c.color }}>{c.value}</div>
                    <div className="mt-kpi-sub text-[10px] mt-2" style={{ color: "var(--text-dim)" }}>{c.sub}</div>
                  </button>
                );
              })}
            </div>
          );
        })()}

        {/* 2026-11-03 — admin-only, read-only: why machines got delayed. */}
        {isAdminUser && !staffMode && (
          <DelayReasonsCard machines={machineLog} handovers={handovers} pendingItems={pendingHandoverItems} lateNow={onHold.length} />
        )}

        {/* ── Production Rack View ──
            Machines waiting on the rack to be started. Starting a build is the
            first working department's job, so a floor login elsewhere in the
            line has no use for this and it is hidden from them. Staff see it
            as Production Head or as the Assembly floor login (2026-11-04). */}
        {(staffMode ? (isProdHead || isAssemblyFloor) : mtTab === "production") && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="sec-icon" style={{ background: "rgba(37,99,235,0.08)", color: "#2563eb" }}>
                <Boxes size={16} />
              </div>
              <div>
                <div className="text-[13px] font-bold" style={{ color: "var(--text-strong)" }}>Production Rack View</div>
              </div>
            </div>
            <div className="mt-rack-legend flex items-center gap-2.5 flex-wrap text-[10px] font-semibold" style={{ color: "var(--text-dim)" }}>
              {RACK_UNIT_STATUS_ORDER.map((k) => (
                <span key={k} className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: RACK_UNIT_STATUS[k].dot }} />{RACK_UNIT_STATUS[k].short}</span>
              ))}
            </div>
          </div>

          {/* Replenishment alerts removed — the rack cards below now carry
              FULL/PARTIAL/EMPTY status badges and per-card shortage info, so
              the separate banner was duplicate noise that pushed the cards
              below the fold. Feature 2 of 2026-06-01h. */}

          {/* 2026-10-31 — twelve rack units, laid out as on the floor: each
              column is ONE machine set — its M unit (M BOM crate) above its R
              unit (R BOM crate), one machine, one serial number. Sets (1) and
              (2) of a model stand side by side. */}
          {(() => {
            const unitCols = physicalFamilies.flatMap((f) => [0, 1].map((i) => ({ f, units: f.columns[0].map((rack) => ({ rack, sl: rack.slots[i] })) })));
            return (
              <div className="rack-shelf grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-2.5 gap-y-3 p-2.5 sm:p-3 rounded-2xl">
                {unitCols.map(({ f, units }, ci) => {
                  const setM = units[0] && units[0].sl.machine;
                  const setSt = RACK_UNIT_STATUS[(units[0] && units[0].sl.status) || "empty"] || RACK_UNIT_STATUS.empty;
                  return (
                  <div key={`${f.id}-${ci}`} data-set={units[0] && units[0].sl.setId} className="rack-set flex flex-col gap-2 rounded-2xl p-1.5"
                       aria-label={`${units[0] ? slotLabel(units[0].sl.id) : ""} and ${units[1] ? slotLabel(units[1].sl.id) : ""}`}>
                    <div className="px-1 text-[9.5px] font-bold" style={{ color: "var(--text-muted)" }}>
                      M-{f.label} / R-{f.label} ({units[0] ? units[0].sl.position : ci + 1})
                    </div>
                    {units.map(({ rack, sl }) => {
                      const m = sl.machine;
                      const color = RACK_UNIT_COLORS[`${rack.tier}-${f.label}`] || f.color;
                      const st = RACK_UNIT_STATUS[sl.status] || RACK_UNIT_STATUS.empty;
                      const short = m ? pendingForMachine(m).length : 0;
                      // 2026-11-01 — the two actions a rack ever needs are on
                      // its face: Fill Rack while it is empty, Send to
                      // Mechanical once the machine on it is assembled. Both
                      // call the same handlers as the details panel, with the
                      // same permission checks; the panel keeps every action.
                      const faceFillChk  = sl.status === "empty" ? bomFillCheck(rack.bom.primary, bomDefs, (c) => itemByCode[c]) : null;
                      const faceCanFill  = !!faceFillChk && faceFillChk.ok && canDo("outward", "bom") && !!onFillRack;
                      const faceFillWhy  = !faceFillChk ? "" : !faceFillChk.ok ? faceFillChk.why : !canDo("outward", "bom") ? "You do not have permission to issue a BOM" : "";
                      // 2026-11-03 — the same reason, short enough to print
                      // under the disabled button (no hover on a tablet).
                      const faceFillShort = !faceFillChk || faceCanFill ? "" : rackFillShortWhy(faceFillChk, canDo("outward", "bom"));
                      const faceHo       = sl.status === "assembled" && m ? (handovers || []).find((h) => h && h.status === "pending" && String(h.machineId) === String(m.id)) : null;
                      const faceCanSend  = !!faceHo && (canDo("machines", "release") || isAdminUser) && !!onReleaseHandover;
                      // How long this machine has been in assembly, from the
                      // department clock the tracker already keeps.
                      const inAssemblyFor = m && m.departmentEnteredAt
                        ? formatDuration(computeOverrun(m.departmentEnteredAt, 0, nowTick).actualMinutes) : "";
                      const faceFill = (e) => {
                        e.stopPropagation();
                        const r = onFillRack(sl.id, rack.bom.primary);
                        if (!r || r.success === false) { showToast("Cannot fill this rack", (r && r.error) || "", "urgent"); return; }
                        if (!bomOpen) toggleBom();
                        setTimeout(() => { try { document.getElementById("mt-bom-section")?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch {} }, 60);
                      };
                      const faceSend = (e) => {
                        e.stopPropagation();
                        setRackSendAsk({ name: `${m.bomKey}${m.serialNo ? ` · ${m.serialNo}` : ""}`, to: faceHo.toDepartment, run: async () => {
                        const r = await onReleaseHandover(faceHo.id);
                        if (r && r.success === false) { showToast("Could not send", r.error || "", "urgent"); return; }
                        showToast(`${m.bomKey}${m.serialNo ? ` — ${m.serialNo}` : ""}`, `Transferred to ${faceHo.toDepartment}. ${slotLabel(sl.id)} is empty again.`);
                        } });
                      };
                      const crateSt = null; // M and R units are independent (2026-10-31)
                      const niN = notIssuedOpenFor(m).length;
                      return (
                        <button key={sl.id} type="button" data-slot={sl.id} data-serial={m ? (m.serialNo || "") : ""}
                                aria-label={`${slotLabel(sl.id)}: ${st.label}${m ? ` · BOM Ready · ${niN} Pending · ${m.serialNo || m.bomKey}` : ""}`}
                                onClick={() => setRackPanel(sl.id)}
                                className="rack-crate text-left rounded-xl p-2 pt-3.5 relative focus-visible:ring-2"
                                style={{ "--crate": color, outline: rackPanel === sl.id ? `3px solid ${color}` : "none", outlineOffset: 2 }}>
                          <span className="rack-crate-handle" aria-hidden="true" />
                          {/* ── Crate face (2026-11-01) ───────────────────────
                              Read in this order, and only what the rack's own
                              condition calls for:
                                1. which rack it is      (model, always)
                                2. what state it is in   (pill + 4-step bar)
                                3. which machine         (serial, once filled)
                                4. what is missing       (parts chip)
                                5. what happens next     (one short line)
                              An empty rack shows 1, 2 and a single invitation —
                              no dash where a serial would be, no parts line for
                              a machine that is not there. Nothing here changes
                              rack logic: every value is already computed above
                              and the whole face is still one button that opens
                              the existing details panel. */}
                          <div className="rounded-lg bg-white px-2 py-2 text-center shadow-sm">
                            <div className="text-[17px] sm:text-[19px] font-black leading-none" style={{ color }}>{rack.tier}-{f.label}</div>
                            {rack.bom.primary && rack.bom.primary !== `${rack.tier}-${f.label}` && (
                              <div className="text-[9.5px] font-semibold mt-1" style={{ color: "var(--text-muted)" }}>BOM: {rack.bom.primary}</div>
                            )}
                            <div className="mt-1.5 inline-flex items-center gap-1 text-[9.5px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap"
                                 style={{ background: st.bg, color: st.fg }}
                                 title={short > 0 && sl.status === "set" ? `Waiting for material — ${short} line${short === 1 ? "" : "s"} short in store` : st.label}>
                              <span className="w-1.5 h-1.5 rounded-full" style={{ background: st.dot }} />
                              {sl.status === "empty"      ? "Empty"
                               : sl.status === "set"      ? (short > 0 ? "Waiting for material" : "Ready for Assembly")
                               : sl.status === "assembling" ? "In assembly"
                               : "Assembly complete"}
                            </div>
                            {m ? (
                              <>
                                <div className="text-[11px] font-mono font-black mt-1.5 truncate" style={{ color: "var(--text-strong)" }}
                                     title={m.serialNo || "(no serial)"}>{m.serialNo || "(no serial)"}</div>
                                {/* Assembly progress — the rack's own work, not
                                    the production stages, which belong to the
                                    machine card. */}
                                {sl.status === "assembling" && (
                                  <div className="mt-1.5" data-rack-progress="assembling">
                                    {/* 2026-11-01 (C3) — the old bar had a fixed
                                        width, not measured progress. What is
                                        measured is the time on the bench. */}
                                    <div className="text-[9.5px] font-bold" style={{ color: st.fg }}>
                                      <LeadIcon e="⏱" />{inAssemblyFor || "just started"} on the bench
                                    </div>
                                  </div>
                                )}
                                {(sl.status === "set" || sl.status === "assembling") && (
                                  <div data-bom-ready={niN} className="text-[9px] font-bold mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full"
                                       style={niN ? { background: "rgba(217,119,6,0.12)", color: "#b45309" } : { background: "rgba(21,128,61,0.10)", color: "#15803d" }}
                                       title={niN ? `BOM Ready · ${niN} Pending — parts still owed on this machine` : "Every BOM part was issued"}>
                                    {niN ? `⏳ ${niN} part${niN === 1 ? "" : "s"} missing` : "✓ All parts issued"}
                                  </div>
                                )}
                                {sl.status === "assembled" && (
                                  <>
                                    <div className="text-[9px] font-bold mt-1 px-1.5 py-0.5 rounded-full inline-block"
                                         style={{ background: "rgba(21,128,61,0.10)", color: "#15803d" }}>✓ Assembled{niN ? ` · ${niN} part${niN === 1 ? "" : "s"} owed` : ""}</div>
                                    {faceCanSend && (
                                      <button data-needs-net type="button" data-rack-send={sl.id} onClick={faceSend}
                                              className="mt-1.5 w-full rounded-lg px-2 py-1.5 text-[10px] font-black text-white"
                                              style={{ background: "#15803d" }}
                                              title={`Send ${m.serialNo || m.bomKey} to ${faceHo.toDepartment} — this rack becomes empty`}>
                                        → Send to {faceHo.toDepartment}
                                      </button>
                                    )}
                                  </>
                                )}
                              </>
                            ) : (
                              <>
                              <button type="button" data-rack-fill={sl.id} onClick={faceFill} disabled={!faceCanFill}
                                      className="rack-btn mt-2 w-full rounded-lg px-2 py-1.5 text-[10.5px] font-black text-white disabled:cursor-not-allowed"
                                      style={{ background: "#1d4ed8" }}
                                      title={faceCanFill ? `Issue ${rack.bom.primary} into this rack` : faceFillWhy}>
                                ＋ Fill Rack
                              </button>
                              {faceFillShort && <div data-rack-fill-why={sl.id} className="rack-why mt-1 text-[10px] font-semibold leading-tight text-center" style={{ color: "#64748b" }}>{faceFillShort}</div>}
                              </>
                            )}
                          </div>
                          <div className="mt-1.5 mx-auto w-fit text-[10px] font-black px-2 py-0.5 rounded bg-white/90" style={{ color: "#111827" }}>{rack.tier}-{f.label} ({sl.position})</div>
                        </button>
                      );
                    })}
                  </div>
                  );
                })}
              </div>
            );
          })()}

          {/* Rack details panel — the selected unit's own BOM, stock, machine,
              history and its three actions. Right-hand drawer on desktop,
              bottom sheet on a phone. */}
          {rackPanel && (() => {
            const f = physicalFamilies.find((x) => x.columns[0].some((r) => r.slots.some((s2) => s2.id === rackPanel)));
            if (!f) return null;
            const rack = f.columns[0].find((r) => r.slots.some((s2) => s2.id === rackPanel));
            const sl = rack.slots.find((s2) => s2.id === rackPanel);
            const m = sl.machine;
            const color = RACK_UNIT_COLORS[`${rack.tier}-${f.label}`] || f.color;
            const st = RACK_UNIT_STATUS[sl.status] || RACK_UNIT_STATUS.empty;
            const bi = rackBomInfo(rack);
            const lines = bi.exists ? (bi.def.items || []).filter((l) => l && l.code).map((l, i) => {
              const inv = itemByCode[l.code]; const need = Number(l.qty) || 0; const have = inv ? (Number(inv.stock) || 0) : 0;
              return { n: i + 1, code: l.code, name: inv ? inv.name : l.code, unit: inv ? (inv.unit || "") : "", need, have, ok: !!inv && have >= need, unknown: !inv };
            }) : [];
            const pend = m ? pendingForMachine(m) : [];
            const notIssued = notIssuedOpenFor(m);
            const ho = sl.status === "assembled" ? (handovers || []).find((h) => h && h.status === "pending" && String(h.machineId) === String(m.id)) : null;
            // 2026-10-31 — every unit (M or R) is independent: Fill Rack on an
            // empty unit opens that rack's own BOM and fills that unit.
            const famDef = PHYSICAL_RACK_LAYOUT.families.find((x) => x.id === f.id);
            const isM = rack.tier === "M";
            const mKey = rackBoms(famDef, "M").primary; const rKey = rackBoms(famDef, "R").primary;
            const ownChk = bomFillCheck(rack.bom.primary, bomDefs, (c) => itemByCode[c]);
            const crate = { state: "none", rKey }; // R units are no longer crates of the M machine
            const perm = canDo("outward", "bom") && !!onFillRack;
            const canFill = sl.status === "empty" && ownChk.ok && perm;
            const fillWhy = sl.status !== "empty" ? `This rack already holds ${m ? (m.serialNo || m.bomKey) : "a machine"}` : !ownChk.ok ? ownChk.why : !perm ? "You do not have permission to issue a BOM" : "";
            const canRemove = sl.status === "set" && !!m && canDo("outward", "delete") && !!onRemoveRackMachine;
            const history = (auditLog || []).filter((a) => a && ((a.details && a.details.slotId === sl.id) || (m && m.serialNo && a.serialNo === m.serialNo) || (/rack_slot/.test(a.type || "") && String(a.action || "").includes(slotLabel(sl.id)))))
              .sort((x, y) => String(y.ts || y.timestamp || "").localeCompare(String(x.ts || x.timestamp || ""))).slice(0, 40);
            const doFill = () => {
              const r = onFillRack(sl.id, rack.bom.primary);
              if (!r || r.success === false) { showToast("Cannot fill this rack", (r && r.error) || "", "urgent"); return; }
              setRackPanel(null);
              if (!bomOpen) toggleBom();
              setTimeout(() => { try { document.getElementById("mt-bom-section")?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch {} }, 60);
            };
            const doAssemble = () => {
              if (sl.status === "set") {
                if (pend.length) { showToast("Waiting for material", `${pend.length} component(s) still to collect`, "urgent"); return; }
                if (crate.state === "pending") { showToast("Fill the R crate first", `${slotLabel(pairSlotOf(sl.setId))} — ${rKey} for ${m.serialNo}`, "urgent"); return; }
                startWithChecklist([m.id], (res) => {
                  if (res && res.success === false) { showToast("Could not start assembly", res.error || "", "urgent"); return; }
                  showToast(`${slotLabel(sl.id)} — ${m.serialNo || m.bomKey}`, "Assembly started. The machine keeps this rack until it is sent to Mechanical.");
                });
              } else if (sl.status === "assembling") {
                setRackPanel(null);
                openFinishModal(m);
              }
            };
            const doSend = () => {
              if (!ho) return;
              setRackSendAsk({ name: `${m.bomKey}${m.serialNo ? ` · ${m.serialNo}` : ""}`, to: ho.toDepartment, run: async () => {
              const r = await onReleaseHandover(ho.id);
              if (r && r.success === false) { showToast("Could not send", r.error || "", "urgent"); return; }
              showToast(`${m.bomKey}${m.serialNo ? ` — ${m.serialNo}` : ""}`, `Transferred to ${ho.toDepartment}. ${slotLabel(sl.id)} is empty again.`);
              setRackPanel(null);
              } });
            };
            const assembleLabel = sl.status === "assembling" ? "Mark Assembled" : "Assemble";
            const assembleOk = (sl.status === "set" && pend.length === 0 && crate.state !== "pending" && canStartAsm) || (sl.status === "assembling" && !!m && !m.pendingHandoverId && canFinishTransfer(canDo));
            const assembleWhy = sl.status === "set" ? (pend.length ? "Waiting for material" : crate.state === "pending" ? `Fill the ${rKey} crate first` : !canStartAsm ? "Only the Assembly department can start assembly" : "") : sl.status === "assembling" ? (!canFinishTransfer(canDo) ? "Needs Machines → Finish & Transfer permission" : "A transfer is already in progress") : sl.status === "assembled" ? "Already assembled" : "Fill the rack first";
            // 2026-10-31 — no separate Production Manager login yet: an Admin
            // sends the assembled machine to Mechanical from the rack.
            const canSendFromRack = canDo("machines", "release") || isAdminUser;
            const sendOk = sl.status === "assembled" && !!ho && canSendFromRack && !!onReleaseHandover;
            const Row = ({ k, v }) => (<div className="flex gap-2 text-[12px] py-0.5"><span className="w-32 flex-shrink-0" style={{ color: "var(--text-muted)" }}>{k}</span><span className="font-bold min-w-0 break-words" style={{ color: "var(--text-strong)" }}>{v}</span></div>);
            return (
              <div className="rack-panel-backdrop fixed inset-0 z-[65] flex justify-end" style={{ background: "rgba(17,24,39,0.35)" }}
                   onClick={(e) => e.target === e.currentTarget && setRackPanel(null)}>
                <div role="dialog" aria-label={`${slotLabel(sl.id)} rack details`} className="rack-panel h-full w-full max-w-[560px] flex flex-col" style={{ background: "var(--surface-card)", boxShadow: "-20px 0 60px rgba(17,24,39,0.25)" }}>
                  <div className="flex items-center justify-between px-5 py-3.5 text-white" style={{ background: color }}>
                    <div className="text-[18px] font-black">{slotLabel(sl.id)} Rack Details</div>
                    <button type="button" aria-label="Close" onClick={() => setRackPanel(null)} className="w-9 h-9 rounded-lg flex items-center justify-center text-[18px] font-bold" style={{ background: "rgba(255,255,255,0.15)" }}>✕</button>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    <div className="flex gap-4 p-4 sm:p-5" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                      <div className="rack-crate rounded-xl p-2 pt-3.5 relative w-28 flex-shrink-0 hidden sm:block" style={{ "--crate": color }}>
                        <span className="rack-crate-handle" aria-hidden="true" />
                        <div className="rounded-lg bg-white px-2 py-2.5 text-center"><div className="text-[18px] font-black" style={{ color }}>{rack.tier}-{f.label}</div><div className="text-[9.5px] font-semibold mt-1" style={{ color: "var(--text-muted)" }}>BOM: {rack.bom.primary}</div></div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <Row k="Machine model" v={bi.exists ? `${bi.key}${bi.def.label && bi.def.label !== bi.key ? ` — ${bi.def.label}` : ""}` : `${rack.bom.primary} (BOM not created)`} />
                        <Row k="Rack position" v={`${rack.tier === "M" ? "Top" : "Bottom"} (${slotLabel(sl.id)})`} />
                        <Row k="BOM (this rack)" v={rack.bom.primary} />
                        <Row k="Paired rack" v={`${slotLabel(sl.pairId)} · ${isM ? rKey : mKey} BOM · own serial`} />
                        <div className="flex gap-2 text-[12px] py-0.5 items-center"><span className="w-32 flex-shrink-0" style={{ color: "var(--text-muted)" }}>Status</span>
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: st.bg, color: st.fg }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: st.dot }} />{pend.length && sl.status === "set" ? "Filled · waiting for material" : st.label}</span></div>
                        <Row k="Current machine" v={m ? `${m.bomLabel || m.bomKey}${m.bomKey !== rack.bom.primary ? ` (${m.bomKey})` : ""}` : "—"} />
                        <Row k="Serial no." v={m ? (m.serialNo || "—") : "—"} />
                        {m && <Row k="Stage" v={`${m.stage}${m.createdDate ? ` · since ${m.createdDate}` : ""}`} />}
                        {notIssued.length > 0 && <Row k="BOM" v={`BOM Ready · ${notIssued.length} Pending`} />}
                      </div>
                    </div>
                    {notIssued.length > 0 && (
                      <div data-not-issued-list className="mx-4 sm:mx-5 mt-3 rounded-lg px-3 py-2.5" style={{ background: "rgba(217,119,6,0.07)", border: "1px solid rgba(217,119,6,0.3)" }}>
                        <div className="text-[12px] font-black mb-1.5" style={{ color: "#b45309" }}><LeadIcon e="⏳" />{notIssued.length} part{notIssued.length === 1 ? "" : "s"} not issued — pending for {m.serialNo || m.bomKey}</div>
                        <ul className="space-y-1">
                          {notIssued.map((p2) => (
                            <li key={p2.id} data-pending-item={p2.itemCode || p2.id} className="text-[11.5px] leading-snug flex items-start justify-between gap-2 flex-wrap">
                              <div className="min-w-0">
                                <span className="font-bold" style={{ color: "var(--text-strong)" }}>{p2.itemName || p2.itemCode || "Part"}</span>
                                {p2.qty != null && <span className="tabular-nums"> × {p2.qty} pending</span>}
                                {p2.itemCode && p2.itemName && <span className="font-mono text-[10px]" style={{ color: "var(--text-dim)" }}> {p2.itemCode}</span>}
                                <span style={{ color: "var(--text-muted)" }}> — {p2.reason || "no reason recorded"}</span>
                                {p2.receivedAt && <span className="ml-1 text-[10px] font-bold" style={{ color: "#15803d" }}>· received</span>}
                                {!p2.receivedAt && p2.itemCode && <span className="ml-1 text-[10px]" style={{ color: "var(--text-dim)" }}>· in stock {stockByCode[p2.itemCode] ?? 0}</span>}
                              </div>
                              {(() => {
                                const busy = pendIssueBusy === p2.id;
                                if (p2.receivedAt) {
                                  return canFinishTransfer(canDo) && onResolvePendingItem ? (
                                    <button data-needs-net type="button" data-pending-action="complete" disabled={busy}
                                            onClick={async () => { setPendIssueBusy(p2.id); const r = await onResolvePendingItem(p2.id, { notes: "Part fitted — completed from Rack View" }); setPendIssueBusy(null); if (!r || r.success === false) showToast("Could not complete", (r && r.error) || "", "urgent"); else showToast("Pending part completed", p2.itemName || p2.itemCode || ""); }}
                                            className="text-[10.5px] font-bold px-2 py-1 rounded-md text-white disabled:opacity-50" style={{ background: "#15803d" }}>✓ Mark completed</button>
                                  ) : null;
                                }
                                const canIssue = !!onIssuePendingPart && canDo("outward", "bom") && !!p2.itemCode && Number(p2.qty) > 0;
                                const enough = (stockByCode[p2.itemCode] ?? 0) >= (Number(p2.qty) || 0);
                                if (!canIssue) return null;
                                if (pendIssueAsk === p2.id) {
                                  return (
                                    <span className="inline-flex items-center gap-1">
                                      <button data-needs-net type="button" data-pending-action="confirm" disabled={busy}
                                              onClick={async () => { setPendIssueBusy(p2.id); const r = await onIssuePendingPart(p2.id); setPendIssueBusy(null); setPendIssueAsk(null);
                                                if (!r || r.success === false) showToast("Could not issue", (r && r.error) || "", "urgent");
                                                else showToast(`${p2.itemName || p2.itemCode} × ${p2.qty} issued`, r.partial ? r.error : `${m.serialNo || m.bomKey} — stock deducted once, job completed`); }}
                                              className="text-[10.5px] font-bold px-2 py-1 rounded-md text-white disabled:opacity-50" style={{ background: "#b45309" }}>{busy ? "Issuing…" : `Confirm issue × ${p2.qty}`}</button>
                                      <button type="button" disabled={busy} onClick={() => setPendIssueAsk(null)} className="text-[10.5px] font-bold px-2 py-1 rounded-md border border-slate-300">Cancel</button>
                                    </span>
                                  );
                                }
                                return (
                                  <button data-needs-net type="button" data-pending-action="issue" disabled={!enough}
                                          title={enough ? "Part is physically available — issue it from stock to this machine" : "Not enough stock yet"}
                                          onClick={() => setPendIssueAsk(p2.id)}
                                          className="text-[10.5px] font-bold px-2 py-1 rounded-md border disabled:opacity-40 disabled:cursor-not-allowed"
                                          style={{ color: "#b45309", borderColor: "rgba(180,83,9,0.45)", background: "#fff" }}>Issue now (received)</button>
                                );
                              })()}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="px-4 sm:px-5 pt-3">
                      <div role="tablist" className="flex gap-1 border-b" style={{ borderColor: "var(--border-subtle)" }}>
                        {[["bom", `BOM Items (${lines.length})`], ["stock", "Stock Status"], ["history", `History (${history.length})`]].map(([k, l]) => (
                          <button key={k} role="tab" aria-selected={rackPanelTab === k} type="button" onClick={() => setRackPanelTab(k)}
                                  className="px-3 py-2 text-[12.5px] font-bold -mb-px"
                                  style={{ color: rackPanelTab === k ? color : "var(--text-muted)", borderBottom: `2px solid ${rackPanelTab === k ? color : "transparent"}` }}>{l}</button>
                        ))}
                      </div>
                      {rackPanelTab === "bom" && (
                        !bi.exists ? <div className="py-6 text-center text-[12px]" style={{ color: "#b45309" }}>The {rack.bom.primary} BOM has not been created.</div>
                        : !lines.length ? <div className="py-6 text-center text-[12px]" style={{ color: "#b45309" }}>The {bi.key} BOM has no components yet. Add them in Edit BOM — nothing can be issued to this rack until then.</div>
                        : (
                          <div className="overflow-x-auto mt-2">
                            <table className="w-full text-[12px]" style={{ minWidth: 440 }}>
                              <thead><tr style={{ color: "var(--text-muted)" }}>{["#", "Item", "Required", "Available", "Status"].map((h) => <th key={h} className={`px-2 py-2 font-semibold ${h === "Item" || h === "#" ? "text-left" : "text-right"}`}>{h}</th>)}</tr></thead>
                              <tbody>
                                {lines.map((l) => (
                                  <tr key={l.code} style={{ borderTop: "1px solid var(--border-subtle)" }}>
                                    <td className="px-2 py-1.5" style={{ color: "var(--text-muted)" }}>{l.n}</td>
                                    <td className="px-2 py-1.5"><div className="font-semibold" style={{ color: "var(--text-strong)" }}>{l.name}</div><div className="font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>{l.code}</div></td>
                                    <td className="px-2 py-1.5 text-right tabular-nums">{l.need} {l.unit}</td>
                                    <td className="px-2 py-1.5 text-right tabular-nums">{l.unknown ? "—" : `${l.have} ${l.unit}`}</td>
                                    <td className="px-2 py-1.5 text-right"><span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full" style={l.ok ? { background: "rgba(21,128,61,0.10)", color: "#15803d" } : { background: "rgba(185,28,28,0.10)", color: "#b91c1c" }}>{l.unknown ? "Not in Item Master" : l.ok ? "Full" : `Short ${l.need - l.have}`}</span></td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot><tr style={{ borderTop: "1px solid var(--border-subtle)" }}><td colSpan={5} className="px-2 py-2 text-[11.5px] font-bold" style={{ color: "var(--text-muted)" }}>Total ({lines.length} items)</td></tr></tfoot>
                            </table>
                          </div>
                        )
                      )}
                      {rackPanelTab === "stock" && (
                        <div className="py-3 space-y-2 text-[12px]">
                          {false ? (
                            crate.state === "filled"
                              ? <div className="rounded-lg px-3 py-2 font-semibold" style={{ background: "rgba(21,128,61,0.08)", color: "#15803d" }}>{rKey} crate is on this rack for {m.serialNo}.</div>
                              : <div className="rounded-lg px-3 py-2 font-semibold" style={{ background: "rgba(185,28,28,0.07)", color: "#b91c1c" }}>{crate.state === "pending" ? `${rKey} crate not filled yet for ${m.serialNo}.` : `${rKey} BOM has no components yet — nothing to fill on this rack.`}</div>
                          ) : m ? (
                            pend.length ? (
                              <div className="rounded-lg px-3 py-2" style={{ background: "rgba(185,28,28,0.07)", color: "#b91c1c" }}>
                                <div className="font-bold mb-1">Still to collect for {m.serialNo || m.bomKey}</div>
                                {pend.map((p2, i) => <div key={i}>{p2.item || p2.name || p2.code}: {p2.pendingQty} {p2.unit || ""}</div>)}
                              </div>
                            ) : <div className="rounded-lg px-3 py-2 font-semibold" style={{ background: "rgba(21,128,61,0.08)", color: "#15803d" }}>Complete BOM stock is on this rack for {m.serialNo || m.bomKey}.</div>
                          ) : <div style={{ color: "var(--text-muted)" }}>This rack is empty. Store stock for the next {rack.bom.primary} set:</div>}
                          {lines.length > 0 && (
                            <div className="rounded-lg px-3 py-2" style={{ background: "rgba(17,24,39,0.03)" }}>
                              <div className="font-bold" style={{ color: "var(--text-strong)" }}>Store can make {bi.sets} more {rack.bom.primary} set{bi.sets === 1 ? "" : "s"}</div>
                              {bi.short.length > 0 && <div className="mt-1" style={{ color: "#b91c1c" }}>Short: {bi.short.map((x) => `${x.code} (need ${x.need}, have ${x.have})`).join(", ")}</div>}
                            </div>
                          )}
                        </div>
                      )}
                      {rackPanelTab === "history" && (
                        <div className="py-2">
                          {history.length === 0 ? <div className="py-6 text-center text-[12px]" style={{ color: "var(--text-muted)" }}>No history for this rack yet.</div> : (
                            <ol className="space-y-1.5">
                              {history.map((a, i) => (
                                <li key={i} className="text-[11.5px] rounded-lg px-3 py-2" style={{ background: "rgba(17,24,39,0.03)" }}>
                                  <div className="font-semibold" style={{ color: "var(--text-strong)" }}>{a.action}</div>
                                  <div className="text-[10.5px]" style={{ color: "var(--text-dim)" }}>{a.ts || a.timestamp ? new Date(a.ts || a.timestamp).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}{a.user ? ` · ${a.user}` : ""}</div>
                                </li>
                              ))}
                            </ol>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="p-4 sm:p-5 space-y-3" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                    {sl.status === "empty" && (
                      <div className="rounded-lg px-3 py-2 text-[12px] font-semibold" style={canFill ? { background: "rgba(21,128,61,0.08)", color: "#15803d" } : { background: "rgba(185,28,28,0.07)", color: "#b91c1c" }}>
                        {canFill ? `✓ All ${rack.bom.primary} items are available. Fill this rack.` : `⚠ ${fillWhy}.`}
                      </div>
                    )}
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { key: "fill", label: "＋ Fill Rack", sub: `Issues ${rack.bom.primary} · own serial`, ok: canFill, bg: "#1d4ed8", fn: doFill, why: sl.status === "empty" && !canFill ? rackFillShortWhy(ownChk, perm) : fillWhy },
                        { key: "assemble", label: `🔧 ${assembleLabel}`, sub: sl.status === "assembling" ? "Back on this rack" : "Start assembly work", ok: assembleOk, bg: "#d97706", fn: doAssemble, why: assembleWhy },
                        { key: "send", label: "→ Transfer to Mechanical", sub: "Rack becomes empty", ok: sendOk, bg: "#15803d", fn: doSend, why: sl.status !== "assembled" ? "Assemble first" : !canSendFromRack ? "Admin / production head only" : "" },
                      ].map((b) => (
                        <div key={b.key} className="flex flex-col items-center gap-1">
                          <button type="button" data-action={b.key} disabled={!b.ok} onClick={b.fn} title={b.ok ? "" : b.why}
                                  className="rack-btn w-full rounded-xl px-2 py-3 text-[12.5px] font-black text-white disabled:cursor-not-allowed"
                                  style={{ background: b.bg, minHeight: 48 }}>{b.label}</button>
                          {/* 2026-11-02 — the reason a floor button is off is
                              readable on a tablet (no hover), not only in title. */}
                          <span data-rack-action-why={b.key} className="text-[10.5px] font-semibold text-center leading-tight break-words max-w-full" style={{ color: !b.ok && b.why ? "#64748b" : "var(--text-dim)" }}>{!b.ok && b.why ? b.why : b.sub}</span>
                        </div>
                      ))}
                    </div>
                    {/* 2026-11-01 — Pull Back from the rack. The same action,
                        permission (admin) and modal as the Production card:
                        it cancels the pending hand-over, keeps the machine on
                        this rack in Assembly and writes the history + audit.
                        It locks nothing — the machine can be finished and
                        sent again straight away, and no department's work,
                        transfer, acceptance or stage update is held up. */}
                    {ho && isAdminUser && onPullBackHandover && (
                      <button type="button" data-action="pullback"
                              onClick={() => { setRackPanel(null); setPullBack({ handover: ho, reason: "", busy: false, error: "" }); }}
                              title="Admin: cancel this hand-over and return the machine to Assembly on this rack"
                              className="w-full rounded-lg px-3 py-2 text-[11.5px] font-bold"
                              style={{ color: "#b91c1c", border: "1px solid rgba(185,28,28,0.3)", background: "rgba(185,28,28,0.04)" }}>
                        ↩ Pull Back — return {m && (m.serialNo || m.bomKey)} to Assembly
                      </button>
                    )}
                    {canRemove && (
                      <button type="button" data-action="remove"
                              onClick={() => { setRackPanel(null); setRemoveRackConfirm({ machineId: m.id, serialNo: m.serialNo, bomKey: m.bomKey }); }}
                              className="w-full rounded-lg px-3 py-2 text-[11.5px] font-bold"
                              style={{ color: "#b91c1c", border: "1px solid rgba(185,28,28,0.3)", background: "rgba(185,28,28,0.04)" }}>
                        <LeadIcon e="🗑" />Remove From Rack — return both crates' stock
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* More sets on the rack than the layout has slots for — said out
              loud rather than silently dropped from view. */}
          {physicalFamilies.filter((f) => f.overflow > 0).map((f) => (
            <div key={f.id} className="mt-2 text-[10.5px] font-semibold" style={{ color: "#b45309" }}>
              <LeadIcon e="⚠" />{f.overflow} more {f.label} machine{f.overflow === 1 ? "" : "s"} than the M-{f.label} / R-{f.label} racks hold: {f.overflowMachines.map((m) => m.serialNo || m.bomKey).join(", ")} — use Fill on an empty slot to place one.
            </div>
          ))}

          {otherRacks.length > 0 && (
            <div className="mt-4">
              <div className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: "var(--text-dim)" }}>Other racks</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {otherRacks.map((r) => {
                const STATE = {
                  full:    { color: "#15803d", bg: "rgba(34,197,94,0.08)",  border: "rgba(34,197,94,0.3)",  label: "Full",    icon: "✓" },
                  partial: { color: "#b45309", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.3)", label: "Partial", icon: "◐" },
                  empty:   { color: "#b91c1c", bg: "rgba(239,68,68,0.06)",  border: "rgba(239,68,68,0.22)", label: "Empty",   icon: "○" },
                }[r.state];
                const pct = r.capacity > 0 ? Math.min(100, Math.round((r.ready / r.capacity) * 100)) : 0;
                // How many machines sitting on this rack are still short of
                // components. Surfaced on the card so the store sees it without
                // opening Start Production.
                const rackShortCount = rackMachinesFor(r.key).filter((m) => pendingForMachine(m).length > 0).length;
                const activateRack = () => { if (r.ready > 0) openStartProd(r); };
                return (
                  // role="button" wrapper so we can nest the actions ⋮ button
                  // inside without invalid <button>-inside-<button> HTML. The
                  // outer click + Enter/Space activate Start Production, same
                  // UX as before.
                  <div
                    key={r.key}
                    role="button"
                    tabIndex={r.ready > 0 ? 0 : -1}
                    onClick={activateRack}
                    onKeyDown={(e) => { if (r.ready > 0 && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); activateRack(); } }}
                    className="text-left rounded-xl p-4 transition-all relative outline-none"
                    style={{
                      background: STATE.bg,
                      border: `1px solid ${STATE.border}`,
                      cursor: r.ready > 0 ? "pointer" : "default",
                      opacity: r.ready > 0 ? 1 : 0.78,
                    }}
                    onMouseEnter={(e) => { if (r.ready > 0) e.currentTarget.style.transform = "translateY(-1px)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = ""; }}
                  >
                    <div className="flex items-start justify-between mb-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-black text-slate-900">{r.key}</div>
                        <div className="text-[10px] text-slate-500 truncate mt-0.5">{r.label}</div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {rackShortCount > 0 && (
                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full"
                                title={`${rackShortCount} machine(s) on this rack are still waiting for components`}
                                style={{ background: "rgba(217,119,6,0.16)", color: "#b45309", border: "1px solid rgba(217,119,6,0.35)" }}>
                            <LeadIcon e="⚠" />{rackShortCount} incomplete
                          </span>
                        )}
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                              style={{ background: STATE.color + "22", color: STATE.color, border: `1px solid ${STATE.color}40` }}>
                          {STATE.icon} {STATE.label}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 mb-2.5">
                      <div>
                        <div className="text-[9px] text-slate-600 uppercase tracking-wide">Ready</div>
                        <div className="text-lg font-black" style={{ color: STATE.color }}>{r.ready}</div>
                      </div>
                      <div>
                        <div className="text-[9px] text-slate-600 uppercase tracking-wide">Capacity</div>
                        <div className="text-lg font-black text-slate-500">{r.configured ? r.capacity : "—"}</div>
                      </div>
                      <div>
                        <div className="text-[9px] text-slate-600 uppercase tracking-wide">Empty</div>
                        <div className="text-lg font-black text-slate-400">{r.configured ? r.empty : "—"}</div>
                      </div>
                    </div>

                    {r.configured && (
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(17,24,39,0.06)" }}>
                        <div className="h-full transition-all" style={{ width: `${pct}%`, background: STATE.color }} />
                      </div>
                    )}
                    {!r.configured && (
                      <div className="text-[9px] text-slate-600 italic">Capacity not set — edit BOM to assign</div>
                    )}
                    {r.ready > 0 && (
                      <div className="mt-2 text-[10px] font-bold text-blue-400">▶ Click to start production</div>
                    )}
                  </div>
                );
              })}
            </div>
            </div>
          )}
        </div>
        )}

        {/* ── Which screen am I on ──
            The boxes above are the navigation, so the list says plainly what
            it is showing and how to get back to everything. */}
        {!staffMode && (() => {
          const view = mtTab === "transfer"
            ? { title: "Transfer & Accept", sub: filter === "hold" ? "past the accept deadline" : filter === "pendingAccept" ? "waiting for the next department" : "every machine still moving through the line" }
            : mtTab === "pending"
            ? { title: "Pending Jobs", sub: "parts and work still open, by machine" }
            : { title: MT_FILTER_LABELS[filter] || "All Machines",
                sub: filter === "active"    ? "in production right now"
                   : filter === "completed" ? "finished — Ready is the final stage"
                   : filter === "onRack"    ? "assembled, waiting for a production head to transfer them"
                   : "every machine that has started production" };
          if (searchText) { view.title = `Search: "${searchQ.trim()}"`; view.sub = `${started.filter(searchHit).length} found`; }
          return (
            <div className="flex items-baseline gap-2 flex-wrap" data-view-header>
              <h2 className="text-[14px] font-black" style={{ color: "var(--text-strong)" }}>{view.title}</h2>
              <span className="text-[11px]" style={{ color: "var(--text-dim)" }}>{view.sub}</span>
              {(mtTab !== "production" || filter !== "all") && (
                <button type="button" data-view-clear onClick={() => { setMtTab("production"); setFilter("all"); }}
                        className="mt-chip ml-auto">All Machines ({started.length})</button>
              )}
            </div>
          );
        })()}

        {/* ── Empty state ── */}
        {!staffMode && mtTab !== "pending" && listForTab().length === 0 && (
          <div className="bg-white border border-slate-200 rounded-xl py-20 text-center">
            <div className="text-5xl mb-4">🔧</div>
            <div className="text-sm font-bold text-slate-900 mb-2">No Machines Tracked</div>
            {filter !== "all" && filter !== "active" ? (
              <div className="text-[11px] text-slate-500">
                No machines under <strong>{MT_FILTER_LABELS[filter] || filter}</strong> right now.{" "}
                <button onClick={() => setFilter("all")} className="underline font-bold">Show all machines</button>
              </div>
            ) : (
              <div className="text-[11px] text-slate-500">
                Issue a BOM from Outward to add a machine to the rack, then use the Production Rack View above to start a build.{" "}
                <button onClick={() => onNavigate("outward")}
                        className="text-blue-400 underline hover:text-blue-300 transition-colors">
                  Go to Outward →
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Machine cards ── */}
        {!staffMode && (
        <div className="space-y-4">
          {listForTab().map((machine) => <SafeBoundary key={machine.id} name="machine-card" label="this machine card" render={() => {
            const curIdx   = stageIdx(machine.stage);
            const isComplete = machine.status === "completed";
            const isExpanded = expanded === machine.id;
            const selStage   = stageMap[machine.id] || "";
            // 2026-10-30 — READY is reached only through the Trial Certificate
            // (Trial → Ready) and its acceptance, never by a stage jump.
            const futureStages = MACHINE_STAGES.filter((s, i) => i > curIdx && s !== "Ready");
            const dispStage  = displayStageOf(machine);
            const stageColor = STAGE_COLORS[dispStage] || "#2E50D6";
            const pct = isComplete ? 100 : Math.round((curIdx / (MACHINE_STAGES.length - 1)) * 100);
            // Display-only stage index for the card stepper (see DISPLAY_STAGES).
            const dispIdx = DISPLAY_STAGES.indexOf(dispStage);
            // Phase 1 — open pending items, split by what they block.
            //   fault: someone found something wrong and called the department
            //          responsible. The machine stays put until it is fixed.
            //   owed:  a department handed the machine on but still owes work
            //          on it (a part on order). The machine moves; it just
            //          cannot reach Ready. Blocking transfer here would stall
            //          the line for a part nobody is waiting on yet.
            const machineOpenAll = (pendingHandoverItems || [])
              .filter((p) => String(p.machineId) === String(machine.id) && pendingItemIsOpen(p));
            const machineOpenItems = machineOpenAll.filter((p) => p.kind !== "owed");
            // Parts that were short at BOM issue and have since been given out
            // of Pending Stock. Matched on serial number, the same way the
            // machine report already matches them.
            const arrivedItems = (auditLog || []).filter(
              (a) => a && a.type === "pending_fulfilled"
                  && machine.serialNo && String(a.serialNo || "") === String(machine.serialNo)
            );

            return (
              <div key={machine.id} data-mt-mid={machine.id} className={`mt-card overflow-hidden${isComplete ? " mt-card-ready" : ""}`}>

                {/* ── Card header ── */}
                <div className="px-5 py-4">
                  <div className="mt-card-head flex items-start gap-4 flex-wrap">

                    {/* Machine identity — may shrink and wrap so a 360px phone
                        never pushes the stage pills past the screen edge. */}
                    <div className="mt-card-id flex items-center gap-3 min-w-0 max-w-full">
                      {/* Migration 061 — the BOM's machine photo replaces the
                          key tile when one is set; the tile is the fallback. */}
                      <BomPhotoThumb url={(bomDefs || {})[machine.bomKey]?.photoUrl} size={56}
                                     fallback={(
                        <div className={`mt-card-key w-11 h-11 rounded-xl flex items-center justify-center ${String(machine.bomKey || "").length > 5 ? "text-[8.5px]" : "text-[11px]"} font-black text-slate-900 flex-shrink-0 overflow-hidden whitespace-nowrap px-0.5`}
                             title={machine.bomKey}
                             style={{ background: stageColor + "1a", border: `1px solid ${stageColor}45`, textOverflow: "ellipsis" }}>
                          {machine.bomKey}
                        </div>
                      )} />
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-900">{machine.bomLabel}</div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-[11px] font-mono font-black" style={{ color: "var(--text-strong)" }}
                                title={`Started ${machine.createdDate}${machine.completedDate ? ` · Ready ${machine.completedDate}` : ""}`}>S/N: {machine.serialNo}</span>
                          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                                style={{ background: stageColor + "18", color: stageColor, border: `1px solid ${stageColor}35` }}>
                            {dispStage}
                          </span>
                          {/* 2026-11-01 — the "Stage X of 4" chip and the % bar
                              both repeated the stepper beside them; the stepper
                              alone says where the machine is. */}
                          {arrivedItems.length > 0 && (
                            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                                  title={arrivedItems.map((a) => `${a.itemName || a.itemCode}${a.qty ? ` ×${a.qty}` : ""}`).join(", ")}
                                  style={{ background: "rgba(21,128,61,0.10)", color: "#15803d", border: "1px solid rgba(21,128,61,0.35)" }}>
                              <LeadIcon e="📦" />Material arrived ({arrivedItems.length})
                            </span>
                          )}
                        </div>
                        {isComplete && machine.completedDate && (
                          <div className="text-[10px] font-bold mt-0.5" style={{ color: "#15803d" }}>Ready {machine.completedDate}</div>
                        )}
                        {/* 2026-10-30 — live department timer: working time only
                            (Tuesdays and holidays pause it), the BOM target, the
                            deadline, and a delay alert once the target is passed. */}
                        {!isComplete && machine.stage !== "BOM Issued" && machine.departmentEnteredAt && (() => {
                          const dept = machine.currentDepartment || machine.stage;
                          const cfg = (machine.deptDurations && machine.deptDurations[dept]) || workflow.dept_durations[dept];
                          const target = (cfg && cfg.minutes) || 0;
                          const t = computeOverrun(machine.departmentEnteredAt, target, nowTick);
                          const closedToday = isClosedDay(nowTick);
                          const due = t.deadlineMs ? new Date(t.deadlineMs) : null;
                          const dueTxt = due ? `${fmtDate(due)} ${due.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "";
                          return (
                            <div className="flex items-center gap-1.5 flex-wrap mt-1 text-[10px]">
                              <span className="font-bold px-2 py-0.5 rounded-full" title={`Working time in ${dept} · target ${formatDuration(target)}${due && !t.isOverrun ? ` · due ${dueTxt}` : ""}`}
                                    style={t.isOverrun ? { background: "rgba(239,68,68,0.1)", color: "#b91c1c", border: "1px solid rgba(239,68,68,0.35)" } : { background: "rgba(21,128,61,0.08)", color: "#15803d", border: "1px solid rgba(21,128,61,0.3)" }}>
                                <LeadIcon e="⏱" />{formatDuration(t.actualMinutes)} / {formatDuration(target)}
                                {t.isOverrun ? ` · DELAYED ${formatDuration(t.overrunMinutes)}` : ""}
                              </span>
                              {/* 2026-11-03 — said once, next to the Today line; kept here (hidden) as the per-card hook. */}
                              {closedToday && <span data-card-closed-day className="mt-closed-chip font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(99,102,241,0.1)", color: "#4338ca" }}>⏸ paused — closed day</span>}
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    {/* Progress timeline — display only. Production stages are
                        Mechanical → Electrical → Trial → Ready (final); the
                        BOM Issued / Assembly phase is shown as the status pill
                        above, not as a stage. MACHINE_STAGES and every handler
                        are unchanged. Hidden for a floor login, who only acts on
                        their own stage. */}
                    {!isFloorLogin && (
                    <div className="mt-card-stages flex-1 min-w-[260px]">
                      <div className="flex items-center">
                        {DISPLAY_STAGES.map((stage, idx) => {
                          const done    = idx <= dispIdx;
                          const current = idx === dispIdx;
                          const sc      = DISPLAY_STAGE_COLORS[stage];
                          return (
                            <div key={stage} className="flex items-center flex-1 last:flex-none">
                              <div className="flex flex-col items-center gap-1 flex-shrink-0">
                                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-black transition-all"
                                     style={{
                                       background: done ? sc + "22" : "rgba(17,24,39,0.04)",
                                       border: `2px solid ${done ? sc : "rgba(17,24,39,0.10)"}`,
                                       color: done ? sc : "#6b7280",
                                       boxShadow: current ? `0 0 10px ${sc}55` : "none",
                                     }}>
                                  {done && !current ? "✓" : idx + 1}
                                </div>
                                <div className="text-[9px] font-bold text-center leading-tight whitespace-nowrap"
                                     style={{ color: done ? sc : "#6b7280", maxWidth: 44 }}>
                                  {stage}
                                </div>
                              </div>
                              {idx < DISPLAY_STAGES.length - 1 && (
                                <div className="flex-1 h-0.5 mx-1 rounded-full transition-all"
                                     style={{ background: idx < dispIdx ? (DISPLAY_STAGE_COLORS[DISPLAY_STAGES[idx + 1]] + "55") : "rgba(17,24,39,0.06)" }} />
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {dispIdx < 0 && (
                        <div className="text-[10px] mt-1.5" style={{ color: "var(--text-muted, #6b7280)" }}>
                          {machine.stage === "BOM Issued" ? "BOM issued — production starts at Mechanical." : "Assembly in progress — production stages start at Mechanical."}
                        </div>
                      )}
                    </div>
                    )}

                    {/* Actions — max-w-full so the row wraps on a phone instead
                        of being clipped by the card's overflow-hidden. */}
                    <div className="mt-card-actions flex items-center gap-2 flex-wrap max-w-full">
                      {/* Phase 1 — admin-only, and only while the card is open
                          (History). Update Stage bypasses the entire handover
                          chain; operators must use Finish & Transfer so the
                          signature, checklist and rating are always captured.
                          Keeping it behind History takes the select + button
                          off every card without removing the escape hatch. */}
                      {isExpanded && !isComplete && futureStages.length > 0 && isAdminUser && canDo("machines","updateStage") && !machine.pendingHandoverId
                        && !(handovers || []).some((h) => h && h.status === "pending" && String(h.machineId) === String(machine.id)) && (
                        String(stageEditFor) !== String(machine.id) ? (
                          <button type="button" data-stage-edit-toggle={machine.id} onClick={() => setStageEditFor(machine.id)}
                                  className="text-[11px] font-bold px-3 py-1.5 rounded-lg border transition-all"
                                  style={{ borderColor: "rgba(17,24,39,0.12)", color: "#475569", background: "var(--surface-card)" }}
                                  title="Admin correction — moves the stage without the hand-over">
                            Change stage (admin)
                          </button>
                        ) : (
                        <>
                          <select value={selStage} data-stage-edit-select={machine.id}
                                  onChange={(e) => setStageMap((p) => ({ ...p, [machine.id]: e.target.value }))}
                                  className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] text-slate-500 outline-none"
                                  style={{ background: "var(--surface-elevated)" }}>
                            <option value="">Update Stage</option>
                            {futureStages.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                          <button onClick={() => handleStageUpdate(machine)}
                                  disabled={!selStage}
                                  className="text-[11px] font-bold px-3 py-1.5 rounded-lg border transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                  style={{ background: selStage ? "#2640B0" : "transparent", borderColor: selStage ? "rgba(46, 80, 214,0.4)" : "rgba(17,24,39,0.10)", color: selStage ? "white" : "#6b7280" }}>
                            Update
                          </button>
                          <button type="button" onClick={() => setStageEditFor(null)} aria-label="Close stage change"
                                  className="text-[11px] font-bold px-2 py-1.5 rounded-lg border transition-all"
                                  style={{ borderColor: "rgba(17,24,39,0.10)", color: "#6b7280" }}>✕</button>
                        </>
                        )
                      )}
                      {/* Phase A — Finish & Transfer (handover flow). Shown only when:
                          (a) the machine isn't complete, (b) a next department exists,
                          (c) there's no handover already pending for this machine,
                          (d) the user has the permission, and (e) the parent passed
                          the handler. Lives next to Update Stage so operators can
                          pick either flow during the Phase A rollout. */}
                      {/* Migration 028 — During-Work checks button. Visible
                          only when THIS machine's current department has a
                          configured during_work template. Non-blocking —
                          operator can submit anytime between Accept and
                          Finish & Transfer. */}
                      {!isComplete && !machine.pendingHandoverId && onSubmitDuringWorkChecklist
                        && pickTemplate(checklistTemplates, machine.bomKey, machine.currentDepartment || machine.stage, "during_work") && (
                        <button onClick={() => openDuringWorkModal(machine)}
                                className="text-[11px] font-black text-white px-3 py-1.5 rounded-lg transition-all"
                                style={{ background: "#2640B0", boxShadow: "0 1px 2px rgba(17,24,39,0.14)", color: "#ffffff" }}
                                title="During-Work Checks">
                          <LeadIcon e="📋" />During-Work Checks
                        </button>
                      )}
                      {/* Phase 1 — report a fault to the department responsible.
                          Lets Trial call Mechanical back without the machine
                          itself moving backwards, which is how Shantaz works. */}
                      {!isComplete && machine.stage !== "BOM Issued" && !machine.pendingHandoverId && onRaisePendingItem && canDo("machines","accept") && (
                        <button onClick={() => { setRaiseModal({ machine }); setRaiseText(""); setRaiseDept(""); setRaiseErr(""); setRaisePart(emptyPendingJob()); }}
                                className="text-[11px] font-bold px-3 py-1.5 rounded-lg border transition-all"
                                style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.35)", color: "#dc2626" }}
                                title="Report a fault and call the department responsible">
                          Report Issue
                        </button>
                      )}
                      {/* 2026-11-01 — issues and pending jobs are TRACKING, not
                          gates. The disabled "Blocked · N open issues" and
                          "Cannot be Ready · N pending jobs" buttons are gone:
                          an open item never freezes Finish & Transfer, accept,
                          a stage update or any other workflow. What is
                          outstanding is still shown — as the clickable chip
                          below, which opens the same drawer where an
                          authorised user reads the detail and marks it
                          resolved. */}
                      {/* 2026-11-02 — manual ON HOLD / Release, straight on the
                          card. Same permission the database enforces: Admin,
                          or Finish & Transfer / Update Stage. The automatic
                          "hand-over not accepted in time" hold is separate. */}
                      {machine.holdActive && (
                        <span data-card-hold-badge={machine.id} className="text-[10px] font-black px-2 py-1 rounded-lg"
                              style={{ background: "rgba(239,68,68,0.15)", color: "#dc2626", border: "1px solid rgba(239,68,68,0.45)" }}
                              title={`Put on hold${machine.holdAt ? ` ${new Date(machine.holdAt).toLocaleString()}` : ""}: ${machine.holdReason || "no reason recorded"}`}>
                          🛑 ON HOLD{machine.holdReason ? ` · ${machine.holdReason.length > 40 ? `${machine.holdReason.slice(0, 40)}…` : machine.holdReason}` : ""}
                        </span>
                      )}
                      {!isComplete && onSetMachineHold && (isAdminUser || canFinishTransfer(canDo) || canDo("machines", "updateStage")) && (
                        machine.holdActive ? (
                          <button data-needs-net type="button" data-card-release-hold={machine.id}
                                  onClick={() => setHoldModal({ machine, release: true, reason: "", busy: false, error: "" })}
                                  className="wu-cardbtn wu-cardbtn-ok"
                                  title="Release this machine from ON HOLD">
                            <LeadIcon e="▶" />Release ON HOLD
                          </button>
                        ) : (
                          <button data-needs-net type="button" data-card-hold={machine.id}
                                  onClick={() => setHoldModal({ machine, release: false, reason: "", busy: false, error: "" })}
                                  className="wu-cardbtn wu-cardbtn-bad"
                                  title="Put this machine ON HOLD (a reason is required)">
                            <LeadIcon e="⏸" />ON HOLD
                          </button>
                        )
                      )}
                      {/* 2026-11-03 — Super Admin only: delete an Active Build or a Ready
          machine. The database function refuses anyone else. */}
      {currentUser?.role === "super_admin" && onDeleteMachine && machine.stage !== "BOM Issued" && (
        <button type="button" data-card-delete={machine.id}
                onClick={() => setDeleteModal({ machine, reason: "", busy: false, error: "" })}
                className="wu-cardbtn wu-cardbtn-bad"
                title="Delete this machine (Super Admin only)">
          <Trash2 size={13} className="inline -mt-0.5 mr-1" aria-hidden="true" />Delete
        </button>
      )}
      {!isComplete && nextDepartment(machine.currentDepartment || machine.stage) && !machine.pendingHandoverId && !machine.holdActive && canFinishTransfer(canDo) && onFinishTransfer && (
                        <button data-needs-net onClick={() => openFinishModal(machine)}
                                className={`font-black text-white rounded-lg transition-all ${isFloorLogin ? "text-[14px] px-5 py-2.5" : "text-[11px] px-3 py-1.5"}`}
                                style={{ background: "#15803d", boxShadow: "0 1px 2px rgba(17,24,39,0.14)", color: "#ffffff" }}
                                title={`Finish ${machine.currentDepartment || machine.stage} → ${nextDepartment(machine.currentDepartment || machine.stage)}`}>
                          {isFloorLogin ? `✓ Send to → ${nextDepartment(machine.currentDepartment || machine.stage)}` : "Finish & Transfer →"}
                        </button>
                      )}
                      {machine.pendingHandoverId && (() => {
                        const h = (handovers || []).find((x) => x.id === machine.pendingHandoverId && x.status === "pending");
                        // Migration 036 — parked on the rack. Nobody has been
                        // asked to accept it yet, so no clock and no alarm;
                        // the production head decides when it moves.
                        if (h && isAwaitingRelease(h)) {
                          return (
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[10px] font-black px-2 py-1 rounded-lg"
                                    style={{ background: "rgba(99,102,241,0.12)", color: "#4f46e5", border: "1px solid rgba(99,102,241,0.4)" }}>
                                On rack · assembled
                              </span>
                              <span className="text-[10px] text-slate-500">Assembled · Ready on {machine.rackSlot ? slotLabel(machine.rackSlot) : "the rack"} — {canDo("machines", "release") || isAdminUser ? "transfer it from the Rack View" : "an admin transfers it from the Rack View"}</span>
                              {isAdminUser && onPullBackHandover && (
                                <button type="button" onClick={() => setPullBack({ handover: h, reason: "", busy: false, error: "" })}
                                        title="Admin: cancel this hand-over and return the machine to Assembly"
                                        className="text-[11px] font-bold px-3 py-1.5 rounded-lg border transition-all"
                                        style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.35)", color: "#b91c1c" }}>
                                  ↩ Pull back
                                </button>
                              )}
                            </div>
                          );
                        }
                        const machineOverdue = h && isHoldOverdue(h.sentAt, h.acceptTimeoutMinutes, nowTick);
                        // 2026-10-31 — direct acceptance: the receiving
                        // department accepts from the machine card itself.
                        // Same modal, same checks (checklist, team, password,
                        // hold reason) as Transfer & Accept; the modal and
                        // the accept handler refuse a second acceptance.
                        // 2026-11-02 — Accept is on EVERY machine card that is
                        // waiting for the receiving department, on whichever
                        // tab it is shown (Production, Transfer & Accept,
                        // ...): no need to go to another screen. Same role /
                        // department check as before (canAcceptHandover).
                        const cardCanAccept = !!h && h.status === "pending" && !machine.holdActive && canAcceptHandover(canDo, h.toDepartment) && !!onAcceptHandover;
                        return (
                          <div className="flex items-center gap-2 flex-wrap">
                            {machineOverdue ? (
                              <span className="text-[10px] font-black px-2 py-1 rounded-lg"
                                    style={{ background: "rgba(239,68,68,0.15)", color: "#dc2626", border: "1px solid rgba(239,68,68,0.45)" }}>
                                <LeadIcon e="🚦" />ON HOLD
                              </span>
                            ) : (
                              <span className="text-[10px] font-black px-2 py-1 rounded-lg"
                                    style={{ background: "rgba(217, 119, 6,0.12)", color: "#B45309", border: "1px solid rgba(217, 119, 6,0.35)" }}>
                                <LeadIcon e="⏳" />Awaiting accept{h ? ` · ${h.toDepartment}` : ""}
                              </span>
                            )}
                            {cardCanAccept && (
                              <button data-needs-net type="button" data-card-accept={h.id}
                                      onClick={() => { if (!acceptModal) openAcceptModal(h); }}
                                      disabled={!!acceptModal}
                                      className="text-[11px] font-black text-white px-3 py-1.5 rounded-lg transition-all disabled:opacity-50"
                                      style={{ background: "#15803d", boxShadow: "0 1px 2px rgba(17,24,39,0.14)", color: "#ffffff" }}
                                      title={machineOverdue ? `ON HOLD — accept this machine into ${h.toDepartment} to release it (a reason is required)` : `Accept this machine into ${h.toDepartment}`}>
                                {machineOverdue ? "✓ Accept · release from hold" : "✓ Accept Machine"}
                              </button>
                            )}
                          </div>
                        );
                      })()}
                      {/* 2026-10-31 / 2026-11-01 — the one chip for everything
                          still open on this machine. It opens the drawer with
                          the full detail and the Part received / Work completed
                          actions, so an open issue can be read and resolved
                          from the card without ever gating the workflow. */}
                      {machineOpenAll.length > 0 && (
                        <button type="button" data-card-jobs={machine.id} data-card-issues={machineOpenItems.length || undefined}
                                onClick={() => setJobsDrawer(machine.id)}
                                className="text-[10px] font-black px-2.5 py-1.5 rounded-lg border transition-all"
                                style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.35)", color: "#b91c1c" }}
                                title={`${machineOpenItems.length ? `${machineOpenItems.length} open issue${machineOpenItems.length === 1 ? "" : "s"} · ` : ""}${machineOpenAll.length} item${machineOpenAll.length === 1 ? "" : "s"} open on ${machine.serialNo || machine.bomKey} — tap to see the detail and mark them resolved. Tracking only: nothing is blocked.`}>
                          {machineOpenItems.length > 0
                            ? `⚠ ${machineOpenItems.length} open issue${machineOpenItems.length === 1 ? "" : "s"}${machineOpenAll.length > machineOpenItems.length ? ` · ${machineOpenAll.length - machineOpenItems.length} owed` : ""}`
                            : `⏳ Pending Jobs · ${machineOpenAll.length}`}
                        </button>
                      )}
                      {/* 2026-11-02 — completed jobs stay visible: when nothing is
                          open any more, the same drawer is still reachable to
                          read who completed what, and when. */}
                      {machineOpenAll.length === 0 && (pendingHandoverItems || []).some((p) => String(p.machineId) === String(machine.id)) && (
                        <button type="button" data-card-jobs-done={machine.id} onClick={() => setJobsDrawer(machine.id)}
                                className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg border transition-all"
                                style={{ background: "rgba(22,163,74,0.06)", border: "1px solid rgba(22,163,74,0.3)", color: "#15803d" }}
                                title="All pending jobs on this machine are completed — tap to see the completion details">
                          ✓ Pending Jobs · all done ({(pendingHandoverItems || []).filter((p) => String(p.machineId) === String(machine.id)).length})
                        </button>
                      )}
                      {/* Migration 032 — Certificate view button for Trial-completed machines */}
                      {!isComplete && machine.trialCertificate && canFinishTransfer(canDo) && onUpdateTrialCertificate && (
                        <button type="button" data-cert-edit onClick={() => setTrialCertModal({ machine, editOnly: true })}
                                className="text-[10px] font-bold px-2 py-1.5 rounded-lg border transition-all"
                                style={{ background: "rgba(217,119,6,0.10)", border: "1px solid rgba(217,119,6,0.35)", color: "#b45309" }}
                                title="Complete or correct the Trial Certificate">
                          <LeadIcon e="✎" />Certificate
                        </button>
                      )}
                      {isComplete && machine.trialCertificate && (
                        <button onClick={() => setTrialCertViewModal(machine)}
                                className="text-[10px] font-bold text-slate-900 px-2 py-1.5 rounded-lg border transition-all"
                                style={{ background: "rgba(6,182,212,0.12)", border: "1px solid rgba(6,182,212,0.35)", color: "#0e7490" }}
                                title="View Trial Certificate">
                          <LeadIcon e="📋" />Certificate
                        </button>
                      )}
                      {isComplete && isAdminUser && (
                        <button type="button" data-card-report={machine.id} onClick={() => setReportMachineId(machine.id)}
                                className="text-[11px] font-black px-3 py-1.5 rounded-lg border transition-all"
                                style={{ background: "rgba(21,128,61,0.08)", border: "1px solid rgba(21,128,61,0.35)", color: "#15803d" }}
                                title="Company full report — BOM to Ready, internal">
                          Company report
                        </button>
                      )}
                      {isAdminUser && (
                        <button type="button" data-card-customer-report={machine.id} onClick={() => openReport("customer", machine.id)}
                                className="text-[11px] font-black px-3 py-1.5 rounded-lg border transition-all"
                                style={{ background: "var(--surface-card)", border: "1px solid var(--border-rim)", color: "var(--text-strong)" }}
                                title="Customer report — clean PDF to send to the customer">
                          Customer report
                        </button>
                      )}
                      <button onClick={() => setExpanded(isExpanded ? null : machine.id)}
                              className="text-[10px] font-bold text-slate-500 hover:text-slate-700 px-2 py-1.5 rounded-lg border border-slate-200 hover:border-white/20 transition-all">
                        {isExpanded ? "Hide" : "History"}
                      </button>
                    </div>
                  </div>
                </div>

                {/* ── Stage History + Phase B pending items + attachments ── */}
                {isExpanded && (() => {
                  const machineAttachments = (attachments || []).filter((a) => a.machineId === machine.id);
                  const machinePendingItems = (pendingHandoverItems || []).filter((p) => p.machineId === machine.id);
                  const openItems = machinePendingItems.filter(pendingItemIsOpen);
                  const machineRatings = (deptRatings || []).filter((r) => r.machineId === machine.id);
                  const ratingSummary = summarizeMachineRatings(machineRatings);
                  return (
                  <div className="px-5 pb-5 pt-1" style={{ borderTop: "1px solid rgba(17,24,39,0.04)" }}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      {/* ── Phase 1 — Production report ──
                          Where this machine stalled and why, pulled from data
                          already recorded: each department's handover timings,
                          its acceptance delay, and the rating that fell out of
                          them. The point is not to score people — it is to
                          find the step that keeps costing time, so the cause
                          can be fixed. */}
                      <div className="md:col-span-2">
                        <div className="flex items-baseline gap-3 flex-wrap mb-3">
                          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Production report</div>
                          {isAdminUser && <button type="button" data-history-report={machine.id} onClick={() => setReportMachineId(machine.id)}
                                  className="text-[11px] font-bold px-2.5 py-1 rounded-lg border ml-auto"
                                  style={{ borderColor: "var(--border-rim)", color: "var(--text-strong)", background: "var(--surface-card)" }}>
                            Company full report
                          </button>}
                          {/* Customer report: one button, on the card row above (2026-11-03). */}
                          {ratingSummary.average != null && (
                            <span className="text-[12px] font-black" style={{ color: ratingSummary.average >= 4.5 ? "#15803d" : ratingSummary.average >= 3.5 ? "#b45309" : "#dc2626" }}>
                              {formatRatingBadge(Math.round(ratingSummary.average))} {ratingSummary.average} / 5
                            </span>
                          )}
                        </div>
                        {(() => {
                          const hs = (handovers || [])
                            .filter((h) => String(h.machineId) === String(machine.id))
                            .slice().sort((a, b) => String(a.sentAt || "").localeCompare(String(b.sentAt || "")));
                          if (!hs.length) {
                            return <div className="text-[10px] text-slate-500 mb-4">No department has handed this machine on yet.</div>;
                          }
                          const stalls = [];
                          const rows = hs.map((h) => {
                            const expected = Number(h.expectedDurationMinutes) || 0;
                            const actual   = Number(h.actualDurationMinutes)   || 0;
                            const overrun  = Math.max(0, actual - expected);
                            // How long the receiving department left it sitting
                            // before accepting. Measured to the accept, not to
                            // now, so a finished machine reports what happened.
                            const waited   = (h.sentAt && h.acceptedAt)
                              ? Math.max(0, Math.floor((Date.parse(h.acceptedAt) - Date.parse(h.sentAt)) / 60000))
                              : null;
                            const held     = (waited != null)
                              ? Math.max(0, waited - (Number(h.acceptTimeoutMinutes) || 0))
                              : 0;
                            const rating   = (deptRatings || []).find((r) => String(r.handoverId) === String(h.id));
                            if (overrun > 0) stalls.push(`${h.fromDepartment} took ${formatDuration(overrun)} longer than its ${formatDuration(expected)} allowance`);
                            if (held > 0)    stalls.push(`${h.toDepartment} accepted ${formatDuration(held)} after its deadline`);
                            return { h, expected, actual, overrun, held, rating };
                          });
                          return (
                            <>
                              {stalls.length > 0 && (
                                <div className="rounded-lg px-3 py-2.5 mb-3"
                                     style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.3)" }}>
                                  <div className="text-[10px] font-black mb-1" style={{ color: "#dc2626" }}>Where it lost time</div>
                                  <ul className="list-disc pl-4 space-y-0.5">
                                    {stalls.map((t, i) => <li key={i} className="text-[11px] text-slate-700">{t}</li>)}
                                  </ul>
                                </div>
                              )}
                              {stalls.length === 0 && (
                                <div className="rounded-lg px-3 py-2 mb-3 text-[11px]"
                                     style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.3)", color: "#15803d" }}>
                                  Ran clean — every department finished inside its allowance and accepted on time.
                                </div>
                              )}
                              <div className="overflow-x-auto">
                                <table className="w-full text-[11px]" style={{ minWidth: 680 }}>
                                  <thead>
                                    <tr className="text-left text-slate-500">
                                      <th scope="col" className="font-bold pb-1.5 pr-3">Department</th>
                                      <th scope="col" className="font-bold pb-1.5 pr-3">Target</th>
                                      <th scope="col" className="font-bold pb-1.5 pr-3">Actual</th>
                                      <th scope="col" className="font-bold pb-1.5 pr-3">Delay · reason</th>
                                      <th scope="col" className="font-bold pb-1.5 pr-3">Pending jobs</th>
                                      <th scope="col" className="font-bold pb-1.5 pr-3">Next dept waited</th>
                                      <th scope="col" className="font-bold pb-1.5">Stars</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {rows.map(({ h, expected, actual, overrun, held, rating }) => (
                                      <tr key={h.id} style={{ borderTop: "1px solid rgba(17,24,39,0.06)" }}>
                                        <td className="py-1.5 pr-3 font-bold text-slate-700">{h.fromDepartment}</td>
                                        <td className="py-1.5 pr-3 text-slate-500">{formatDuration(expected)}</td>
                                        <td className="py-1.5 pr-3" style={{ color: overrun > 0 ? "#dc2626" : "#15803d" }}>
                                          {formatDuration(actual)}
                                        </td>
                                        <td className="py-1.5 pr-3" style={{ color: overrun > 0 ? "#dc2626" : "#6b7280", maxWidth: 220 }}>
                                          {overrun > 0 ? `${formatDuration(overrun)}${h.overrunNarration ? ` — ${h.overrunNarration}` : ""}` : "—"}
                                        </td>
                                        <td className="py-1.5 pr-3 text-slate-600">
                                          {(() => {
                                            // Jobs raised at this hand-over — tracked apart from the delay.
                                            const js = (pendingHandoverItems || []).filter((p) => String(p.raisedInHandoverId) === String(h.id));
                                            if (!js.length) return "—";
                                            const open = js.filter(pendingItemIsOpen).length;
                                            return `${js.length}${open ? ` (${open} open)` : " (done)"}`;
                                          })()}
                                        </td>
                                        <td className="py-1.5 pr-3" style={{ color: held > 0 ? "#dc2626" : "#6b7280" }}>
                                          {held > 0 ? `${formatDuration(held)} late` : "on time"}
                                        </td>
                                        <td className="py-1.5 font-bold" style={{ color: rating ? (rating.rating >= 4 ? "#15803d" : "#dc2626") : "#9ca3af" }}>
                                          {rating ? `${rating.rating}/5` : "—"}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              {(() => {
                                // Every pending job on this machine with its full history.
                                const jobs = (pendingHandoverItems || []).filter((p) => String(p.machineId) === String(machine.id))
                                  .slice().sort((a, b) => String(a.raisedAt || "").localeCompare(String(b.raisedAt || "")));
                                if (!jobs.length) return null;
                                return (
                                  <div className="mt-3">
                                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">Pending jobs · history ({jobs.length})</div>
                                    <div className="space-y-2">
                                      {jobs.map((p) => (
                                        <div key={p.id} className="rounded-lg px-2.5 py-2" style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.08)" }}>
                                          <div className="text-[11px] font-semibold text-slate-800">
                                            {p.description}
                                            {p.itemCode && <span className="font-normal text-slate-500"> · <span className="font-mono">{p.itemCode}</span>{p.qty != null ? ` × ${p.qty}` : ""}</span>}
                                            <span className="font-normal text-slate-500"> · {p.assignedDepartment || "Unassigned"}</span>
                                          </div>
                                          <JobHistory item={p} users={allUsers} compact />
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })()}
                            </>
                          );
                        })()}
                      </div>

                      {/* Stage history */}
                      <div>
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-3">Stage History</div>
                        <div className="relative pl-5">
                          <div className="absolute left-2 top-0 bottom-0 w-px" style={{ background: "rgba(17,24,39,0.06)" }} />
                          {!(machine.history || []).length && (
                            <div data-stage-history-empty className="text-[11px] text-slate-500">No stage moves yet</div>
                          )}
                          {[...(machine.history || [])].reverse().map((h, i) => {
                            const sc = STAGE_COLORS[h.stage] || "#2E50D6";
                            return (
                              <div key={i} className="relative mb-3 last:mb-0">
                                <div className="absolute -left-[13px] top-1 w-2.5 h-2.5 rounded-full flex-shrink-0"
                                     style={{ background: sc + "22", border: `1.5px solid ${sc}`, boxShadow: i === 0 ? `0 0 8px ${sc}55` : "none" }} />
                                <div className="flex items-center gap-3 flex-wrap">
                                  <span className="text-[10px] font-bold text-slate-900">{h.stage}</span>
                                  {i === 0 && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: sc+"18", color: sc, border: `1px solid ${sc}30` }}>Current</span>}
                                  <span className="text-[9px] text-slate-600 font-mono ml-auto">{h.date}</span>
                                </div>
                                {h.note && <div className="text-[10px] text-slate-500 mt-0.5">{h.note}</div>}
                                {h.handoverId && (() => {
                                  // 2026-11-02 — acceptance record: who, where, when and the signature.
                                  const ho = (handovers || []).find((x) => String(x.id) === String(h.handoverId));
                                  if (!ho || !ho.acceptedSignatureSvg) return null;
                                  return (
                                    <div data-history-accept-signature className="mt-1 flex items-center gap-2">
                                      <img alt="Acceptance signature" src={svgDataUri(ho.acceptedSignatureSvg)} style={{ height: 28, maxWidth: 110, background: "#fff", border: "1px solid rgba(17,24,39,0.12)", borderRadius: 4 }} />
                                      <span className="text-[9px] text-slate-500">{ho.acceptedByName || h.by} · {ho.acceptedInDepartment || h.department} · {ho.acceptedAt ? new Date(ho.acceptedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : ""}</span>
                                    </div>
                                  );
                                })()}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Phase B — Ratings + Pending items + Attachments */}
                      <div className="space-y-4">
                        {/* Migration 029 — Workers + Main Employee per dept.
                            Reads from accepted handovers so you see the full
                            attribution chain once a department has signed off.
                            Historical snapshot is in `workedBySnapshot` so
                            renames / deactivations don't break the display. */}
                        {(() => {
                          // Same snapshot-over-column rule as the A-to-Z report:
                          // worked_by is a uuid[] and drops factory workers, so a
                          // handover done entirely by non-login workers would have
                          // looked like no handover at all here.
                          const machineHandovers = (handovers || []).filter((h) =>
                            String(h.machineId) === String(machine.id)
                            && workerIdsOf(h).length > 0);
                          if (!machineHandovers.length) return null;
                          // Same two snapshot shapes as the A-to-Z report: an
                          // ERP login has fullName/username, a factory worker
                          // has { type: "emp", name }. Reading only the first
                          // printed raw "emp:<uuid>" ids here too.
                          const nameOf = (uid, snapshot) => {
                            if (Array.isArray(snapshot)) {
                              const s = snapshot.find((x) => x && x.id === uid);
                              if (s && s.fullName) return s.fullName;
                              if (s && s.username) return s.username;
                              if (s && s.name)     return s.name;
                            }
                            const u = (allUsers || []).find((x) => x.id === uid);
                            if (u) return u.fullName || u.username || uid;
                            return String(uid).startsWith("emp:") ? String(uid).slice(4) : uid;
                          };
                          // 2026-10-31 — the Main Employee may be a Settings
                          // employee (main_employee_ref "emp:…", snapshot main:true).
                          const mainOf = (h) => h.mainEmployeeRef || h.mainEmployeeId || (Array.isArray(h.workedBySnapshot) ? (h.workedBySnapshot.find((x) => x && x.main) || {}).id : null) || null;
                          return (
                            <div>
                              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">Team per department</div>
                              <div className="space-y-1">
                                {machineHandovers.map((h) => { const mid = mainOf(h); const others = workerIdsOf(h).filter((uid) => uid !== mid); return (
                                  <div key={h.id} className="rounded px-2 py-1.5 text-[10.5px] flex items-center gap-x-2 gap-y-0.5 flex-wrap"
                                       style={{ background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.25)" }}>
                                    <span className="font-black text-emerald-200">{h.fromDepartment}</span>
                                    <span className="text-[9px] text-slate-500">{h.sentAt ? new Date(h.sentAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : ""}</span>
                                    {mid && <span className="text-slate-300"><span className="text-yellow-300">⭐</span> {h.mainEmployeeName || nameOf(mid, h.workedBySnapshot)}{h.mainEmployeeSignatureSvg ? <span title="Main Employee signed" className="text-yellow-300"> ✍</span> : ""}</span>}
                                    {others.length > 0 && <span className="text-slate-500" title={others.map((uid) => nameOf(uid, h.workedBySnapshot)).join(", ")}>+ {others.map((uid) => nameOf(uid, h.workedBySnapshot)).join(", ")}</span>}
                                    {h.checklistTemplateName || h.checklistSnapshot ? <span className="text-[9px] font-bold text-sky-300">☑ checklist</span> : null}
                                  </div>
                                ); })}
                              </div>
                            </div>
                          );
                        })()}

                        {/* Rating summary */}
                        {ratingSummary.count > 0 && (
                          <div>
                            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">Department Ratings</div>
                            <div className="space-y-1">
                              {Object.entries(ratingSummary.perDept).map(([dept, info]) => (
                                <div key={dept} className="flex items-center gap-2 text-[11px]">
                                  <span className="w-24 text-slate-500">{dept}</span>
                                  <span className="font-black text-yellow-300" style={{ letterSpacing: "0.1em" }}>{formatRatingBadge(info.rating)}</span>
                                  {info.overridden && <span className="text-[9px] font-bold text-blue-300">(overridden)</span>}
                                </div>
                              ))}
                              <div className="text-[10px] text-slate-500 mt-1">Average {ratingSummary.average}★</div>
                            </div>
                          </div>
                        )}

                        {/* Pending items */}
                        <div>
                          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">Pending Handover Items</div>
                          {machinePendingItems.length === 0 && (
                            <div className="text-[10px] text-slate-500">None.</div>
                          )}
                          {machinePendingItems.length > 0 && (
                            <div className="space-y-1.5">
                              {machinePendingItems.map((p) => (
                                <div key={p.id} className="rounded px-2 py-1.5" style={{ background: p.status === "resolved" ? "rgba(34,197,94,0.06)" : p.receivedAt ? "rgba(37,99,235,0.06)" : "rgba(217, 119, 6,0.08)", border: `1px solid ${p.status === "resolved" ? "rgba(34,197,94,0.25)" : p.receivedAt ? "rgba(37,99,235,0.3)" : "rgba(217, 119, 6,0.3)"}` }}>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-[11px] text-slate-700 flex-1">{p.description}</span>
                                    {p.status === "resolved" ? (
                                      <span className="text-[9px] font-bold text-emerald-700">✓ Completed</span>
                                    ) : (
                                      <>
                                        <span className="text-[9px] font-bold" style={{ color: p.receivedAt ? "#1d4ed8" : "#b45309" }}>
                                          {p.receivedAt ? "Part received · finish work" : (Number(p.receivedQty) || 0) > 0 ? `Partly received · ${pendingItemRemaining(p)} left` : p.itemCode ? "Awaiting part" : "Awaiting work"}
                                        </span>
                                        {onReceivePendingItem && pendingItemIsPart(p) && canReceiveJob(p) && !p.receivedAt && (
                                          <button data-needs-net onClick={() => setJobAction({ item: p, action: "receive", notes: "", busy: false, error: "" })}
                                                  className="text-[10px] font-bold px-2 py-0.5 rounded border"
                                                  style={{ color: "#1d4ed8", borderColor: "rgba(37,99,235,0.4)", background: "rgba(37,99,235,0.08)" }}>
                                            <LeadLabel text="📦 Part received" />
                                          </button>
                                        )}
                                        {canFinishTransfer(canDo) && onResolvePendingItem && !pendingItemIsPart(p) && (
                                          <button data-needs-net onClick={() => setJobAction({ item: p, action: "complete", notes: "", busy: false, error: "" })}
                                                  className="text-[10px] font-bold px-2 py-0.5 rounded border"
                                                  style={{ color: "#15803d", borderColor: "rgba(22,163,74,0.4)", background: "rgba(22,163,74,0.08)" }}>
                                            Work completed
                                          </button>
                                        )}
                                      </>
                                    )}
                                  </div>
                                  {p.itemCode && (
                                    <div className="text-[10px] text-slate-500 mt-0.5">
                                      Part <span className="font-mono font-bold text-slate-700">{p.itemCode}</span>{p.itemName ? ` · ${p.itemName}` : ""}{p.qty != null ? ` · qty ${p.qty}` : ""}
                                    </div>
                                  )}
                                  <JobHistory item={p} users={allUsers} compact />
                                  {/* Phase 1 — who has been called to fix this. */}
                                  {p.assignedDepartment && p.status !== "resolved" && (
                                    <div className="text-[10px] font-bold mt-1" style={{ color: "#dc2626" }}>
                                      {p.assignedDepartment} called
                                    </div>
                                  )}

                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Attachments */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Attachments ({machineAttachments.length})</div>
                            {onUploadAttachment && canFinishTransfer(canDo) && (
                              <div className="flex gap-2">
                                {[{ k: "photo", icon: "📷", text: "Take photo", cap: "environment", acc: "image/*" },
                                  { k: "file", icon: "📎", text: "Add file", cap: undefined, acc: "image/*,video/*,application/pdf" }].map((b) => (
                                  <label data-needs-net key={b.k} data-attach-btn={b.k} className="text-[13px] font-black cursor-pointer rounded-xl flex items-center gap-1.5 px-4"
                                         style={{ minHeight: 46, background: "#1d4ed8", color: "#fff" }}>
                                    <span style={{ fontSize: 18 }}>{b.icon}</span>{b.text}
                                    <input type="file" className="hidden" accept={b.acc} capture={b.cap}
                                           onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) setAttachAsk({ kind: "upload", machine, file, busy: false }); }} />
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                          {machineAttachments.length === 0 && (
                            <div className="text-[10px] text-slate-500">No files yet.</div>
                          )}
                          {machineAttachments.length > 0 && (
                            <ul className="space-y-1 text-[11px]">
                              {machineAttachments.map((a) => isVoiceAttachment(a) ? (
                                <li key={a.id} className="flex items-center gap-2" data-card-voice-note>
                                  <div className="flex-1 min-w-0"><VoiceNoteLine attachment={a} userName={voiceUserName} /></div>
                                  {canConfigureDept(canDo) && onDeleteAttachment && (
                                    <button onClick={() => setAttachAsk({ kind: "delete", a, busy: false })}
                                            className="text-[16px] font-black text-slate-500 hover:text-red-500 px-2" aria-label="Delete voice note">×</button>
                                  )}
                                </li>
                              ) : (
                                <li key={a.id} className="flex items-center gap-2 flex-wrap">
                                  <span className="text-slate-400">
                                    {a.kind === "photo" ? "🖼" : a.kind === "video" ? "🎞" : a.kind === "trial_report" ? "📄" : "📎"}
                                  </span>
                                  <AttachmentLink attachment={a} />
                                  <span className="text-slate-600 text-[10px]">{a.department}</span>
                                  {a.isCustomerVisible && (
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-emerald-300 bg-emerald-500/10 border border-emerald-500/30">customer-visible</span>
                                  )}
                                  {canConfigureDept(canDo) && onDeleteAttachment && (
                                    <button onClick={() => setAttachAsk({ kind: "delete", a, busy: false })}
                                            className="text-[16px] font-black text-slate-500 hover:text-red-500 px-2" aria-label="Delete file">×</button>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  );
                })()}
              </div>
            );
          }} />)}
        </div>
        )}

      </div>

      {attachAsk && (() => {
        const close = () => !attachAsk.busy && setAttachAsk(null);
        const doUpload = async (customer) => {
          const { machine, file } = attachAsk;
          setAttachAsk((prev) => prev ? { ...prev, busy: true } : prev);
          const dept = machine.currentDepartment || machine.stage;
          const r = await onUploadAttachment({ machineId: machine.id, department: dept, stage: dept, file, caption: "", isCustomerVisible: customer });
          setAttachAsk(null);
          if (r && r.success === false) showToast("Upload failed", r.error || "", "urgent");
          else showToast("Attachment uploaded", file.name);
        };
        const doDelete = async () => {
          const { a } = attachAsk;
          setAttachAsk((prev) => prev ? { ...prev, busy: true } : prev);
          const r = await onDeleteAttachment(a.id);
          setAttachAsk(null);
          if (r && r.success === false) showToast("Delete failed", r.error || "", "urgent");
          else showToast("Attachment deleted", "");
        };
        const big = { minHeight: 52, fontSize: 15 };
        return (
          <div data-attach-ask className="modal-backdrop fixed inset-0 z-[90] flex items-center justify-center p-4"
               style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(10px)" }}
               onClick={(e) => e.target === e.currentTarget && close()}>
            <div className="w-full max-w-sm rounded-2xl p-5 space-y-3" style={{ background: "var(--surface-elevated)", border: "1px solid rgba(17,24,39,0.15)" }}>
              {attachAsk.kind === "upload" ? (
                <>
                  <div className="text-[16px] font-black text-slate-900">Show this on the Customer Progress Report?</div>
                  <div className="text-[12px] text-slate-500 break-all">{attachAsk.file?.name}</div>
                  <button disabled={attachAsk.busy} onClick={() => doUpload(true)} className="w-full rounded-xl font-black text-white disabled:opacity-60" style={{ ...big, background: "#15803d" }}>{attachAsk.busy ? "⏳ Please wait…" : "Yes, show customer"}</button>
                  <button disabled={attachAsk.busy} onClick={() => doUpload(false)} className="w-full rounded-xl font-black text-slate-800 bg-white border-2 border-slate-300 disabled:opacity-60" style={big}>No, internal only</button>
                  <button disabled={attachAsk.busy} onClick={close} className="w-full text-[13px] font-bold text-slate-500 py-2">Cancel</button>
                </>
              ) : (
                <>
                  <div className="text-[16px] font-black text-slate-900">Are you sure you want to delete this file?</div>
                  <div className="text-[13px] font-bold text-slate-700 break-all">{attachAsk.a?.fileName || attachAsk.a?.name || attachAsk.a?.caption || "This attachment"}</div>
                  <button disabled={attachAsk.busy} onClick={doDelete} className="w-full rounded-xl font-black text-white disabled:opacity-60" style={{ ...big, background: "#dc2626" }}>{attachAsk.busy ? "⏳ Please wait…" : "Yes, delete"}</button>
                  <button disabled={attachAsk.busy} onClick={close} className="w-full rounded-xl font-black text-slate-800 bg-white border-2 border-slate-300" style={big}>No, keep it</button>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Staff My Dashboard (2026-11-03) — own departments only ── */}
      {staffMode && !isProdHead && hasDepartments && myDashOpen && (
        <StaffMyDashboard departments={myDepartments} handovers={handovers} deptRatings={deptRatings}
                          machineLog={machineLog} onClose={() => setMyDashOpen(false)} />
      )}

      {/* ── Admin Pull Back (2026-10-30) ── */}
      {/* ── Full machine report (2026-11-01) ──
          Full screen on every device: a fixed bar with Back, the title, Print
          and Close; the report sheet scrolls under it. Print shows only the
          report (see .print-machine-report in index.css). */}
      {reportMachineId && (
        <div className="mt-report-modal fixed inset-0 z-[95] flex flex-col" role="dialog" aria-label="Machine report"
             style={{ background: "rgba(17,24,39,0.55)", backdropFilter: "blur(6px)" }}>
          <div className="mt-report-bar flex items-center gap-2 px-3 sm:px-5 py-2.5 flex-shrink-0"
               style={{ background: "var(--surface-card)", borderBottom: "1px solid var(--border-subtle)" }}>
            <button type="button" data-report-back onClick={() => setReportMachineId(null)}
                    className="h-9 px-3 rounded-lg text-[12px] font-black flex items-center gap-1.5"
                    style={{ border: "1px solid var(--border-rim)", color: "var(--text-strong)" }}>← Back</button>
            <div className="text-[13px] font-black truncate flex-1 min-w-0" style={{ color: "var(--text-strong)" }}>
              Machine report{(() => { const m = machineLog.find((x) => String(x.id) === String(reportMachineId)); return m ? ` · ${m.bomKey}${m.serialNo ? ` · ${m.serialNo}` : ""}` : ""; })()}
            </div>
            <button type="button" data-report-print onClick={printMachineReport}
                    className="h-9 px-3 rounded-lg text-[12px] font-black text-white flex items-center gap-1.5"
                    style={{ background: "#2640B0" }}>🖨 <span className="hidden sm:inline">Print / PDF</span></button>
            <button type="button" aria-label="Close report" onClick={() => setReportMachineId(null)}
                    className="w-9 h-9 rounded-full flex items-center justify-center text-[15px] font-black"
                    style={{ background: "rgba(17,24,39,0.07)", color: "var(--text-dim)" }}>✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 sm:p-6" onClick={(e) => e.target === e.currentTarget && setReportMachineId(null)}>
            <div className="mt-report-sheet mx-auto w-full max-w-4xl rounded-xl p-4 sm:p-8" style={{ background: "#fff", boxShadow: "0 24px 60px rgba(17,24,39,0.25)" }}>
              <AtoZMachineReport machineId={reportMachineId} machineLog={machineLog} bomDefs={bomDefs} handovers={handovers}
                                 pendingHandoverItems={pendingHandoverItems} deptRatings={deptRatings} checklistResponses={checklistResponses}
                                 outwardLog={outwardLog} items={items} attachments={attachments} settings={settings}
                                 auditLog={auditLog} allUsers={allUsers} generatedBy={currentUser?.fullName || currentUser?.name || currentUser?.username || ""} />
            </div>
          </div>
        </div>
      )}

      {/* ── Reports chooser (2026-11-03) — the four PDF reports ── */}
      {reportsMenu && (() => {
        const sorted = (machineLog || []).slice().sort((a, b) => String(a.bomKey || "").localeCompare(String(b.bomKey || "")) || String(a.serialNo || "").localeCompare(String(b.serialNo || "")));
        const pickOk = sorted.some((m) => String(m.id) === String(reportPick));
        const machineSelect = (
          <select data-report-machine-pick value={pickOk ? reportPick : ""} onChange={(e) => setReportPick(e.target.value)} onClick={(e) => e.stopPropagation()}
                  className="rpt-menu-select" aria-label="Machine">
            {!pickOk && <option value="">Choose a machine…</option>}
            {sorted.map((m) => <option key={m.id} value={m.id}>{m.bomKey}{m.serialNo ? ` · ${m.serialNo}` : ""} — {m.status === "completed" ? "Ready" : (m.currentDepartment || m.stage)}</option>)}
          </select>
        );
        const items = [
          { kind: "customer", title: "Customer report", sub: "Clean report for the customer: photo, build dates, quality checks, trial certificate, sign-off.", machine: true },
          { kind: "company",  title: "Company full report", sub: "Internal: route with times vs target, who transferred and accepted, every checklist, holds, pending jobs, signatures.", machine: true, admin: true },
          { kind: "hold",     title: "On hold report", sub: "Machines that went on hold in a period, how long, why and who — totals by department and reason." },
          { kind: "pending",  title: "Pending jobs report", sub: "Open parts and work per machine and department: quantity, critical flag, status and age." },
        ].filter((x) => !x.admin || isAdminUser);
        return (
          <div data-reports-chooser className="modal-backdrop fixed inset-0 z-[90] flex items-center justify-center p-4"
               style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(6px)" }}
               onClick={(e) => e.target === e.currentTarget && setReportsMenu(false)}>
            <div className="w-full max-w-xl rounded-2xl p-5 rpt-menu" style={{ background: "var(--surface-elevated)", border: "1px solid var(--border-subtle)", boxShadow: "0 24px 60px rgba(17,24,39,0.22)" }}>
              <div className="flex items-start gap-3 mb-4">
                <div className="flex-1 min-w-0">
                  <h3 className="text-[17px] font-black" style={{ color: "var(--text-strong)" }}>Reports</h3>
                  <p className="text-[12px]" style={{ color: "var(--text-dim)" }}>A4 reports — open one, then Print or save as PDF.</p>
                </div>
                <ModalX onClose={() => setReportsMenu(false)} />
              </div>
              <div className="space-y-2.5">
                {items.map((x) => (
                  <div key={x.kind} className="rpt-menu-item" data-report-option={x.kind}>
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-black" style={{ color: "var(--text-strong)" }}>{x.title}</div>
                      <div className="text-[12px] leading-snug" style={{ color: "var(--text-dim)" }}>{x.sub}</div>
                      {x.machine && <div className="mt-2">{machineSelect}</div>}
                    </div>
                    <button type="button" data-report-open={x.kind} disabled={x.machine && !pickOk}
                            onClick={() => openReport(x.kind, x.machine ? reportPick : null)}
                            className="rpt-menu-open">Open</button>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-3 flex items-center justify-between gap-3" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                <span className="text-[12px]" style={{ color: "var(--text-dim)" }}>Production, department-wise and monthly tables</span>
                <button type="button" data-open-reports onClick={() => onNavigate("reports")}
                        className="h-9 px-3 rounded-lg text-[12px] font-bold"
                        style={{ border: "1px solid var(--border-rim)", color: "var(--text-strong)", background: "var(--surface-card)" }}>
                  Report Center →
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Report viewer for the four reports (2026-11-03) — same full-screen
          sheet and print rules as the machine report above. ── */}
      {reportDoc && (() => {
        const m = machineLog.find((x) => String(x.id) === String(reportDoc.machineId));
        const by = currentUser?.fullName || currentUser?.name || currentUser?.username || "";
        const heading = { customer: "Customer report", company: "Company full report", hold: "On hold report", pending: "Pending jobs report" }[reportDoc.kind];
        const deptOptions = [...new Set((pendingHandoverItems || []).map((p) => p.assignedDepartment || "Unassigned"))].sort();
        return (
          <div className="mt-report-modal fixed inset-0 z-[95] flex flex-col" role="dialog" aria-label={heading} data-report-viewer={reportDoc.kind}
               style={{ background: "rgba(17,24,39,0.55)", backdropFilter: "blur(6px)" }}>
            <div className="mt-report-bar flex items-center gap-2 px-3 sm:px-5 py-2.5 flex-shrink-0 flex-wrap"
                 style={{ background: "var(--surface-card)", borderBottom: "1px solid var(--border-subtle)" }}>
              <button type="button" data-report-doc-back onClick={() => { setReportDoc(null); setReportsMenu(true); }}
                      className="h-9 px-3 rounded-lg text-[12px] font-black flex items-center gap-1.5"
                      style={{ border: "1px solid var(--border-rim)", color: "var(--text-strong)" }}>← Reports</button>
              <div className={`text-[13px] font-black truncate flex-1 min-w-0 ${reportDoc.kind === "hold" || reportDoc.kind === "pending" ? "max-sm:invisible" : ""}`} style={{ color: "var(--text-strong)" }}>
                {heading}{m && (reportDoc.kind === "customer" || reportDoc.kind === "company") ? ` · ${m.bomKey}${m.serialNo ? ` · ${m.serialNo}` : ""}` : ""}
              </div>
              {reportDoc.kind === "hold" && (
                <select data-report-period value={holdPeriod} onChange={(e) => setHoldPeriod(e.target.value)} className="rpt-bar-select" aria-label="Period">
                  {RPT_PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              )}
              {reportDoc.kind === "pending" && (
                <>
                  <select data-report-dept value={pendDept} onChange={(e) => setPendDept(e.target.value)} className="rpt-bar-select" aria-label="Department">
                    <option value="">All departments</option>
                    {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <label className="text-[12px] font-bold flex items-center gap-1.5 px-1" style={{ color: "var(--text-strong)" }}>
                    <input type="checkbox" data-report-include-done checked={pendIncludeDone} onChange={(e) => setPendIncludeDone(e.target.checked)} /> Include completed
                  </label>
                </>
              )}
              <button type="button" data-report-doc-print onClick={printReportDoc}
                      className="h-9 px-3 rounded-lg text-[12px] font-black text-white flex items-center gap-1.5"
                      style={{ background: "#2640B0" }}>Print / PDF</button>
              <button type="button" aria-label="Close report" onClick={closeReports}
                      className="w-9 h-9 rounded-full flex items-center justify-center text-[15px] font-black"
                      style={{ background: "rgba(17,24,39,0.07)", color: "var(--text-dim)" }}>✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 sm:p-6" onClick={(e) => e.target === e.currentTarget && closeReports()}>
              <div className="mt-report-sheet mx-auto w-full max-w-4xl rounded-xl p-4 sm:p-8" style={{ background: "#fff", boxShadow: "0 24px 60px rgba(17,24,39,0.25)" }}>
                {reportDoc.kind === "customer" && <CustomerMachineReport machineId={reportDoc.machineId} machineLog={machineLog} bomDefs={bomDefs} handovers={handovers}
                                                     checklistResponses={checklistResponses} attachments={attachments} settings={settings} generatedBy={by}
                                                     pendingHandoverItems={pendingHandoverItems} outwardLog={outwardLog} auditLog={auditLog} items={items} allUsers={allUsers} />}
                {reportDoc.kind === "company" && <AtoZMachineReport machineId={reportDoc.machineId} machineLog={machineLog} bomDefs={bomDefs} handovers={handovers}
                                                     pendingHandoverItems={pendingHandoverItems} deptRatings={deptRatings} checklistResponses={checklistResponses}
                                                     outwardLog={outwardLog} items={items} attachments={attachments} settings={settings}
                                                     auditLog={auditLog} allUsers={allUsers} generatedBy={by} />}
                {reportDoc.kind === "hold" && <OnHoldReport period={holdPeriod} machineLog={machineLog} handovers={handovers} auditLog={auditLog} allUsers={allUsers} settings={settings} generatedBy={by} />}
                {reportDoc.kind === "pending" && <PendingJobsReport includeDone={pendIncludeDone} dept={pendDept} machineLog={machineLog} pendingHandoverItems={pendingHandoverItems} allUsers={allUsers} settings={settings} generatedBy={by} />}
              </div>
            </div>
          </div>
        );
      })()}

      {deleteModal && (() => {
        const m = deleteModal.machine;
        const submit = async () => {
          if (deleteModal.busy) return;
          setDeleteModal((prev) => prev ? { ...prev, busy: true, error: "" } : prev);
          const r = await onDeleteMachine({ machineId: m.id, reason: deleteModal.reason.trim() });
          if (r && r.success === false) { setDeleteModal((prev) => prev ? { ...prev, busy: false, error: r.error || "Could not delete." } : prev); return; }
          setDeleteModal(null);
          showToast(`${m.bomKey}${m.serialNo ? ` · S/N ${m.serialNo}` : ""} deleted`);
        };
        return (
          <div data-delete-modal className="modal-backdrop fixed inset-0 z-[72] flex items-center justify-center p-4"
               style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(12px)" }}
               onClick={(e) => e.target === e.currentTarget && !deleteModal.busy && setDeleteModal(null)}>
            <div className="w-full max-w-md rounded-2xl p-5" style={{ background: "var(--surface-raised)", border: "1px solid rgba(239,68,68,0.35)", boxShadow: "0 24px 70px rgba(17,24,39,0.2)" }}>
              <h3 className="text-base font-black text-red-700 mb-1">Delete this machine?</h3>
              <div data-delete-target className="rounded-lg px-3 py-2.5 mb-3" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.3)" }}>
                <div className="text-[14px] font-black text-slate-900">{m.bomKey}</div>
                <div className="text-[12px] text-slate-700">Serial number: <span className="font-bold">{m.serialNo || "—"}</span> · {m.status === "completed" ? "Ready" : `now in ${m.currentDepartment || m.stage}`}</div>
              </div>
              <p className="text-[11px] text-slate-600 mb-3">The machine and its hand-over, checklist, rating and pending-job records are removed. Stock, the BOM, the rack set-up and every other machine are not touched. Who deleted it, when and what it was is kept in the Audit Trail. This cannot be undone.</p>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">Reason (optional)</label>
              <textarea data-delete-reason rows={2} value={deleteModal.reason} disabled={deleteModal.busy}
                        onChange={(e) => setDeleteModal((prev) => prev ? { ...prev, reason: e.target.value, error: "" } : prev)}
                        placeholder="e.g. test machine"
                        className="w-full rounded-lg px-3 py-2.5 text-[13px] text-slate-800 outline-none"
                        style={{ background: "var(--surface-elevated)", border: "1px solid rgba(17,24,39,0.12)" }} />
              {deleteModal.error && <div className="mt-3 text-[11px] font-bold px-3 py-2 rounded-lg" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.4)", color: "#dc2626" }}>{deleteModal.error}</div>}
              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => setDeleteModal(null)} disabled={deleteModal.busy} className="flex-1 h-11 rounded-lg text-[13px] font-bold text-slate-600 border transition-all disabled:opacity-40" style={{ borderColor: "rgba(17,24,39,0.15)" }}>Cancel</button>
                <button type="button" data-delete-confirm onClick={submit} disabled={deleteModal.busy} className="flex-[2] min-h-[48px] rounded-xl text-[14px] font-black text-white transition-all disabled:opacity-50" style={{ background: "#dc2626" }}>
                  {deleteModal.busy ? "Deleting…" : "Delete machine"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {holdModal && (() => {
        const m = holdModal.machine;
        const submit = async () => {
          if (holdModal.busy) return;
          const why = holdModal.reason.trim();
          if (!holdModal.release && !why) { setHoldModal((prev) => prev ? { ...prev, error: "Write why the machine is being put on hold." } : prev); return; }
          setHoldModal((prev) => prev ? { ...prev, busy: true, error: "" } : prev);
          const r = await onSetMachineHold({ machineId: m.id, hold: !holdModal.release, reason: why });
          if (r && r.success === false) { setHoldModal((prev) => prev ? { ...prev, busy: false, error: r.error || "Could not save." } : prev); return; }
          setHoldModal(null);
          showToast(`${m.bomKey}${m.serialNo ? ` · S/N ${m.serialNo}` : ""} ${holdModal.release ? "released from hold" : "put ON HOLD"}`);
        };
        return (
          <div data-hold-modal className="modal-backdrop fixed inset-0 z-[72] flex items-center justify-center p-4"
               style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(12px)" }}
               onClick={(e) => e.target === e.currentTarget && !holdModal.busy && setHoldModal(null)}>
            <div className="w-full max-w-md rounded-2xl p-5" style={{ background: "var(--surface-raised)", border: "1px solid rgba(239,68,68,0.35)", boxShadow: "0 24px 70px rgba(17,24,39,0.2)" }}>
              <h3 className="text-base font-black text-slate-800 mb-1">{holdModal.release ? "Release ON HOLD" : "Put machine ON HOLD"}</h3>
              <p className="text-[11px] text-slate-500 mb-3">{m.bomKey}{m.serialNo ? ` · S/N ${m.serialNo}` : ""} · now in {m.currentDepartment || m.stage}</p>
              {holdModal.release ? (
                <p className="text-[11px] text-slate-600 mb-3">On hold since {m.holdAt ? new Date(m.holdAt).toLocaleString() : "—"}: {m.holdReason || "no reason recorded"}. Releasing lets the machine be finished, transferred and accepted again.</p>
              ) : (
                <p className="text-[13px] text-slate-600 mb-3">Machine stops here until released.</p>
              )}
              <label className="block text-[11px] font-bold text-slate-600 mb-1">{holdModal.release ? "Note (optional)" : <>Reason <span className="text-red-500">*</span></>}</label>
              <textarea data-hold-reason rows={2} value={holdModal.reason} disabled={holdModal.busy} autoFocus
                        onChange={(e) => setHoldModal((prev) => prev ? { ...prev, reason: e.target.value, error: "" } : prev)}
                        placeholder={holdModal.release ? "e.g. motor arrived" : "e.g. waiting for motor; quality check"}
                        className="w-full rounded-lg px-3 py-2.5 text-[13px] text-slate-800 outline-none"
                        style={{ background: "var(--surface-elevated)", border: "1px solid rgba(17,24,39,0.12)" }} />
              {holdModal.error && <div className="mt-3 text-[11px] font-bold px-3 py-2 rounded-lg" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.4)", color: "#dc2626" }}>{holdModal.error}</div>}
              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => setHoldModal(null)} disabled={holdModal.busy} className="flex-1 h-11 rounded-lg text-[13px] font-bold text-slate-600 border transition-all disabled:opacity-40" style={{ borderColor: "rgba(17,24,39,0.12)" }}>Cancel</button>
                <button data-needs-net type="button" data-hold-confirm onClick={submit} disabled={holdModal.busy} className="flex-[2] min-h-[48px] rounded-xl text-[14px] font-black text-white transition-all disabled:opacity-50" style={{ background: holdModal.release ? "#15803d" : "#dc2626", color: "#ffffff" }}>
                  <LeadLabel text={holdModal.busy ? "Saving…" : holdModal.release ? "▶ Release ON HOLD" : "⏸ Put ON HOLD"} />
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {pullBack && (() => {
        const h = pullBack.handover;
        const submit = async () => {
          if (pullBack.busy) return;
          if (!pullBack.reason.trim()) { setPullBack((prev) => prev ? { ...prev, error: "Write the reason for pulling this machine back." } : prev); return; }
          setPullBack((prev) => prev ? { ...prev, busy: true, error: "" } : prev);
          const r = await onPullBackHandover({ handoverId: h.id, reason: pullBack.reason.trim() });
          if (r && r.success === false) { setPullBack((prev) => prev ? { ...prev, busy: false, error: r.error || "Could not pull back." } : prev); return; }
          setPullBack(null);
          showToast(`${h.bomKey}${h.serialNo ? ` · S/N ${h.serialNo}` : ""} pulled back`, `Stays in ${h.fromDepartment} · hand-over to ${h.toDepartment} cancelled`);
        };
        return (
          <div className="modal-backdrop fixed inset-0 z-[72] flex items-center justify-center p-4"
               style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(12px)" }}
               onClick={(e) => e.target === e.currentTarget && !pullBack.busy && setPullBack(null)}>
            <div className="w-full max-w-md rounded-2xl p-5" style={{ background: "var(--surface-raised)", border: "1px solid rgba(239,68,68,0.35)", boxShadow: "0 24px 70px rgba(17,24,39,0.2)" }}>
              <h3 className="text-base font-black text-slate-800 mb-1">Pull back from {h.toDepartment}</h3>
              <p className="text-[11px] text-slate-500 mb-3">{h.bomKey}{h.serialNo ? ` · S/N ${h.serialNo}` : ""} · sent by {h.fromDepartment}</p>
              <p className="text-[11px] text-slate-600 mb-3">The hand-over to {h.toDepartment} is cancelled and the machine stays with {h.fromDepartment}, which can finish and transfer it again. The cancelled hand-over and your reason stay in the history.</p>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">Reason <span className="text-red-500">*</span></label>
              <textarea rows={2} value={pullBack.reason} disabled={pullBack.busy} autoFocus
                        onChange={(e) => setPullBack((prev) => prev ? { ...prev, reason: e.target.value, error: "" } : prev)}
                        placeholder="e.g. sent to the wrong department; work not finished"
                        className="w-full rounded-lg px-3 py-2.5 text-[13px] text-slate-800 outline-none"
                        style={{ background: "var(--surface-elevated)", border: "1px solid rgba(17,24,39,0.12)" }} />
              {pullBack.error && <div className="mt-3 text-[11px] font-bold px-3 py-2 rounded-lg" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.4)", color: "#dc2626" }}>{pullBack.error}</div>}
              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => setPullBack(null)} disabled={pullBack.busy} className="flex-1 h-11 rounded-lg text-[13px] font-bold text-slate-600 border transition-all disabled:opacity-40" style={{ borderColor: "rgba(17,24,39,0.12)" }}>Cancel</button>
                <button type="button" onClick={submit} disabled={pullBack.busy} className="flex-[2] min-h-[48px] rounded-xl text-[14px] font-black text-white transition-all disabled:opacity-50" style={{ background: "#dc2626", color: "#ffffff" }}>
                  {pullBack.busy ? "Pulling back…" : "↩ Pull back machine"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Sender Undo (2026-11-03, owner-approved) ── the worker who sent the
          machine takes it back within 5 minutes, before it is accepted. Same
          path as the admin Pull back (onPullBackHandover), re-checked on a
          fresh read inside the handler. */}
      {rackSendAsk && (() => {
        const yes = async () => {
          if (rackSendAsk.busy) return;
          setRackSendAsk((prev) => prev ? { ...prev, busy: true } : prev);
          try { await rackSendAsk.run(); } finally { setRackSendAsk(null); }
        };
        // zIndex inline: .modal-backdrop is z 50 in index.css, and this must
        // sit above the rack panel (z 65) it can be opened from.
        return (
          <div className="modal-backdrop fixed inset-0 z-[75] flex items-end sm:items-center justify-center p-3 sm:p-4" data-rack-send-ask
               style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(12px)", zIndex: 75 }}
               onClick={(e) => e.target === e.currentTarget && !rackSendAsk.busy && setRackSendAsk(null)}>
            <div role="dialog" aria-modal="true" aria-label="Confirm send" className="w-full max-w-md rounded-2xl p-5" style={{ background: "var(--surface-raised)", border: "1px solid rgba(21,128,61,0.45)", boxShadow: "0 24px 70px rgba(17,24,39,0.2)", paddingBottom: "max(20px, env(safe-area-inset-bottom))" }}>
              <h3 className="text-[17px] font-black" style={{ color: "var(--text-strong)" }}>Are you sure?</h3>
              <p className="text-[15px] font-semibold mt-1" style={{ color: "var(--text-strong)" }}>Send {rackSendAsk.name} to {rackSendAsk.to}?</p>
              <p className="text-[12.5px] mt-1" style={{ color: "var(--text-dim)" }}>The rack becomes empty.</p>
              <div className="flex gap-2 mt-4">
                <button type="button" data-rack-send-no onClick={() => setRackSendAsk(null)} disabled={rackSendAsk.busy}
                        className="flex-1 min-h-[48px] rounded-xl text-[15px] font-bold border transition-all active:scale-[0.97] disabled:opacity-40"
                        style={{ borderColor: "rgba(17,24,39,0.15)", color: "#334155" }}>No</button>
                <button data-needs-net type="button" data-rack-send-yes onClick={yes} disabled={rackSendAsk.busy}
                        className="flex-[2] min-h-[48px] rounded-xl text-[15px] font-black text-white transition-all active:scale-[0.97] disabled:opacity-80"
                        style={{ background: "#15803d" }}>
                  {rackSendAsk.busy ? "⏳ Please wait…" : `Yes, send to ${rackSendAsk.to}`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {undoAsk && (() => {
        const h = undoAsk.handover;
        const name = `${h.bomKey || "Machine"}${h.serialNo ? ` · ${h.serialNo}` : ""}`;
        const yes = async () => {
          if (undoAsk.busy) return;
          setUndoAsk((prev) => prev ? { ...prev, busy: true } : prev);
          const r = await onPullBackHandover({ handoverId: h.id, bySender: true });
          setUndoAsk(null);
          if (r && r.success === false) { showToast("Cannot undo", r.error || "Could not take it back.", "urgent"); return; }
          showToast("Taken back", `${name} is back in ${h.fromDepartment}`);
        };
        return (
          <div className="modal-backdrop fixed inset-0 z-[72] flex items-end sm:items-center justify-center p-3 sm:p-4" data-sender-undo-ask
               style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(12px)" }}
               onClick={(e) => e.target === e.currentTarget && !undoAsk.busy && setUndoAsk(null)}>
            <div className="w-full max-w-md rounded-2xl p-5" style={{ background: "var(--surface-raised)", border: "1px solid rgba(245,158,11,0.5)", boxShadow: "0 24px 70px rgba(17,24,39,0.2)", paddingBottom: "max(20px, env(safe-area-inset-bottom))" }}>
              <h3 className="text-[17px] font-black" style={{ color: "var(--text-strong)" }}>Are you sure?</h3>
              <p className="text-[15px] font-semibold mt-1" style={{ color: "var(--text-strong)" }}>Take {name} back from {h.toDepartment}?</p>
              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => setUndoAsk(null)} disabled={undoAsk.busy}
                        className="flex-1 min-h-[48px] rounded-xl text-[15px] font-bold border transition-all active:scale-[0.97] disabled:opacity-40"
                        style={{ borderColor: "rgba(17,24,39,0.15)", color: "#334155" }}>No</button>
                <button data-needs-net type="button" data-sender-undo-yes onClick={yes} disabled={undoAsk.busy}
                        className="flex-[2] min-h-[48px] rounded-xl text-[15px] font-black transition-all active:scale-[0.97] disabled:opacity-80"
                        style={{ background: "#f59e0b", color: "#1f1300" }}>
                  {undoAsk.busy ? "⏳ Please wait…" : "Yes, take it back"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Pending job action (2026-10-30): part received / work completed ── */}
      {/* 2026-10-31 — Pending Jobs drawer for one machine (opened from its
          card). Same rows and actions as the Pending Jobs tab; closes itself
          when the machine has no job left. */}
      {jobsDrawer != null && (() => {
        const m = machineLog.find((x) => String(x.id) === String(jobsDrawer)) || null;
        const all = (pendingHandoverItems || []).filter((p) => String(p.machineId) === String(jobsDrawer));
        const open = all.filter(pendingItemIsOpen);
        const done = all.filter(pendingItemIsDone);
        const openPartsN = open.filter(pendingItemIsPart).length;
        return (
          <div className="rack-panel-backdrop fixed inset-0 z-[66] flex justify-end" style={{ background: "rgba(17,24,39,0.35)", pointerEvents: jobAction ? "none" : "auto" }}
               onClick={(e) => e.target === e.currentTarget && !jobAction && setJobsDrawer(null)}>
            <div role="dialog" aria-label={`Pending jobs for ${m?.serialNo || m?.bomKey || "machine"}`} data-jobs-drawer className="rack-panel h-full w-full max-w-[640px] flex flex-col" style={{ background: "var(--surface-card)", boxShadow: "-20px 0 60px rgba(17,24,39,0.25)" }}>
              <div className="px-4 sm:px-5 py-4 flex items-center justify-between gap-3" style={{ background: "#b91c1c", color: "#fff" }}>
                <div>
                  <div className="text-[17px] font-black"><LeadIcon e="⏳" />Pending Jobs · {m?.bomKey || "Machine"}{m?.serialNo ? ` · S/N ${m.serialNo}` : ""}</div>
                  <div className="text-[11px] opacity-90">{openPartsN} part{openPartsN === 1 ? "" : "s"} · {open.length - openPartsN} work pending · {done.length} completed · now in {m?.status === "completed" ? "Ready" : (m?.currentDepartment || m?.stage || "—")}</div>
                </div>
                <button type="button" aria-label="Close" onClick={() => setJobsDrawer(null)} className="w-9 h-9 rounded-lg text-[18px] font-black" style={{ background: "rgba(255,255,255,0.18)", color: "#fff" }}>✕</button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
                {renderJobBoard(all, { detailsKey: "drawer-completed" })}
              </div>
            </div>
          </div>
        );
      })()}

      {jobAction && (() => {
        const p = jobAction.item;
        const m = machineLog.find((x) => String(x.id) === String(p.machineId)) || null;
        const isReceive = jobAction.action === "receive";
        // 2026-10-31 — Part received asks for what the Item Master configures
        // for THIS item: a critical "serial" item needs one unique serial per
        // unit, a critical "checkbox" item its physical verification tick (plus
        // its check points for reference), a normal item the department's
        // physically-received tick. Nothing is recorded until that is given.
        const inv = p.itemCode ? Object.values(items || {}).flatMap((l) => Array.isArray(l) ? l : []).find((i) => i && i.code === p.itemCode) || null : null;
        // 2026-11-02 — a receipt is for the quantity that ACTUALLY arrived (it
        // can be less than what is pending; the rest stays pending). Only that
        // quantity goes into stock, and every receipt is kept as its own record.
        const remaining = pendingItemRemaining(p);
        const qtyText = jobAction.qtyText ?? (remaining != null ? String(remaining) : "");
        const recvQty = Number(qtyText);
        const qtyProblem = !isReceive ? "" : (qtyText === "" || !Number.isFinite(recvQty) || recvQty <= 0) ? "Enter the quantity that was actually received."
          : (remaining != null && recvQty > remaining) ? `Only ${remaining} is still pending — you entered ${recvQty}.` : "";
        // Critical = the Item Master says so, or the operator classified the
        // pending item as Critical when raising it (a manual item).
        const critical = !!(inv && inv.isCritical) || !!p.critical;
        const inputType = inv && inv.isCritical && inv.outwardInputType === "serial" ? "serial" : "checkbox";
        const checkPoints = inv && Array.isArray(inv.checkPoints) ? inv.checkPoints : [];
        const serialCount = qtyProblem || !Number.isInteger(recvQty) ? 0 : Math.min(500, recvQty);
        const serials = (jobAction.serials || []).map((x) => String(x || "").trim());
        // Serials already recorded on ANY receipt or issued on any machine.
        const priorSerials = new Set([
          ...(pendingHandoverItems || []).flatMap((x) => (x.receipts || []).flatMap((r) => (r.verification && r.verification.serials) || [])),
          ...(outwardLog || []).flatMap((e) => (e.items || []).flatMap((it) => (it.criticalInput?.serials) || [])),
        ].map((x) => String(x || "").trim().toLowerCase()).filter(Boolean));
        const serialProblem = (() => {
          const filled = serials.slice(0, serialCount).filter(Boolean);
          const lower = filled.map((x) => x.toLowerCase());
          if (new Set(lower).size !== lower.length) return "Each unit needs a different serial number.";
          const used = lower.find((x) => priorSerials.has(x));
          if (used) return `Serial "${used}" has already been recorded.`;
          if (critical && inputType === "serial") {
            if (qtyProblem) return "";
            if (!Number.isInteger(recvQty)) return "A serial-numbered item is received in whole units.";
            if (filled.length < serialCount) return `Enter all ${serialCount} serial number${serialCount === 1 ? "" : "s"} for ${inv.name || p.itemCode}.`;
          }
          return "";
        })();
        const receiveReady = !isReceive || p.receivedAt || (!qtyProblem && !serialProblem && (critical && inputType === "serial" ? true : !!jobAction.verified));
        const receiveWhy = !isReceive || receiveReady ? "" : (qtyProblem || serialProblem || (critical ? "Tick the physical verification for this critical item." : "Tick that the part was physically received and checked."));
        // 2026-11-03 — Work completed (work / comment jobs) needs a remark; a
        // part job is never completed here — receiving the part completes it.
        const remarkMissing = !isReceive && !String(jobAction.notes || "").trim();
        const partNotReceived = !isReceive && pendingItemIsPart(p) && !p.receivedAt;
        const blocked = !jobAction.busy && ((isReceive && !receiveReady) || remarkMissing || partNotReceived);
        // Owner's rule: no long message — the box that still needs filling turns red.
        const flagMissing = () => {
          setJobAction((prev) => prev && !prev.tried ? { ...prev, tried: true } : prev);
          if (isReceive) flagField(qtyProblem ? "[data-receive-qty-box]" : "[data-receive-verify]");
          else if (remarkMissing) flagField("[data-job-remark]");
        };
        const submit = async () => {
          if (jobAction.busy) return;
          if (isReceive && !receiveReady) { setJobAction((prev) => prev ? { ...prev, error: receiveWhy } : prev); flagMissing(); return; }
          if (partNotReceived) { setJobAction((prev) => prev ? { ...prev, error: "A part job is completed by receiving the part — use Part received." } : prev); return; }
          if (remarkMissing) { flagMissing(); return; }
          setJobAction((prev) => prev ? { ...prev, busy: true, error: "" } : prev);
          const filledSerials = serials.slice(0, serialCount).filter(Boolean);
          const verification = isReceive && !p.receivedAt
            ? (critical && inputType === "serial"
                ? { kind: "serial", critical: true, serials: filledSerials }
                : { kind: "checkbox", critical, verified: true, checkPoints, ...(filledSerials.length ? { serials: filledSerials } : {}) })
            : null;
          const r = isReceive
            ? await onReceivePendingItem(p.id, { qty: recvQty, notes: jobAction.notes.trim(), verification })
            : await onResolvePendingItem(p.id, { notes: jobAction.notes.trim() });
          if (r && r.success === false) { setJobAction((prev) => prev ? { ...prev, busy: false, error: r.error || "Could not save." } : prev); return; }
          setJobAction(null);
          showToast(isReceive ? (r && r.fullyReceived === false ? `Received ${recvQty} · ${r.remainingQty} still pending` : r && r.completed ? "Part received · job completed" : "Part received") : "Work completed",
                    `${m?.bomKey || ""}${m?.serialNo ? ` · S/N ${m.serialNo}` : ""}${p.itemCode ? ` · ${p.itemCode}` : p.itemName ? ` · ${p.itemName}` : ""}${isReceive && r && r.stockInwarded ? ` · ${recvQty} added to stock` : ""}`);
        };
        return (
          <div className="modal-backdrop fixed inset-0 z-[96] flex items-center justify-center p-4"
               /* .modal-backdrop in index.css sets z-index: 50 and wins over
                  the z-[96] utility by source order, so the popup could sit
                  under the Pending Jobs drawer (66) / rack panel (65). The
                  inline value beats both stylesheets. */
               style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(12px)", zIndex: 96 }}
               onClick={(e) => e.target === e.currentTarget && !jobAction.busy && setJobAction(null)}>
            <div className="relative w-full max-w-md rounded-2xl p-5"
                 style={{ background: "var(--surface-raised)", border: `1px solid ${isReceive ? "rgba(37,99,235,0.35)" : "rgba(22,163,74,0.35)"}`, boxShadow: "0 24px 70px rgba(17,24,39,0.2)" }}>
              <ModalX onClose={() => setJobAction(null)} disabled={!!jobAction.busy} />
              <h3 className="text-base font-black text-slate-800 mb-1">{isReceive ? "Part received" : "Work completed"}</h3>
              <p className="text-[11px] text-slate-500 mb-3">
                {m?.bomKey || "Machine"}{m?.serialNo ? ` · S/N ${m.serialNo}` : ""}{p.assignedDepartment ? ` · ${p.assignedDepartment}` : ""}
              </p>
              <div className="rounded-lg px-3 py-2 mb-3 text-[11.5px] text-slate-700" style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.08)" }}>
                <div className="font-semibold">{p.description}</div>
                {p.itemCode && <div className="text-[10.5px] text-slate-500 mt-0.5">Part <span className="font-mono font-bold text-slate-700">{p.itemCode}</span>{p.itemName ? ` · ${p.itemName}` : ""}{p.qty != null ? ` · qty ${p.qty}` : ""}</div>}
                <JobHistory item={p} users={allUsers} compact />
              </div>
              {isReceive && !p.receivedAt && (
                <p className="text-[11px] text-slate-600 mb-2">Records the part arriving for this machine. When the full quantity has arrived, the job is completed.</p>
              )}
              {isReceive && !p.receivedAt && (
                <div data-receive-qty-box className="rounded-lg px-3 py-2.5 mb-3" style={{ background: "rgba(37,99,235,0.05)", border: "1px solid rgba(37,99,235,0.3)" }}>
                  <div className="text-[11px] text-slate-600 mb-1.5">
                    {p.qty != null
                      ? <>Ordered / pending <b>{p.qty}</b> · received so far <b>{Number(p.receivedQty) || 0}</b> · still pending <b>{remaining}</b></>
                      : <>No quantity was recorded on this job — enter what arrived.</>}
                  </div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Quantity received now <span className="text-red-500">*</span></label>
                  <input type="number" min="0" step="any" inputMode="decimal" data-receive-qty value={qtyText} disabled={jobAction.busy}
                         onChange={(e) => setJobAction((prev) => prev ? { ...prev, qtyText: e.target.value, error: "" } : prev)}
                         className="w-32 rounded-lg px-3 py-2 text-[14px] font-bold text-slate-900 outline-none"
                         style={{ background: "var(--surface-elevated)", border: "1px solid rgba(37,99,235,0.4)" }} />
                  {!qtyProblem && remaining != null && recvQty < remaining && (
                    <span data-receive-left className="ml-2 text-[11px] font-semibold text-slate-600">{remaining - recvQty} will stay pending</span>
                  )}
                  <div className="text-[10.5px] text-slate-500 mt-1.5">
                    {p.itemCode && inv
                      ? <>Only this quantity is added to stock ({inv.name}). The rest stays pending and can be received later.</>
                      : <>Not in the Item Master — the receipt is recorded on the job, no stock is changed.</>}
                  </div>
                  {qtyProblem && jobAction.tried && <div data-receive-qty-error className="text-[10.5px] font-semibold mt-1" style={{ color: "#dc2626" }}>{qtyProblem}</div>}
                </div>
              )}
              {isReceive && !p.receivedAt && (
                <div data-receive-verify={critical ? inputType : "normal"} className="rounded-lg px-3 py-2.5 mb-3 space-y-2" style={{ background: critical ? "rgba(239,68,68,0.05)" : "rgba(21,128,61,0.05)", border: `1px solid ${critical ? "rgba(239,68,68,0.3)" : "rgba(21,128,61,0.3)"}` }}>
                  <div className="text-[11px] font-black" style={{ color: critical ? "#b91c1c" : "#15803d" }}>
                    {critical ? `CRITICAL ITEM · ${inputType === "serial" ? "serial number per unit" : "physical verification"}` : "Physical receipt check"}
                    {p.itemCode && !inv && <span className="ml-1 font-semibold text-slate-500">(not in Item Master)</span>}
                  </div>
                  {checkPoints.length > 0 && (
                    <ul className="text-[11px] text-slate-700 space-y-0.5">
                      {checkPoints.map((cp, i) => <li key={i} className="flex gap-1.5"><span className="text-slate-400">•</span>{cp}</li>)}
                    </ul>
                  )}
                  {checkPoints.length === 0 && p.criticalChecks && Array.isArray(p.criticalChecks.points) && p.criticalChecks.points.length > 0 && (
                    <ul data-receive-saved-checks className="text-[11px] text-slate-700 space-y-0.5">
                      {p.criticalChecks.points.map((cp, i) => <li key={i} className="flex gap-1.5"><span className="text-slate-400">{cp.ok ? "✓" : "☐"}</span>{cp.text}</li>)}
                    </ul>
                  )}
                  {critical && inputType === "serial" ? (
                    <div className="grid grid-cols-2 gap-1.5">
                      {Array.from({ length: serialCount }).map((_, idx) => (
                        <input key={idx} value={serials[idx] || ""} disabled={jobAction.busy} data-receive-serial={idx}
                               onChange={(e) => setJobAction((prev) => { if (!prev) return prev; const next = (prev.serials || []).slice(); next[idx] = e.target.value; return { ...prev, serials: next, error: "" }; })}
                               placeholder={`${inv.name || p.itemCode} serial #${idx + 1}`}
                               className="rounded-md px-2 py-1.5 text-[12px] text-slate-900 outline-none"
                               style={{ background: "var(--surface-elevated)", border: "1px solid rgba(17,24,39,0.15)" }} />
                      ))}
                    </div>
                  ) : (
                    <>
                      <label className="flex items-start gap-2 cursor-pointer text-[11.5px] text-slate-800">
                        <input type="checkbox" data-receive-check checked={!!jobAction.verified} disabled={jobAction.busy}
                               onChange={(e) => setJobAction((prev) => prev ? { ...prev, verified: e.target.checked, error: "" } : prev)}
                               className="w-4 h-4 mt-0.5 accent-emerald-600" />
                        <span>{critical
                          ? `I have physically verified ${recvQty > 1 ? `all ${recvQty} units of ` : ""}${(inv && inv.name) || p.itemName || p.itemCode || p.description || "this part"} for this machine.`
                          : `${p.assignedDepartment || "The department"} has physically received and checked ${(inv && inv.name) || p.itemName || p.itemCode || p.description || "this part"}${recvQty > 1 ? ` (${recvQty})` : ""}.`}</span>
                      </label>
                      {/* A critical item with no serial rule in the Item Master
                          (a manually named part): serials can still be typed
                          in, one per unit — optional, not required. */}
                      {critical && serialCount > 0 && serialCount <= 50 && (
                        <div data-receive-serials-manual>
                          <div className="text-[10.5px] text-slate-500 mb-1">Serial numbers (optional — one per unit, if the part has them)</div>
                          <div className="grid grid-cols-2 gap-1.5">
                            {Array.from({ length: serialCount }).map((_, idx) => (
                              <input key={idx} value={serials[idx] || ""} disabled={jobAction.busy} data-receive-serial={idx}
                                     onChange={(e) => setJobAction((prev) => { if (!prev) return prev; const next = (prev.serials || []).slice(); next[idx] = e.target.value; return { ...prev, serials: next, error: "" }; })}
                                     placeholder={`serial #${idx + 1}`}
                                     className="rounded-md px-2 py-1.5 text-[12px] text-slate-900 outline-none"
                                     style={{ background: "var(--surface-elevated)", border: "1px solid rgba(17,24,39,0.15)" }} />
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  {receiveWhy && !qtyProblem && <div className="text-[10.5px] font-semibold" style={{ color: "#b45309" }}>{receiveWhy}</div>}
                </div>
              )}
              {!isReceive && (p.itemCode || p.itemName) && !p.receivedAt && (
                <p className="text-[11px] font-bold mb-2" style={{ color: "#b45309" }}>This part has not been recorded as received. Mark it completed only if the work is actually done.</p>
              )}
              <label className="block text-[11px] font-bold text-slate-600 mb-1">{isReceive ? "Receive remark / reason (optional)" : <>Completion remark <span className="text-red-500">*</span></>}</label>
              {(() => {
                const remarkBox = (
                  <input value={jobAction.notes} disabled={jobAction.busy} autoFocus data-job-remark={isReceive ? undefined : ""}
                         onChange={(e) => setJobAction((prev) => prev ? { ...prev, notes: e.target.value, error: "" } : prev)}
                         onKeyDown={(e) => e.key === "Enter" && submit()}
                         placeholder={isReceive ? "e.g. received from Stores, 2 pcs — replacement for the damaged cover" : "e.g. fitted and tested"}
                         className="w-full rounded-lg px-3 py-2.5 text-[13px] text-slate-800 outline-none"
                         style={{ background: "var(--surface-elevated)", border: "1px solid rgba(17,24,39,0.12)" }} />
                );
                // 2026-11-03 — the 🎤 is a small icon inside the remark box.
                return !isReceive && canVoice ? (
                  <div data-job-remark-voice>
                    <VoiceNoteRecorder place="Work completed" item={p.description || ""}
                                       disabled={!!jobAction.busy} setText={(fn) => setJobAction((prev) => prev ? { ...prev, notes: fn(prev.notes || ""), error: "" } : prev)}>{remarkBox}</VoiceNoteRecorder>
                  </div>
                ) : remarkBox;
              })()}
              {jobAction.error && (
                <div className="mt-3 text-[11px] font-bold px-3 py-2 rounded-lg" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.4)", color: "#dc2626" }}>{jobAction.error}</div>
              )}
              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => setJobAction(null)} disabled={jobAction.busy}
                        className="mt-cancel flex-1 h-11 rounded-lg text-[13px] font-bold text-slate-600 border transition-all disabled:opacity-40" style={{ borderColor: "rgba(17,24,39,0.12)" }}>
                  Cancel
                </button>
                <span className="flex-[2] flex" onClick={() => { if (blocked) flagMissing(); }}>
                <button data-needs-net type="button" data-job-submit onClick={submit} disabled={jobAction.busy || (isReceive && !receiveReady) || remarkMissing || partNotReceived}
                        title={isReceive && !receiveReady ? receiveWhy : remarkMissing ? "Write what was done" : ""}
                        className="flex-1 min-h-[48px] rounded-xl text-[14px] font-black text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ background: isReceive ? "#1d4ed8" : "linear-gradient(135deg,#16a34a,#15803d)", color: "#ffffff", pointerEvents: blocked ? "none" : undefined }}>
                  {jobAction.busy ? "⏳ Please wait…" : isReceive ? (remaining != null && recvQty > 0 && recvQty < remaining ? `✓ Receive ${recvQty} · ${remaining - recvQty} stays pending` : "✓ Part received") : "✓ Work completed"}
                </button>
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 1 — Report Issue Modal ──
          Raises a pending item against the department that must come and fix
          it. The machine does not move; the responsible department is called
          to it. Tracking only — it never blocks Finish & Transfer. */}
      {raiseModal && (() => {
        const m = raiseModal.machine;
        const here = m.currentDepartment || m.stage;
        // Any production department except the one reporting — you do not call
        // yourself. "BOM Issued" and "Ready" are not departments that do work.
        const deptChoices = DEPARTMENT_SEQUENCE.filter(
          (d) => d !== "BOM Issued" && d !== "Ready" && d !== here
        );
        const submit = async () => {
          const desc = raiseText.trim();
          if (!desc)      { setRaiseErr("Describe the issue."); return; }
          if (!raiseDept) { setRaiseErr("Choose the department that must fix it."); return; }
          setRaiseBusy(true); setRaiseErr("");
          const part = cleanPendingJobs([{ ...raisePart, description: desc }])[0] || {};
          const r = await onRaisePendingItem({
            machineId: m.id, description: desc,
            assignedDepartment: raiseDept, raisedInDepartment: here,
            itemCode: part.itemCode || "", itemName: part.itemName || "", qty: part.qty ?? null, reason: part.reason || "",
          });
          setRaiseBusy(false);
          if (r && r.success === false) { setRaiseErr(r.error || "Could not save the issue."); return; }
          setRaiseModal(null);
          showToast(`${m.bomKey}${m.serialNo ? ` — ${m.serialNo}` : ""}`, `${raiseDept} called · issue is tracked in Pending Jobs`, "urgent");
        };
        return (
        <div className="modal-backdrop fixed inset-0 z-[70] flex items-center justify-center p-4"
             style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(12px)" }}
             onClick={(e) => { if (e.target === e.currentTarget && !raiseBusy) { setRaiseModal(null); } }}>
          <div className="relative w-full max-w-lg rounded-2xl p-6"
               style={{ background: "var(--surface-raised)", border: "1px solid rgba(239,68,68,0.35)", boxShadow: "0 24px 70px rgba(17,24,39,0.2)" }}>
            <ModalX disabled={raiseBusy} onClose={() => { setRaiseModal(null); }} />
            <h3 className="text-base font-black text-slate-800 mb-1">Report an issue</h3>
            <p className="text-[11px] text-slate-500 mb-4">
              {m.bomKey}{m.serialNo ? ` · S/N ${m.serialNo}` : ""} · in {here}
            </p>

            <label htmlFor="raise-desc" className="block text-[11px] font-bold text-slate-600 mb-1.5">
              What is wrong
            </label>
            {(() => {
              const issueBox = (
                <textarea id="raise-desc" rows={3} value={raiseText} disabled={raiseBusy}
                          onChange={(e) => setRaiseText(e.target.value)}
                          placeholder="e.g. noise coming from the gearbox"
                          className="w-full rounded-lg px-3 py-2.5 pr-12 text-[13px] text-slate-800 outline-none resize-y"
                          style={{ background: "var(--surface-elevated)", border: "1px solid rgba(17,24,39,0.12)" }} />
              );
              // 2026-11-04 — the same small 🎤 as every other box: writes text only.
              return <VoiceNoteRecorder place="Report Issue" setText={setRaiseText} disabled={raiseBusy}>{issueBox}</VoiceNoteRecorder>;
            })()}

            {/* 2026-10-30 — optional missing part, so the job is traceable. */}
            <div className="block text-[11px] font-bold text-slate-600 mt-4 mb-1.5">Missing part (optional)</div>
            <div className="grid grid-cols-[1fr_72px] sm:grid-cols-[150px_72px_1fr] gap-1.5">
              {inventoryFlat.length > 0 && (
                <datalist id="raise-part-codes">
                  {inventoryFlat.slice(0, 2000).map((it) => <option key={it.code} value={it.code}>{it.name}</option>)}
                </datalist>
              )}
              <input value={raisePart.itemCode} disabled={raiseBusy} list={inventoryFlat.length ? "raise-part-codes" : undefined}
                     onChange={(e) => { const code = e.target.value; const hit = inventoryFlat.find((it) => it.code.toLowerCase() === code.trim().toLowerCase()); setRaisePart((p) => ({ ...p, itemCode: code, itemName: hit ? hit.name : p.itemName })); }}
                     placeholder="Part / item code" className="min-w-0 w-full rounded-lg px-2.5 py-2 text-[12px] text-slate-800 outline-none"
                     style={{ background: "var(--surface-elevated)", border: "1px solid rgba(17,24,39,0.12)" }} />
              <input type="number" min="0" step="any" value={raisePart.qty} disabled={raiseBusy}
                     onChange={(e) => setRaisePart((p) => ({ ...p, qty: e.target.value }))}
                     placeholder="Qty" className="min-w-0 w-full rounded-lg px-2.5 py-2 text-[12px] text-slate-800 outline-none text-right"
                     style={{ background: "var(--surface-elevated)", border: "1px solid rgba(17,24,39,0.12)" }} />
              <input value={raisePart.reason} disabled={raiseBusy}
                     onChange={(e) => setRaisePart((p) => ({ ...p, reason: e.target.value }))}
                     placeholder="Reason — e.g. not in store, on order"
                     className="col-span-2 sm:col-span-1 min-w-0 w-full rounded-lg px-2.5 py-2 text-[12px] text-slate-800 outline-none"
                     style={{ background: "var(--surface-elevated)", border: "1px solid rgba(17,24,39,0.12)" }} />
            </div>
            {raisePart.itemName && <div className="text-[10px] text-slate-500 mt-1">{raisePart.itemName}</div>}

            <label htmlFor="raise-dept" className="block text-[11px] font-bold text-slate-600 mt-4 mb-1.5">
              Which department must fix it
            </label>
            <select id="raise-dept" value={raiseDept} disabled={raiseBusy}
                    onChange={(e) => setRaiseDept(e.target.value)}
                    className="w-full rounded-lg px-3 h-11 text-[13px] text-slate-800 outline-none"
                    style={{ background: "var(--surface-elevated)", border: "2px solid rgba(239,68,68,0.45)" }}>
              <option value="">— choose —</option>
              {deptChoices.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>

            <p className="text-[11px] text-slate-500 mt-3">
              Tracked until fixed — it never blocks Finish &amp; Transfer.
            </p>

            {raiseErr && (
              <div className="mt-3 text-[11px] font-bold px-3 py-2 rounded-lg"
                   style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.4)", color: "#dc2626" }}>
                {raiseErr}
              </div>
            )}

            <div className="flex gap-2 mt-5">
              <button type="button" onClick={() => { setRaiseModal(null); }} disabled={raiseBusy}
                      className="mt-cancel flex-1 h-11 rounded-lg text-[13px] font-bold text-slate-600 border transition-all disabled:opacity-40"
                      style={{ borderColor: "rgba(17,24,39,0.12)" }}>
                Cancel
              </button>
              <button type="button" onClick={submit} disabled={raiseBusy} data-raise-send
                      className="flex-[2] min-h-[48px] rounded-xl text-[14px] font-black text-slate-900 transition-all disabled:opacity-50"
                      style={{ background: "#2E50D6", color: "#ffffff" }}>
                {raiseBusy ? "Sending…" : (raiseDept ? `Call ${raiseDept}` : "Send")}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* ── Start Production Modal ── */}
      {fillSlot && (() => {
        const f = fillSlot.family;
        const famBoms = rackBomsFor(f);
        const famValid = famBoms.filter((b) => b.valid);
        const famKeys = famValid.map((b) => b.key);
        const candidates = rackView
          .filter((m) => m.status !== "completed" && m.stage === "BOM Issued" && physicalRackFamily(m.bomKey)?.id === f.id && m.rackSlot !== fillSlot.slotId)
          // Only sets of a valid mapped BOM may be placed (brief: no incompatible BOMs).
          .filter((m) => famKeys.includes(m.bomKey))
          .sort((a, b) => (a.createdDate || "").localeCompare(b.createdDate || ""));
        return (
        <div className="modal-backdrop fixed inset-0 z-[70] flex items-center justify-center p-4"
             style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(12px)" }}
             onClick={(e) => e.target === e.currentTarget && setFillSlot(null)}>
          <div className="w-full max-w-md rounded-2xl p-6 space-y-4"
               style={{ background: "var(--surface-elevated)", border: `1px solid ${f.color}66`, boxShadow: "0 40px 80px rgba(17,24,39,0.22)" }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg" style={{ background: f.color + "22", color: f.color }}>＋</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-black" style={{ color: "var(--text-strong)" }}>Fill {slotLabel(fillSlot.slotId)}</div>
                <div className="text-[10px] mt-0.5" style={{ color: "var(--text-dim)" }}>
                  {famValid.length
                    ? `Mapped BOM: ${famValid.map((b) => `${b.key} — ${b.label} (${b.components} components)`).join(" / ")} · one machine per slot`
                    : `No valid BOM is mapped to the ${f.label} racks — create a ${f.boms.join(" / ")} BOM with Item Master components first`}
                </div>
                {famBoms.filter((b) => !b.valid).map((b) => (
                  <div key={b.key} className="text-[10px] mt-0.5 font-semibold" style={{ color: "#b45309" }}>
                    <LeadIcon e="⚠" />{b.key} also maps to these racks but {b.components === 0 ? "has no components" : `${b.missing} of ${b.components} components are not in the Item Master`} — do not use it for rack builds.
                  </div>
                ))}
              </div>
              <button onClick={() => setFillSlot(null)} className="text-slate-500 hover:text-slate-900 transition-colors text-lg leading-none">✕</button>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--text-dim)" }}>Machines on the rack without this slot</div>
              {!canDo("machines", "updateStage") ? (
                <div className="text-[11px] rounded-lg px-3 py-2.5" style={{ background: "rgba(17,24,39,0.03)", color: "var(--text-muted)" }}>Moving a set between slots needs the Machines → Update Stage permission. You can still reserve this slot for the next BOM set below.</div>
              ) : candidates.length === 0 ? (
                <div className="text-[11px] rounded-lg px-3 py-2.5" style={{ background: "rgba(17,24,39,0.03)", color: "var(--text-muted)" }}>No {f.label} set is waiting to be placed.</div>
              ) : (
                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {candidates.map((m) => (
                    <div key={m.id} className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.08)" }}>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-mono font-bold truncate" style={{ color: "var(--text-strong)" }}>{m.serialNo || "(no serial)"}</div>
                        <div className="text-[9px]" style={{ color: "var(--text-dim)" }}>{m.bomKey} · issued {m.createdDate}{m.rackSlot ? ` · now in ${slotLabel(m.rackSlot)}` : " · auto-placed"}</div>
                      </div>
                      <button type="button"
                              onClick={async () => {
                                setFillErr("");
                                const r = onAssignRackSlot ? await onAssignRackSlot(m.id, fillSlot.slotId) : { success: false, error: "Not available" };
                                if (!r || r.success === false) { setFillErr((r && r.error) || "Could not assign"); return; }
                                showToast(`${m.bomKey} — ${m.serialNo || ""}`, `Placed in ${slotLabel(fillSlot.slotId)}`);
                                setFillSlot(null);
                              }}
                              className="text-[10px] font-bold px-2.5 py-1.5 rounded-md text-white flex-shrink-0" style={{ background: f.color }}>Assign here</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {bomSection && canDo("outward", "bom") && (
              <div className="rounded-xl p-3" style={{ background: "rgba(17,24,39,0.03)", border: "1px dashed rgba(17,24,39,0.15)" }}>
                <div className="text-[11px] font-bold" style={{ color: "var(--text-strong)" }}>Issue a new BOM set into this slot</div>
                <div className="text-[10px] mt-0.5 mb-2" style={{ color: "var(--text-muted)" }}>Open the {famKeys[0] || f.label} BOM above and Save To Rack — the new set is placed in {slotLabel(fillSlot.slotId)}.</div>
                <button type="button"
                        onClick={() => {
                          if (onReserveRackSlot) onReserveRackSlot(fillSlot.slotId, famKeys.length === 1 ? famKeys[0] : null);
                          if (!bomOpen) toggleBom();
                          setFillSlot(null);
                          showToast(`${slotLabel(fillSlot.slotId)} reserved`, `Issue the ${famKeys[0] || f.label} BOM and choose Save To Rack`);
                          setTimeout(() => { try { document.getElementById("mt-bom-section")?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch {} }, 50);
                        }}
                        className="text-[10px] font-bold px-2.5 py-1.5 rounded-md" style={{ background: "var(--surface-card)", color: f.color, border: `1px solid ${f.color}55` }}>Reserve slot & open BOM →</button>
              </div>
            )}
            {fillErr && <div className="text-[11px] font-semibold" style={{ color: "#b91c1c" }}><LeadIcon e="⚠" />{fillErr}</div>}
          </div>
        </div>
        );
      })()}

      {startProd && (
        <div className="modal-backdrop fixed inset-0 z-[70] flex items-center justify-center p-4"
             style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(12px)" }}
             onClick={(e) => e.target === e.currentTarget && setStartProd(null)}>
          <div className="w-full max-w-md rounded-2xl p-6 space-y-4"
               style={{ background: "var(--surface-elevated)", border: "1px solid rgba(34,197,94,0.4)", boxShadow: "0 40px 80px rgba(17,24,39,0.22)" }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg" style={{ background: "rgba(34,197,94,0.15)" }}>▶</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-black text-slate-900">Start Production</div>
                <div className="text-[10px] text-slate-500 mt-0.5 truncate">{startProd.key} — {startProd.label}</div>
              </div>
              <button onClick={() => setStartProd(null)} className="text-slate-500 hover:text-slate-900 transition-colors text-lg leading-none">✕</button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl text-center" style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.22)" }}>
                <div className="text-[9px] font-bold text-emerald-400 uppercase tracking-wide">Available on Rack</div>
                <div className="text-2xl font-black text-emerald-400 mt-1">{startProd.ready}</div>
              </div>
              <div className="p-3 rounded-xl text-center" style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.10)" }}>
                <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">Rack Capacity</div>
                <div className="text-2xl font-black text-slate-500 mt-1">{startProd.configured ? startProd.capacity : "—"}</div>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">Select Machine(s) to Start</label>
              <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                {rackMachinesFor(startProd.key).map((m) => {
                  const sel = startSel.has(m.id);
                  const stillPending = pendingForMachine(m);
                  return (
                    <div key={m.id}
                         className="w-full rounded-lg text-left transition-all"
                         style={{ background: sel ? "rgba(34,197,94,0.1)" : "rgba(17,24,39,0.03)", border: `1px solid ${sel ? "rgba(34,197,94,0.45)" : stillPending.length ? "rgba(217,119,6,0.35)" : "rgba(17,24,39,0.10)"}` }}>
                    <div className="w-full flex items-center gap-3 px-3 py-2.5">
                      <button onClick={() => { toggleStartSel(m.id); setStartErr(""); }}
                              className="flex items-center gap-3 flex-1 min-w-0 text-left">
                        <span className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 text-[10px] font-black"
                              style={{ background: sel ? "#16a34a" : "transparent", border: `1.5px solid ${sel ? "#16a34a" : "rgba(17,24,39,0.22)"}`, color: "var(--text)" }}>
                          {sel ? "✓" : ""}
                        </span>
                        <span className="text-[12px] font-mono font-bold text-slate-900 flex-1 truncate">{m.serialNo || "(no serial)"}</span>
                        {stillPending.length > 0 && (
                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded flex-shrink-0"
                                style={{ background: "rgba(217,119,6,0.14)", color: "#b45309", border: "1px solid rgba(217,119,6,0.3)" }}>
                            <LeadIcon e="⚠" />{stillPending.length} pending
                          </span>
                        )}
                        <span className="text-[9px] text-slate-500 flex-shrink-0">Issued {m.createdDate}</span>
                      </button>
                      {/* Feature 3: remove from rack — stock is reversed via the
                          engine and audit is logged. Only shown when prop is
                          provided. */}
                      {onRemoveRackMachine && canDo("outward","delete") && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setRemoveRackConfirm({ machineId: m.id, serialNo: m.serialNo, bomKey: m.bomKey }); }}
                          title="Remove from rack (restore materials to stock)"
                          className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-black text-red-600 hover:text-red-800 hover:bg-red-500/20 transition-all flex-shrink-0"
                          style={{ border: "1px solid rgba(239,68,68,0.25)" }}>
                          🗑
                        </button>
                      )}
                    </div>

                    {/* Which components this rack machine is still waiting for.
                        The store needs this before production starts on it. */}
                    {stillPending.length > 0 && (
                      <div className="px-3 pb-2.5 pt-0.5" style={{ borderTop: "1px dashed rgba(217,119,6,0.3)" }}>
                        <div className="text-[9px] font-black uppercase tracking-wide mt-1.5 mb-1" style={{ color: "#b45309" }}>
                          These items are still to be collected
                        </div>
                        {stillPending.map((p, i) => (
                          <div key={`${p.code}-${i}`} className="flex items-center justify-between gap-2 py-0.5">
                            <span className="text-[10px] text-slate-700 truncate">{p.item || p.name || p.code}</span>
                            <span className="text-[10px] font-bold flex-shrink-0" style={{ color: "#b45309", fontVariantNumeric: "tabular-nums" }}>
                              {p.pendingQty} {p.unit || ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    </div>
                  );
                })}
              </div>
              <div className="text-[10px] text-slate-500 mt-1.5">
                {startSel.size} selected · will move from rack → Assembly stage.
              </div>
              {startErr && <div className="text-[10px] text-red-600 mt-1">{startErr}</div>}
            </div>

            <div className="flex gap-2">
              <button onClick={() => setStartProd(null)}
                className="mt-cancel flex-1 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-900 transition-all"
                style={{ background: "rgba(17,24,39,0.04)", border: "1px solid var(--border-rim)" }}>
                Cancel
              </button>
              <button onClick={confirmStartProd}
                className="flex-1 py-2.5 rounded-xl text-xs font-black text-slate-900 transition-all"
                style={{ background: "#15803d", boxShadow: "0 1px 2px rgba(17,24,39,0.14)", color: "#ffffff" }}>
                ▶ Start Production
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2026-06-02 — Confirm-then-remove rack build modal. Mirrors the
          OutwardPage version. Without this modal AND its state, the parent
          Start Production modal threw a ReferenceError on render because
          setRemoveRackConfirm was undefined in scope. */}
      {removeRackConfirm && (
        <div className="modal-backdrop fixed inset-0 z-[80] flex items-center justify-center p-4"
             style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(12px)" }}
             onClick={(e) => e.target === e.currentTarget && setRemoveRackConfirm(null)}>
          <div className="relative w-full max-w-sm rounded-2xl overflow-hidden"
               style={{ background: "var(--surface-elevated)", border: "1px solid rgba(239,68,68,0.4)", boxShadow: "0 40px 80px rgba(17,24,39,0.22)" }}>
            <ModalX onClose={() => setRemoveRackConfirm(null)} />
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
                      className="mt-cancel text-[11px] font-bold px-3 py-1.5 rounded-lg text-slate-400 border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:text-slate-900 transition-all">
                Cancel
              </button>
              <div className="flex-1" />
              <button onClick={async () => {
                          const cfm = removeRackConfirm;
                          setRemoveRackConfirm(null);
                          if (!onRemoveRackMachine) { showToast("Remove unavailable", "Permission missing", "warning"); return; }
                          const res = await onRemoveRackMachine(cfm.machineId);
                          if (res?.success) {
                            showToast(`Removed ${cfm.bomKey}${cfm.serialNo ? ` · ${cfm.serialNo}` : ""}`, `${res.restored || 0} component(s) returned to stock`);
                            const remaining = rackMachinesFor(startProd?.key || "").filter((m) => m.id !== cfm.machineId);
                            if (startProd && remaining.length === 0) setStartProd(null);
                          } else {
                            showToast("Failed to remove", res?.error || "unknown error", "urgent");
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

      {/* ── Phase A — Finish & Transfer modal ── */}
      {finishModal && (() => {
        const { machine, toDepartment, narration } = finishModal;
        const fromDepartment = machine.currentDepartment || machine.stage;
        // 2026-10-31 — a rack machine finishing Assembly goes BACK TO ITS RACK
        // as "Assembled · Ready"; an admin then sends it to Mechanical from
        // the Rack View. The popup keeps workers, signature, checklist and
        // pending work, but offers no direct transfer.
        const rackReturn = !!machine.rackSlot && fromDepartment === "Assembly" && isRackReleaseHop(fromDepartment, toDepartment);
        // Migration 027 — per-machine override wins over global workflow setting.
        const expectedCfg = (machine.deptDurations && machine.deptDurations[fromDepartment])
          || workflow.dept_durations[fromDepartment];
        const expectedMin = (expectedCfg && expectedCfg.minutes) || 0;
        const { actualMinutes, overrunMinutes, isOverrun } = computeOverrun(machine.departmentEnteredAt, expectedMin, nowTick);
        return (
          <div className="modal-backdrop fixed inset-0 z-[90] flex items-center justify-center p-4"
               style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(10px)" }}
               onClick={(e) => e.target === e.currentTarget && !transferBusy && setFinishModal(null)}>
            <div className="relative w-full max-w-md rounded-2xl overflow-hidden flex flex-col bg-white"
                 style={{ border: "1px solid #e2e8f0", boxShadow: "0 25px 60px rgba(0,0,0,0.18)", maxHeight: "90vh" }}>
              <ModalX onClose={() => setFinishModal(null)} disabled={transferBusy} />
              <div className="px-6 py-5 border-b border-slate-100 flex-shrink-0 bg-white">
                <div className="text-sm font-black text-slate-900">{rackReturn ? "Finish Assembly · Return to Rack" : "Finish & Transfer"}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{machine.bomKey}{machine.serialNo ? ` · S/N ${machine.serialNo}` : ""}{rackReturn ? ` · back to ${slotLabel(machine.rackSlot)}` : ""}</div>
                {(() => {
                  // World UI: required steps done so far (display only).
                  const steps = [
                    ...(isOverrun ? [!!narration.trim()] : []),
                    ...(finishModal.template && Array.isArray(finishModal.answers) && finishModal.answers.length ? [validateChecklistAnswers(finishModal.answers).ok] : []),
                    !pendingItemsProblem(finishModal.owedItems),
                  ];
                  const done = steps.filter(Boolean).length;
                  return (
                    <div className="wu-progress" data-wu-progress aria-label={`${done} of ${steps.length} steps done`}>
                      <div className="wu-progress-track"><i style={{ transform: `scaleX(${done / steps.length})` }} /></div>
                      <span>{done} of {steps.length} done</span>
                    </div>
                  );
                })()}
              </div>
              <div className="p-5 space-y-4 flex-1 overflow-y-auto">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg px-3 py-2.5 bg-slate-50 border border-slate-200">
                    <div className="text-[11px] font-semibold text-slate-500">From</div>
                    <div className="text-[14px] font-black text-slate-900 mt-0.5">{fromDepartment}</div>
                  </div>
                  <div className="rounded-lg px-3 py-2.5 bg-emerald-50 border border-emerald-200">
                    <div className="text-[11px] font-semibold text-emerald-700">{rackReturn ? "Returns to" : "To"}</div>
                    <div className="text-[14px] font-black text-emerald-700 mt-0.5">{rackReturn ? `Rack ${slotLabel(machine.rackSlot)}` : toDepartment}</div>
                  </div>
                </div>
                <div className={`rounded-lg px-3 py-2.5 border ${isOverrun ? "bg-red-50 border-red-200" : "bg-slate-50 border-slate-200"}`}>
                  <div className="text-[11px] font-semibold text-slate-500">Time</div>
                  {/* 2026-10-30 — Target is the BOM duration copied onto this
                      machine at Outward; Actual runs from when this department
                      accepted the machine (or started it) to now. */}
                  <div className="text-[12px] text-slate-700 mt-0.5">
                    Target <span className="font-bold text-slate-900">{formatDuration(expectedMin)}</span>
                    <span className="text-slate-400"> · </span>
                    Actual <span className="font-bold text-slate-900">{formatDuration(actualMinutes)}</span>
                    {isOverrun
                      ? <span className="text-red-600 font-bold ml-2">· Delay {formatDuration(overrunMinutes)}</span>
                      : <span className="text-emerald-700 font-bold ml-2">· on time</span>}
                  </div>
                </div>
                {isOverrun && (
                  <div data-transfer-delay className="rounded-xl">
                    <label className="text-[13px] font-bold text-slate-700 block mb-1.5">
                      Delay reason (required)
                      <span className="text-slate-500 ml-0.5">*</span>
                    </label>
                    {(() => {
                      const delayBox = (
                        <textarea
                          value={narration}
                          onChange={(e) => setFinishModal((prev) => prev ? { ...prev, narration: e.target.value } : prev)}
                          placeholder="Reason"
                          rows={3}
                          autoFocus
                          className="w-full bg-white border border-red-300 rounded-lg px-3 py-2 text-[12px] text-slate-900 placeholder-slate-400 outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100 transition-colors"
                        />
                      );
                      return canVoice ? (
                        <VoiceNoteRecorder place="Delay reason" disabled={transferBusy}
                                           setText={(fn) => setFinishModal((prev) => prev ? { ...prev, narration: fn(prev.narration || "") } : prev)}>{delayBox}</VoiceNoteRecorder>
                      ) : delayBox;
                    })()}
                  </div>
                )}

                {/* 2026-11-02 — no signature and no employee names at Transfer: the
                    logged-in user and department are recorded automatically.
                    2026-11-03 — the "Transferred by …" note box was removed
                    (owner: fewer words); the recording itself is unchanged. */}

                {/* Phase B — Department checklist (if a template exists for this dept) */}
                {finishModal.template && Array.isArray(finishModal.answers) && finishModal.answers.length > 0 && (
                  <div data-transfer-checklist className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                    <div className="text-[11px] font-black text-slate-800 mb-2">
                      Checklist · {finishModal.template.name}
                    </div>
                    <ChecklistBulkBar
                      answers={finishModal.answers}
                      onSetAll={(v) => setFinishModal((prev) => prev ? { ...prev, answers: setAllAnswers(prev.answers, v) } : prev)}
                    />
                    <ChecklistRows answers={finishModal.answers}
                      onToggle={(i, v) => setFinishModal((prev) => prev ? { ...prev, answers: toggleAnswer(prev.answers, i, v) } : prev)}
                      onRemark={(i, t) => setFinishModal((prev) => prev ? { ...prev, answers: setAnswerRemark(prev.answers, i, t) } : prev)}
                      voice={canVoice ? (i, a, field) => (
                        <VoiceNoteRecorder place="Transfer checklist" item={a.label} disabled={transferBusy}
                                           setText={(fn) => setFinishModal((prev) => prev ? { ...prev, answers: setAnswerRemark(prev.answers, i, fn((prev.answers[i] || {}).remark || "")) } : prev)}>{field}</VoiceNoteRecorder>
                      ) : null} />
                  </div>
                )}

                {/* ── Phase 1 — work this department still owes ──
                    A part on order must not hold the whole line, so the machine
                    goes on and the obligation follows it. It stays on this
                    department's list and stops the machine reaching Ready. */}
                <div data-transfer-pending className="pt-4 mt-4 border-t border-slate-100 rounded-xl">
                  <div className="text-[13px] font-bold text-slate-800 mb-2">
                    Anything still pending from {fromDepartment}?
                  </div>
                  <PendingJobRows rows={finishModal.owedItems || []} inventory={inventoryFlat} disabled={transferBusy}
                                  addLabel="+ Add Pending Item" mode="item" allowComment
                                  renderVoice={canVoice ? (i, r, setText, field) => <VoiceNoteRecorder place="Pending item" item={r.description} disabled={transferBusy} setText={setText || null}>{field}</VoiceNoteRecorder> : null}
                                  onChange={(rows) => setFinishModal((prev) => prev ? { ...prev, owedItems: rows } : prev)} />
                  {pendingItemsProblem(finishModal.owedItems) && <div data-pending-item-problem className="mt-1.5 text-[11px] font-semibold" style={{ color: "#b45309" }}>{pendingItemsProblem(finishModal.owedItems)}</div>}
                </div>
              </div>
              <LeftToDo data-finish-left style={{ background: "#fff", borderTop: "1px solid #f1f5f9" }} text={transferBusy ? "" : leftToDoText({
                needLateReason: isOverrun && !narration.trim(),
                checksLeft: finishModal.template && Array.isArray(finishModal.answers) && finishModal.answers.length ? validateChecklistAnswers(finishModal.answers).missing.length : 0,
              })} />
              <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between flex-shrink-0 bg-white">
                <button onClick={() => !transferBusy && setFinishModal(null)} disabled={transferBusy}
                        className="mt-cancel text-[12px] font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                  Cancel
                </button>
                <span onClick={() => { if ((!transferBusy && isOverrun && !narration.trim())) flagField("[data-transfer-delay]"); }}>
                <button data-needs-net onClick={submitFinishTransfer} data-finish-confirm disabled={transferBusy || (isOverrun && !narration.trim())}
                        className="text-[12px] font-bold text-slate-900 bg-amber-600 hover:bg-amber-700 px-5 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed" style={{ color: "#fff", pointerEvents: (!transferBusy && isOverrun && !narration.trim()) ? "none" : undefined }}>
                  {transferBusy ? "⏳ Please wait…" : rackReturn ? `✓ Assembled · Return to ${slotLabel(machine.rackSlot)}` : `Finish & Transfer → ${toDepartment}`}
                </button>
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Migration 032 — Trial Certificate input + view modals ── */}
      {trialCertModal && (
        <TrialCertificateModal
          machine={trialCertModal.machine}
          nowTick={nowTick}
          workflow={workflow}
          busy={transferBusy}
          initialCert={trialCertModal.editOnly ? (trialCertModal.machine.trialCertificate || null) : null}
          editOnly={!!trialCertModal.editOnly}
          company={rptCompany(settings)}
          onClose={() => !transferBusy && setTrialCertModal(null)}
          onSubmit={trialCertModal.editOnly ? saveTrialCertificate : submitTrialCertificate}
        />
      )}
      {trialCertViewModal && (
        <TrialCertificatePrintModal
          machine={trialCertViewModal}
          company={rptCompany(settings)}
          onClose={() => setTrialCertViewModal(null)}
        />
      )}

      {/* ── Phase A — Accept modal (password re-auth + signature) ── */}
      {acceptModal && (() => {
        const { handover, password, sigSvg, busy, error } = acceptModal;
        const setField = (patch) => setAcceptModal((prev) => prev ? { ...prev, ...patch } : prev);
        // Feature 5 — team members from Settings → Employees active in toDepartment.
        const acceptDeptEmps = (settings?.employeeMembers || []).filter((m) => m && m.active
          && Array.isArray(m.departments) && m.departments.includes(handover.toDepartment));
        const selectedTeam = Array.isArray(acceptModal.acceptTeamMembers) ? acceptModal.acceptTeamMembers : [];
        const toggleTeamMember = (name) => {
          const next = selectedTeam.includes(name)
            ? selectedTeam.filter((n) => n !== name)
            : [...selectedTeam, name];
          setField({ acceptTeamMembers: next });
        };
        // Main person (the logged-in head, or whoever really accepts) + others.
        const meName = currentUser?.fullName || currentUser?.username || "";
        const deptNames = acceptDeptEmps.map((m) => m.name);
        const mainName = acceptModal.acceptMain || selectedTeam[0] || "";
        const mainOptions = Array.from(new Set([...(meName ? [meName] : []), ...deptNames, ...(mainName ? [mainName] : [])]));
        const others = selectedTeam.filter((n) => n !== mainName);
        const addableOthers = deptNames.filter((n) => n !== mainName && !selectedTeam.includes(n));
        const setMain = (name) => setField({ acceptMain: name, acceptTeamMembers: [name, ...selectedTeam.filter((n) => n !== name && n !== mainName)], error: "" });
        const hasChecklist = !!(acceptModal.checklistTemplate && (acceptModal.checklistAnswers || []).length > 0);
        const stepBase = acceptDeptEmps.length > 0 ? 2 : 1;
        const stepHead = (n, title, done) => (
          <div className="flex items-center gap-2 mb-2">
            <span className={done ? "accept-pop" : ""} style={{ width: 26, height: 26, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 900, color: "#fff", background: done ? "#15803d" : "#1f2937" }}>{done ? "✓" : n}</span>
            <span className="text-[15px] font-black text-slate-900">{title}</span>
          </div>
        );
        const whyNot = busy ? "" : (acceptDeptEmps.length > 0 && selectedTeam.filter(Boolean).length === 0) ? "Pick who is accepting."
          : !sigSvg ? "Please sign above and press Save Signature."
          : (workflow.require_password_at_accept && !password) ? "Enter your password." : "";
        return (
          <div className="modal-backdrop fixed inset-0 z-[90] flex items-center justify-center p-4"
               style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(10px)" }}
               onClick={(e) => e.target === e.currentTarget && !busy && setAcceptModal(null)}>
            <div className="relative w-full max-w-md rounded-2xl overflow-hidden flex flex-col"
                 style={{ background: "var(--surface-elevated)", border: "1px solid rgba(14,23,38,0.10)", boxShadow: "0 40px 80px rgba(17,24,39,0.22)", maxHeight: "90vh" }}>
              <ModalX onClose={() => setAcceptModal(null)} disabled={!!busy} />
              <div className="px-6 py-5 border-b border-slate-200 flex-shrink-0 bg-white" data-sheet-head>
                <div className="text-sm font-black text-slate-900">Accept into {handover.toDepartment}</div>
                <div className="text-[11px] text-slate-400 mt-0.5">{handover.bomKey}{handover.serialNo ? ` · S/N ${handover.serialNo}` : ""}</div>
                {(() => {
                  // World UI: how far along the required steps are (display only).
                  const steps = [
                    ...(acceptDeptEmps.length > 0 ? [selectedTeam.filter(Boolean).length > 0] : []),
                    !!sigSvg,
                    ...(hasChecklist ? [validateChecklistAnswers(acceptModal.checklistAnswers || []).ok] : []),
                  ];
                  const done = steps.filter(Boolean).length;
                  return (
                    <div className="wu-progress" data-wu-progress aria-label={`${done} of ${steps.length} steps done`}>
                      <div className="wu-progress-track"><i style={{ transform: `scaleX(${steps.length ? done / steps.length : 1})` }} /></div>
                      <span>{done} of {steps.length} done</span>
                    </div>
                  );
                })()}
              </div>
              <div className="p-5 space-y-4 flex-1 overflow-y-auto">
                {handover.overrunNarration && (
                  <div className="rounded-lg px-3 py-2" style={{ background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.3)" }}>
                    <div className="text-[11px] font-bold text-amber-700 mb-0.5">Sender's delay note</div>
                    <div className="text-[12px] text-amber-900 italic">"{handover.overrunNarration}"</div>
                  </div>
                )}
                {isHoldOverdue(handover.sentAt, handover.acceptTimeoutMinutes, nowTick) && (
                  <div className="rounded-lg px-3 py-2.5" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.35)" }}>
                    <div className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: "#b91c1c" }}>
                      <LeadIcon e="🚦" />On hold · {formatDuration(heldMinutes(handover.sentAt, handover.acceptTimeoutMinutes, nowTick))} past the acceptance window
                    </div>
                    <label className="text-[11px] font-bold text-slate-700 block mb-1">Reason for late acceptance <span className="text-red-500">*</span></label>
                    <div className="grid grid-cols-2 gap-2 mb-2" data-late-reasons>
                      {[["👷", "Worker on leave"], ["📦", "Parts missing"], ["🔧", "Other machine first"], ["✏️", "Other"]].map(([icon, label]) => {
                        const on = (acceptModal.holdPick || "") === label;
                        return (
                          <button key={label} type="button" data-late-reason={label} disabled={acceptModal.busy}
                                  onClick={() => setField({ holdPick: label, holdReason: label === "Other" ? "" : label, error: "" })}
                                  className={`rounded-xl text-[13px] font-bold flex items-center justify-center gap-1.5 px-2 transition-all ${on ? "accept-pop" : ""}`}
                                  style={{ minHeight: 48, background: on ? "#dc2626" : "#fff", color: on ? "#fff" : "#7f1d1d", border: `2px solid ${on ? "#dc2626" : "rgba(239,68,68,0.35)"}` }}>
                            <span style={{ fontSize: 17 }}><Glyph e={icon} size={17} /></span>{label}
                          </button>
                        );
                      })}
                    </div>
                    {(acceptModal.holdPick === "Other" || (!acceptModal.holdPick && (acceptModal.holdReason || ""))) && (() => {
                      const lateBox = (
                        <textarea rows={2} value={acceptModal.holdReason || ""} disabled={acceptModal.busy} autoFocus
                                  onChange={(e) => setField({ holdReason: e.target.value, error: "" })}
                                  placeholder="Write the reason"
                                  className="w-full bg-white border-2 border-red-200 rounded-lg px-3 py-2 text-[14px] text-slate-900 outline-none focus:border-red-400" />
                      );
                      return acceptModal.holdPick === "Other" && canVoice ? (
                        <VoiceNoteRecorder place="Late reason" disabled={!!acceptModal.busy}
                                           setText={(fn) => setAcceptModal((prev) => prev ? { ...prev, holdReason: fn(prev.holdReason || ""), error: "" } : prev)}>{lateBox}</VoiceNoteRecorder>
                      ) : lateBox;
                    })()}
                  </div>
                )}
                {(
                  <>
                    {workflow.require_password_at_accept ? (
                      <div>
                        <label className="text-[12px] font-bold text-slate-600 block mb-1.5">Password</label>
                        <input type="password" value={password} autoFocus
                               onChange={(e) => setField({ password: e.target.value, error: "" })}
                               onKeyDown={(e) => { if (e.key === "Enter") submitAcceptHandover(); }}
                               placeholder="Password"
                               className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[12px] text-slate-900 placeholder-slate-500 outline-none focus:border-green-500/60" />
                      </div>
                    ) : (
                      <div className="wu-as" data-accept-as>
                        <User size={16} aria-hidden="true" />
                        <span>Accepting as <b>{currentUser?.fullName || currentUser?.username || "you"}</b></span>
                      </div>
                    )}
                    {acceptDeptEmps.length > 0 && (
                      <div data-accept-people className="accept-step rounded-xl px-3 py-3" style={{ background: "#fff", border: "1px solid rgba(14,23,38,0.12)" }}>
                        {stepHead(1, "Receiving employees", selectedTeam.length > 0)}
                        <label className="text-[12px] font-bold text-slate-700 block mb-1">Main person</label>
                        <select data-accept-main value={mainName} disabled={busy}
                                onChange={(e) => setMain(e.target.value)}
                                className="w-full bg-white border-2 border-slate-300 rounded-xl px-3 text-[15px] font-bold text-slate-900 outline-none focus:border-indigo-500"
                                style={{ minHeight: 50 }}>
                          {mainOptions.map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                        <label className="text-[12px] font-bold text-slate-700 block mt-3 mb-1">Other people</label>
                        {others.length > 0 && (
                          <div className="flex flex-wrap gap-2 mb-2">
                            {others.map((n) => (
                              <button key={n} type="button" data-accept-other={n} disabled={busy} onClick={() => toggleTeamMember(n)}
                                      className="accept-pop text-[13px] font-bold px-3 rounded-full"
                                      style={{ minHeight: 40, background: "rgba(34,197,94,0.14)", border: "2px solid rgba(34,197,94,0.5)", color: "#15803d" }}>
                                ✓ {n}  ✕
                              </button>
                            ))}
                          </div>
                        )}
                        {addableOthers.length > 0 && (
                          <select data-accept-add value="" disabled={busy}
                                  onChange={(e) => { if (e.target.value) toggleTeamMember(e.target.value); }}
                                  className="w-full bg-white border-2 border-slate-300 rounded-xl px-3 text-[14px] font-semibold text-slate-700 outline-none focus:border-indigo-500"
                                  style={{ minHeight: 48 }}>
                            <option value="">+ Add another person…</option>
                            {addableOthers.map((n) => <option key={n} value={n}>{n}</option>)}
                          </select>
                        )}
                      </div>
                    )}
                    {/* 2026-11-02 — mandatory Digital Signature for every acceptance */}
                    <div data-accept-signature className="accept-step rounded-xl px-3 py-3" style={{ background: "#fff", border: "1px solid rgba(14,23,38,0.12)" }}>
                      {stepHead(acceptDeptEmps.length > 0 ? 2 : 1, "Sign here (Digital signature)", !!sigSvg)}
                      {sigSvg ? (
                        <div>
                          <div className="rounded bg-white border border-emerald-200 p-1 flex items-center justify-center" style={{ height: 72 }}>
                            <img alt="Saved signature" src={svgDataUri(sigSvg)} style={{ maxHeight: 64, maxWidth: "100%" }} />
                          </div>
                          <div className="flex items-center justify-between mt-1.5">
                            <div className="accept-pop text-[13px] font-bold text-emerald-700">✓ Signature saved</div>
                            <button type="button" disabled={busy} onClick={() => setField({ sigSvg: null })}
                                    className="text-[10px] font-bold text-slate-500 hover:text-slate-900 underline">Re-sign</button>
                          </div>
                        </div>
                      ) : (
                        <SignaturePad onSave={(svg) => setField({ sigSvg: svg, error: "" })} />
                      )}
                    </div>
                    {/* Phase B — carry-forward: show previously unresolved items for this machine */}
                    {(pendingHandoverItems || []).filter((p) => p.machineId === handover.machineId && pendingItemIsOpen(p)).length > 0 && (
                      <div className="rounded-lg px-3 py-2" style={{ background: "rgba(217, 119, 6,0.07)", border: "1px solid rgba(217, 119, 6,0.3)" }}>
                        <div className="text-[12px] font-bold text-amber-700 mb-1"><LeadIcon e="⏳" />Still pending</div>
                        <ul className="list-disc list-inside text-[11px] text-amber-800 space-y-0.5">
                          {(pendingHandoverItems || []).filter((p) => p.machineId === handover.machineId && pendingItemIsOpen(p)).map((p) => (
                            <li key={p.id}><span className="font-semibold">{p.raisedInDepartment}:</span> {p.description}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {/* Migration 028 — Before-Receive checklist. Appears only
                        when this BOM has a configured template for the dept
                        the machine is being accepted into. Required items
                        follow the same "unchecked needs remark" rule as
                        Finish & Transfer. */}
                    {acceptModal.checklistTemplate && (acceptModal.checklistAnswers || []).length > 0 && (
                      <div data-accept-checklist className="accept-step rounded-xl px-3 py-3" style={{ background: "#fff", border: "1px solid rgba(14,23,38,0.12)" }}>
                        {stepHead(stepBase + 1, "Check before accepting", false)}
                        <div className="text-[12px] font-semibold text-slate-600 mb-1">
                          <LeadIcon e="📋" />{acceptModal.checklistTemplate.name || "After Acceptance Checklist"}
                        </div>
                        <ChecklistBulkBar
                          answers={acceptModal.checklistAnswers}
                          onSetAll={(v) => setField({ checklistAnswers: setAllAnswers(acceptModal.checklistAnswers, v), error: "" })}
                        />
                        <ChecklistRows answers={acceptModal.checklistAnswers}
                          onToggle={(i, v) => setAcceptModal((prev) => prev ? { ...prev, error: "", checklistAnswers: toggleAnswer(prev.checklistAnswers, i, v) } : prev)}
                          onRemark={(i, t) => setAcceptModal((prev) => prev ? { ...prev, error: "", checklistAnswers: setAnswerRemark(prev.checklistAnswers, i, t) } : prev)}
                          voice={canVoice ? (i, a, field) => (
                            <VoiceNoteRecorder place="Accept checklist" item={a.label} disabled={!!busy}
                                               setText={(fn) => setAcceptModal((prev) => prev ? { ...prev, error: "", checklistAnswers: setAnswerRemark(prev.checklistAnswers, i, fn(((prev.checklistAnswers || [])[i] || {}).remark || "")) } : prev)}>{field}</VoiceNoteRecorder>
                          ) : null} />
                      </div>
                    )}

                    {/* Phase B — raise new pending items at this transfer */}
                    <div data-accept-pending className="accept-step rounded-xl px-3 py-3" style={{ background: "#fff", border: "1px solid rgba(14,23,38,0.12)" }}>
                      {stepHead(stepBase + 1 + (hasChecklist ? 1 : 0), `Anything still pending from ${handover.fromDepartment}?`, false)}
                      <PendingJobRows rows={acceptModal.pendingItemsToRaise || []} inventory={inventoryFlat} disabled={acceptModal.busy}
                                      accent="#dc2626" addLabel="+ Add Pending Item" mode="item" allowComment
                                      renderVoice={canVoice ? (i, r, setText, field) => <VoiceNoteRecorder place="Pending item" item={r.description} disabled={!!acceptModal.busy} setText={setText || null}>{field}</VoiceNoteRecorder> : null}
                                      onChange={(rows) => setField({ pendingItemsToRaise: rows })} />
                      {pendingItemsProblem(acceptModal.pendingItemsToRaise) && <div data-pending-item-problem className="mt-1.5 text-[11px] font-semibold" style={{ color: "#b45309" }}>{pendingItemsProblem(acceptModal.pendingItemsToRaise)}</div>}
                    </div>
                  </>
                )}
                {error && error !== acceptModal.errorField && (
                  <div className="rounded-lg px-3 py-2 text-[11px] font-semibold"
                       style={{ background: "rgba(239,68,68,0.08)", color: "#dc2626", border: "1px solid rgba(239,68,68,0.3)" }}>
                    <LeadIcon e="⚠" />{error}
                  </div>
                )}
              </div>
              <LeftToDo data-accept-left style={{ background: "#f8f9fb", borderTop: "1px solid #e2e8f0" }} text={busy || !online ? "" : leftToDoText({
                needPeople: acceptDeptEmps.length > 0 && selectedTeam.filter(Boolean).length === 0,
                checksLeft: hasChecklist ? validateChecklistAnswers(acceptModal.checklistAnswers || []).missing.length : 0,
                signLeft: !sigSvg,
              })} />
              <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between flex-shrink-0"
                   style={{ background: "#f8f9fb" }}>
                <button onClick={() => !busy && setAcceptModal(null)} disabled={busy}
                        className="mt-cancel text-[11px] font-bold px-3 py-1.5 rounded-lg text-slate-400 border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:text-slate-900 transition-all disabled:opacity-50">
                  Cancel
                </button>
                <span onClick={() => {
                        if (!busy && !online) { pulseOffline(); return; }
                        if (busy || !whyNot) return;
                        flagField(acceptDeptEmps.length > 0 && selectedTeam.filter(Boolean).length === 0 ? "[data-accept-people]"
                          : !sigSvg ? "[data-accept-signature]" : "[data-accept-confirm]");
                      }}>
                {(
                  <button data-accept-confirm data-needs-net onClick={submitAcceptHandover}
                          disabled={busy || !online || !sigSvg || (acceptDeptEmps.length > 0 && selectedTeam.filter(Boolean).length === 0) || (workflow.require_password_at_accept && !password)}
                          className={`text-[15px] font-black px-7 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed ${whyNot || busy || !online ? "" : "accept-ready"}`}
                          style={{ pointerEvents: busy || (online && !whyNot) ? undefined : "none", minHeight: 50, background: "#15803d", boxShadow: "0 1px 2px rgba(17,24,39,0.14)", color: "#ffffff" }}>
                    {busy ? "⏳ Please wait…" : (workflow.require_password_at_accept ? "Verify & Accept" : "Confirm Acceptance")}
                  </button>
                )}
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Migration 028 — During-Work checklist modal ─────────────────── */}
      {duringWorkModal && (() => {
        const { machine, template, answers, busy, error } = duringWorkModal;
        const setField = (patch) => setDuringWorkModal((prev) => prev ? { ...prev, ...patch } : prev);
        return (
          <div className="modal-backdrop fixed inset-0 z-[90] flex items-center justify-center p-4"
               style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(10px)" }}
               onClick={(e) => e.target === e.currentTarget && !busy && setDuringWorkModal(null)}>
            <div className="relative w-full max-w-md rounded-2xl overflow-hidden flex flex-col"
                 style={{ background: "var(--surface-elevated)", border: "1px solid rgba(46, 80, 214,0.4)", boxShadow: "0 40px 80px rgba(17,24,39,0.22)", maxHeight: "90vh" }}>
              <ModalX onClose={() => setDuringWorkModal(null)} disabled={!!busy} />
              <div className="px-6 py-4 border-b border-slate-200 flex-shrink-0"
                   style={{ background: "linear-gradient(90deg,rgba(46, 80, 214,0.12),rgba(38, 64, 176,0.05))" }}>
                <div className="text-sm font-black text-slate-900"><LeadIcon e="📋" />During-Work Checks</div>
                <div className="text-[11px] text-slate-400 mt-0.5">{machine.bomKey}{machine.serialNo ? ` · S/N ${machine.serialNo}` : ""} · {machine.currentDepartment || machine.stage}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{template?.name || "Checks"}</div>
              </div>
              <div className="flex-1 overflow-y-auto p-5 space-y-2">
                <ChecklistBulkBar
                  answers={answers}
                  onSetAll={(v) => setField({ answers: setAllAnswers(answers, v), error: "" })}
                />
                <div data-during-checklist>
                <ChecklistRows answers={answers}
                  onToggle={(i, v) => setDuringWorkModal((prev) => prev ? { ...prev, error: "", answers: toggleAnswer(prev.answers, i, v) } : prev)}
                  onRemark={(i, t) => setDuringWorkModal((prev) => prev ? { ...prev, error: "", answers: setAnswerRemark(prev.answers, i, t) } : prev)} />
                </div>
                {error && (
                  <div className="rounded-lg px-3 py-2 text-[11px] font-semibold"
                       style={{ background: "rgba(239,68,68,0.08)", color: "#dc2626", border: "1px solid rgba(239,68,68,0.3)" }}>
                    <LeadIcon e="⚠" />{error}
                  </div>
                )}
              </div>
              <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between flex-shrink-0"
                   style={{ background: "#f8f9fb" }}>
                <button onClick={() => !busy && setDuringWorkModal(null)} disabled={busy}
                        className="mt-cancel text-[11px] font-bold px-3 py-1.5 rounded-lg text-slate-400 border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:text-slate-900 transition-all disabled:opacity-50">
                  Cancel
                </button>
                <button onClick={submitDuringWork} disabled={busy}
                        className="text-xs font-black text-white px-4 py-1.5 rounded-lg transition-all disabled:opacity-50"
                        style={{ background: "#2640B0", boxShadow: "0 1px 2px rgba(17,24,39,0.14)", color: "#ffffff" }}>
                  {busy ? "Saving…" : "✓ Save Checks"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── 2026-11-03 — Assembly "Before Starting Work" checklist ──────────
          Opened by Assemble on a rack machine when its BOM has an Assembly
          before_receive template. Each point: ✓, or ✗ with a reason (the
          reason becomes a pending job; it does not block). */}
      {startChk && (() => {
        const { queue, idx, template, answers, busy, error } = startChk;
        const machine = queue[idx];
        const setRemark = (i, fn) => setStartChk((prev) => prev ? { ...prev, error: "", answers: setAnswerRemark(prev.answers, i, typeof fn === "function" ? fn((prev.answers[i] || {}).remark || "") : fn) } : prev);
        const ready = validateChecklistAnswers(answers).ok;
        const doneCount = answers.filter((a) => a.checked || String(a.remark || "").trim()).length;
        return (
          <div data-start-checklist className="modal-backdrop fixed inset-0 z-[97] flex items-center justify-center p-3"
               style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(10px)", zIndex: 97 }}
               onClick={(e) => e.target === e.currentTarget && !busy && setStartChk(null)}>
            <div className="relative w-full max-w-md rounded-2xl overflow-hidden flex flex-col"
                 style={{ background: "var(--surface-elevated)", border: "1px solid rgba(217,119,6,0.4)", boxShadow: "0 40px 80px rgba(17,24,39,0.22)", maxHeight: "90dvh" }}>
              <ModalX onClose={() => setStartChk(null)} disabled={!!busy} />
              <div className="px-5 py-3 border-b border-slate-200 flex-shrink-0 pr-14"
                   style={{ background: "linear-gradient(90deg,rgba(217,119,6,0.12),rgba(217,119,6,0.03))" }}>
                <div className="text-[15px] font-black text-slate-900"><LeadIcon e="🔧" />Before Starting Work</div>
                <div className="text-[12px] text-slate-500 mt-0.5">{machine.bomKey}{machine.serialNo ? ` · S/N ${machine.serialNo}` : ""}{queue.length > 1 ? ` · ${idx + 1} of ${queue.length}` : ""}</div>
                <div className="mt-2 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${answers.length ? (doneCount / answers.length) * 100 : 0}%`, background: ready ? "#16a34a" : "#d97706" }} />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
                <ChecklistRows answers={answers} placeholder="Reason"
                  onToggle={(i, v) => setStartChk((prev) => prev ? { ...prev, error: "", answers: toggleAnswer(prev.answers, i, v) } : prev)}
                  onRemark={(i, t) => setRemark(i, t)}
                  voice={canVoice ? (i, a, field) => (
                    <VoiceNoteRecorder place="Assembly start checklist" item={a.label} disabled={!!busy}
                                       setText={(fn) => setRemark(i, fn)}>{field}</VoiceNoteRecorder>
                  ) : null} />
                {error && (
                  <div data-start-chk-error className="rounded-lg px-3 py-2 text-[12px] font-semibold"
                       style={{ background: "rgba(239,68,68,0.08)", color: "#dc2626", border: "1px solid rgba(239,68,68,0.3)" }}>
                    <LeadIcon e="⚠" />{error}
                  </div>
                )}
              </div>
              <div className="px-4 py-3 border-t border-slate-200 flex items-center gap-2 flex-shrink-0"
                   style={{ background: "#f8f9fb", paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
                <button onClick={() => !busy && setStartChk(null)} disabled={busy}
                        className="mt-cancel text-[13px] font-bold px-4 h-11 rounded-lg text-slate-500 border border-slate-200 bg-white hover:bg-slate-100 transition-all disabled:opacity-50">
                  Cancel
                </button>
                <button data-start-chk-submit data-ready={ready ? "1" : "0"} onClick={submitStartChk} disabled={busy}
                        className="flex-1 text-[14px] font-black h-12 rounded-lg transition-all active:scale-[.98] disabled:opacity-60"
                        style={ready ? { background: "#d97706", color: "#ffffff", boxShadow: "0 1px 2px rgba(17,24,39,0.14)" } : { background: "#e2e8f0", color: "#64748b" }}>
                  {busy ? "Please wait…" : idx + 1 < queue.length ? "Save · Next machine" : "🔧 Start Assembly"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
