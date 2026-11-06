// src/modules/dashboard/Line3DView.jsx — Dashboard "Production line today" → 3D view (2026-11-06).
// Loaded ONLY when "3D view" is tapped (React.lazy in ProductionLinePanel), so
// three.js and this file stay out of the main bundle. Display only: everything
// shown comes from buildProductionLine() (the same rules + words as the Line
// view) and the BOM photos already loaded in the app. A click on a machine or
// its tag shows a small in-place summary; its "Open in Machine Tracker" button
// calls the same navigation the Line view uses.
// Review v2 (2026-11-06): one-line tags with a time bar, never cut or
// overlapping (compact form when space is short), "+N more" per department,
// hover focus, empty state, theme follow, spoken summary for screen readers.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { LINE_STAGES, stageStatusLines, visibleOnLine, tagStatus } from "./productionLine.js";
import { formatDuration } from "../../utils/handoverLogic.js";
import { mountLine, webglAvailable } from "./line3d.js";
import { cutoutPhoto } from "./photoCutout.js";
import "./line3d.css";

const ICON = { ok: "✓", near: "◷", late: "⚠", hold: "‖", incoming: "→", idle: "" };
const STAGE_INDEX = Object.fromEntries(LINE_STAGES.map((s, i) => [s.key, i]));

export function initials(name) {
  const w = String(name || "").trim().split(/\s+/).filter(Boolean);
  return w.slice(0, 2).map((x) => x[0].toUpperCase()).join("");
}

function chipOf(lines) {
  const first = lines[0] || { tone: "idle", icon: null, text: "Empty" };
  const t = first.icon === "hold" ? "hold" : first.icon === "late" ? "late" : first.icon === "near" ? "near" : first.icon === "ok" ? "ok" : "idle";
  return { t, s: first.text };
}
const zoneTone = (lines) => { const t = chipOf(lines).t; return t === "near" ? "near" : t; };

const reduceMotion = () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
const isDark = () => document.documentElement.getAttribute("data-theme") === "dark"
  || (document.documentElement.getAttribute("data-theme") !== "light" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches);

// Tags never overlap and never leave the stage. Interval packing: late / on
// hold tags are placed first (lowest rows, nearest their machine), then the
// calm ones. When the rows do not fit, calm tags go compact, then all; a calm
// tag that still has no room is hidden (its machine stays clickable and is
// counted in the zone chip). Returns nothing; writes transforms.
const RANK = { hold: 0, late: 1, near: 2, incoming: 3, ok: 4 };
function layoutTags(host, ms, stageW) {
  if (!host) return;
  const GAP = 6, TOP = 4;
  const els = ms.map((s) => ({ ...s, el: host.querySelector(`[data-sn="${CSS.escape(s.sn)}"]`) })).filter((s) => s.el);
  if (!els.length) return;
  const base = Math.min(...els.map((s) => s.y)) - 6;
  const order = els.slice().sort((a, b) => (RANK[a.el.dataset.s] ?? 9) - (RANK[b.el.dataset.s] ?? 9) || a.x - b.x);
  const place = (compactCalm, compactAll, allowHide) => {
    for (const s of els) { const calm = s.el.dataset.s === "ok" || s.el.dataset.s === "incoming"; s.el.toggleAttribute("data-compact", compactAll || (compactCalm && calm)); s.el.removeAttribute("data-hidden"); }
    const rowH = Math.max(...els.map((s) => s.el.offsetHeight)) + 5;
    const maxRows = Math.max(1, Math.floor((base - TOP) / rowH));
    const rows = Array.from({ length: maxRows }, () => []);
    const out = [];
    for (const s of order) {
      const w = s.el.offsetWidth, l = Math.round(Math.min(Math.max(4, s.x - w / 2), stageW - w - 4));
      const r = rows.findIndex((iv) => iv.every(([a, b]) => l + w + GAP <= a || l >= b + GAP));
      if (r < 0) { if (!allowHide) return null; out.push([s, l, -1]); continue; }
      rows[r].push([l, l + w]); out.push([s, l, r]);
    }
    return { out, rowH };
  };
  const res = place(false, false, false) || place(true, false, false) || place(true, true, false) || place(true, true, true);
  for (const [s, l, r] of res.out) {
    if (r < 0) { s.el.setAttribute("data-hidden", ""); continue; }
    const y = base - r * res.rowH;
    s.el.style.transform = `translate(${l}px,${Math.round(y)}px) translateY(-100%)`;
    s.el.style.setProperty("--lead", Math.max(0, Math.round(s.y - y - 2)) + "px");
    s.el.style.setProperty("--lx", Math.round(s.x - l) + "px");
    s.el.dataset.row = r;
  }
}

export default function Line3DView({ line, bomDefs = {}, onOpenMachine, onFail }) {
  const glRef = useRef(null), tagsRef = useRef(null), chipsRef = useRef(null), stageRef = useRef(null), popRef = useRef(null);
  const apiRef = useRef(null);
  const [cap, setCap] = useState(6);
  const all = line.onLine || [];
  const { shown: items, more } = useMemo(() => visibleOnLine(all, cap), [all, cap]);
  const readyList = (line.readyList || []).slice(0, 3);
  const urlOf = (bomKey) => { const u = bomDefs && bomDefs[bomKey] && bomDefs[bomKey].photoUrl; return typeof u === "string" && u.trim() ? u.trim() : ""; };
  const family = (bomKey) => (/^r/i.test(bomKey || "") ? "R" : "M");
  const machines = items.map((it) => ({ id: String(it.id), z: STAGE_INDEX[it.stage], state: it.kind, url: urlOf(it.bomKey), family: family(it.bomKey) }));
  const ready = readyList.map((m) => ({ id: String(m.id), url: urlOf(m.bomKey), family: family(m.bomKey) }));
  const zones = line.stages.map((st) => ({ k: st.key, label: st.label, head: st.head, tone: zoneTone(stageStatusLines(st)), count: st.count }));
  const rackCount = (line.stages.find((s) => s.key === "Rack") || {}).count || 0;
  const sig = [...machines.map((m) => `${m.id}:${m.url}`).sort(), "R", ...ready.map((m) => `${m.id}:${m.url}`), "Z", ...zones.map((z) => `${z.head}:${z.tone}`), rackCount].join("|");
  const latest = useRef(null); latest.current = { machines, ready, zones, rackCount };
  const itemsRef = useRef(items); itemsRef.current = items;
  const failRef = useRef(onFail); failRef.current = onFail;

  const [photos, setPhotos] = useState(null);
  const [mountN, setMountN] = useState(0);
  const [hot, setHot] = useState(null);
  const [sel, setSel] = useState(null);

  // Fewer machines per department when the panel is narrow (tags must fit).
  useEffect(() => {
    const el = stageRef.current; if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => setCap(el.clientWidth < 700 ? 3 : el.clientWidth < 1000 ? 4 : 6));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  // Follow the light / petrol-dark switch while the 3D view is open.
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return undefined;
    const mo = new MutationObserver(() => setMountN((n) => n + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

  // 1. Photos: cut out once per URL (cached), then mount.
  useEffect(() => {
    let alive = true;
    const urls = [...new Set([...latest.current.machines, ...latest.current.ready].map((m) => m.url).filter(Boolean))];
    Promise.all(urls.map((u) => cutoutPhoto(u).then((p) => [u, p]))).then((pairs) => { if (alive) setPhotos(Object.fromEntries(pairs)); });
    return () => { alive = false; };
  }, [sig]);

  // 2. Scene: mounted when the photos are ready; disposed on unmount / remount.
  useEffect(() => {
    if (!photos || !glRef.current) return undefined;
    if (!webglAvailable()) { failRef.current?.("3D view needs WebGL, which this browser has turned off. Showing Line."); return undefined; }
    const cur = latest.current, ph = (m) => ({ ...m, photo: m.url ? photos[m.url] || null : null });
    let api;
    try {
      api = mountLine(glRef.current, {
        zones: cur.zones, machines: cur.machines.map(ph), ready: cur.ready.map(ph), rackCount: cur.rackCount,
        dark: isDark(), reduce: reduceMotion(),
        onHover: (sn) => setHot(sn),
        onPick: (sn) => setSel(sn),
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
      if (kk !== chipKey && chipsRef.current) {
        chipKey = kk;
        [...chipsRef.current.children].forEach((c, i) => { if (!zs[i]) return; c.style.left = zs[i].x + "px"; c.style.width = Math.max(40, zs[i].w - 6) + "px"; c.toggleAttribute("data-narrow", zs[i].w < 92); });
        stageRef.current?.querySelectorAll("[data-more]").forEach((b) => { const z = zs[Number(b.dataset.more)]; if (z) { b.style.left = z.x + "px"; b.style.top = Math.round(z.y + 4) + "px"; } });
      }
      const ms = api.machineScreen(), mk = ms.map((s) => s.x.toFixed(0) + "," + s.y.toFixed(0)).join("|") + "|" + (stageRef.current?.clientWidth || 0);
      if (mk !== tagKey) { tagKey = mk; layoutTags(tagsRef.current, ms, stageRef.current?.clientWidth || 1000); }
    };
    api.kick();
    if (typeof window !== "undefined") window.__dash3d = api; // e2e hook (renderer.info)
    return () => { api.stop(); if (apiRef.current === api) apiRef.current = null; if (window.__dash3d === api) window.__dash3d = null; };
  }, [photos, mountN]);

  // 3. Live data: a dept change glides; anything structural remounts.
  const live = machines.map((m) => `${m.id}:${m.z}:${m.state}`).join("|");
  useEffect(() => {
    const api = apiRef.current; if (!api) return;
    const ok = api.update(latest.current.machines.map((m) => ({ ...m, photo: null })));
    if (!ok) setMountN((n) => n + 1);
    else api.kick();
  }, [live]);
  // Tag text changes (time in dept) move nothing in 3D but re-measure the tags.
  useEffect(() => { apiRef.current?.kick(); });

  // In-place summary: Esc / outside tap closes it.
  const close = () => { setSel(null); apiRef.current?.pick(null); };
  useEffect(() => {
    if (!sel) return undefined;
    const key = (e) => { if (e.key === "Escape") close(); };
    const down = (e) => { if (popRef.current && !popRef.current.contains(e.target) && !e.target.closest?.(".f3-tag, .f3-gl")) close(); };
    document.addEventListener("keydown", key); document.addEventListener("pointerdown", down);
    popRef.current?.querySelector("[data-open-mt]")?.focus();
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("pointerdown", down); };
  }, [sel]);

  const headOf = (it) => (line.stages.find((s) => s.key === it.stage) || {}).head || "";
  const selIt = sel ? items.find((x) => String(x.id) === sel) : null;
  const selPos = (() => {
    if (!selIt || !apiRef.current) return null;
    const p = apiRef.current.machineScreen().find((s) => s.sn === sel); const W = stageRef.current?.clientWidth || 1000;
    return p ? { left: Math.round(Math.min(Math.max(8, p.x - 130), W - 268)) } : null;
  })();
  const lastWorker = (m) => { const h = (m && Array.isArray(m.history) ? m.history : []).slice().reverse().find((x) => x && (x.mainEmployeeName || x.by)); return h ? h.mainEmployeeName || h.by : ""; };
  const summary = `3D production line. ${line.stages.map((st) => `${st.label}${st.head ? ` (head ${st.head})` : ""}: ${st.count}, ${stageStatusLines(st).map((l) => l.text).join(", ")}`).join(". ")}.`;

  return (
    <div className="f3-wrap" data-floor-3d>
      <div className={`f3-stage${hot || sel ? " is-focus" : ""}`} ref={stageRef}>
        <div className="f3-gl" ref={glRef} role="img" aria-label={summary} />
        <div className="f3-tags" ref={tagsRef}>
          {items.map((it) => {
            const head = headOf(it), st = tagStatus(it), id = String(it.id);
            return (
              <button key={it.id} type="button" className={`f3-tag${hot === id || sel === id ? " is-hot" : ""}`} data-sn={id} data-s={it.kind}
                      title={`${it.serial || it.name} · ${it.name} — ${it.text}${head ? ` · head ${head}` : ""}`}
                      aria-label={`${it.serial || it.name}, ${it.name}, ${it.stage}: ${it.text}${it.minutesInDept != null ? `, ${formatDuration(it.minutesInDept)} in department` : ""}${head ? `, head ${head}` : ""}. Show details`}
                      aria-expanded={sel === id}
                      onClick={() => { if (apiRef.current) apiRef.current.pick(id); else setSel(id); }}
                      onMouseEnter={() => apiRef.current?.setHover(id)} onMouseLeave={() => apiRef.current?.setHover(null)}>
                <span className="f3-tl">
                  <b>{it.serial || "—"}</b><span className="f3-tb">{it.bomKey || it.name}</span>
                  <span className="f3-ts" data-s={it.kind}><span aria-hidden="true">{ICON[it.kind]}</span><span className="f3-tt">{st.words}</span></span>
                  {head && <abbr title={head}>{initials(head)}</abbr>}
                </span>
                {st.share != null && <span className="f3-bar" data-s={it.kind} aria-hidden="true"><i style={{ width: `${Math.round(st.share * 100)}%` }} /></span>}
              </button>
            );
          })}
        </div>
        {Object.entries(more).map(([stage, n]) => (
          <button key={stage} type="button" className="f3-more" data-more={STAGE_INDEX[stage]} onClick={() => onOpenMachine?.("active")}
                  aria-label={`${n} more machines in ${stage}. Open Machine Tracker`}>+{n} more</button>
        ))}
        {photos && all.length === 0 && (
          <div className="f3-empty" role="status" data-3d-empty><b>No machines in the departments right now</b><span>Issue a BOM in Machine Tracker to start one.</span></div>
        )}
        {selIt && (
          <div className="f3-pop" ref={popRef} role="dialog" aria-label={`${selIt.serial || selIt.name} details`} style={selPos || undefined} data-3d-popover>
            <button type="button" className="f3-pop-x" onClick={close} aria-label="Close details">×</button>
            <div className="f3-pop-h"><b>{selIt.serial || "—"}</b><span>{selIt.name}</span></div>
            <dl>
              <dt>Department</dt><dd>{selIt.stage}{selIt.minutesInDept != null && <> · {formatDuration(selIt.minutesInDept)}{selIt.targetMinutes ? ` of ${formatDuration(selIt.targetMinutes)}` : ""}</>}</dd>
              <dt>Status</dt><dd className="f3-ts" data-s={selIt.kind}><span aria-hidden="true">{ICON[selIt.kind]}</span> {selIt.text}</dd>
              {headOf(selIt) && <><dt>Head</dt><dd>{headOf(selIt)}</dd></>}
              {lastWorker(selIt.machine) && <><dt>Last signed</dt><dd>{lastWorker(selIt.machine)}</dd></>}
            </dl>
            <button type="button" className="f3-pop-go" data-open-mt onClick={() => { const k = selIt.kind; close(); onOpenMachine?.(k === "hold" ? "hold" : "active"); }}>Open in Machine Tracker</button>
          </div>
        )}
        {!photos && <div className="f3-loading" role="status">Loading 3D view…</div>}
      </div>
      <div className="f3-chips" ref={chipsRef}>
        {line.stages.map((st) => {
          const c = chipOf(stageStatusLines(st));
          return (
            <div key={st.key} className="f3-chip" data-t={c.t} data-chip={st.key} title={`${st.label}: ${st.count} · ${c.s}`}>
              <span className="f3-cn"><em>{st.count}</em><b>{st.label}</b></span>
              <span className="f3-cs">{ICON[c.t] && <u aria-hidden="true">{ICON[c.t]}</u>}{c.s}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
