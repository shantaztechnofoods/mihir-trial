import React, { useEffect, useRef } from "react";
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, MeshStandardMaterial, MeshPhysicalMaterial, MeshBasicMaterial,
  AmbientLight, DirectionalLight, PointLight, PMREMGenerator, SRGBColorSpace, ACESFilmicToneMapping, BufferGeometry,
  Float32BufferAttribute, Points, PointsMaterial, AdditiveBlending, GridHelper, Fog, Vector3,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { MeshSurfaceSampler } from "three/examples/jsm/math/MeshSurfaceSampler.js";
// Helvetiker Bold (MgOpen licence, shipped with three.js), cut down to the six
// glyphs of the wordmark so the chunk stays small.
import fontJson from "../assets/shantaz-wordmark.typeface.json";

// Login brand moment (2026-11-04, owner's direction). The SHANTAZ letters
// assemble from warm sparks into solid extruded letters — brand red faces,
// brushed-steel sides — a light sweeps across them, then the tagline appears
// letter by letter. Idle: no spinning; a slow tilt towards the cursor / phone
// tilt (max ~6°), a light sweep every ~8 s, a faint reflection on a dark floor.
// Lazy chunk, decorative only (aria-hidden). Pauses when the tab is hidden and
// frees every GPU resource on unmount. onFail() → LoginPage shows the 2D logo.
const TAGLINE = "INNOVATION FOR LIFE";

export default function LoginBrand3D({ onFail }) {
  const hostRef = useRef(null);
  const tagRef = useRef(null);
  useEffect(() => {
    const host = hostRef.current; if (!host) return undefined;
    let renderer;
    try { renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" }); }
    catch { onFail && onFail(); return undefined; }
    const small = window.innerWidth < 768;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.6 : 1.75));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);

    const disposables = [];
    const keep = (o) => { disposables.push(o); return o; };
    const scene = new Scene();
    scene.fog = new Fog(0x0c1628, 10, 22);
    const pmrem = new PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;
    const camera = new PerspectiveCamera(30, 1, 0.1, 100);

    // ── the wordmark ──
    const font = new FontLoader().parse(fontJson);
    const geo = keep(new TextGeometry("SHANTAZ", { font, size: 1, depth: 0.24, curveSegments: 8, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.018, bevelSegments: 4 }));
    geo.computeBoundingBox(); geo.center();
    const bb = geo.boundingBox; const textW = bb.max.x - bb.min.x; const textH = bb.max.y - bb.min.y;
    const face = keep(new MeshPhysicalMaterial({ color: 0xc8121f, metalness: 0.15, roughness: 0.38, clearcoat: 0.8, clearcoatRoughness: 0.2, transparent: true, opacity: 0 }));
    const side = keep(new MeshStandardMaterial({ color: 0x7f8898, metalness: 1, roughness: 0.3, envMapIntensity: 1.1, transparent: true, opacity: 0 }));
    const word = new Mesh(geo, [face, side]);
    const rig = new Group(); rig.add(word); scene.add(rig);

    // faint reflection: the same letters mirrored under a dark, fading floor
    const faceR = keep(new MeshBasicMaterial({ color: 0x8a1016, transparent: true, opacity: 0 }));
    const sideR = keep(new MeshBasicMaterial({ color: 0x5b6577, transparent: true, opacity: 0 }));
    const mirror = new Mesh(geo, [faceR, sideR]);
    const floorY = bb.min.y - 0.06;
    mirror.scale.y = -1; mirror.position.y = 2 * floorY; rig.add(mirror);
    // (the reflection fades out through a CSS mask on the canvas — see .lg-3d)
    const grid = new GridHelper(18, 36, 0x4b5d80, 0x26334b);
    grid.material.transparent = true; grid.material.opacity = 0.1; grid.position.y = floorY - 0.002;
    keep(grid.geometry); keep(grid.material); rig.add(grid);

    // ── lights: cool key, warm amber rim, a moving sweep light ──
    scene.add(new AmbientLight(0xa8b8d8, 0.35));
    const key = new DirectionalLight(0xe6eeff, 1.6); key.position.set(-3, 4, 6); scene.add(key);
    const rim = new DirectionalLight(0xffa35a, 1.8); rim.position.set(4, 2.5, -4); scene.add(rim);
    const sweep = new PointLight(0xfff1dc, 0, 7, 1.2); sweep.position.set(-5, 0.6, 2.2); scene.add(sweep);

    // ── sparks that assemble into the letters ──
    const N = small ? 1500 : 2600;
    const sampler = new MeshSurfaceSampler(new Mesh(geo)).build();
    const target = new Float32Array(N * 3), start = new Float32Array(N * 3), pos = new Float32Array(N * 3), delay = new Float32Array(N);
    const v = new Vector3();
    for (let i = 0; i < N; i++) {
      sampler.sample(v);
      target[i * 3] = v.x; target[i * 3 + 1] = v.y; target[i * 3 + 2] = v.z;
      const a = Math.random() * Math.PI * 2, r = 2.5 + Math.random() * 4;
      start[i * 3] = v.x * 0.4 + Math.cos(a) * r; start[i * 3 + 1] = v.y + Math.sin(a) * r * 0.6; start[i * 3 + 2] = (Math.random() - 0.3) * 4;
      delay[i] = Math.random() * 0.35 + (v.x - bb.min.x) / textW * 0.2;   // left letters land first
    }
    pos.set(start);
    const pg = keep(new BufferGeometry()); pg.setAttribute("position", new Float32BufferAttribute(pos, 3));
    const pm = keep(new PointsMaterial({ color: 0xffb862, size: small ? 0.04 : 0.032, transparent: true, opacity: 1, depthWrite: false, blending: AdditiveBlending }));
    const sparks = new Points(pg, pm); rig.add(sparks);

    // ── camera fit: the word fills ~78% of the hero width ──
    const fit = () => {
      const w = host.clientWidth || 1, h = host.clientHeight || 1;
      renderer.setSize(w, h, false); camera.aspect = w / h;
      const tan = Math.tan((camera.fov * Math.PI) / 360);
      const dW = (textW / 0.78) / (2 * tan * camera.aspect), dH = (textH * 2.6) / (2 * tan);
      camera.position.set(0, 0.32, Math.max(dW, dH));
      camera.lookAt(0, -0.05, 0); camera.updateProjectionMatrix();
      // tagline sits just under the letters, wherever they land on screen
      const q = new Vector3(0, bb.min.y - 0.62, 0).project(camera);
      if (tagRef.current) tagRef.current.style.top = `${host.offsetTop + (1 - (q.y + 1) / 2) * h}px`;
    };
    const ro = new ResizeObserver(fit); ro.observe(host); fit();

    // ── input: cursor or phone tilt → gentle parallax (max ~6°) ──
    const aim = { x: 0, y: 0 }, cur = { x: 0, y: 0 };
    const onMove = (e) => { aim.x = e.clientX / window.innerWidth - 0.5; aim.y = e.clientY / window.innerHeight - 0.5; };
    const onTilt = (e) => { if (e.gamma == null) return; aim.x = Math.max(-0.5, Math.min(0.5, e.gamma / 60)); aim.y = Math.max(-0.5, Math.min(0.5, (e.beta - 40) / 80)); };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("deviceorientation", onTilt, { passive: true });

    const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
    let raf = 0, t0 = performance.now(), paused = 0, hiddenAt = 0, nextSweep = 1.15, sparksOn = true, taglineShown = false;
    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const t = (now - t0 - paused) / 1000;
      // assemble (0 → 1.25 s)
      if (sparksOn) {
        for (let i = 0; i < N; i++) {
          const k = ease((t - delay[i]) / 0.8);
          const swirl = (1 - k) * 0.6;
          pos[i * 3] = start[i * 3] + (target[i * 3] - start[i * 3]) * k + Math.sin(t * 3 + i) * swirl * 0.2;
          pos[i * 3 + 1] = start[i * 3 + 1] + (target[i * 3 + 1] - start[i * 3 + 1]) * k + Math.cos(t * 2.6 + i) * swirl * 0.2;
          pos[i * 3 + 2] = start[i * 3 + 2] + (target[i * 3 + 2] - start[i * 3 + 2]) * k;
        }
        pg.attributes.position.needsUpdate = true;
        pm.opacity = 1 - ease((t - 1.0) / 0.55);
        if (t > 1.6) { sparksOn = false; sparks.visible = false; }
      }
      const solid = ease((t - 0.85) / 0.45);
      face.opacity = side.opacity = solid;
      faceR.opacity = sideR.opacity = solid * 0.1;
      if (solid >= 1 && face.transparent) { face.transparent = side.transparent = false; face.needsUpdate = side.needsUpdate = true; }
      if (!taglineShown && t > 1.15 && tagRef.current) { taglineShown = true; tagRef.current.classList.add("is-on"); }
      // light sweep: first at ~1.15 s, then every ~8 s
      const st = t - nextSweep;
      if (st >= 0 && st <= 1.2) {
        const k = st / 1.2;
        sweep.position.x = -textW * 0.9 + k * textW * 1.8;
        sweep.intensity = Math.sin(k * Math.PI) * 9;
      } else if (st > 1.2) { sweep.intensity = 0; nextSweep += 8; }
      // idle parallax
      cur.x += (aim.x - cur.x) * 0.05; cur.y += (aim.y - cur.y) * 0.05;
      rig.rotation.y = cur.x * 0.2; rig.rotation.x = cur.y * 0.1;
      renderer.render(scene, camera);
    };
    const start_ = () => { if (!raf) raf = requestAnimationFrame(frame); };
    const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };
    const onVis = () => {
      if (document.hidden) { hiddenAt = performance.now(); stop(); }
      else { if (hiddenAt) paused += performance.now() - hiddenAt; hiddenAt = 0; start_(); }
    };
    document.addEventListener("visibilitychange", onVis);
    start_();

    return () => {
      stop(); ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("deviceorientation", onTilt);
      document.removeEventListener("visibilitychange", onVis);
      disposables.forEach((d) => d && d.dispose && d.dispose());
      envRT.dispose(); pmrem.dispose(); renderer.dispose();
      try { host.removeChild(renderer.domElement); } catch { /* gone */ }
    };
  }, [onFail]);
  return (
    <div className="lg-brand3d" aria-hidden="true">
      <div ref={hostRef} className="lg-3d" />
      <div ref={tagRef} className="lg-tagline">
        {TAGLINE.split("").map((c, i) => <span key={i} style={{ transitionDelay: `${i * 35}ms` }}>{c === " " ? " " : c}</span>)}
      </div>
    </div>
  );
}
