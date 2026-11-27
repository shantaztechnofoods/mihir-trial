// src/modules/dashboard/LinePoster.jsx — instant stand-in for the 3D view (2026-11-27).
// Plain HTML + CSS (no three.js, lives in the main bundle, styles in world-ui.css):
// shown the moment "3D view" is tapped and kept until the first real 3D frame is
// drawn, so the tap is answered in one frame. Same data and words as the Line
// view (buildProductionLine + stageStatusLines): each department as a small bay
// with its count, its first status line and up to three machine blocks coloured
// by state. Display only — not clickable (the real 3D replaces it in ~1-2 s).
import React from "react";
import { stageStatusLines } from "./productionLine.js";

const ICON = { ok: "✓", near: "◷", late: "⚠", hold: "‖", incoming: "→" };

export function LinePoster({ line, label = "Preparing 3D view…" }) {
  return (
    <div className="f3-poster" data-3d-poster role="status" aria-label={label}>
      <div className="f3-poster-bays">
        {line.stages.map((st) => {
          const first = stageStatusLines(st)[0] || { tone: "idle", text: "Empty" };
          const t = first.icon === "hold" ? "hold" : first.tone;
          const blocks = Math.min(3, st.count || 0);
          return (
            <div key={st.key} className="f3-poster-bay" data-t={t}>
              <div className="f3-poster-floor">
                {Array.from({ length: blocks }, (_, i) => <i key={i} />)}
                {st.count > 3 && <small>+{st.count - 3}</small>}
              </div>
              <div className="f3-poster-plate"><b>{st.count}</b><span>{st.label}</span></div>
              <div className="f3-poster-st">{first.icon && ICON[first.icon] ? <u aria-hidden="true">{ICON[first.icon]}</u> : null}{String(first.text).split(" – ")[0]}</div>
            </div>
          );
        })}
      </div>
      <div className="f3-poster-note" aria-hidden="true">{label}</div>
    </div>
  );
}
