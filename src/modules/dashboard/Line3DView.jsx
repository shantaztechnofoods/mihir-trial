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
// v6 (2026-11-06): workcell bays with andon stack lights, a progress ring per
// machine (the same time share as the tag bar), a header strip with big
// odometer numbers (In production · Late · On hold · Ready today, same counts as
// the header ring) and a dolly-in on click; the summary card sits beside it.
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

// Tags never overlap and never leave the stage. Late / on hold tags are placed
// first (nearest their machine), then the calm ones (compact from the start). When the rows do not fit, calm tags go compact, then all; a calm
// tag that still has no room is hidden (its machine stays clickable and is
// counted in the zone chip). Returns nothing; writes transforms.
const RANK = { hold: 0, late: 1, near: 2, incoming: 3, ok: 4 };
const TAG_TOP = 50; // the header strip (big numbers) owns the top band
function layoutTags(host, ms, stageW, onlySn = null) {
  if (!host) return;
  const GAP = 6, TOP = TAG_TOP;
  // Zoomed in on one machine: only its tag (the others are off to the side).
  if (onlySn) for (const s of ms) { const el = host.querySelector(`[data-sn="${CSS.escape(s.sn)}"]`); if (el && s.sn !== onlySn) el.setAttribute("data-hidden", ""); }
  const els = ms.filter((s) => !onlySn || s.sn === onlySn).map((s) => ({ ...s, el: host.querySelector(`[data-sn="${CSS.escape(s.sn)}"]`) })).filter((s) => s.el);
  if (!els.length) return;
  const order = els.slice().sort((a, b) => (RANK[a.el.dataset.s] ?? 9) - (RANK[b.el.dataset.s] ?? 9) || a.x - b.x);
  // v6: each tag stacks up from its OWN machine (the 3/4 view puts machines at
  // different heights), first free slot without touching another tag.
  const place = (compactCalm, compactAll, allowHide) => {
    for (const s of els) { const calm = s.el.dataset.s === "ok" || s.el.dataset.s === "incoming"; s.el.toggleAttribute("data-compact", compactAll || (compactCalm && calm)); s.el.removeAttribute("data-hidden"); }
    const rowH = Math.max(...els.map((s) => s.el.offsetHeight)) + 5, th = rowH - 5;
    const boxes = [], out = [];
    for (const s of order) {
      const w = s.el.offsetWidth, l = Math.round(Math.min(Math.max(4, s.x - w / 2), stageW - w - 4));
      let y = null, r = 0;
      for (let yy = Math.max(TOP + th, s.y - 6); yy - th >= TOP; yy -= rowH, r++) {
        if (boxes.every(([a, t, b, bt]) => l + w + GAP <= a || l >= b + GAP || yy + 3 <= t || yy - th >= bt + 3)) { y = yy; break; }
      }
      if (y == null) { if (!allowHide) return null; out.push([s, l, -1, 0]); continue; }
      boxes.push([l, y - th, l + w, y]); out.push([s, l, r, y]);
    }
    return { out, rowH };
  };
  // Calm (on time / waiting) tags start compact; late and on hold stay full.
  const res = place(true, false, false) || place(true, true, false) || place(true, true, true);
  for (const [s, l, r, y] of res.out) {
    if (r < 0) { s.el.setAttribute("data-hidden", ""); continue; }
    s.el.style.transform = `translate(${l}px,${Math.round(y)}px) translateY(-100%)`;
    s.el.style.setProperty("--lead", Math.max(0, Math.round(s.y - y - 2)) + "px");
    s.el.style.setProperty("--lx", Math.round(s.x - l) + "px");
    s.el.dataset.row = r;
  }
}

// Odometer digits: each digit rolls to its new value (instant with reduced motion).
function Odo({ n }) {
  const s = String(Math.max(0, Math.round(Number(n) || 0)));
  return (
    <span className="f3-odo" aria-hidden="true">
      {[...s].map((d, i) => (
        <span key={s.length - i} className="f3-od"><span style={{ transform: `translateY(${-Number(d)}em)` }}>{"0123456789".split("").map((x) => <i key={x}>{x}</i>)}</span></span>
      ))}
    </span>
  );
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
  const machines = items.map((it) => ({ id: String(it.id), z: STAGE_INDEX[it.stage], state: it.kind, share: tagStatus(it).share, url: urlOf(it.bomKey), family: family(it.bomKey) }));
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
  const selRef = useRef(null); selRef.current = sel;

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
        const sw = stageRef.current?.clientWidth || 1000;
        // v6: a chip is at least 76 px (words wrap on spaces, never cut), never overlaps its
        // neighbour and stays inside the card.
        const kids = [...chipsRef.current.children], n = Math.min(kids.length, zs.length);
        const ws = [], ls = [];
        for (let i = 0; i < n; i++) { ws[i] = Math.round(Math.max(76, zs[i].w - 6)); ls[i] = zs[i].x - ws[i] / 2; }
        const over = ws.reduce((t, w) => t + w + 4, -4) - (sw - 4), room = ws.reduce((t, w) => t + (w - 76), 0);
        if (over > 0 && room > 0) for (let i = 0; i < n; i++) { ws[i] = Math.floor(ws[i] - (ws[i] - 76) * Math.min(1, over / room)); ls[i] = zs[i].x - ws[i] / 2; }
        for (let i = 0; i < n; i++) ls[i] = Math.max(i ? ls[i - 1] + ws[i - 1] + 4 : 2, ls[i]);
        for (let i = n - 1; i >= 0; i--) ls[i] = Math.min(i < n - 1 ? ls[i + 1] - ws[i] - 4 : sw - ws[i] - 2, ls[i]);
        for (let i = 0; i < n; i++) { kids[i].style.width = ws[i] + "px"; kids[i].style.left = Math.round(ls[i]) + "px"; }
        stageRef.current?.querySelectorAll("[data-more]").forEach((b) => { const z = zs[Number(b.dataset.more)]; if (z) { b.style.left = z.x + "px"; b.style.top = Math.round(z.y + 4) + "px"; } });
      }
      const ms = api.machineScreen(), mk = ms.map((s) => s.x.toFixed(0) + "," + s.y.toFixed(0)).join("|") + "|" + (stageRef.current?.clientWidth || 0);
      const only = api.isZoomed() ? selRef.current : null;
      if (mk + only !== tagKey) { tagKey = mk + only; layoutTags(tagsRef.current, ms, stageRef.current?.clientWidth || 1000, only); }
    };
    api.kick();
    if (typeof window !== "undefined") window.__dash3d = api; // e2e hook (renderer.info)
    return () => { api.stop(); if (apiRef.current === api) apiRef.current = null; if (window.__dash3d === api) window.__dash3d = null; };
  }, [photos, mountN]);

  // 3. Live data: a dept change glides; anything structural remounts.
  const live = machines.map((m) => `${m.id}:${m.z}:${m.state}:${m.share == null ? "-" : Math.round(m.share * 72)}`).join("|");
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
    // The camera dollies the machine to just left of centre; the card sits to its right.
    const W = stageRef.current?.clientWidth || 1000;
    return { left: Math.round(Math.max(8, Math.min(W / 2 + 36, W - 272))) };
  })();
  const lastWorker = (m) => { const h = (m && Array.isArray(m.history) ? m.history : []).slice().reverse().find((x) => x && (x.mainEmployeeName || x.by)); return h ? h.mainEmployeeName || h.by : ""; };
  const lateN = (line.attention || []).filter((a) => a.kind === "late").length;
  const holdN = (line.attention || []).filter((a) => a.kind === "hold").length;
  const kpis = [
    { k: "prod", n: line.inProduction || 0, label: "In production" },
    { k: "late", n: lateN, label: "Late" },
    { k: "hold", n: holdN, label: "On hold" },
    { k: "ready", n: line.readyToday || 0, label: "Ready today" },
  ];
  const summary = `3D production line. ${line.stages.map((st) => `${st.label}${st.head ? ` (head ${st.head})` : ""}: ${st.count}, ${stageStatusLines(st).map((l) => l.text).join(", ")}`).join(". ")}.`;

  return (
    <div className="f3-wrap" data-floor-3d>
      <div className={`f3-stage${hot || sel ? " is-focus" : ""}${sel ? " is-zoom" : ""}`} ref={stageRef}>
        <div className="f3-gl" ref={glRef} role="img" aria-label={summary} />
        <div className="f3-kpis" data-3d-kpis role="group" aria-label={kpis.map((x) => `${x.n} ${x.label.toLowerCase()}`).join(", ")}>
          {kpis.map((x) => (
            <div key={x.k} className="f3-kpi" data-k={x.k} data-zero={x.n === 0 ? "" : undefined}>
              <Odo n={x.n} /><span className="f3-kl">{x.label}</span>
            </div>
          ))}
          <div className="f3-legend" aria-hidden="true">
            <span data-t="ok">On time</span><span data-t="near">Near limit</span><span data-t="late">Late</span><span data-t="hold">On hold</span>
          </div>
        </div>
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
            <div key={st.key} className="f3-chip" data-t={c.t} data-chip={st.key} title={`${st.label}: ${st.count} · ${c.s}`} aria-label={`${st.label}: ${st.count}, ${c.s}`}>
              <em>{st.count}</em>
              <span className="f3-cs">{ICON[c.t] && <u aria-hidden="true">{ICON[c.t]}</u>}{c.s}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
