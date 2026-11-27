// SHANTAZ ERP — settings module writes (folder-replace Phase C, docs/SHELL-CONTEXT.md).
// Moved verbatim from src/app/App.jsx; App.jsx calls createSettingsHandlers(shell) every
// render, right after it builds the shell object, and wires the returned
// handlers into the pages exactly as before.
import { appendAuditWithUser } from "../../auth/auditStore.js";
import { updateUserDepartments } from "../../auth/authStore.js";
import { isSupabaseEnabled } from "../../config/env.js";
import { fetchAllAttachments } from "../../stores/attachmentsStore.js";
import { fetchResponses, createTemplate, updateTemplate } from "../../stores/checklistsStore.js";
import { fetchHandovers } from "../../stores/handoverStore.js";
import { fetchMachines } from "../../stores/machinesStore.js";
import { fetchOutward } from "../../stores/outwardStore.js";
import { fetchPendingItems } from "../../stores/pendingItemsStore.js";
import { fetchRatings } from "../../stores/ratingsStore.js";
import { saveSettings } from "../../stores/settingsStore.js";
import { normaliseModuleSelection, MODULES, isModuleOn, effectiveEnabledModules } from "../../utils/modules.js";

export function createSettingsHandlers(shell) {
  const { allUsers, checklistTemplates, currentUser, logAudit, setAllUsers, setAttachments, setChecklistResponses, setChecklistTemplates, setDeptRatings, setHandovers, setMachineLog, setOutwardLog, setPendingHandoverItems, setSettings, settings } = shell;

  // Go-live 2026-11-04 — Settings → Modules (super admin only). Saves the ON
  // list into the org settings row (settings.enabledModules) and records a
  // modules_changed audit event. RLS on public.settings already limits writes
  // to the super admin.
  const handleSaveModules = async (list) => {
    if (currentUser?.role !== "super_admin") return { success: false, error: "Only the super admin can change modules." };
    const next   = normaliseModuleSelection(list);
    const before = settings || {};
    const prevOn = MODULES.map((m) => m.id).filter((id) => isModuleOn(id, effectiveEnabledModules(before.enabledModules, null)));
    const newSettings = { ...before, enabledModules: next };
    setSettings(newSettings);                            // optimistic UI
    const res = await saveSettings(newSettings);
    if (!res.success) {
      console.warn("[App] handleSaveModules: save failed —", res.error);
      setSettings((prev) => {
        const out = { ...prev };
        if (Object.prototype.hasOwnProperty.call(before, "enabledModules")) out.enabledModules = before.enabledModules;
        else delete out.enabledModules;
        return out;
      });
      return res;
    }
    const turnedOn  = next.filter((id) => !prevOn.includes(id));
    const turnedOff = prevOn.filter((id) => !next.includes(id));
    logAudit({
      type: "modules_changed", module: "Settings",
      action: `Modules changed${turnedOff.length ? ` · OFF: ${turnedOff.join(", ")}` : ""}${turnedOn.length ? ` · ON: ${turnedOn.join(", ")}` : ""}`,
      ref: "modules",
      details: { enabledModules: next, turnedOn, turnedOff },
    });
    return res;
  };

  // Admin Data Cleanup (migration 051): the DB function deleted the machines
  // and linked rows atomically and wrote the authoritative audit row. Here we
  // drop the same rows from local state, add a local-only audit entry
  // (mirror:false — no duplicate DB row) and re-hydrate from Supabase.
  const handleAdminCleanupDone = async (res) => {
    const ids     = new Set((res?.machines || []).map((m) => String(m.id)));
    const serials = new Set((res?.machines || []).map((m) => (m.serial || "").trim().toLowerCase()).filter(Boolean));
    setMachineLog((prev) => prev.filter((m) => !ids.has(String(m.id))));
    setHandovers((prev) => prev.filter((h) => !ids.has(String(h.machineId))));
    setPendingHandoverItems((prev) => prev.filter((p) => !ids.has(String(p.machineId))));
    setChecklistResponses((prev) => prev.filter((r) => !ids.has(String(r.machineId))));
    setDeptRatings((prev) => prev.filter((r) => !ids.has(String(r.machineId))));
    setAttachments((prev) => prev.filter((a) => !ids.has(String(a.machineId))));
    setOutwardLog((prev) => prev.filter((o) => !serials.has((o.serialNo || "").trim().toLowerCase())));
    appendAuditWithUser({ type: "admin_cleanup", module: "Machine",
      action: `Admin data cleanup: ${res?.counts?.machine_log ?? ids.size} machine(s) and linked records deleted; ${(res?.keep_ids || []).length} kept`,
      details: { keepIds: res?.keep_ids || [], deleted: res?.machines || [], counts: res?.counts || {} } }, { mirror: false });
    if (isSupabaseEnabled()) {
      try {
        const [mac, ho, phi, cr, rt, atts, out] = await Promise.all([fetchMachines(), fetchHandovers(), fetchPendingItems(), fetchResponses(), fetchRatings(), fetchAllAttachments(), fetchOutward()]);
        if (mac)  setMachineLog(mac);
        if (ho)   setHandovers(ho);
        if (phi)  setPendingHandoverItems(phi);
        if (cr)   setChecklistResponses(cr);
        if (rt)   setDeptRatings(rt);
        if (atts) setAttachments(atts);
        if (out)  setOutwardLog(out);
      } catch (e) { console.warn("[App] re-hydrate after cleanup failed:", e); }
    }
  };

  // ── Phase B — Checklist template admin ─────────────────────────────────────
  const handleCreateChecklistTemplate = async (t) => {
    const res = await createTemplate(t);
    if (!res.success) return res;
    setChecklistTemplates((prev) => [res.template, ...prev]);
    logAudit({
      type: "checklist_template_created", module: "Settings",
      action: `Checklist template created: ${t.name} (${t.department})`,
      ref: t.department,
      details: { templateId: res.template.id, items: (t.items || []).length },
    });
    return res;
  };

  const handleUpdateChecklistTemplate = async (id, patch) => {
    const before = checklistTemplates.find((x) => x.id === id);
    const res = await updateTemplate(id, patch);
    if (!res.success) return res;
    setChecklistTemplates((prev) => prev.map((t) => t.id === id ? { ...t, ...patch, version: (t.version || 1) + 1 } : t));
    // Owner rule (2026-11-05): templates are never deleted. Switching one off
    // is its archive, switching it back on its restore — audited as such.
    const wasOff = before ? before.active === false : false;
    const archived = patch && patch.active === false && !wasOff;
    const restored = patch && patch.active === true && wasOff;
    logAudit({
      type: archived ? "checklist_template_archived" : restored ? "checklist_template_restored" : "checklist_template_updated", module: "Settings",
      action: `Checklist template ${archived ? "switched off (archived)" : restored ? "switched on (restored)" : "updated"}: ${patch.name || before?.name || id}`,
      ref: String(id), details: { patchKeys: Object.keys(patch || {}), department: before?.department || "", bomKey: before?.bomKey || null },
    });
    return res;
  };

  // Kept as a handler name (regression inventory); never deletes — it switches
  // the template off (active=false) through the same path as above.
  const handleDeleteChecklistTemplate = async (id) => handleUpdateChecklistTemplate(id, { active: false });

  // Migration 029 — save a user's department assignments (admin action).
  // Updates both Supabase and the in-memory allUsers list so Settings UI
  // and the Finish & Transfer picker see the change immediately.
  const handleSaveUserDepartments = async (userId, departments) => {
    const res = await updateUserDepartments(userId, departments);
    if (!res.success) return res;
    setAllUsers((prev) => prev.map((u) => u.id === userId ? { ...u, departments: Array.isArray(departments) ? [...departments] : [] } : u));
    const u = allUsers.find((x) => x.id === userId);
    logAudit({
      type: "user_departments_updated", module: "Settings",
      action: `Departments updated: ${u?.fullName || u?.username || userId} → ${(departments || []).join(", ") || "none"}`,
      ref: userId,
      details: { departments: Array.isArray(departments) ? departments : [] },
    });
    return { success: true };
  };

  return { handleSaveModules, handleAdminCleanupDone, handleCreateChecklistTemplate, handleUpdateChecklistTemplate, handleDeleteChecklistTemplate, handleSaveUserDepartments };
}
