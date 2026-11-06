// src/modules/settings/DepartmentHeadsPanel.jsx — Department heads (2026-11-05).
// Settings → Department Workflow → "Department heads": pick the head of each
// department from existing active users, or type a name when the head has no
// login. A display label only (shown on the Dashboard production line); it
// does not change any role, department or permission. Each row saves on its
// own (persistPatch → handleSaveSettings → settings_updated audit event).
import React, { useEffect, useState } from "react";
import { HEAD_DEPARTMENTS, readDepartmentHeads, setDepartmentHead, cleanHeadName, userDisplayName } from "../../utils/departmentHeads.js";
import SaveMorph from "../../shared/ui/SaveMorph.jsx";

const TYPED = "__typed";
const ctl = "w-full bg-white border border-slate-200 rounded-lg px-3 text-[14px] text-slate-900 outline-none disabled:opacity-60";

function HeadRow({ dept, head, users, canEdit, onSave }) {
  const known = head && head.userId ? users.find((u) => String(u.id) === head.userId) : null;
  const initialPick = !head ? "" : known ? String(known.id) : TYPED;
  const [pick, setPick] = useState(initialPick);
  const [name, setName] = useState(head && !known ? head.name : "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);   // { tone: "ok"|"bad", text }
  const [nameErr, setNameErr] = useState("");
  const id = `dept-head-${dept.toLowerCase()}`;
  // A save from another screen (live sync) moves the picker along with it.
  const sig = head ? `${head.userId || ""}|${head.name}` : "";
  useEffect(() => {
    setPick(initialPick);
    if (initialPick === TYPED) setName(head.name);
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (nextHead) => {
    setBusy(true); setMsg(null);
    try {
      const res = await onSave(dept, nextHead);
      setMsg(res && res.success === false ? { tone: "bad", text: res.error || "Could not save. Try again." } : { tone: "ok", text: nextHead ? "Saved" : "Removed" });
    } finally { setBusy(false); }
  };

  const onPick = (v) => {
    setPick(v); setMsg(null); setNameErr("");
    if (v === TYPED) { if (!name && head) setName(head.name); return; }
    if (v === "") { if (head) save(null); return; }
    const u = users.find((x) => String(x.id) === v);
    if (u) save({ userId: String(u.id), name: userDisplayName(u) });
  };
  const saveTyped = () => {
    const n = cleanHeadName(name);
    if (!n) { setNameErr("Type the head's name."); return; }
    save({ userId: null, name: n });
  };

  if (!canEdit) {
    return (
      <div className="dept-head-row" data-dept-head-row={dept}>
        <div className="text-[14px] font-semibold text-slate-900">{dept}</div>
        <div className="text-[14px] text-slate-600">{head ? head.name : "Not set"}</div>
      </div>
    );
  }

  return (
    <div className="dept-head-row" data-dept-head-row={dept}>
      <label htmlFor={id} className="text-[14px] font-semibold text-slate-900">{dept}</label>
      <div className="dept-head-ctl">
        <select id={id} value={pick} disabled={busy} onChange={(e) => onPick(e.target.value)}
                className={ctl} style={{ minHeight: 44, background: "var(--surface-input)", color: "var(--text)" }}>
          <option value="">Not set</option>
          {users.map((u) => (
            <option key={u.id} value={String(u.id)}>{userDisplayName(u)}{u.username && u.fullName ? ` (${u.username})` : ""}</option>
          ))}
          <option value={TYPED}>Type a name (no login)…</option>
        </select>
        {pick === TYPED && (
          <div className="dept-head-typed">
            <div className="flex-1 min-w-0">
              <label htmlFor={`${id}-name`} className="block text-[12px] font-semibold text-slate-600 mb-1">Head's name</label>
              <input id={`${id}-name`} value={name} maxLength={60} disabled={busy}
                     onChange={(e) => { setName(e.target.value); if (nameErr) setNameErr(""); setMsg(null); }}
                     onBlur={() => { if (name && !cleanHeadName(name)) setNameErr("Type the head's name."); }}
                     onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveTyped(); } }}
                     aria-invalid={nameErr ? "true" : undefined} aria-describedby={nameErr ? `${id}-err` : undefined}
                     placeholder="e.g. Sonu bhai" className={ctl} style={{ minHeight: 44 }} />
            </div>
            <button type="button" onClick={saveTyped} disabled={busy}
                    className="text-[14px] font-semibold px-4 rounded-lg text-white disabled:opacity-60 self-end"
                    style={{ minHeight: 44, background: "var(--action, #2E50D6)" }}>
              <SaveMorph saved={msg && msg.tone === "ok" && msg.text === "Saved" ? msg : null}>Save name</SaveMorph>
            </button>
          </div>
        )}
        {nameErr && <div id={`${id}-err`} className="text-[12px] font-semibold text-red-600 mt-1" role="alert">{nameErr}</div>}
      </div>
      <div className="dept-head-msg text-[12px] font-semibold" aria-live="polite"
           style={{ color: msg ? (msg.tone === "ok" ? "#15803d" : "#dc2626") : "transparent" }}>
        {busy ? "Saving…" : msg ? msg.text : ""}
      </div>
    </div>
  );
}

export function DepartmentHeadsPanel({ settings, allUsers = [], canEdit = false, onSaveHeads }) {
  const heads = readDepartmentHeads(settings);
  const users = (allUsers || []).filter((u) => u && u.id != null && u.status !== "disabled" && userDisplayName(u));
  const saveOne = (dept, head) => onSaveHeads(setDepartmentHead(readDepartmentHeads(settings), dept, head));
  return (
    <div data-dept-heads>
      <div className="mb-3 px-3 py-2 rounded-lg text-[12px] font-semibold" data-dept-heads-note
           style={{ background: "rgba(46, 80, 214,0.06)", color: "#1e3a8a", border: "1px solid rgba(46, 80, 214,0.2)" }}>
        Shown on Dashboard. Does not change permissions.
      </div>
      {!canEdit && (
        <div className="mb-3 text-[12px] text-slate-500">You can view the heads but not change them. Admin role required.</div>
      )}
      <div className="dept-head-list">
        {HEAD_DEPARTMENTS.map((d) => (
          <HeadRow key={d} dept={d} head={heads[d] || null}
                   users={users} canEdit={canEdit} onSave={saveOne} />
        ))}
      </div>
    </div>
  );
}
