// src/shared/ui/Topbar.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useEffect } from "react";
import { Menu } from "lucide-react";
import { MobileNavContext } from "../components/PageHeader.jsx";
import { ThemeSwitch } from "./ThemeSwitch.jsx";

// ─── TOPBAR ──────────────────────────────────────────────────────────────────

// Opening the navigation drawer is a shell concern, but the button belongs in
// the Topbar, which is rendered by fifteen different pages that know nothing
// about the shell. A context carries it there without threading a prop through
// all fifteen — and without the button drifting out of the header into a
// floating control that overlaps page content.
// MobileNavContext now lives in components/PageHeader.jsx (shared with src/pages).

// 2026-11-05 (speed): the ticking clock is its own tiny component, so the
// once-a-second tick re-renders only this text — not the whole page header.
function TopbarClock() {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return time.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function Topbar({ title, subtitle, children }) {
  const onMenu = React.useContext(MobileNavContext);

  return (
    <div className="page-header flex-shrink-0 no-print flex flex-wrap items-center gap-x-3 sm:gap-x-4 gap-y-2.5 px-4 sm:px-6 py-3.5"
         style={{ background: "var(--surface-card)", borderBottom: "1px solid var(--border-subtle)" }}>
      {/* Opens the navigation drawer. Hidden from md up, where the sidebar is
          a permanent column and this would be a button to nothing. */}
      {onMenu && (
        <button onClick={onMenu} aria-label="Open navigation"
                className="nav-menu-btn flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-colors"
                style={{ color: "var(--text-dim)", border: "1px solid var(--border-subtle)" }}>
          <Menu size={18} aria-hidden="true" />
        </button>
      )}
      <div className="flex-1 min-w-[150px]">
        <h1 className="text-[17px] font-extrabold tracking-[-0.02em] leading-tight" style={{ color: "var(--text-strong)" }}>{title}</h1>
        {subtitle && <p className="text-[11.5px] mt-1 leading-snug font-normal" style={{ color: "var(--text-dim)" }}>{subtitle}</p>}
      </div>
      {/* Light / Dark / Auto — each person's choice, remembered in this browser */}
      <ThemeSwitch className="flex-shrink-0" />
      <div className="text-[11px] tabular-nums hidden sm:flex items-center gap-1.5 flex-shrink-0 px-3 py-1.5 rounded-lg"
           style={{ fontFamily: "'Inter',system-ui,sans-serif", color: "var(--text-dim)", background: "var(--surface-raised)", border: "1px solid var(--border-subtle)" }}>
        <TopbarClock />
      </div>
      {children && <div className="page-header-actions flex items-center gap-2 flex-wrap">{children}</div>}
    </div>
  );
}
