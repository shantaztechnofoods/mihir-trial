// SHANTAZ ERP — inventory module writes (folder-replace Phase C, docs/SHELL-CONTEXT.md).
// Moved verbatim from src/app/App.jsx; App.jsx calls createInventoryHandlers(shell) every
// render, right after it builds the shell object, and wires the returned
// handlers into the pages exactly as before.
import { isSupabaseEnabled } from "../../config/env.js";
import { roundQty, recomputeStatus, fmtDate } from "../../shared/format.js";
import { updatePending as pendingUpdate, deletePending as pendingDelete, clearAllPending, bulkCreatePending } from "../../stores/pendingStore.js";
import { createOutward, deleteOutwardByIssueId } from "../../stores/outwardStore.js";
import { createPendingItem } from "../../stores/pendingItemsStore.js";
import { createMachine as machineCreate, deleteMachine as machineDelete } from "../../stores/machinesStore.js";
import { rackOfBom, firstFreeSlot, slotLabel, rackKeyNorm, rackViewLog } from "../../utils/rackSlots.js";
import { getSupabase } from "../../supabase/client.js";

export function createInventoryHandlers(shell) {
  const { authCanDo, currentUser, flashSaveError, flashStockError, handleUpdateStock, handovers, items, logAudit, machineLog, notifyMachineComplete, outwardLog, pendingLog, rackSlotReservationRef, reconcileItems, saveFailed, setItems, setMachineLog, setOutwardLog, setPendingHandoverItems, setPendingLog } = shell;

  const handleInwardComplete = async (code, category, inwardQty) => {
    // Auto-fulfill pending entries for this item with the newly received stock
    if (category && inwardQty > 0) {
      const pendingForCode = pendingLog.filter((p) => p.code === code && p.pendingQty > 0);
      if (pendingForCode.length > 0) {
        let remaining = inwardQty;
        let totalToDeduct = 0;
        const fulfillments = [];
        for (const p of pendingForCode) {
          if (remaining <= 0) break;
          const canFulfill = Math.min(p.pendingQty, remaining);
          remaining -= canFulfill;
          totalToDeduct += canFulfill;
          fulfillments.push({ entry: p, canFulfill });
        }
        if (totalToDeduct > 0) {
          // Wait for the move: if it is refused (Supabase), the stock stays in
          // the store, so the shortfalls must stay open too.
          const mv = await handleUpdateStock(category, code, -totalToDeduct, "Auto-fulfill pending");
          if (mv && mv.success === false) return;
          // Batch all fulfillments in one setPendingLog to avoid stale-closure overwrites
          const fulfillMap = new Map(fulfillments.map(({ entry, canFulfill }) => {
            const key = entry.issueId ? `${entry.issueId}::${entry.code}` : `${entry.code}::${entry.bomKey}::${entry.date}`;
            return [key, canFulfill];
          }));
          // 2b71bbc — functional-form setPendingLog + hoisted reducer so this call
          // stacks correctly when queued alongside other pending-fulfillment updates.
          const applyFulfill = (list) => list.reduce((acc, p) => {
            const key = p.issueId ? `${p.issueId}::${p.code}` : `${p.code}::${p.bomKey}::${p.date}`;
            const can = fulfillMap.get(key);
            if (can) {
              const rem = p.pendingQty - can;
              if (rem > 0) acc.push({ ...p, pendingQty: rem, issueQty: (p.issueQty || 0) + can });
            } else { acc.push(p); }
            return acc;
          }, []);
          const newPendingLog = applyFulfill(pendingLog);
          setPendingLog((prev) => applyFulfill(prev));
          // Mirror to Supabase: for each fulfilled entry, update or delete
          if (isSupabaseEnabled()) {
            fulfillments.forEach(({ entry, canFulfill }) => {
              if (!entry.id) return;
              const rem = entry.pendingQty - canFulfill;
              if (rem > 0) {
                pendingUpdate(entry.id, { pendingQty: rem, issueQty: (entry.issueQty || 0) + canFulfill })
                  .then((r) => { if (!r.success) console.warn("[App] handleInwardComplete: pending update Supabase failed", r.error); });
              } else {
                pendingDelete(entry.id).then((r) => { if (!r.success) console.warn("[App] handleInwardComplete: pending delete Supabase failed", r.error); });
              }
            });
          }
          // notify Machine Tracker for each issueId that is now fully cleared
          const affectedIds = [...new Set(fulfillments.map((f) => f.entry.issueId).filter(Boolean))];
          affectedIds.forEach((id) => {
            notifyMachineComplete(id, newPendingLog.filter((p) => p.issueId === id));
          });
          // The received stock went straight back out to these machines — record
          // it, or the Audit Trail shows an inward with no trace of where it went.
          logAudit({
            type: "pending_fulfilled", module: "Pending",
            action: `Auto-fulfilled on Inward: ${fulfillments[0].entry.name || code} × ${roundQty(totalToDeduct)}`,
            ref: code, itemCode: code, itemName: fulfillments[0].entry.name || code,
            qty: roundQty(totalToDeduct),
            details: { auto: "inward", items: fulfillments.map(({ entry, canFulfill }) => `${entry.bomKey || ""}${entry.serialNo ? ` [${entry.serialNo}]` : ""}×${canFulfill}`) },
          });
        }
      }
    }
  };

  const handleClearPending  = () => {
    // One tap wiped every machine's shortfall with no way back — and on the
    // Outward page the button just says "Clear", which reads like "hide this
    // banner". Both entry points now ask first.
    const n = pendingLog.length;
    if (n === 0) return;
    if (!window.confirm(`Delete ALL ${n} pending stock line${n === 1 ? "" : "s"} for every machine?\n\nThis cannot be undone. The shortfalls will no longer be tracked.`)) return;
    setPendingLog([]);
    if (isSupabaseEnabled()) clearAllPending().then((r) => { if (!r.success) console.warn("[App] Pending clear Supabase failed:", r.error); });
    logAudit({ type: "pending_cleared", module: "Pending", action: `All pending stock cleared (${n} line${n === 1 ? "" : "s"})`, ref: "",
               details: { lines: pendingLog.map((p) => `${p.bomKey || ""}${p.serialNo ? ` [${p.serialNo}]` : ""} ${p.code}×${p.pendingQty}`) } });
  };

  // handleFulfillPending is the single-row Pending-Stock fulfillment handler.
  // Owns the full mutation: stock move → pending-row reduction → audit event.
  // Matches handleFulfillGroup's contract so the two handlers are symmetric.
  //
  // criticalInput (migration 026) carries the operator's checkbox/serial
  // confirmation when the item is flagged Critical — null for non-critical
  // outward and for the system auto-fulfill paths (inward / receive-PO,
  // which call their own reducer inline and never route through here).
  const handleFulfillPending = async (entry, issuedQty, criticalInput = null) => {
    // Clamp to what is actually on hand. Without this, issuing more than the
    // stock available reduces the pending row by the full amount while
    // handleUpdateStock only moves what exists — the shortfall silently
    // disappears. qty === issuedQty whenever stock is sufficient (the normal
    // case), so this only changes the over-issue edge.
    const onHand = items[entry.category]?.find((i) => i.code === entry.code)?.stock ?? 0;
    const qty = Math.max(0, Math.min(issuedQty, onHand));
    if (qty <= 0) {
      flashStockError(`${entry.name || entry.code}: no stock on hand to issue`);
      return;
    }
    // Move stock first and WAIT. On a Supabase failure handleUpdateStock reverts
    // the optimistic UI to DB truth, so we must not touch pending_log — otherwise
    // the stock comes back but the shortfall is already gone. Local mode always
    // resolves success, so this is a no-op delay there.
    const moveRes = await handleUpdateStock(entry.category, entry.code, -qty, `Fulfill: ${entry.bomKey}`);
    if (moveRes && moveRes.success === false) return;

    const issuedQtyApplied = qty;
    const matched = (p) => entry.issueId
      ? (p.issueId === entry.issueId && p.code === entry.code)
      : (p.code === entry.code && p.bomKey === entry.bomKey && p.date === entry.date);
    // 2b71bbc — functional-form setPendingLog + hoisted reducer so successive
    // Give Material clicks on different rows stack correctly even inside the
    // same React batch.
    const applyFulfill = (list) => list.reduce((acc, p) => {
      if (matched(p)) {
        const rem = p.pendingQty - issuedQtyApplied;
        if (rem > 0) acc.push({ ...p, pendingQty: rem, issueQty: (p.issueQty || 0) + issuedQtyApplied });
      } else { acc.push(p); }
      return acc;
    }, []);
    const newLog = applyFulfill(pendingLog);
    setPendingLog((prev) => applyFulfill(prev));
    if (isSupabaseEnabled()) {
      const matchedRow = pendingLog.find(matched);
      if (matchedRow && matchedRow.id) {
        const rem = matchedRow.pendingQty - issuedQtyApplied;
        if (rem > 0) pendingUpdate(matchedRow.id, { pendingQty: rem, issueQty: (matchedRow.issueQty || 0) + issuedQtyApplied }).then((r) => { if (!r.success) console.warn("[App] Pending update Supabase failed:", r.error); });
        else pendingDelete(matchedRow.id).then((r) => { if (!r.success) console.warn("[App] Pending delete Supabase failed:", r.error); });
      }
    }
    notifyMachineComplete(entry.issueId, newLog);
    logAudit({
      type: "pending_fulfilled", module: "Pending",
      action: `Fulfilled: ${entry.name || entry.code} × ${issuedQtyApplied}`,
      ref: entry.issueId || entry.code,
      itemCode: entry.code, itemName: entry.name || entry.code,
      qty: issuedQtyApplied, serialNo: entry.serialNo || "",
      details: {
        bomKey: entry.bomKey,
        criticalInput: criticalInput || undefined,
      },
    });
  };

  // Atomic batch fulfillment for "Give All" — avoids stale-closure issues.
  // itemsToFulfill may carry a per-line `criticalInput` from the PendingPage
  // confirmation modal (migration 026); it's forwarded into the audit payload
  // so compliance queries can see which serials / checkboxes closed the row.
  const handleFulfillGroup = async (issueId, itemsToFulfill) => {
    // Same two guards as handleFulfillPending: never take more than is on
    // hand (an over-issue floored stock at 0 while the pending row dropped by
    // the full amount — the shortfall just disappeared), and only reduce the
    // pending rows whose stock move actually went through.
    const onHandLeft = {};
    const clamped = (itemsToFulfill || []).map((e) => {
      if (!(e.code in onHandLeft)) onHandLeft[e.code] = items[e.category]?.find((i) => i.code === e.code)?.stock ?? 0;
      const can = roundQty(Math.max(0, Math.min(Number(e.canIssue) || 0, onHandLeft[e.code])));
      onHandLeft[e.code] = roundQty(onHandLeft[e.code] - can);
      return { ...e, canIssue: can };
    }).filter((e) => e.canIssue > 0);
    if (clamped.length === 0) { flashStockError("No stock on hand to issue"); return; }
    const moves = await Promise.all(clamped.map((e) =>
      Promise.resolve(handleUpdateStock(e.category, e.code, -e.canIssue, `Fulfill: ${e.bomKey}`))
        .then((r) => ({ e, ok: !(r && r.success === false) }), () => ({ e, ok: false }))
    ));
    itemsToFulfill = moves.filter((m) => m.ok).map((m) => m.e);
    if (itemsToFulfill.length === 0) return;
    const canMap = Object.fromEntries(itemsToFulfill.map((e) => [e.code, e.canIssue]));
    // 2b71bbc — functional-form setPendingLog + hoisted reducer so Fulfill All
    // on multiple groups stacks instead of overwriting earlier updates.
    const applyFulfill = (list) => list.reduce((acc, p) => {
      if (p.issueId !== issueId) { acc.push(p); return acc; }
      const can = canMap[p.code];
      if (!can) { acc.push(p); return acc; }
      const rem = p.pendingQty - can;
      if (rem > 0) acc.push({ ...p, pendingQty: rem, issueQty: (p.issueQty || 0) + can });
      return acc;
    }, []);
    const newLog = applyFulfill(pendingLog);
    setPendingLog((prev) => applyFulfill(prev));
    if (isSupabaseEnabled()) {
      // Per affected row: update or delete in Supabase
      pendingLog.filter((p) => p.issueId === issueId && canMap[p.code]).forEach((p) => {
        const can = canMap[p.code];
        const rem = p.pendingQty - can;
        if (p.id) {
          if (rem > 0) pendingUpdate(p.id, { pendingQty: rem, issueQty: (p.issueQty || 0) + can }).then((r) => { if (!r.success) console.warn("[App] Pending group-update Supabase failed:", r.error); });
          else pendingDelete(p.id).then((r) => { if (!r.success) console.warn("[App] Pending group-delete Supabase failed:", r.error); });
        }
      });
    }
    notifyMachineComplete(issueId, newLog);
    const criticalConfirmations = itemsToFulfill
      .filter((e) => e && e.criticalInput)
      .map((e) => ({ code: e.code, name: e.name, qty: e.canIssue, input: e.criticalInput }));
    logAudit({
      type: "pending_fulfilled", module: "Pending",
      action: `Batch Fulfilled: ${itemsToFulfill.length} items for Issue #${issueId}`,
      ref: String(issueId),
      qty: itemsToFulfill.reduce((s, e) => s + e.canIssue, 0),
      details: {
        items: itemsToFulfill.map((e) => `${e.code}×${e.canIssue}`),
        criticalConfirmations: criticalConfirmations.length ? criticalConfirmations : undefined,
      },
    });
  };

  const handleAddOutward = (entry, pending) => {
    setOutwardLog((prev) => [entry, ...prev]);
    if (entry && entry.rackCrate) {
      logAudit({
        type: "rack_crate_filled", module: "Machine",
        action: `R crate filled on ${slotLabel(entry.rackCrate.slotId)}: ${entry.ref} [${entry.serialNo}] — same serial as ${slotLabel(entry.rackCrate.setId)}`,
        ref: entry.ref, serialNo: entry.serialNo || "",
        details: { slotId: entry.rackCrate.slotId, setId: entry.rackCrate.setId, machineId: entry.rackCrate.machineId, issueId: entry.id },
      });
    }
    // The stock has already left by the time we get here, and this row is the
    // only record of where it went. Lose it and inventory shows an unexplained
    // drop that nothing in the ERP can account for.
    if (isSupabaseEnabled()) createOutward(entry).then((r) => {
      if (!r.success) {
        console.warn("[App] Outward Supabase failed:", r.error);
        flashSaveError("Outward record",
          `${entry.ref}${entry.serialNo ? ` · ${entry.serialNo}` : ""}: stock was issued but the outward entry was not saved — ${r.error || "unknown error"}`);
      }
    });
    if (pending && pending.length > 0) {
      const issueId = entry.id;
      const rows = pending.map((p) => ({ ...p, bomKey: entry.ref, bomLabel: entry.label, date: entry.date, issueId, serialNo: entry.serialNo || "" }));
      setPendingLog((prev) => [...rows, ...prev]);
      // Losing these leaves the Pending Stock page empty after a reload, so the
      // shortfall is never chased and the machine sits blocked with no visible
      // reason why.
      if (isSupabaseEnabled()) bulkCreatePending(rows).then((r) => {
        if (!r.success) {
          console.warn("[App] Pending bulk-create Supabase failed:", r.error);
          flashSaveError("Pending Stock shortfall",
            `${entry.ref}: ${rows.length} shortfall line${rows.length === 1 ? "" : "s"} were not saved — ${r.error || "unknown error"}`);
          return;
        }
        // Adopt the ids Postgres assigned — the same trap as handleCreateMachine.
        //
        // These rows are built client-side and have no `id` at all. Every later
        // write addresses a pending row by id, and both fulfil paths guard with
        // `if (matchedRow && matchedRow.id)` — so fulfilling a shortfall created
        // in this same session skipped Postgres entirely and logged nothing. The
        // row came back on the next reload and could be issued a second time.
        //
        // It looked intermittent for the same reason the machine bug did:
        // pending_log has a realtime subscription, so if a refetch landed first
        // the id-less rows had already been replaced by real ones.
        const saved = Array.isArray(r.entries) ? r.entries : [];
        if (saved.length > 0) {
          setPendingLog((prev) => {
            const byKey = new Map(saved.map((e) => [`${e.issueId}|${e.code}`, e]));
            return prev.map((p) => {
              if (p.id != null) return p;
              const match = byKey.get(`${p.issueId}|${p.code}`);
              return match ? { ...p, id: match.id } : p;
            });
          });
        }
        if (saved.length !== rows.length) {
          console.warn("[App] Pending bulk-create: saved", saved.length, "of", rows.length);
          flashSaveError("Pending Stock shortfall",
            `${entry.ref}: only ${saved.length} of ${rows.length} shortfall lines came back from the database. Reload before issuing against them.`);
        }
      });
    }
    if (entry.type === "bom") {
      // Migration 026 — surface critical-item confirmations in the audit so a
      // compliance review can read what the operator ticked / entered without
      // joining into outward_log.items jsonb. One line per critical component,
      // carrying either { confirmed: true } or { serials: [...] }.
      const criticalConfirmations = (entry.items || [])
        .filter((it) => it && it.criticalInput)
        .map((it) => ({ code: it.code, name: it.name, qty: it.issueQty, input: it.criticalInput }));
      logAudit({
        type: "outward_bom", module: "Outward",
        action: `BOM Issued: ${entry.ref} × ${entry.units}`,
        ref: entry.ref, serialNo: entry.serialNo || "", qty: entry.units,
        details: {
          label: entry.label,
          issued: (entry.items || []).filter((it) => Number(it.issueQty) > 0).length,
          pending: (pending || []).length,
          // Critical items deliberately left out at issue, with the reason.
          notIssued: (entry.items || []).filter((it) => it?.criticalInput?.notIssued)
            .map((it) => ({ code: it.code, name: it.name, qty: it.criticalInput.requiredQty, remark: it.criticalInput.remark })),
          criticalConfirmations: criticalConfirmations.length ? criticalConfirmations : undefined,
        },
      });
    } else {
      const it = (entry.items || [])[0] || {};
      logAudit({ type: "outward_manual", module: "Outward", action: `Manual Outward: ${it.name || ""} × ${it.issueQty || 0}`, ref: it.code || "", itemCode: it.code || "", itemName: it.name || "", qty: it.issueQty || 0, details: { dept: entry.dept } });
    }
  };

  // 2026-10-30 / 2026-10-31 — every critical item not issued at BOM Outward
  // (Not verified + reason) becomes an open pending job on its machine: item,
  // quantity still owed, reason, the machine (serial) and — for a rack
  // machine — the rack it sits on. No stock moves for it. Used by a new
  // machine (M BOM / direct) and by an R crate filled for an existing one.
  const raiseNotIssuedJobs = ({ machineId, notIssued = [], bomKey, serialNo, issueId = null, rackSlot = null, extraPending = [] }) => {
    for (const it of (Array.isArray(notIssued) ? notIssued : [])) {
      if (!it || !it.code) continue;
      const qtyTxt = it.qty ? ` × ${it.qty}${it.unit ? ` ${it.unit}` : ""}` : "";
      const rackTxt = rackSlot ? ` · rack ${slotLabel(rackSlot)}` : "";
      createPendingItem({
        machineId,
        raisedInHandoverId: null,
        raisedInDepartment: "Stores",
        assignedDepartment: "Stores",
        raisedBy: currentUser?.id || null,
        description: `Part not issued at BOM Outward: ${it.name || it.code}${qtyTxt} (${bomKey}${serialNo ? ` · S/N ${serialNo}` : ""}${rackTxt})`,
        kind: "owed",
        itemCode: it.code, itemName: it.name || "", qty: it.qty || null, reason: it.remark || "",
        // "Not verified" critical lines are critical jobs; lines simply left
        // unselected carry their Item Master flag (migration 052 `source`).
        critical: it.critical !== false && !(it.criticalInput && it.criticalInput.unselected && !it.criticalInput.critical), source: "not_issued",
      }).then((pr) => {
        if (!pr.success) {
          console.warn("[App] not-issued pending job save failed", pr.error);
          flashSaveError("Pending job not saved", `${bomKey}${serialNo ? ` · ${serialNo}` : ""}: part not issued ${it.name || it.code}${qtyTxt} — ${pr.error || "unknown error"}. Raise it from the machine card.`);
          return;
        }
        setPendingHandoverItems((prev) => [pr.item, ...prev]);
        logAudit({
          type: "pending_item_raised", module: "Machine",
          action: `Part not issued at Outward: ${it.name || it.code}${qtyTxt} — ${bomKey}${serialNo ? ` [${serialNo}]` : ""}${rackTxt}`,
          ref: bomKey, serialNo: serialNo || "",
          details: { machineId, itemId: pr.item?.id, kind: "owed", assignedDepartment: "Stores", itemCode: it.code, itemName: it.name || "", qty: it.qty || null, reason: it.remark || "", issueId, slotId: rackSlot || null },
        });
      });
    }
    // 2026-11-01 (migration 052) — items the operator added at BOM Outward.
    // Same pending-job record as everything else, so they move with the
    // machine across departments and keep their own history; they carry the
    // Critical / Normal call, the part's serial and source 'bom_outward'.
    // No stock is deducted and no Item Master row is created for them.
    for (const j of (Array.isArray(extraPending) ? extraPending : [])) {
      if (!j || (!j.description && !j.itemCode && !j.itemName)) continue;
      const partName = j.itemName || j.itemCode || "part";
      const qtyTxt   = j.qty ? ` × ${j.qty}` : "";
      const snTxt    = j.partSerialNo ? ` · part S/N ${j.partSerialNo}` : "";
      createPendingItem({
        machineId,
        raisedInHandoverId: null,
        raisedInDepartment: "Stores",
        assignedDepartment: "Stores",
        raisedBy: currentUser?.id || null,
        description: j.description || `Pending item added at BOM Outward: ${partName}${qtyTxt}`,
        kind: "owed",
        itemCode: j.itemCode || "", itemName: j.itemName || "", qty: j.qty ?? null, reason: j.reason || "",
        critical: !!j.critical, partSerialNo: j.partSerialNo || "", source: "bom_outward",
        criticalChecks: j.criticalChecks || null,
      }).then((pr) => {
        if (!pr.success) {
          console.warn("[App] outward pending item save failed", pr.error);
          flashSaveError("Pending item not saved", `${bomKey}${serialNo ? ` · ${serialNo}` : ""}: ${partName}${qtyTxt} — ${pr.error || "unknown error"}. Raise it from the machine card.`);
          return;
        }
        setPendingHandoverItems((prev) => [pr.item, ...prev]);
        logAudit({
          type: "pending_item_raised", module: "Machine",
          action: `${j.critical ? "Critical" : "Normal"} pending item added at Outward: ${partName}${qtyTxt}${snTxt} — ${bomKey}${serialNo ? ` [${serialNo}]` : ""}`,
          ref: bomKey, serialNo: serialNo || "",
          details: { machineId, itemId: pr.item?.id, kind: "owed", assignedDepartment: "Stores", source: "bom_outward",
                     itemCode: j.itemCode || "", itemName: j.itemName || "", qty: j.qty ?? null, reason: j.reason || "",
                     critical: !!j.critical, partSerialNo: j.partSerialNo || "", issueId },
        });
      });
    }
  };

  // BOM Issue order (2026-11-02, go-live): in Supabase mode the machine row is
  // created and AWAITED here before any stock moves — BOMDrawer calls this
  // through onCreateMachineFirst, then runs the stock movements, then writes
  // the outward row. If the insert fails nothing else happens: no stock
  // deduction, no outward row, and the operator sees the error. The audit
  // entry is written only after the row exists. Local mode is unchanged
  // (immediate). Returns { success, machine } so the caller can abort the
  // issue (handleAbortMachineCreate) if a later stock movement is refused.
  const handleCreateMachine = async (bomKey, bomLabel, serialNo, date, issueId, destination = "rack", deptDurations = null, notIssued = [], preferredSlot = null, extraPending = []) => {
    const dateStr = date || fmtDate(new Date());
    // Feature 1: direct production lands the machine in Assembly immediately,
    // skipping the BOM Issued / rack waiting stage. Used for R&D, prototypes,
    // one-off / custom builds where there's no batch to wait for.
    const directMode = destination === "direct";
    const initialStage = directMode ? "Assembly" : "BOM Issued";
    const initialNote  = directMode ? "BOM issued — direct production" : "BOM issued";
    const auditCreated = (machineId) => logAudit({
      type: "machine_created", module: "Machine",
      action: `Machine Created: ${bomKey}${directMode ? " (direct production)" : ""}`,
      ref: bomKey, serialNo: serialNo || "",
      details: { bomLabel, issueId, destination, initialStage, deptDurations: deptDurations || undefined, machineId },
    });
    const history = [{ stage: initialStage, date: dateStr, note: initialNote }];
    // If we skipped the rack, also record the implicit BOM Issued → Assembly
    // transition so the machine's history is honest about what happened.
    if (directMode) history.unshift({ stage: "BOM Issued", date: dateStr, note: "BOM issued (auto-promoted)" });
    // Phase A: track department ownership. Direct machines start the Assembly
    // clock immediately; rack-bound machines stay at "BOM Issued" until Start
    // Production (handleStartProduction below) resets the clock to Assembly.
    const nowIso = new Date().toISOString();
    // 2026-10-31 — rack slot (brief §14): the reserved slot from a Fill action
    // when it is for this model and still empty, else the first free slot.
    // Direct production never takes a slot.
    let rackSlot = null;
    if (!directMode) {
      const awaiting = new Set((handovers || []).filter((h) => h && h.status === "pending" && h.releaseRequired && !h.releasedAt).map((h) => String(h.machineId)));
      const reserved = rackSlotReservationRef.current;
      // The rack the operator picked (BOM Outward) wins; else a Fill reservation.
      const preferred = preferredSlot || (reserved && (!reserved.bomKey || rackKeyNorm(reserved.bomKey) === rackKeyNorm(bomKey)) ? reserved.slotId : null);
      rackSlot = firstFreeSlot(bomKey, rackViewLog(machineLog, handovers), awaiting, preferred);
      if (rackSlot) rackSlotReservationRef.current = null;
    }
    const newMachine = {
      id:          Date.now(),
      issueId:     issueId || null,
      bomKey,
      bomLabel,
      serialNo,
      rackSlot,
      stage:       initialStage,
      status:      "active",
      createdDate: dateStr,
      completedDate: null,
      history,
      currentDepartment:   initialStage,
      departmentEnteredAt: nowIso,
      pendingHandoverId:   null,
      // Migration 027 — per-machine duration overrides captured at Outward.
      // Null when the operator skipped the popup (should not happen for serial
      // path, but allow it so legacy paths and tests don't break).
      deptDurations:       deptDurations || null,
    };
    const auditSlot = () => {
      if (!rackSlot) return;
      logAudit({
        type: "rack_slot_assigned", module: "Machine",
        action: `Placed on rack ${slotLabel(rackSlot)}: ${bomKey}${serialNo ? ` [${serialNo}]` : ""}`,
        ref: bomKey, serialNo: serialNo || "",
        details: { slotId: rackSlot, how: "bom_outward", issueId },
      });
    };
    // 2026-10-30 — every critical item not issued at Outward becomes a pending
    // job on this machine: part missing, owed by Stores, with the reason the
    // store operator wrote. Kind 'owed': the machine may move through the
    // departments but cannot be marked Ready until the part is received and
    // the work completed. Raised once the machine's real id is known.
    const raiseNotIssued = (machineId) => raiseNotIssuedJobs({ machineId, notIssued, bomKey, serialNo, issueId, rackSlot, extraPending });
    if (!isSupabaseEnabled()) {
      setMachineLog((prev) => [newMachine, ...prev]);
      auditCreated(newMachine.id);
      auditSlot();
      raiseNotIssued(newMachine.id);
      return { success: true, machine: newMachine };
    }
    // Adopt the id Postgres assigned.
    //
    // `machine_log.id` is a bigserial. The `Date.now()` above is a placeholder
    // so the row has a React key, nothing more — the database picks its own id
    // on insert. machineCreate has always returned that row, and we used to
    // throw it away. Every later write addressed the machine by the
    // placeholder: `.eq("id", 1761700000000)` is type-valid and matches nothing,
    // and a zero-row UPDATE reports no error, so Start Production, stage
    // changes, Accept and Finish & Transfer could all "succeed" against a row
    // that does not exist. Found 2026-10-29. The insert is awaited now, so the
    // local row is only ever added with the real id.
    const r = await machineCreate(newMachine);
    if (!r.success) {
      saveFailed("Machine create", r.error);
      flashSaveError("Machine not saved", `${bomKey}${serialNo ? ` · ${serialNo}` : ""}: ${r.error || "unknown error"}`);
      return { success: false, error: r.error || "Machine not saved" };
    }
    const realId = r.machine && r.machine.id != null ? r.machine.id : newMachine.id;
    const saved = { ...newMachine, id: realId };
    // A realtime refetch may already have landed the row — never duplicate it.
    setMachineLog((prev) => [saved, ...prev.filter((m) => String(m.id) !== String(realId))]);
    auditCreated(realId);
    auditSlot();
    raiseNotIssued(realId);
    return { success: true, machine: saved };
  };

  // Compensation for the order above: the machine row exists but a stock
  // movement for its BOM was refused, so the issue is aborted. The lines that
  // did move have already been reversed by the caller (BOMDrawer); this
  // removes the machine again (its pending jobs cascade in the database) and
  // records why. If the delete itself fails the operator is told: a machine
  // with no materials behind it is then on the rack and must be removed with
  // Remove From Rack. Nothing in this path touches stock.
  const handleAbortMachineCreate = async (machineId, why) => {
    const machine = machineLog.find((m) => String(m.id) === String(machineId));
    setMachineLog((prev) => prev.filter((m) => String(m.id) !== String(machineId)));
    setPendingHandoverItems((prev) => prev.filter((p) => String(p.machineId) !== String(machineId)));
    let persisted = true;
    if (isSupabaseEnabled()) {
      const r = await machineDelete(machineId);
      if (!r.success) {
        persisted = false;
        console.warn("[App] handleAbortMachineCreate: machine delete failed", r.error);
        flashSaveError("Issue aborted — machine not removed",
          `${machine?.bomKey || ""}${machine?.serialNo ? ` · ${machine.serialNo}` : ""}: the stock was not issued but the machine record could not be deleted — ${r.error || "unknown error"}. Use Remove From Rack.`);
      }
    } else {
      machineDelete(machineId);
    }
    logAudit({
      type: "machine_issue_aborted", module: "Machine",
      action: `BOM issue aborted: ${machine?.bomKey || ""}${machine?.serialNo ? ` [${machine.serialNo}]` : ""} — ${why || "stock movement refused"}`,
      ref: machine?.bomKey || "", serialNo: machine?.serialNo || "",
      details: { machineId, why: why || "", issueId: machine?.issueId || null, persisted },
    });
    return { success: persisted };
  };

  // Feature 3: remove a machine from the rack. Restores the materials that
  // were issued to inventory, deletes the outward + pending rows for the
  // issue, and removes the machine. Refuses if the machine isn't on the rack
  // anymore — anything past Assembly is already being built and reversing
  // would break stock integrity.
  const handleRemoveRackMachine = async (machineId) => {
    if (!authCanDo("outward", "delete")) return { success: false, error: "You do not have permission to remove a set from the rack (Outward → Delete)." };
    const machine = machineLog.find((m) => String(m.id) === String(machineId));
    if (!machine) return { success: false, error: "Machine not found" };
    if (machine.stage !== "BOM Issued") {
      return { success: false, error: `Cannot remove — machine is in ${machine.stage}, not on rack` };
    }
    // Find the matching outward entry by issueId — plus, for an M/R rack set,
    // the R crate's own outward (R BOM under the same serial). Both racks are
    // emptied and both BOMs' stock is returned.
    const outwardEntry = outwardLog.find((e) => String(e.id) === String(machine.issueId));
    const famR = rackOfBom(machine.bomKey);
    const sn = String(machine.serialNo || "").trim().toLowerCase();
    // Units are independent: only this machine's own BOM outwards (same BOM
    // key and serial — e.g. pending parts issued to it later) are returned.
    const crateEntries = famR && sn ? outwardLog.filter((e) => e && e.type === "bom" && String(e.id) !== String(machine.issueId)
      && String(e.serialNo || "").trim().toLowerCase() === sn && rackKeyNorm(e.ref) === rackKeyNorm(machine.bomKey)) : [];
    const entries = [outwardEntry, ...crateEntries].filter(Boolean);
    const issueIds = [...new Set([machine.issueId, ...crateEntries.map((e) => e.id)].filter((x) => x != null).map(String))];
    const issuedLines  = entries.flatMap((e) => (e.items || []).filter((it) => Number(it.issueQty) > 0));

    // Supabase mode (migration 053): one atomic, idempotent call —
    // rack_remove_machine returns the stock for the machine's outward lines,
    // deletes the outward + pending rows and the machine, in one transaction.
    // The old four-step client sequence could stop half way (stock back,
    // machine still on the rack). The result is applied to local state only:
    // the stock has already moved in the database, so no second movement is
    // recorded here. The audit entry is written after the call succeeds.
    if (isSupabaseEnabled()) {
      const c = getSupabase();
      if (!c) return { success: false, error: "Not connected to the database." };
      let data, error;
      try {
        ({ data, error } = await c.rpc("rack_remove_machine", { p_machine_id: Number(machineId) }));
      } catch (e) { error = e; }
      if (error) {
        console.error("[App] handleRemoveRackMachine: rack_remove_machine failed", error);
        return { success: false, error: `${error.message || "Remove failed"}. Nothing was removed — the set is still on the rack.` };
      }
      const res = data || {};
      const outIds = new Set((res.outward_ids || []).map(String));
      const pendIds = new Set((res.pending_ids || []).map(String));
      const returned = Array.isArray(res.returned) ? res.returned : [];
      setMachineLog((prev) => prev.filter((m) => String(m.id) !== String(machineId)));
      setPendingHandoverItems((prev) => prev.filter((p) => String(p.machineId) !== String(machineId)));
      if (outIds.size || issueIds.length) {
        setOutwardLog((prev) => prev.filter((e) => !outIds.has(String(e.id)) && !issueIds.includes(String(e.id))));
      }
      if (pendIds.size) setPendingLog((prev) => prev.filter((p) => !pendIds.has(String(p.id))));
      if (!res.already_removed && returned.length) {
        // Local stock only — the movement rows were written by the function.
        setItems((prev) => {
          const next = { ...prev };
          for (const line of returned) {
            const code = line && line.code; if (!code) continue;
            for (const cat of Object.keys(next)) {
              if (!(next[cat] || []).some((i) => i && i.code === code)) continue;
              next[cat] = next[cat].map((i) => {
                if (i.code !== code) return i;
                const newStock = line.after_stock != null ? Number(line.after_stock) : (Number(i.stock) || 0) + (Number(line.qty) || 0);
                return { ...i, stock: newStock, status: recomputeStatus(newStock, i.min), trend: [...(i.trend || []).slice(1), newStock] };
              });
            }
          }
          return next;
        });
        reconcileItems();   // and pull the DB truth (history rows) behind it
      }
      logAudit({
        type: "machine_rack_removed", module: "Machine",
        action: `Rack build removed${machine.rackSlot ? ` from ${slotLabel(machine.rackSlot)}` : ""}: ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""} — ${res.already_removed ? "already removed (state synced)" : `${returned.length} component(s) returned to stock`}`,
        ref: machine.bomKey, serialNo: machine.serialNo || "",
        details: { rackSlot: machine.rackSlot || null, slotId: machine.rackSlot || null, issueId: machine.issueId, crateIssueIds: crateEntries.map((e) => e.id), alreadyRemoved: !!res.already_removed, restored: returned.map((l) => ({ code: l.code, qty: l.qty })), outwardIds: res.outward_ids || [], pendingIds: res.pending_ids || [] },
      });
      return { success: true, restored: returned.length, alreadyRemoved: !!res.already_removed };
    }

    // Local mode — the client-side sequence below is unchanged.
    // 1) Reverse stock for each issued component. Fire one stock movement
    //    per line via the canonical engine so the audit trail mentions the
    //    machine's serial number.
    // All-or-nothing (2026-10-31): if any line cannot be returned, the lines
    // already returned are deducted again and nothing else is removed — the
    // set stays on the rack and the operator is told which item failed.
    if (issuedLines.length > 0) {
      const reversalRef = `Rack remove: ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""}`;
      const done = []; const failed = [];
      for (const li of issuedLines) {
        const cat = li.category || Object.keys(items).find((c) => (items[c] || []).some((i) => i.code === li.code));
        const qty = Number(li.issueQty) || 0;
        if (!cat) { failed.push({ code: li.code, error: "not in the Item Master" }); break; }
        try {
          const res = await handleUpdateStock(cat, li.code, +qty, reversalRef);
          if (res && res.success === false) { failed.push({ code: li.code, error: res.error || "rejected" }); break; }
          done.push({ cat, code: li.code, qty });
        } catch (e) {
          console.error("[App] handleRemoveRackMachine: stock reversal failed", e);
          failed.push({ code: li.code, error: e?.message || "failed" }); break;
        }
      }
      if (failed.length) {
        for (const d of done) {
          try { await handleUpdateStock(d.cat, d.code, -d.qty, `${reversalRef} — undo (remove aborted)`); } catch (e) { console.error("[App] handleRemoveRackMachine: undo failed", e); }
        }
        return { success: false, error: `Stock could not be returned for ${failed.map((f) => `${f.code} (${f.error})`).join(", ")}. Nothing was removed — the set is still on the rack.` };
      }
    }

    // 2) Remove pending entries for these issues (these were waiting on inward)
    if (issueIds.length) {
      const orphans = pendingLog.filter((p) => issueIds.includes(String(p.issueId)));
      if (orphans.length > 0) {
        setPendingLog((prev) => prev.filter((p) => !issueIds.includes(String(p.issueId))));
        if (isSupabaseEnabled()) {
          orphans.forEach((p) => {
            if (p.id) pendingDelete(p.id).then((r) => { if (!r.success) console.warn("[App] handleRemoveRackMachine: pending delete failed", r.error); });
          });
        }
      }
    }

    // 3) Remove the outward entries so reports don't double-count
    if (issueIds.length) {
      setOutwardLog((prev) => prev.filter((e) => !issueIds.includes(String(e.id))));
      if (isSupabaseEnabled()) {
        issueIds.forEach((iid) => deleteOutwardByIssueId(iid).then((r) => { if (!r.success) console.warn("[App] handleRemoveRackMachine: outward delete failed", r.error); }));
      }
    }

    // 4) Remove the machine itself
    setMachineLog((prev) => prev.filter((m) => String(m.id) !== String(machineId)));
    if (isSupabaseEnabled()) {
      machineDelete(machineId).then((r) => { if (!r.success) console.warn("[App] handleRemoveRackMachine: machine delete failed", r.error); });
    }

    logAudit({
      type: "machine_rack_removed", module: "Machine",
      action: `Rack build removed${machine.rackSlot ? ` from ${slotLabel(machine.rackSlot)}` : ""}: ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""} — ${issuedLines.length} component(s) returned to stock`,
      ref: machine.bomKey, serialNo: machine.serialNo || "",
      details: { rackSlot: machine.rackSlot || null, slotId: machine.rackSlot || null, issueId: machine.issueId, crateIssueIds: crateEntries.map((e) => e.id), restored: issuedLines.map((l) => ({ code: l.code, qty: l.issueQty })) },
    });

    return { success: true, restored: issuedLines.length };
  };

  return { handleInwardComplete, handleClearPending, handleFulfillPending, handleFulfillGroup, handleAddOutward, raiseNotIssuedJobs, handleCreateMachine, handleAbortMachineCreate, handleRemoveRackMachine };
}
