// SHANTAZ ERP — Machine Tracker module writes (folder-replace Phase C, docs/SHELL-CONTEXT.md).
// Moved verbatim from src/app/App.jsx; App.jsx calls createMachineTrackerHandlers(shell) every
// render, right after it builds the shell object, and wires the returned handlers into the
// pages exactly as before. FROZEN, and LOCKED in ERP LIVE: change only with the owner's yes.
// acceptHistoryEntry / promoteAcceptedMachine are also returned: App.jsx's stuck-accept
// repair (repairStuckAcceptRef, run from an effect) calls them.
import { appendAuditWithUser } from "../../auth/auditStore.js";
import { isSupabaseEnabled } from "../../config/env.js";
import { getSupabase } from "../../supabase/client.js";
import { fetchMachines, updateMachine as machineUpdate, deleteMachine as machineDelete, fetchMachineLockState, appendMachineHistory as machineAppendHistory, STALE_MACHINE_MSG } from "../../stores/machinesStore.js";
import { createHandover as handoverCreate, acceptHandover as handoverAccept, releaseHandover, adminCancelHandover, fetchHandoverById } from "../../stores/handoverStore.js";
import { getMySignature, saveMySignature, reauthenticateByPassword } from "../../stores/signaturesStore.js";
import { readDeptWorkflowSettings, isHoldOverdue, RACK_RELEASE_HOPS, canAcceptHandover, canFinishTransfer, canStartAssembly, senderUndoState, saveWithRetry, pendingHandoverForMachine } from "../../utils/handoverLogic.js";
import { createResponse } from "../../stores/checklistsStore.js";
import { createPendingItem, pendingItemIsOpen } from "../../stores/pendingItemsStore.js";
import { uploadAttachment, deleteAttachment } from "../../stores/attachmentsStore.js";
import { createRating } from "../../stores/ratingsStore.js";
import { computeDepartmentRating } from "../../utils/ratingLogic.js";
import { incompleteChecklistJobs, snapshotResponse } from "../../utils/checklistLogic.js";
import { rackOfBom, firstFreeSlot, canAssignSlot, slotLabel, rackViewLog, bomFillCheck, tierOfSlot } from "../../utils/rackSlots.js";
import { cleanPendingJobs } from "../pending-jobs/index.js";
import { waAlertTime } from "../whatsapp/index.js";
import { fmtDate } from "../../shared/format.js";

export function createMachineTrackerHandlers(shell) {
  const { allUsers, attachments, authCanDo, bomDefs, currentUser, flashSaveError, handovers, items, logAudit, machineLog, pendingHandoverItems, rackSlotReservationRef, releaseBusyRef, rtMach, saveFailed, sendWhatsApp, setAttachments, setBomOpenRequest, setChecklistResponses, setDeptRatings, setHandovers, setMachineLog, setPendingHandoverItems, settings, stuckRepairDoneRef, transferringRef } = shell;

  const handleUpdateMachineStage = async (machineId, newStage) => {
    const dateStr = fmtDate(new Date());
    const nowIso = new Date().toISOString();
    const machine = machineLog.find((m) => m.id === machineId);
    const isComplete = newStage === "Ready";
    // 2026-11-02 — an admin override never cuts across an open hand-over: the
    // receiving department would accept into a stage the machine has already
    // left, and the handover row would point at the wrong department.
    const openHandover = !!(machine && machine.pendingHandoverId)
      || (handovers || []).some((h) => h && h.status === "pending" && String(h.machineId) === String(machineId));
    if (openHandover) {
      const msg = "This machine has a hand-over awaiting acceptance. Accept it, or pull it back, before changing the stage.";
      flashSaveError("Stage not changed", `${machine?.bomKey || ""}${machine?.serialNo ? ` · ${machine.serialNo}` : ""}: ${msg}`);
      return { success: false, error: msg };
    }
    // 2026-10-30 — READY is final: a Ready machine never changes stage again
    // (and so can never go back to the rack). READY itself is reached only by
    // the Trial Certificate hand-over, not by this admin shortcut.
    if (machine && (machine.status === "completed" || machine.stage === "Ready")) {
      const msg = "This machine is READY — READY is the final stage and cannot be changed.";
      flashSaveError("Stage not changed", `${machine.bomKey}${machine.serialNo ? ` · ${machine.serialNo}` : ""}: ${msg}`);
      return { success: false, error: msg };
    }
    if (isComplete || newStage === "BOM Issued") {
      const msg = isComplete
        ? "READY is set only by completing the Trial Certificate and accepting the machine into Ready."
        : "A machine in production cannot be sent back to the rack.";
      flashSaveError("Stage not changed", `${machine?.bomKey || ""}${machine?.serialNo ? ` · ${machine.serialNo}` : ""}: ${msg}`);
      return { success: false, error: msg };
    }
    const stageAuditEntry = { type: isComplete ? "machine_completed" : "machine_stage", module: "Machine", action: `${machine?.bomKey || ""} [${machine?.serialNo || ""}] → ${newStage}`, ref: machine?.bomKey || "", serialNo: machine?.serialNo || "", details: { from: machine?.stage, to: newStage, bomLabel: machine?.bomLabel } };
    // 063: when the database already wrote the audit row in the same
    // transaction, keep the local entry only (mirror:false — no duplicate).
    const auditStage = (dbAudited) => appendAuditWithUser(stageAuditEntry, dbAudited ? { mirror: false } : undefined);
    setMachineLog((prev) => prev.map((m) => {
      if (m.id !== machineId) return m;
      return {
        ...m,
        stage:         newStage,
        status:        isComplete ? "completed" : "active",
        completedDate: isComplete ? dateStr : m.completedDate,
        history:       [...m.history, { stage: newStage, date: dateStr }],
        // Phase A: reset the department clock on every stage transition.
        currentDepartment:   newStage,
        departmentEnteredAt: nowIso,
      };
    }));
    let dbAudited = false;
    if (isSupabaseEnabled() && machine) {
      // Awaited: the audit entry and the caller's success toast follow the
      // database answer. A refused write rolls the optimistic row back to
      // the DB truth (refetch) and is reported.
      // 063: append-only + compare-and-set on the stage the operator saw.
      const entry = { stage: newStage, date: dateStr };
      const r = await machineAppendHistory(machineId, {
        entries: [entry],
        fullHistory: [...(machine.history || []), entry],
        expectedStage: machine.stage,
        updates: {
          stage: newStage,
          status: isComplete ? "completed" : "active",
          completedDate: isComplete ? dateStr : machine.completedDate,
          currentDepartment:   newStage,
          departmentEnteredAt: nowIso,
        },
        audit: stageAuditEntry,
      });
      if (r.stale) {
        flashSaveError("Stage not changed", `${machine.bomKey}${machine.serialNo ? ` · ${machine.serialNo}` : ""}: ${STALE_MACHINE_MSG}`);
        rtMach();
        return { success: false, error: STALE_MACHINE_MSG, stale: true };
      }
      if (!r.success) {
        saveFailed("Machine stage", r.error);
        flashSaveError(`stage change to ${newStage}`,
          `${machine.bomKey}${machine.serialNo ? ` · ${machine.serialNo}` : ""}: ${r.error || "unknown error"}`);
        rtMach();
        return { success: false, error: r.error || "Stage not saved" };
      }
      dbAudited = !!r.audited;
    }
    auditStage(dbAudited);
    return { success: true };
  };

  // SERIAL-BASED start production. Takes the specific rack-machine id(s) the operator
  // selected and promotes ONLY those from "BOM Issued" (rack) → "Assembly" (active build).
  // The machine now leaves the rack and appears in the Machine Tracker.
  const handleStartProduction = (machineIds) => {
    if (!canStartAssembly(authCanDo, Array.isArray(currentUser?.departments) ? currentUser.departments.filter(Boolean) : [])) return { success: false, error: "Only the Assembly department (or an admin) can start assembly." };
    const idArr  = Array.isArray(machineIds) ? machineIds : [machineIds];
    const idSet  = new Set(idArr);
    const targets = machineLog.filter((m) => idSet.has(m.id) && m.stage === "BOM Issued");
    if (targets.length === 0) return { success: false, error: "Select at least one machine on the rack" };
    const dateStr = fmtDate(new Date());
    const nowIso  = new Date().toISOString();
    setMachineLog((prev) => prev.map((m) => {
      if (!idSet.has(m.id) || m.stage !== "BOM Issued") return m;
      return {
        ...m,
        stage:   "Assembly",
        status:  "active",
        history: [...(m.history || []), { stage: "Assembly", date: dateStr, note: m.rackSlot ? `Started assembly from rack ${slotLabel(m.rackSlot)}` : "Started production from rack" }],
        // Phase A: Assembly clock starts here for rack-origin machines.
        currentDepartment:   "Assembly",
        departmentEnteredAt: nowIso,
      };
    }));
    if (isSupabaseEnabled()) {
      Promise.all(targets.map((m) => {
        const entry = { stage: "Assembly", date: dateStr, note: m.rackSlot ? `Started assembly from rack ${slotLabel(m.rackSlot)}` : "Started production from rack" };
        // 063: append-only; refused as stale if someone already moved it off the rack.
        return machineAppendHistory(m.id, {
          entries: [entry],
          fullHistory: [...(m.history || []), entry],
          expectedStage: "BOM Issued",
          updates: { stage: "Assembly", status: "active", currentDepartment: "Assembly", departmentEnteredAt: nowIso },
        });
      })).then((results) => {
        if (results.some((r) => r.stale)) {
          flashSaveError("Start Production", STALE_MACHINE_MSG);
          rtMach();
        }
        // This is the exact call that lost a Start Production on 2026-10-29:
        // the UI moved the machine to Assembly, Postgres kept it at BOM Issued,
        // and the only trace was a console.warn nobody was watching — in fact
        // not even that, because updateMachine was reporting success for an
        // UPDATE that matched no rows. Both halves are fixed now; this half
        // makes sure the operator is told.
        const failed = results.filter((r) => !r.success && !r.stale);
        if (failed.length) {
          saveFailed("Start production", failed);
          failed.forEach((r, i) => {
            const m = targets[results.indexOf(r)] || targets[i];
            flashSaveError("Start Production",
              `${m?.serialNo || m?.bomKey || "machine"}: ${r.error || "unknown error"}`);
          });
        }
      });
    }
    const serials = targets.map((m) => m.serialNo).filter(Boolean);
    logAudit({
      type: "production_started", module: "Machine",
      action: `Production Started: ${targets[0].bomKey} — ${serials.join(", ") || `${targets.length} machine(s)`}`,
      ref: targets[0].bomKey,
      serialNo: serials[0] || "",
      qty: targets.length,
      oldValue: { stage: "BOM Issued" },
      newValue: { stage: "Assembly", started: targets.length },
      details: { serialNos: serials },
    });
    return { success: true, count: targets.length, serials };
  };

  // 2026-10-31 — rack slots (brief §14).
  // A Fill action reserves an empty slot for the next BOM set of that model;
  // consumed by handleCreateMachine (Save To Rack) and dropped otherwise.
  // (rackSlotReservationRef is declared with the other hooks near the top of
  // App — hooks must run before the login early-return.)
  const handleReserveRackSlot = (slotId, bomKey) => { rackSlotReservationRef.current = slotId ? { slotId, bomKey: bomKey || null } : null; };

  // Fill Rack: reserve the exact slot for that rack's BOM and open the BOM
  // (serial number first). Only the rack's own BOM is ever opened.
  // 2026-10-31 — Fill Rack on an empty unit (M or R alike — the units are
  // independent): reserve that exact unit and open that rack's OWN BOM
  // (serial first). After the issue the new machine goes into that unit.
  const handleFillRack = (slotId, bomKey) => {
    if (!slotId || !bomKey) return { success: false, error: "No BOM is mapped to this rack" };
    if (!authCanDo("outward", "bom")) return { success: false, error: "You do not have permission to issue a BOM" };
    const r = rackOfBom(bomKey);
    if (!r || r.legacy) return { success: false, error: `${bomKey} is not a rack BOM` };
    if (tierOfSlot(slotId) !== r.tier) return { success: false, error: `${slotLabel(slotId)} takes the ${r.tier}-${r.family.label} BOM only` };
    const stockOf = (code) => { for (const list of Object.values(items || {})) { const f = (list || []).find((i) => i && i.code === code); if (f) return f; } return undefined; };
    const chk = bomFillCheck(bomKey, bomDefs, stockOf);
    if (!chk.ok) return { success: false, error: chk.why };
    const awaiting = new Set((handovers || []).filter((h) => h && h.status === "pending" && h.releaseRequired && !h.releasedAt).map((h) => String(h.machineId)));
    if (firstFreeSlot(bomKey, rackViewLog(machineLog, handovers), awaiting, slotId) !== slotId) return { success: false, error: `${slotLabel(slotId)} already holds a machine` };
    rackSlotReservationRef.current = { slotId, bomKey };
    setBomOpenRequest({ key: bomKey, slotId, mode: "set", n: Date.now() });
    return { success: true };
  };

  // Pin one rack machine to one exact slot. Refuses a taken slot, a slot of
  // another model's rack, or a machine that is not on the rack.
  const handleAssignRackSlot = async (machineId, slotId) => {
    const machine = machineLog.find((m) => String(m.id) === String(machineId));
    const awaiting = new Set((handovers || []).filter((h) => h && h.status === "pending" && h.releaseRequired && !h.releasedAt).map((h) => String(h.machineId)));
    const chk = canAssignSlot(machine, slotId, rackViewLog(machineLog, handovers), awaiting);
    if (!chk.ok) return { success: false, error: chk.error };
    const prevSlot = machine.rackSlot || null;
    setMachineLog((prev) => prev.map((m) => (String(m.id) === String(machineId) ? { ...m, rackSlot: slotId } : m)));
    if (isSupabaseEnabled()) {
      const r = await machineUpdate(machine.id, { rackSlot: slotId });
      if (!r.success) {
        setMachineLog((prev) => prev.map((m) => (String(m.id) === String(machineId) ? { ...m, rackSlot: prevSlot } : m)));
        return { success: false, error: r.error || "Could not save the slot" };
      }
    } else {
      machineUpdate(machine.id, { rackSlot: slotId });
    }
    logAudit({
      type: "rack_slot_assigned", module: "Machine",
      action: `Placed on rack ${slotLabel(slotId)}: ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""}${prevSlot ? ` (moved from ${slotLabel(prevSlot)})` : ""}`,
      ref: machine.bomKey, serialNo: machine.serialNo || "",
      oldValue: { slotId: prevSlot }, newValue: { slotId },
      details: { machineId: machine.id, how: "fill" },
    });
    return { success: true };
  };

  // The slot is freed when the assembled machine leaves the rack (release),
  // or when the set is removed from the rack.
  const clearRackSlot = async (machine, why) => {
    if (!machine || !machine.rackSlot) return { success: true, noop: true };
    const slotId = machine.rackSlot;
    setMachineLog((prev) => prev.map((m) => (String(m.id) === String(machine.id) ? { ...m, rackSlot: null } : m)));
    const r = await machineUpdate(machine.id, { rackSlot: null });
    if (!r.success) console.warn("[App] rack slot clear failed", r.error);
    logAudit({
      type: "rack_slot_released", module: "Machine",
      action: `Rack ${slotLabel(slotId)} is empty again: ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""} — ${why}`,
      ref: machine.bomKey, serialNo: machine.serialNo || "",
      oldValue: { slotId }, newValue: { slotId: null },
      details: { machineId: machine.id, why, persisted: !!r.success },
    });
    return r;
  };

  //
  // Finish & Transfer creates a handover_events row with status='pending' and
  // writes machine_log.pending_handover_id. The machine stays in its current
  // stage until the receiving-dept operator Accepts (handleAcceptHandover).
  //
  // Narration gate is enforced at UI + DB (CHECK constraint). The actual stage
  // promotion happens at accept time, mirroring handleUpdateMachineStage so
  // all downstream reports (history, audit) stay consistent.
  const handleFinishTransfer = async ({
    machineId, fromDepartment, toDepartment,
    expectedDurationMinutes, actualDurationMinutes, overrunNarration,
    // Phase B — optional checklist attached at Finish time.
    checklistTemplate, checklistAnswers,
    // Migration 029 — department-wise employees + Main Employee signature.
    workedBy = [], mainEmployeeId = null, mainEmployeeSignatureSvg = null,
    // 2026-10-31 — Main Employee reference for a Settings employee without a
    // login ("emp:<id>") plus the display name; mainEmployeeId is null then.
    mainEmployeeRef = null, mainEmployeeName = null,
    // Feature 3/4 — pre-built snapshot from submitFinishTransfer that includes
    // both auth users and emp-member display names. If absent, compute from allUsers.
    workedBySnapshot: workedBySnapshotArg = null,
    // Migration 032 — Trial Certificate JSON payload (optional; only for Trial→Ready).
    trialCertificate = null,
    // Phase 1 — jobs fromDepartment still owes on this machine after handing
    // it over (a part on order, say). The machine moves; these follow it and
    // stop it reaching Ready until they are resolved.
    owedItems = [],
    // 2026-10-30 — admin-assigned Acting Main Employee (regular one unavailable).
    actingMainEmployeeId = null,
  }) => {
    if (!currentUser?.id) return { success: false, error: "Not authenticated" };
    if (!canFinishTransfer(authCanDo)) return { success: false, error: "You do not have permission to finish and transfer (Machines → Finish & Transfer)." };
    const machine = machineLog.find((m) => m.id === machineId);
    if (!machine) return { success: false, error: "Machine not found" };
    if (machine.pendingHandoverId) return { success: false, error: "Handover already in progress for this machine." };
    // 2026-11-05 — also look for a pending hand-over by machine id: if the
    // machine link was the half that failed, the link field is empty but the
    // hand-over row exists, and a retry must not open a second one.
    if (pendingHandoverForMachine(handovers, machineId)) {
      return { success: false, error: "A hand-over for this machine is already waiting. Use Undo (or ask an admin to pull it back) before sending it again." };
    }
    if (machine.holdActive) return { success: false, error: "This machine is ON HOLD — release the hold before transferring it." };
    if (machine.status === "completed" || machine.stage === "Ready") {
      return { success: false, error: "This machine is READY — READY is the final stage." };
    }
    if (toDepartment === "Ready") {
      // READY only after Trial completion: the Trial → Ready hop, carrying the
      // Trial Certificate, and no mandatory pending job left open.
      if (fromDepartment !== "Trial" || !trialCertificate) {
        return { success: false, error: "READY needs the Trial Certificate — finish Trial first." };
      }
    }
    // Race guard: a second click within the same tick still sees
    // pendingHandoverId as null. The ref flips synchronously, so the duplicate
    // is rejected here. Self-heals after 3s in case a downstream validation
    // returns without the optimistic handover ever rendering.
    if (transferringRef.current.has(machineId)) {
      return { success: false, error: "Transfer already in progress for this machine." };
    }
    transferringRef.current.add(machineId);
    setTimeout(() => transferringRef.current.delete(machineId), 3000);

    // Cross-user race guard: another operator on another device may have opened
    // a handover on this machine a moment ago — their write is in the DB even
    // though our optimistic copy still shows it free. A fresh single-row read
    // catches that before we create a duplicate handover. Null (local mode or
    // read error) falls through to the optimistic check above.
    const lockState = await fetchMachineLockState(machineId);
    if (lockState && lockState.pendingHandoverId) {
      transferringRef.current.delete(machineId);
      return { success: false, error: "Another operator just moved this machine. Refresh to see its current stage." };
    }

    const workflow = readDeptWorkflowSettings(settings);

    // Migration 029 — snapshot the workers + Main Employee so future user
    // renames / deactivations never corrupt historical reads.
    const safeWorkedBy = Array.isArray(workedBy) ? workedBy.filter(Boolean) : [];
    const workedBySnapshot = workedBySnapshotArg
      ? workedBySnapshotArg
      : (safeWorkedBy.length
          ? safeWorkedBy.map((uid) => {
              const u = (allUsers || []).find((x) => x.id === uid) || null;
              return { id: uid, fullName: u?.fullName || null, username: u?.username || null };
            })
          : null);

    // When the Main Employee IS the current user, their signature is also
    // persisted to employee_signatures (keeps the user's stored sig fresh);
    // otherwise we rely on the inline SVG snapshot. Both are stored on the
    // handover row either way (one of _id / _svg is enough; usually both).
    let mainSigId = null;
    if (mainEmployeeId && mainEmployeeId === currentUser.id && mainEmployeeSignatureSvg) {
      try {
        const sr = await saveMySignature(currentUser.id, mainEmployeeSignatureSvg);
        if (sr && sr.success && sr.signature) mainSigId = sr.signature.id || null;
      } catch (e) { console.warn("[App] saveMySignature (main=current) failed", e); }
    }

    const payload = {
      machineId,
      bomKey:   machine.bomKey,
      serialNo: machine.serialNo,
      fromDepartment,
      toDepartment,
      sentBy:   currentUser.id,
      expectedDurationMinutes,
      actualDurationMinutes,
      overrunNarration: overrunNarration || null,
      acceptTimeoutMinutes: workflow.accept_timeout_minutes,
      status: "pending",
      // Migration 029 fields — snapshot + attribution.
      workedBy:                 safeWorkedBy,
      workedBySnapshot,
      mainEmployeeId:           mainEmployeeId || null,
      mainEmployeeRef:          mainEmployeeRef || mainEmployeeId || null,
      mainEmployeeName:         mainEmployeeName || null,
      mainEmployeeSignatureId:  mainSigId,
      mainEmployeeSignatureSvg: mainEmployeeSignatureSvg || null,
    };

    // Migration 036 — the rack hop. Assembly puts the assembled machine back
    // on the rack and it waits there until a production head releases it, so
    // this handover is created parked rather than pushed. Which hop that is
    // comes from settings, defaulting to the one Shantaz described.
    // 2026-10-31 — only a machine that holds a rack set is parked for the
    // release. Direct Production / R&D machines (no rack slot) go straight to
    // the receiving department's acceptance.
    payload.releaseRequired = !!machine.rackSlot && RACK_RELEASE_HOPS.some(
      (hop) => hop.from === fromDepartment && hop.to === toDepartment
    );

    if (actingMainEmployeeId) {
      const isAdmin = currentUser?.role === "super_admin" || currentUser?.role === "Admin";
      if (!isAdmin) return { success: false, error: "Only an admin can assign an Acting Main Employee." };
      if (actingMainEmployeeId !== mainEmployeeId) return { success: false, error: "The Acting Main Employee must be the Main Employee who signs." };
    }

    const res = await handoverCreate(payload);
    if (!res.success) return res;

    // Attach pending_handover_id to the machine, append a history annotation.
    // 2026-11-05 — the link is awaited and retried; if it still fails the
    // hand-over just created is cancelled again (same store call as pull-back)
    // so the machine is exactly as before and the user can simply retry.
    const dateStr = fmtDate(new Date());
    const historyNote = `Finished ${fromDepartment} → ${toDepartment} (awaiting accept)`;
    setMachineLog((prev) => prev.map((m) =>
      m.id === machineId
        ? { ...m, pendingHandoverId: res.handover.id,
            history: [...(m.history || []), { stage: m.stage, date: dateStr, note: historyNote }],
            ...(trialCertificate ? { trialCertificate } : {}) }
        : m
    ));
    if (isSupabaseEnabled()) {
      const machUpd = { pendingHandoverId: res.handover.id };
      if (trialCertificate) machUpd.trialCertificate = trialCertificate;
      // 063: append-only (no stage check — the hand-over row is already committed).
      const sentEntry = { stage: machine.stage, date: dateStr, note: historyNote };
      const link = await saveWithRetry(async (attempt) => {
        // A retry first checks whether the previous attempt did save (only
        // its answer was lost), so the history line is not written twice.
        if (attempt > 0) {
          const fresh = await fetchMachineLockState(machineId);
          if (fresh && String(fresh.pendingHandoverId) === String(res.handover.id)) return { success: true };
        }
        return machineAppendHistory(machineId, { entries: [sentEntry], fullHistory: [...(machine.history || []), sentEntry], updates: machUpd });
      });
      if (!link.success) {
        saveFailed("Finish & Transfer", link.error);
        const label = `${machine.bomKey}${machine.serialNo ? ` · ${machine.serialNo}` : ""}`;
        const undo = await adminCancelHandover(res.handover.id, "Auto-cancelled: the machine could not be linked to this hand-over (save failed)");
        // Put the screen back the way it was (the optimistic link above).
        setMachineLog((prev) => prev.map((m) =>
          m.id === machineId && m.pendingHandoverId === res.handover.id
            ? { ...m, pendingHandoverId: machine.pendingHandoverId || null, history: machine.history || [],
                ...(trialCertificate ? { trialCertificate: machine.trialCertificate } : {}) }
            : m
        ));
        if (undo.success) {
          setHandovers((prev) => [undo.handover, ...prev.filter((h) => h.id !== res.handover.id)]);
          transferringRef.current.delete(machineId);
          return { success: false, error: `Could not save — please try again. (${label}: ${link.error || "machine not updated"})` };
        }
        // The cancel failed too: the hand-over row stays pending, so show it
        // (the duplicate check above then blocks a second one) and say so.
        setHandovers((prev) => [res.handover, ...prev.filter((h) => h.id !== res.handover.id)]);
        rtMach();
        flashSaveError("Finish & Transfer",
          `${label}: the hand-over was recorded but the machine was not linked to it, and it could not be cancelled automatically — ${link.error || "unknown error"}. Use Undo or ask an admin to pull it back, then send again.`);
        return { success: false, error: "Could not save — please try again after the hand-over is pulled back (Undo / admin)." };
      }
    }

    if (actingMainEmployeeId) {
      const au = (allUsers || []).find((u) => u.id === actingMainEmployeeId);
      logAudit({
        type: "acting_main_assigned", module: "Machine",
        action: `Acting Main Employee ${au?.fullName || au?.username || actingMainEmployeeId} for ${fromDepartment} → ${toDepartment}: ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""}`,
        ref: machine.bomKey, serialNo: machine.serialNo || "",
        details: { handoverId: res.handover.id, actingMainEmployeeId, assignedBy: currentUser?.id || null, department: fromDepartment },
      });
    }

    // Refresh handovers list locally — realtime will catch up but immediate
    // UI feedback matters more.
    setHandovers((prev) => [res.handover, ...prev]);

    logAudit({
      type: "handover_sent", module: "Machine",
      action: `Handover sent: ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""}  ${fromDepartment} → ${toDepartment}`,
      ref: machine.bomKey, serialNo: machine.serialNo || "",
      details: {
        machineId, handoverId: res.handover.id, fromDepartment, toDepartment,
        expectedDurationMinutes, actualDurationMinutes,
        overrunMinutes: Math.max(0, actualDurationMinutes - expectedDurationMinutes),
        narration_present: !!(overrunNarration && overrunNarration.trim()),
        // Migration 029 — attribution snapshot.
        workedByCount: safeWorkedBy.length || undefined,
        workedBySnapshot: workedBySnapshot || undefined,
        mainEmployeeId: mainEmployeeId || undefined,
        mainEmployeeSigned: !!mainEmployeeSignatureSvg,
      },
    });

    // ── WhatsApp trigger: transfer complete ──
    if (settings.waNotifyTransfer) {
      const overrun = actualDurationMinutes > expectedDurationMinutes;
      const msg = `${overrun ? "🟡" : "🟢"} Transfer Complete\nMachine: ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""}\n${fromDepartment} → ${toDepartment}\nTime: ${actualDurationMinutes}min${overrun ? ` (expected ${expectedDurationMinutes}min)` : ""}`;
      const params = [
        "Transfer Complete",
        `${machine.bomKey}${machine.serialNo ? ` (${machine.serialNo})` : ""}`,
        `${fromDepartment} to ${toDepartment}`,
        `Took ${actualDurationMinutes} min${overrun ? `, expected ${expectedDurationMinutes} min` : ""}`,
        waAlertTime(),
      ];
      if (settings.waOwnerPhone) sendWhatsApp(settings.waOwnerPhone, msg, params);
      if (settings.waGroupNumbers) sendWhatsApp(settings.waGroupNumbers, msg, params);
    }

    if (overrunNarration && overrunNarration.trim()) {
      logAudit({
        type: "handover_overrun_narrated", module: "Machine",
        action: `Overrun narration recorded for handover ${res.handover.id}`,
        ref: machine.bomKey, serialNo: machine.serialNo || "",
        details: { handoverId: res.handover.id, narration: overrunNarration.trim() },
      });
    }

    // Phase B / migration 028 — snapshot the Before-Dispatch checklist
    // response (fire-and-forget mirror). stage+bomKey land on the row for
    // Reports to filter without joining machine_log.
    if (checklistTemplate && Array.isArray(checklistAnswers)) {
      const snap = snapshotResponse({
        machineId, handoverId: res.handover.id, department: fromDepartment,
        stage: "before_dispatch", bomKey: machine.bomKey,
        template: checklistTemplate, answers: checklistAnswers,
        submittedBy: currentUser.id,
      });
      const cr = await createResponse(snap);
      if (cr.success) {
        setChecklistResponses((prev) => [cr.response, ...prev]);
        logAudit({
          type: "checklist_submitted_finish", module: "Machine",
          action: `Checklist submitted (Before Dispatch): ${checklistTemplate.name || ""} for ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""} (${fromDepartment})`,
          ref: machine.bomKey, serialNo: machine.serialNo || "",
          details: { handoverId: res.handover.id, templateId: checklistTemplate.id, items: checklistAnswers.length, unchecked: checklistAnswers.filter((a) => !a.checked).length, stage: "before_dispatch" },
        });
      } else {
        saveFailed("Transfer checklist", cr.error);
        flashSaveError("Checklist not saved", `${machine.bomKey}${machine.serialNo ? ` · ${machine.serialNo}` : ""}: the Before Dispatch checklist (${checklistTemplate.name || ""}) was not recorded — ${cr.error || "unknown error"}`);
      }
    }

    // Phase 1 — record the jobs this department still owes. Raised against
    // fromDepartment (the department that owes the work), kind 'owed' so the
    // machine can still move between departments but cannot reach Ready.
    // 2026-10-30 — an unticked Before Transfer checklist item (its reason is
    // mandatory) is not a blocker: it follows the machine as a pending job
    // owed by this department, with the reason the operator wrote.
    const checklistJobs = (checklistTemplate && Array.isArray(checklistAnswers))
      ? incompleteChecklistJobs(checklistAnswers, "Before Transfer") : [];
    for (const job of [...cleanPendingJobs(owedItems), ...checklistJobs]) {
      const text = job.description;
      const pr = await createPendingItem({
        machineId,
        raisedInHandoverId: res.handover.id,
        raisedInDepartment: fromDepartment,
        assignedDepartment: fromDepartment,
        raisedBy: currentUser.id,
        description: text,
        kind: "owed",
        itemCode: job.itemCode, itemName: job.itemName, qty: job.qty, reason: job.reason,
        critical: !!job.critical, partSerialNo: job.partSerialNo || "", criticalChecks: job.criticalChecks || null,
      });
      if (pr.success) {
        setPendingHandoverItems((prev) => [pr.item, ...prev]);
        logAudit({
          type: "pending_item_raised", module: "Machine",
          action: `Job owed by ${fromDepartment}: ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""}`,
          ref: machine.bomKey, serialNo: machine.serialNo || "",
          details: { machineId, itemId: pr.item?.id, handoverId: res.handover.id, kind: "owed", assignedDepartment: fromDepartment, description: text, itemCode: job.itemCode || undefined, qty: job.qty ?? undefined, reason: job.reason || undefined },
        });
      } else {
        saveFailed("Pending item", pr.error);
        // 2026-11-05 — saving a pending job needs Machines → Accept (database
        // rule, migration 058). A sender with only Finish & Transfer used to get
        // a raw database error; tell them plainly who can fix it.
        const noAccept = !authCanDo("machines", "accept");
        flashSaveError("Pending job not saved", noAccept
          ? `${machine.bomKey}${machine.serialNo ? ` · ${machine.serialNo}` : ""}: "${text}" was NOT saved — your role cannot save pending jobs (it needs the Machines → Accept permission). The machine was transferred. Ask your admin to add that permission, or to raise this job from the machine card.`
          : `${machine.bomKey}${machine.serialNo ? ` · ${machine.serialNo}` : ""}: "${text}" — ${pr.error || "unknown error"}. Raise it again from the machine card.`);
      }
    }

    return { success: true, handover: res.handover };
  };

  // Accept flow: verify password via secondary Supabase client (does NOT touch
  // main session), attach the operator's signature, flip status to accepted,
  // promote the machine to the new department. Password re-auth is required
  // by design — a saved signature alone is not proof of authorization.
  // 2026-11-05 — the machine half of Accept: move the machine into the
  // receiving department and clear its pending_handover_id. Awaited and
  // retried; a retry first re-reads the machine so an attempt whose answer was
  // lost (but which did save) is not applied twice. On failure the optimistic
  // move is dropped and the database truth is reloaded.
  const acceptHistoryEntry = (handover, byName, noteSuffix, dateStr, nowIso) => ({ stage: handover.toDepartment, date: dateStr,
    by: byName, department: handover.toDepartment, at: nowIso, handoverId: handover.id, signed: true,
    note: `Accepted into ${handover.toDepartment} by ${byName}${noteSuffix}` });

  const promoteAcceptedMachine = async (handover, machine, { historyEntry, dateStr, nowIso }) => {
    const handoverId = handover.id;
    const newStage = handover.toDepartment;
    const isComplete = newStage === "Ready";
    setMachineLog((prev) => prev.map((m) =>
      String(m.id) === String(handover.machineId)
        ? {
            ...m,
            stage:               newStage,
            status:              isComplete ? "completed" : "active",
            completedDate:       isComplete ? dateStr : m.completedDate,
            history:             [...(m.history || []), historyEntry],
            currentDepartment:   newStage,
            departmentEnteredAt: nowIso,
            pendingHandoverId:   null,
          }
        : m
    ));
    if (!isSupabaseEnabled()) return { success: true };
    // 063: append-only (no stage check — the acceptance is already committed).
    const r = await saveWithRetry(async (attempt) => {
      if (attempt > 0) {
        const fresh = await fetchMachineLockState(handover.machineId);
        if (fresh && String(fresh.pendingHandoverId) !== String(handoverId)) return { success: true };
      }
      return machineAppendHistory(handover.machineId, {
        entries: [historyEntry],
        fullHistory: [...(machine.history || []), historyEntry],
        updates: {
          stage: newStage,
          status: isComplete ? "completed" : "active",
          completedDate: isComplete ? dateStr : machine.completedDate,
          currentDepartment:   newStage,
          departmentEnteredAt: nowIso,
          pendingHandoverId:   null,
        },
      });
    });
    if (!r.success) rtMach();   // drop the optimistic promote; show the DB truth
    return r;
  };

  const handleAcceptHandover = async ({ handoverId, password, pendingItemsToRaise = [], checklistTemplate = null, checklistAnswers = null, stage = null, department = null, acceptTeamMembers = [], signatureSvg = null, holdReason = "" }) => {
    if (!currentUser?.id) return { success: false, error: "Not authenticated" };
    const handover = handovers.find((h) => h.id === handoverId);
    if (!handover) return { success: false, error: "Handover not found" };
    // 2026-11-05 — "try again" after a half-saved accept: the hand-over is
    // already accepted (the database never lets that row change again) but the
    // machine still points at it. Skip the accept write and finish the rest.
    const resumeAccept = handover.status === "accepted"
      && String((machineLog.find((m) => String(m.id) === String(handover.machineId)) || {}).pendingHandoverId) === String(handoverId);
    if (handover.status !== "pending" && !resumeAccept) return { success: false, error: "This handover is no longer pending." };
    if ((machineLog.find((m) => String(m.id) === String(handover.machineId)) || {}).holdActive) return { success: false, error: "This machine is ON HOLD — release the hold before accepting it." };
    // Migration 036 — a machine parked on the rack is not anyone's to accept
    // until a production head releases it. The Accept button is no longer
    // shown for it; this refuses any other path that would skip the release.
    if (handover.releaseRequired && !handover.releasedAt) {
      return { success: false, error: "This machine is on the rack — a production head must release it first." };
    }
    if (handover.toDepartment === "Ready") {
      if (handover.fromDepartment !== "Trial") {
        return { success: false, error: "READY can only be accepted from Trial." };
      }
    }

    // Permission check (receiving dept role; auto-mapped from updateStage).
    if (!canAcceptHandover(authCanDo, handover.toDepartment)) {
      return { success: false, error: "You don't have permission to accept into this department." };
    }

    // Step 1: re-authenticate — ONLY when the admin has opted into the
    // require_password_at_accept setting. Default (2026-10-19 UX pass) is OFF:
    // the authenticated session + canAcceptHandover + saved signature + audit
    // log is sufficient proof chain for routine factory acceptance. Admins
    // can re-enable password re-prompt via Settings → Department Workflow
    // Settings for higher-security environments.
    const workflow = readDeptWorkflowSettings(settings);
    if (workflow.require_password_at_accept) {
      const authEmail = currentUser.email || `${currentUser.username}@users.shantaz.local`;
      const reauth = await reauthenticateByPassword(authEmail, password);
      if (!reauth.success) return reauth;
    }

    // Step 2 (2026-11-02): the digital signature is drawn on EVERY acceptance
    // and snapshotted on the hand-over row. The stored per-user signature is
    // not required (and never overwritten here); its id is kept as a reference.
    if (!signatureSvg || !String(signatureSvg).includes("<svg")) {
      return { success: false, error: "A digital signature is required to accept a handover." };
    }
    const sigRes = await getMySignature(currentUser.id);
    const storedSigId = sigRes?.success && sigRes.signature ? sigRes.signature.id : null;

    // Step 2b (2026-11-02): find the machine BEFORE flipping the handover. A
    // tablet whose machine list is stale (slept through the realtime event,
    // or the machine was created on another device a moment ago) used to
    // mark the handover accepted and then skip the promote because
    // `machine` was undefined — the handover was gone and the machine never
    // moved. Refetch once; if it is still missing, refuse before any write.
    let machine = machineLog.find((m) => String(m.id) === String(handover.machineId));
    if (!machine && isSupabaseEnabled()) {
      const fresh = await fetchMachines();
      if (Array.isArray(fresh)) {
        setMachineLog(fresh);
        machine = fresh.find((m) => String(m.id) === String(handover.machineId)) || null;
      }
    }
    if (!machine) {
      return { success: false, error: `Machine #${handover.machineId} (${handover.bomKey}${handover.serialNo ? ` · ${handover.serialNo}` : ""}) was not found — refresh the page and try again. The handover has not been accepted.` };
    }

    // Step 3: atomic UPDATE to status='accepted' (RLS: status='pending' guard).
    // Feature 5 — include accept-team snapshot (nullable; migration 031).
    const acceptedByTeamSnapshot = Array.isArray(acceptTeamMembers) && acceptTeamMembers.length > 0
      ? acceptTeamMembers.map((name) => ({ name }))
      : null;
    // Who received the machine: the selected employees, else the logged-in user.
    const acceptedByName = (acceptedByTeamSnapshot ? acceptedByTeamSnapshot.map((t) => t.name).join(", ") : "")
      || currentUser.fullName || currentUser.username || "";
    const accRes = resumeAccept
      ? { success: true, handover }
      : await handoverAccept(handoverId, {
          acceptedBy: currentUser.id,
          acceptedBySignatureId: storedSigId,
          acceptedByTeamSnapshot,
          acceptedSignatureSvg: signatureSvg,
          acceptedByName,
          acceptedInDepartment: handover.toDepartment,
        });
    if (!accRes.success) return accRes;

    // Step 4: promote the machine (awaited + retried — see promoteAcceptedMachine).
    const newStage = handover.toDepartment;
    const isComplete = newStage === "Ready";
    const lateNow = isHoldOverdue(handover.sentAt, handover.acceptTimeoutMinutes, Date.now());
    // Refresh handovers list locally (the accepted row is the database truth
    // whether or not the machine half below succeeds).
    setHandovers((prev) => prev.map((h) => h.id === handoverId ? accRes.handover : h));
    // While this device is finishing it, the automatic repair leaves it alone.
    stuckRepairDoneRef.current.add(handoverId);
    const dateStr = fmtDate(new Date());
    const nowIso  = new Date().toISOString();
    const historyEntry = { stage: newStage, date: dateStr,
      // 2026-11-02 — name, department, time and a link to the signed hand-over.
      by: acceptedByName, department: newStage, at: nowIso, handoverId, signed: true,
      note: `Accepted into ${newStage} by ${acceptedByName}${lateNow ? ` (ON HOLD — accepted late${holdReason ? `: ${holdReason}` : ""})` : ""}` };
    const promote = await promoteAcceptedMachine(handover, machine, { historyEntry, dateStr, nowIso });
    if (!promote.success) {
      saveFailed("Accept", promote.error);
      // The hand-over row is accepted and the database refuses to change an
      // accepted row back, so it cannot be undone from here. The machine still
      // points at it: pressing Accept again resumes (resumeAccept above), and
      // the stuck-accept repair finishes it automatically if the form is closed.
      flashSaveError(`Accept into ${newStage}`,
        `${machine.bomKey}${machine.serialNo ? ` · ${machine.serialNo}` : ""}: the acceptance was recorded but the machine was not moved — ${promote.error || "unknown error"}. Press Accept again to finish.`);
      setTimeout(() => stuckRepairDoneRef.current.delete(handoverId), 120000);
      return { success: false, error: "Could not save — please try again (press Accept again)." };
    }

    const timeToAcceptMin = Math.max(0, Math.floor((Date.parse(accRes.handover.acceptedAt) - Date.parse(accRes.handover.sentAt)) / 60000));
    const wasOverdue = timeToAcceptMin > (accRes.handover.acceptTimeoutMinutes || 0);
    logAudit({
      type: isComplete ? "machine_completed" : "handover_accepted",
      module: "Machine",
      action: `Handover accepted: ${handover.bomKey}${handover.serialNo ? ` [${handover.serialNo}]` : ""}  ${handover.fromDepartment} → ${newStage}${wasOverdue ? " (OVERDUE)" : ""}`,
      ref: handover.bomKey, serialNo: handover.serialNo || "",
      details: {
        handoverId, machineId: handover.machineId,
        from: handover.fromDepartment, to: newStage,
        timeToAcceptMin, wasOverdue, acceptTimeoutMinutes: accRes.handover.acceptTimeoutMinutes,
        holdReason: holdReason || undefined,
      },
    });

    // Phase B — raise any pending items the receiver flagged.
    for (const job of cleanPendingJobs(pendingItemsToRaise)) {
      const desc = job.description;
      const pi = await createPendingItem({
        machineId: handover.machineId,
        raisedInHandoverId: handoverId,
        raisedInDepartment: handover.fromDepartment,
        // The Accept modal asks "any work from <fromDepartment> still
        // pending?", so that department owns the fix. Without this the item
        // was saved Unassigned: it showed under "Unassigned" in Departments
        // Called and no department was ever asked to do it.
        assignedDepartment: handover.fromDepartment,
        kind: "fault",
        raisedBy: currentUser.id,
        description: desc,
        itemCode: job.itemCode, itemName: job.itemName, qty: job.qty, reason: job.reason,
        critical: !!job.critical, partSerialNo: job.partSerialNo || "", criticalChecks: job.criticalChecks || null,
      });
      if (pi.success) {
        setPendingHandoverItems((prev) => [pi.item, ...prev]);
        logAudit({
          type: "pending_item_raised", module: "Machine",
          action: `Pending item raised: ${desc}  (${handover.bomKey}${handover.serialNo ? ` [${handover.serialNo}]` : ""})`,
          ref: handover.bomKey, serialNo: handover.serialNo || "",
          details: { handoverId, machineId: handover.machineId, raisedInDepartment: handover.fromDepartment, itemCode: job.itemCode || undefined, qty: job.qty ?? undefined, reason: job.reason || undefined },
        });
      } else {
        saveFailed("Pending item", pi.error);
        flashSaveError("Pending item not saved", `${handover.bomKey}${handover.serialNo ? ` · ${handover.serialNo}` : ""}: "${desc}" — ${pi.error || "unknown error"}. Raise it again from the machine card.`);
      }
    }

    // Migration 028 — snapshot the Before-Receive checklist response (if
    // the receiving dept has one configured for this BOM). Fire-and-forget.
    if (checklistTemplate && Array.isArray(checklistAnswers) && checklistAnswers.length) {
      const snap = snapshotResponse({
        machineId: handover.machineId, handoverId,
        department: department || handover.toDepartment,
        stage: stage || "before_receive",
        bomKey: handover.bomKey || machine?.bomKey || null,
        template: checklistTemplate, answers: checklistAnswers,
        submittedBy: currentUser.id,
      });
      const cr = await createResponse(snap);
      if (cr.success) {
        setChecklistResponses((prev) => [cr.response, ...prev]);
        logAudit({
          type: "checklist_submitted_accept", module: "Machine",
          action: `Checklist submitted (Before Receive): ${checklistTemplate.name || ""} for ${handover.bomKey}${handover.serialNo ? ` [${handover.serialNo}]` : ""} (${department || handover.toDepartment})`,
          ref: handover.bomKey, serialNo: handover.serialNo || "",
          details: { handoverId, templateId: checklistTemplate.id, items: checklistAnswers.length, unchecked: checklistAnswers.filter((a) => !a.checked).length, stage: "before_receive" },
        });
      } else {
        saveFailed("Accept checklist", cr.error);
        flashSaveError("Checklist not saved", `${handover.bomKey}${handover.serialNo ? ` · ${handover.serialNo}` : ""}: the Before Receive checklist (${checklistTemplate.name || ""}) was not recorded — ${cr.error || "unknown error"}`);
      }
    }

    // 2026-10-30 — unticked After Acceptance checklist items (reason
    // mandatory) become pending jobs on the machine, owed by the sending
    // department whose work they check. Kind 'owed': the machine keeps moving
    // but cannot be Ready until they are completed.
    if (checklistTemplate && Array.isArray(checklistAnswers)) {
      for (const job of incompleteChecklistJobs(checklistAnswers, "After Acceptance")) {
        const pi = await createPendingItem({
          machineId: handover.machineId, raisedInHandoverId: handoverId,
          raisedInDepartment: handover.toDepartment, assignedDepartment: handover.fromDepartment,
          kind: "owed", raisedBy: currentUser.id, description: job.description, reason: job.reason,
        });
        if (pi.success) {
          setPendingHandoverItems((prev) => [pi.item, ...prev]);
          logAudit({
            type: "pending_item_raised", module: "Machine",
            action: `${job.description} — ${handover.bomKey}${handover.serialNo ? ` [${handover.serialNo}]` : ""}`,
            ref: handover.bomKey, serialNo: handover.serialNo || "",
            details: { handoverId, machineId: handover.machineId, kind: "owed", assignedDepartment: handover.fromDepartment, reason: job.reason, source: "checklist_after_acceptance" },
          });
        } else {
          saveFailed("Pending job", pi.error);
          flashSaveError("Pending job not saved", `${handover.bomKey}${handover.serialNo ? ` · ${handover.serialNo}` : ""}: "${job.description}" — ${pi.error || "unknown error"}. Raise it again from the machine card.`);
        }
      }
    }

    // Phase B — compute + save a department rating snapshot for the sender's work.
    const openPendingItemsCount =
      (pendingHandoverItems.filter((p) => p.machineId === handover.machineId && pendingItemIsOpen(p)).length)
      + cleanPendingJobs(pendingItemsToRaise).length;
    const overrunMinutesForRating = Number(accRes.handover.overrunMinutes) || 0;
    const heldMinutesForRating = wasOverdue
      ? Math.max(0, timeToAcceptMin - (accRes.handover.acceptTimeoutMinutes || 0))
      : 0;
    const calc = computeDepartmentRating({
      overrunMinutes:   overrunMinutesForRating,
      heldMinutes:      heldMinutesForRating,
      pendingItemsOpen: openPendingItemsCount,
    });
    const ratingRes = await createRating({
      machineId:      handover.machineId,
      department:     handover.fromDepartment,
      handoverId,
      rating:         calc.rating,
      calculationLog: calc,
    });
    if (ratingRes.success) {
      setDeptRatings((prev) => [ratingRes.rating, ...prev]);
      logAudit({
        type: "department_rated", module: "Machine",
        action: `${handover.fromDepartment} rated ${calc.rating}★ for ${handover.bomKey}${handover.serialNo ? ` [${handover.serialNo}]` : ""}`,
        ref: handover.bomKey, serialNo: handover.serialNo || "",
        details: { department: handover.fromDepartment, rating: calc.rating, deductions: calc.deductions },
      });
    } else {
      console.warn("[App] handleAcceptHandover: rating save failed", ratingRes.error);
      flashSaveError("Department rating not saved", `${handover.fromDepartment} for ${handover.bomKey}${handover.serialNo ? ` · ${handover.serialNo}` : ""}: ${ratingRes.error || "unknown error"}`);
    }

    return { success: true };
  };

  // Migration 028 — During-Work checklist submission. Optional; no stage
  // transition, no machine state change. Pure snapshot + audit.
  // 2026-11-03 — also saves the Assembly "Before Starting Work" checklist
  // (stage "before_receive", department "Assembly") answered when a rack
  // machine's Assemble is pressed. Same snapshot; a ✗ item (reason required)
  // becomes a pending job owed by that department, exactly like an unticked
  // Before Transfer item. During-Work behaviour is unchanged.
  const handleSubmitDuringWorkChecklist = async ({ machine, template, answers, stage = "during_work", department = null }) => {
    if (!currentUser?.id) return { success: false, error: "Not authenticated" };
    if (!machine || !template) return { success: false, error: "Missing machine or template" };
    const isStart = stage !== "during_work";
    const dept = department || machine.currentDepartment || machine.stage;
    const snap = snapshotResponse({
      machineId: machine.id, handoverId: null,
      department: dept,
      stage,
      bomKey: machine.bomKey || null,
      template, answers,
      submittedBy: currentUser.id,
    });
    const cr = await createResponse(snap);
    if (!cr.success) return cr;
    setChecklistResponses((prev) => [cr.response, ...prev]);
    logAudit({
      type: isStart ? "checklist_submitted_assembly_start" : "checklist_submitted_during_work", module: "Machine",
      action: `Checklist submitted (${isStart ? "Before Starting Work" : "During Work"}): ${template.name || ""} for ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""} (${dept})`,
      ref: machine.bomKey, serialNo: machine.serialNo || "",
      details: { templateId: template.id, items: answers.length, unchecked: answers.filter((a) => !a.checked).length, stage },
    });
    if (isStart) {
      for (const job of incompleteChecklistJobs(answers, "Before Starting Work")) {
        const pi = await createPendingItem({
          machineId: machine.id, raisedInHandoverId: null,
          raisedInDepartment: dept, assignedDepartment: dept,
          kind: "owed", raisedBy: currentUser.id, description: job.description, reason: job.reason,
        });
        if (pi.success) {
          setPendingHandoverItems((prev) => [pi.item, ...prev]);
          logAudit({
            type: "pending_item_raised", module: "Machine",
            action: `${job.description} — ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""}`,
            ref: machine.bomKey, serialNo: machine.serialNo || "",
            details: { machineId: machine.id, itemId: pi.item?.id, kind: "owed", assignedDepartment: dept, reason: job.reason, source: "checklist_assembly_start" },
          });
        } else {
          saveFailed("Pending job", pi.error);
          flashSaveError("Pending job not saved", `${machine.bomKey}${machine.serialNo ? ` · ${machine.serialNo}` : ""}: "${job.description}" — ${pi.error || "unknown error"}. Raise it again from the machine card.`);
        }
      }
    }
    return { success: true };
  };

  // Migration 036 — a production head takes a machine off the rack and tells
  // the waiting department to pick it up. Does not touch the machine's stage:
  // the department still accepts it properly, with its checklist and
  // signature, exactly as on any other hop.
  // 2026-10-30 — Admin Pull Back: cancel a pending hand-over and return the
  // machine to the sending department. The hand-over row stays (status
  // cancelled, with the reason), the machine keeps its department clock,
  // and both the history and the audit trail record it.
  // 2026-11-03 (owner-approved) — SENDER UNDO uses this same path: the worker
  // who sent the machine may take it back within 5 minutes while it is not yet
  // accepted (senderUndoState). Re-checked on a fresh read right before the
  // write; the database cancel policy (053/058) is the authority.
  const handlePullBackHandover = async ({ handoverId, reason, bySender = false }) => {
    if (!currentUser?.id) return { success: false, error: "Not authenticated" };
    const isAdmin = currentUser?.role === "super_admin" || currentUser?.role === "Admin";
    const senderUndo = !!bySender;
    if (!isAdmin && !senderUndo) return { success: false, error: "Only an admin can pull a hand-over back." };
    const why = String(reason || "").trim() || (senderUndo ? "Sent by mistake — taken back by the sender" : "");
    if (!why) return { success: false, error: "Write the reason for pulling this machine back." };
    let h = (handovers || []).find((x) => x.id === handoverId);
    if (!h) return { success: false, error: "Hand-over not found" };
    if (senderUndo) {
      const fresh = await fetchHandoverById(handoverId);
      if (fresh) h = { ...h, ...fresh };
      const st = senderUndoState(h, currentUser, Date.now());
      if (!st.allowed) {
        const msg = st.reason === "accepted" || st.reason === "not-pending" ? `${h.toDepartment} has already accepted it — Undo is no longer possible.`
                  : st.reason === "expired" ? "The 5 minutes for Undo are over — ask your admin to pull it back."
                  : st.reason === "other-sender" ? "Only the person who sent this machine can undo it."
                  : "Undo is not possible for this hand-over.";
        return { success: false, error: msg, reason: st.reason };
      }
    }
    if (h.status !== "pending") return { success: false, error: "This hand-over is no longer pending." };
    const machine = machineLog.find((m) => String(m.id) === String(h.machineId));
    const res = await adminCancelHandover(handoverId, why);
    if (!res.success) return res;
    const dateStr = fmtDate(new Date());
    const note = senderUndo && !isAdmin
      ? `Taken back by sender — ${h.fromDepartment} → ${h.toDepartment} cancelled (sent by mistake)`
      : `Pulled back by admin — ${h.fromDepartment} → ${h.toDepartment} cancelled: ${why}`;
    setHandovers((prev) => prev.map((x) => x.id === handoverId ? { ...x, status: "cancelled", cancelledAt: new Date().toISOString(), cancellationReason: why } : x));
    setMachineLog((prev) => prev.map((m) => String(m.id) === String(h.machineId)
      ? { ...m, pendingHandoverId: null, history: [...(m.history || []), { stage: m.stage, date: dateStr, note }] }
      : m));
    if (isSupabaseEnabled() && machine) {
      machineUpdate(machine.id, { pendingHandoverId: null, history: [...(machine.history || []), { stage: machine.stage, date: dateStr, note }] })
        .then((r) => { if (!r.success) flashSaveError("Pull back", `${machine.bomKey}${machine.serialNo ? ` · ${machine.serialNo}` : ""}: ${r.error || "machine not updated"}`); });
    }
    logAudit({
      type: "handover_pulled_back", module: "Machine",
      action: `${senderUndo && !isAdmin ? "Taken back by sender (Undo)" : "Pulled back by admin"}: ${machine?.bomKey || h.bomKey || ""}${(machine?.serialNo || h.serialNo) ? ` [${machine?.serialNo || h.serialNo}]` : ""} — ${h.fromDepartment} → ${h.toDepartment} cancelled`,
      ref: machine?.bomKey || h.bomKey || "", serialNo: machine?.serialNo || h.serialNo || "",
      details: { handoverId, machineId: h.machineId, from: h.fromDepartment, to: h.toDepartment, reason: why, wasOnHold: isHoldOverdue(h.sentAt, h.acceptTimeoutMinutes, Date.now()),
                 ...(senderUndo ? { senderUndo: true, sentAt: h.sentAt || null } : {}) },
    });
    return res;
  };

  // 2026-11-02 — manual ON HOLD / Release from the machine card. Local state
  // first; the database (migration 055) is the authority on who may do it and
  // stamps hold_by / hold_at itself. A refused save is rolled back on screen.
  const handleSetMachineHold = async ({ machineId, hold, reason }) => {
    if (!currentUser?.id) return { success: false, error: "Not authenticated" };
    const m = machineLog.find((x) => String(x.id) === String(machineId));
    if (!m) return { success: false, error: "Machine not found" };
    const isAdmin = currentUser?.role === "super_admin" || currentUser?.role === "Admin";
    if (!isAdmin && !authCanDo("machines", "finishTransfer") && !authCanDo("machines", "updateStage")) return { success: false, error: "You do not have permission to put a machine on hold or release it." };
    const why = String(reason || "").trim();
    if (hold && !why) return { success: false, error: "Write why the machine is being put on hold." };
    if (hold && m.holdActive) return { success: false, error: "This machine is already on hold." };
    if (!hold && !m.holdActive) return { success: false, error: "This machine is not on hold." };
    if (m.status === "completed") return { success: false, error: "A finished machine cannot be put on hold." };
    const now = new Date().toISOString();
    const dateStr = fmtDate(new Date());
    const who = currentUser?.name || currentUser?.email || "user";
    const note = hold ? `Put ON HOLD by ${who}: ${why}` : `Released from ON HOLD by ${who}${why ? `: ${why}` : ""}`;
    const nextHistory = [...(m.history || []), { stage: m.stage, date: dateStr, note }];
    const patch = hold
      ? { holdActive: true, holdReason: why, holdBy: currentUser.id, holdAt: now }
      : { holdActive: false, holdReason: "", holdBy: null, holdAt: null };
    const before = { holdActive: !!m.holdActive, holdReason: m.holdReason || "", holdBy: m.holdBy || null, holdAt: m.holdAt || null, history: m.history || [] };
    const holdAuditEntry = {
      type: hold ? "machine_hold_set" : "machine_hold_released", module: "Machine",
      action: `${hold ? "Put ON HOLD" : "Released from ON HOLD"}: ${m.bomKey}${m.serialNo ? ` [${m.serialNo}]` : ""}${why ? ` — ${why}` : ""}`,
      ref: m.bomKey, serialNo: m.serialNo || "",
      details: { machineId: m.id, department: m.currentDepartment || m.stage, reason: why, previousReason: m.holdReason || "" },
    };
    setMachineLog((prev) => prev.map((x) => String(x.id) === String(machineId) ? { ...x, ...patch, history: nextHistory } : x));
    let dbAudited = false;
    if (isSupabaseEnabled()) {
      // 063: append only this entry, so a stage change made at the same moment
      // by someone else keeps its history line too. No stage check: a hold is
      // valid at any stage.
      const r = await machineAppendHistory(m.id, {
        entries: [nextHistory[nextHistory.length - 1]],
        fullHistory: nextHistory,
        updates: { holdActive: patch.holdActive, holdReason: hold ? why : "" },
        audit: holdAuditEntry,
      });
      if (!r.success) {
        setMachineLog((prev) => prev.map((x) => String(x.id) === String(machineId) ? { ...x, ...before } : x));
        return { success: false, error: r.error || "The hold could not be saved." };
      }
      dbAudited = !!r.audited;
      // Show the database row (it carries the other person's entries, if any).
      if (r.machine) setMachineLog((prev) => prev.map((x) => String(x.id) === String(machineId) ? { ...x, history: r.machine.history, holdActive: r.machine.holdActive, holdReason: r.machine.holdReason, holdBy: r.machine.holdBy, holdAt: r.machine.holdAt } : x));
    }
    appendAuditWithUser(holdAuditEntry, dbAudited ? { mirror: false } : undefined);
    return { success: true };
  };

  // 2026-11-03 — Super Admin only. The database function delete_machine_super_admin
  // is the authority (active super_admin, one machine, linked records cascade,
  // audit snapshot written in the same transaction); the check here only keeps
  // the button honest. Stock and every other record are left alone.
  const handleDeleteMachine = async ({ machineId, reason }) => {
    if (currentUser?.role !== "super_admin") return { success: false, error: "Only a Super Admin can delete a machine." };
    const m = machineLog.find((x) => String(x.id) === String(machineId));
    if (!m) return { success: false, error: "Machine not found" };
    if (isSupabaseEnabled()) {
      const c = getSupabase();
      if (!c) return { success: false, error: "Not connected to the database." };
      let error;
      try { ({ error } = await c.rpc("delete_machine_super_admin", { p_machine_id: Number(machineId), p_reason: reason || "" })); }
      catch (e) { error = e; }
      if (error) { console.error("[App] handleDeleteMachine failed", error); return { success: false, error: error.message || "Delete failed" }; }
    } else {
      await machineDelete(machineId);
      logAudit({
        type: "machine_deleted", module: "Machine",
        action: `Machine deleted by Super Admin: ${m.bomKey}${m.serialNo ? ` [${m.serialNo}]` : ""} (stage ${m.stage})`,
        ref: m.bomKey, serialNo: m.serialNo || "",
        details: { machineId: m.id, reason: reason || "", stage: m.stage },
      });
    }
    setMachineLog((prev) => prev.filter((x) => String(x.id) !== String(machineId)));
    setPendingHandoverItems((prev) => prev.filter((p) => String(p.machineId) !== String(machineId)));
    setHandovers((prev) => prev.filter((h) => String(h.machineId) !== String(machineId)));
    return { success: true };
  };

  const handleReleaseHandover = async (handoverId) => {
    if (!currentUser?.id) return { success: false, error: "Not authenticated" };
    // 2026-10-31 — no Production Manager login yet: an Admin may release.
    const isAdmin = currentUser?.role === "super_admin" || currentUser?.role === "Admin";
    if (!authCanDo("machines", "release") && !isAdmin) return { success: false, error: "Only an admin or a production head can transfer a machine off the rack." };
    const h = (handovers || []).find((x) => x.id === handoverId);
    if (!h) return { success: false, error: "Handover not found" };
    if (h.status !== "pending") return { success: false, error: h.status === "cancelled" ? "This hand-over was pulled back — the machine is back in Assembly. Finish assembly again to send it." : "This hand-over is no longer pending." };
    if (!h.releaseRequired || h.releasedAt) return { success: false, error: "This machine is not waiting on the rack." };
    if (releaseBusyRef.current.has(handoverId)) return { success: false, error: "Transfer already in progress" };
    releaseBusyRef.current.add(handoverId);
    try {
      // 1) the hand-over row: the store only updates a pending, unreleased
      //    row, so a second device / double click fails here and nothing
      //    else is touched.
      const res = await releaseHandover(handoverId, { releasedBy: currentUser.id });
      if (!res.success) return res;
      const released = res.handover || { ...h, releasedAt: new Date().toISOString(), releasedBy: currentUser.id };
      setHandovers((prev) => prev.map((x) => x.id === handoverId ? { ...x, ...released, status: released.status || x.status } : x));
      // 2) the rack: the machine leaves its unit. Awaited, so a refused slot
      //    clear is reported; the released hand-over is the source of truth
      //    for the rack either way (rackViewLog), so the unit reads Empty.
      const machine = machineLog.find((m) => String(m.id) === String(h?.machineId));
      const cleared = await clearRackSlot(machine, `released to ${h?.toDepartment || "next department"}`);
      if (cleared && cleared.success === false) console.warn("[App] release: rack slot clear refused", cleared.error);
    logAudit({
      type: "handover_released", module: "Machine",
      action: `Released from rack to ${h?.toDepartment || "next dept"}: ${machine?.bomKey || ""}${machine?.serialNo ? ` [${machine.serialNo}]` : ""}`,
      ref: machine?.bomKey || "", serialNo: machine?.serialNo || "",
      details: { handoverId, machineId: h?.machineId, toDepartment: h?.toDepartment, slotCleared: !(cleared && cleared.success === false) },
    });
    return res;
    } finally {
      releaseBusyRef.current.delete(handoverId);
    }
  };

  const handleUploadAttachment = async ({ machineId, department, stage, file, caption, isCustomerVisible }) => {
    if (!currentUser?.id) return { success: false, error: "Not authenticated" };
    const res = await uploadAttachment({
      machineId, department, stage, file, caption,
      isCustomerVisible: !!isCustomerVisible,
      uploadedBy: currentUser.id,
    });
    if (!res.success) return res;
    setAttachments((prev) => [res.attachment, ...prev]);
    const machine = machineLog.find((m) => m.id === machineId);
    logAudit({
      type: "attachment_uploaded", module: "Machine",
      action: `Attachment uploaded (${res.attachment.kind}): ${res.attachment.fileName}`,
      ref: machine?.bomKey || "", serialNo: machine?.serialNo || "",
      details: { machineId, department, stage, size: res.attachment.fileSize, mime: res.attachment.mimeType, customerVisible: !!isCustomerVisible },
    });
    return res;
  };

  const handleDeleteAttachment = async (id) => {
    const a = attachments.find((x) => x.id === id);
    const res = await deleteAttachment(id);
    if (!res.success) return res;
    setAttachments((prev) => prev.filter((x) => x.id !== id));
    const machine = a ? machineLog.find((m) => m.id === a.machineId) : null;
    logAudit({
      type: "attachment_deleted", module: "Machine",
      action: `Attachment deleted: ${a?.fileName || id}`,
      ref: machine?.bomKey || "", serialNo: machine?.serialNo || "",
      details: { machineId: a?.machineId, department: a?.department },
    });
    return res;
  };

  return { handleUpdateMachineStage, handleStartProduction, handleReserveRackSlot, handleFillRack, handleAssignRackSlot, handleFinishTransfer, acceptHistoryEntry, promoteAcceptedMachine, handleAcceptHandover, handleSubmitDuringWorkChecklist, handlePullBackHandover, handleSetMachineHold, handleDeleteMachine, handleReleaseHandover, handleUploadAttachment, handleDeleteAttachment };
}
