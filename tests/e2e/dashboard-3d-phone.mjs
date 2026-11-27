// Dashboard 3D on a phone (2026-11-27): 1, 3, 11 machines × 360 / 390 / 430 px, LIGHT mode — draw calls < 120, DPR <= 1.5, no shadow map, idle 0 frames, tags >= 12 px and never overlapping, tap → same card, disposed on Line. LOCAL TEST DATA ONLY. Checks live in ./lib/phone3d.mjs.
import { makeOk } from "./lib/helpers.mjs";
import { runMatrix } from "./lib/phone3d.mjs";
const { ok, done } = makeOk();
await runMatrix(ok, "light");
await done({ close: async () => {} });
