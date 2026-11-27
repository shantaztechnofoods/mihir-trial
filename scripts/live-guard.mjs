#!/usr/bin/env node
// SHANTAZ ERP — "can every module folder in THIS checkout run with THIS checkout's shell?"
//
//   node scripts/live-guard.mjs [--root <checkout>]
//
// Made for ERP LIVE's CI: the owner replaces one src/modules/<m>/ folder by hand
// (github.dev drag and drop) and pushes. This script then checks, for every folder,
// that what the folder needs is really in the checkout:
//   1. MODULE.json requiresShell <= SHELL_API   (src/app/shellVersion.js)
//   2. MODULE.json requiresCore  <= CORE_VERSION (src/shared/coreVersion.js)
//   3. highest MODULE.json migration <= APPLIED_MIGRATION in supabase/LIVE-DB.txt
//      (the Live chat writes that file after it applies a migration; no file = skipped,
//      which is the Trial case — Trial's database is not tracked this way)
//   4. handlers.js: App.jsx calls its createXxxHandlers(shell) and takes exactly the
//      names it returns; every shell key it destructures is in App's shell object;
//      every shell.call name it uses is registered in App.jsx
//   5. hooks.js: App.jsx calls useXxxHooks({ … }) with the keys it reads, takes what it returns
//   6. every name a folder imports from another folder's index.js is exported there,
//      and every name App.jsx imports from a folder is exported by it
// Each problem prints ONE Hindi line, then the same in English:
//   यह folder अकेले नहीं चलेगा: पहले X डालो (src/modules/<m>)
// Exit 0 = all folders OK, 1 = at least one problem, 2 = not an ERP checkout.
// Read-only. The same scanner as scripts/module-check.mjs (scripts/lib/module-scan.mjs).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  listModules, readManifest, scanModuleFolder, parseExports, shellApiVersion, coreVersion,
  handlerFactory, hooksFactory, appFactoryCalls, appHookCalls, shellObjectKeys, shellCallNames,
  appShellRegistry, appModuleImports,
} from "./lib/module-scan.mjs";
import { maxMigration } from "./live-ready.mjs";

const args = process.argv.slice(2);
const ri = args.indexOf("--root");
const ROOT = path.resolve(ri >= 0 ? args[ri + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const read = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8"); } catch { return null; } };

const APP = read("src/app/App.jsx");
if (!APP || !fs.existsSync(path.join(ROOT, "src/modules"))) {
  console.error(`live-guard: ${ROOT} is not an ERP checkout on the module-folder layout (no src/app/App.jsx or src/modules)`);
  process.exit(2);
}

const SHELL = shellApiVersion(ROOT);
const CORE = coreVersion(ROOT);
const dbTxt = read("supabase/LIVE-DB.txt");
const APPLIED = dbTxt ? (dbTxt.match(/^APPLIED_MIGRATION=(\d{3})\s*$/m) || [])[1] || null : null;
const shellKeys = new Set(shellObjectKeys(APP) || []);
const factories = appFactoryCalls(APP);
const hookCalls = appHookCalls(APP);
const registry = appShellRegistry(APP) || {};
const appImports = appModuleImports(ROOT);
const exportsOf = (m) => { const t = read(`src/modules/${m}/index.js`); return t ? parseExports(t) : new Set(); };
const has = (set, n) => n === "*" || set.has(n) || set.has("*");
const diff = (a, b) => [...a].filter((x) => !b.has(x));

const problems = [];
const bad = (mod, hi, en) => problems.push({ mod, hi, en });

for (const mod of listModules(ROOT)) {
  const man = readManifest(ROOT, mod) || {};
  const need = man.requiresShell || 0;
  if (need > SHELL) bad(mod, `पहले App shell (SHELL_API ${need}) डालो — Live में अभी ${SHELL} है`, `needs App shell SHELL_API ${need}, this checkout has ${SHELL}`);
  const core = man.requiresCore || 1;
  if (core > CORE) bad(mod, `पहले core v${core} (shared / stores / utils) डालो — Live में अभी v${CORE} है`, `needs CORE_VERSION ${core}, this checkout has ${CORE}`);
  const mig = maxMigration(man.migrations);
  if (APPLIED && mig && mig > APPLIED) bad(mod, `पहले database migration ${mig} डालो — Live में ${APPLIED} तक लगी है`, `needs migration ${mig}, Live DB has up to ${APPLIED} (supabase/LIVE-DB.txt)`);

  const hj = read(`src/modules/${mod}/handlers.js`);
  const fac = hj ? handlerFactory(hj) : null;
  if (fac) {
    const takes = factories[fac.factory];
    if (!takes) bad(mod, `पहले App.jsx (shell) update डालो — उसमें ${fac.factory}(shell) वाली line नहीं है`, `App.jsx does not call ${fac.factory}(shell)`);
    else {
      const ret = new Set(fac.returns), tk = new Set(takes);
      const plus = diff(ret, tk), minus = diff(tk, ret);
      if (plus.length || minus.length) bad(mod, `पहले App.jsx (shell) update डालो — handler नाम बदले हैं (${[...plus.map((x) => "+" + x), ...minus.map((x) => "−" + x)].join(", ")})`, `App.jsx takes different names from ${fac.factory}: ${[...plus.map((x) => "+" + x), ...minus.map((x) => "-" + x)].join(", ")}`);
    }
    const missingKeys = fac.shellKeys.filter((k) => !shellKeys.has(k));
    if (missingKeys.length) bad(mod, `पहले App shell update डालो — shell में ये नहीं हैं: ${missingKeys.join(", ")}`, `shell object lacks keys: ${missingKeys.join(", ")}`);
    const missingCalls = shellCallNames(hj).filter((c) => !(c in registry));
    if (missingCalls.length) bad(mod, `पहले App shell update डालो — shell.call नाम नहीं मिले: ${missingCalls.join(", ")}`, `shell.call names not registered in App.jsx: ${missingCalls.join(", ")}`);
  }
  const hk = read(`src/modules/${mod}/hooks.js`);
  const hf = hk ? hooksFactory(hk) : null;
  if (hf) {
    const call = hookCalls[hf.factory];
    const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
    if (!call || !same(call.takes, hf.returns) || !same(call.passes, hf.keys)) bad(mod, `पहले App.jsx (shell) update डालो — ${hf.factory}({ … }) वाली line मेल नहीं खाती`, `App.jsx call of ${hf.factory} does not match hooks.js`);
  }
  const scan = scanModuleFolder(ROOT, mod);
  for (const [dep, names] of Object.entries(scan.dependsOn)) {
    const ex = exportsOf(dep);
    const miss = [...names].filter((n) => !has(ex, n)).sort();
    if (miss.length) bad(mod, `पहले नया ${dep} folder भी डालो — उसमें ये नाम नहीं हैं: ${miss.join(", ")}`, `folder ${dep} does not export: ${miss.join(", ")}`);
  }
  if (scan.missing.length) bad(mod, `पहले core (shared / stores / utils) update डालो — ये files नहीं मिलीं: ${scan.missing.map((x) => x.split(" -> ")[1]).join(", ")}`, `missing files: ${scan.missing.join("; ")}`);
  const ai = appImports[mod];
  if (ai) {
    const ex = exportsOf(mod);
    const wanted = [...ai.names, ...ai.lazy].filter((n) => !/^create[A-Z]\w*Handlers$|^use[A-Z]\w*Hooks$/.test(n));
    const miss = wanted.filter((n) => !has(ex, n)).sort();
    if (miss.length) bad(mod, `App.jsx को इस folder से ये चाहिए पर नहीं हैं: ${miss.join(", ")} — पुराना folder वापस डालो या App shell update डालो`, `App.jsx imports names this folder no longer exports: ${miss.join(", ")}`);
  }
}

const dbNote = APPLIED ? `migrations up to ${APPLIED}` : "migration check skipped (no supabase/LIVE-DB.txt)";
if (!problems.length) {
  console.log(`live-guard: OK — ${listModules(ROOT).length} folders, SHELL_API ${SHELL}, CORE_VERSION ${CORE}, ${dbNote}`);
  process.exit(0);
}
for (const p of problems) {
  console.log(`यह folder अकेले नहीं चलेगा: ${p.hi} (src/modules/${p.mod})`);
  console.log(`  [en] src/modules/${p.mod}: ${p.en}`);
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=live-guard ${p.mod}::यह folder अकेले नहीं चलेगा: ${p.hi}`);
}
console.log(`\nवापस जाना हो: Vercel → Deployments → पिछला ठीक deploy → "Promote to Production". (${dbNote})`);
process.exit(1);
