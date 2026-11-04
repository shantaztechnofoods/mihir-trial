// src/shared/ui/OrgLayout.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState } from "react";
import { Glyph } from "../components/LeadIcon.jsx";

// 2026-11-03 "organise, don't change": a collapsible group with a plain-English
// heading and a one-line helper. Children stay mounted while closed (just
// hidden), so every control, data-* hook and string is still in the page.
export function OrgGroup({ id, icon, title, hint, badge = null, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section data-org-group={id} className="org-group" data-open={open ? "1" : "0"}>
      <button type="button" className="org-group-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="org-group-icon" aria-hidden="true"><Glyph e={icon} size={18} /></span>
        <span className="org-group-text">
          <span className="org-group-title">{title}</span>
          {hint && <span className="org-group-hint">{hint}</span>}
        </span>
        {badge}
        <span className="org-group-chev" aria-hidden="true">▾</span>
      </button>
      <div className="org-group-body" hidden={!open}>{children}</div>
    </section>
  );
}

// Numbered step card used by BOM Edit (1 Details, 2 Parts, 3 Time, ...).
export function OrgStep({ n, id, title, hint, status = null, children }) {
  return (
    <section data-org-step={id} id={`org-step-${id}`} className="org-step">
      <div className="org-step-head">
        <span className="org-step-num" aria-hidden="true">{n}</span>
        <div className="org-step-text">
          <div className="org-step-title">{title}</div>
          {hint && <div className="org-step-hint">{hint}</div>}
        </div>
        {status}
      </div>
      <div className="org-step-body">{children}</div>
    </section>
  );
}
