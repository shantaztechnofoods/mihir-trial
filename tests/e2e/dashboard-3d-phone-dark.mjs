// Dashboard 3D on a phone (2026-11-27): the same matrix in DARK mode. LOCAL TEST DATA ONLY. Checks live in ./lib/phone3d.mjs.
import { makeOk } from "./lib/helpers.mjs";
import { runMatrix } from "./lib/phone3d.mjs";
const { ok, done } = makeOk();
await runMatrix(ok, "dark");
await done({ close: async () => {} });
