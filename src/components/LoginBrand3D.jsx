import React, { useEffect, useRef } from "react";
import {
  WebGLRenderer, WebGLRenderTarget, Scene, PerspectiveCamera, OrthographicCamera, Group, Mesh, Shape, Path,
  ExtrudeGeometry, PlaneGeometry, BoxGeometry, MeshPhysicalMaterial, MeshStandardMaterial, MeshBasicMaterial,
  ShaderMaterial, AmbientLight, DirectionalLight, PointLight, PMREMGenerator, SRGBColorSpace,
  ACESFilmicToneMapping, BackSide, Vector2, Vector3, Color,
} from "three";
import { Font } from "three/examples/jsm/loaders/FontLoader.js";
import { shantazLogo } from "./shantazLogoGeometry.js";

export { default as ShantazLogoSVG } from "./ShantazLogoSVG.jsx";

// Login hero (2026-11-04): the real SHANTAZ logo in 3D — gear, wheat,
// wordmark, ®, tagline — extruded from the same geometry as the 2D logo.
//
// Intro (~2.3 s): the gear rolls in from the left (~120°, mechanical settle)
// → wheat grows out of it, grains pop one by one → SHANTAZ assembles left to
// right under a bright light sweep → ® pops → tagline tracks in.
// Idle: no spin. Studio reflections, a slow tilt towards the pointer / phone
// tilt (max ~6°), a light sweep every ~7 s, a faint blurred floor reflection.
// Renders on demand only (intro, sweep, tilt settling), pauses when the tab
// is hidden, frees every GPU resource on unmount. Decorative (aria-hidden);
// onFail() → LoginPage shows the 2D SVG logo.
const U = 0.01;              // SVG unit → scene unit
const INTRO_END = 2.4;
const SWEEP_EVERY = 7;
const SWEEP_LEN = 1.1;
const TILT = (6 * Math.PI) / 180;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const outCubic = (x) => 1 - Math.pow(1 - clamp01(x), 3);
const outBack = (x, s = 1.6) => { const k = clamp01(x) - 1; return 1 + (s + 1) * k * k * k + s * k * k; };
const span = (t, a, d) => clamp01((t - a) / d);

export default function LoginBrand3D({ onFail }) {
  const hostRef = useRef(null);
  useEffect(() => {
    const host = hostRef.current; if (!host) return undefined;
    let renderer;
    try { renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" }); }
    catch { onFail && onFail(); return undefined; }
    renderer.setPixelRatio(Math.min(Math.max(window.devicePixelRatio || 1, 1), 1.75));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = false;
    host.appendChild(renderer.domElement);
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

    // ── materials ──
    const gearMat = new MeshPhysicalMaterial({ color: 0x353a43, metalness: 0.9, roughness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.25, anisotropy: 0.6, transparent: true, opacity: 0 });
    const wheatA = new MeshPhysicalMaterial({ color: 0x2f6b1f, metalness: 0.1, roughness: 0.42, sheen: 1, sheenColor: new Color(0x9fe07c), sheenRoughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.4 });
    const wheatB = wheatA.clone(); wheatB.color.set(0x3d8a2a);
    const redMat = new MeshPhysicalMaterial({ color: 0xe4002b, metalness: 0.6, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08 });
    const tagMat = new MeshStandardMaterial({ color: 0x8a93a3, metalness: 0.85, roughness: 0.4, transparent: true, opacity: 0 });

    // ── geometry from the shared logo definition ──
    const L = shantazLogo();
    const cx = L.box.x + L.box.w / 2, cy = L.box.y + L.box.h / 2;
    const X = (x) => (x - cx) * U, Y = (y) => -(y - cy) * U;
    const toShape = (outer, holes, [px, py]) => {
      const s = new Shape(outer.map(([x, y]) => new Vector2(X(x) - px, Y(y) - py)));
      (holes || []).forEach((h) => s.holes.push(new Path(h.map(([x, y]) => new Vector2(X(x) - px, Y(y) - py)))));
      return s;
    };
    const extrude = (shapes, depth, bevel, segs = 3) => {
      const g = new ExtrudeGeometry(shapes, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: segs, curveSegments: 6 });
      g.translate(0, 0, -depth / 2);
      return g;
    };

    const rig = new Group(); scene.add(rig);
    const logo = new Group(); rig.add(logo);

    // gear (pivot = gear centre, so it can roll)
    const gp = [X(L.gear.center[0]), Y(L.gear.center[1])];
    const gear = new Group(); gear.position.set(gp[0], gp[1], 0); logo.add(gear);
    gear.add(new Mesh(extrude([toShape(L.gear.outer, [], gp)], 0.22, 0.022), gearMat));
    gear.add(new Mesh(extrude([toShape(L.gear.ring, [], gp)], 0.16, 0.012), gearMat));

    // wheat (stalk pivot = its base; grain pivot = where it joins the stem)
    const stalks = [], grains = [];
    L.wheat.forEach((s, si) => {
      const bp = [X(s.base[0]), Y(s.base[1])];
      const grp = new Group(); grp.position.set(bp[0], bp[1], 0.02 + si * 0.012); grp.scale.set(0.001, 0.001, 1);
      grp.add(new Mesh(extrude([toShape(s.stem, [], bp)], 0.05, 0.01, 2), wheatA));
      s.grains.forEach((g, k) => {
        const ap = [X(g.at[0]), Y(g.at[1])];
        const m = new Mesh(extrude([toShape(g.pts, [], ap)], 0.06, 0.02, 3), g.tone ? wheatB : wheatA);
        m.position.set(ap[0] - bp[0], ap[1] - bp[1], 0); m.scale.setScalar(0.001);
        grp.add(m); grains.push({ m, si, k });
      });
      logo.add(grp); stalks.push(grp);
    });
    // pop order: bottom to top, stalks interleaved
    grains.sort((a, b) => (a.k >> 1) - (b.k >> 1) || a.si - b.si || a.k - b.k);

    // wordmark (pivot = letter bottom centre)
    const letters = L.word.map((l) => {
      const p = [X(l.x + l.w / 2), Y(150)];
      const mat = redMat.clone(); mat.transparent = true; mat.opacity = 0;
      const m = new Mesh(extrude([toShape(l.outer, l.holes, p)], 0.26, 0.03), mat);
      m.position.set(p[0], p[1], 0); logo.add(m);
      return { m, mat, x: p[0] };
    });
    const wordL = letters[0].x - 0.35, wordR = letters[letters.length - 1].x + 0.35, wordY = Y(105);

    // ®
    const rc = [X(L.reg[0].outer[0][0] - 8.6), Y(L.reg[0].outer[0][1])];
    const reg = new Mesh(extrude(L.reg.map((r) => toShape(r.outer, r.holes, rc)), 0.07, 0.008, 2), redMat);
    reg.position.set(rc[0], rc[1], 0.02); reg.scale.setScalar(0.001); logo.add(reg);

    // tagline (Droid Serif subset), one mesh per letter so it can track in
    const font = new Font(L.tag.font);
    const tagMid = X((L.tag.x0 + L.tag.x1) / 2);
    const tag = L.tag.glyphs.map((g, i) => {
      const geo = extrude(font.generateShapes(g.ch, L.tag.size * U), 0.025, 0, 1);
      const mat = tagMat.clone();
      const m = new Mesh(geo, mat); m.position.set(X(g.x), Y(g.y), 0); logo.add(m);
      return { m, mat, x: X(g.x), i };
    });
    const floorY = Y(L.tag.baseline) - 0.12;

    // ── lights ──
    scene.add(new AmbientLight(0x9fb0d0, 0.25));
    const key = new DirectionalLight(0xeef3ff, 1.4); key.position.set(-3, 4, 6); scene.add(key);
    const rim = new DirectionalLight(0xffb26b, 1.3); rim.position.set(4, 2.5, -4); scene.add(rim);
    const sweep = new PointLight(0xfff4e6, 0, 0, 2); sweep.position.set(wordL, wordY + 0.2, 0.75); scene.add(sweep);

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
      const frac = camera.aspect < 1.5 ? 0.88 : 0.8;
      const d = Math.max(W / frac / (2 * tan * camera.aspect), (H * 1.75) / (2 * tan));
      camera.position.set(0, 0.25, d);
      camera.lookAt(0, -H * 0.2, 0);
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
    let nextSweep = 1.2;
    const clock = () => (performance.now() - t0 - paused) / 1000;

    const apply = (t) => {
      // 1. gear rolls in from the left, ~120°, mechanical settle
      const ge = outBack(span(t, 0, 0.8), 0.9);
      const roll = (120 * Math.PI) / 180;
      gear.position.x = gp[0] - roll * 0.82 * (1 - ge);
      gear.rotation.z = roll * (1 - ge);
      gearMat.opacity = outCubic(span(t, 0, 0.3));
      // 2. wheat grows up out of the gear, grains pop one by one
      stalks.forEach((s, i) => {
        const e = outCubic(span(t, 0.55 + i * 0.08, 0.5));
        s.scale.set(0.35 + 0.65 * e, Math.max(0.001, e), 1);
      });
      grains.forEach((g, i) => { const e = outBack(span(t, 0.78 + i * 0.022, 0.26), 2.2); g.m.scale.setScalar(Math.max(0.001, e)); });
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
        const k = st / SWEEP_LEN;
        sweep.position.x = wordL - 0.4 + k * (wordR - wordL + 0.8);
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
      logo.scale.y = -1; logo.position.y = 2 * floorY;
      renderer.setRenderTarget(reflRT); renderer.setClearColor(0x000000, 0); renderer.clear();
      renderer.render(scene, camera);
      logo.scale.y = 1; logo.position.y = 0;
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
    <div className="lg-brand3d" aria-hidden="true">
      <div ref={hostRef} className="lg-3d lg-3d--logo" />
    </div>
  );
}
