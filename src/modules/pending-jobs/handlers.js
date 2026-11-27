// SHANTAZ ERP — pending-jobs module writes (folder-replace Phase C, docs/SHELL-CONTEXT.md).
// Moved verbatim from src/app/App.jsx; App.jsx calls createPendingJobsHandlers(shell) every
// render, right after it builds the shell object, and wires the returned
// handlers into the pages exactly as before. handleAddOutward belongs to
// inventory (BOM issue) and is reached through shell.call ("inventory.addOutward").
import { isSupabaseEnabled } from "../../config/env.js";
import { fmtDate } from "../../shared/format.js";
import { canFinishTransfer } from "../../utils/handoverLogic.js";
import { slotLabel } from "../../utils/rackSlots.js";
import { createPendingItem, resolvePendingItem, receivePendingItem, receivePendingPart, pendingItemIsPart } from "../../stores/pendingItemsStore.js";
import { waAlertTime } from "../whatsapp/index.js";

export function createPendingJobsHandlers(shell) {
  const { authCanDo, call, currentUser, handleUpdateStock, issuePendingRef, items, logAudit, machineLog, pendingHandoverItems, receivePartRef, reconcileItems, sendWhatsApp, setPendingHandoverItems, settings } = shell;
  const handleAddOutward = (...args) => call("inventory.addOutward", ...args);

  // Phase 1 — raise a fault mid-work against the department that must fix it.
  // Distinct from the Accept-time pending items: those blame the previous
  // department at handover, this one calls any department back to a machine
  // that is already being worked on. The machine never moves backwards.
  const handleRaisePendingItem = async ({ machineId, description, assignedDepartment, raisedInDepartment, itemCode = "", itemName = "", qty = null, reason = "" }) => {
    if (!currentUser?.id) return { success: false, error: "Not authenticated" };
    const desc = String(description || "").trim();
    if (!desc) return { success: false, error: "Describe the issue." };
    const machine = machineLog.find((m) => m.id === machineId);
    if (!machine) return { success: false, error: "Machine not found" };
    const res = await createPendingItem({
      machineId,
      raisedInHandoverId: null,
      raisedInDepartment: raisedInDepartment || machine.currentDepartment || machine.stage || "",
      raisedBy: currentUser.id,
      description: desc,
      assignedDepartment: assignedDepartment || null,
      kind: "fault",
      itemCode, itemName, qty, reason,
    });
    if (!res.success) return res;
    setPendingHandoverItems((prev) => [res.item, ...prev]);
    logAudit({
      type: "pending_item_raised", module: "Machine",
      action: `Issue raised${assignedDepartment ? ` for ${assignedDepartment}` : ""}: ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""}`,
      ref: machine.bomKey, serialNo: machine.serialNo || "",
      details: {
        machineId, itemId: res.item?.id,
        raisedInDepartment: raisedInDepartment || machine.currentDepartment || machine.stage || "",
        assignedDepartment: assignedDepartment || null,
        description: desc,
        itemCode: itemCode || undefined, qty: qty ?? undefined, reason: reason || undefined,
      },
    });

    // ── WhatsApp trigger: issue raised ──
    if (settings.waNotifyIssue) {
      const msg = `🔴 Issue Raised\nMachine: ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""}\nDept: ${assignedDepartment || "General"}\nIssue: ${desc}`;
      const params = [
        "Issue Raised",
        `${machine.bomKey}${machine.serialNo ? ` (${machine.serialNo})` : ""}`,
        assignedDepartment || "General",
        desc,
        waAlertTime(),
      ];
      if (settings.waOwnerPhone) sendWhatsApp(settings.waOwnerPhone, msg, params);
      if (settings.waGroupNumbers) sendWhatsApp(settings.waGroupNumbers, msg, params);
    }

    return res;
  };

  const handleResolvePendingItem = async (id, { notes }) => {
    const machine = (() => {
      const p = pendingHandoverItems.find((x) => x.id === id);
      if (!p) return null;
      return machineLog.find((m) => m.id === p.machineId) || null;
    })();
    const res = await resolvePendingItem(id, {
      resolvedBy: currentUser?.id,
      resolvedInDepartment: machine?.currentDepartment || machine?.stage || "",
      notes,
    });
    if (!res.success) return res;
    setPendingHandoverItems((prev) => prev.map((p) => p.id === id
      ? { ...p, status: "resolved", resolvedBy: currentUser?.id, resolvedAt: new Date().toISOString(), resolvedInDepartment: machine?.currentDepartment || machine?.stage || "", resolutionNotes: notes || "" }
      : p));
    logAudit({
      type: "pending_item_resolved", module: "Machine",
      action: `Pending item resolved${machine ? ` for ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""}` : ""}`,
      ref: machine?.bomKey || "", serialNo: machine?.serialNo || "",
      details: { itemId: id, notes: notes || "" },
    });
    return res;
  };

  // 2026-10-30 — the responsible department records that the missing part has
  // arrived. 2026-11-03: the receipt that completes the quantity also completes
  // the job (no separate "Work completed" for part jobs).
  const handleReceivePendingItem = async (id, { qty, notes, verification = null }) => {
    if (!currentUser?.id) return { success: false, error: "Not authenticated" };
    const p = pendingHandoverItems.find((x) => x.id === id);
    if (!p) return { success: false, error: "Pending job not found." };
    {
      // Admin: any job. Others: their own department's jobs (the database
      // function enforces the same rule — migration 055).
      const isAdminR = currentUser?.role === "super_admin" || currentUser?.role === "Admin";
      const depts = Array.isArray(currentUser?.departments) ? currentUser.departments.filter(Boolean) : [];
      const mach = machineLog.find((x) => String(x.id) === String(p.machineId));
      const inDept = depts.length === 0 || depts.includes(p.assignedDepartment) || (mach && depts.includes(mach.currentDepartment || mach.stage));
      const okR = isAdminR || (canFinishTransfer(authCanDo) && inDept) || (p.assignedDepartment === "Stores" && authCanDo("inward", "submit"));
      if (!okR) return { success: false, error: "You can only record received parts for your own department's jobs." };
    }
    // 2026-11-02 — receive the quantity that actually arrived. One receipt per
    // call, never merged: the database function checks the quantity against
    // what is still pending, inwards stock for THAT quantity only (when the
    // part is in the Item Master), keeps the remainder pending and writes the
    // receipt row. A double click / second device cannot inward twice — the
    // second call sees the new running total.
    const recvQty = Number(qty);
    if (!Number.isFinite(recvQty) || recvQty <= 0) return { success: false, error: "Enter the quantity that was actually received." };
    if (receivePartRef.current.has(id)) return { success: false, error: "This receipt is already being saved." };
    receivePartRef.current.add(id);
    try {
      const machine = machineLog.find((m) => String(m.id) === String(p.machineId)) || null;
      // The receipt is recorded by the department responsible for the job;
      // falls back to where the machine is now.
      const receivedInDepartment = p.assignedDepartment || machine?.currentDepartment || machine?.stage || "";
      const byName = currentUser.fullName || currentUser.username || "";
      const res = await receivePendingPart(id, { qty: recvQty, notes: String(notes || "").trim(), verification, department: receivedInDepartment, receivedBy: currentUser.id, receivedByName: byName });
      if (!res.success) return res;
      // Local mode keeps stock in the browser: move it here. With Supabase the
      // database function already did, so just re-read the items.
      const cat = p.itemCode ? Object.keys(items || {}).find((c) => (items[c] || []).some((i) => i && i.code === p.itemCode)) : null;
      let stockInwarded = !!res.stockInwarded;
      if (!isSupabaseEnabled() && cat) {
        const mv = await handleUpdateStock(cat, p.itemCode, +recvQty, `Pending part received: ${machine?.bomKey || ""}${machine?.serialNo ? ` [${machine.serialNo}]` : ""}`);
        stockInwarded = !(mv && mv.success === false);
      } else if (stockInwarded) {
        reconcileItems();
      }
      const receipt = { ...res.receipt, stockInwarded };
      setPendingHandoverItems((prev) => prev.map((x) => x.id === id
        ? { ...x,
            receivedQty: (Number(x.receivedQty) || 0) + recvQty,
            receipts: [...(x.receipts || []), receipt],
            ...(res.fullyReceived ? { receivedAt: receipt.receivedAt, receivedBy: currentUser.id, receivedNotes: String(notes || "").trim(), receivedInDepartment } : {}) }
        : x));
      logAudit({
        type: "pending_item_received", module: "Machine",
        action: `Part received × ${recvQty}${p.itemCode ? ` (${p.itemCode})` : p.itemName ? ` (${p.itemName})` : ""}${res.remainingQty != null ? ` · ${res.remainingQty} still pending` : ""}${machine ? ` for ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""}` : ""}`,
        ref: machine?.bomKey || "", serialNo: machine?.serialNo || "",
        details: { itemId: id, receiptId: receipt.id, itemCode: p.itemCode || undefined, itemName: p.itemName || undefined, qtyReceived: recvQty, qtyPendingBefore: p.qty ?? undefined, remainingQty: res.remainingQty ?? undefined, fullyReceived: !!res.fullyReceived, stockInwarded, assignedDepartment: p.assignedDepartment || undefined, receivedInDepartment, notes: String(notes || "").trim(), originalReason: p.reason || undefined, verification: verification || undefined },
      });
      // 2026-11-03 — for a PART job, receiving the part IS the completion: the
      // receipt that brings the total up to the required quantity also closes
      // the job. Two existing, separately-allowed writes in sequence (the
      // receive RPC above, then the same resolve update "Work completed" uses —
      // the 042/043 guard refuses receive + resolve columns in one update).
      // The database resolve policy needs Finish & Transfer, so a Stores-only
      // receiver leaves the job received and a department user closes it.
      let completed = false, completeError = "";
      const mayComplete = currentUser?.role === "super_admin" || currentUser?.role === "Admin" || canFinishTransfer(authCanDo);
      if (res.fullyReceived && pendingItemIsPart(p) && mayComplete) {
        const completionNote = String(notes || "").trim() || "Part received";
        const resolvedInDepartment = machine?.currentDepartment || machine?.stage || "";
        const done = await resolvePendingItem(id, { resolvedBy: currentUser.id, resolvedInDepartment, notes: completionNote });
        if (done.success) {
          completed = true;
          const resolvedAt = done.item?.resolvedAt || new Date().toISOString();
          setPendingHandoverItems((prev) => prev.map((x) => x.id === id
            ? { ...x, status: "resolved", resolvedBy: currentUser.id, resolvedAt, resolvedInDepartment, resolutionNotes: completionNote }
            : x));
          logAudit({
            type: "pending_item_completed_on_receipt", module: "Machine",
            action: `Pending part completed on receipt${p.itemCode ? ` (${p.itemCode})` : p.itemName ? ` (${p.itemName})` : ""}${machine ? ` for ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""}` : ""}`,
            ref: machine?.bomKey || "", serialNo: machine?.serialNo || "",
            details: { itemId: id, receiptId: receipt.id, qtyRequired: p.qty ?? undefined, notes: completionNote },
          });
        } else {
          completeError = done.error || "";
          console.warn("[App] part fully received but the job could not be completed", completeError);
        }
      }
      return { ...res, stockInwarded, completed, completeError };
    } finally {
      receivePartRef.current.delete(id);
    }
  };

  // 2026-10-31 — a part that was Not Issued at BOM Outward is now physically
  // available: issue it from stock to its machine. Order matters so stock is
  // never deducted twice:
  //   1. deduct the pending quantity (refused if stock is short);
  //   2. record the receipt — the store only accepts it while the job is
  //      still open and not yet received, so a second device / double click
  //      fails here and step 1 is reversed;
  //   3. write the outward record (same machine serial, so Remove From Rack
  //      still returns it), then close the job as completed.
  const handleIssuePendingPart = async (id) => {
    if (!currentUser?.id) return { success: false, error: "Not authenticated" };
    if (!authCanDo("outward", "bom")) return { success: false, error: "You do not have permission to issue BOM stock (Outward → BOM)." };
    if (issuePendingRef.current.has(id)) return { success: false, error: "Already being issued" };
    const p = pendingHandoverItems.find((x) => x.id === id);
    if (!p || p.status === "resolved") return { success: false, error: "This pending job is already completed." };
    if (p.receivedAt) return { success: false, error: "This part is already received — mark it completed instead." };
    if ((Number(p.receivedQty) || 0) > 0) return { success: false, error: "This part is already partly received — record the rest with Part received." };
    const qty = Number(p.qty) || 0;
    if (!p.itemCode || qty <= 0) return { success: false, error: "This job has no item or quantity to issue." };
    const machine = machineLog.find((m) => String(m.id) === String(p.machineId));
    if (!machine) return { success: false, error: "Machine not found" };
    const cat = Object.keys(items || {}).find((c) => (items[c] || []).some((i) => i && i.code === p.itemCode));
    const inv = cat ? (items[cat] || []).find((i) => i.code === p.itemCode) : null;
    if (!inv) return { success: false, error: `${p.itemCode} is not in the Item Master.` };
    if ((Number(inv.stock) || 0) < qty) return { success: false, error: `Not enough stock: ${inv.name} needs ${qty}, ${Number(inv.stock) || 0} in stock.` };
    issuePendingRef.current.add(id);
    try {
      const ref = `Pending part issued: ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""}`;
      const mv = await handleUpdateStock(cat, p.itemCode, -qty, ref);
      if (mv && mv.success === false) return { success: false, error: mv.error || "Stock movement rejected" };
      const rec = await receivePendingItem(id, { receivedBy: currentUser.id, notes: `Issued from store × ${qty}`, receivedInDepartment: p.assignedDepartment || "Stores" });
      if (!rec.success) {
        await handleUpdateStock(cat, p.itemCode, +qty, `${ref} — undo (already received elsewhere)`);
        return { success: false, error: rec.error || "Could not record the receipt — stock returned." };
      }
      const receivedAt = rec.item?.receivedAt || new Date().toISOString();
      setPendingHandoverItems((prev) => prev.map((x) => x.id === id ? { ...x, receivedAt, receivedBy: currentUser.id, receivedNotes: `Issued from store × ${qty}`, receivedInDepartment: p.assignedDepartment || "Stores" } : x));
      const issueId = Date.now();
      handleAddOutward({
        id: issueId, type: "bom", date: fmtDate(new Date()), ref: machine.bomKey, label: "Pending part issued", units: 1,
        note: `Pending part issued to ${machine.serialNo || machine.bomKey}${machine.rackSlot ? ` (rack ${slotLabel(machine.rackSlot)})` : ""} — was not issued: ${p.reason || "no reason"}`,
        items: [{ code: p.itemCode, name: inv.name, unit: inv.unit, category: cat, required: qty, issueQty: qty, pendingQty: 0 }],
        serialNo: machine.serialNo || "",
      }, []);
      logAudit({
        type: "pending_item_issued", module: "Machine",
        action: `Pending part issued from stock: ${inv.name} × ${qty} → ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""}${machine.rackSlot ? ` · rack ${slotLabel(machine.rackSlot)}` : ""}`,
        ref: machine.bomKey, serialNo: machine.serialNo || "",
        details: { itemId: id, machineId: machine.id, itemCode: p.itemCode, qty, issueId, slotId: machine.rackSlot || null, originalReason: p.reason || "" },
      });
      const done = await handleResolvePendingItem(id, { notes: `Part issued from store × ${qty}` });
      if (!done || done.success === false) return { success: true, partial: true, error: `Issued, but the job could not be closed: ${(done && done.error) || "unknown error"} — use Mark completed.` };
      return { success: true };
    } finally {
      issuePendingRef.current.delete(id);
    }
  };

  return { handleRaisePendingItem, handleResolvePendingItem, handleReceivePendingItem, handleIssuePendingPart };
}
