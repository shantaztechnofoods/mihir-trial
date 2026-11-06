// src/modules/dashboard/line3d.js — Dashboard "Production line today" 3D view.
// 2026-11-06 (review v2): a studio-lit 3/4 view of the factory floor. Each
// department is a floor pad with its name + head painted on it like a real floor
// marking and a thin status edge; machines stand on their pad in up to two rows,
// each as its own BOM photo cut-out (no photo → a clean neutral 3D silhouette of
// the machine family with a tiny "add photo" hint). Rack = a real rack with
// labelled crates; Ready = the ready machines' own photos behind a green
// "✓ Ready" plate. Display only: data from productionLine.js, a click calls back
// into the panel (in-place summary + "Open in Machine Tracker").
// Loaded ONLY via dynamic import() when "3D view" is tapped. Renders on demand:
// a short intro, glides and hover — then the loop stops (no idle CPU).
// stop() disposes every geometry, material, texture and the WebGL context.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

const C = { late: "#dc2626", hold: "#7c3aed", near: "#d97706", ok: "#16a34a", idle: "#94a3b8" };
const BOX_W = 1.5, BOX_H = 1.2, PITCH_X = BOX_W * 0.74, GAPZ = 0.5, PAD_X = 0.25, PAD_D = 2.6, MINZ = 2.0, END_W = 2.3;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const INTRO = 1.6; // s of belt motion + ring pulse after mount, then idle

export function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (!gl) return false;
    const lose = gl.getExtension("WEBGL_lose_context"); if (lose) lose.loseContext();
    return true;
  } catch { return false; }
}

// Billboard size from the photo's aspect, fitted in one box.
export function cardSize(aspect) {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : BOX_W / BOX_H;
  const w = Math.min(BOX_W, BOX_H * a);
  return { w, h: w / a };
}

// Machines of one zone in up to two rows (back row first), centred on the pad.
// Pure: returns [{ id, col, row }] and the zone's needed width.
// Rows are staggered by half a column (back row behind the gaps of the front
// row), so neighbours may overlap a little in depth, like a real crowded floor.
export function zoneGrid(ids, w = BOX_W) {
  const n = ids.length;
  const rows = n >= 2 ? 2 : 1, cols = Math.max(1, Math.ceil(n / rows));
  const cells = ids.map((id, i) => ({ id, col: i % cols, row: rows === 2 ? (i < cols ? 0 : 1) : 1 }));
  const span = (cols - 1) * PITCH_X + w + (rows === 2 ? PITCH_X / 2 : 0);
  return { cells, cols, rows, span, width: n ? span + PAD_X * 2 : MINZ };
}

/**
 * mountLine(host, { zones, machines, ready, rackCount, dark, reduce, onPick, onHover })
 *   zones:    [{ k, label, head, tone, count }] six stages (first = Rack, last = Ready)
 *   machines: [{ id, z, state, family, photo: { image, aspect } | null }]
 *   ready:    [{ id, photo }] ready-today machines (shown on the Ready pad)
 */
export function mountLine(host, { zones, machines, ready = [], rackCount = 0, dark = false, reduce = false, onPick, onHover } = {}) {
  const N = zones.length;
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  r.setClearColor(0x000000, 0);
  r.toneMapping = THREE.NeutralToneMapping; r.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(r.domElement);
  const maxAniso = r.capabilities.getMaxAnisotropy ? r.capabilities.getMaxAnisotropy() : 4;
  const sc = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(r);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; pmrem.dispose();
  sc.environment = envTex;
  const cam = new THREE.PerspectiveCamera(14, 6, 1, 200);
  sc.add(new THREE.HemisphereLight(0xffffff, dark ? 0x10262a : 0xdfe5ee, dark ? 0.7 : 0.9));
  const key = new THREE.DirectionalLight(0xffffff, dark ? 1.1 : 1.4); key.position.set(-6, 12, 9); sc.add(key, key.target);

  const textures = [envTex];
  const tex = (w, h, draw, srgb = true) => {
    const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso; textures.push(t); return t;
  };
  const radial = (inner, outer) => tex(128, 128, (g, w, h) => { const rg = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); rg.addColorStop(0, inner); rg.addColorStop(1, outer); g.fillStyle = rg; g.fillRect(0, 0, w, h); });
  const RB = (w, h, d, rad = 0.05, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, Math.min(rad, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
  const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };
  const ink = dark ? "rgba(226,240,240,.82)" : "rgba(15,42,92,.78)", ink2 = dark ? "rgba(190,214,214,.62)" : "rgba(71,85,105,.7)";
  const font = "Inter, system-ui, sans-serif";
  const M = {
    pad: new THREE.MeshStandardMaterial({ color: dark ? 0x15292c : 0xffffff, roughness: 0.55, metalness: 0.0, envMapIntensity: 0.6 }),
    metal: new THREE.MeshStandardMaterial({ color: dark ? 0x5b7479 : 0xc9d1db, roughness: 0.3, metalness: 0.75 }),
    body: new THREE.MeshStandardMaterial({ color: dark ? 0x3d5559 : 0xe3e8ef, roughness: 0.35, metalness: 0.45 }),
    dim: new THREE.MeshStandardMaterial({ color: dark ? 0x2a4044 : 0xc5cdd8, roughness: 0.4, metalness: 0.5 }),
    crate: new THREE.MeshStandardMaterial({ color: dark ? 0x2f5d8c : 0x3b6fd1, roughness: 0.5, envMapIntensity: 0.5 }),
    belt: new THREE.MeshStandardMaterial({ color: dark ? 0x1c3337 : 0xeef2f6, roughness: 0.6 }),
  };
  const shadowTex = radial("rgba(0,0,0,1)", "rgba(0,0,0,0)");
  const shadow = (w, d, o = 0.22, x = 0, z = 0) => { const s = mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: dark ? o * 1.7 : o, depthWrite: false })); s.rotation.x = -Math.PI / 2; s.position.set(x, 0.012, z); s.renderOrder = 2; return s; };
  const flat = (w, d, map, x = 0, y = 0.011, z = 0, opacity = 1) => { const s = mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map, transparent: true, opacity, depthWrite: false, toneMapped: false })); s.rotation.x = -Math.PI / 2; s.position.set(x, y, z); s.renderOrder = 1; return s; };
  const glowTex = { late: radial(C.late, "rgba(0,0,0,0)"), hold: radial(C.hold, "rgba(0,0,0,0)") };
  const ringGeo = new THREE.TorusGeometry(1, 0.03, 8, 96);

  // ---- machine units ----
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
    const ring = mesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(C[want]), toneMapped: false, transparent: true, opacity: 0.9 }), 0, 0.03, 0);
    ring.rotation.x = Math.PI / 2; ring.scale.set(w * 0.58 + 0.08, 0.42, 1);
    const glow = mesh(new THREE.PlaneGeometry(w * 1.5, 1.1), new THREE.MeshBasicMaterial({ map: glowTex[want], transparent: true, opacity: 0.26, depthWrite: false, toneMapped: false }), 0, 0.013, 0);
    glow.rotation.x = -Math.PI / 2; glow.renderOrder = 2;
    g.add(glow, ring); g.userData.ring = ring; g.userData.glow = glow;
  };
  const hintTex = tex(300, 56, (g, w, h) => {
    g.fillStyle = dark ? "rgba(20,40,44,.9)" : "rgba(255,255,255,.95)"; g.beginPath(); if (g.roundRect) g.roundRect(2, 2, w - 4, h - 4, 26); else g.rect(2, 2, w - 4, h - 4); g.fill();
    g.strokeStyle = dark ? "rgba(140,170,175,.5)" : "rgba(148,163,184,.6)"; g.lineWidth = 2; g.stroke();
    g.fillStyle = dark ? "#b7cdd0" : "#64748b"; g.font = `600 24px ${font}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("No photo · add in BOM", w / 2, h / 2 + 1);
  });
  // Neutral silhouette of the machine family (never an invented look-alike photo).
  const silhouette = (family, w) => {
    const s = new THREE.Group(), bw = w * 0.78;
    s.add(mesh(RB(bw, 0.5, 0.62, 0.06), M.body, 0, 0.3, 0));
    s.add(mesh(RB(bw * 0.96, 0.08, 0.6, 0.03), M.dim, 0, 0.04, 0));
    if (family === "R") { const drum = mesh(new THREE.CylinderGeometry(0.17, 0.17, bw * 0.7, 28), M.metal, 0, 0.66, 0); drum.rotation.z = Math.PI / 2; s.add(drum); }
    else { s.add(mesh(RB(bw * 0.42, 0.34, 0.42, 0.05), M.body, -bw * 0.12, 0.72, 0)); s.add(mesh(new THREE.CylinderGeometry(0.15, 0.09, 0.2, 24), M.metal, -bw * 0.12, 0.98, 0)); }
    s.add(mesh(RB(0.24, 0.3, 0.05, 0.02), M.dim, bw * 0.3, 0.42, 0.32));
    const hint = mesh(new THREE.PlaneGeometry(1.0, 0.187), new THREE.MeshBasicMaterial({ map: hintTex, transparent: true, depthWrite: false, toneMapped: false }), 0, 0.12, 0.5);
    hint.rotation.x = -0.5; hint.renderOrder = 3; s.add(hint);
    return { obj: s, h: 1.08 };
  };
  const photoCard = (photo, w, h) => {
    const map = new THREE.Texture(photo.image); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = maxAniso;
    map.generateMipmaps = true; map.minFilter = THREE.LinearMipmapLinearFilter; map.needsUpdate = true; textures.push(map);
    const card = mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map, transparent: true, alphaTest: 0.04, toneMapped: false }), 0, 0.05 + h / 2, 0);
    card.rotation.x = -0.12; // leans a touch toward the camera so the photo stays undistorted from above
    return card;
  };
  for (const m of machines) {
    const has = !!(m.photo && m.photo.image);
    const { w, h } = has ? cardSize(m.photo.aspect) : { w: BOX_W * 0.82, h: 1.0 };
    const g = new THREE.Group(); g.userData = { sn: String(m.id), w, h, ringState: null, fade: 1, fadeT: 1, mats: [] };
    if (has) { const card = photoCard(m.photo, w, h); g.add(card); g.userData.mats.push(card.material); }
    else { const s = silhouette(m.family, w); g.add(s.obj); g.userData.h = s.h; }
    g.add(shadow(w * 1.05, 0.75, 0.26, 0, 0.02));
    setRing(g, m.state);
    units.set(String(m.id), g); parts.push(g);
  }

  // ---- zones: widths from what is actually there ----
  const inZone = (z, map = zoneOf) => ids.filter((id) => map.get(id) === z);
  const widthOf = (z, map = zoneOf) => (z === 0 || z === N - 1 ? END_W : Math.max(MINZ, zoneGrid(inZone(z, map)).width));
  const ZW = zones.map((_, i) => widthOf(i));
  const GUT = 0.14, TOT = ZW.reduce((a, b) => a + b, 0) + GUT * (N - 1), ZC = [];
  { let acc = -TOT / 2; ZW.forEach((w) => { ZC.push(acc + w / 2); acc += w + GUT; }); }

  // ---- floor pads: name + head painted on, thin status edge ----
  const padGeo = (w) => RB(w, 0.06, PAD_D, 0.06);
  const padY = 0.03;
  zones.forEach((zn, i) => {
    sc.add(mesh(padGeo(ZW[i]), M.pad, ZC[i], 0, 0));
    sc.add(shadow(ZW[i] + 0.6, PAD_D + 0.7, 0.12, ZC[i], 0));
    // Floor marking: the department name (and head) painted along the front edge.
    const lw = ZW[i] - 0.24, lh = 0.3, cw = 1024, ch = Math.round(cw * lh / lw);
    const label = tex(cw, ch, (g, w, h) => {
      g.textBaseline = "middle"; const name = String(zn.label || zn.k).toUpperCase();
      let fs = Math.min(h * 0.62, 120); g.font = `800 ${fs}px ${font}`;
      const head = zn.head ? `  ${zn.head}` : "";
      const sp = fs * 0.12, nameW = [...name].reduce((a, c) => a + g.measureText(c).width + sp, 0);
      g.font = `500 ${fs * 0.78}px ${font}`; const headW = head ? g.measureText(head).width : 0;
      const k = Math.min(1, (w - 16) / (nameW + headW)); fs *= k;
      let x = 8; g.fillStyle = ink; g.font = `800 ${fs}px ${font}`;
      for (const c of name) { g.fillText(c, x, h / 2); x += g.measureText(c).width + sp * k; }
      if (head && k > 0.55) { g.fillStyle = ink2; g.font = `500 ${fs * 0.78}px ${font}`; g.fillText(head, x, h / 2 + fs * 0.04); }
    });
    sc.add(flat(lw, lh, label, ZC[i], padY + 0.002, PAD_D / 2 - lh / 2 - 0.1));
    const edge = mesh(new THREE.PlaneGeometry(ZW[i] - 0.16, 0.035), new THREE.MeshBasicMaterial({ color: new THREE.Color(C[zn.tone] || C.idle), toneMapped: false, transparent: true, opacity: zn.tone === "idle" ? 0.35 : 0.85 }));
    edge.rotation.x = -Math.PI / 2; edge.position.set(ZC[i], padY + 0.003, PAD_D / 2 - 0.03); sc.add(edge);
  });

  // ---- slim flow lane between the rows (moves only during intro / glides) ----
  const laneZ = -0.05;
  const slats = tex(256, 16, (g, w, h) => { g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.fillStyle = "rgba(100,116,139,.28)"; for (let x = 0; x < w; x += 32) { g.beginPath(); g.moveTo(x, 2); g.lineTo(x + 8, h / 2); g.lineTo(x, h - 2); g.lineTo(x + 3, h - 2); g.lineTo(x + 11, h / 2); g.lineTo(x + 3, 2); g.fill(); } });
  slats.wrapS = THREE.RepeatWrapping; slats.repeat.set(TOT / 0.9, 1);
  const lane = mesh(new THREE.PlaneGeometry(TOT - 0.4, 0.16), new THREE.MeshBasicMaterial({ map: slats, color: dark ? 0x35565b : 0xe8edf3, toneMapped: false, transparent: true, opacity: 0.9, depthWrite: false }));
  lane.rotation.x = -Math.PI / 2; lane.position.set(0, padY + 0.004, laneZ); lane.renderOrder = 1; sc.add(lane);

  // ---- machine placement ----
  const holder = new THREE.Group(); holder.position.y = padY; sc.add(holder);
  for (const g of units.values()) holder.add(g);
  const rowZ = (row, rows) => (rows === 2 ? (row === 0 ? -GAPZ - 0.15 : GAPZ - 0.15) : 0.1);
  const layoutZone = (z, animate) => {
    const list = inZone(z); if (!list.length) return;
    const grid = zoneGrid(list);
    for (const c of grid.cells) {
      const g = units.get(c.id);
      g.userData.tx = ZC[z] - grid.span / 2 + BOX_W / 2 + c.col * PITCH_X + (c.row === 1 && grid.rows === 2 ? PITCH_X / 2 : 0);
      g.userData.tz = rowZ(c.row, grid.rows);
      if (!animate) { g.position.x = g.userData.tx; g.position.z = g.userData.tz; }
    }
  };
  for (let z = 1; z < N - 1; z++) layoutZone(z, false);

  // ---- Rack: a real rack, labelled crates, the count painted on the pad ----
  const rack = new THREE.Group(); rack.position.set(ZC[0], padY, -0.25); sc.add(rack);
  const RW = 1.9, RH = 1.15, RD = 0.7;
  const up = RB(0.05, RH, 0.05, 0.015);
  for (const x of [-RW / 2, RW / 2]) for (const z of [-RD / 2, RD / 2]) rack.add(mesh(up, M.metal, x, RH / 2, z));
  const shelf = RB(RW + 0.06, 0.035, RD + 0.04, 0.012);
  for (const y of [0.08, 0.55, 1.02]) rack.add(mesh(shelf, M.metal, 0, y, 0));
  const crateLabel = tex(128, 64, (g, w, h) => { g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.fillStyle = "#1e3a8a"; g.font = `700 26px ${font}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("PARTS", w / 2, h / 2); });
  const crateGeo = RB(0.5, 0.3, 0.5, 0.04), labGeo = new THREE.PlaneGeometry(0.26, 0.13);
  const labMat = new THREE.MeshBasicMaterial({ map: crateLabel, toneMapped: false });
  const nCrates = Math.max(0, Math.min(6, rackCount));
  for (let i = 0; i < nCrates; i++) {
    const row = i < 3 ? 0 : 1, col = i % 3;
    const y = (row === 0 ? 0.1 : 0.57) + 0.15, x = (col - 1) * 0.6;
    rack.add(mesh(crateGeo, M.crate, x, y, 0.02)); rack.add(mesh(labGeo, labMat, x, y, 0.272));
  }
  rack.add(shadow(2.4, 1.1, 0.24));

  // ---- Ready: the ready machines' own photos + a green "✓ Ready" plate ----
  const readyG = new THREE.Group(); readyG.position.set(ZC[N - 1], padY, -0.2); sc.add(readyG);
  const shown = ready.slice(0, 3);
  shown.forEach((rm, i) => {
    const x = (i - (shown.length - 1) / 2) * 0.7, s = shown.length > 1 ? 0.62 : 0.9;
    if (rm.photo && rm.photo.image) { const { w, h } = cardSize(rm.photo.aspect); const c = photoCard(rm.photo, w * s, h * s); c.position.set(x, 0.05 + (h * s) / 2, -i * 0.04); readyG.add(c); }
    else { const sl = silhouette(rm.family, BOX_W * 0.8); sl.obj.scale.setScalar(s); sl.obj.position.x = x; readyG.add(sl.obj); }
    readyG.add(shadow(0.9, 0.5, 0.22, x, 0));
  });
  const plateTex = tex(320, 96, (g, w, h) => {
    g.fillStyle = "#15803d"; g.beginPath(); if (g.roundRect) g.roundRect(0, 0, w, h, 22); else g.rect(0, 0, w, h); g.fill();
    g.fillStyle = "#fff"; g.font = `700 44px ${font}`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(shown.length ? "✓ Ready" : "None today", w / 2, h / 2 + 2);
  });
  const plate = mesh(new THREE.PlaneGeometry(0.95, 0.285), new THREE.MeshBasicMaterial({ map: plateTex, toneMapped: false, transparent: true, opacity: shown.length ? 1 : 0.5 }), 0, 0.17, 0.85);
  plate.rotation.x = -0.35; readyG.add(plate);

  // ---- camera: 3/4 view from above, whole floor edge to edge ----
  const PITCH = THREE.MathUtils.degToRad(34);
  const look = new THREE.Vector3(0, 0.42, 0.1);
  let zoom = 0, zoomTarget = 0, zoomX = 0, W = 1, H = 1;
  const placeCam = () => {
    const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.aspect;
    const d = ((TOT / 2 + 0.15) / tanH + PAD_D / 2) * (1 - 0.08 * zoom);
    const fx = zoomX * 0.08 * zoom;
    cam.position.set(fx, look.y + d * Math.sin(PITCH), look.z + d * Math.cos(PITCH));
    cam.lookAt(look.x + fx, look.y, look.z);
  };
  const resize = () => {
    W = Math.max(1, host.clientWidth); H = Math.max(1, host.clientHeight);
    r.setSize(W, H); cam.aspect = W / H;
    cam.fov = THREE.MathUtils.clamp(2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(30)) / cam.aspect)), 7, 20);
    // keep the top band free for the info tags
    cam.setViewOffset(W, H, 0, -Math.round(H * 0.16), W, H);
    cam.updateProjectionMatrix(); placeCam(); kick();
  };

  const v = new THREE.Vector3();
  const project = (x, y, z = 0) => { v.set(x, y, z).project(cam); return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H }; };
  const zoneScreen = () => zones.map((_, i) => { const z = PAD_D / 2; const a = project(ZC[i] - ZW[i] / 2, 0, z), b = project(ZC[i] + ZW[i] / 2, 0, z); return { x: (a.x + b.x) / 2, w: b.x - a.x, y: a.y }; });
  const machineScreen = () => ids.map((id) => { const g = units.get(id), top = project(g.position.x, padY + g.position.y + 0.06 + g.userData.h, g.position.z); return { sn: id, x: top.x, y: top.y }; });

  // ---- picking ----
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let hovered = null, picked = null;
  const hitAt = (e) => {
    const b = r.domElement.getBoundingClientRect(); ndc.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
    ray.setFromCamera(ndc, cam); const hit = ray.intersectObjects(parts, true)[0];
    let o = hit && hit.object; while (o && !o.userData.sn) o = o.parent; return o || null;
  };
  const focusOn = () => { const f = picked || hovered; for (const g of units.values()) g.userData.fadeT = !f || g === f ? 1 : 0.3; };
  const setHover = (o) => {
    if (o === hovered) return; hovered = o; r.domElement.style.cursor = o ? "pointer" : "";
    focusOn(); if (onHover) onHover(o ? o.userData.sn : null); kick();
  };
  const onMove = (e) => setHover(hitAt(e)), onLeave = () => setHover(null);
  const onClick = (e) => { const o = hitAt(e); if (o) pick(o.userData.sn); };
  r.domElement.addEventListener("pointermove", onMove);
  r.domElement.addEventListener("pointerleave", onLeave);
  r.domElement.addEventListener("click", onClick);
  const pick = (sn) => {
    const o = sn == null ? null : units.get(String(sn)) || null;
    picked = o; focusOn();
    if (o) { zoomX = o.position.x; zoomTarget = 1; } else zoomTarget = 0;
    kick(); if (o && onPick) onPick(String(sn));
  };

  // ---- glides: a machine whose department changed moves to its new pad ----
  const glides = new Map(); const DUR = 1.4;
  function update(next) {
    if (!run) return false;
    const nextIds = next.map((m) => String(m.id));
    if (nextIds.length !== ids.length || nextIds.some((id) => !units.has(id))) return false;
    const trial = new Map(zoneOf); let moved = false;
    for (const m of next) { const id = String(m.id); if (zoneOf.get(id) !== m.z) { trial.set(id, m.z); moved = true; } }
    if (moved) for (let z = 1; z < N - 1; z++) if (Math.abs(widthOf(z, trial) - ZW[z]) > 1e-6) return false; // pads change → remount
    for (const m of next) setRing(units.get(String(m.id)), m.state);
    if (!moved) { kick(); return true; }
    const now = performance.now(), touched = new Set();
    for (const m of next) { const id = String(m.id); if (zoneOf.get(id) !== m.z) { touched.add(zoneOf.get(id)); touched.add(m.z); zoneOf.set(id, m.z); const g = units.get(id); glides.set(id, { fx: g.position.x, fz: g.position.z, t0: now }); } }
    for (const z of touched) layoutZone(z, true);
    kick(); return true;
  }

  let run = true, visible = true, raf = 0, lastFrame = 0;
  const t0 = performance.now();
  function frame(now) {
    raf = 0; if (!run || !visible || document.hidden) return;
    const t = (now - t0) / 1000, dt = Math.min(0.05, (now - (lastFrame || now)) / 1000); lastFrame = now;
    const intro = !reduce && t < INTRO;
    let moving = intro;
    if (intro || glides.size) slats.offset.x -= dt * 0.35;
    for (const g of units.values()) if (g.userData.ring) {
      const p = intro ? 0.5 + 0.5 * Math.sin(t * 4) : 1;
      g.userData.ring.material.opacity = 0.65 + 0.3 * p; g.userData.glow.material.opacity = 0.16 + 0.12 * p;
    }
    for (const [id, gl] of glides) {
      const g = units.get(id), k = reduce ? 1 : clamp01((now - gl.t0) / 1000 / DUR), e = ease(k);
      g.position.x = gl.fx + (g.userData.tx - gl.fx) * e; g.position.z = gl.fz + (g.userData.tz - gl.fz) * e; g.position.y = Math.sin(Math.PI * e) * 0.12;
      if (k >= 1) { glides.delete(id); g.position.set(g.userData.tx, 0, g.userData.tz); } else moving = true;
    }
    const sp = reduce ? 1 : Math.min(1, dt * 10);
    for (const g of units.values()) {
      if (glides.has(g.userData.sn)) continue;
      if (Math.abs(g.position.x - g.userData.tx) > 0.001 || Math.abs(g.position.z - g.userData.tz) > 0.001) { g.position.x += (g.userData.tx - g.position.x) * sp; g.position.z += (g.userData.tz - g.position.z) * sp; moving = true; }
      const tgt = g === hovered || g === picked ? 0.08 : 0;
      if (Math.abs(g.position.y - tgt) > 0.001) { g.position.y += (tgt - g.position.y) * sp; moving = true; }
      if (Math.abs(g.userData.fade - g.userData.fadeT) > 0.005) { g.userData.fade += (g.userData.fadeT - g.userData.fade) * sp; for (const m of g.userData.mats) m.opacity = g.userData.fade; moving = true; }
    }
    if (Math.abs(zoom - zoomTarget) > 0.002) { zoom += (zoomTarget - zoom) * (reduce ? 1 : Math.min(1, dt * 7)); placeCam(); moving = true; }
    r.render(sc, cam);
    api.frames++;
    if (api.onFrame) api.onFrame();
    if (moving) raf = requestAnimationFrame(frame); // idle → no loop
  }
  function kick() { if (!raf && run && visible) raf = requestAnimationFrame(frame); }
  const ro = new ResizeObserver(resize); ro.observe(host);
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; kick(); }); io.observe(host);
  const onVis = () => kick(); document.addEventListener("visibilitychange", onVis);
  resize();

  const api = {
    update, zoneScreen, machineScreen, kick, pick, onFrame: null, frames: 0,
    setHover: (sn) => setHover(sn ? units.get(String(sn)) || null : null),
    info: () => ({ calls: r.info.render.calls, triangles: r.info.render.triangles, geometries: r.info.memory.geometries, textures: r.info.memory.textures, dpr: r.getPixelRatio() }),
    stop() {
      if (!run) return;
      run = false; cancelAnimationFrame(raf); raf = 0;
      ro.disconnect(); io.disconnect(); document.removeEventListener("visibilitychange", onVis);
      r.domElement.removeEventListener("pointermove", onMove);
      r.domElement.removeEventListener("pointerleave", onLeave);
      r.domElement.removeEventListener("click", onClick);
      const mats = new Set(), geos = new Set();
      sc.traverse((o) => { if (o.geometry) geos.add(o.geometry); const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach((x) => mats.add(x)); });
      for (const g of geos) g.dispose();
      for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
      for (const m of Object.values(M)) m.dispose();
      for (const t of textures) t.dispose();
      ringGeo.dispose(); sc.environment = null; sc.clear();
      r.dispose(); r.forceContextLoss();
      if (r.domElement.parentNode) r.domElement.parentNode.removeChild(r.domElement);
    },
  };
  return api;
}
