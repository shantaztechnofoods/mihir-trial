// src/modules/settings/ModulesPanel.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useEffect } from "react";
import { ENABLED_MODULES_ENV } from "../../config/env.js";
import { MODULES, ALWAYS_ON_MODULES, effectiveEnabledModules, isModuleOn, envLockedModules } from "../../utils/modules.js";
import { Section, Toggle } from "./settingsUi.jsx";

// Go-live 2026-11-04 — Settings → Modules (super admin only). One switch per
// module; turning one OFF asks "Are you sure?". Saves through onSaveModules
// (handleSaveModules → settings.enabledModules + audit modules_changed).
// Modules outside the deployment's VITE_ENABLED_MODULES ceiling are shown
// locked OFF; Settings / Users / Roles are locked ON.
export function ModulesPanel({ settings, onSaveModules }) {
  const locked = envLockedModules(ENABLED_MODULES_ENV);
  const fromSettings = () => {
    const eff = effectiveEnabledModules(settings?.enabledModules, null);
    return MODULES.map((m) => m.id).filter((id) => isModuleOn(id, eff));
  };
  const [on, setOn] = useState(fromSettings);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const savedKey = JSON.stringify(fromSettings());
  const dirty = JSON.stringify(MODULES.map((m) => m.id).filter((id) => on.includes(id))) !== savedKey;
  // Adopt a change saved elsewhere while nothing is being edited here.
  useEffect(() => { if (!dirty) setOn(JSON.parse(savedKey)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [savedKey]);
  const flip = (id, next) => {
    if (!next && !window.confirm(`Are you sure? "${MODULES.find((m) => m.id === id)?.label || id}" will disappear for everyone after you press Save.`)) return;
    setMsg("");
    setOn((prev) => next ? [...new Set([...prev, id])] : prev.filter((x) => x !== id));
  };
  const save = async () => {
    setBusy(true); setMsg("");
    const res = await onSaveModules(on);
    setBusy(false);
    setMsg(res?.success ? "Saved. Everyone sees the new module list now." : `Save failed: ${res?.error || "unknown error"}`);
  };
  return (
    <Section icon="🧩" title="Modules (on / off)">
      <div className="text-[12px] text-slate-500 mb-3">
        A module that is OFF is hidden from the menu for everyone, including you. Turning it ON again brings it back with all its data.
        Machine Tracker's BOM issue and 📄 Reports menu follow Machine Tracker, not the Outward / Reports switches.
      </div>
      {MODULES.map((m) => {
        const always = ALWAYS_ON_MODULES.includes(m.id);
        const envOff = locked.includes(m.id);
        if (always || envOff) {
          return (
            <div key={m.id} className="flex items-center justify-between py-3.5 border-b border-slate-200 last:border-0">
              <div>
                <div className="text-[13px] font-semibold text-slate-900">{m.label}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{always ? "Always ON (so you can never lock yourself out)" : "OFF in this deployment (VITE_ENABLED_MODULES)"}</div>
              </div>
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: always ? "rgba(22,163,74,0.12)" : "rgba(17,24,39,0.06)", color: always ? "#15803d" : "#6b7280" }}>{always ? "ON" : "OFF"}</span>
            </div>
          );
        }
        return <Toggle key={m.id} checked={on.includes(m.id)} onChange={(v) => flip(m.id, v)} label={m.label} desc={on.includes(m.id) ? "ON" : "OFF"} />;
      })}
      <div className="mt-4 flex items-center gap-3 flex-wrap">
        <button type="button" data-save-modules disabled={busy || !dirty} onClick={save}
                className="text-xs font-bold px-4 py-2 rounded-xl"
                style={{ background: dirty ? "#2640B0" : "rgba(17,24,39,0.08)", color: dirty ? "#fff" : "#6b7280", minHeight: 40 }}>
          {busy ? "Saving…" : "💾 Save modules"}
        </button>
        {msg && <span className="text-[12px] font-semibold" style={{ color: msg.startsWith("Saved") ? "#15803d" : "#b91c1c" }}>{msg}</span>}
      </div>
    </Section>
  );
}
