// src/modules/settings/EmployeeMembersPanel.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState } from "react";
import { Section } from "./settingsUi.jsx";

// ─── Migration 029 — Department-employee assignment row ────────────────────
// One row per department (Assembly / Mechanical / Electrical / Trial) inside
// Settings → Department Workflow. Shows assigned users as chips with a one-tap
// remove; "Add worker" dropdown lists everyone NOT yet assigned to this dept.
// Simple labels for low-literacy operators: "Add worker", "Remove", "Save".
export function DeptEmployeesRow({ dept, assigned, notAssigned, canConfig, onSaveUserDepartments }) {
  const [pickValue, setPickValue] = useState("");
  const [busy,      setBusy]      = useState(false);
  const [err,       setErr]       = useState("");

  const addWorker = async () => {
    if (!pickValue || !canConfig) return;
    const u = notAssigned.find((x) => x.id === pickValue);
    if (!u) return;
    setBusy(true); setErr("");
    try {
      const nextDepts = Array.isArray(u.departments) ? [...u.departments, dept] : [dept];
      const res = await onSaveUserDepartments(u.id, nextDepts);
      if (res && res.success === false) { setErr(res.error || "Save failed"); return; }
      setPickValue("");
    } finally { setBusy(false); }
  };
  const removeWorker = async (u) => {
    if (!canConfig) return;
    setBusy(true); setErr("");
    try {
      const nextDepts = (u.departments || []).filter((d) => d !== dept);
      const res = await onSaveUserDepartments(u.id, nextDepts);
      if (res && res.success === false) setErr(res.error || "Save failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-lg p-3" style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.10)" }}>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-[12px] font-black text-slate-900">{dept}</span>
        <span className="text-[10px] text-slate-500">· {assigned.length} assigned</span>
      </div>
      {assigned.length === 0 ? (
        <div className="text-[11px] italic text-slate-500 mb-2">No workers assigned yet.</div>
      ) : (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {assigned.map((u) => (
            <span key={u.id}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full"
                  style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.3)", color: "#15803d" }}>
              {u.fullName || u.username}
              {canConfig && (
                <button onClick={() => removeWorker(u)} disabled={busy}
                        title="Remove from this department"
                        className="ml-0.5 text-slate-400 hover:text-red-300 disabled:opacity-40">×</button>
              )}
            </span>
          ))}
        </div>
      )}
      {canConfig && (
        <div className="flex items-center gap-2 flex-wrap">
          <select value={pickValue} onChange={(e) => setPickValue(e.target.value)} disabled={busy || notAssigned.length === 0}
                  className="flex-1 min-w-[180px] bg-slate-50 border border-slate-200 rounded-md px-2 py-1.5 text-[11px] text-slate-900 outline-none focus:border-blue-500/40 disabled:opacity-50"
                  style={{ background: "var(--surface-input)", color: "var(--text)" }}>
            <option value="">
              {notAssigned.length === 0 ? "— All active users already assigned —" : "+ Add worker from existing users…"}
            </option>
            {notAssigned.map((u) => (
              <option key={u.id} value={u.id}>{u.fullName || u.username}{u.username && u.fullName ? ` (${u.username})` : ""}</option>
            ))}
          </select>
          <button onClick={addWorker} disabled={!pickValue || busy}
                  className="text-[11px] font-black text-slate-900 px-3 py-1.5 rounded-md transition-all disabled:opacity-40"
                  style={{ background: "#15803d", boxShadow: "0 1px 2px rgba(17,24,39,0.14)", color: "#ffffff" }}>
            Add
          </button>
        </div>
      )}
      {err && <div className="text-[10px] text-red-600 mt-1">⚠ {err}</div>}
    </div>
  );
}

// ── Employee Members admin panel (Settings → Employees tab) ─────────────────
// Manages display names for factory workers who don't have ERP logins.
// Changes are saved into settings.employeeMembers (a JSON array in the settings blob),
// so no DB migration is needed — they're persisted via handleSaveSettings.
export function EmployeeMembersPanel({ members = [], canConfig = false, onSave }) {
  const DEPTS = ["Assembly", "Mechanical", "Electrical", "Trial"];
  const [editing, setEditing] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const start = (m) => setEditing(
    m ? { ...m, departments: Array.isArray(m.departments) ? m.departments : [] }
      : { id: crypto.randomUUID(), name: "", active: true, departments: [] }
  );

  // Every mutation here round-trips to the database before the editor closes.
  // If the write fails the row stays open with the reason on it, so nobody
  // walks away believing a worker was added when they weren't.
  const commit = async (list) => {
    setBusy(true);
    try {
      const res = await onSave?.(list);
      if (res && res.success === false) {
        setErr(res.error || "Could not save. Nothing was changed — please retry.");
        return false;
      }
      setErr("");
      return true;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!editing || busy) return;
    if (!editing.name.trim()) { setErr("Name is required."); return; }
    const list = members.some((m) => m.id === editing.id)
      ? members.map((m) => m.id === editing.id ? { ...editing } : m)
      : [...members, { ...editing }];
    if (await commit(list)) setEditing(null);
  };

  const remove = async (id) => {
    if (busy) return;
    if (!window.confirm("Remove this employee? They won't appear in new dropdowns. Existing records are unaffected.")) return;
    await commit(members.filter((m) => m.id !== id));
  };

  const toggleActive = async (id) => {
    if (busy) return;
    await commit(members.map((m) => m.id === id ? { ...m, active: !m.active } : m));
  };

  return (
    <Section icon="👥" title="Employee Members">
      {!canConfig && (
        <div className="mb-4 px-3 py-2 rounded-lg text-[11px]"
             style={{ background: "rgba(217, 119, 6,0.08)", color: "#B45309", border: "1px solid rgba(217, 119, 6,0.3)" }}>
          You can view employees but not modify them. Admin role required.
        </div>
      )}
      <div className="text-[11px] text-slate-400 mb-3">
        These display names appear alongside ERP login-accounts in the <strong className="text-slate-900">Finish &amp; Transfer</strong> worker picker and <strong className="text-slate-900">Accept</strong> team picker. Use them for factory workers who don't have ERP logins.
        <span className="block mt-1 text-slate-500">Each employee saves on its own — you don't need the Save Changes button at the top.</span>
      </div>
      {!editing && err && (
        <div className="text-[11px] mb-3 px-3 py-2 rounded-lg"
             style={{ background: "rgba(239,68,68,0.08)", color: "#b91c1c", border: "1px solid rgba(239,68,68,0.3)" }}>
          ⚠ {err}
        </div>
      )}
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] text-slate-500">{members.length} employee{members.length === 1 ? "" : "s"} configured.</div>
        {canConfig && !editing && (
          <button onClick={() => start(null)}
                  className="text-[11px] font-black text-white px-3 py-1.5 rounded-lg"
                  style={{ background: "#2640B0", boxShadow: "0 1px 2px rgba(17,24,39,0.14)", color: "#ffffff" }}>
            + Add Employee
          </button>
        )}
      </div>

      {editing && (
        <div className="mb-4 rounded-xl px-4 py-4 space-y-3"
             style={{ background: "rgba(46, 80, 214,0.04)", border: "1px solid rgba(46, 80, 214,0.25)" }}>
          <div className="text-[12px] font-bold text-slate-700">
            {members.some((m) => m.id === editing.id) ? "Edit Employee" : "New Employee"}
          </div>
          <div>
            <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">Display Name *</label>
            <input type="text" value={editing.name}
                   onChange={(e) => setEditing((prev) => prev ? { ...prev, name: e.target.value } : prev)}
                   placeholder="e.g. Raju Kumar"
                   className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[12px] placeholder-slate-400 outline-none focus:border-blue-500/40" />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">Departments</label>
            <div className="flex flex-wrap gap-3">
              {DEPTS.map((d) => {
                const checked = (editing.departments || []).includes(d);
                return (
                  <label key={d} className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={checked}
                           onChange={() => setEditing((prev) => {
                             if (!prev) return prev;
                             const depts = checked
                               ? prev.departments.filter((x) => x !== d)
                               : [...(prev.departments || []), d];
                             return { ...prev, departments: depts };
                           })}
                           className="accent-blue-500 w-3.5 h-3.5" />
                    <span className="text-[11px] text-slate-500">{d}</span>
                  </label>
                );
              })}
            </div>
          </div>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={!!editing.active}
                   onChange={(e) => setEditing((prev) => prev ? { ...prev, active: e.target.checked } : prev)}
                   className="accent-emerald-500 w-3.5 h-3.5" />
            <span className="text-[11px] text-slate-500">Active (appears in dropdowns)</span>
          </label>
          {err && (
            <div className="text-[11px] px-3 py-2 rounded-lg"
                 style={{ background: "rgba(239,68,68,0.08)", color: "#b91c1c", border: "1px solid rgba(239,68,68,0.3)" }}>
              ⚠ {err}
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={save} disabled={busy}
                    className="text-[11px] font-black text-slate-900 px-4 py-1.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ background: "#15803d", color: "#ffffff" }}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button onClick={() => { setEditing(null); setErr(""); }} disabled={busy}
                    className="text-[11px] font-bold px-3 py-1.5 rounded-lg text-slate-400 border border-slate-200 bg-slate-50 hover:bg-slate-100 disabled:opacity-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {!editing && (
        <div className="space-y-2">
          {members.length === 0 && (
            <div className="text-center py-6 text-[11px] text-slate-600">
              No employees configured. Click "+ Add Employee" to add your first factory worker.
            </div>
          )}
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                 style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.08)" }}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[12px] font-bold text-slate-900">{m.name}</span>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{ background: m.active ? "rgba(34,197,94,0.10)" : "rgba(17,24,39,0.03)",
                                 border: `1px solid ${m.active ? "rgba(34,197,94,0.3)" : "rgba(17,24,39,0.10)"}`,
                                 color: m.active ? "#15803d" : "#64748b" }}>
                    {m.active ? "Active" : "Inactive"}
                  </span>
                </div>
                {Array.isArray(m.departments) && m.departments.length > 0 && (
                  <div className="text-[10px] text-slate-500 mt-0.5">{m.departments.join(", ")}</div>
                )}
              </div>
              {canConfig && (
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button onClick={() => toggleActive(m.id)}
                          className="text-[10px] font-semibold px-2 py-1 rounded-md transition-colors"
                          style={{ color: m.active ? "#6b7280" : "#15803d", border: "1px solid rgba(17,24,39,0.12)", background: "rgba(17,24,39,0.03)" }}>
                    {m.active ? "Deactivate" : "Activate"}
                  </button>
                  <button onClick={() => start(m)}
                          className="text-[10px] font-semibold px-2 py-1 rounded-md text-blue-300"
                          style={{ border: "1px solid rgba(17,24,39,0.12)", background: "rgba(17,24,39,0.03)" }}>
                    Edit
                  </button>
                  <button onClick={() => remove(m.id)}
                          className="text-[10px] font-semibold px-2 py-1 rounded-md text-red-400"
                          style={{ border: "1px solid rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.04)" }}>
                    ✕
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
