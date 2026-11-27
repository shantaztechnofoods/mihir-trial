// SHANTAZ ERP — every module folder carries a MODULE.json that matches the
// code (folder-replace releases, docs/FOLDER-REPLACE.md). Fails when a folder
// starts importing a new shared/store/util file, another module's export, an
// npm package, or when App.jsx wires a new handler into its pages, and the
// manifest was not regenerated:
//     node scripts/module-manifest.mjs --write
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  listModules, derivedManifest, readManifest, scanModuleFolder, parseImports, parseExports,
  directEdgeCalls, edgeCallsViaImports, DERIVED_KEYS, DECLARED_KEYS, walk, classify, resolveRel,
  OPTIONAL_DERIVED_KEYS, OPTIONAL_DECLARED_KEYS, shellObjectKeys, appFactoryCalls, handlerFactory, appFunctions,
  shellCallNames, shellCallAdapters, appShellRegistry, shellCallList,
} from "../scripts/lib/module-scan.mjs";

const ROOT = ".";
const MODULES = listModules(ROOT);
const FIX = "run `node scripts/module-manifest.mjs --write` and commit the MODULE.json diff";

test("scanner reads static, re-export and dynamic imports", () => {
  const code = [
    'import React, { useState as uS, useMemo } from "react";',
    'import {',
    '  a,',
    '  b as c,',
    '} from "../../shared/x.js";',
    'import "./local.css";',
    '// import { gone } from "../../utils/old.js";',
    'export { Foo } from "./Foo.jsx";',
    'const L = React.lazy(() => import("./Lazy.jsx"));',
    'async function f() { const { callFn } = await import("../../stores/adminApi.js"); }',
  ].join("\n");
  const imps = parseImports(code);
  const by = Object.fromEntries(imps.map((i) => [i.spec, i.names]));
  assert.deepEqual(by.react, ["useState", "useMemo", "default"]);
  assert.deepEqual(by["../../shared/x.js"], ["a", "b"]);
  assert.deepEqual(by["./local.css"], []);
  assert.deepEqual(by["./Foo.jsx"], ["Foo"]);
  assert.deepEqual(by["./Lazy.jsx"], ["*"]);
  assert.deepEqual(by["../../stores/adminApi.js"], ["callFn"]);
  assert.equal(by["../../utils/old.js"], undefined, "commented-out import is ignored");
  assert.deepEqual([...parseExports('export const A = 1;\nexport function B() {}\nexport default C;\nexport { D as E } from "./d.js";')].sort(), ["A", "B", "E", "default"]);
});

test("there are module folders to check", () => {
  assert.ok(MODULES.length >= 14, `expected >= 14 module folders, found ${MODULES.length}`);
});

for (const mod of MODULES) {
  test(`${mod}: MODULE.json exists and matches the code`, () => {
    const man = readManifest(ROOT, mod);
    assert.ok(man, `src/modules/${mod}/MODULE.json is missing — ${FIX}`);
    assert.equal(man.name, mod, "name must equal the folder name");
    const keys = Object.keys(man);
    for (const k of [...DECLARED_KEYS, ...DERIVED_KEYS]) assert.ok(keys.includes(k), `missing key "${k}" — ${FIX}`);
    for (const k of keys) assert.ok([...DECLARED_KEYS, ...DERIVED_KEYS, ...OPTIONAL_DECLARED_KEYS, ...OPTIONAL_DERIVED_KEYS].includes(k), `unknown key "${k}"`);
    const derived = derivedManifest(ROOT, mod);
    for (const k of [...DERIVED_KEYS, ...OPTIONAL_DERIVED_KEYS]) {
      assert.deepEqual(man[k], derived[k], `src/modules/${mod}/MODULE.json "${k}" drifted from the code — ${FIX}`);
    }
  });

  test(`${mod}: declared fields are valid`, () => {
    const man = readManifest(ROOT, mod);
    assert.match(man.version, /^\d+\.\d+\.\d+$/, "version must be x.y.z");
    assert.ok(Number.isInteger(man.requiresCore) && man.requiresCore >= 1, "requiresCore must be an integer >= 1");
    assert.equal(typeof man.frozen, "boolean");
    assert.equal(typeof man.liveLock, "boolean");
    if (man.liveLock) assert.ok(man.frozen, "a module LOCKED in ERP LIVE must also be frozen in Trial");
    for (const id of man.migrations) {
      assert.ok(fs.existsSync(`supabase/migrations/${id}.sql`), `migration ${id}.sql not found`);
    }
    for (const fn of man.edgeFunctions) {
      assert.ok(fs.existsSync(`supabase/functions/${fn}/index.ts`), `Edge Function ${fn} not found in supabase/functions/`);
    }
    for (const f of man.serverless) assert.ok(fs.existsSync(f), `${f} not found`);
    const called = new Set([...directEdgeCalls(ROOT, mod), ...edgeCallsViaImports(ROOT, mod)]);
    for (const fn of called) {
      assert.ok(man.edgeFunctions.includes(fn), `${mod} calls Edge Function "${fn}" — add it to edgeFunctions in MODULE.json`);
    }
  });

  test(`${mod}: imports stay inside the folder rules`, () => {
    const scan = scanModuleFolder(ROOT, mod);
    assert.deepEqual(scan.missing, [], "relative imports that do not resolve to a file");
    assert.deepEqual(scan.deepImports, [], "import other modules only through their index.js");
    assert.deepEqual(scan.app, [], "modules never import src/app");
    for (const dep of Object.keys(scan.dependsOn)) assert.ok(MODULES.includes(dep), `unknown module ${dep}`);
  });
}

test("modules[].frozen matches the FROZEN marker in each README", () => {
  for (const mod of MODULES) {
    const readme = fs.existsSync(`src/modules/${mod}/README.md`) ? fs.readFileSync(`src/modules/${mod}/README.md`, "utf8") : "";
    const man = readManifest(ROOT, mod);
    assert.equal(man.frozen, /FROZEN/.test(readme), `${mod}: frozen in MODULE.json disagrees with its README`);
  }
});

// ── Phase B: versioned core + shell imports only through index.js ───────────
test("every module's requiresCore is <= CORE_VERSION (src/shared/coreVersion.js)", async () => {
  const { CORE_VERSION, CORE_PATHS } = await import("../src/shared/coreVersion.js");
  assert.ok(Number.isInteger(CORE_VERSION) && CORE_VERSION >= 1, "CORE_VERSION must be a whole number >= 1");
  for (const p of CORE_PATHS) {
    const file = p.replace(/#.*$/, "");
    if (!file.includes("*")) assert.ok(fs.existsSync(file), `CORE_PATHS entry ${p} does not exist`);
  }
  for (const mod of MODULES) {
    const man = readManifest(ROOT, mod);
    assert.ok(man.requiresCore <= CORE_VERSION, `${mod} requires core v${man.requiresCore} but CORE_VERSION is ${CORE_VERSION}`);
  }
});

// Phase C exception: src/app may import src/modules/<m>/handlers.js directly
// (docs/SHELL-CONTEXT.md) — through index.js it would pull the module's lazily
// loaded pages into the main bundle.
test("src/app and core import module folders only through their index.js", () => {
  const dirs = ["src/app", "src/shared", "src/stores", "src/utils", "src/auth", "src/config", "src/realtime", "src/supabase"];
  const bad = [];
  for (const d of dirs) {
    for (const f of walk(ROOT, d).filter((x) => /\.(m?js|jsx)$/.test(x))) {
      for (const imp of parseImports(fs.readFileSync(f, "utf8"))) {
        if (!imp.spec.startsWith(".")) continue;
        const c = classify(resolveRel(ROOT, f, imp.spec));
        if (c.kind === "module" && c.file !== "index.js" && !(d === "src/app" && f === "src/app/App.jsx" && c.file === "handlers.js" && !imp.dynamic)) bad.push(`${f} -> ${imp.spec}`);
        if (c.kind === "module" && !d.startsWith("src/app")) bad.push(`${f} (core) imports a module: ${imp.spec}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

// ── Phase C: handlers.js in module folders + the App shell object ───────────
// docs/FOLDER-REPLACE.md §7, docs/SHELL-CONTEXT.md
test("scanner reads the shell object, factory calls and a handlers.js frame", () => {
  const app = [
    "  const shell = {",
    "    // state",
    "    items, setItems,",
    "    logAudit,",
    "  };",
    "  const { handleA, handleB } = createFooHandlers(shell);",
  ].join("\n");
  assert.deepEqual(shellObjectKeys(app), ["items", "setItems", "logAudit"]);
  assert.deepEqual(appFactoryCalls(app), { createFooHandlers: ["handleA", "handleB"] });
  const h = [
    "export function createFooHandlers(shell) {",
    "  const { items, setItems, logAudit } = shell;",
    "  const handleA = () => {};",
    "  const handleB = () => {};",
    "  return { handleA, handleB };",
    "}",
  ].join("\n");
  assert.deepEqual(handlerFactory(h), { factory: "createFooHandlers", shellKeys: ["items", "setItems", "logAudit"], returns: ["handleA", "handleB"] });
});

test("Phase C: every handlers.js is wired through the shell and fully moved out of App.jsx", async () => {
  const { SHELL_API } = await import("../src/app/shellVersion.js");
  assert.ok(Number.isInteger(SHELL_API) && SHELL_API >= 1, "SHELL_API must be a whole number >= 1");
  const app = fs.readFileSync("src/app/App.jsx", "utf8");
  const keys = shellObjectKeys(app);
  assert.ok(keys, "src/app/App.jsx must build `const shell = { … };`");
  assert.equal(new Set(keys).size, keys.length, "duplicate key in the shell object");
  const calls = appFactoryCalls(app);
  const appFns = appFunctions(app);
  for (const mod of MODULES) {
    const rel = `src/modules/${mod}/handlers.js`;
    const man = readManifest(ROOT, mod);
    if (!fs.existsSync(rel)) {
      assert.equal(man.requiresShell, undefined, `${mod}: requiresShell set but there is no handlers.js`);
      continue;
    }
    const fac = handlerFactory(fs.readFileSync(rel, "utf8"));
    assert.ok(fac, `${rel} must be \`export function createXxxHandlers(shell) { … }\``);
    assert.ok(Number.isInteger(man.requiresShell) && man.requiresShell >= 1 && man.requiresShell <= SHELL_API,
      `${mod}: requiresShell must be 1..SHELL_API (${SHELL_API})`);
    const missing = fac.shellKeys.filter((k) => !keys.includes(k));
    assert.deepEqual(missing, [], `${rel} destructures keys the App shell object does not have`);
    assert.ok(new RegExp(`^import \\{ ${fac.factory} \\} from "\\.\\./modules/${mod}/handlers\\.js";$`, "m").test(app),
      `App.jsx must import ${fac.factory} from "../modules/${mod}/handlers.js"`);
    assert.ok(!parseExports(fs.readFileSync(`src/modules/${mod}/index.js`, "utf8")).has(fac.factory),
      `${mod}/index.js must not re-export ${fac.factory} (only App.jsx uses it, directly)`);
    assert.ok(calls[fac.factory], `App.jsx must call \`const { … } = ${fac.factory}(shell);\``);
    assert.deepEqual([...calls[fac.factory]].sort(), [...fac.returns].sort(), `App.jsx takes exactly the names ${fac.factory} returns`);
    for (const h of fac.returns) {
      assert.ok(!appFns.has(h), `${h} is still declared in App.jsx — a moved handler must exist only in ${rel}`);
      assert.ok(!keys.includes(h), `${h} is in the shell object — moved handlers come back from the factory, not the shell`);
    }
  }
});

// ── Phase C: shell.call — cross-module calls (docs/SHELL-CONTEXT.md) ─────────
test("scanner reads shell.call names, adapters, the App registry and SHELL_CALLS", () => {
  const h = [
    "export function createFooHandlers(shell) {",
    "  const { call } = shell;",
    '  const handleX = (...args) => call("inventory.x", ...args);',
    '  // call("not.counted") in a comment',
    "  const handleA = () => handleX(1);",
    '  const z = obj.call("not.a.shell.call");',
    "  return { handleA };",
    "}",
  ].join("\n");
  assert.deepEqual(shellCallNames(h), ["inventory.x"]);
  assert.deepEqual(shellCallAdapters(h), { "inventory.x": "handleX" });
  assert.deepEqual(appShellRegistry('  Object.assign(shellRegistry, { "inventory.x": handleX, "bom.y": handleY });'), { "inventory.x": "handleX", "bom.y": "handleY" });
  assert.equal(appShellRegistry("  const shell = {};"), null);
});

test("Phase C: every shell.call name is typed, registered in App.jsx and owned", async () => {
  const { SHELL_API, SHELL_CALLS } = await import("../src/app/shellVersion.js");
  const list = shellCallList(ROOT);
  assert.deepEqual(Object.keys(list).sort(), Object.keys(SHELL_CALLS || {}).sort(), "SHELL_CALLS must be one-line entries { handler, owner, since }");
  const app = fs.readFileSync("src/app/App.jsx", "utf8");
  const keys = shellObjectKeys(app) || [];
  const registry = appShellRegistry(app) || {};
  const appFns = appFunctions(app);
  const used = new Set();
  for (const mod of MODULES) {
    const rel = `src/modules/${mod}/handlers.js`;
    if (!fs.existsSync(rel)) continue;
    const code = fs.readFileSync(rel, "utf8");
    const names = shellCallNames(code);
    const adapters = shellCallAdapters(code);
    if (names.length) assert.ok(handlerFactory(code).shellKeys.includes("call"), `${rel} uses call(…) but does not take \`call\` from the shell`);
    for (const n of names) {
      used.add(n);
      assert.ok(list[n], `${rel}: call("${n}") is not in SHELL_CALLS (src/app/shellVersion.js) — add it there and bump SHELL_API`);
      assert.equal(adapters[n], list[n].handler, `${rel}: call("${n}") must come only through the adapter \`const ${list[n].handler} = (...args) => call("${n}", ...args);\``);
      assert.notEqual(list[n].owner, mod, `${rel}: call("${n}") — a module does not call its own handler through the shell`);
      const man = readManifest(ROOT, mod);
      assert.ok(man.requiresShell >= list[n].since, `${mod}: requiresShell must be >= ${list[n].since} (it calls "${n}")`);
    }
    assert.deepEqual(Object.keys(adapters).sort(), names, `${rel}: every call(…) name has exactly one adapter line`);
  }
  if (used.size) {
    assert.ok(keys.includes("call"), "the shell object must carry `call` (makeShellCall(shellRegistry))");
    assert.match(app, /^ {2}const shellRegistry = \{\};$/m);
    assert.match(app, /^ {2}const call = makeShellCall\(shellRegistry\);$/m);
    assert.match(app, /^import \{ makeShellCall \} from "\.\/shellCall\.js";$/m);
  }
  for (const [n, e] of Object.entries(list)) {
    assert.ok(Number.isInteger(e.since) && e.since >= 1 && e.since <= SHELL_API, `SHELL_CALLS "${n}": since must be 1..SHELL_API`);
    assert.ok(MODULES.includes(e.owner), `SHELL_CALLS "${n}": unknown owner module ${e.owner}`);
    assert.equal(registry[n], e.handler, `App.jsx must register "${n}": ${e.handler} in Object.assign(shellRegistry, { … })`);
    // owner has moved it (its ownHandlers), or the owner's move is still to come (still declared in App.jsx)
    const own = readManifest(ROOT, e.owner).ownHandlers || [];
    assert.ok(own.includes(e.handler) || appFns.has(e.handler), `SHELL_CALLS "${n}": ${e.handler} is neither in ${e.owner}'s ownHandlers nor declared in App.jsx`);
    assert.ok(used.has(n), `SHELL_CALLS "${n}" is not used by any handlers.js — remove it (no dead names)`);
  }
  assert.deepEqual(Object.keys(registry).sort(), Object.keys(list).sort(), "App.jsx registers exactly the SHELL_CALLS names");
});

test("shell.call: an unknown name throws, a known one passes args and the result through", async () => {
  const { makeShellCall } = await import("../src/app/shellCall.js");
  const reg = {};
  const call = makeShellCall(reg);
  reg["inventory.x"] = (a, b) => ({ a, b });
  assert.deepEqual(call("inventory.x", 1, 2), { a: 1, b: 2 });
  assert.throws(() => call("inventory.nope"), /shell\.call: unknown "inventory\.nope"/);
});
