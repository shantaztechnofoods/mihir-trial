// src/modules/dashboard/line3d.js — Dashboard "Production line today" 3D view (2026-11-06).
// Approved v4 scene: a light conveyor across the six stages; every machine on
// the line is its own BOM photo (cut out at runtime) standing on the belt; no
// photo → a neutral "No photo · add in BOM" silhouette. Display only: the data
// comes from productionLine.js, a click calls back into the existing Line-view
// navigation. Loaded ONLY via dynamic import() when "3D view" is tapped (three.js
// stays out of the main bundle). Renders only while visible/moving; stop()
// disposes every geometry, material, texture and the WebGL context.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

const C = { late: "#dc2626", hold: "#7c3aed" };
const BOX_W = 1.75, BOX_H = 1.25, GAP = 0.32, PAD = 0.7, MINZ = 2.6, END_W = 2.9;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (!gl) return false;
    const lose = gl.getExtension("WEBGL_lose_context"); if (lose) lose.loseContext();
    return true;
  } catch { return false; }
}

function tex(w, h, draw, srgb = true) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
const radial = (inner, outer) => tex(128, 128, (g, w, h) => { const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); r.addColorStop(0, inner); r.addColorStop(1, outer); g.fillStyle = r; g.fillRect(0, 0, w, h); });

// Billboard size from the photo's aspect, fitted in one box.
export function cardSize(aspect) {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 360 / 260;
  const w = Math.min(BOX_W, BOX_H * a);
  return { w, h: w / a };
}

// No photo: neutral machine silhouette + "No photo · add in BOM" (never an invented machine).
function placeholderTex() {
  return tex(360, 260, (g, w) => {
    const rr = (x, y, ww, hh, r) => { g.beginPath(); if (g.roundRect) g.roundRect(x, y, ww, hh, r); else g.rect(x, y, ww, hh); };
    rr(6, 6, w - 12, 248, 26); g.fillStyle = "rgba(255,255,255,.92)"; g.fill(); g.setLineDash([10, 8]); g.lineWidth = 3; g.strokeStyle = "#c3ccd8"; g.stroke(); g.setLineDash([]);
    g.fillStyle = "#dfe5ee"; rr(w / 2 - 80, 52, 160, 92, 14); g.fill(); rr(w / 2 - 92, 138, 184, 22, 8); g.fill();
    g.fillStyle = "#cbd4e0"; rr(w / 2 + 22, 72, 40, 26, 6); g.fill();
    g.fillStyle = "#64748b"; g.font = "600 30px Inter, system-ui, sans-serif"; g.textAlign = "center"; g.fillText("No photo", w / 2, 200);
    g.fillStyle = "#94a3b8"; g.font = "500 24px Inter, system-ui, sans-serif"; g.fillText("add in BOM", w / 2, 232);
  });
}

/**
 * mountLine(host, { zones, machines, dark, bg, reduce, onPick, onHover })
 *   zones:    [{ k }] six stages (first = Rack, last = Ready)
 *   machines: [{ id, z, state: "ok"|"near"|"late"|"hold"|"incoming", photo: { image, aspect } | null }]
 * Returns { update(machines) → bool, zoneScreen, machineScreen, pick, setHover, kick, stop, onFrame }.
 * update() glides machines whose zone changed (with the light trail) and swaps status
 * rings; it returns false when the set of machines changed and the caller must remount.
 */
export function mountLine(host, { zones, machines, dark = false, bg = null, reduce = false, onPick, onHover } = {}) {
  const N = zones.length;
  const STAGE_BG = bg || (dark ? "#0e1e21" : "#f3f5f8");
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  r.toneMapping = THREE.NeutralToneMapping; r.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(r.domElement);
  const sc = new THREE.Scene(); sc.background = new THREE.Color(STAGE_BG);
  const cam = new THREE.PerspectiveCamera(10, 6, 1, 160);
  sc.add(new THREE.HemisphereLight(0xffffff, dark ? 0x1a3236 : 0xd5dce6, dark ? 1.2 : 1.6));
  const key = new THREE.DirectionalLight(0xffffff, dark ? 1.3 : 1.6); key.position.set(-6, 10, 8); sc.add(key);

  const RB = (w, h, d, rad = 0.05, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, Math.min(rad, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
  const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };
  const M = dark ? {
    rail: new THREE.MeshStandardMaterial({ color: 0x335057, roughness: 0.4, metalness: 0.35 }),
    belt: new THREE.MeshStandardMaterial({ color: 0x1a3236, roughness: 0.7 }),
    leg: new THREE.MeshStandardMaterial({ color: 0x2a454a, roughness: 0.4, metalness: 0.4 }),
    puck: new THREE.MeshStandardMaterial({ color: 0x2a454a, roughness: 0.5 }),
    tote: new THREE.MeshStandardMaterial({ color: 0x3f73d3, roughness: 0.5 }),
    crate: new THREE.MeshStandardMaterial({ color: 0xcfdadc, roughness: 0.6 }),
    navy: new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.5 }),
  } : {
    rail: new THREE.MeshStandardMaterial({ color: 0xd9dee6, roughness: 0.35, metalness: 0.35 }),
    belt: new THREE.MeshStandardMaterial({ color: 0xeef1f5, roughness: 0.7 }),
    leg: new THREE.MeshStandardMaterial({ color: 0xc5ccd6, roughness: 0.4, metalness: 0.4 }),
    puck: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }),
    tote: new THREE.MeshStandardMaterial({ color: 0x3f73d3, roughness: 0.5 }),
    crate: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
    navy: new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.5 }),
  };
  const shadowTex = radial("rgba(0,0,0,1)", "rgba(0,0,0,0)");
  const shadow = (w, d, o = 0.2, x = 0, z = 0) => { const s = mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: dark ? o * 1.6 : o, depthWrite: false })); s.rotation.x = -Math.PI / 2; s.position.set(x, 0.004, z); s.renderOrder = 2; return s; };
  const glowTex = { late: radial(C.late, "rgba(0,0,0,0)"), hold: radial(C.hold, "rgba(0,0,0,0)") };
  const ringGeo = new THREE.TorusGeometry(1, 0.035, 8, 96);

  // ---- machines: one standing photo card each ----
  const phTex = placeholderTex();
  const units = new Map(), parts = [];
  const ids = machines.map((m) => String(m.id));
  const zoneOf = new Map(machines.map((m) => [String(m.id), m.z]));
  const setRing = (g, state) => {
    const want = state === "late" || state === "hold" ? state : null;
    if (g.userData.ringState === want) return;
    if (g.userData.ring) { g.remove(g.userData.ring, g.userData.glow); g.userData.ring.material.dispose(); g.userData.glow.geometry.dispose(); g.userData.glow.material.dispose(); g.userData.ring = g.userData.glow = null; }
    g.userData.ringState = want;
    if (!want) return;
    const w = g.userData.w;
    const ring = mesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(C[want]), toneMapped: false, transparent: true }), 0, 0.03, 0);
    ring.rotation.x = Math.PI / 2; ring.scale.set(w * 0.62 + 0.1, 0.5, 1);
    const glow = mesh(new THREE.PlaneGeometry(w * 1.6, 1.4), new THREE.MeshBasicMaterial({ map: glowTex[want], transparent: true, opacity: 0.32, depthWrite: false, toneMapped: false }), 0, 0.006, 0);
    glow.rotation.x = -Math.PI / 2; glow.renderOrder = 2;
    g.add(glow, ring); g.userData.ring = ring; g.userData.glow = glow;
  };
  for (const m of machines) {
    const { w, h } = cardSize(m.photo ? m.photo.aspect : 360 / 260);
    const g = new THREE.Group(); g.userData = { sn: String(m.id), w, h, ringState: null };
    let map = phTex;
    if (m.photo && m.photo.image) { map = new THREE.Texture(m.photo.image); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8; map.needsUpdate = true; }
    const card = mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map, transparent: true, alphaTest: 0.04, toneMapped: false }), 0, 0.07 + h / 2, 0);
    card.rotation.y = -0.16; // turned a touch toward the light, so it reads as standing on the belt
    g.add(card);
    g.add(mesh(RB(w * 0.92, 0.07, 0.62, 0.035), M.puck, 0, 0.035, 0)); // soft plinth
    g.add(shadow(w * 1.15, 1.0, 0.24));
    setRing(g, m.state);
    units.set(String(m.id), g); parts.push(g);
  }

  // ---- zone widths from what is actually there ----
  const inZone = (z) => ids.filter((id) => zoneOf.get(id) === z);
  const need = (list) => (list.length ? list.reduce((s, id) => s + units.get(id).userData.w, 0) + GAP * (list.length - 1) + PAD : MINZ);
  const ZW = zones.map((_, i) => (i === 0 || i === N - 1 ? END_W : Math.max(MINZ, need(inZone(i)))));
  const TOT = ZW.reduce((a, b) => a + b, 0), ZC = []; let acc = -TOT / 2; ZW.forEach((w) => { ZC.push(acc + w / 2); acc += w; });

  // ---- light conveyor: pale belt, slim satin rails, light legs ----
  const BELT_Y = 0.3, BD = 1.3, TL = TOT - 0.2;
  const floor = mesh(new THREE.PlaneGeometry(TOT + 40, 30), new THREE.MeshBasicMaterial({ color: STAGE_BG })); floor.rotation.x = -Math.PI / 2; sc.add(floor);
  sc.add(shadow(TL + 1.2, BD + 1.4, 0.16));
  sc.add(mesh(RB(TL, 0.12, BD, 0.05), M.belt, 0, BELT_Y - 0.06, 0));
  for (const s of [-1, 1]) sc.add(mesh(RB(TL + 0.08, 0.06, 0.06, 0.025), M.rail, 0, BELT_Y + 0.01, s * (BD / 2 + 0.02)));
  const legGeo = RB(0.06, BELT_Y - 0.12, 0.06, 0.02);
  for (let x = -TL / 2 + 0.4; x <= TL / 2 - 0.3; x += 2.4) for (const s of [-1, 1]) sc.add(mesh(legGeo, M.leg, x, (BELT_Y - 0.12) / 2, s * BD * 0.4));
  const seamM = new THREE.MeshBasicMaterial({ color: dark ? 0x335057 : 0xd6dce5 });
  const seamGeo = new THREE.BoxGeometry(0.018, 0.004, BD * 0.92);
  for (let i = 1; i < N; i++) sc.add(mesh(seamGeo, seamM, ZC[i] - ZW[i] / 2, BELT_Y + 0.002, 0));
  // moving belt texture (fine slats) — subtle, shows the line is running
  const slats = tex(256, 8, (g, w, h) => { g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.fillStyle = "rgba(148,163,184,.22)"; for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 1.5, h); });
  slats.wrapS = THREE.RepeatWrapping; slats.repeat.set(TL / 1.6, 1);
  const beltTop = mesh(new THREE.PlaneGeometry(TL - 0.1, BD - 0.06), new THREE.MeshBasicMaterial({ map: slats, color: dark ? 0x1f3a3e : 0xf7f9fb, toneMapped: false })); beltTop.rotation.x = -Math.PI / 2; beltTop.position.y = BELT_Y + 0.001; sc.add(beltTop);

  const holder = new THREE.Group(); holder.position.y = BELT_Y; sc.add(holder);
  for (const g of units.values()) holder.add(g);
  const layoutZone = (z, animate) => {
    const list = inZone(z).map((id) => units.get(id)); if (!list.length) return;
    const tot = list.reduce((s, g) => s + g.userData.w, 0) + GAP * (list.length - 1); let x = ZC[z] - tot / 2;
    for (const g of list) { g.userData.tx = x + g.userData.w / 2; x += g.userData.w + GAP; if (!animate) g.position.x = g.userData.tx; }
  };
  for (let z = 0; z < N; z++) layoutZone(z, false);
  // Rack: parts totes; Ready: packed crates (these are not machines)
  const totes = new THREE.Group(); totes.position.x = ZC[0]; holder.add(totes);
  const toteGeo = RB(0.5, 0.22, 0.42, 0.04);
  [[-0.55, 0], [-0.55, 1], [0, 0], [0.55, 0], [0.55, 1]].forEach(([x, row]) => totes.add(mesh(toteGeo, M.tote, x, 0.11 + row * 0.23, 0)));
  totes.add(shadow(2.0, 0.9, 0.22));
  const ready = new THREE.Group(); ready.position.x = ZC[N - 1]; holder.add(ready);
  const crateGeo = RB(0.8, 0.5, 0.56, 0.05), strapGeo = new THREE.BoxGeometry(0.05, 0.505, 0.565);
  for (const dx of [-0.5, 0.5]) { ready.add(mesh(crateGeo, M.crate, dx, 0.25, 0)); ready.add(mesh(strapGeo, M.navy, dx, 0.25, 0)); }
  ready.add(shadow(2.1, 0.9, 0.22));

  // ---- transfer trail (real dept changes only) ----
  const trailTex = tex(256, 8, (g, w, h) => { const lg = g.createLinearGradient(0, 0, w, 0); lg.addColorStop(0, "rgba(37,99,235,0)"); lg.addColorStop(1, "rgba(37,99,235,.9)"); g.fillStyle = lg; g.fillRect(0, 0, w, h); });
  const trail = mesh(new THREE.PlaneGeometry(1, 0.05), new THREE.MeshBasicMaterial({ map: trailTex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
  trail.rotation.x = -Math.PI / 2; trail.position.set(0, BELT_Y + 0.01, 0.42); sc.add(trail);

  // ---- camera: whole line edge to edge ----
  const look = new THREE.Vector3(0, 0.75, 0); let zoom = 0, zoomTarget = 0, zoomX = 0;
  const placeCam = () => {
    const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.aspect, d = ((TOT / 2 + 0.1) / tanH) * (1 - 0.06 * zoom);
    cam.position.set(zoomX * 0.06 * zoom, look.y + d * 0.2, d); cam.lookAt(look.x + zoomX * 0.06 * zoom, look.y, 0);
  };
  let W = 1, H = 1;
  const resize = () => {
    W = Math.max(1, host.clientWidth); H = Math.max(1, host.clientHeight);
    r.setSize(W, H); cam.aspect = W / H;
    cam.fov = THREE.MathUtils.clamp(2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(24)) / cam.aspect)), 6, 16);
    // shift the view up so the top of the stage is free for the info tags
    cam.setViewOffset(W, H, 0, -Math.round(H * (W < 760 ? 0.28 : 0.2)), W, H);
    cam.updateProjectionMatrix(); placeCam(); kick();
  };

  const v = new THREE.Vector3();
  const project = (x, y, z = 0) => { v.set(x, y, z).project(cam); return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H }; };
  const zoneScreen = () => zones.map((_, i) => ({ x: project(ZC[i], 0).x, w: project(ZC[i] + ZW[i] / 2, 0).x - project(ZC[i] - ZW[i] / 2, 0).x }));
  const machineScreen = () => ids.map((id) => { const g = units.get(id), top = project(g.position.x, BELT_Y + g.position.y + 0.07 + g.userData.h, 0); return { sn: id, x: top.x, y: top.y }; });

  // ---- picking (cards + plinths) ----
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let hovered = null;
  const hitAt = (e) => {
    const b = r.domElement.getBoundingClientRect(); ndc.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
    ray.setFromCamera(ndc, cam); const hit = ray.intersectObjects(parts, true)[0];
    let o = hit && hit.object; while (o && !o.userData.sn) o = o.parent; return o || null;
  };
  const setHover = (o) => {
    if (o === hovered) return; hovered = o; r.domElement.style.cursor = o ? "pointer" : "";
    if (onHover) onHover(o ? o.userData.sn : null); kick();
  };
  const onMove = (e) => setHover(hitAt(e)), onLeave = () => setHover(null);
  const onClick = (e) => { const o = hitAt(e); if (o) pick(o.userData.sn); };
  r.domElement.addEventListener("pointermove", onMove);
  r.domElement.addEventListener("pointerleave", onLeave);
  r.domElement.addEventListener("click", onClick);
  let pickTimer = 0;
  const pick = (sn) => {
    const o = units.get(String(sn)); if (!o) return;
    zoomX = o.position.x; zoomTarget = 1; kick();
    clearTimeout(pickTimer);
    pickTimer = setTimeout(() => { zoomTarget = 0; if (run) kick(); if (onPick) onPick(String(sn)); }, reduce ? 0 : 240);
  };

  // ---- glides: a machine whose department changed moves along the belt ----
  const glides = new Map(); // id -> { from, t0 }
  const DUR = 1.7;
  function update(next) {
    if (!run) return false;
    const nextIds = next.map((m) => String(m.id));
    if (nextIds.length !== ids.length || nextIds.some((id) => !units.has(id))) return false;
    const moved = [];
    for (const m of next) {
      const id = String(m.id), g = units.get(id);
      setRing(g, m.state);
      if (zoneOf.get(id) !== m.z) moved.push([id, zoneOf.get(id), m.z]);
    }
    if (!moved.length) { kick(); return true; }
    const trial = new Map(zoneOf); for (const [id, , to] of moved) trial.set(id, to);
    for (let z = 1; z < N - 1; z++) {
      const list = ids.filter((id) => trial.get(id) === z);
      if (need(list) > ZW[z] + 1e-6) return false; // no room → caller remounts with new widths
    }
    const touched = new Set();
    const now = performance.now();
    for (const [id, from, to] of moved) { zoneOf.set(id, to); touched.add(from); touched.add(to); glides.set(id, { from: units.get(id).position.x, t0: now }); }
    for (const z of touched) layoutZone(z, true);
    kick();
    return true;
  }

  let run = true, visible = true, raf = 0, lastFrame = 0;
  const t0 = performance.now();
  function frame(now) {
    raf = 0; if (!run || !visible || document.hidden) return;
    const t = (now - t0) / 1000, dt = Math.min(0.05, (now - (lastFrame || now)) / 1000); lastFrame = now;
    let moving = false;
    if (!reduce) slats.offset.x = -t * 0.12;
    for (const g of units.values()) if (g.userData.ring) { const p = reduce ? 0.5 : 0.5 + 0.5 * Math.sin(t * 2.6); g.userData.ring.material.opacity = 0.7 + 0.3 * p; g.userData.glow.material.opacity = 0.18 + 0.2 * p; }
    let trailShown = false;
    for (const [id, gl] of glides) {
      const g = units.get(id), k = reduce ? 1 : clamp01((now - gl.t0) / 1000 / DUR), e = ease(k);
      g.position.x = gl.from + (g.userData.tx - gl.from) * e; g.position.y = Math.sin(Math.PI * e) * 0.08;
      if (!trailShown && !reduce) {
        const speed = Math.abs(Math.sin(Math.PI * k)), len = 0.2 + speed * 2.4, dir = Math.sign(g.userData.tx - gl.from) || 1;
        trail.scale.x = len; trail.rotation.z = dir < 0 ? Math.PI : 0;
        trail.position.x = g.position.x - dir * (g.userData.w / 2 + len / 2 - 0.1); trail.material.opacity = speed * 0.8; trailShown = true;
      }
      if (k >= 1) { glides.delete(id); g.position.x = g.userData.tx; g.position.y = 0; } else moving = true;
    }
    if (!trailShown) trail.material.opacity = 0;
    for (const g of units.values()) {
      if (glides.has(g.userData.sn)) continue;
      if (g.userData.tx !== undefined && Math.abs(g.position.x - g.userData.tx) > 0.001) { g.position.x += (g.userData.tx - g.position.x) * (reduce ? 1 : Math.min(1, dt * 6)); moving = true; }
      const tgt = g === hovered ? 0.1 : 0;
      if (Math.abs(g.position.y - tgt) > 0.001) { g.position.y += (tgt - g.position.y) * (reduce ? 1 : Math.min(1, dt * 12)); moving = true; }
    }
    if (Math.abs(zoom - zoomTarget) > 0.002) { zoom += (zoomTarget - zoom) * (reduce ? 1 : Math.min(1, dt * 7)); placeCam(); moving = true; }
    r.render(sc, cam);
    if (api.onFrame) api.onFrame();
    // Reduced motion: draw once and idle until something changes.
    if (!reduce || moving) raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf && run && visible) raf = requestAnimationFrame(frame); }
  const ro = new ResizeObserver(resize); ro.observe(host);
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; kick(); }); io.observe(host);
  const onVis = () => kick(); document.addEventListener("visibilitychange", onVis);
  resize();

  const api = {
    update, zoneScreen, machineScreen, kick, pick, onFrame: null,
    setHover: (sn) => setHover(sn ? units.get(String(sn)) || null : null),
    info: () => ({ calls: r.info.render.calls, triangles: r.info.render.triangles, geometries: r.info.memory.geometries, textures: r.info.memory.textures }),
    stop() {
      if (!run) return;
      run = false; cancelAnimationFrame(raf); raf = 0; clearTimeout(pickTimer);
      ro.disconnect(); io.disconnect(); document.removeEventListener("visibilitychange", onVis);
      r.domElement.removeEventListener("pointermove", onMove);
      r.domElement.removeEventListener("pointerleave", onLeave);
      r.domElement.removeEventListener("click", onClick);
      const mats = new Set(), geos = new Set();
      sc.traverse((o) => { if (o.geometry) geos.add(o.geometry); const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach((x) => mats.add(x)); });
      for (const g of geos) g.dispose();
      for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
      for (const t of [phTex, shadowTex, slats, trailTex, glowTex.late, glowTex.hold]) t.dispose();
      ringGeo.dispose(); sc.clear();
      r.dispose(); r.forceContextLoss();
      if (r.domElement.parentNode) r.domElement.parentNode.removeChild(r.domElement);
    },
  };
  return api;
}
