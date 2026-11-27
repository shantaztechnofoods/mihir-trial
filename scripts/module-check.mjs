#!/usr/bin/env node
// SHANTAZ ERP — would copying ONE module folder from this repo (MIHIR TRIAL)
// into a Live checkout work on its own?
//
//   node scripts/module-check.mjs <module> --against <path-to-live-clone> [--json]
//
// READ-ONLY on both sides: it only reads files (no git, no npm, no writes).
// It imagines "Live tree + this repo's src/modules/<module>/ copied over it"
// and prints what that tree would be missing:
//   1. core files / exported names the folder imports (src/shared, stores,
//      utils, auth, config, realtime, supabase)
//   2. names it imports from other modules' index.js
//   3. names Live's App.jsx and Live's other modules import FROM this module
//   4. npm packages
//   5. App.jsx handlers + props wired into the module's components
//   6. migrations / Edge Functions / serverless files listed in MODULE.json
//   5b. Phase C: the shell keys its handlers.js needs + the createXxxHandlers(shell) call in Live App.jsx
//   7. CORE_VERSION (src/shared/coreVersion.js) vs MODULE.json requiresCore
// and ends with ONE verdict line:
//   VERDICT: folder-only OK
//   VERDICT: needs core vN / App.jsx changes (+ the exact parts)
// Exit code 0 = folder-only OK, 1 = more is needed, 2 = usage error.
// Steps for the handler / Live chat: docs/FOLDER-REPLACE.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  listModules, scanModuleFolder, coreClosure, appWiring, appFunctions, appModuleImports,
  parseExports, parseImports, resolveRel, classify, walk, readManifest, derivedManifest, coreVersion, appFunctionSource,
  moduleHandlerFactory, shellObjectKeys, appFactoryCalls, shellApiVersion, shellCallNames, appShellRegistry, hooksFactory, appHookCalls,
} from "./lib/module-scan.mjs";

const TRIAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const mod = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--against");
const ai = args.indexOf("--against");
const LIVE = ai >= 0 ? path.resolve(args[ai + 1] || "") : null;
const JSON_OUT = args.includes("--json");
if (!mod || !LIVE) {
  console.error("usage: node scripts/module-check.mjs <module> --against <path-to-live-clone> [--json]");
  process.exit(2);
}
if (!listModules(TRIAL).includes(mod)) { console.error(`no folder src/modules/${mod} in ${TRIAL}`); process.exit(2); }
if (!fs.existsSync(path.join(LIVE, "src"))) { console.error(`${LIVE} does not look like an ERP checkout (no src/)`); process.exit(2); }
if (path.resolve(LIVE) === path.resolve(TRIAL)) { console.error("--against must be a different checkout than this repo"); process.exit(2); }

const readT = (r) => fs.readFileSync(path.join(TRIAL, r), "utf8");
const readL = (r) => fs.readFileSync(path.join(LIVE, r), "utf8");
const hasL = (r) => fs.existsSync(path.join(LIVE, r));
const sameFile = (r) => hasL(r) && readL(r) === readT(r);
const exportsL = (r) => (hasL(r) ? parseExports(readL(r)) : new Set());
const hasName = (set, n) => n === "*" || set.has(n) || set.has("*");

const man = readManifest(TRIAL, mod) || { name: mod, ...derivedManifest(TRIAL, mod), version: "?", requiresCore: 1, migrations: [], edgeFunctions: [], serverless: [], frozen: false, liveLock: false };
const scan = scanModuleFolder(TRIAL, mod);
const R = { module: mod, trial: TRIAL, live: LIVE, version: man.version, requiresCore: man.requiresCore, liveCore: coreVersion(LIVE),
  liveManifestVersion: readManifest(LIVE, mod)?.version || null,
  core: [], coreInfo: [], modules: [], reverse: [], npm: [], npmInfo: [], handlers: [], handlersDiffer: [], props: [], propsInfo: [], mounts: [],
  migrations: [], edge: [], edgeRedeploy: [], serverless: [], cssInfo: [],
  shell: null, requiresShell: man.requiresShell || 0, liveShell: shellApiVersion(LIVE) };

// 1. core files the folder imports directly
for (const [file, names] of Object.entries(scan.coreNames).sort()) {
  if (!hasL(file)) {
    const cl = coreClosure(TRIAL, [file]);
    const alsoFiles = cl.files.filter((f) => f !== file && !sameFile(f));
    const pkgL = JSON.parse(readL("package.json"));
    const depsL = { ...(pkgL.dependencies || {}), ...(pkgL.devDependencies || {}) };
    const alsoNpm = cl.npm.filter((n) => !depsL[n]);
    R.core.push({ file, missing: "file", names: [...names].sort(), alsoFiles, alsoNpm });
    continue;
  }
  const ex = exportsL(file);
  const lost = [...names].filter((n) => !hasName(ex, n)).sort();
  if (lost.length) R.core.push({ file, missing: "names", names: lost });
  else if (!sameFile(file)) R.coreInfo.push(file);
}

// 2. other modules' index.js names
for (const [dep, names] of Object.entries(scan.dependsOn).sort()) {
  const idx = `src/modules/${dep}/index.js`;
  const ex = exportsL(idx);
  const lost = [...names].filter((n) => !hasName(ex, n)).sort();
  if (!hasL(idx)) R.modules.push({ module: dep, missing: "folder", names: [...names].sort() });
  else if (lost.length) R.modules.push({ module: dep, missing: "names", names: lost });
}

// 3. who in Live imports from this module — the Trial index.js must still export it
const trialIdx = `src/modules/${mod}/index.js`;
const trialEx = fs.existsSync(path.join(TRIAL, trialIdx)) ? parseExports(readT(trialIdx)) : new Set();
const trialFiles = new Set(walk(TRIAL, `src/modules/${mod}`));
const liveImporters = [...walk(LIVE, "src/app"), ...listModules(LIVE).filter((m) => m !== mod).flatMap((m) => walk(LIVE, `src/modules/${m}`)),
  ...["shared", "stores", "utils"].flatMap((d) => walk(LIVE, `src/${d}`))].filter((f) => /\.(m?js|jsx)$/.test(f));
for (const f of liveImporters) {
  for (const imp of parseImports(readL(f))) {
    if (!imp.spec.startsWith(".")) continue;
    const to = resolveRel(LIVE, f, imp.spec);
    const c = classify(to);
    if (c.kind !== "module" || c.module !== mod) continue;
    if (!trialFiles.has(to)) { R.reverse.push({ from: f, file: to, missing: "file" }); continue; }
    if (to === trialIdx) {
      const lost = imp.names.filter((n) => !hasName(trialEx, n));
      if (lost.length) R.reverse.push({ from: f, file: to, missing: "names", names: lost });
    }
  }
}

// 4. npm packages the folder imports itself
{
  const pkgT = JSON.parse(readT("package.json"));
  const pkgL = JSON.parse(readL("package.json"));
  const depsT = { ...(pkgT.dependencies || {}), ...(pkgT.devDependencies || {}) };
  const depsL = { ...(pkgL.dependencies || {}), ...(pkgL.devDependencies || {}) };
  for (const n of [...scan.npm].sort()) {
    if (!depsL[n]) R.npm.push({ pkg: n, version: depsT[n] || "?" });
    else if (depsT[n] && depsT[n] !== depsL[n]) R.npmInfo.push({ pkg: n, trial: depsT[n], live: depsL[n] });
  }
}

// 5. App.jsx wiring
{
  const wT = appWiring(TRIAL)[mod];
  const wL = appWiring(LIVE)[mod];
  const fnsL = fs.existsSync(path.join(LIVE, "src/app/App.jsx")) ? appFunctions(readL("src/app/App.jsx")) : new Set();
  if (wT) {
    for (const h of [...wT.handlers].sort()) {
      if (!wL || !wL.handlers.has(h)) R.handlers.push({ handler: h, inLiveApp: fnsL.has(h) });
    }
    const appT = readT("src/app/App.jsx");
    const appL = fnsL.size ? readL("src/app/App.jsx") : "";
    for (const h of [...wT.handlers].sort()) {
      if (!fnsL.has(h)) continue;
      const a = appFunctionSource(appT, h), b = appFunctionSource(appL, h);
      if (a !== null && b !== null && a !== b) R.handlersDiffer.push(h);
    }
    const liveImp = appModuleImports(LIVE)[mod];
    const liveNames = new Set(liveImp ? [...liveImp.names, ...liveImp.lazy] : []);
    for (const [comp, props] of Object.entries(wT.mounts)) {
      if (!liveNames.has(comp)) { R.mounts.push(comp); continue; }
      const pl = (wL && wL.mounts[comp]) || new Set();
      const add = [...props].filter((p) => !pl.has(p)).sort();
      const gone = [...pl].filter((p) => !props.has(p)).sort();
      if (add.length) R.props.push({ component: comp, props: add });
      if (gone.length) R.propsInfo.push({ component: comp, props: gone });
    }
  }
}

// 5b. Phase C — the folder's handlers.js runs on the Live shell object
{
  const fac = moduleHandlerFactory(TRIAL, mod);
  if (fac) {
    const appL = fs.existsSync(path.join(LIVE, "src/app/App.jsx")) ? readL("src/app/App.jsx") : "";
    const keysL = shellObjectKeys(appL) || [];
    const callL = appFactoryCalls(appL)[fac.factory];
    R.shell = {
      factory: fac.factory,
      missingKeys: fac.shellKeys.filter((k) => !keysL.includes(k)),
      call: callL ? "present" : "missing",
      takesMissing: callL ? fac.returns.filter((n) => !callL.includes(n)) : [],
      takesGone: callL ? callL.filter((n) => !fac.returns.includes(n)) : [],
      stillInLiveApp: fac.returns.filter((n) => appFunctions(appL).has(n)),
      // shell.call names this folder uses that Live's App.jsx does not register yet
      // hooks.js: Live App.jsx must call useXxxHooks({ … }) above its auth gate
      hooks: (() => { const f = path.join(TRIAL, `src/modules/${mod}/hooks.js`); const hk = fs.existsSync(f) && hooksFactory(fs.readFileSync(f, "utf8")); return hk ? { factory: hk.factory, call: appHookCalls(appL)[hk.factory] ? "present" : "missing", passes: hk.keys } : null; })(),
      callsMissing: shellCallNames(fs.readFileSync(path.join(TRIAL, `src/modules/${mod}/handlers.js`), "utf8"))
        .filter((n) => !((appShellRegistry(appL) || {})[n])),
    };
  }
}

// 6. database / serverless
for (const id of man.migrations || []) if (!hasL(`supabase/migrations/${id}.sql`)) R.migrations.push(id);
for (const fn of man.edgeFunctions || []) {
  const d = `supabase/functions/${fn}`;
  if (!hasL(`${d}/index.ts`)) { R.edge.push(fn); continue; }
  const filesT = walk(TRIAL, d);
  if (filesT.some((f) => !sameFile(f))) R.edgeRedeploy.push(fn);
}
for (const f of man.serverless || []) if (!sameFile(f)) R.serverless.push(f);
for (const css of ["src/index.css", "src/world-ui.css"]) if (fs.existsSync(path.join(TRIAL, css)) && !sameFile(css)) R.cssInfo.push(css);

// 7. verdict
const needCore = R.core.length > 0 || R.npm.length > 0 || R.requiresCore > R.liveCore;
const needShell = !!R.shell && (R.shell.missingKeys.length > 0 || R.shell.call === "missing" || R.shell.takesMissing.length > 0 || R.shell.takesGone.length > 0);
const needApp = needShell || R.handlers.length > 0 || R.props.length > 0 || R.mounts.length > 0 || R.reverse.some((r) => r.from.startsWith("src/app/"));
const parts = [];
if (needCore) parts.push(`core v${R.requiresCore}`);
if (needApp) parts.push("App.jsx changes");
if (R.modules.length) parts.push(`other module folders first (${R.modules.map((m) => m.module).join(", ")})`);
if (R.reverse.some((r) => !r.from.startsWith("src/app/"))) parts.push(`Live code that imports removed names (${[...new Set(R.reverse.filter((r) => !r.from.startsWith("src/app/")).map((r) => r.from))].join(", ")})`);
if (R.migrations.length) parts.push(`migrations ${R.migrations.join(", ")}`);
if (R.edge.length) parts.push(`Edge Functions ${R.edge.join(", ")}`);
R.verdict = parts.length ? `needs ${parts.join(" / ")}` : "folder-only OK";

if (JSON_OUT) { console.log(JSON.stringify(R, null, 2)); process.exit(parts.length ? 1 : 0); }

const out = [];
const say = (s = "") => out.push(s);
const list = (title, rows) => { say(`${title}: ${rows.length ? "" : "none"}`); rows.forEach((r) => say(`  - ${r}`)); };
say(`module-check  ${mod}  (Trial ${man.version}, requiresCore ${R.requiresCore})  →  ${LIVE}`);
say(`Live CORE_VERSION: ${R.liveCore || "0 (no src/shared/coreVersion.js — before core versioning)"} · Live MODULE.json: ${R.liveManifestVersion || "none"}`);
if (man.liveLock) say(`!! ${mod} is LOCKED in ERP LIVE — promote only with the owner's "haan" for this update.`);
else if (man.frozen) say(`!! ${mod} is FROZEN — the owner must say yes to this promotion.`);
say();
list("1. Core files / names the folder needs but Live lacks", R.core.map((c) => c.missing === "file"
  ? `${c.file} (missing file; folder uses ${c.names.join(", ") || "side effects"})${c.alsoFiles.length ? ` — bringing it also needs ${c.alsoFiles.join(", ")}` : ""}${c.alsoNpm.length ? ` + npm ${c.alsoNpm.join(", ")}` : ""}`
  : `${c.file} (Live file lacks: ${c.names.join(", ")})`));
if (R.coreInfo.length) say(`   info: core files that differ but have every name the folder uses: ${R.coreInfo.join(", ")}`);
list("2. Other modules' exports it imports that Live lacks", R.modules.map((m) => `${m.module}: ${m.missing === "folder" ? "whole folder missing" : m.names.join(", ")}`));
list("3. Live code importing names this folder no longer provides", R.reverse.map((r) => `${r.from} → ${r.file}${r.names ? `: ${r.names.join(", ")}` : " (file gone)"}`));
list("4. npm packages missing in Live package.json", R.npm.map((n) => `${n.pkg} ${n.version}`));
if (R.npmInfo.length) say(`   info: version differs: ${R.npmInfo.map((n) => `${n.pkg} Trial ${n.trial} / Live ${n.live}`).join(", ")}`);
list("5. App.jsx handlers wired in Trial but not in Live", R.handlers.map((h) => `${h.handler}${h.inLiveApp ? " (exists in Live App.jsx, not wired to this module)" : " (not defined in Live App.jsx — copy the handler)"}`));
if (R.handlersDiffer.length) say(`   info: handler bodies that differ Trial vs Live (diff them; copy handler by handler if the module needs the change): ${R.handlersDiffer.join(", ")}`);
list("   App.jsx props Trial passes that Live does not", R.props.map((p) => `<${p.component}>: ${p.props.join(", ")}`));
if (R.mounts.length) list("   components Live App.jsx does not mount yet", R.mounts);
if (R.propsInfo.length) say(`   info: props Live passes that Trial no longer does: ${R.propsInfo.map((p) => `<${p.component}>: ${p.props.join(", ")}`).join("; ")}`);
if (R.shell) {
  say(`5b. Shell (Phase C): ${R.shell.factory} needs SHELL_API ${R.requiresShell}, Live has ${R.liveShell}`);
  say(`   shell keys Live App.jsx lacks: ${R.shell.missingKeys.length ? R.shell.missingKeys.join(", ") + "  ← add them to Live's \`const shell = { … }\`" : "none"}`);
  if (R.shell.call === "missing") say(`   Live App.jsx does not call ${R.shell.factory}(shell) — App.jsx step: delete Live's bodies of ${R.shell.stillInLiveApp.join(", ") || "(none found)"} and add \`const { … } = ${R.shell.factory}(shell);\` after the shell object (docs/SHELL-CONTEXT.md)`);
  if (R.shell.takesMissing.length) say(`   Live's ${R.shell.factory}(shell) line must also take: ${R.shell.takesMissing.join(", ")}`);
  if (R.shell.hooks && R.shell.hooks.call === "missing") say(`   Live App.jsx does not call ${R.shell.hooks.factory} — App.jsx step: replace the hook's old body with \`const { … } = ${R.shell.hooks.factory}({ ${R.shell.hooks.passes.join(", ")} });\` at the same place (above the auth gate; docs/SHELL-CONTEXT.md)`);
  if (R.shell.callsMissing.length) say(`   shell.call names Live App.jsx does not register: ${R.shell.callsMissing.join(", ")}  ← add shellRegistry / call / Object.assign(shellRegistry, { … }) (docs/SHELL-CONTEXT.md)`);
  if (R.shell.takesGone.length) say(`   Live's ${R.shell.factory}(shell) line takes names the folder no longer returns: ${R.shell.takesGone.join(", ")}`);
}
list("6. Migrations (MODULE.json) missing in Live", R.migrations);
list("   Edge Functions missing in Live", R.edge);
if (R.edgeRedeploy.length) say(`   info: Edge Functions that differ (redeploy with supabase CLI): ${R.edgeRedeploy.join(", ")}`);
if (R.serverless.length) say(`   info: serverless files that differ: ${R.serverless.join(", ")}`);
if (R.cssInfo.length) say(`   info: global CSS differs (travels with the core package): ${R.cssInfo.join(", ")}`);
say(`7. CORE_VERSION: needs ${R.requiresCore}, Live has ${R.liveCore}${R.requiresCore > R.liveCore ? "  ← apply core package first" : ""}`);
say();
say(`VERDICT: ${R.verdict}`);
console.log(out.join("\n"));
process.exit(parts.length ? 1 : 0);
