// SHANTAZ ERP — BOM module writes (folder-replace Phase C, docs/SHELL-CONTEXT.md).
// Moved verbatim from src/app/App.jsx; App.jsx calls createBomHandlers(shell) every
// render, right after it builds the shell object, and wires the returned
// handlers into the pages exactly as before. handleRemoveRackMachine belongs to
// inventory (BOM issue) and is reached through shell.call ("inventory.removeRackMachine").
import { isSupabaseEnabled } from "../../config/env.js";
import { archiveBomDef, restoreBomDef, isBomArchived } from "../../utils/archive.js";
import { createBOM as bomCreate, updateBOM as bomUpdate, renameBOM as bomRename, deleteBOM as bomDelete, restoreBOM as bomRestore } from "../../stores/bomsStore.js";
import { updateOutwardRef } from "../../stores/outwardStore.js";
import { updatePendingBomKey } from "../../stores/pendingStore.js";
import { updateMachineBomKey } from "../../stores/machinesStore.js";
import { createTemplate, updateTemplate } from "../../stores/checklistsStore.js";

export function createBomHandlers(shell) {
  const { bomDefs, call, logAudit, machineLog, setBomDefs, setChecklistTemplates, setMachineLog, setOutwardLog, setPendingLog } = shell;
  const handleRemoveRackMachine = (...args) => call("inventory.removeRackMachine", ...args);

  const handleUpdateBOM  = (key, newBom) => {
    setBomDefs((prev) => ({ ...prev, [key]: newBom }));
    if (isSupabaseEnabled()) bomUpdate(key, newBom).then((r) => { if (!r.success) console.warn("[App] BOM update Supabase failed:", r.error); });
    logAudit({ type: "bom_updated", module: "BOM", action: `BOM Updated: ${key}`, ref: key, details: { items: (newBom.items || []).length } });
  };

  const handleCreateBOM = (key, def) => {
    const k = (key || "").trim();
    if (!k) return { success: false, error: "BOM Key is required" };
    if (bomDefs[k]) return { success: false, error: isBomArchived(bomDefs[k]) ? `BOM ${k} is archived — restore it from Archived (below the BOM list)` : "A BOM with this key already exists" };
    if (!(def.label || "").trim()) return { success: false, error: "Machine Model Name is required" };
    if (!(def.items || []).length) return { success: false, error: "At least one component is required" };
    const palette = ["#2E50D6","#2640B0","#6d28d9","#be185d","#b45309","#15803d","#0e7490","#0f766e","#B45309","#7e22ce"];
    const color = def.color || palette[Object.keys(bomDefs).length % palette.length];
    const newBom = {
      label: def.label.trim(),
      color,
      // Migration 037 — checkPoints must survive this normalisation. The map
      // used to flatten each line to {code, qty}, which would have silently
      // dropped the per-BOM check points the operator just set.
      items: def.items.filter((i) => i.code && Number(i.qty) > 0).map((i) => ({
        code: i.code,
        qty: Number(i.qty),
        checkPoints: Array.isArray(i.checkPoints) ? i.checkPoints.filter(Boolean) : [],
      })),
      rackCapacity: Math.max(0, parseInt(def.rackCapacity, 10) || 0),
      // Migration 041 — department durations set on the BOM.
      deptDurations: def.deptDurations && typeof def.deptDurations === "object" ? def.deptDurations : null,
      // Migration 061 — machine photo (URL) or null.
      photoUrl: typeof def.photoUrl === "string" && def.photoUrl ? def.photoUrl : null,
    };
    setBomDefs((prev) => ({ ...prev, [k]: newBom }));
    if (isSupabaseEnabled()) bomCreate(k, newBom).then((r) => { if (!r.success) console.warn("[App] BOM create Supabase failed:", r.error); });
    logAudit({
      type: "bom_created", module: "BOM",
      action: `BOM Created: ${k} — ${newBom.label}`,
      ref: k,
      newValue: { key: k, label: newBom.label, items: newBom.items.length, rackCapacity: newBom.rackCapacity },
    });
    return { success: true };
  };

  // 2026-06-02d — BOM duplicate. Copies the source BOM under a fresh key
  // (default "<src>-COPY", then "-COPY-2", "-COPY-3" if the operator already
  // has copies). The new BOM gets the same items / capacity but a new color
  // (next entry in the palette) so cards stay visually distinguishable.
  const handleDuplicateBOM = (srcKey) => {
    const src = bomDefs[srcKey];
    if (!src) return { success: false, error: "BOM not found" };
    let newKey = `${srcKey}-COPY`;
    let n = 2;
    while (bomDefs[newKey]) { newKey = `${srcKey}-COPY-${n++}`; }
    const palette = ["#2E50D6","#2640B0","#6d28d9","#be185d","#b45309","#15803d","#0e7490","#0f766e","#B45309","#7e22ce"];
    const newBom = {
      label:        src.label ? `${src.label} (Copy)` : newKey,
      color:        palette[Object.keys(bomDefs).length % palette.length],
      items:        (src.items || []).map((i) => ({ code: i.code, qty: Number(i.qty) || 0 })),
      rackCapacity: Number(src.rackCapacity) || 0,
      deptDurations: src.deptDurations || null,
      photoUrl: src.photoUrl || null,
    };
    setBomDefs((prev) => ({ ...prev, [newKey]: newBom }));
    if (isSupabaseEnabled()) bomCreate(newKey, newBom).then((r) => { if (!r.success) console.warn("[App] BOM duplicate Supabase failed:", r.error); });
    logAudit({
      type: "bom_duplicated", module: "BOM",
      action: `BOM Duplicated: ${srcKey} → ${newKey}`,
      ref: newKey,
      details: { sourceKey: srcKey, items: newBom.items.length, rackCapacity: newBom.rackCapacity },
    });
    return { success: true, newKey };
  };

  // 2026-06-02d — Safe BOM delete with reference-aware rules.
  //   Never issued (no machines, no outward entries) → direct delete.
  //   Has rack machines (stage "BOM Issued") → reverse stock via the existing
  //     handleRemoveRackMachine engine for each, then delete the BOM.
  //   Has active builds past BOM Issued (stage in MACHINE_STAGES post-rack,
  //     status not "completed") → BLOCK. Operator must finish or complete those.
  //   Completed builds → KEEP the BOM rows; history must survive (denormalized
  //     bomKey on machine_log stays valid even after BOM deletion).
  //
  // Pre-check phase exposes the counts so the UI can present an accurate
  // confirmation. The commit phase reverses rack machines + deletes the BOM.
  //
  // Plain arrow, not useCallback: this declaration sits AFTER the auth-gate
  // early returns (if (!currentUser) return <LoginPage/>) — wrapping it in
  // useCallback violated the Rules of Hooks (hook count differed between
  // pre- and post-login renders), which React 18 reported as Error #310
  // and the RootErrorBoundary surfaced as a blank-app crash. No call site
  // depends on a stable reference (event-handler prop only, no useEffect
  // dep), so memoisation was unnecessary anyway.
  const computeBOMDeletionInfo = (key) => {
    const refs = machineLog.filter((m) => m.bomKey === key);
    const rack       = refs.filter((m) => m.stage === "BOM Issued");
    const active     = refs.filter((m) => m.stage !== "BOM Issued" && m.status !== "completed");
    const completed  = refs.filter((m) => m.status === "completed");
    const canDelete  = active.length === 0;
    const needsReverseStock = rack.length > 0;
    return { rack, active, completed, canDelete, needsReverseStock };
  };

  const handleDeleteBOM = async (key) => {
    if (!bomDefs[key]) return { success: false, error: "BOM not found" };
    const info = computeBOMDeletionInfo(key);
    if (!info.canDelete) {
      return { success: false, error: `Cannot delete — ${info.active.length} active production build(s) still reference this BOM. Complete or cancel them first.` };
    }
    // Step 1: reverse stock + clean up for each rack machine. Reuses the
    // existing handleRemoveRackMachine engine so stock integrity follows the
    // same audited path as a manual rack remove.
    let restored = 0;
    for (const m of info.rack) {
      try {
        const res = await handleRemoveRackMachine(m.id);
        if (res?.success) restored += (res.restored || 0);
        else console.warn("[App] handleDeleteBOM: rack remove failed for machine", m.id, res?.error);
      } catch (e) {
        console.error("[App] handleDeleteBOM: rack remove threw for machine", m.id, e);
      }
    }
    // Step 2: ARCHIVE the BOM (owner rule 2026-11-05 — never delete). It
    // gets retired_at, so it leaves issuing and the BOM list but the row, its
    // checklists (checklist_templates.bom_key) and its history stay; it comes
    // back from Outward → BOM list → Archived (N) → Restore.
    const oldDef = bomDefs[key];
    const at = new Date().toISOString();
    setBomDefs((prev) => (prev[key] ? { ...prev, [key]: archiveBomDef(prev[key], at) } : prev));
    const r = await bomDelete(key);   // bomsStore.deleteBOM archives (retired_at)
    if (!r.success) {
      console.warn("[App] handleDeleteBOM: archive failed", r.error);
      // Roll back local state so the operator can retry without ghost
      setBomDefs((prev) => ({ ...prev, [key]: oldDef }));
      return { success: false, error: r.error };
    }
    logAudit({
      type: "bom_archived", module: "BOM",
      action: `BOM Archived: ${key} — ${info.rack.length} rack machine(s) cleared, ${restored} component(s) returned to stock`,
      ref: key,
      details: { rackCount: info.rack.length, completedCount: info.completed.length, restored, archivedAt: at },
    });
    return { success: true, rackCount: info.rack.length, completedCount: info.completed.length, restored, archived: true };
  };
  const handleRestoreBOM = async (key) => {
    const def = bomDefs[key];
    if (!def) return { success: false, error: "BOM not found" };
    if (!isBomArchived(def)) return { success: true, noop: true };
    setBomDefs((prev) => (prev[key] ? { ...prev, [key]: restoreBomDef(prev[key]) } : prev));
    const r = await bomRestore(key);
    if (!r.success) {
      console.warn("[App] handleRestoreBOM: restore failed", r.error);
      setBomDefs((prev) => ({ ...prev, [key]: def }));
      return { success: false, error: r.error };
    }
    logAudit({ type: "bom_restored", module: "BOM", action: `BOM Restored: ${key}${def.label ? ` (${def.label})` : ""}`, ref: key,
               details: { archivedAt: def.retiredAt || null, replacedBy: def.replacedBy || null } });
    return { success: true };
  };

  const handleRenameBOM = (oldKey, newKey, newLabel) => {
    const nk = (newKey || "").trim();
    const nl = (newLabel || "").trim();
    if (!bomDefs[oldKey]) return { success: false, error: "BOM not found" };
    if (!nk) return { success: false, error: "BOM Key is required" };
    if (!nl) return { success: false, error: "Machine Model Name is required" };
    if (nk !== oldKey && bomDefs[nk]) return { success: false, error: isBomArchived(bomDefs[nk]) ? `BOM ${nk} is archived — restore it from Archived (below the BOM list)` : "A BOM with this key already exists" };
    const old = bomDefs[oldKey];
    const keyChanged   = nk !== oldKey;
    const labelChanged = nl !== old.label;
    if (!keyChanged && !labelChanged) return { success: true, noop: true };

    setBomDefs((prev) => {
      const next = { ...prev };
      if (keyChanged) delete next[oldKey];
      next[nk] = { ...old, label: nl };
      return next;
    });
    if (isSupabaseEnabled()) {
      if (keyChanged) bomRename(oldKey, nk, nl).then((r) => { if (!r.success) console.warn("[App] BOM rename Supabase failed:", r.error); });
      else bomUpdate(oldKey, { ...old, label: nl }).then((r) => { if (!r.success) console.warn("[App] BOM label update Supabase failed:", r.error); });
    }
    if (keyChanged || labelChanged) {
      setMachineLog((prev) => prev.map((m) => m.bomKey !== oldKey ? m : { ...m, bomKey: nk, bomLabel: nl }));
      setOutwardLog((prev) => prev.map((e) => e.ref !== oldKey ? e : { ...e, ref: nk, label: nl }));
      setPendingLog((prev) => prev.map((p) => p.bomKey !== oldKey ? p : { ...p, bomKey: nk, bomLabel: nl }));
      if (isSupabaseEnabled()) {
        updateMachineBomKey(oldKey, nk, nl).then((r) => { if (!r.success) console.warn("[App] BOM rename: machine cascade failed", r.error); });
        updateOutwardRef(oldKey, nk, nl).then((r) => { if (!r.success) console.warn("[App] BOM rename: outward cascade failed", r.error); });
        updatePendingBomKey(oldKey, nk, nl).then((r) => { if (!r.success) console.warn("[App] BOM rename: pending cascade failed", r.error); });
      }
    }
    logAudit({
      type: "bom_renamed", module: "BOM",
      action: keyChanged
        ? `BOM Renamed: ${oldKey} → ${nk} (${nl})`
        : `BOM Label Updated: ${oldKey} → "${nl}"`,
      ref: nk,
      oldValue: { key: oldKey, label: old.label },
      newValue: { key: nk,     label: nl },
    });
    return { success: true };
  };

  // 2026-11-05 — BOM screen → Checklists. Writes ONE BOM's own list for one
  // (department, stage): updates its row (templateId) or creates it. Never
  // deletes — an emptied list is switched off (active=false) so the common
  // list applies again. Same store calls as the Settings handlers above.
  const handleSaveBomChecklist = async ({ bomKey, department, stage, templateId = null, items = [], active = true, name = "", change = "" }) => {
    if (!bomKey || !department || !stage) return { success: false, error: "Missing BOM, department or stage." };
    const clean = (items || []).map((it) => ({ id: it.id, label: String(it.label || "").trim(), required: !!it.required })).filter((it) => it.label);
    const stageLabel = stage === "before_receive" ? "Before receive" : stage === "before_dispatch" ? "Before transfer" : stage;
    let res;
    if (templateId) {
      res = await updateTemplate(templateId, { items: clean, active: !!active });
      if (!res.success) return res;
      const now = new Date().toISOString();
      setChecklistTemplates((prev) => prev.map((t) => t.id === templateId ? { ...t, items: clean, active: !!active, version: (t.version || 1) + 1, updatedAt: now } : t));
    } else {
      res = await createTemplate({ department, stage, bomKey, name: name || `${department} · ${stageLabel}`, items: clean, active: true });
      if (!res.success) return res;
      setChecklistTemplates((prev) => [res.template, ...prev]);
    }
    logAudit({
      type: "bom_checklist_changed", module: "BOM",
      action: `BOM checklist ${change || "updated"}: ${bomKey} · ${department} · ${stageLabel}`,
      ref: bomKey,
      details: { templateId: templateId || res.template?.id || null, department, stage, items: clean.length, active: templateId ? !!active : true, change },
    });
    return res;
  };

  return { handleUpdateBOM, handleCreateBOM, handleDuplicateBOM, computeBOMDeletionInfo, handleDeleteBOM, handleRestoreBOM, handleRenameBOM, handleSaveBomChecklist };
}
