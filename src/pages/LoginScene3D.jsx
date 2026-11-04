import React, { useEffect, useRef } from "react";
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, BoxGeometry, CylinderGeometry, TorusGeometry,
  PlaneGeometry, MeshStandardMaterial, MeshBasicMaterial, AmbientLight, DirectionalLight, PointLight,
  PMREMGenerator, SRGBColorSpace, ACESFilmicToneMapping, CanvasTexture, BufferGeometry, Float32BufferAttribute,
  Points, PointsMaterial, AdditiveBlending, GridHelper, Color, Fog,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

// Login 3D scene (2026-11-04, world UI). A steel production rack with three of
// the machines the factory builds — kneader, roti maker (two hot tawas), roaster —
// lit by a cool key light and a warm amber glow from the tawas, heat rising.
// Loaded lazily by LoginPage after the form is usable; decorative only.
// Pauses when the tab is hidden, stops and frees the GPU when unmounted.
// If WebGL is unavailable it calls onFail() and LoginPage shows the CSS rack.

export default function LoginScene3D({ onFail }) {
  const hostRef = useRef(null);
  useEffect(() => {
    const host = hostRef.current; if (!host) return undefined;
    let renderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    } catch { onFail && onFail(); return undefined; }
    const small = window.innerWidth < 768;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 1.75));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = small ? 1.2 : 1.1;
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);

    const scene = new Scene();
    const pmrem = new PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;

    const camera = new PerspectiveCamera(30, 1, 0.1, 100);
    const camBase = { x: 0, y: 2.3, z: small ? 11.2 : 10.6 };
    scene.fog = new Fog(0x0d1729, 9, 19);
    camera.position.set(camBase.x, camBase.y, camBase.z);

    // ── materials ──
    const steel   = new MeshStandardMaterial({ color: 0x8a95a8, metalness: 0.9, roughness: 0.28 });
    const shelfM  = new MeshStandardMaterial({ color: 0x5d6879, metalness: 0.85, roughness: 0.38 });
    const body    = new MeshStandardMaterial({ color: 0x27303f, metalness: 0.55, roughness: 0.5 });
    const bodyLt  = new MeshStandardMaterial({ color: 0x3a4659, metalness: 0.6, roughness: 0.42 });
    const brushed = new MeshStandardMaterial({ color: 0xd6dce5, metalness: 1, roughness: 0.22 });
    const hot     = new MeshStandardMaterial({ color: 0x1c1410, emissive: new Color(0xff6a10), emissiveIntensity: 0.9, metalness: 0.5, roughness: 0.45 });
    const led     = new MeshBasicMaterial({ color: 0x4ade80 });
    const ledAmb  = new MeshBasicMaterial({ color: 0xf5b14a });
    const screenM = new MeshBasicMaterial({ color: 0x2b4fd6 });
    const disposables = [steel, shelfM, body, bodyLt, brushed, hot, led, ledAmb, screenM];
    const geo = (g) => { disposables.push(g); return g; };
    const mesh = (g, m, x = 0, y = 0, z = 0) => { const o = new Mesh(geo(g), m); o.position.set(x, y, z); return o; };

    // ── rack ──
    const rig = new Group();
    const RW = 2.6, RH = 2.8, RD = 1.2, PT = 0.07;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) rig.add(mesh(new BoxGeometry(PT, RH, PT), steel, sx * (RW / 2 - PT / 2), 0, sz * (RD / 2 - PT / 2)));
    const shelfY = [-1.33, -0.42, 0.48, 1.36];
    for (const y of shelfY) {
      rig.add(mesh(new BoxGeometry(RW, 0.05, RD), shelfM, 0, y, 0));
      rig.add(mesh(new BoxGeometry(RW, 0.09, 0.03), steel, 0, y - 0.02, RD / 2));   // front lip
    }

    // Kneader (lower-middle shelf, left): body + horizontal drum + motor
    const kneader = new Group();
    kneader.add(mesh(new BoxGeometry(0.95, 0.3, 0.78), body, 0, 0.15, 0));
    const drum = mesh(new CylinderGeometry(0.27, 0.27, 0.7, 40, 1, false), brushed, 0, 0.55, 0); drum.rotation.z = Math.PI / 2; kneader.add(drum);
    kneader.add(mesh(new BoxGeometry(0.22, 0.2, 0.22), bodyLt, 0.48, 0.42, 0));
    kneader.add(mesh(new BoxGeometry(0.05, 0.05, 0.02), led, -0.3, 0.2, 0.4));
    kneader.position.set(-0.62, -0.42 + 0.025, 0.02); rig.add(kneader);

    // Roti maker (lower-middle shelf, right): long body + two hot tawas
    const roti = new Group();
    roti.add(mesh(new BoxGeometry(1.05, 0.34, 0.8), body, 0, 0.17, 0));
    roti.add(mesh(new BoxGeometry(1.05, 0.05, 0.8), bodyLt, 0, 0.36, 0));
    const tawas = [];
    for (const tx of [-0.25, 0.25]) { const t = mesh(new CylinderGeometry(0.19, 0.19, 0.035, 48), hot, tx, 0.4, 0); roti.add(t); tawas.push(t); }
    roti.add(mesh(new BoxGeometry(0.2, 0.12, 0.02), bodyLt, 0.38, 0.2, 0.41));
    roti.add(mesh(new BoxGeometry(0.035, 0.035, 0.02), ledAmb, 0.33, 0.2, 0.425));
    roti.position.set(0.6, -0.42 + 0.025, 0.02); rig.add(roti);

    // Roaster (top-middle shelf): cabinet + round door with glowing window
    const roaster = new Group();
    roaster.add(mesh(new BoxGeometry(0.95, 0.6, 0.78), body, 0, 0.3, 0));
    const ring = mesh(new TorusGeometry(0.2, 0.035, 16, 48), brushed, -0.12, 0.31, 0.4); roaster.add(ring);
    { const win = mesh(new CylinderGeometry(0.18, 0.18, 0.02, 40), hot, -0.12, 0.31, 0.395); win.rotation.x = Math.PI / 2; roaster.add(win); }
    roaster.add(mesh(new BoxGeometry(0.2, 0.36, 0.02), bodyLt, 0.27, 0.31, 0.395));
    roaster.add(mesh(new BoxGeometry(0.04, 0.04, 0.02), led, 0.27, 0.43, 0.41));
    roaster.position.set(-0.5, 0.48 + 0.025, 0); rig.add(roaster);
    // control panel (PLC / HMI) beside the roaster
    const plc = new Group();
    plc.add(mesh(new BoxGeometry(0.62, 0.5, 0.3), bodyLt, 0, 0.25, 0));
    plc.add(mesh(new BoxGeometry(0.42, 0.24, 0.02), screenM, 0, 0.3, 0.16));
    plc.add(mesh(new BoxGeometry(0.04, 0.04, 0.02), led, 0.22, 0.1, 0.16));
    plc.position.set(0.66, 0.48 + 0.025, 0.1); rig.add(plc);

    // Parts crates on the bottom shelf
    for (const [x, w] of [[-0.75, 0.7], [0.15, 0.85], [0.92, 0.5]]) rig.add(mesh(new BoxGeometry(w, 0.36, 0.8), bodyLt, x, -1.33 + 0.205, 0));
    rig.position.y = 0.2;
    scene.add(rig);

    // ── floor: faint engineering grid + soft contact shadow ──
    const grid = new GridHelper(14, 28, 0x6c7d99, 0x34435c);
    grid.material.transparent = true; grid.material.opacity = 0.16; grid.position.y = -1.42;
    disposables.push(grid.geometry, grid.material); scene.add(grid);
    const sc = document.createElement("canvas"); sc.width = sc.height = 128;
    const sctx = sc.getContext("2d"); const gr = sctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, "rgba(0,0,0,0.55)"); gr.addColorStop(1, "rgba(0,0,0,0)"); sctx.fillStyle = gr; sctx.fillRect(0, 0, 128, 128);
    const shTex = new CanvasTexture(sc); disposables.push(shTex);
    const shM = new MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false }); disposables.push(shM);
    const shadow = mesh(new PlaneGeometry(4.4, 2.6), shM, 0, -1.41, 0); shadow.rotation.x = -Math.PI / 2; scene.add(shadow);

    // ── lights: cool key, cool rim, warm tawa glow ──
    scene.add(new AmbientLight(0x9fb2d6, 0.25));
    const key = new DirectionalLight(0xe2ebff, 1.5); key.position.set(-4, 5, 5); scene.add(key);
    const rim = new DirectionalLight(0x6f93ff, 0.9); rim.position.set(4, 2, -5); scene.add(rim);
    const glow = new PointLight(0xffa24a, 6, 4.5, 1.6); glow.position.set(0.6, 0.2, 0.9); scene.add(glow);

    // ── heat rising from the tawas ──
    const N = small ? 60 : 110;
    const pos = new Float32Array(N * 3); const spd = new Float32Array(N);
    const reset = (i, anyY) => {
      const tx = (Math.random() < 0.5 ? -0.25 : 0.25) + 0.6 + (Math.random() - 0.5) * 0.3;
      pos[i * 3] = tx; pos[i * 3 + 1] = anyY ? -0.0 + Math.random() * 0.8 : 0.0; pos[i * 3 + 2] = 0.02 + (Math.random() - 0.5) * 0.3;
      spd[i] = 0.12 + Math.random() * 0.22;
    };
    for (let i = 0; i < N; i++) reset(i, true);
    const pg = geo(new BufferGeometry()); pg.setAttribute("position", new Float32BufferAttribute(pos, 3));
    const pm = new PointsMaterial({ color: 0xffb862, size: small ? 0.035 : 0.03, transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false });
    disposables.push(pm);
    const heat = new Points(pg, pm); rig.add(heat);

    // ── loop ──
    const pointer = { x: 0, y: 0 }, eased = { x: 0, y: 0 };
    const onMove = (e) => { pointer.x = e.clientX / window.innerWidth - 0.5; pointer.y = e.clientY / window.innerHeight - 0.5; };
    window.addEventListener("pointermove", onMove, { passive: true });
    const resize = () => {
      const w = host.clientWidth || 1, h = host.clientHeight || 1;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize); ro.observe(host); resize();

    let raf = 0, last = performance.now(); const t0 = last;
    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const t = (now - t0) / 1000;
      const intro = Math.min(1, t / 0.9); const ease = 1 - Math.pow(1 - intro, 3);   // 900ms entrance
      rig.rotation.y = -0.55 + Math.sin(t * 0.16) * 0.42 + (1 - ease) * 0.6;
      rig.position.y = 0.2 - (1 - ease) * 0.5;
      eased.x += (pointer.x - eased.x) * 0.04; eased.y += (pointer.y - eased.y) * 0.04;
      camera.position.set(camBase.x + eased.x * 0.9, camBase.y - eased.y * 0.5, camBase.z);
      camera.lookAt(small ? 0 : -0.2, small ? 0.05 : 0.35, 0);
      const flick = 1.25 + Math.sin(t * 2.1) * 0.12 + Math.sin(t * 5.3) * 0.05;
      hot.emissiveIntensity = flick; glow.intensity = 5 + flick * 1.4;
      for (let i = 0; i < N; i++) { pos[i * 3 + 1] += spd[i] * dt; pos[i * 3] += Math.sin(t * 1.3 + i) * 0.0009; if (pos[i * 3 + 1] > 1.0) reset(i, false); }
      pg.attributes.position.needsUpdate = true;
      renderer.render(scene, camera);
    };
    const start = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };
    const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVis);
    start();
    host.classList.add("is-live");

    return () => {
      stop(); ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVis);
      disposables.forEach((d) => d && d.dispose && d.dispose());
      envRT.dispose(); pmrem.dispose(); renderer.dispose();
      try { host.removeChild(renderer.domElement); } catch { /* already gone */ }
    };
  }, [onFail]);
  return <div ref={hostRef} className="lg-3d" aria-hidden="true" />;
}
