// SHANTAZ login hero — cinematic logo reveal (plain three.js, no React).
//
// Built from the EXACT CorelDRAW paths (svgText = src/assets/shantaz-logo.svg)
// with SVGLoader → ExtrudeGeometry, true colours (#E30016 red, the file's
// green gradient, black-chrome gear), studio environment light, deep navy
// background with a soft light pool. No floor mirror.
//
// Choreography (~3.3 s, then idle):
//   0.00  gear rolls in from the left (motion-blur trail), locks into its exact
//         brand pose with a small mechanical overshoot; a glint flashes on a tooth
//   0.85  wheat grows up out of the gear, stalk by stalk (a clip plane rises, so
//         nothing is squashed), grains settle as the growth passes them
//   1.55  SHANTAZ arrives letter by letter from the right (3D rotate-in, expo-out)
//   2.35  one bright light sweep across the wordmark
//   2.30  INNOVATION FOR LIFE: letter-by-letter soft rise + tracking tighten
//   3.05  ® pops
//   idle  wheat sways in a gentle wind (vertex shader), a specular light orbits
//         the chrome gear, a light sweep every 8 s ("shantaz:sweep"), dust in
//         the light pool, ±4° parallax (pointer / phone gyro). No gear spin.
// prefers-reduced-motion: static final pose. Weak GPU (< 40 fps after the
// intro) → onFail() (the page shows the 2D SVG logo). Returns dispose().
import {
  WebGLRenderer, Scene, PerspectiveCamera, OrthographicCamera, Group, Mesh, Points, Plane,
  ExtrudeGeometry, PlaneGeometry, BufferGeometry, MeshPhysicalMaterial, ShaderMaterial,
  DirectionalLight, PointLight, PMREMGenerator, SRGBColorSpace, ACESFilmicToneMapping, Vector2, Vector3, Color,
  Float32BufferAttribute, AdditiveBlending,
} from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { createIntroClock } from "./logoIntroClock.js";

const U = 0.02;                 // logo unit (0.5 mm of the CDR master) → scene unit
const INTRO_END = 3.4;
const SWEEP_AT = 2.35, SWEEP_EVERY = 8, SWEEP_LEN = 1.1;
const ORBIT = 7;                // seconds per orbit of the glint light around the gear
const TILT = (4 * Math.PI) / 180;
const GEAR_CENTRE = [64.98, 122.8];
const GEAR_R = 61 * U;          // tooth-tip radius in scene units (for rolling)
const WHEAT_LIGHT = "#4AAC26", WHEAT_DARK = "#1D5113";

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const span = (t, a, d) => clamp01((t - a) / d);
const outCubic = (x) => 1 - Math.pow(1 - clamp01(x), 3);
const outExpo = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp01(x)));
const outBack = (x, s = 1.6) => { const k = clamp01(x) - 1; return 1 + (s + 1) * k * k * k + s * k * k; };
// mechanical settle: fast approach, ~2% overshoot, damped
const settle = (x) => { x = clamp01(x); return x >= 1 ? 1 : 1 - Math.exp(-5.2 * x) * Math.cos(6.2 * x) * (1 - x); };

export function createLogoScene(host, { svgText, fullBleed = false, onFail } = {}) {
  const fail = () => { try { onFail && onFail(); } catch { /* ignore */ } };
  let renderer;
  try { renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" }); }
  catch { fail(); return () => {}; }
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  renderer.setPixelRatio(Math.min(Math.max(window.devicePixelRatio || 1, 1), 1.5));
  // production: skip per-program info-log checks (a driver may return a null log -> three throws mid-frame)
  renderer.debug.checkShaderErrors = false;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.8;
  renderer.localClippingEnabled = true;
  const cv = renderer.domElement;
  Object.assign(cv.style, { width: "100%", height: "100%", display: "block", opacity: "0", transition: "opacity 500ms ease" });
  host.appendChild(cv);
  const onLost = (e) => { e.preventDefault(); fail(); };
  cv.addEventListener("webglcontextlost", onLost);

  const scene = new Scene();
  const camera = new PerspectiveCamera(28, 1, 0.1, 100);
  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envRT = pmrem.fromScene(room, 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.9;
  room.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });

  // ── materials: the file's colours, studio finishes ──
  const gearMat = new MeshPhysicalMaterial({ color: 0x2b2e33, metalness: 1, roughness: 0.17, clearcoat: 1, clearcoatRoughness: 0.04, anisotropy: 0.4, anisotropyRotation: Math.PI / 2 }); // black chrome
  const wheatBase = new MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, metalness: 0, roughness: 0.5, sheen: 0.6, sheenRoughness: 0.45, sheenColor: new Color(0x6fbf4a), clearcoat: 0.15, clearcoatRoughness: 0.5, envMapIntensity: 0.35 }); // satin
  // true #E30016: hue from an emissive base (no tone-map shift), gloss from a light clearcoat
  const redMat = new MeshPhysicalMaterial({ color: 0x7a000c, emissive: 0xe30016, emissiveIntensity: 0.8, metalness: 0, roughness: 0.4, clearcoat: 0.35, clearcoatRoughness: 0.06, envMapIntensity: 0.08, toneMapped: false });
  const tagMat = new MeshPhysicalMaterial({ color: 0xc9d2e0, metalness: 0.9, roughness: 0.28, transparent: true, opacity: 0 }); // flat steel

  // ── geometry from the CDR paths ──
  const vb = svgText.match(/viewBox="([^"]+)"/)[1].trim().split(/\s+/).map(Number);
  const CX = vb[0] + vb[2] / 2, CY = vb[1] + vb[3] / 2;
  const toScene = (x, y) => [(x - CX) * U, -(y - CY) * U];
  const svgPaths = new SVGLoader().parse(svgText).paths;
  const part = (name) => svgPaths.filter((p) => p.userData.node.getAttribute("data-part") === name);
  const shapeBox = (shapes) => {
    const bx = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    shapes.forEach((s) => s.getPoints().forEach((q) => { bx.minX = Math.min(bx.minX, q.x); bx.maxX = Math.max(bx.maxX, q.x); bx.minY = Math.min(bx.minY, q.y); bx.maxY = Math.max(bx.maxY, q.y); }));
    return bx;
  };
  const extrude = (shapes, depth, bevel, pivot, segs = 3) => {
    const d = depth / U, bv = bevel / U;
    const g = new ExtrudeGeometry(shapes, { depth: d, bevelEnabled: bv > 0, bevelThickness: bv, bevelSize: bv * 0.8, bevelSegments: segs, curveSegments: 12 });
    g.translate(-CX, -CY, -d / 2);
    g.scale(U, -U, -U);                  // y up (z flipped too, keeps the winding)
    g.translate(-pivot[0], -pivot[1], 0);
    return g;
  };
  const glyphs = (path) => SVGLoader.createShapes(path).map((s) => ({ s, bb: shapeBox([s]) })).sort((a, c) => a.bb.minX - c.bb.minX);

  const rig = new Group(); scene.add(rig);
  const logo = new Group(); rig.add(logo);

  // gear + motion-blur trail (ghost copies that only show while it moves fast)
  const gp = toScene(...GEAR_CENTRE);
  const gearGeo = extrude(SVGLoader.createShapes(part("gear")[0]), 0.24, 0.045, gp, 4);
  const gear = new Mesh(gearGeo, gearMat); gear.position.set(gp[0], gp[1], 0); logo.add(gear);
  const ghosts = [1, 2, 3, 4].map((k) => {
    const m = new Mesh(gearGeo, new MeshPhysicalMaterial({ color: 0x3a3e45, metalness: 1, roughness: 0.3, transparent: true, opacity: 0, depthWrite: false }));
    m.position.copy(gear.position); m.visible = false; logo.add(m); return { m, k };
  });
  // glint (4-point star) on the upper-left tooth when the gear locks
  const glintMat = new ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending, toneMapped: false,
    uniforms: { uA: { value: 0 } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform float uA; varying vec2 vUv;
      void main(){ vec2 p = abs(vUv); float core = exp(-dot(vUv, vUv) * 40.0);
        float star = exp(-p.x * 60.0) * exp(-p.y * 3.0) + exp(-p.y * 60.0) * exp(-p.x * 3.0);
        float a = (core * 1.6 + star) * uA; gl_FragColor = vec4(vec3(1.0, 0.97, 0.92) * a * 2.2, a); }`,
  });
  const glint = new Mesh(new PlaneGeometry(1.1, 1.1), glintMat);
  const ga = (138 * Math.PI) / 180;
  glint.position.set(gp[0] + Math.cos(ga) * GEAR_R * 0.98, gp[1] + Math.sin(ga) * GEAR_R * 0.98, 0.2); glint.renderOrder = 10; logo.add(glint);

  // wheat: two stalks, each revealed by its own rising clip plane, swaying in a vertex-shader wind
  const C0 = new Color(WHEAT_LIGHT), C1 = new Color(WHEAT_DARK);
  const pieces = part("wheat").map((p) => {
    const shapes = SVGLoader.createShapes(p); const n = +p.userData.node.id.split("-")[1];
    return { p, shapes, bb: shapeBox(shapes), stalk: n >= 5 && n <= 22 ? 1 : 0, stem: p.userData.node.getAttribute("data-kind") === "stem" };
  });
  const wAll = pieces.reduce((a, w) => ({ minY: Math.min(a.minY, w.bb.minY), maxY: Math.max(a.maxY, w.bb.maxY) }), { minY: Infinity, maxY: -Infinity });
  const wheatBaseY = toScene(0, wAll.maxY)[1], wheatTopY = toScene(0, wAll.minY)[1];
  const wind = { uTime: { value: 0 }, uBaseY: { value: wheatBaseY } };
  const stalks = [0, 1].map((i) => {
    const plane = new Plane(new Vector3(0, -1, 0), wheatBaseY);   // keeps y < constant
    const mat = wheatBase.clone(); mat.clippingPlanes = [plane];
    const phase = i * 1.7;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = wind.uTime; sh.uniforms.uBaseY = wind.uBaseY; sh.uniforms.uPhase = { value: phase };
      sh.vertexShader = "uniform float uTime; uniform float uBaseY; uniform float uPhase;\n" + sh.vertexShader.replace("#include <project_vertex>", `
        vec4 wpos = modelMatrix * vec4(transformed, 1.0);
        float hh = max(0.0, wpos.y - uBaseY);
        float bend = hh * hh * 0.018;
        float gust = 0.65 + 0.35 * sin(uTime * 0.37 + uPhase);
        wpos.x += bend * gust * (sin(uTime * 1.15 + uPhase + wpos.y * 0.6) + 0.18 * sin(uTime * 2.9 + wpos.y * 4.0 + wpos.x * 3.0));
        wpos.z += bend * 0.35 * sin(uTime * 1.6 + uPhase + wpos.y);
        vec4 mvPosition = viewMatrix * wpos;
        gl_Position = projectionMatrix * mvPosition;`);
    };
    mat.customProgramCacheKey = () => "shantaz-wheat";
    return { plane, mat, grains: [] };
  });
  const wheat = new Group(); wheat.position.z = 0.14; logo.add(wheat);
  pieces.forEach(({ shapes, bb, stalk, stem }) => {
    const piv = toScene((bb.minX + bb.maxX) / 2, bb.maxY);
    const g = extrude(shapes, 0.05, 0.01, piv, 2);
    const pos = g.attributes.position, hgt = (bb.maxY - bb.minY) * U || 1, col = new Float32Array(pos.count * 3), c = new Color();
    for (let i = 0; i < pos.count; i++) { c.copy(C0).lerp(C1, clamp01(pos.getY(i) / hgt)); col.set([c.r, c.g, c.b], i * 3); }
    g.setAttribute("color", new Float32BufferAttribute(col, 3));
    const m = new Mesh(g, stalks[stalk].mat); m.position.set(piv[0], piv[1], 0); wheat.add(m);
    if (!stem) stalks[stalk].grains.push({ m, y: piv[1] });
  });

  // wordmark
  const letters = glyphs(part("wordmark")[0]).map(({ s, bb }) => {
    const p = toScene((bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2);
    const mat = redMat.clone(); mat.transparent = true; mat.opacity = 0;
    const m = new Mesh(extrude([s], 0.26, 0.024, p), mat); m.position.set(p[0], p[1], 0); logo.add(m);
    return { m, mat, x: p[0], y: p[1] };
  });
  const wordL = letters[0].x - 0.7, wordR = letters[letters.length - 1].x + 0.7, wordY = letters[1].y;

  const regShapes = SVGLoader.createShapes(part("registered")[0]); const rbb = shapeBox(regShapes);
  const rc = toScene((rbb.minX + rbb.maxX) / 2, (rbb.minY + rbb.maxY) / 2);
  const regMat = tagMat.clone(); regMat.transparent = false; regMat.opacity = 1;
  const reg = new Mesh(extrude(regShapes, 0.05, 0.006, rc, 2), regMat); reg.position.set(rc[0], rc[1], 0.02); logo.add(reg);

  let tagBottom = -Infinity;
  const tag = glyphs(part("tagline")[0]).map(({ s, bb }, i) => {
    const p = toScene((bb.minX + bb.maxX) / 2, bb.maxY); tagBottom = Math.max(tagBottom, bb.maxY);
    const mat = tagMat.clone();
    const m = new Mesh(extrude([s], 0.03, 0, p, 1), mat); m.position.set(p[0], p[1], 0); logo.add(m);
    return { m, mat, x: p[0], y: p[1], i };
  });
  const tagMid = tag.reduce((a, g) => a + g.x, 0) / tag.length;
  const floorY = toScene(0, tagBottom)[1] - 0.12;

  // ── lights (the environment does most of the work) ──
  const key = new DirectionalLight(0xffffff, 0.7); key.position.set(-3, 4, 6); scene.add(key);
  const coolRim = new DirectionalLight(0xbfd6ff, 3.0); coolRim.position.set(-5, 3, -1); scene.add(coolRim);
  const warmRim = new DirectionalLight(0xffc89a, 1.6); warmRim.position.set(5, 2, -3); scene.add(warmRim);
  const sweep = new PointLight(0xfff4e6, 0, 0, 2); sweep.position.set(wordL, wordY + 0.3, 0.8); scene.add(sweep);
  const orbit = new PointLight(0xdfeaff, 0, 3.2, 2); scene.add(orbit);

  // ── dust motes in the light pool ──
  const N = 60, dp = new Float32Array(N * 3), ds = new Float32Array(N);
  for (let i = 0; i < N; i++) { dp[i * 3] = gp[0] + (Math.random() - 0.3) * 6; dp[i * 3 + 1] = (Math.random() - 0.5) * 3.2; dp[i * 3 + 2] = (Math.random() - 0.5) * 2; ds[i] = Math.random(); }
  const dustGeo = new BufferGeometry(); dustGeo.setAttribute("position", new Float32BufferAttribute(dp, 3)); dustGeo.setAttribute("seed", new Float32BufferAttribute(ds, 1));
  const dustMat = new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPx: { value: 1 }, uFade: { value: 0 } },
    vertexShader: `attribute float seed; uniform float uTime; uniform float uPx; varying float vA;
      void main(){ vec3 p = position; float t = uTime * (0.04 + seed * 0.05);
        p.y = mod(p.y + t + 1.6, 3.2) - 1.6; p.x += sin(uTime * 0.25 + seed * 30.0) * 0.12;
        vA = (0.5 + 0.5 * sin(uTime * (0.6 + seed) + seed * 50.0)) * smoothstep(1.6, 1.0, abs(p.y));
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = uPx * (1.2 + seed * 2.0) * (6.0 / -mv.z); }`,
    fragmentShader: `uniform float uFade; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA * 0.3 * uFade; gl_FragColor = vec4(vec3(0.75, 0.85, 1.0) * a, a); }`,
  });
  const dust = new Points(dustGeo, dustMat); dust.visible = !reduced; rig.add(dust);

  // ── background: deep navy, soft light pool behind the gear, faint contact shadow ──
  const bgScene = new Scene(), bgCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const bgMat = new ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: { uRes: { value: new Vector2(1, 1) }, uPool: { value: new Vector2(0.3, 0.5) }, uPoolR: { value: 300 }, uShadow: { value: new Vector2(0.3, 0.3) }, uShadowW: { value: 300 }, uOn: { value: 0 }, uShade: { value: 0 } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: `uniform vec2 uRes, uPool, uShadow; uniform float uPoolR, uShadowW, uOn, uShade; varying vec2 vUv;
      vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        vec2 px = vUv * uRes;
        float r = length((vUv - vec2(0.62, 0.78)) * vec2(1.0, 1.35));
        vec3 col = mix(lin(vec3(0.090, 0.145, 0.250)), lin(vec3(0.047, 0.082, 0.150)), smoothstep(0.0, 0.6, r));
        col = mix(col, lin(vec3(0.027, 0.047, 0.090)), smoothstep(0.55, 1.25, r));
        vec2 q = (px - uPool * uRes) / uPoolR; float pool = exp(-dot(q, q) * 1.25);
        vec2 q2 = (px - uPool * uRes) / (uPoolR * vec2(2.8, 1.25)); pool += exp(-dot(q2, q2) * 1.6) * 0.4;
        col += lin(vec3(0.42, 0.56, 0.80)) * pool * 0.36 * uOn;
        vec2 s = (px - uShadow * uRes) / vec2(uShadowW, uShadowW * 0.08); col *= 1.0 - 0.32 * exp(-dot(s, s) * 1.5) * uShade;
        col += (hash(px) - 0.5) / 255.0;   // dither: no banding in the gradients
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const bgQuad = new Mesh(new PlaneGeometry(2, 2), bgMat); bgQuad.frustumCulled = false; bgScene.add(bgQuad);

  // ── post: background + scene → bloom (chrome glints only) → output ──
  const composer = new EffectComposer(renderer);
  const scenePass = new RenderPass(scene, camera); scenePass.clear = false;
  const bloom = new UnrealBloomPass(new Vector2(256, 256), 0.3, 0.42, 0.93);
  composer.addPass(new RenderPass(bgScene, bgCam)); composer.addPass(scenePass); composer.addPass(bloom); composer.addPass(new OutputPass());

  // ── camera fit ──
  const W = vb[2] * U, H = vb[3] * U;
  const tmp = new Vector3();
  const screenUv = (x, y) => { tmp.set(x, y, 0).applyMatrix4(rig.matrixWorld).project(camera); return [(tmp.x + 1) / 2, (tmp.y + 1) / 2]; };
  let camD = 10;
  const fit = () => {
    const w = host.clientWidth || 1, h = host.clientHeight || 1;
    renderer.setSize(w, h, false); composer.setSize(w, h);
    const dpr = renderer.getPixelRatio();
    bloom.resolution.set(Math.round((w * dpr) / 2), Math.round((h * dpr) / 2));
    bgMat.uniforms.uRes.value.set(w, h);
    dustMat.uniforms.uPx.value = dpr * Math.min(1.6, Math.max(0.8, h / 700));
    camera.aspect = w / h;
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    let rw = w, rh = h, rcx = w / 2, rcy = h / 2;
    if (fullBleed) {
      if (w >= 1024) { const card = Math.max(400, w * 0.34) + 40; rw = (w - card) * 0.86; rh = h * 0.7; rcx = (w - card) / 2 + 16; rcy = h * 0.47; }
      else { rw = w - 56; rh = Math.max(220, h * 0.36); rcx = w / 2; rcy = Math.max(250, h * 0.4) * 0.55; } // centred, ≥ 28 px each side
    }
    const d = Math.max(W / (rw / w) / (2 * tan * camera.aspect), (H * 1.2) / (rh / h) / (2 * tan));
    camD = d; camera.position.set(0, 0.15, d); camera.lookAt(0, -H * 0.05, 0);
    if (fullBleed) camera.setViewOffset(w, h, w / 2 - rcx, h / 2 - rcy, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    bgMat.uniforms.uPoolR.value = 2.4 * (rw / W);
    bgMat.uniforms.uShadowW.value = 0.4 * rw;
    kick();
  };

  // ── input: pointer / phone tilt → parallax (max ±4°) ──
  const aim = { x: 0, y: 0 }, cur = { x: 0, y: 0 };
  const onMove = (e) => { aim.x = e.clientX / window.innerWidth - 0.5; aim.y = e.clientY / window.innerHeight - 0.5; kick(); };
  const onTilt = (e) => { if (e.gamma == null) return; aim.x = Math.max(-0.5, Math.min(0.5, e.gamma / 60)); aim.y = Math.max(-0.5, Math.min(0.5, (e.beta - 40) / 80)); kick(); };
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("deviceorientation", onTilt, { passive: true });

  // ── timeline ──
  // the timeline follows real elapsed time (logoIntroClock.js): only a single huge jump is clamped (no gear
  // teleport), the intro is complete by ~4 s of wall clock at any frame rate, and a hidden page skips to the
  // final pose; it only starts after the pre-warm (shaders compiled, first frames rendered)
  const intro = createIntroClock(INTRO_END);
  let raf = 0, started = false, hiddenAt = 0, settled = false;
  let nextSweep = SWEEP_AT, sweepSent = -1;
  // window.__SHANTAZ_T (seconds) freezes the timeline — used only by the frame-capture scripts
  const clock = (now) => {
    if (typeof window.__SHANTAZ_T === "number") return window.__SHANTAZ_T;
    if (reduced) return INTRO_END + 1;
    return started ? intro.tick(now) : intro.t;
  };
  const ROLL_D = 3.4;                                     // roll-in distance (scene units)
  const easeIn = (u) => u * u * (3 - 2 * u);                 // no linear start
  const gearX = (t) => gp[0] - ROLL_D * (1 - settle(easeIn(span(t, 0, 1.45))));
  const apply = (t) => {
    // 1. gear rolls in (rotation = distance / radius, so it truly rolls), locks with a small overshoot
    const gx = gearX(t);
    gear.position.x = gx; gear.rotation.z = -(gx - gp[0]) / GEAR_R;
    const v = Math.abs(gearX(t) - gearX(t - 1 / 60)) * 60;   // speed → trail strength
    ghosts.forEach(({ m, k }) => {
      const tx = gearX(t - k * 0.022); const on = clamp01(v / 4) * (t < 1.4 ? 1 : 0);
      m.visible = on > 0.01; m.position.x = tx; m.rotation.z = -(tx - gp[0]) / GEAR_R; m.material.opacity = on * 0.16 * (1 - k / 5);
    });
    gear.visible = t > 0;
    glintMat.uniforms.uA.value = Math.sin(Math.PI * span(t, 0.78, 0.6)) * (t < 1.5 ? 1 : 0);
    glint.scale.setScalar(0.6 + 0.6 * span(t, 0.78, 0.6));
    glint.rotation.z = 0.6 * span(t, 0.78, 0.6);
    bgMat.uniforms.uOn.value = 0.35 + 0.65 * outCubic(span(t, 0.1, 1.2));
    // soft contact shade under the logo: only once the wordmark has landed (no shadow of nothing)
    bgMat.uniforms.uShade.value = outCubic(span(t, 1.9, 1.0));
    // 2. wheat grows stalk by stalk (clip plane rises), grains settle as it passes
    const span0 = wheatTopY - wheatBaseY + 0.3;
    stalks.forEach((s, i) => {
      const e = outCubic(span(t, 0.85 + i * 0.28, 0.95));
      const lim = wheatBaseY - 0.02 + span0 * e;
      s.plane.constant = lim;
      s.grains.forEach((g) => { const k = clamp01((lim - g.y) / 0.35); g.m.scale.setScalar(0.55 + 0.45 * outBack(k, 2)); });
    });
    wind.uTime.value = t;
    // 3. SHANTAZ: letters from the right, 3D rotate-in, expo-out
    letters.forEach((l, i) => {
      const e = outExpo(span(t, 1.55 + i * 0.075, 0.8));
      l.m.position.x = l.x + 1.6 * (1 - e); l.m.position.z = 0.9 * (1 - e);
      l.m.rotation.y = 1.25 * (1 - e); l.m.rotation.x = -0.25 * (1 - e);
      l.mat.opacity = clamp01(e * 1.6);
    });
    // 4. tagline: letter by letter, soft rise + tracking tighten; 5. ® pops last
    tag.forEach((g) => {
      const e = outExpo(span(t, 2.3 + g.i * 0.03, 0.7));
      g.m.position.x = g.x + (g.x - tagMid) * 0.12 * (1 - e); g.m.position.y = g.y - 0.14 * (1 - e);
      g.mat.opacity = e;
    });
    reg.scale.setScalar(Math.max(0.001, outBack(span(t, 3.05, 0.35), 2.6)));
    // light sweep across the wordmark, then every 8 s
    let st = t - nextSweep;
    if (st > SWEEP_LEN) { nextSweep += SWEEP_EVERY; st = t - nextSweep; }
    if (!reduced && st >= 0 && st <= SWEEP_LEN) {
      if (started && sweepSent !== nextSweep) {   // (not from the pre-warm poses)
        sweepSent = nextSweep;
        try { window.dispatchEvent(new CustomEvent("shantaz:sweep", { detail: { duration: SWEEP_LEN * 1000, intro: t < INTRO_END } })); } catch { /* old browser */ }
      }
      const k = outCubic(st / SWEEP_LEN);
      sweep.position.x = wordL + k * (wordR - wordL);
      sweep.intensity = Math.sin(Math.PI * (st / SWEEP_LEN)) * 5;
    } else sweep.intensity = 0;
    // idle: a specular light orbits the chrome gear
    const oa = (reduced ? 0.35 : t / ORBIT) * Math.PI * 2 + 2.2;
    orbit.position.set(gp[0] + Math.cos(oa) * 1.45, gp[1] + Math.sin(oa) * 1.45, 0.55);
    orbit.intensity = 6 * outCubic(span(t, 1.0, 1.0));
    if (!settled && t > INTRO_END) {
      settled = true;
      ghosts.forEach(({ m }) => { m.visible = false; });
      [...letters.map((l) => l.mat), ...tag.map((g) => g.mat)].forEach((m) => { m.transparent = false; m.opacity = 1; m.needsUpdate = true; });
    }
    dustMat.uniforms.uTime.value = t; dustMat.uniforms.uFade.value = outCubic(span(t, 1.0, 1.5));
    camera.position.z = camD * (1 + 0.07 * (1 - outCubic(span(t, 0, 3.3))));   // slow dolly-in through the intro
    cur.x += (aim.x - cur.x) * 0.06; cur.y += (aim.y - cur.y) * 0.06;
    rig.rotation.y = cur.x * 2 * TILT; rig.rotation.x = cur.y * 2 * TILT * 0.6;
  };

  const render = () => {
    rig.updateMatrixWorld();
    const pool = screenUv(gp[0], gp[1]); bgMat.uniforms.uPool.value.set(pool[0], pool[1]);
    const sh = screenUv((gp[0] + wordR) / 2, floorY + 0.04); bgMat.uniforms.uShadow.value.set(sh[0], sh[1]);
    composer.render();
  };

  // ── loop: continuous while there is motion; fps guard after the intro ──
  let fpsN = 0, fpsT = 0, fpsDone = reduced || window.__SHANTAZ_FPS_GUARD === false, last = 0, failed = false;
  const frame = (now) => {
    raf = 0;
    const t = clock(now);
    apply(t); render();
    if (!fpsDone && t > INTRO_END + 0.3) {
      if (last) { fpsT += now - last; fpsN++; }
      if (fpsN >= 90) { fpsDone = true; if (1000 / (fpsT / fpsN) < 40) { failed = true; fail(); return; } }
    }
    last = now;
    const moving = !reduced || Math.abs(aim.x - cur.x) > 0.002 || Math.abs(aim.y - cur.y) > 0.002;
    if (moving && !failed) raf = requestAnimationFrame(frame);
  };
  function kick() { if (!raf && !hiddenAt && !failed) raf = requestAnimationFrame(frame); }
  const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; last = 0; intro.pause(); };
  const onVis = () => {
    if (document.hidden) { if (!hiddenAt) hiddenAt = performance.now(); stop(); intro.hidden(); }
    else { hiddenAt = 0; kick(); }
  };
  document.addEventListener("visibilitychange", onVis);
  if (document.hidden) intro.hidden();   // opened in a background tab: show the final pose when it is viewed
  const ro = new ResizeObserver(fit); ro.observe(host);
  fit();
  // pre-warm: compile every shader and render a few hidden frames (env map, bloom targets,
  // clip/wind programs) at t = 0, then fade the canvas in and start the clock on a stable frame
  try {
    apply(0); rig.updateMatrixWorld();
    renderer.compile(scene, camera); renderer.compile(bgScene, bgCam);
    apply(3.0); render(); apply(1.6); render(); apply(0); render();   // (stays below INTRO_END: materials keep their fade)
  } catch { /* first real frame will compile */ }
  requestAnimationFrame(() => requestAnimationFrame((now) => {
    cv.style.opacity = "1"; started = true; if (!document.hidden) intro.begin(now);
    if (document.hidden) onVis(); else kick();
  }));

  return () => {
    stop(); ro.disconnect();
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("deviceorientation", onTilt);
    document.removeEventListener("visibilitychange", onVis);
    cv.removeEventListener("webglcontextlost", onLost);
    const geos = new Set(), mats = new Set();
    [scene, bgScene].forEach((sc) => sc.traverse((o) => { if (o.isMesh || o.isPoints) { geos.add(o.geometry); mats.add(o.material); } }));
    geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose()); wheatBase.dispose(); redMat.dispose(); tagMat.dispose();
    composer.dispose(); bloom.dispose(); envRT.dispose(); pmrem.dispose();
    renderer.dispose(); renderer.forceContextLoss();
    try { host.removeChild(cv); } catch { /* already gone */ }
  };
}
