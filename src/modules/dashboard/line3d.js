// src/modules/dashboard/line3d.js — Dashboard "Production line today" 3D view.
// v6 (2026-11-06): a compact smart-factory "digital twin". Each department is a
// WORKCELL bay: an epoxy floor with painted safety lines and a soft pool of
// light, low glass partitions on aluminium rails, a slim navy header sign with
// the department name + head, and an ANDON stack light (red / amber / green /
// purple) on the bay post. Every machine is its own BOM photo cut-out (full
// resolution, anisotropic), slightly tilted to the camera, with a contact
// shadow, a floor reflection, its own small andon and a progress ring on the
// floor (time used vs target). A conveyor runs along the back of the line; it
// moves only while the pointer is on the scene or for ~3 s after a data change.
// Camera: a gentle 3/4 view; a click dollies in to the machine, Esc / outside
// click glides back. Display only: data from productionLine.js; a click calls
// back into the panel (in-place summary + "Open in Machine Tracker").
// Loaded ONLY via dynamic import() when "3D view" is tapped. Renders on demand
// (idle = 0 frames). stop() disposes every geometry, material, texture and the
// WebGL context.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

const C = { late: "#dc2626", hold: "#7c3aed", near: "#d97706", ok: "#16a34a", idle: "#94a3b8", incoming: "#94a3b8" };
const BOX_W = 1.9, BOX_H = 1.36, GAP_X = 0.12, PAD_X = 0.2, PAD_D = 3.0, MINZ = 2.2, END_W = 2.15;
const TWO_ROWS_AT = 6, ROW2_SCALE = 0.8; // 6+ machines in a bay → two neat rows, a little smaller
const LAMPS = ["late", "near", "ok", "hold"]; // andon stack, top → bottom: red, amber, green, purple
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const INTRO = 1.6;  // s of conveyor motion after mount, then idle
const AFTER_CHANGE = 3; // s of conveyor motion after a data change

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

// Machines of one bay: one row (biggest machines) up to 5, two neat rows from 6
// (front row first, back row staggered half a slot so every machine stays
// visible). `widths` (optional, per id) = each photo's own card width, so a
// narrow machine takes a narrow slot. Pure: returns cells [{ id, col, row, x }]
// (row 0 = front, x = centre from the bay centre), the card scale and the
// bay's needed width.
export function zoneGrid(ids, w = BOX_W, widths = null) {
  const n = ids.length;
  const rows = n >= TWO_ROWS_AT ? 2 : 1, cols = Math.max(1, Math.ceil(n / rows));
  const scale = rows === 2 ? ROW2_SCALE : 1;
  const wOf = (i) => (rows === 1 && widths && widths[i] > 0 ? Math.min(w, widths[i]) : w) * scale;
  const gap = GAP_X * scale, pitch = w * scale + gap;
  const cells = ids.map((id, i) => ({ id, col: i % cols, row: rows === 2 && i >= cols ? 1 : 0, x: 0 }));
  let span;
  if (rows === 1) {
    span = ids.reduce((a, _, i) => a + wOf(i), 0) + gap * Math.max(0, n - 1);
    let acc = -span / 2; cells.forEach((c, i) => { c.x = acc + wOf(i) / 2; acc += wOf(i) + gap; });
  } else {
    span = (cols - 1) * pitch + w * scale + pitch / 2;
    cells.forEach((c) => { c.x = -span / 2 + (w * scale) / 2 + c.col * pitch + (c.row === 1 ? pitch / 2 : 0); });
  }
  return { cells, cols, rows, pitch, scale, span, width: n ? span + PAD_X * 2 : MINZ };
}

/**
 * mountLine(host, { zones, machines, ready, rackCount, dark, reduce, onPick, onHover })
 *   zones:    [{ k, label, head, tone, count }] six stages (first = Rack, last = Ready)
 *   machines: [{ id, z, state, share, family, photo: { image, aspect } | null }]
 *   ready:    [{ id, photo }] ready-today machines (shown on the Ready bay)
 */
export function mountLine(host, { zones, machines, ready = [], rackCount = 0, dark = false, reduce = false, onPick, onHover } = {}) {
  const N = zones.length;
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  r.setClearColor(0x000000, 0);
  r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = dark ? 1.05 : 1.12;
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = true; // static floor: re-draw shadows only when a machine moves
  host.appendChild(r.domElement);
  const maxAniso = r.capabilities.getMaxAnisotropy ? r.capabilities.getMaxAnisotropy() : 4;
  const sc = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(r);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; pmrem.dispose();
  sc.environment = envTex;
  const cam = new THREE.PerspectiveCamera(8, 6, 1, 2000);
  const baseCam = new THREE.PerspectiveCamera(8, 6, 1, 2000); // never zooms: zone chips stay put
  sc.add(new THREE.HemisphereLight(0xffffff, dark ? 0x0d2224 : 0xdfe5ee, dark ? 0.55 : 0.75));
  const key = new THREE.DirectionalLight(0xffffff, dark ? 1.5 : 1.9);
  key.castShadow = true; sc.add(key, key.target);

  const textures = [envTex];
  const tex = (w, h, draw, srgb = true) => {
    const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso; textures.push(t); return t;
  };
  const radial = (inner, outer, mid) => tex(128, 128, (g, w, h) => { const rg = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); rg.addColorStop(0, inner); if (mid) rg.addColorStop(0.35, mid); rg.addColorStop(1, outer); g.fillStyle = rg; g.fillRect(0, 0, w, h); });
  const rr = (g, x, y, w, h, rad) => { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, rad); else g.rect(x, y, w, h); };
  const RB = (w, h, d, rad = 0.05, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, Math.min(rad, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
  const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };
  const font = "Inter, system-ui, sans-serif";
  const M = {
    pad: new THREE.MeshStandardMaterial({ color: dark ? 0x1a3436 : 0xf4f6f9, roughness: 0.5, metalness: 0.05, envMapIntensity: 0.7 }),
    metal: new THREE.MeshStandardMaterial({ color: dark ? 0x8aa3a8 : 0xd5dbe3, roughness: 0.22, metalness: 0.85, envMapIntensity: 1.1 }),
    dark: new THREE.MeshStandardMaterial({ color: dark ? 0x0b1b1d : 0x334155, roughness: 0.35, metalness: 0.6 }),
    body: new THREE.MeshStandardMaterial({ color: dark ? 0x3d5559 : 0xe3e8ef, roughness: 0.35, metalness: 0.45 }),
    dim: new THREE.MeshStandardMaterial({ color: dark ? 0x2a4044 : 0xc5cdd8, roughness: 0.4, metalness: 0.5 }),
    crate: new THREE.MeshStandardMaterial({ color: dark ? 0x2f6aa8 : 0x2f66d0, roughness: 0.45, envMapIntensity: 0.6 }),
    glass: new THREE.MeshPhysicalMaterial({ color: dark ? 0x9fd6d6 : 0xdbeafe, roughness: 0.06, metalness: 0, transparent: true, opacity: dark ? 0.13 : 0.22, envMapIntensity: 1.6, depthWrite: false, side: THREE.DoubleSide }),
    led: new THREE.MeshBasicMaterial({ color: dark ? 0xbff6ee : 0xffffff, toneMapped: false }),
    sign: new THREE.MeshStandardMaterial({ color: dark ? 0x0c2b30 : 0x0f2a5c, roughness: 0.35, metalness: 0.3 }),
  };
  const shadowTex = radial("rgba(0,0,0,1)", "rgba(0,0,0,0)", "rgba(0,0,0,.55)");
  const shadow = (w, d, o = 0.22, x = 0, z = 0) => { const s = mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: dark ? o * 1.6 : o, depthWrite: false })); s.rotation.x = -Math.PI / 2; s.position.set(x, 0.012, z); s.renderOrder = 2; return s; };
  const flat = (w, d, map, x = 0, y = 0.011, z = 0, opacity = 1, blending = THREE.NormalBlending) => { const s = mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map, transparent: true, opacity, depthWrite: false, toneMapped: false, blending })); s.rotation.x = -Math.PI / 2; s.position.set(x, y, z); s.renderOrder = 1; return s; };

  // ---- andon stack light: shared geometry, one lit lamp + a soft glow halo ----
  const lampGeo = new THREE.CylinderGeometry(1, 1, 1, 24), capGeo = new THREE.CylinderGeometry(1, 1, 1, 24), poleGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
  const lampOn = {}, lampOff = {}, haloMat = {};
  for (const k of LAMPS) {
    const col = new THREE.Color(C[k]);
    lampOn[k] = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.25), toneMapped: false });
    lampOff[k] = new THREE.MeshStandardMaterial({ color: col.clone().lerp(new THREE.Color(dark ? 0x1d3436 : 0xcbd5e1), 0.72), roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.8, envMapIntensity: 0.9 });
    haloMat[k] = new THREE.SpriteMaterial({ map: radial(C[k], "rgba(0,0,0,0)", C[k] + "55"), transparent: true, depthWrite: false, toneMapped: false, opacity: dark ? 0.9 : 0.55, blending: dark ? THREE.AdditiveBlending : THREE.NormalBlending });
  }
  const lampOf = (state) => (state === "late" || state === "near" || state === "ok" || state === "hold" ? state : null);
  const andon = (s, poleH) => {
    const g = new THREE.Group(), R = 0.07 * s, LH = 0.1 * s;
    const pole = mesh(poleGeo, M.metal, 0, poleH / 2, 0); pole.scale.set(0.02 * s, poleH, 0.02 * s); pole.castShadow = true; g.add(pole);
    const lamps = {};
    LAMPS.forEach((k, i) => {
      const y = poleH + (LAMPS.length - 1 - i) * (LH + 0.008 * s) + LH / 2 + 0.012 * s;
      const l = mesh(lampGeo, lampOff[k], 0, y, 0); l.scale.set(R, LH, R); l.castShadow = true; g.add(l); lamps[k] = l;
      const ring = mesh(capGeo, M.dark, 0, y - LH / 2 - 0.004 * s, 0); ring.scale.set(R * 1.04, 0.008 * s, R * 1.04); g.add(ring);
    });
    const top = mesh(capGeo, M.dark, 0, poleH + LAMPS.length * (LH + 0.008 * s) + 0.02 * s, 0); top.scale.set(R * 1.05, 0.03 * s, R * 1.05); g.add(top);
    const halo = new THREE.Sprite(haloMat.ok); halo.scale.setScalar(0.62 * s); halo.renderOrder = 6; halo.visible = false; g.add(halo);
    const set = (state) => {
      const on = lampOf(state);
      for (const k of LAMPS) lamps[k].material = k === on ? lampOn[k] : lampOff[k];
      halo.visible = !!on; if (on) { halo.material = haloMat[on]; halo.position.set(0, lamps[on].position.y, 0.02); }
    };
    return { g, set, top: poleH + LAMPS.length * (LH + 0.008 * s) + 0.04 * s };
  };

  // ---- progress ring on the floor: time used vs target ----
  const RING_SEG = 72;
  const trackMat = new THREE.MeshBasicMaterial({ color: dark ? 0x3b5a5e : 0xcbd5e1, transparent: true, opacity: dark ? 0.55 : 0.7, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const arcMat = {}; for (const k of ["ok", "near", "late", "hold", "incoming"]) arcMat[k] = new THREE.MeshBasicMaterial({ color: new THREE.Color(C[k]), transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const glowTex = { late: radial(C.late + "cc", "rgba(0,0,0,0)"), hold: radial(C.hold + "cc", "rgba(0,0,0,0)") };
  const setRing = (g, state, share) => {
    const s = share == null || !Number.isFinite(share) ? null : clamp01(share);
    const key2 = `${state}:${s == null ? "-" : Math.round(s * RING_SEG)}`;
    if (g.userData.ringKey === key2) return;
    g.userData.ringKey = key2;
    const u = g.userData;
    if (u.arc) { u.ringG.remove(u.arc); u.arc.geometry.dispose(); u.arc = null; }
    if (u.glow) { u.ringG.remove(u.glow); u.glow.geometry.dispose(); u.glow.material.dispose(); u.glow = null; }
    if (u.andon) u.andon.set(state);
    const len = state === "hold" || state === "late" ? 1 : s;
    if (len != null && len > 0.005) {
      const arc = mesh(new THREE.RingGeometry(0.9, 1, Math.max(8, Math.round(RING_SEG * len)), 1, Math.PI / 2, -Math.PI * 2 * len), arcMat[state] || arcMat.ok);
      arc.renderOrder = 3; u.ringG.add(arc); u.arc = arc;
    }
    if (state === "late" || state === "hold") {
      const glow = mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({ map: glowTex[state], transparent: true, opacity: dark ? 0.32 : 0.2, depthWrite: false, toneMapped: false }));
      glow.renderOrder = 2; u.ringG.add(glow); u.glow = glow;
    }
  };
  const trackGeo = new THREE.RingGeometry(0.93, 0.97, RING_SEG, 1);

  const hintTex = tex(300, 56, (g, w, h) => {
    g.fillStyle = dark ? "rgba(20,40,44,.92)" : "rgba(255,255,255,.96)"; rr(g, 2, 2, w - 4, h - 4, 26); g.fill();
    g.strokeStyle = dark ? "rgba(140,170,175,.5)" : "rgba(148,163,184,.6)"; g.lineWidth = 2; g.stroke();
    g.fillStyle = dark ? "#b7cdd0" : "#64748b"; g.font = `600 24px ${font}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("No photo · add in BOM", w / 2, h / 2 + 1);
  });
  // Neutral silhouette of the machine family (never an invented look-alike photo).
  const silhouette = (family, w) => {
    const s = new THREE.Group(), bw = w * 0.78;
    const add = (m) => { m.castShadow = true; s.add(m); return m; };
    add(mesh(RB(bw, 0.55, 0.66, 0.06), M.body, 0, 0.33, 0));
    add(mesh(RB(bw * 0.96, 0.08, 0.64, 0.03), M.dim, 0, 0.04, 0));
    if (family === "R") { const drum = add(mesh(new THREE.CylinderGeometry(0.19, 0.19, bw * 0.7, 28), M.metal, 0, 0.74, 0)); drum.rotation.z = Math.PI / 2; }
    else { add(mesh(RB(bw * 0.42, 0.38, 0.44, 0.05), M.body, -bw * 0.12, 0.8, 0)); add(mesh(new THREE.CylinderGeometry(0.16, 0.1, 0.22, 24), M.metal, -bw * 0.12, 1.09, 0)); }
    add(mesh(RB(0.26, 0.32, 0.05, 0.02), M.dim, bw * 0.3, 0.46, 0.35));
    const hint = mesh(new THREE.PlaneGeometry(1.1, 0.205), new THREE.MeshBasicMaterial({ map: hintTex, transparent: true, depthWrite: false, toneMapped: false }), 0, 0.14, 0.56);
    hint.rotation.x = -0.6; hint.renderOrder = 4; s.add(hint);
    return { obj: s, h: 1.2 };
  };
  // Reflection fade: opaque at the floor line, gone by a third of the card.
  const fadeTex = tex(4, 128, (g, w, h) => { const lg = g.createLinearGradient(0, h, 0, 0); lg.addColorStop(0, "rgba(255,255,255,1)"); lg.addColorStop(0.38, "rgba(255,255,255,0)"); lg.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = lg; g.fillRect(0, 0, w, h); }, false);
  const TILT = -0.1;
  const photoCard = (photo, w, h, withReflection = true) => {
    const map = new THREE.Texture(photo.image); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = maxAniso;
    map.generateMipmaps = true; map.minFilter = THREE.LinearMipmapLinearFilter; map.magFilter = THREE.LinearFilter; map.needsUpdate = true; textures.push(map);
    const grp = new THREE.Group();
    const card = mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map, transparent: true, alphaTest: 0.06, toneMapped: false }), 0, 0.03 + h / 2, 0);
    card.rotation.x = TILT; card.castShadow = true; card.renderOrder = 5; grp.add(card);
    let refl = null;
    if (withReflection) {
      refl = mesh(card.geometry, new THREE.MeshBasicMaterial({ map, alphaMap: fadeTex, transparent: true, opacity: dark ? 0.2 : 0.16, depthWrite: false, toneMapped: false }), 0, -(0.03 + h / 2), 0);
      refl.scale.y = -1; refl.rotation.x = -TILT; refl.renderOrder = 2; grp.add(refl);
      // the floor would hide it: drawn on top of the floor, under everything else
      refl.material.depthTest = false;
    }
    return { grp, card, refl };
  };

  // ---- machine units ----
  const units = new Map(), parts = [];
  const ids = machines.map((m) => String(m.id));
  const zoneOf = new Map(machines.map((m) => [String(m.id), m.z]));
  for (const m of machines) {
    const has = !!(m.photo && m.photo.image);
    const { w, h } = has ? cardSize(m.photo.aspect) : { w: BOX_W * 0.82, h: 1.0 };
    const g = new THREE.Group(); g.userData = { sn: String(m.id), w, h, ringKey: null, fade: 1, fadeT: 1, mats: [], ts: 1 };
    if (has) { const pc = photoCard(m.photo, w, h); g.add(pc.grp); g.userData.mats.push(pc.card.material); if (pc.refl) g.userData.mats.push(pc.refl.material); pc.refl.material.userData.base = pc.refl.material.opacity; }
    else { const s = silhouette(m.family, w); g.add(s.obj); g.userData.h = s.h; }
    g.add(shadow(w * 1.1, 0.8, 0.3, 0, 0.04));
    // floor ring (ellipse under the machine) + a small andon behind its right edge
    const ringG = new THREE.Group(); ringG.rotation.x = -Math.PI / 2; ringG.position.y = 0.014; ringG.scale.set(w * 0.56 + 0.1, 0.58, 1);
    const track = mesh(trackGeo, trackMat); track.renderOrder = 3; ringG.add(track);
    g.add(ringG); g.userData.ringG = ringG;
    const an = andon(1, 0.62); an.g.position.set(w / 2 + 0.02, 0, -0.22); g.add(an.g); g.userData.andon = an;
    setRing(g, m.state, m.share);
    units.set(String(m.id), g); parts.push(g);
  }

  // ---- bays: widths from what is actually there ----
  const inZone = (z, map = zoneOf) => ids.filter((id) => map.get(id) === z);
  const cardW = new Map(machines.map((m) => [String(m.id), m.photo && m.photo.image ? cardSize(m.photo.aspect).w : BOX_W * 0.82]));
  const gridOf = (list) => zoneGrid(list, BOX_W, list.map((id) => cardW.get(id)));
  const widthOf = (z, map = zoneOf) => (z === 0 || z === N - 1 ? END_W : Math.max(MINZ, gridOf(inZone(z, map)).width));
  const ZW = zones.map((_, i) => widthOf(i));
  const GUT = 0.16, TOT = ZW.reduce((a, b) => a + b, 0) + GUT * (N - 1), ZC = [];
  { let acc = -TOT / 2; ZW.forEach((w) => { ZC.push(acc + w / 2); acc += w + GUT; }); }

  // ---- workcell bays ----
  const padH = 0.56, padY = padH; // raised workcell plinth; its front face carries the bay sign
  const BELT_Z = -PAD_D / 2 + 0.5, WALL_Z = -PAD_D / 2 + 0.07, WALL_H = 0.46;
  const yellow = dark ? "rgba(214,178,58,.85)" : "rgba(234,179,8,.95)";
  const bayAndons = [];
  zones.forEach((zn, i) => {
    const W = ZW[i], x0 = ZC[i];
    const pad = mesh(RB(W, padH, PAD_D, 0.04), M.sign, x0, padH / 2, 0); pad.receiveShadow = true; pad.castShadow = true; sc.add(pad);
    sc.add(shadow(W + 0.7, PAD_D + 0.8, 0.12, x0, 0));
    // epoxy floor: soft pool of light, painted safety line, walkway hatch at the front
    const ppu = Math.min(150, 2048 / W), cw = Math.round(W * ppu), ch = Math.round(PAD_D * ppu);
    const floor = tex(cw, ch, (g, w, h) => {
      g.fillStyle = dark ? "#132b2d" : "#eef2f6"; g.fillRect(0, 0, w, h);
      const rg = g.createRadialGradient(w / 2, h * 0.5, 0, w / 2, h * 0.5, Math.max(w, h) * 0.62);
      rg.addColorStop(0, dark ? "rgba(120,220,210,.16)" : "rgba(255,255,255,1)"); rg.addColorStop(1, dark ? "rgba(0,0,0,0)" : "rgba(226,232,240,0)");
      g.fillStyle = rg; g.fillRect(0, 0, w, h);
      const u = ppu, inset = 0.14 * u, lw = Math.max(2, 0.045 * u);
      g.strokeStyle = yellow; g.lineWidth = lw; rr(g, inset, inset, w - inset * 2, h - inset * 2, 0.08 * u); g.stroke();
      // lane line in front of the conveyor (white, dashed)
      g.strokeStyle = dark ? "rgba(220,240,240,.35)" : "rgba(148,163,184,.55)"; g.lineWidth = Math.max(1.5, 0.025 * u); g.setLineDash([0.22 * u, 0.14 * u]);
      const ly = (BELT_Z + 0.32 + PAD_D / 2) * u; g.beginPath(); g.moveTo(inset * 1.8, ly); g.lineTo(w - inset * 1.8, ly); g.stroke(); g.setLineDash([]);
      // walkway hatch at the front edge
      g.save(); g.beginPath(); g.rect(inset * 1.6, h - inset - 0.2 * u, w - inset * 3.2, 0.14 * u); g.clip();
      g.strokeStyle = dark ? "rgba(214,178,58,.45)" : "rgba(234,179,8,.55)"; g.lineWidth = 0.04 * u;
      for (let x = -h; x < w + h; x += 0.14 * u) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 0.4 * u, h - 0.4 * u); g.stroke(); }
      g.restore();
    });
    const fl = mesh(new THREE.PlaneGeometry(W - 0.04, PAD_D - 0.04), new THREE.MeshStandardMaterial({ map: floor, roughness: 0.38, metalness: 0.0, envMapIntensity: 0.8 }), x0, padY + 0.001, 0);
    fl.rotation.x = -Math.PI / 2; fl.receiveShadow = true; sc.add(fl);
    // low glass partitions: back wall + side walls (middle of the bay, the conveyor runs behind)
    const back = mesh(RB(W - 0.12, WALL_H, 0.03, 0.012), M.glass, x0, padY + WALL_H / 2, WALL_Z); back.renderOrder = 7; sc.add(back);
    const rail = (len, x, z, rotY = 0) => { const m = mesh(RB(len, 0.035, 0.045, 0.012), M.metal, x, padY + WALL_H + 0.012, z); m.rotation.y = rotY; m.castShadow = true; sc.add(m); };
    rail(W - 0.1, x0, WALL_Z);
    const led = mesh(new THREE.BoxGeometry(W - 0.3, 0.012, 0.012), M.led, x0, padY + WALL_H + 0.036, WALL_Z); sc.add(led);
    const SW0 = BELT_Z + 0.36, SW1 = 0.55, SL = SW1 - SW0;
    for (const sx of [-1, 1]) {
      const wx = x0 + sx * (W / 2 - 0.05);
      const side = mesh(RB(0.03, WALL_H * 0.86, SL, 0.012), M.glass, wx, padY + WALL_H * 0.43, SW0 + SL / 2); side.renderOrder = 7; sc.add(side);
      rail(SL, wx, SW0 + SL / 2, Math.PI / 2);
      for (const pz of [SW0, SW1, WALL_Z]) { const p = mesh(RB(0.05, WALL_H + 0.03, 0.05, 0.012), M.metal, wx, padY + (WALL_H + 0.03) / 2, pz); p.castShadow = true; sc.add(p); }
    }
    // header sign on the plinth's front face: department name + head, white on navy
    const sw = W - 0.08, sh = padH - 0.06, scw = Math.min(2048, Math.round(sw * 220)), sch = Math.round(scw * sh / sw);
    const signTex = tex(scw, sch, (g, w, h) => {
      const name = String(zn.label || zn.k).toUpperCase(); let head = zn.head || "";
      g.fillStyle = C[zn.tone] || C.idle; if (zn.tone === "idle") g.globalAlpha = 0.45; rr(g, h * 0.22, h * 0.26, h * 0.1, h * 0.48, h * 0.05); g.fill(); g.globalAlpha = 1;
      let fs = h * 0.6; g.textBaseline = "middle";
      const sp = () => fs * 0.1;
      const measure = () => { g.font = `800 ${fs}px ${font}`; const nw = [...name].reduce((a, c) => a + g.measureText(c).width + sp(), 0); g.font = `500 ${fs * 0.82}px ${font}`; return nw + (head ? g.measureText("   " + head).width : 0); };
      const avail = w - h * 0.62;
      if (measure() > avail && head) head = ""; // the name stays big; the head is in the tag + summary too
      if (measure() > avail) fs *= avail / measure();
      let x = h * 0.5; g.font = `800 ${fs}px ${font}`; g.fillStyle = "#ffffff";
      for (const c of name) { g.fillText(c, x, h / 2 + 1); x += g.measureText(c).width + sp(); }
      if (head) { g.font = `500 ${fs * 0.82}px ${font}`; g.fillStyle = dark ? "rgba(170,225,220,.95)" : "rgba(191,219,254,.98)"; g.fillText("   " + head, x, h / 2 + 1); }
    });
    const face = mesh(new THREE.PlaneGeometry(sw, sh), new THREE.MeshBasicMaterial({ map: signTex, transparent: true, toneMapped: false }), x0, padH / 2, PAD_D / 2 + 0.003);
    sc.add(face);
    // top edge highlight: a thin LED line along the plinth lip
    sc.add(mesh(new THREE.BoxGeometry(W - 0.1, 0.01, 0.01), M.led, x0, padH - 0.012, PAD_D / 2 + 0.006));
    // bay andon on the back-right post
    const ba = andon(1.45, 0.78); ba.g.position.set(x0 + W / 2 - 0.05, padY, WALL_Z); ba.set(zn.tone === "idle" ? null : zn.tone); sc.add(ba.g); bayAndons.push(ba);
  });

  // ---- conveyor along the back of the whole line (moves only when asked) ----
  const beltTex = tex(256, 64, (g, w, h) => {
    g.fillStyle = dark ? "#0f1f21" : "#3b4656"; g.fillRect(0, 0, w, h);
    g.fillStyle = dark ? "rgba(140,200,195,.16)" : "rgba(255,255,255,.12)";
    for (let x = 0; x < w; x += 32) { g.fillRect(x, 0, 3, h); }
    g.fillStyle = dark ? "rgba(140,200,195,.22)" : "rgba(255,255,255,.2)";
    for (let x = 8; x < w; x += 64) { g.beginPath(); g.moveTo(x, h * 0.25); g.lineTo(x + 14, h / 2); g.lineTo(x, h * 0.75); g.lineTo(x + 6, h * 0.75); g.lineTo(x + 20, h / 2); g.lineTo(x + 6, h * 0.25); g.fill(); }
  });
  beltTex.wrapS = THREE.RepeatWrapping; const BL = TOT - 0.4; beltTex.repeat.set(BL / 1.2, 1);
  const beltY = padY + 0.2;
  const frameM = mesh(RB(BL + 0.08, 0.1, 0.42, 0.03), M.metal, 0, beltY - 0.06, BELT_Z); frameM.castShadow = true; frameM.receiveShadow = true; sc.add(frameM);
  const belt = mesh(new THREE.PlaneGeometry(BL, 0.34), new THREE.MeshStandardMaterial({ map: beltTex, roughness: 0.7, metalness: 0.05 }), 0, beltY + 0.002, BELT_Z);
  belt.rotation.x = -Math.PI / 2; belt.receiveShadow = true; sc.add(belt);
  for (const sz of [-1, 1]) { const g2 = mesh(RB(BL + 0.08, 0.05, 0.03, 0.01), M.metal, 0, beltY + 0.02, BELT_Z + sz * 0.2); sc.add(g2); }
  const legH = beltY - 0.1 - padY, legGeo = RB(0.05, legH, 0.05, 0.01);
  for (let x = -BL / 2 + 0.3; x <= BL / 2 - 0.2; x += 2.2) for (const sz of [-1, 1]) sc.add(mesh(legGeo, M.dark, x, padY + legH / 2, BELT_Z + sz * 0.17));
  // roller drums at both ends
  for (const ex of [-BL / 2, BL / 2]) { const d = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 20), M.metal, ex, beltY - 0.04, BELT_Z); d.rotation.x = Math.PI / 2; sc.add(d); }

  // ---- machine placement ----
  const holder = new THREE.Group(); holder.position.y = padY; sc.add(holder);
  for (const g of units.values()) holder.add(g);
  const rowZ = (row, rows) => (rows === 2 ? (row === 0 ? 0.62 : -0.32) : 0.2);
  const layoutZone = (z, animate) => {
    const list = inZone(z); if (!list.length) return;
    const grid = gridOf(list);
    for (const c of grid.cells) {
      const g = units.get(c.id);
      g.userData.tx = ZC[z] + c.x;
      g.userData.tz = rowZ(c.row, grid.rows); g.userData.ts = grid.scale;
      if (!animate) { g.position.x = g.userData.tx; g.position.z = g.userData.tz; g.scale.setScalar(grid.scale); }
    }
  };
  for (let z = 1; z < N - 1; z++) layoutZone(z, false);

  // ---- Rack bay: a real rack, labelled crates ----
  const rack = new THREE.Group(); rack.position.set(ZC[0], padY, 0.05); sc.add(rack);
  const RW = 1.72, RH = 1.25, RD = 0.72;
  const up = RB(0.055, RH, 0.055, 0.015);
  for (const x of [-RW / 2, RW / 2]) for (const z of [-RD / 2, RD / 2]) { const m = mesh(up, M.metal, x, RH / 2, z); m.castShadow = true; rack.add(m); }
  const shelf = RB(RW + 0.06, 0.035, RD + 0.04, 0.012);
  for (const y of [0.1, 0.6, 1.1]) { const m = mesh(shelf, M.metal, 0, y, 0); m.castShadow = true; m.receiveShadow = true; rack.add(m); }
  const crateLabel = tex(128, 64, (g, w, h) => { g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.fillStyle = "#1e3a8a"; g.font = `700 26px ${font}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("PARTS", w / 2, h / 2); });
  const crateGeo = RB(0.46, 0.32, 0.5, 0.04), labGeo = new THREE.PlaneGeometry(0.27, 0.13);
  const labMat = new THREE.MeshBasicMaterial({ map: crateLabel, toneMapped: false });
  const nCrates = Math.max(0, Math.min(6, rackCount));
  for (let i = 0; i < nCrates; i++) {
    const row = i < 3 ? 0 : 1, col = i % 3;
    const y = (row === 0 ? 0.12 : 0.62) + 0.16, x = (col - 1) * 0.54;
    const c = mesh(crateGeo, M.crate, x, y, 0.02); c.castShadow = true; c.receiveShadow = true; rack.add(c); rack.add(mesh(labGeo, labMat, x, y, 0.283));
  }
  rack.add(shadow(2.5, 1.2, 0.26));

  // ---- Ready bay: the ready machines' own photos + a green "✓ Ready" plate ----
  const readyG = new THREE.Group(); readyG.position.set(ZC[N - 1], padY, 0.05); sc.add(readyG);
  const shown = ready.slice(0, 3);
  shown.forEach((rm, i) => {
    const x = (i - (shown.length - 1) / 2) * 0.72, s = shown.length > 1 ? 0.6 : 0.95;
    if (rm.photo && rm.photo.image) { const { w, h } = cardSize(rm.photo.aspect); const pc = photoCard(rm.photo, w * s, h * s); pc.grp.position.set(x, 0, -i * 0.05); readyG.add(pc.grp); }
    else { const sl = silhouette(rm.family, BOX_W * 0.8); sl.obj.scale.setScalar(s); sl.obj.position.x = x; readyG.add(sl.obj); }
    readyG.add(shadow(1.0, 0.55, 0.24, x, 0));
  });
  const plateTex = tex(320, 96, (g, w, h) => {
    g.fillStyle = shown.length ? "#15803d" : (dark ? "#24403f" : "#94a3b8"); rr(g, 0, 0, w, h, 22); g.fill();
    g.fillStyle = "#fff"; g.font = `700 44px ${font}`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(shown.length ? "✓ Ready" : "None today", w / 2, h / 2 + 2);
  });
  const plate = mesh(new THREE.PlaneGeometry(0.95, 0.285), new THREE.MeshBasicMaterial({ map: plateTex, toneMapped: false, transparent: true }), 0, 0.17, 0.92);
  plate.rotation.x = -0.5; readyG.add(plate);

  // ---- shadow camera fitted tightly to the floor ----
  const TOPY = padY + BOX_H + 0.3;
  key.position.set(-TOT * 0.18, 14, 10); key.target.position.set(0, 0, 0);
  key.shadow.mapSize.set(2048, 512);
  { const sc2 = key.shadow.camera; const hw = TOT / 2 + 1.2; sc2.left = -hw; sc2.right = hw; sc2.top = 3.4; sc2.bottom = -3.4; sc2.near = 1; sc2.far = 60; sc2.updateProjectionMatrix(); }
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 3;

  // ---- camera: straight at the line, slightly from above (no yaw → every bay edge,
  // floor line and name plate is perfectly horizontal); a narrow lens pulled far
  // back keeps perspective distortion minimal while the plinths still read as 3D ----
  const PITCH = THREE.MathUtils.degToRad(24), YAW = 0;
  const DIR = new THREE.Vector3(Math.sin(YAW) * Math.cos(PITCH), Math.sin(PITCH), Math.cos(YAW) * Math.cos(PITCH));
  const baseLook = new THREE.Vector3(0, 0.45, 0.15);
  let dBase = 30, offY = 0, W = 1, H = 1;
  const corners = [];
  for (const x of [-TOT / 2, TOT / 2]) for (const z of [-PAD_D / 2, PAD_D / 2]) for (const y of [0, TOPY]) corners.push(new THREE.Vector3(x, y, z));
  const v = new THREE.Vector3();
  const place = (c, look, d) => { c.position.copy(look).addScaledVector(DIR, d); c.lookAt(look); c.updateMatrixWorld(); };
  const extent = (c) => { let x0 = 9, x1 = -9, y0 = 9, y1 = -9; for (const p of corners) { v.copy(p).project(c); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); } return { x0, x1, y0, y1 }; };
  // zoom state: 0 = whole line, 1 = dolly in on one machine
  let zoom = 0, zoomTarget = 0;
  const zLook = new THREE.Vector3(), curLook = new THREE.Vector3();
  const placeCam = () => {
    const e = ease(clamp01(zoom));
    curLook.copy(baseLook).lerp(zLook, e);
    place(cam, curLook, dBase * (1 - 0.56 * e));
  };
  const resize = () => {
    W = Math.max(1, host.clientWidth); H = Math.max(1, host.clientHeight);
    r.setSize(W, H);
    for (const c of [cam, baseCam]) { c.aspect = W / H; c.fov = THREE.MathUtils.clamp(2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(12)) / c.aspect)), 3.5, 10); c.clearViewOffset(); c.updateProjectionMatrix(); }
    // distance: the smallest that keeps the line inside 96% of the width and ~62% of the height
    let lo = 1, hi = 600;
    hi = 1600; for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; place(baseCam, baseLook, mid); const ex = extent(baseCam); if (ex.x1 - ex.x0 <= 1.97 && ex.y1 - ex.y0 <= 1.36) hi = mid; else lo = mid; }
    dBase = hi; place(baseCam, baseLook, dBase);
    const ex = extent(baseCam), cx = (ex.x0 + ex.x1) / 2;
    offY = Math.round((-0.95 - ex.y0) * H / 2); // sit the floor on the bottom edge; tags + header use the top band
    const offX = Math.round(cx * W / 2);
    for (const c of [cam, baseCam]) { c.setViewOffset(W, H, offX, offY, W, H); c.updateProjectionMatrix(); }
    place(baseCam, baseLook, dBase); placeCam(); kick();
  };

  const project = (c, x, y, z = 0) => { v.set(x, y, z).project(c); return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H }; };
  const zoneScreen = () => zones.map((_, i) => { const z = PAD_D / 2; const a = project(baseCam, ZC[i] - ZW[i] / 2, 0, z), b = project(baseCam, ZC[i] + ZW[i] / 2, 0, z); return { x: (a.x + b.x) / 2, w: b.x - a.x, y: Math.max(a.y, b.y) }; });
  const machineScreen = () => ids.map((id) => { const g = units.get(id), top = project(cam, g.position.x, padY + g.position.y + 0.06 + g.userData.h * g.scale.y, g.position.z); return { sn: id, x: top.x, y: top.y }; });

  // ---- picking + "interacting" (the conveyor runs while the pointer is on the scene) ----
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let hovered = null, picked = null, inside = false;
  const zone = host.parentElement || host;
  const hitAt = (e) => {
    const b = r.domElement.getBoundingClientRect(); ndc.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
    ray.setFromCamera(ndc, cam); const hit = ray.intersectObjects(parts, true).find((h) => !h.object.userData.noPick);
    let o = hit && hit.object; while (o && !o.userData.sn) o = o.parent; return o || null;
  };
  const focusOn = () => { const f = picked || hovered; for (const g of units.values()) g.userData.fadeT = !f || g === f ? 1 : 0.28; };
  const setHover = (o) => {
    if (o === hovered) return; hovered = o; r.domElement.style.cursor = o ? "pointer" : "";
    focusOn(); if (onHover) onHover(o ? o.userData.sn : null); kick();
  };
  const onMove = (e) => setHover(hitAt(e)), onLeave = () => setHover(null);
  const onClick = (e) => { const o = hitAt(e); if (o) pick(o.userData.sn); else if (picked) { pick(null); if (onPick) onPick(null); } };
  const onEnter = () => { inside = true; kick(); }, onExit = () => { inside = false; };
  r.domElement.addEventListener("pointermove", onMove);
  r.domElement.addEventListener("pointerleave", onLeave);
  r.domElement.addEventListener("click", onClick);
  zone.addEventListener("pointerenter", onEnter); zone.addEventListener("pointerleave", onExit);
  const pick = (sn) => {
    const o = sn == null ? null : units.get(String(sn)) || null;
    picked = o; focusOn();
    if (o) { zLook.set(o.position.x + 0.95 * o.scale.x, padY + o.userData.h * o.scale.y * 0.5, o.position.z); zoomTarget = 1; } else zoomTarget = 0;
    kick(); if (o && onPick) onPick(String(sn));
  };

  // ---- data changes: a dept change glides; the conveyor runs ~3 s ----
  const glides = new Map(); const DUR = 1.4;
  let beltUntil = performance.now() + INTRO * 1000;
  function update(next) {
    if (!run) return false;
    const nextIds = next.map((m) => String(m.id));
    if (nextIds.length !== ids.length || nextIds.some((id) => !units.has(id))) return false;
    const trial = new Map(zoneOf); let moved = false;
    for (const m of next) { const id = String(m.id); if (zoneOf.get(id) !== m.z) { trial.set(id, m.z); moved = true; } }
    if (moved) for (let z = 1; z < N - 1; z++) if (Math.abs(widthOf(z, trial) - ZW[z]) > 1e-6) return false; // bays change → remount
    let changed = moved;
    for (const m of next) { const g = units.get(String(m.id)), before = g.userData.ringKey; setRing(g, m.state, m.share); if (g.userData.ringKey !== before) changed = true; }
    if (changed && !reduce) beltUntil = performance.now() + AFTER_CHANGE * 1000;
    if (!moved) { kick(); return true; }
    const now = performance.now(), touched = new Set();
    for (const m of next) { const id = String(m.id); if (zoneOf.get(id) !== m.z) { touched.add(zoneOf.get(id)); touched.add(m.z); zoneOf.set(id, m.z); const g = units.get(id); glides.set(id, { fx: g.position.x, fz: g.position.z, t0: now }); } }
    for (const z of touched) layoutZone(z, true);
    kick(); return true;
  }

  let run = true, visible = true, raf = 0, lastFrame = 0;
  function frame(now) {
    raf = 0; if (!run || !visible || document.hidden) { lastFrame = 0; return; }
    const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000); lastFrame = now;
    let moving = false, shadowsMoved = false;
    const beltOn = !reduce && (inside || now < beltUntil || glides.size > 0);
    if (beltOn) { beltTex.offset.x -= dt * 0.22; moving = true; }
    for (const [id, gl] of glides) {
      const g = units.get(id), k = reduce ? 1 : clamp01((now - gl.t0) / 1000 / DUR), e = ease(k);
      g.position.x = gl.fx + (g.userData.tx - gl.fx) * e; g.position.z = gl.fz + (g.userData.tz - gl.fz) * e; g.position.y = Math.sin(Math.PI * e) * 0.14;
      if (k >= 1) { glides.delete(id); g.position.set(g.userData.tx, 0, g.userData.tz); } else moving = true;
      shadowsMoved = true;
    }
    const sp = reduce ? 1 : Math.min(1, dt * 10);
    for (const g of units.values()) {
      if (glides.has(g.userData.sn)) continue;
      if (Math.abs(g.position.x - g.userData.tx) > 0.001 || Math.abs(g.position.z - g.userData.tz) > 0.001) { g.position.x += (g.userData.tx - g.position.x) * sp; g.position.z += (g.userData.tz - g.position.z) * sp; moving = shadowsMoved = true; }
      if (Math.abs(g.scale.x - g.userData.ts) > 0.001) { g.scale.setScalar(g.scale.x + (g.userData.ts - g.scale.x) * sp); moving = shadowsMoved = true; }
      const tgt = g === hovered || g === picked ? 0.08 : 0;
      if (Math.abs(g.position.y - tgt) > 0.001) { g.position.y += (tgt - g.position.y) * sp; moving = shadowsMoved = true; }
      if (Math.abs(g.userData.fade - g.userData.fadeT) > 0.005) {
        g.userData.fade += (g.userData.fadeT - g.userData.fade) * sp;
        for (const m of g.userData.mats) m.opacity = g.userData.fade * (m.userData.base ?? 1);
        moving = true;
      }
    }
    if (Math.abs(zoom - zoomTarget) > 0.002) { zoom += (zoomTarget - zoom) * (reduce ? 1 : Math.min(1, dt * 4.2)); if (Math.abs(zoom - zoomTarget) <= 0.002) zoom = zoomTarget; placeCam(); moving = true; }
    if (shadowsMoved) r.shadowMap.needsUpdate = true;
    r.render(sc, cam);
    api.frames++;
    if (api.onFrame) api.onFrame();
    if (moving) raf = requestAnimationFrame(frame); // idle → no loop
    else lastFrame = 0;
  }
  function kick() { if (!raf && run && visible) raf = requestAnimationFrame(frame); }
  const ro = new ResizeObserver(resize); ro.observe(host);
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; kick(); }); io.observe(host);
  const onVis = () => kick(); document.addEventListener("visibilitychange", onVis);
  resize();

  const api = {
    update, zoneScreen, machineScreen, kick, pick, onFrame: null, frames: 0,
    setHover: (sn) => setHover(sn ? units.get(String(sn)) || null : null),
    isZoomed: () => zoomTarget === 1,
    info: () => ({ calls: r.info.render.calls, triangles: r.info.render.triangles, geometries: r.info.memory.geometries, textures: r.info.memory.textures, dpr: r.getPixelRatio() }),
    stop() {
      if (!run) return;
      run = false; cancelAnimationFrame(raf); raf = 0;
      ro.disconnect(); io.disconnect(); document.removeEventListener("visibilitychange", onVis);
      r.domElement.removeEventListener("pointermove", onMove);
      r.domElement.removeEventListener("pointerleave", onLeave);
      r.domElement.removeEventListener("click", onClick);
      zone.removeEventListener("pointerenter", onEnter); zone.removeEventListener("pointerleave", onExit);
      const mats = new Set(), geos = new Set();
      sc.traverse((o) => { if (o.geometry) geos.add(o.geometry); const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach((x) => mats.add(x)); });
      for (const g of geos) g.dispose();
      for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
      for (const m of [...Object.values(M), ...Object.values(lampOn), ...Object.values(lampOff), ...Object.values(haloMat), ...Object.values(arcMat), trackMat]) m.dispose();
      for (const t of textures) t.dispose();
      for (const g of [lampGeo, capGeo, poleGeo, trackGeo]) g.dispose();
      if (key.shadow.map) key.shadow.map.dispose();
      sc.environment = null; sc.clear();
      r.dispose(); r.forceContextLoss();
      if (r.domElement.parentNode) r.domElement.parentNode.removeChild(r.domElement);
    },
  };
  return api;
}
