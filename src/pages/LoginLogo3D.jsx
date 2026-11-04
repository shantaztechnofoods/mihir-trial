import React, { useEffect, useRef } from "react";
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, MeshPhysicalMaterial, Shape, Path, ExtrudeGeometry,
  AmbientLight, DirectionalLight, PointLight, SpotLight, PMREMGenerator, SRGBColorSpace, ACESFilmicToneMapping, Color,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
// The real SHANTAZ logo, vectorised layer by layer from the owner's artwork
// (gear, wheat, SHANTAZ letters, ®, INNOVATION FOR LIFE) — not a redraw.
import LOGO from "../assets/brand/shantaz-logo-shapes.json";

// Login brand moment (2026-11-04). ~2.2 s intro, then calm:
//   gear rolls in and turns ~120° into place (gunmetal, teeth catch the light)
//   → wheat grows up out of the gear, leaf by leaf (green with a soft sheen)
//   → SHANTAZ letters assemble left to right in candy-red enamel, a light
//     sweeps across them, ® pops in → INNOVATION FOR LIFE tracks in.
// Idle: no spinning — a slow tilt towards the cursor / phone tilt (≤ 6°) and a
// light sweep every ~7 s. Rendering stops while nothing moves.
// Lazy chunk, decorative (aria-hidden); same for every user. Pauses when the
// tab is hidden and releases every GPU resource (and the context) on unmount.

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3);
const easeBack = (x) => { const c = 1.4, t = clamp01(x) - 1; return 1 + (c + 1) * t * t * t + c * t * t; };

export default function LoginLogo3D({ onFail, onReady }) {
  const hostRef = useRef(null);
  useEffect(() => {
    const host = hostRef.current; if (!host) return undefined;
    let renderer;
    try { renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" }); }
    catch { onFail && onFail(); return undefined; }
    const small = window.innerWidth < 768;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.75 : 2));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);

    const disposables = [];
    const keep = (o) => { disposables.push(o); return o; };
    const scene = new Scene();
    const pmrem = new PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;
    const camera = new PerspectiveCamera(28, 1, 0.1, 100);

    // ── geometry from the traced artwork (logo px, y down → world, y up) ──
    const [bx, by, bw, bh] = LOGO.bbox;
    const U = 0.02;                                   // world units per logo px
    const cx = bx + bw / 2, cy = by + bh / 2;
    const toV = ([x, y]) => [(x - cx) * U, -(y - cy) * U];
    const shapeOf = (piece, ox = 0, oy = 0) => {
      const s = new Shape(piece.outer.map((p) => { const [x, y] = toV(p); return { x: x - ox, y: y - oy }; }));
      piece.holes.forEach((h) => s.holes.push(new Path(h.map((p) => { const [x, y] = toV(p); return { x: x - ox, y: y - oy }; }))));
      return s;
    };
    const extrude = (shape, depth, bevel) => keep(new ExtrudeGeometry(shape, {
      depth, steps: 1, curveSegments: 4, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2,
    }));
    const mat = (o) => keep(new MeshPhysicalMaterial({ transparent: true, opacity: 0, ...o }));

    const logo = new Group(); scene.add(logo);
    const tilt = new Group(); tilt.add(logo); scene.add(tilt);

    // Gear: pivot on its own centre so it can roll in
    const [gcx, gcy] = toV(LOGO.gearCenter);
    const gearM = mat({ color: new Color(0x2b2f36), metalness: 1, roughness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.3 });
    const gear = new Group(); gear.position.set(gcx, gcy, 0); logo.add(gear);
    LOGO.gear.forEach((p) => gear.add(new Mesh(extrude(shapeOf(p, gcx, gcy), 0.16, 0.02), gearM)));

    // Wheat: every leaf / stalk grows from its own base
    const wheat = LOGO.wheat.map((p, i) => {
      const [x0] = toV([p.box[0] + p.box[2] / 2, 0]); const [, yb] = toV([0, p.box[1] + p.box[3]]);
      const m = mat({ color: new Color(0x2e8a22), metalness: 0.15, roughness: 0.42, sheen: 1, sheenColor: new Color(0xb6f59a), sheenRoughness: 0.4, clearcoat: 0.3 });
      const g = new Group(); g.position.set(x0, yb, 0.03);
      g.add(new Mesh(extrude(shapeOf(p, x0, yb), 0.05, 0.008), m));
      logo.add(g);
      return { g, m, order: i, size: p.box[2] * p.box[3] };
    }).sort((a, b) => b.size - a.size).map((w, i) => ({ ...w, delay: i * 0.05 }));

    // SHANTAZ: one mesh per letter, pivot at its centre
    const red = { color: new Color(0xd30016), metalness: 0.5, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.06 };
    const letters = LOGO.letters.map((p, i) => {
      const [lx, ly] = toV([p.box[0] + p.box[2] / 2, p.box[1] + p.box[3] / 2]);
      const m = mat(red); const g = new Group(); g.position.set(lx, ly, 0);
      g.add(new Mesh(extrude(shapeOf(p, lx, ly), 0.22, 0.03), m)); logo.add(g);
      return { g, m, i, home: g.position.clone() };
    });
    const silver = { color: new Color(0xc9d0da), metalness: 1, roughness: 0.28 };
    const reg = LOGO.reg.map((p) => {
      const [rx, ry] = toV([p.box[0] + p.box[2] / 2, p.box[1] + p.box[3] / 2]);
      const m = mat(silver); const g = new Group(); g.position.set(rx, ry, 0);
      g.add(new Mesh(extrude(shapeOf(p, rx, ry), 0.03, 0), m)); logo.add(g);
      return { g, m };
    });
    const tag = LOGO.tagline.map((p, i) => {
      const [tx, ty] = toV([p.box[0] + p.box[2] / 2, p.box[1] + p.box[3] / 2]);
      const m = mat(silver); const g = new Group(); g.position.set(tx, ty, 0);
      g.add(new Mesh(extrude(shapeOf(p, tx, ty), 0.03, 0), m)); logo.add(g);
      return { g, m, i, home: g.position.clone() };
    });
    const tagMidX = tag.reduce((s, t) => s + t.home.x, 0) / Math.max(1, tag.length);

    // ── studio light: cool key, warm rim, a sweep that slides across ──
    scene.add(new AmbientLight(0xb8c6e0, 0.35));
    const key = new DirectionalLight(0xffffff, 1.6); key.position.set(-3, 4, 6); scene.add(key);
    const rim = new DirectionalLight(0xffb070, 1.4); rim.position.set(5, 2, -4); scene.add(rim);
    const fill = new DirectionalLight(0x7fa0ff, 0.5); fill.position.set(0, -3, 4); scene.add(fill);
    const sweep = new PointLight(0xffffff, 0, 5, 1.4); sweep.position.set(-5, 0.4, 1.6); scene.add(sweep);
    const spot = new SpotLight(0xffffff, 0, 12, 0.5, 0.6, 1); spot.position.set(0, 4, 5); spot.target = logo; scene.add(spot);

    // ── camera fit: logo ≤ 86% of the hero width, ≤ 560 px on a laptop ──
    const LW = bw * U, LH = bh * U;
    const fit = () => {
      const w = host.clientWidth || 1, h = host.clientHeight || 1;
      renderer.setSize(w, h, false); camera.aspect = w / h;
      const tan = Math.tan((camera.fov * Math.PI) / 360);
      const frac = Math.min(0.86, 560 / w);
      const d = Math.max((LW / frac) / (2 * tan * camera.aspect), (LH * 1.5) / (2 * tan));
      camera.position.set(0, 0.15, d); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(fit); ro.observe(host); fit();

    // ── input → gentle parallax (max ~6°) ──
    const aim = { x: 0, y: 0 }, cur = { x: 0, y: 0 };
    let lastInput = performance.now();
    const onMove = (e) => { aim.x = e.clientX / window.innerWidth - 0.5; aim.y = e.clientY / window.innerHeight - 0.5; lastInput = performance.now(); start(); };
    const onTilt = (e) => {
      if (e.gamma == null) return;
      const x = Math.max(-0.5, Math.min(0.5, e.gamma / 60)), y = Math.max(-0.5, Math.min(0.5, (e.beta - 40) / 80));
      if (Math.abs(x - aim.x) + Math.abs(y - aim.y) > 0.03) { aim.x = x; aim.y = y; lastInput = performance.now(); start(); }
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("deviceorientation", onTilt, { passive: true });

    const solid = (m, k) => {
      m.opacity = k;
      if (k >= 1 && m.transparent) { m.transparent = false; m.needsUpdate = true; }
    };
    let raf = 0, idleTimer = 0, t0 = 0, hiddenAt = 0, paused = 0, nextSweep = 1.75, readySent = false;
    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      if (!t0) t0 = now;
      const t = (now - t0 - paused) / 1000;
      // 1. gear rolls in (0 → 1.0 s), turning 120° into place
      const ge = easeBack(t / 1.0);
      gear.rotation.z = (1 - ge) * (2.1);
      gear.position.x = gcx - (1 - ge) * 2.1 * (LOGO.gearCenter[2] * U);
      solid(gearM, easeOut(t / 0.35));
      // 2. wheat grows out of the gear (0.55 → ~1.6 s)
      wheat.forEach((w) => {
        const k = easeOut((t - 0.55 - w.delay) / 0.55);
        w.g.scale.set(0.55 + 0.45 * k, Math.max(0.001, k), 1);
        solid(w.m, clamp01(k * 1.6));
      });
      // 3. SHANTAZ assembles left → right (0.8 → 1.75 s)
      letters.forEach((l) => {
        const k = easeOut((t - 0.8 - l.i * 0.08) / 0.5);
        l.g.position.set(l.home.x - (1 - k) * 0.9, l.home.y, (1 - k) * 0.8);
        l.g.rotation.y = -(1 - k) * 0.9;
        solid(l.m, clamp01(k * 1.4));
      });
      // 4. ® pops (1.55 s)
      reg.forEach((r) => { const k = easeBack((t - 1.55) / 0.35); r.g.scale.setScalar(Math.max(0.001, k)); solid(r.m, clamp01((t - 1.55) / 0.15)); });
      // 5. tagline tracks in (1.55 → 2.2 s)
      tag.forEach((tg) => {
        const k = easeOut((t - 1.55 - Math.abs(tg.home.x - tagMidX) * 0.05) / 0.55);
        tg.g.position.x = tagMidX + (tg.home.x - tagMidX) * (1 + (1 - k) * 0.45);
        solid(tg.m, k);
      });
      // light sweep across the letters: first at ~1.75 s, then every ~7 s
      const st = t - nextSweep;
      if (st >= 0 && st <= 1.1) {
        const k = st / 1.1;
        sweep.position.x = -LW * 0.55 + k * LW * 1.1;
        sweep.intensity = Math.sin(k * Math.PI) * 14;
        spot.intensity = Math.sin(k * Math.PI) * 6;
      } else if (st > 1.1) { sweep.intensity = 0; spot.intensity = 0; nextSweep += 7; }
      // idle parallax tilt
      cur.x += (aim.x - cur.x) * 0.06; cur.y += (aim.y - cur.y) * 0.06;
      tilt.rotation.y = cur.x * 0.2; tilt.rotation.x = cur.y * 0.1;
      renderer.render(scene, camera);
      if (!readySent && t > 2.2) { readySent = true; onReady && onReady(); }
      // battery: after the intro, stop drawing while nothing moves
      if (t > 2.6 && sweep.intensity === 0 && now - lastInput > 2500 && Math.abs(aim.x - cur.x) + Math.abs(aim.y - cur.y) < 0.002) {
        stop(); idleTimer = setTimeout(() => { idleTimer = 0; start(); }, Math.max(200, (nextSweep - t) * 1000));
      }
    };
    function start() { if (idleTimer) { clearTimeout(idleTimer); idleTimer = 0; } if (!raf && !document.hidden) raf = requestAnimationFrame(frame); }
    function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
    const onVis = () => {
      if (document.hidden) { hiddenAt = performance.now(); stop(); }
      else { if (hiddenAt) paused += performance.now() - hiddenAt; hiddenAt = 0; start(); }
    };
    document.addEventListener("visibilitychange", onVis);
    start();

    return () => {
      stop(); if (idleTimer) clearTimeout(idleTimer); ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("deviceorientation", onTilt);
      document.removeEventListener("visibilitychange", onVis);
      disposables.forEach((d) => d && d.dispose && d.dispose());
      envRT.dispose(); pmrem.dispose(); renderer.dispose(); renderer.forceContextLoss();
      try { host.removeChild(renderer.domElement); } catch { /* gone */ }
    };
  }, [onFail, onReady]);
  return <div className="lg-brand3d" aria-hidden="true"><div ref={hostRef} className="lg-3d" /></div>;
}

