// SHANTAZ ERP — trial-certificate module writes (folder-replace Phase C, docs/SHELL-CONTEXT.md).
// Moved verbatim from src/app/App.jsx; App.jsx calls createTrialCertificateHandlers(shell)
// every render, right after it builds the shell object, and wires the returned
// handler into the Machine Tracker pages exactly as before.
import { canFinishTransfer } from "../../utils/handoverLogic.js";
import { updateMachine as machineUpdate } from "../../stores/machinesStore.js";

export function createTrialCertificateHandlers(shell) {
  const { authCanDo, currentUser, logAudit, machineLog, setMachineLog } = shell;

  // 2026-10-31 — complete / correct a saved Trial Certificate from the
  // Machine Tracker. Finish & Transfer permission; the machine's record is
  // updated and the change audited; no stage change.
  const handleUpdateTrialCertificate = async (machineId, cert) => {
    if (!currentUser?.id) return { success: false, error: "Not authenticated" };
    if (!canFinishTransfer(authCanDo)) return { success: false, error: "You do not have permission to edit the certificate (Machines → Finish & Transfer)." };
    const machine = machineLog.find((m) => String(m.id) === String(machineId));
    if (!machine) return { success: false, error: "Machine not found" };
    if (!cert || typeof cert !== "object") return { success: false, error: "No certificate data" };
    const next = { ...cert, updatedAt: new Date().toISOString(), updatedBy: currentUser.id };
    setMachineLog((prev) => prev.map((m) => (String(m.id) === String(machineId) ? { ...m, trialCertificate: next } : m)));
    const r = await machineUpdate(machineId, { trialCertificate: next });
    if (!r.success) return r;
    logAudit({
      type: "trial_certificate_updated", module: "Machine",
      action: `Trial Certificate updated: ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""}`,
      ref: machine.bomKey, serialNo: machine.serialNo || "",
      details: { machineId, trialBy: next.trialByName || "", signed: !!next.trialBySignature },
    });
    return { success: true };
  };

  return { handleUpdateTrialCertificate };
}
