import React, { useEffect, useRef } from "react";
import {
  WebGLRenderer, WebGLRenderTarget, Scene, PerspectiveCamera, OrthographicCamera, Group, Mesh,
  ExtrudeGeometry, PlaneGeometry, BoxGeometry, MeshPhysicalMaterial, MeshStandardMaterial, MeshBasicMaterial,
  ShaderMaterial, AmbientLight, DirectionalLight, PointLight, PMREMGenerator, SRGBColorSpace,
  ACESFilmicToneMapping, BackSide, Vector3, Color, Float32BufferAttribute,
} from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { BRAND, LOGO_SVG, shantazLogo } from "./shantazLogoGeometry.js";

export { default as ShantazLogoSVG } from "./ShantazLogoSVG.jsx";

// Login hero (2026-11-04): the SHANTAZ logo in 3D — gear, wheat, wordmark,
// ®, tagline — extruded (SVGLoader → ExtrudeGeometry) from the exact paths of
// the owner's CorelDRAW master, the same file the 2D logo draws.
//
// Intro (~2.3 s): the gear rolls in from the left (~120°, mechanical settle)
// → wheat grows out of it, grains pop one by one → SHANTAZ assembles left to
// right under a bright light sweep → ® pops → tagline tracks in.
// Idle: no spin. Studio reflections, a slow tilt towards the pointer / phone
// tilt (max ~6°), a light sweep every ~7 s, a faint blurred floor reflection.
// Renders on demand only (intro, sweep, tilt settling), pauses when the tab
// is hidden, frees every GPU resource on unmount. Decorative (aria-hidden);
// onFail() → LoginPage shows the 2D SVG logo.
// fullBleed: the canvas fills the whole screen (transparent, behind the
// sign-in card); the logo sits left-of-centre on desktop, at the top on
// phones. Each light sweep fires window event "shantaz:sweep"
// ({ detail: { duration, intro } }) so other UI can sync its sheen.
const U = 0.02;              // logo unit (0.5 mm of the CDR master) → scene unit
const INTRO_END = 2.4;
const SWEEP_EVERY = 7;
const SWEEP_LEN = 1.1;
const TILT = (6 * Math.PI) / 180;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const outCubic = (x) => 1 - Math.pow(1 - clamp01(x), 3);
const outBack = (x, s = 1.6) => { const k = clamp01(x) - 1; return 1 + (s + 1) * k * k * k + s * k * k; };
const span = (t, a, d) => clamp01((t - a) / d);

export default function LoginBrand3D({ onFail, fullBleed = false }) {
  const hostRef = useRef(null);
  useEffect(() => {
    const host = hostRef.current; if (!host) return undefined;
    let renderer;
    try { renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" }); }
    catch { onFail && onFail(); return undefined; }
    renderer.setPixelRatio(Math.min(Math.max(window.devicePixelRatio || 1, 1), 1.75));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = false;
    const cv = renderer.domElement;
    Object.assign(cv.style, { width: "100%", height: "100%", display: "block", opacity: "0", transition: "opacity 500ms ease" });
    host.appendChild(cv);
    requestAnimationFrame(() => { cv.style.opacity = "1"; });
    const onLost = (e) => { e.preventDefault(); onFail && onFail(); };
    renderer.domElement.addEventListener("webglcontextlost", onLost);

    const scene = new Scene();
    const camera = new PerspectiveCamera(28, 1, 0.1, 100);

    // ── studio environment: dark room + soft "lightformer" panels ──
    const pmrem = new PMREMGenerator(renderer);
    const room = new Scene();
    const roomBox = new Mesh(new BoxGeometry(20, 20, 20), new MeshBasicMaterial({ color: 0x0a101b, side: BackSide }));
    room.add(roomBox);
    const panel = (w, h, hex, power, pos, look) => {
      const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(hex).multiplyScalar(power) }));
      m.position.set(...pos); m.lookAt(...look); room.add(m);
    };
    panel(9, 2.4, 0xffffff, 3.2, [0, 6, 1], [0, 0, 0]);       // top softbox
    panel(1.2, 7, 0xdfe8ff, 2.4, [-6, 1, 2], [0, 0, 0]);      // cool strip left
    panel(1.2, 7, 0xffd6a8, 2.0, [6, 1, -1], [0, 0, 0]);      // warm strip right
    panel(8, 1.4, 0x9fb4d8, 0.7, [0, -2, 6], [0, 0, 0]);      // low front fill
    const envRT = pmrem.fromScene(room, 0.03);
    scene.environment = envRT.texture;
    room.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });

    // ── materials (true colours from the CDR master) ──
    // gear: brushed black gunmetal; cool rim lights on the bevels + a light pool behind it make it read on navy
    const gearMat = new MeshPhysicalMaterial({ color: 0x22252a, metalness: 0.88, roughness: 0.3, anisotropy: 0.85, anisotropyRotation: Math.PI / 2, clearcoat: 1, clearcoatRoughness: 0.1, transparent: true, opacity: 0 }); // brushed
    // wheat: the file's gradient (bright #4AAC26 at the foot of each piece → deep #1D5113 at its tip) as vertex colours
    const wheatMat = new MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.05, roughness: 0.45, sheen: 0.6, sheenColor: new Color(0x9fe07c), sheenRoughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.4 });
    const redMat = new MeshPhysicalMaterial({ color: 0xe30016, metalness: 0.15, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08, emissive: 0xe30016, emissiveIntensity: 0.12 });
    const tagMat = new MeshStandardMaterial({ color: 0xc3ccdb, metalness: 0.7, roughness: 0.38, transparent: true, opacity: 0 });

    // ── geometry: the exact CDR paths (src/assets/shantaz-logo.svg) via SVGLoader ──
    const L = shantazLogo();
    const CX = L.box.x + L.box.w / 2, CY = L.box.y + L.box.h / 2;
    const toScene = (x, y) => [(x - CX) * U, -(y - CY) * U];
    const svgPaths = new SVGLoader().parse(LOGO_SVG).paths;
    const part = (name) => svgPaths.filter((p) => p.userData.node.getAttribute("data-part") === name);
    const shapeBox = (shapes) => {
      const bx = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      shapes.forEach((s) => s.getPoints().forEach((q) => { bx.minX = Math.min(bx.minX, q.x); bx.maxX = Math.max(bx.maxX, q.x); bx.minY = Math.min(bx.minY, q.y); bx.maxY = Math.max(bx.maxY, q.y); }));
      return bx;
    };
    // extrude in logo units, then → scene units (y up, centred), pivot at `pivot` (scene units)
    const extrude = (shapes, depth, bevel, pivot, segs = 2) => {
      const d = depth / U, bv = bevel / U;
      const g = new ExtrudeGeometry(shapes, { depth: d, bevelEnabled: bv > 0, bevelThickness: bv, bevelSize: bv * 0.8, bevelSegments: segs, curveSegments: 10 });
      g.translate(-CX, -CY, -d / 2);
      g.scale(U, -U, -U);                    // flip y (and z, to keep the winding)
      g.translate(-pivot[0], -pivot[1], 0);
      return g;
    };
    const glyphs = (path) => SVGLoader.createShapes(path).map((s) => ({ s, bb: shapeBox([s]) })).sort((a, c) => a.bb.minX - c.bb.minX);

    const rig = new Group(); scene.add(rig);
    const logo = new Group(); rig.add(logo);

    // gear (pivot = gear centre, so it can roll)
    const gp = toScene(...L.gearCenter);
    const gear = new Group(); gear.position.set(gp[0], gp[1], 0); logo.add(gear);
    gear.add(new Mesh(extrude(SVGLoader.createShapes(part("gear")[0]), 0.22, 0.04, gp, 3), gearMat));

    // wheat: grows up out of the gear (pivot = foot of the wheat); grains pop one by one from their foot
    const C0 = new Color(BRAND.wheatLight), C1 = new Color(BRAND.wheatDark);
    const wheatPieces = part("wheat").map((p) => { const shapes = SVGLoader.createShapes(p); return { p, shapes, bb: shapeBox(shapes) }; });
    const wAll = wheatPieces.reduce((a, w) => ({ minX: Math.min(a.minX, w.bb.minX), maxX: Math.max(a.maxX, w.bb.maxX), maxY: Math.max(a.maxY, w.bb.maxY) }), { minX: Infinity, maxX: -Infinity, maxY: -Infinity });
    const wp = toScene((wAll.minX + wAll.maxX) / 2, wAll.maxY);
    const wheat = new Group(); wheat.position.set(wp[0], wp[1], 0.13); wheat.scale.set(0.35, 0.001, 1); logo.add(wheat);
    const grains = [];
    wheatPieces.forEach(({ p, shapes, bb }) => {
      const piv = toScene((bb.minX + bb.maxX) / 2, bb.maxY);
      const g = extrude(shapes, 0.05, 0.01, piv);
      const pos = g.attributes.position, hgt = (bb.maxY - bb.minY) * U || 1, col = new Float32Array(pos.count * 3), c = new Color();
      for (let i = 0; i < pos.count; i++) { c.copy(C0).lerp(C1, clamp01(pos.getY(i) / hgt)); col.set([c.r, c.g, c.b], i * 3); }
      g.setAttribute("color", new Float32BufferAttribute(col, 3));
      const m = new Mesh(g, wheatMat); m.position.set(piv[0] - wp[0], piv[1] - wp[1], 0);
      const stem = p.userData.node.getAttribute("data-kind") === "stem";
      if (!stem) m.scale.setScalar(0.001);
      wheat.add(m); if (!stem) grains.push({ m, y: bb.maxY });
    });
    grains.sort((a, c) => c.y - a.y); // bottom → top

    // wordmark: one mesh per letter (pivot = letter bottom centre)
    const letters = glyphs(part("wordmark")[0]).map(({ s, bb }) => {
      const p = toScene((bb.minX + bb.maxX) / 2, bb.maxY);
      const mat = redMat.clone(); mat.transparent = true; mat.opacity = 0;
      const m = new Mesh(extrude([s], 0.26, 0.022, p), mat);
      m.position.set(p[0], p[1], 0); logo.add(m);
      return { m, mat, x: p[0], top: bb.minY, bottom: bb.maxY };
    });
    const wordR = letters[letters.length - 1].x + 0.4;
    const wordY = toScene(0, (letters[1].top + letters[1].bottom) / 2)[1];

    // ® (pops)
    const regShapes = SVGLoader.createShapes(part("registered")[0]); const rbb = shapeBox(regShapes);
    const rc = toScene((rbb.minX + rbb.maxX) / 2, (rbb.minY + rbb.maxY) / 2);
    const regMat = tagMat.clone(); regMat.transparent = false; regMat.opacity = 1;
    const reg = new Mesh(extrude(regShapes, 0.05, 0.006, rc), regMat);
    reg.position.set(rc[0], rc[1], 0.02); reg.scale.setScalar(0.001); logo.add(reg);

    // tagline: flat metallic, one mesh per glyph so it can track in
    let tagBottom = -Infinity;
    const tag = glyphs(part("tagline")[0]).map(({ s, bb }, i) => {
      const p = toScene((bb.minX + bb.maxX) / 2, bb.maxY); tagBottom = Math.max(tagBottom, bb.maxY);
      const mat = tagMat.clone();
      const m = new Mesh(extrude([s], 0.03, 0, p, 1), mat);
      m.position.set(p[0], p[1], 0); logo.add(m);
      return { m, mat, x: p[0], i };
    });
    const tagMid = tag.reduce((a, g) => a + g.x, 0) / tag.length;
    const floorY = toScene(0, tagBottom)[1] - 0.1;

    // ── lights ──
    scene.add(new AmbientLight(0x9fb0d0, 0.25));
    const key = new DirectionalLight(0xeef3ff, 1.4); key.position.set(-3, 4, 6); scene.add(key);
    const rim = new DirectionalLight(0xffb26b, 1.3); rim.position.set(4, 2.5, -4); scene.add(rim);
    // cool rim lights grazing the gear's bevels (top-left, left, bottom) so every tooth edge catches light
    const coolRim = new DirectionalLight(0xa9c8ff, 4.5); coolRim.position.set(-4, 4, 1.2); scene.add(coolRim);
    const rimL = new DirectionalLight(0xbfd6ff, 3.5); rimL.position.set(-6, -1, 0.6); scene.add(rimL);
    const rimB = new DirectionalLight(0xbfd6ff, 3.0); rimB.position.set(1, -5, 0.8); scene.add(rimB);
    // soft steel-blue light pool behind the logo (strongest behind the gear) so the black gear silhouettes against it
    const glowMat = new ShaderMaterial({
      transparent: true, depthWrite: false, toneMapped: false,
      uniforms: { uGear: { value: [gp[0], gp[1]] } },
      vertexShader: "varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `uniform vec2 uGear; varying vec2 vP;
        void main(){
          vec2 q = vP / vec2(5.6, 2.8); float a = exp(-dot(q, q) * 1.4) * 0.22;
          vec2 g = (vP - uGear) / 2.3; a += exp(-dot(g, g) * 1.6) * 0.42;
          gl_FragColor = vec4(0.47, 0.60, 0.80, clamp(a, 0.0, 0.6));
        }`,
    });
    const glow = new Mesh(new PlaneGeometry(16, 10), glowMat); glow.position.z = -0.9; glow.renderOrder = -1; rig.add(glow);
    const sweep = new PointLight(0xfff4e6, 0, 0, 2); sweep.position.set(gp[0] - 1.6, wordY + 0.2, 0.75); scene.add(sweep);
    const sweepL = gp[0] - 1.6; // the sweep starts at the gear (specular pass over the gunmetal), then crosses the wordmark

    // ── faint blurred reflection: the logo mirrored under the floor line,
    //    rendered at quarter resolution, blurred and faded in a full-screen pass
    const reflRT = new WebGLRenderTarget(4, 4);
    const fsCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const fsScene = new Scene();
    const fsMat = new ShaderMaterial({
      uniforms: { map: { value: reflRT.texture }, uFloor: { value: 0.3 }, uTexel: { value: [0.01, 0.01] }, uStrength: { value: 0.32 } },
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: `uniform sampler2D map; uniform float uFloor; uniform vec2 uTexel; uniform float uStrength; varying vec2 vUv;
        void main(){
          vec4 c = vec4(0.0);
          for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) c += texture2D(map, vUv + vec2(float(i), float(j)) * uTexel * 1.5);
          c /= 9.0;
          float fade = smoothstep(uFloor - 0.24, uFloor, vUv.y) * step(vUv.y, uFloor);
          gl_FragColor = vec4(c.rgb, c.a * fade * uStrength);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthTest: false, depthWrite: false,
    });
    const fsQuad = new Mesh(new PlaneGeometry(2, 2), fsMat); fsQuad.frustumCulled = false; fsScene.add(fsQuad);
    const floorV = new Vector3();

    // ── camera fit ──
    const W = L.box.w * U, H = L.box.h * U;
    const fit = () => {
      const w = host.clientWidth || 1, h = host.clientHeight || 1;
      renderer.setSize(w, h, false);
      const dpr = renderer.getPixelRatio();
      reflRT.setSize(Math.max(2, Math.round((w * dpr) / 4)), Math.max(2, Math.round((h * dpr) / 4)));
      fsMat.uniforms.uTexel.value = [4 / (w * dpr), 4 / (h * dpr)];
      camera.aspect = w / h;
      const tan = Math.tan((camera.fov * Math.PI) / 360);
      // logo region inside the canvas (px): the whole box, or — full bleed —
      // the left part on desktop (glass card on the right) / the top on phones
      let rw = w, rh = h, rcx = w / 2, rcy = h / 2;
      if (fullBleed) {
        if (w >= 1024) { const card = Math.max(400, w * 0.34) + 40; rw = (w - card) * 0.9; rh = h * 0.7; rcx = (w - card) / 2 + 16; rcy = h * 0.45; }
        else { rw = w - 56; rh = Math.max(220, h * 0.36); rcx = w / 2; rcy = Math.max(250, h * 0.4) * 0.52; } // centred, ≥ 28 px each side
      }
      const fW = rw / w, fH = rh / h;
      const d = Math.max(W / fW / (2 * tan * camera.aspect), (H * 1.3) / fH / (2 * tan));
      camera.position.set(0, 0.25, d);
      camera.lookAt(0, -H * 0.2, 0);
      if (fullBleed) camera.setViewOffset(w, h, w / 2 - rcx, h / 2 - rcy, w, h); else camera.clearViewOffset();
      camera.updateProjectionMatrix();
      kick();
    };

    // ── input: pointer or phone tilt → gentle parallax (max ~6°) ──
    const aim = { x: 0, y: 0 }, cur = { x: 0, y: 0 };
    const onMove = (e) => { aim.x = e.clientX / window.innerWidth - 0.5; aim.y = e.clientY / window.innerHeight - 0.5; kick(); };
    const onTilt = (e) => {
      if (e.gamma == null) return;
      aim.x = Math.max(-0.5, Math.min(0.5, e.gamma / 60)); aim.y = Math.max(-0.5, Math.min(0.5, (e.beta - 40) / 80)); kick();
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("deviceorientation", onTilt, { passive: true });

    // ── timeline ──
    let raf = 0, t0 = performance.now(), paused = 0, hiddenAt = 0, settled = false;
    let nextSweep = 1.2, sweepSent = -1;
    const clock = () => (performance.now() - t0 - paused) / 1000;

    const apply = (t) => {
      // 1. gear rolls in from the left, ~120°, mechanical settle
      const ge = outBack(span(t, 0, 0.8), 0.9);
      const roll = (120 * Math.PI) / 180;
      gear.position.x = gp[0] - roll * 0.82 * (1 - ge);
      gear.rotation.z = roll * (1 - ge);
      gearMat.opacity = outCubic(span(t, 0, 0.3));
      // 2. wheat grows up out of the gear, grains pop one by one
      const we = outCubic(span(t, 0.55, 0.5));
      wheat.scale.set(0.35 + 0.65 * we, Math.max(0.001, we), 1);
      grains.forEach((g, i) => { const e = outBack(span(t, 0.75 + (i / grains.length) * 0.55, 0.26), 2.2); g.m.scale.setScalar(Math.max(0.001, e)); });
      // 3. SHANTAZ assembles left → right
      letters.forEach((l, i) => {
        const e = outCubic(span(t, 1.0 + i * 0.075, 0.45));
        l.m.position.x = l.x - 0.4 * (1 - e);
        l.m.position.z = 0.5 * (1 - e);
        l.m.rotation.y = -0.6 * (1 - e);
        l.mat.opacity = e;
      });
      // 4. ® pops   5. tagline tracks in
      reg.scale.setScalar(Math.max(0.001, outBack(span(t, 1.72, 0.3), 2.4)));
      tag.forEach((g) => {
        const e = outCubic(span(t, 1.8 + g.i * 0.018, 0.5));
        g.m.position.x = g.x + (g.x - tagMid) * 0.35 * (1 - e);
        g.mat.opacity = e;
      });
      // light sweep: first across the assembling letters, then every ~7 s
      let st = t - nextSweep;
      if (st > SWEEP_LEN) { nextSweep += t < INTRO_END + 1 ? SWEEP_EVERY + 1 : SWEEP_EVERY; st = t - nextSweep; }
      if (st >= 0 && st <= SWEEP_LEN) {
        if (sweepSent !== nextSweep) {
          // let other UI (the glass card's sheen) sync to the same light pass
          sweepSent = nextSweep;
          try { window.dispatchEvent(new CustomEvent("shantaz:sweep", { detail: { duration: SWEEP_LEN * 1000, intro: t < INTRO_END } })); } catch { /* old browser */ }
        }
        const k = st / SWEEP_LEN;
        sweep.position.x = sweepL + k * (wordR + 0.4 - sweepL);
        sweep.intensity = Math.sin(k * Math.PI) * 5.5;
      } else sweep.intensity = 0;
      // after the intro: opaque materials (cheaper, correct sorting)
      if (!settled && t > INTRO_END) {
        settled = true;
        [gearMat, ...letters.map((l) => l.mat), ...tag.map((g) => g.mat)].forEach((m) => { m.transparent = false; m.opacity = 1; m.needsUpdate = true; });
      }
      // parallax
      cur.x += (aim.x - cur.x) * 0.06; cur.y += (aim.y - cur.y) * 0.06;
      rig.rotation.y = cur.x * 2 * TILT;
      rig.rotation.x = cur.y * 2 * TILT * 0.6;
    };

    const render = () => {
      // reflection pass (mirrored about the floor line, quarter resolution)
      rig.updateMatrixWorld();
      floorV.set(0, floorY, 0).applyMatrix4(rig.matrixWorld).project(camera);
      fsMat.uniforms.uFloor.value = (floorV.y + 1) / 2;
      logo.scale.y = -1; logo.position.y = 2 * floorY; glow.visible = false;
      renderer.setRenderTarget(reflRT); renderer.setClearColor(0x000000, 0); renderer.clear();
      renderer.render(scene, camera);
      logo.scale.y = 1; logo.position.y = 0; glow.visible = true;
      renderer.setRenderTarget(null); renderer.clear();
      renderer.render(fsScene, fsCam);
      renderer.render(scene, camera);
    };

    const busy = (t) => t < INTRO_END + 0.1 || sweep.intensity > 0 || Math.abs(aim.x - cur.x) > 0.002 || Math.abs(aim.y - cur.y) > 0.002;
    let sweepTimer = 0;
    const frame = () => {
      raf = 0;
      const t = clock();
      apply(t); render();
      if (busy(t)) raf = requestAnimationFrame(frame);
      else scheduleSweep(t);
    };
    // idle = no frames at all; wake up for the next sweep
    const scheduleSweep = (t) => {
      clearTimeout(sweepTimer);
      sweepTimer = setTimeout(kick, Math.max(50, (nextSweep - t) * 1000));
    };
    function kick() { if (!raf && !hiddenAt) raf = requestAnimationFrame(frame); }
    const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; clearTimeout(sweepTimer); };
    const onVis = () => {
      if (document.hidden) { if (!hiddenAt) hiddenAt = performance.now(); stop(); }
      else { if (hiddenAt) paused += performance.now() - hiddenAt; hiddenAt = 0; kick(); }
    };
    document.addEventListener("visibilitychange", onVis);
    const ro = new ResizeObserver(fit); ro.observe(host);
    fit();
    if (document.hidden) onVis();

    return () => {
      stop(); ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("deviceorientation", onTilt);
      document.removeEventListener("visibilitychange", onVis);
      renderer.domElement.removeEventListener("webglcontextlost", onLost);
      const mats = new Set();
      scene.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); mats.add(o.material); } });
      fsQuad.geometry.dispose(); fsMat.dispose();
      mats.forEach((m) => m.dispose());
      reflRT.dispose(); envRT.dispose(); pmrem.dispose();
      renderer.dispose(); renderer.forceContextLoss();
      try { host.removeChild(renderer.domElement); } catch { /* already gone */ }
    };
  }, [onFail]);
  return (
    <div className={`lg-brand3d${fullBleed ? " lg-brand3d--full" : ""}`} aria-hidden="true"
         style={fullBleed ? { position: "absolute", inset: 0, height: "auto", pointerEvents: "none" } : undefined}>
      <div ref={hostRef} className="lg-3d lg-3d--logo" style={fullBleed ? { position: "absolute", inset: 0 } : undefined} />
    </div>
  );
}
