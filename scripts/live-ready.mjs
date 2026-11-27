#!/usr/bin/env node
// SHANTAZ ERP — write src/modules/<m>/LIVE-READY.txt for every module folder.
//
//   node scripts/live-ready.mjs            write / refresh every LIVE-READY.txt
//   node scripts/live-ready.mjs --check    exit 1 when any LIVE-READY.txt is missing or stale
//                                          (tests/liveReady.test.mjs runs this in `npm test`, so CI fails)
//
// LIVE-READY.txt tells the owner, in plain Hindi first and English after it, whether
// replacing ONLY this folder in ERP LIVE is enough, and what Live must already have:
// SHELL_API, CORE_VERSION, the highest migration, Edge Functions, other folders whose
// names it uses, the App.jsx factory / hook call, and the module on/off switch.
//
// It is built ONLY from what travels inside the folder (MODULE.json, handlers.js,
// hooks.js, the folder's own imports), so the text stays true after the folder is
// copied into Live. Whether Live really has those things is checked on Live's side
// by scripts/live-guard.mjs (Live CI), not here. Deterministic: no dates, no SHAs.
// Inputs: MODULE.json (node scripts/module-manifest.mjs --write keeps it fresh) and
// scripts/lib/module-scan.mjs (the same scanner scripts/module-check.mjs uses).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listModules, readManifest, scanModuleFolder, handlerFactory, hooksFactory } from "./lib/module-scan.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Module on/off switch ids (src/utils/modules.js MODULES) each folder serves.
// tests/liveReady.test.mjs checks every MODULES id appears here exactly once.
export const FOLDER_PAGES = {
  "dashboard": ["dashboard"],
  "inventory": ["inventory", "inward", "outward", "pending"],
  "purchase": ["pipeline", "vendors"],
  "machine-tracker": ["machines"],
  "analytics": ["analytics"],
  "ai-assistant": ["ai"],
  "whatsapp": ["whatsapp"],
  "reports": ["history", "reports"],
  "audit-trail": ["audit"],
  "settings": ["settings"],
  "users-roles": ["users", "roles"],
  "bom": [],
  "pending-jobs": [],
  "trial-certificate": [],
};
// LIVE_MODULES / ALWAYS_ON_MODULES in src/utils/modules.js (test keeps these equal).
export const LIVE_ON = ["machines", "reports", "settings", "users", "roles"];
export const ALWAYS_ON = ["settings", "users", "roles"];

export const maxMigration = (list) => {
  const nums = (list || []).map((m) => String(m).match(/^(\d{3})_/)).filter(Boolean).map((m) => m[1]);
  return nums.length ? nums.sort().pop() : null;
};

const read = (root, rel) => { try { return fs.readFileSync(path.join(root, rel), "utf8"); } catch { return null; } };

// Everything LIVE-READY.txt says about one module, from the folder alone.
export function moduleNeeds(root, mod) {
  const man = readManifest(root, mod) || {};
  const hj = read(root, `src/modules/${mod}/handlers.js`);
  const hk = read(root, `src/modules/${mod}/hooks.js`);
  const fac = hj ? handlerFactory(hj) : null;
  const hooks = hk ? hooksFactory(hk) : null;
  const scan = scanModuleFolder(root, mod);
  return {
    mod,
    version: man.version || "?",
    frozen: !!man.frozen,
    liveLock: !!man.liveLock,
    shell: man.requiresShell || 0,
    core: man.requiresCore || 1,
    migration: maxMigration(man.migrations),
    edge: [...(man.edgeFunctions || [])].sort(),
    serverless: [...(man.serverless || [])].sort(),
    folders: Object.keys(scan.dependsOn).sort(),
    factory: fac ? { name: fac.factory, returns: [...fac.returns].sort() } : null,
    hook: hooks ? { name: hooks.factory, returns: [...hooks.returns].sort() } : null,
    shellApi: [...(man.handlers || [])].sort(),
    pages: FOLDER_PAGES[mod] || [],
  };
}

export function liveReadyText(n) {
  const enough = !n.liveLock;
  const hi = [];
  const en = [];
  hi.push(`LIVE-READY — src/modules/${n.mod}  (version ${n.version})`);
  hi.push(`यह file script बनाता है (node scripts/live-ready.mjs) — हाथ से मत बदलो.`);
  hi.push("");
  hi.push(`सिर्फ़ यह folder बदलना काफ़ी है: ${enough ? "हाँ" : "ना"}`);
  if (!enough) hi.push(`  ना क्यों: Machine Tracker ERP LIVE में LOCKED है — पहले ERP LIVE chat में "हाँ" दो, फिर ही बदलो.`);
  hi.push(`  ${enough ? "शर्त" : "और"}: नीचे की चीज़ें Live में पहले से होनी चाहिए. Live का CI (scripts/live-guard.mjs) इन्हें खुद जाँचता है —`);
  hi.push(`  CI लाल हो तो "यह folder अकेले नहीं चलेगा: पहले X डालो" लिखा आएगा; तब Vercel में पुराना deploy Promote करो.`);
  hi.push("");
  hi.push("Live में पहले से होना चाहिए:");
  const rows = [];
  rows.push([`App shell: SHELL_API कम से कम ${n.shell}`, `App shell: SHELL_API at least ${n.shell}`, n.shell > 0]);
  rows.push([`Core (shared / stores / utils): CORE_VERSION कम से कम ${n.core}`, `Core (shared / stores / utils): CORE_VERSION at least ${n.core}`, true]);
  rows.push([`Database: migration ${n.migration} तक लगी हो`, `Database: migrations applied up to ${n.migration}`, !!n.migration]);
  rows.push([`Edge Function (Supabase में deployed): ${n.edge.join(", ")}`, `Edge Functions deployed in Supabase: ${n.edge.join(", ")}`, n.edge.length > 0]);
  rows.push([`Vercel server files: ${n.serverless.join(", ")}`, `Vercel serverless files: ${n.serverless.join(", ")}`, n.serverless.length > 0]);
  rows.push([`ये folder भी Live में हों (इनके नाम यह folder इस्तेमाल करता है): ${n.folders.join(", ")}`, `These folders must be in Live (this folder imports their names): ${n.folders.join(", ")}`, n.folders.length > 0]);
  if (n.factory) rows.push([`App.jsx में ${n.factory.name}(shell) वाली line, यही ${n.factory.returns.length} नाम लेती हो`, `App.jsx calls ${n.factory.name}(shell) and takes exactly these ${n.factory.returns.length} names: ${n.factory.returns.join(", ")}`, true]);
  if (n.hook) rows.push([`App.jsx में ${n.hook.name}({ … }) वाली line`, `App.jsx calls ${n.hook.name}({ … }) and takes: ${n.hook.returns.join(", ")}`, true]);
  if (n.shellApi.length) rows.push([`App.jsx (shell) ये दे: ${n.shellApi.join(", ")}`, `App.jsx (shell) passes: ${n.shellApi.join(", ")}`, true]);
  let i = 0;
  for (const [h, e, on] of rows) if (on) { i++; hi.push(`  ${i}. ${h}`); en.push(`  ${i}. ${e}`); }
  hi.push("");
  if (n.pages.length) {
    const live = n.pages.filter((p) => LIVE_ON.includes(p));
    const always = n.pages.filter((p) => ALWAYS_ON.includes(p));
    hi.push(`Switch: page id ${n.pages.join(", ")}. Live में दिखाने के लिए Vercel की VITE_ENABLED_MODULES में यह id हो और Settings → Modules में ON हो.`);
    hi.push(`  आज Live में ON: ${live.length ? live.join(", ") : "कोई नहीं (बंद रहेगा — folder बदलने से कुछ नहीं दिखेगा)"}${always.length ? ` (हमेशा ON: ${always.join(", ")})` : ""}.`);
  } else {
    hi.push(`Switch: इसका अपना page नहीं है — यह दूसरे folders के अंदर चलता है. कोई switch नहीं.`);
  }
  if (n.frozen) hi.push(`FROZEN: Trial में भी owner की "हाँ" के बिना नहीं बदलता.`);
  hi.push(`वापस जाना हो: Vercel → erp-live → Deployments → पिछला ठीक वाला → "Promote to Production".`);

  const out = [...hi, "", "──────── English ────────", ""];
  out.push(`Folder-only replace is enough: ${enough ? "YES" : "NO"}`);
  if (!enough) out.push(`  Why not: Machine Tracker is LOCKED in ERP LIVE — the owner's "haan" in the ERP LIVE chat comes first.`);
  out.push(`  ${enough ? "Condition" : "Also"}: Live must already have everything below. Live CI (scripts/live-guard.mjs) checks it and fails with one line if not.`);
  out.push("");
  out.push("Live must already have:");
  out.push(...en);
  out.push("");
  if (n.pages.length) {
    const live = n.pages.filter((p) => LIVE_ON.includes(p));
    out.push(`Switch: page id(s) ${n.pages.join(", ")} must be in VITE_ENABLED_MODULES (Vercel) and ON in Settings → Modules. ON in Live today: ${live.length ? live.join(", ") : "none"}.`);
  } else out.push("Switch: no page of its own (runs inside other folders); no switch.");
  if (n.frozen) out.push("FROZEN in Trial: changes need the owner's yes.");
  out.push("Rollback: Vercel → erp-live → Deployments → last good one → Promote to Production; then git revert the commit.");
  return out.join("\n") + "\n";
}

export function expected(root = ROOT) {
  return Object.fromEntries(listModules(root).map((m) => [`src/modules/${m}/LIVE-READY.txt`, liveReadyText(moduleNeeds(root, m))]));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const want = expected();
  const stale = [];
  for (const [rel, text] of Object.entries(want)) {
    const have = read(ROOT, rel);
    if (have === text) continue;
    if (check) stale.push(rel);
    else fs.writeFileSync(path.join(ROOT, rel), text);
  }
  if (check) {
    if (stale.length) {
      console.error(`LIVE-READY.txt stale or missing (run: node scripts/live-ready.mjs):\n  ${stale.join("\n  ")}`);
      process.exit(1);
    }
    console.log(`LIVE-READY.txt: all ${Object.keys(want).length} up to date`);
  } else console.log(`LIVE-READY.txt written for ${Object.keys(want).length} module folders`);
}
