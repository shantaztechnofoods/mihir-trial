// src/modules/settings/settingsUi.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React from "react";

// ─── SETTINGS PAGE ────────────────────────────────────────────────────────────

// Settings UI primitives — MODULE SCOPE (stable identity). Defining these inside
// SettingsPage caused inputs to lose focus on every keystroke (remount on re-render).
export const SLabel = ({ text, hint }) => (
  <div className="mb-1.5">
    <div className="text-[12px] font-semibold text-slate-500">{text}</div>
    {hint && <div className="text-[10px] text-slate-600 mt-0.5">{hint}</div>}
  </div>
);

export const Toggle = ({ checked, onChange, label, desc }) => (
  <div className="flex items-center justify-between py-3.5 border-b border-slate-200 last:border-0">
    <div>
      <div className="text-[13px] font-semibold text-slate-900">{label}</div>
      {desc && <div className="text-[11px] text-slate-500 mt-0.5">{desc}</div>}
    </div>
    <button onClick={() => onChange(!checked)}
            className="relative flex-shrink-0 w-11 h-6 rounded-full transition-all duration-200"
            style={{ background: checked ? "#2E50D6" : "rgba(17,24,39,0.10)", border: `1px solid ${checked ? "rgba(46, 80, 214,0.6)" : "rgba(17,24,39,0.14)"}` }}>
      <div className="absolute top-0.5 h-5 w-5 rounded-full transition-all duration-200 shadow"
           style={{ background: "#fff", left: checked ? "calc(100% - 22px)" : "2px" }} />
    </button>
  </div>
);

export const Section = ({ icon, title, children }) => (
  <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
    <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200"
         style={{ background: "rgba(17,24,39,0.03)" }}>
      <span className="text-base">{icon}</span>
      <span className="text-[14px] font-bold text-slate-900">{title}</span>
    </div>
    <div className="px-6 py-5">{children}</div>
  </div>
);
