#!/usr/bin/env node
// SHANTAZ ERP — keep src/modules/<m>/MODULE.json in step with the code.
//
//   node scripts/module-manifest.mjs            # check: print drift, exit 1 if any
//   node scripts/module-manifest.mjs --write    # rewrite the code-derived fields
//
// MODULE.json has two kinds of fields:
//   * declared (a person edits them): name, version, frozen, liveLock,
//     requiresCore, migrations, edgeFunctions, serverless, notes
//   * derived (this script writes them from the code; tests/moduleManifest
//     fails when they drift): exports, dependsOn, handlers, stores, shared,
//     core, npm
// --write never changes a declared field (a new folder gets defaults).
// See docs/FOLDER-REPLACE.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listModules, derivedManifest, readManifest, DERIVED_KEYS, DECLARED_KEYS } from "./lib/module-scan.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WRITE = process.argv.includes("--write");

const DEFAULTS = (name) => ({
  name, version: "1.0.0", frozen: false, liveLock: false, requiresCore: 1,
  migrations: [], edgeFunctions: [], serverless: [], notes: [],
});
const ORDER = ["name", "version", "frozen", "liveLock", "requiresCore", ...DERIVED_KEYS, "migrations", "edgeFunctions", "serverless", "notes"];

let drift = 0;
for (const mod of listModules(ROOT)) {
  const rel = `src/modules/${mod}/MODULE.json`;
  const cur = readManifest(ROOT, mod);
  const derived = derivedManifest(ROOT, mod);
  const base = { ...DEFAULTS(mod), ...(cur || {}) };
  const next = {};
  for (const k of ORDER) next[k] = DERIVED_KEYS.includes(k) ? derived[k] : base[k];
  const changed = DERIVED_KEYS.filter((k) => JSON.stringify(cur?.[k]) !== JSON.stringify(derived[k]));
  const unknown = cur ? Object.keys(cur).filter((k) => !ORDER.includes(k)) : [];
  if (!cur || changed.length || unknown.length) {
    drift++;
    console.log(`${rel}: ${!cur ? "missing" : `out of date (${[...changed, ...unknown.map((u) => `unknown key ${u}`)].join(", ")})`}`);
  }
  if (WRITE) fs.writeFileSync(path.join(ROOT, rel), JSON.stringify(next, null, 2) + "\n");
}
if (!drift) console.log("All MODULE.json files match the code.");
else if (WRITE) console.log(`Rewrote ${drift} MODULE.json file(s).`);
else console.log("Run: node scripts/module-manifest.mjs --write   (then review the diff)");
process.exit(drift && !WRITE ? 1 : 0);
void DECLARED_KEYS;
