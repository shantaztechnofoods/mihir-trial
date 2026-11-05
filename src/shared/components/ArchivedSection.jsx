// "Archived (N)" — collapsed list of archived master data with a Restore
// button. Owner rule 2026-11-05: nothing in the ERP is ever deleted; archived
// rows stay in the database and come back from here.
//
// Restore asks first with a named confirmation ("Restore BOM 'M-10'?"),
// Cancel focused by default, Escape closes without doing anything. The
// caller decides who may restore (canRestore = canDo(...)); without it the
// list is read-only.
import React, { useEffect, useRef, useState } from "react";
import { Btn } from "../ui/primitives.jsx";
import { restoreConfirmTitle } from "../../utils/archive.js";

export default function ArchivedSection({ kind, rows = [], getKey, getName, getMeta, canRestore = false, canRestoreRow = () => true, onRestore, testId }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(null); // row
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const cancelRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!confirm) return undefined;
    cancelRef.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); setConfirm(null); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [confirm]);

  if (!rows.length) return null;

  const close = () => { setConfirm(null); setErr(""); triggerRef.current?.focus?.(); };
  const doRestore = async () => {
    if (!confirm || !onRestore) return;
    setBusy(true); setErr("");
    let res;
    try { res = await onRestore(confirm); } catch (e) { res = { success: false, error: e?.message || "failed" }; }
    setBusy(false);
    if (res && res.success === false) { setErr(res.error || "Restore failed"); return; }
    close();
  };

  return (
    <div className="pt-2" data-archived-section={testId || kind}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
              className="w-full flex items-center justify-between gap-2 min-h-[44px] px-3 rounded-lg text-[12px] font-bold text-slate-600 border border-slate-200 bg-slate-50 hover:bg-slate-100">
        <span>Archived ({rows.length})</span>
        <span className="text-[11px] font-semibold text-slate-500">{open ? "▲ Hide" : "▼ Show"}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          {rows.map((row) => {
            const name = getName(row);
            return (
              <div key={getKey(row)} data-archived-row={getKey(row)}
                   className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-slate-200 bg-white">
                <div className="min-w-0">
                  <div className="text-[12px] font-semibold text-slate-700 truncate">{name}</div>
                  {getMeta && <div className="text-[10px] text-slate-500 truncate">{getMeta(row)}</div>}
                </div>
                {canRestore && onRestore && canRestoreRow(row) && (
                  <Btn variant="green" size="xs" onClick={(e) => { triggerRef.current = e.currentTarget; setErr(""); setConfirm(row); }}>
                    Restore
                  </Btn>
                )}
              </div>
            );
          })}
        </div>
      )}

      {confirm && (
        <div className="modal-backdrop fixed inset-0 z-[70] flex items-center justify-center p-4"
             style={{ background: "rgba(17,24,39,0.45)" }}
             onClick={(e) => e.target === e.currentTarget && !busy && close()}>
          <div role="dialog" aria-modal="true" aria-labelledby="archived-restore-title"
               className="w-full max-w-sm rounded-2xl p-5" style={{ background: "var(--surface-elevated)", border: "1px solid rgba(34,197,94,0.35)" }}>
            <div id="archived-restore-title" className="text-sm font-black text-slate-900 mb-2">{restoreConfirmTitle(kind, getName(confirm))}</div>
            <div className="text-[11px] text-slate-500 mb-4">It comes back into the normal list exactly as it was archived. Nothing else changes.</div>
            {err && <div className="text-[11px] text-red-600 mb-3" role="alert">{err}</div>}
            <div className="flex gap-2 justify-end">
              <button ref={cancelRef} type="button" onClick={close} disabled={busy}
                      className="text-xs font-semibold rounded-lg px-4 py-1.5 border border-slate-200 text-slate-600 bg-white">Cancel</button>
              <Btn variant="green" size="sm" onClick={doRestore} disabled={busy}>{busy ? "Restoring…" : `Restore ${kind}`}</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
