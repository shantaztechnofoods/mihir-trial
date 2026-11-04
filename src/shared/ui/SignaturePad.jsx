// src/shared/ui/SignaturePad.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useEffect, useRef } from "react";

// ── Phase A — Signature Pad ────────────────────────────────────────────────
// Minimal <canvas>-based pad. Captures mouse + touch strokes, serializes to
// an SVG path on export. Zero third-party deps; the serialized SVG is what
// gets persisted to employee_signatures.signature_svg.
export function SignaturePad({ onSave, onCancel, initialSvg = "", light = false }) {
  const canvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [strokes, setStrokes] = useState([]);
  const [current, setCurrent] = useState([]);
  const [hint,    setHint]    = useState(initialSvg ? "Draw to replace the previous signature." : "Draw your signature inside the box.");
  const WIDTH = 400, HEIGHT = 150;

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Replay strokes so a mid-draw re-render doesn't blank the pad.
    for (const s of strokes) {
      if (s.length < 1) continue;
      ctx.beginPath();
      ctx.moveTo(s[0].x, s[0].y);
      for (let i = 1; i < s.length; i++) ctx.lineTo(s[i].x, s[i].y);
      ctx.stroke();
    }
    if (current.length > 1) {
      ctx.beginPath();
      ctx.moveTo(current[0].x, current[0].y);
      for (let i = 1; i < current.length; i++) ctx.lineTo(current[i].x, current[i].y);
      ctx.stroke();
    }
  }, [strokes, current]);

  const pointFromEvent = (e) => {
    const c = canvasRef.current;
    const rect = c.getBoundingClientRect();
    const scaleX = WIDTH / rect.width;
    const scaleY = HEIGHT / rect.height;
    const t = e.touches ? e.touches[0] : e;
    return { x: (t.clientX - rect.left) * scaleX, y: (t.clientY - rect.top) * scaleY };
  };

  const start = (e) => { e.preventDefault(); setDrawing(true); setCurrent([pointFromEvent(e)]); };
  const move  = (e) => { if (!drawing) return; e.preventDefault(); setCurrent((prev) => [...prev, pointFromEvent(e)]); };
  const end   = () => { if (!drawing) return; setDrawing(false); setStrokes((prev) => [...prev, current]); setCurrent([]); };

  const clear = () => { setStrokes([]); setCurrent([]); setHint("Draw your signature inside the box."); };

  const save = () => {
    if (strokes.length === 0) { setHint("Please draw a signature first."); return; }
    // Serialize to SVG. Each stroke becomes an <polyline>.
    const polylines = strokes.map((s) =>
      `<polyline points="${s.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}" />`
    ).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${polylines}</svg>`;
    onSave(svg);
  };

  return (
    <div className="w-full">
      <div className={"text-[11px] mb-2 " + (light ? "text-slate-500" : "text-slate-400")}>{hint}</div>
      <canvas
        ref={canvasRef}
        width={WIDTH} height={HEIGHT}
        style={{ width: "100%", maxWidth: WIDTH, height: HEIGHT, background: light ? "#ffffff" : "var(--surface-elevated)", border: light ? "1px solid #cbd5e1" : "1px solid var(--border-rim)", borderRadius: 8, touchAction: "none", cursor: "crosshair" }}
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end}
      />
      <div className="flex items-center gap-2 mt-3">
        <button type="button" onClick={clear}
                className={light ? "text-[11px] font-bold px-3 py-1.5 rounded-lg text-slate-600 border border-slate-300 bg-white hover:bg-slate-50 transition-all" : "text-[11px] font-bold px-3 py-1.5 rounded-lg text-slate-400 border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:text-slate-900 transition-all"}>
          Clear
        </button>
        <div className="flex-1" />
        {onCancel && (
          <button type="button" onClick={onCancel}
                  className={light ? "text-[11px] font-bold px-3 py-1.5 rounded-lg text-slate-600 border border-slate-300 bg-white hover:bg-slate-50 transition-all" : "text-[11px] font-bold px-3 py-1.5 rounded-lg text-slate-400 border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:text-slate-900 transition-all"}>
            Cancel
          </button>
        )}
        <button type="button" onClick={save}
                className="wu-sig-save text-[11px] font-black text-white px-4 py-1.5 rounded-lg transition-all"
                style={{ background: "#2640B0", boxShadow: "0 1px 2px rgba(17,24,39,0.14)", color: "#ffffff" }}>
          Save Signature
        </button>
      </div>
    </div>
  );
}
