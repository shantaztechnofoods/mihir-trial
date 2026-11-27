// Dashboard 3D on a phone at 4x CPU throttle (2026-11-27): time to the first 3D frame (logged) and a swipe through all six departments — 0 WebGL frames, animation frames max <= 50 ms, p95 <= 25 ms (up to 3 tries). Runs alone (SOLO in scripts/e2e-ci.sh). LOCAL TEST DATA ONLY. Checks live in ./lib/phone3d.mjs.
import { makeOk } from "./lib/helpers.mjs";
import { run4x } from "./lib/phone3d.mjs";
const { ok, done } = makeOk();
await run4x(ok);
await done({ close: async () => {} });
