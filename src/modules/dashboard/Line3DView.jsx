// src/modules/dashboard/Line3DView.jsx — Dashboard "Production line today" → 3D view (2026-11-06).
// Loaded ONLY when "3D view" is tapped (React.lazy in ProductionLinePanel), so
// three.js and this file stay out of the main bundle. Display only: everything
// shown comes from buildProductionLine() (the same rules + words as the Line
// view) and the BOM photos already loaded in the app. A click on a machine or
// its tag calls the same Machine Tracker navigation the Line view uses.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { LINE_STAGES, stageStatusLines } from "./productionLine.js";
import { mountLine, webglAvailable } from "./line3d.js";
import { cutoutPhoto } from "./photoCutout.js";
import "./line3d.css";

const ICON = { ok: "✓", near: "◷", late: "⚠", hold: "‖", incoming: "→", idle: "" };
const STAGE_INDEX = Object.fromEntries(LINE_STAGES.map((s, i) => [s.key, i]));

export function initials(name) {
  const w = String(name || "").trim().split(/\s+/).filter(Boolean);
  return w.slice(0, 2).map((x) => x[0].toUpperCase()).join("");
}

// Stage chip words: the first status line of the stage (same text as the strip).
function chipOf(_stage, lines) {
  const first = lines[0] || { tone: "idle", icon: null, text: "Empty" };
  const t = first.icon === "hold" ? "hold" : first.icon === "late" ? "late" : first.icon === "near" ? "near" : first.icon === "ok" ? "ok" : "idle";
  return { t, s: first.text };
}

const reduceMotion = () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

// Tags never overlap: greedy rows on one common baseline; rows above row 0 get a hairline leader.
function layoutTags(host, ms) {
  if (!host || !ms.length) return;
  const rows = [], GAPX = 6, ROWH = 36;
  const base = Math.min(...ms.map((s) => s.y)) - 6;
  const order = ms.map((s) => ({ ...s, el: host.querySelector(`[data-sn="${CSS.escape(s.sn)}"]`) })).filter((s) => s.el).sort((a, b) => a.x - b.x);
  for (const s of order) {
    const w = s.el.offsetWidth, l = s.x - w / 2; let r = 0;
    while (rows[r] !== undefined && l < rows[r] + GAPX) r++;
    rows[r] = l + w;
    const y = base - r * ROWH;
    s.el.style.transform = `translate(${Math.round(l)}px,${Math.round(y)}px) translateY(-100%)`;
    s.el.style.setProperty("--lead", Math.max(0, Math.round(s.y - y - 2)) + "px"); s.el.dataset.row = r;
  }
}

export default function Line3DView({ line, bomDefs = {}, onOpenMachine, onFail }) {
  const glRef = useRef(null), tagsRef = useRef(null), chipsRef = useRef(null), stageRef = useRef(null);
  const apiRef = useRef(null);
  const items = line.onLine || [];
  const urlOf = (it) => { const u = bomDefs && bomDefs[it.bomKey] && bomDefs[it.bomKey].photoUrl; return typeof u === "string" && u.trim() ? u.trim() : ""; };
  const machines = items.map((it) => ({ id: String(it.id), z: STAGE_INDEX[it.stage], state: it.kind, url: urlOf(it) }));
  const sig = machines.map((m) => `${m.id}:${m.url}`).sort().join("|");
  const latest = useRef(machines); latest.current = machines;
  const itemsRef = useRef(items); itemsRef.current = items;
  const failRef = useRef(onFail); failRef.current = onFail;
  const openRef = useRef(onOpenMachine); openRef.current = onOpenMachine;

  const [photos, setPhotos] = useState(null);
  const [mountN, setMountN] = useState(0);
  const [hot, setHot] = useState(null);

  // 1. Photos: cut out once per URL (cached), then mount.
  useEffect(() => {
    let alive = true;
    const urls = [...new Set(latest.current.map((m) => m.url).filter(Boolean))];
    Promise.all(urls.map((u) => cutoutPhoto(u).then((p) => [u, p]))).then((pairs) => { if (alive) setPhotos(Object.fromEntries(pairs)); });
    return () => { alive = false; };
  }, [sig]);

  // 2. Scene: mounted when the photos are ready; disposed on unmount / remount.
  useEffect(() => {
    if (!photos || !glRef.current) return undefined;
    if (!webglAvailable()) { failRef.current?.("3D view needs WebGL, which this browser has turned off. Showing Line."); return undefined; }
    const stageBg = stageRef.current ? getComputedStyle(stageRef.current).backgroundColor : "";
    const dark = document.documentElement.getAttribute("data-theme") === "dark"
      || (document.documentElement.getAttribute("data-theme") !== "light" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
    let api;
    try {
      api = mountLine(glRef.current, {
        zones: LINE_STAGES.map((s) => ({ k: s.key })),
        machines: latest.current.map((m) => ({ ...m, photo: m.url ? photos[m.url] || null : null })),
        dark, bg: /^rgb/.test(stageBg) ? stageBg : null, reduce: reduceMotion(),
        onHover: (sn) => setHot(sn),
        onPick: (sn) => {
          const it = itemsRef.current.find((x) => String(x.id) === sn);
          openRef.current?.(it && it.kind === "hold" ? "hold" : "active");
        },
      });
    } catch (e) {
      console.warn("[dashboard-3d] could not start", e);
      failRef.current?.("3D view could not start on this device. Showing Line.");
      return undefined;
    }
    apiRef.current = api;
    let chipKey = "", tagKey = "";
    api.onFrame = () => {
      const zs = api.zoneScreen(), kk = zs.map((z) => z.x.toFixed(0) + "," + z.w.toFixed(0)).join("|");
      if (kk !== chipKey && chipsRef.current) { chipKey = kk; [...chipsRef.current.children].forEach((c, i) => { if (!zs[i]) return; c.style.left = zs[i].x + "px"; c.style.width = Math.max(60, zs[i].w - 4) + "px"; }); }
      const ms = api.machineScreen(), mk = ms.map((s) => s.x.toFixed(0) + "," + s.y.toFixed(0)).join("|");
      if (mk !== tagKey) { tagKey = mk; layoutTags(tagsRef.current, ms); }
    };
    if (typeof window !== "undefined") window.__dash3d = api; // e2e hook (renderer.info)
    return () => { api.stop(); if (apiRef.current === api) apiRef.current = null; if (window.__dash3d === api) window.__dash3d = null; };
  }, [photos, mountN]);

  // 3. Live data: a dept change glides; anything structural remounts.
  const live = machines.map((m) => `${m.id}:${m.z}:${m.state}`).join("|");
  useEffect(() => {
    const api = apiRef.current; if (!api) return;
    const ok = api.update(latest.current.map((m) => ({ ...m, photo: null })));
    if (!ok) setMountN((n) => n + 1);
    else api.kick();
  }, [live]);
  // Tag text changes (time in dept) move nothing in 3D but re-measure the tags.
  useEffect(() => { apiRef.current?.kick(); });

  const chips = useMemo(() => line.stages.map((st) => ({ st })), [line.stages]);

  return (
    <div className="f3-wrap" data-floor-3d>
      <div className="f3-stage" ref={stageRef}>
        <div className="f3-gl" ref={glRef} role="img"
             aria-label={`3D production line: ${LINE_STAGES.map((s) => s.label).join(", ")}. ${items.length} machine${items.length === 1 ? "" : "s"} in the work departments. Use the tags to open a machine.`} />
        <div className="f3-tags" ref={tagsRef}>
          {items.map((it) => {
            const head = (line.stages.find((s) => s.key === it.stage) || {}).head || "";
            return (
              <button key={it.id} type="button" className={`f3-tag${hot === String(it.id) ? " is-hot" : ""}`} data-sn={String(it.id)} data-s={it.kind}
                      title={`${it.serial || it.name} · ${it.name} — ${it.text}${head ? ` · head ${head}` : ""}`}
                      aria-label={`${it.serial || it.name}, ${it.name}, ${it.stage}: ${it.text}. Open in Machine Tracker`}
                      onClick={() => (apiRef.current ? apiRef.current.pick(String(it.id)) : onOpenMachine?.(it.kind === "hold" ? "hold" : "active"))}
                      onMouseEnter={() => apiRef.current?.setHover(String(it.id))} onMouseLeave={() => apiRef.current?.setHover(null)}>
                <b>{it.serial || "—"}</b><span className="f3-tb">{it.name}</span>
                <span className="f3-ts" data-s={it.kind}><span aria-hidden="true">{ICON[it.kind]}</span> <span className="f3-tt">{it.text}</span>{head && <abbr title={head}>{initials(head)}</abbr>}</span>
              </button>
            );
          })}
        </div>
        {!photos && <div className="f3-loading" role="status">Loading 3D view…</div>}
      </div>
      <div className="f3-chips" ref={chipsRef}>
        {chips.map(({ st }) => {
          const c = chipOf(st, stageStatusLines(st));
          return (
            <div key={st.key} className="f3-chip" data-t={c.t} data-chip={st.key}>
              <span className="f3-cn"><b>{st.label}</b>{st.head && <small> · {st.head}</small>}</span>
              <em>{st.count}</em>
              <span className="f3-cs">{ICON[c.t] && <u aria-hidden="true">{ICON[c.t]}</u>}{c.s}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
