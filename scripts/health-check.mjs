#!/usr/bin/env node
// SHANTAZ ERP health guard — fast static check (< 60 s, no browser, no DB, no build).
//
//   npm run health                     # everything; exit 1 on any FAIL
//   node scripts/health-check.mjs --only imports,wiring
//   node scripts/health-check.mjs --only bundle --require-dist   (CI: after `npm run build`)
//   node scripts/health-check.mjs --json health.json
//
// Groups (docs/ARCHITECTURE.md is the rule book):
//   imports  every import resolves (file / package), no cycles (files or module
//            folders), layer rules (shared ↛ app/modules, modules ↛ app, lower
//            layers ↛ screen code), other folders import a module only through
//            its index.js, every module folder has index.js + README.md
//   wiring   every named import is really exported by its target (incl. the
//            `const { x } = await import(…)` form), every handleXxx a screen file
//            uses is declared/imported there (esbuild does NOT catch a missing
//            one — it is a runtime ReferenceError), the tests/regression.test.mjs
//            inventory (handlers, pages, nav ids, audit types, store exports)
//   db       every table / view / RPC / storage bucket named in src exists in
//            supabase/migrations; every Edge Function / /api route exists; every
//            realtime-subscribed table is in the supabase_realtime publication
//   env      every VITE_* var read in src (or vite.config.js) is documented in
//            .env.example (and prep/env-template when that file exists)
//   bundle   main chunk + first-download budget from the last build (dist/);
//            SKIP when there is no build unless --require-dist
//
// Budgets: HEALTH_MAIN_RAW_KB (1600), HEALTH_MAIN_GZ_KB (420), HEALTH_FIRST_GZ_KB (600).

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, relative, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { builtinModules } from "node:module";
import { writeFileSync } from "node:fs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const t0 = Date.now();
const args = process.argv.slice(2);
const argVal = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const ONLY = (argVal("--only") || "imports,wiring,db,env,bundle").split(",").map((s) => s.trim());
const REQUIRE_DIST = args.includes("--require-dist");
const DIST = resolve(ROOT, argVal("--dist") || process.env.HEALTH_DIST || "dist");
const JSON_OUT = argVal("--json");

const results = [];   // { group, check, status: PASS|FAIL|WARN|SKIP, detail, problems[] }
function report(group, check, problems, { warn = false, detail = "", skip = false } = {}) {
  const status = skip ? "SKIP" : problems.length ? (warn ? "WARN" : "FAIL") : "PASS";
  results.push({ group, check, status, detail: detail || (problems.length ? `${problems.length} problem(s)` : ""), problems });
}

// ── source files ───────────────────────────────────────────────────────────
const rel = (p) => relative(ROOT, p).split("\\").join("/");
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const SRC = resolve(ROOT, "src");
const CODE_EXT = new Set([".js", ".jsx", ".mjs"]);
const files = walk(SRC).filter((p) => CODE_EXT.has(extname(p)));
const text = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
// Lines that are comments are dropped before scanning code patterns (imports are
// always at line start in this repo, so a full JS parser is not needed).
// JSX `{/* … */}` and line-start `/* … */` blocks are blanked first (newlines kept so
// line numbers stay right); a bare /* inside a string ("image/*") is left alone.
const blank = (m) => m.replace(/[^\n]/g, " ");
const codeOnly = (src) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, blank)
  .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, blank)
  .split("\n").map((l) => (/^\s*(\/\/|\*)/.test(l) ? "" : l)).join("\n");
const code = new Map(files.map((f) => [f, codeOnly(text.get(f))]));

const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const PKGS = new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})]);
const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

// ── import / export parsing ────────────────────────────────────────────────
function parseImports(f) {
  const src = code.get(f);
  const out = [];   // { spec, names: [original names] | null, kind: static|dynamic|reexport, line }
  const lineOf = (i) => src.slice(0, i).split("\n").length;
  let m;
  const reFrom = /^[ \t]*import\s+([^'";]*?)\s+from\s*["']([^"']+)["']/gm;
  while ((m = reFrom.exec(src))) out.push({ spec: m[2], names: clauseNames(m[1]), kind: "static", line: lineOf(m.index) });
  const reBare = /^[ \t]*import\s*["']([^"']+)["']/gm;
  while ((m = reBare.exec(src))) out.push({ spec: m[1], names: [], kind: "static", line: lineOf(m.index) });
  const reRe = /^[ \t]*export\s+(\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*["']([^"']+)["']/gm;
  while ((m = reRe.exec(src))) out.push({ spec: m[2], names: m[1].startsWith("*") ? [] : braceNames(m[1], "orig"), kind: "reexport", line: lineOf(m.index) });
  const reDynDestr = /const\s*\{([^}]*)\}\s*=\s*await\s+import\(\s*["']([^"']+)["']\s*\)/g;
  const seenDyn = new Set();
  while ((m = reDynDestr.exec(src))) { out.push({ spec: m[2], names: braceNames(`{${m[1]}}`, "orig", ":"), kind: "dynamic", line: lineOf(m.index) }); seenDyn.add(m.index); }
  const reDyn = /import\(\s*["']([^"']+)["']\s*\)/g;
  while ((m = reDyn.exec(src))) out.push({ spec: m[1], names: null, kind: "dynamic", line: lineOf(m.index) });
  return out;
}
function braceNames(b, which, sep = "as") {
  return b.replace(/[{}]/g, "").split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const parts = sep === ":" ? s.split(":").map((x) => x.trim()) : s.split(/\s+as\s+/);
    return which === "orig" ? parts[0] : parts[parts.length - 1];
  });
}
function clauseNames(clause) {
  const names = [];
  const brace = clause.match(/\{[^}]*\}/);
  if (brace) names.push(...braceNames(brace[0], "orig"));
  const rest = clause.replace(/\{[^}]*\}/, "").replace(/,/g, " ").trim();
  if (rest && !rest.startsWith("*")) names.push("default");     // default import
  // `* as ns` — namespace, nothing to check
  return names;
}
const exportCache = new Map();
function exportsOf(f, seen = new Set()) {
  if (exportCache.has(f)) return exportCache.get(f);
  if (seen.has(f)) return new Set();
  seen.add(f);
  const src = code.get(f) ?? (existsSync(f) ? codeOnly(readFileSync(f, "utf8")) : "");
  const names = new Set();
  let m;
  for (const re of [/^[ \t]*export\s+(?:async\s+)?function\s*\*?\s*([\w$]+)/gm, /^[ \t]*export\s+(?:const|let|var|class)\s+([\w$]+)/gm])
    while ((m = re.exec(src))) names.add(m[1]);
  const reDestr = /^[ \t]*export\s+(?:const|let|var)\s*\{([^}]*)\}\s*=/gm;
  while ((m = reDestr.exec(src))) for (const n of braceNames(`{${m[1]}}`, "local", ":")) names.add(n);
  if (/^[ \t]*export\s+default\b/m.test(src)) names.add("default");
  const reList = /^[ \t]*export\s*\{([^}]*)\}(?:\s*from\s*["']([^"']+)["'])?/gm;
  while ((m = reList.exec(src))) for (const n of braceNames(m[1], "local")) names.add(n);
  const reStarAs = /^[ \t]*export\s*\*\s+as\s+([\w$]+)\s+from/gm;
  while ((m = reStarAs.exec(src))) names.add(m[1]);
  const reStar = /^[ \t]*export\s*\*\s*from\s*["']([^"']+)["']/gm;
  while ((m = reStar.exec(src))) {
    const target = resolveSpec(f, m[1]);
    if (target && target.file) for (const n of exportsOf(target.file, seen)) if (n !== "default") names.add(n);
  }
  exportCache.set(f, names);
  return names;
}
function resolveSpec(from, spec) {
  spec = spec.replace(/\?[^/]*$/, "");   // Vite asset query (?raw, ?url, ?worker): the file is what must exist
  if (spec.startsWith(".") || spec.startsWith("/")) {
    const base = spec.startsWith("/") ? resolve(ROOT, "." + spec) : resolve(dirname(from), spec);
    for (const c of [base, `${base}.js`, `${base}.jsx`, `${base}.mjs`, join(base, "index.js"), join(base, "index.jsx")])
      if (existsSync(c) && statSync(c).isFile()) return { file: c };
    return null;
  }
  if (BUILTINS.has(spec)) return { pkg: spec };
  const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
  return PKGS.has(name) ? { pkg: name } : null;
}

// ── layers ─────────────────────────────────────────────────────────────────
const LOWER = ["stores", "utils", "auth", "config", "supabase", "realtime", "devtools"];
function layerOf(f) {
  const r = rel(f);
  if (r === "src/main.jsx") return { layer: "main" };
  const parts = r.split("/");
  if (parts[1] === "app") return { layer: "app" };
  if (parts[1] === "modules") return { layer: "module", module: parts[2] };
  if (parts[1] === "shared") return { layer: "shared" };
  if (LOWER.includes(parts[1])) return { layer: "lower", dir: parts[1] };
  return { layer: "other" };
}
const MODULES_DIR = resolve(SRC, "modules");
const moduleNames = existsSync(MODULES_DIR) ? readdirSync(MODULES_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : [];

// Build the graph once (used by imports + wiring)
const edges = [];   // { from, to, spec, kind, names, line }
const unresolved = [];
for (const f of files) {
  for (const imp of parseImports(f)) {
    const r = resolveSpec(f, imp.spec);
    if (!r) { unresolved.push(`${rel(f)}:${imp.line} → "${imp.spec}"`); continue; }
    if (r.file) edges.push({ from: f, to: r.file, ...imp });
  }
}

// ═══ imports ═══════════════════════════════════════════════════════════════
if (ONLY.includes("imports")) {
  report("imports", "every import resolves (file or package.json dependency)", unresolved, { detail: `${edges.length} local edges, ${files.length} files` });

  // cycles: Tarjan SCC over static + re-export edges (dynamic import() cannot deadlock module init)
  const adj = new Map(files.map((f) => [f, []]));
  for (const e of edges) if (e.kind !== "dynamic" && adj.has(e.to)) adj.get(e.from).push(e.to);
  const sccs = tarjan([...adj.keys()], (v) => adj.get(v));
  const fileCycles = sccs.filter((c) => c.length > 1 || adj.get(c[0]).includes(c[0])).map((c) => c.map(rel).join(" ↔ "));
  report("imports", "no import cycles between files", fileCycles);

  const madj = new Map(moduleNames.map((m) => [m, new Set()]));
  for (const e of edges) {
    const a = layerOf(e.from), b = layerOf(e.to);
    if (a.layer === "module" && b.layer === "module" && a.module !== b.module && madj.has(a.module)) madj.get(a.module).add(b.module);
  }
  const msccs = tarjan([...madj.keys()], (v) => [...madj.get(v)]);
  report("imports", "no cycles between module folders", msccs.filter((c) => c.length > 1).map((c) => c.join(" ↔ ")),
    { detail: [...madj].filter(([, s]) => s.size).map(([m, s]) => `${m}→${[...s].join(",")}`).join("  ") });

  const layerProblems = [];
  const throughIndex = [];
  for (const e of edges) {
    const a = layerOf(e.from), b = layerOf(e.to);
    const where = `${rel(e.from)}:${e.line} → ${rel(e.to)}`;
    if (a.layer === "shared" && (b.layer === "app" || b.layer === "module")) layerProblems.push(`shared imports ${b.layer}: ${where}`);
    if (a.layer === "module" && b.layer === "app") layerProblems.push(`module imports app: ${where}`);
    if (a.layer === "lower" && ["app", "module", "shared"].includes(b.layer)) layerProblems.push(`${a.dir}/ imports ${b.layer}: ${where}`);
    if (b.layer === "module" && a.module !== b.module && e.kind !== "dynamic") {
      const isIndex = rel(e.to) === `src/modules/${b.module}/index.js`;
      if (!isIndex) throughIndex.push(where);
    }
  }
  report("imports", "layer rules (shared ↛ app/modules, modules ↛ app, stores/utils/… ↛ screen code)", layerProblems);
  report("imports", "other folders import a module only through its index.js", throughIndex);

  const folderProblems = [];
  const indexProblems = [];
  const readmeStale = [];
  for (const m of moduleNames) {
    const dir = join(MODULES_DIR, m);
    for (const req of ["index.js", "README.md"]) if (!existsSync(join(dir, req))) folderProblems.push(`src/modules/${m}/${req} missing`);
    const idx = join(dir, "index.js");
    if (existsSync(idx)) {
      const bad = codeOnly(readFileSync(idx, "utf8")).split("\n").map((l) => l.trim())
        .filter((l) => l && !/^export\s*(\{[^}]*\}|\*(\s+as\s+[\w$]+)?)\s*from\s*["']\.\/[^"']+["'];?$/.test(l));
      if (bad.length) indexProblems.push(`src/modules/${m}/index.js: ${bad[0].slice(0, 80)}`);
    }
    const readme = join(dir, "README.md");
    if (existsSync(readme)) {
      const md = readFileSync(readme, "utf8");
      for (const f of readdirSync(dir)) if (CODE_EXT.has(extname(f)) && !md.includes(f)) readmeStale.push(`src/modules/${m}/README.md does not list ${f}`);
    }
  }
  report("imports", "every module folder has index.js + README.md", folderProblems, { detail: `${moduleNames.length} module folders` });
  report("imports", "module index.js files only re-export (`export {…} from \"./…\"`)", indexProblems);
  report("imports", "module README lists every file in its folder", readmeStale, { warn: true });

  // documented module arrows (docs/ARCHITECTURE.md) vs real ones
  const arch = existsSync(resolve(ROOT, "docs/ARCHITECTURE.md")) ? readFileSync(resolve(ROOT, "docs/ARCHITECTURE.md"), "utf8") : "";
  const block = arch.match(/module-to-module arrows:([\s\S]*?)\n\s*\(/);
  if (block) {
    const documented = new Set();
    for (const m of block[1].matchAll(/`([a-z-]+)\s*→\s*([a-z-,\s]+)`/g))
      for (const t of m[2].split(",").map((s) => s.trim()).filter(Boolean)) documented.add(`${m[1]}→${t}`);
    const real = [...madj].flatMap(([a, s]) => [...s].map((b) => `${a}→${b}`));
    const undocumented = real.filter((a) => !documented.has(a)).map((a) => `${a} (add it to docs/ARCHITECTURE.md)`);
    const gone = [...documented].filter((a) => !real.includes(a)).map((a) => `${a} documented but no longer imported`);
    report("imports", "module-to-module arrows match docs/ARCHITECTURE.md", [...undocumented, ...gone], { warn: true });
  }
}

// ═══ wiring ════════════════════════════════════════════════════════════════
if (ONLY.includes("wiring")) {
  const missingExports = [];
  for (const e of edges) {
    if (!e.names || !e.names.length || !CODE_EXT.has(extname(e.to))) continue;
    const ex = exportsOf(e.to);
    for (const n of e.names) if (!ex.has(n)) missingExports.push(`${rel(e.from)}:${e.line} imports ${n === "default" ? "default" : `{ ${n} }`} from ${rel(e.to)} — not exported`);
  }
  report("wiring", "every named import is exported by its target file", missingExports);

  // handleXxx used in a screen file must be declared or imported there
  const undeclared = [];
  for (const f of files) {
    const L = layerOf(f).layer;
    if (L === "lower") continue;      // screen code only (stores/utils have no handlers)
    const src = code.get(f);
    const used = new Set(src.match(/\bhandle[A-Z][\w$]*/g) || []);
    for (const h of used) {
      const declared = new RegExp(`(?:const|let|var|function)\\s+${h}\\b|(?<![=\\w$])\\{\\s*${h}\\s*(?:[,}=]|:\\s*[\\w$])|,\\s*${h}\\s*(?:[,}=]|:\\s*[\\w$])|\\(\\s*${h}\\s*[,)=]|\\bimport\\b[^;]*\\b${h}\\b`).test(src);
      if (!declared) undeclared.push(`${rel(f)}: ${h}`);
    }
  }
  report("wiring", "every handleXxx a screen file uses is declared or imported there", undeclared);

  // tests/regression.test.mjs inventory (single source of truth — read, not copied)
  const regPath = resolve(ROOT, "tests/regression.test.mjs");
  if (existsSync(regPath)) {
    const reg = readFileSync(regPath, "utf8");
    const arr = (name) => {
      const m = reg.match(new RegExp(`const ${name}\\s*=\\s*(\\[[\\s\\S]*?\\n\\]);`));
      if (!m) return null;
      try { return Function(`"use strict"; return (${m[1]});`)(); } catch { return null; }
    };
    // screen code = everything except stores/utils/auth/config/… (works for the
    // module-folder layout and for the older single src/App.jsx layout)
    const screen = files.filter((f) => !["lower", "main"].includes(layerOf(f).layer)).map((f) => text.get(f)).join("\n");
    const inv = [];
    const handlers = arr("APP_HANDLERS"), pages = arr("PAGE_COMPONENTS"), navs = arr("NAV_IDS"), audits = arr("AUDIT_EVENT_TYPES"), stores = arr("STORE_SURFACE");
    if (!handlers || !pages || !navs || !audits || !stores) inv.push("could not read an inventory array from tests/regression.test.mjs");
    for (const h of handlers || []) if (!new RegExp(`const\\s+${h}\\s*=`).test(screen)) inv.push(`handler ${h} not defined`);
    for (const p of pages || []) if (!new RegExp(`function\\s+${p}\\b`).test(screen)) inv.push(`page/component ${p} not defined`);
    for (const id of navs || []) if (!new RegExp(`id:\\s*["']${id}["']`).test(screen)) inv.push(`nav id ${id} missing`);
    for (const t of audits || []) if (!screen.includes(`"${t}"`) && !screen.includes(`'${t}'`)) inv.push(`audit type ${t} no longer written`);
    for (const { file, exports: names } of stores || []) {
      const p = resolve(SRC, "stores", file);
      const ex = existsSync(p) ? exportsOf(p) : new Set();
      for (const n of names) if (!ex.has(n)) inv.push(`src/stores/${file} does not export ${n}`);
    }
    const count = [handlers, pages, navs, audits].reduce((n, a) => n + (a?.length || 0), 0) + (stores || []).reduce((n, s) => n + s.exports.length, 0);
    report("wiring", "regression inventory present (handlers, pages, nav ids, audit types, store exports)", inv, { detail: `${count} symbols` });
  } else report("wiring", "regression inventory present", [], { skip: true, detail: "tests/regression.test.mjs not found" });
}

// ═══ db ════════════════════════════════════════════════════════════════════
if (ONLY.includes("db")) {
  const migDir = resolve(ROOT, "supabase/migrations");
  const migs = existsSync(migDir) ? readdirSync(migDir).filter((f) => f.endsWith(".sql") && !/rollback/i.test(f)).sort() : [];
  const tables = new Set(), funcs = new Set(), buckets = new Set(), published = new Set();
  const ID = `(?:"?public"?\\.)?"?([a-z_][a-z0-9_]*)"?`;
  for (const f of migs) {
    const sql = readFileSync(join(migDir, f), "utf8").replace(/--[^\n]*/g, "");
    let m;
    const reT = new RegExp(`create\\s+(?:or\\s+replace\\s+)?(?:unlogged\\s+)?(?:table|(?:materialized\\s+)?view)\\s+(?:if\\s+not\\s+exists\\s+)?${ID}`, "gi");
    while ((m = reT.exec(sql))) tables.add(m[1].toLowerCase());
    const reRen = new RegExp(`alter\\s+table\\s+(?:if\\s+exists\\s+)?${ID}\\s+rename\\s+to\\s+"?([a-z_][a-z0-9_]*)"?`, "gi");
    while ((m = reRen.exec(sql))) { tables.delete(m[1].toLowerCase()); tables.add(m[2].toLowerCase()); }
    const reDrop = new RegExp(`drop\\s+(?:table|view|materialized\\s+view)\\s+(?:if\\s+exists\\s+)?${ID}`, "gi");
    while ((m = reDrop.exec(sql))) tables.delete(m[1].toLowerCase());
    const reF = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+${ID}\\s*\\(`, "gi");
    while ((m = reF.exec(sql))) funcs.add(m[1].toLowerCase());
    const reB = /insert\s+into\s+storage\.buckets\s*\([^)]*\)\s*values\s*\(\s*'([^']+)'/gi;
    while ((m = reB.exec(sql))) buckets.add(m[1]);
    // realtime publication: literal ADD TABLE lists and FOREACH … ARRAY[…] loops around one
    const reAdd = /alter\s+publication\s+supabase_realtime\s+add\s+table\s+([^;']+);/gi;
    while ((m = reAdd.exec(sql))) for (const t of m[1].split(",")) { const n = t.trim().replace(/^(?:"?public"?\.)/, "").replace(/"/g, ""); if (/^[a-z_][a-z0-9_]*$/.test(n)) published.add(n); }
    const reLoop = /foreach\s+\w+\s+in\s+array\s+array\s*\[([^\]]*)\][\s\S]*?end\s+loop/gi;
    while ((m = reLoop.exec(sql))) if (/alter\s+publication\s+supabase_realtime\s+add\s+table/i.test(m[0])) for (const q of m[1].matchAll(/'([a-z_0-9]+)'/g)) published.add(q[1]);
    const reDropPub = /alter\s+publication\s+supabase_realtime\s+drop\s+table\s+([^;']+);/gi;
    while ((m = reDropPub.exec(sql))) for (const t of m[1].split(",")) published.delete(t.trim().replace(/^(?:"?public"?\.)/, "").replace(/"/g, ""));
  }
  const fnDir = resolve(ROOT, "supabase/functions");
  const edgeFns = new Set(existsSync(fnDir) ? readdirSync(fnDir).filter((d) => existsSync(join(fnDir, d, "index.ts")) || existsSync(join(fnDir, d, "index.js"))) : []);
  const apiDir = resolve(ROOT, "api");
  const apiRoutes = new Set(existsSync(apiDir) ? readdirSync(apiDir).filter((f) => /\.(m?js|ts)$/.test(f)).map((f) => f.replace(/\.(m?js|ts)$/, "")) : []);

  const used = { table: new Map(), rpc: new Map(), bucket: new Map(), edge: new Map(), api: new Map() };
  const note = (kind, name, where) => { if (!used[kind].has(name)) used[kind].set(name, where); };
  for (const f of files) {
    const src = code.get(f);
    let m;
    const reFrom = /(\.storage\s*)?\.from\(\s*["']([a-z_][a-z0-9_-]*)["']/g;
    while ((m = reFrom.exec(src))) {
      const storage = m[1] || /\.storage\s*$/.test(src.slice(Math.max(0, m.index - 40), m.index));
      note(storage ? "bucket" : "table", m[2], rel(f));
    }
    const reBucketConst = /\b[A-Z_]*BUCKET[A-Z_]*\s*=\s*["']([a-z0-9][a-z0-9_-]*)["']/g;
    while ((m = reBucketConst.exec(src))) note("bucket", m[1], rel(f));
    const reRpc = /\.rpc\(\s*["']([a-z_][a-z0-9_]*)["']/g;
    while ((m = reRpc.exec(src))) note("rpc", m[1], rel(f));
    const reEdge = /(?:functions\.invoke|\binvoke|\bcallFn)\(\s*["']([a-z0-9][a-z0-9-_]*)["']/g;
    while ((m = reEdge.exec(src))) note("edge", m[1], rel(f));
    const reEdgeConst = /\b[A-Z_]+_FN\s*=\s*["']([a-z0-9][a-z0-9-_]*)["']/g;
    while ((m = reEdgeConst.exec(src))) note("edge", m[1], rel(f));
    const reApi = /(?:callWhatsAppFn\(\s*["']|fetch\(\s*["'`]\/api\/)([a-z0-9][a-z0-9-_]*)/g;
    while ((m = reApi.exec(src))) note("api", m[1], rel(f));
  }
  const missing = (kind, have, label) => [...used[kind]].filter(([n]) => !have.has(n.toLowerCase ? n : n)).map(([n, w]) => `${label} "${n}" (used in ${w})`);
  report("db", "tables / views used in src exist in supabase/migrations", missing("table", tables, "table"), { detail: `${used.table.size} used, ${tables.size} defined` });
  report("db", "RPC functions used in src exist in supabase/migrations", missing("rpc", funcs, "rpc"), { detail: `${used.rpc.size} used` });
  report("db", "storage buckets used in src are created by a migration", missing("bucket", buckets, "bucket"), { detail: `${[...used.bucket.keys()].join(", ")}` });
  report("db", "Edge Functions called exist in supabase/functions", missing("edge", edgeFns, "edge function"), { detail: `${[...used.edge.keys()].join(", ")}` });
  report("db", "/api routes called exist in api/", missing("api", apiRoutes, "api route"), { detail: `${[...used.api.keys()].join(", ")}` });

  // realtime
  const rtPath = resolve(SRC, "realtime/useRealtimeTables.js");
  if (existsSync(rtPath)) {
    const rt = code.get(rtPath) || readFileSync(rtPath, "utf8");
    const objKeys = (name) => { const m = rt.match(new RegExp(`${name}\\s*=\\s*Object\\.freeze\\(\\{([\\s\\S]*?)\\}\\)`)); return m ? [...m[1].matchAll(/^\s*([a-z_][a-z0-9_]*)\s*:/gm)].map((x) => x[1]) : []; };
    const live = objKeys("REALTIME_TABLE_CALLBACKS");
    const stat = new Set(objKeys("REALTIME_STATIC_TABLES"));
    const wired = [...rt.matchAll(/\bwire\(\s*["']([a-z_][a-z0-9_]*)["']/g)].map((m) => m[1]);
    const problems = [];
    for (const t of new Set([...live, ...wired])) {
      if (stat.has(t) && !live.includes(t)) continue;   // wired but intentionally not live (callback omitted)
      if (!published.has(t)) problems.push(`"${t}" is subscribed but not in the supabase_realtime publication (no migration adds it)`);
    }
    for (const t of wired) if (!live.includes(t) && !stat.has(t)) problems.push(`wire("${t}") is in neither REALTIME_TABLE_CALLBACKS nor REALTIME_STATIC_TABLES`);
    for (const t of live) if (!wired.includes(t)) problems.push(`REALTIME_TABLE_CALLBACKS has "${t}" but nothing wire()s it`);
    for (const [t, w] of used.table) if (!live.includes(t) && !stat.has(t)) problems.push(`table "${t}" (read in ${w}) is neither live nor listed in REALTIME_STATIC_TABLES — screens will go stale`);
    const channels = [...rt.matchAll(/\.channel\(/g)].length + files.filter((f) => f !== rtPath && /\.channel\(/.test(code.get(f))).length;
    if (channels !== 1) problems.push(`expected exactly one realtime channel (src/realtime/useRealtimeTables.js), found ${channels} .channel( call sites`);
    if (!/removeChannel\(/.test(rt)) problems.push("useRealtimeTables never calls removeChannel — subscriptions leak on re-render");
    if (!/makeCoalescer\(/.test(rt)) problems.push("realtime events are not coalesced (refetch storm with 300 users)");
    if (!/CHANNEL_ERROR|TIMED_OUT/.test(rt)) problems.push("no CHANNEL_ERROR / TIMED_OUT handling (no catch-up after reconnect)");
    report("db", "realtime: subscribed tables are published; one deduped channel with coalescing + reconnect catch-up", problems, { detail: `${live.length} live tables, ${published.size} published` });
  }
}

// ═══ env ═══════════════════════════════════════════════════════════════════
if (ONLY.includes("env")) {
  const usedVars = new Map();
  const scan = (f, src) => { for (const m of src.matchAll(/(?:import\.meta\.env|process\.env|\benv)\s*\.\s*(VITE_[A-Z0-9_]+)\b|loadEnv\([^)]*\)|\[\s*["'](VITE_[A-Z0-9_]+)["']\s*\]/g)) { const v = m[1] || m[2]; if (v && !usedVars.has(v)) usedVars.set(v, rel(f)); } };
  for (const f of files) scan(f, code.get(f));
  const vc = resolve(ROOT, "vite.config.js");
  if (existsSync(vc)) scan(vc, codeOnly(readFileSync(vc, "utf8")));
  const docs = [".env.example", "prep/env-template"].map((p) => resolve(ROOT, p)).filter(existsSync);
  const problems = [];
  if (!docs.length) problems.push(".env.example is missing");
  for (const d of docs) {
    const body = readFileSync(d, "utf8");
    for (const [v, w] of usedVars) if (!new RegExp(`^\\s*#?\\s*${v}\\s*=`, "m").test(body)) problems.push(`${v} (read in ${w}) is not documented in ${rel(d)}`);
  }
  report("env", "every VITE_* variable read by the app is documented", problems, { detail: `${usedVars.size} vars: ${[...usedVars.keys()].join(", ")}` });
  const leaked = files.filter((f) => /service_role|SERVICE_ROLE_KEY|sb_secret_/i.test(code.get(f).replace(/["']service_role["']/g, ""))).map(rel);
  report("env", "no service-role key reference in browser code", leaked);
}

// ═══ bundle ════════════════════════════════════════════════════════════════
if (ONLY.includes("bundle")) {
  const KB = 1024;
  const MAIN_RAW = Number(process.env.HEALTH_MAIN_RAW_KB || 1600) * KB;
  const MAIN_GZ = Number(process.env.HEALTH_MAIN_GZ_KB || 420) * KB;
  const FIRST_GZ = Number(process.env.HEALTH_FIRST_GZ_KB || 600) * KB;
  const html = join(DIST, "index.html");
  if (!existsSync(html)) {
    report("bundle", "main chunk within budget", REQUIRE_DIST ? [`no build at ${rel(DIST) || DIST} — run npm run build first`] : [], { skip: !REQUIRE_DIST, detail: "no dist/ (run npm run build, then npm run health)" });
  } else {
    const h = readFileSync(html, "utf8");
    const entry = (h.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/) || h.match(/<script[^>]+src="([^"]+\.js)"/) || [])[1];
    const preloads = [...h.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)].map((m) => m[1]);
    const css = [...h.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
    const size = (u) => { const p = join(DIST, u.replace(/^\//, "")); if (!existsSync(p)) return null; const b = readFileSync(p); return { raw: b.length, gz: gzipSync(b, { level: 9 }).length }; };
    const kb = (n) => `${(n / KB).toFixed(0)} KB`;
    if (!entry) report("bundle", "main chunk within budget", ["dist/index.html has no module entry script"]);
    else {
      const e = size(entry);
      const first = [entry, ...preloads, ...css].map(size).filter(Boolean);
      const firstGz = first.reduce((n, s) => n + s.gz, 0);
      const p = [];
      if (!e) p.push(`entry ${entry} missing from dist`);
      else {
        if (e.raw > MAIN_RAW) p.push(`main chunk ${kb(e.raw)} > ${kb(MAIN_RAW)}`);
        if (e.gz > MAIN_GZ) p.push(`main chunk gzip ${kb(e.gz)} > ${kb(MAIN_GZ)}`);
      }
      report("bundle", `main chunk ≤ ${kb(MAIN_RAW)} raw / ${kb(MAIN_GZ)} gzip`, p, { detail: e ? `${kb(e.raw)} raw / ${kb(e.gz)} gzip (${entry})` : "" });
      report("bundle", `first download (entry + preloads + css) ≤ ${kb(FIRST_GZ)} gzip`, firstGz > FIRST_GZ ? [`${kb(firstGz)} > ${kb(FIRST_GZ)}`] : [], { detail: `${kb(firstGz)} gzip in ${first.length} files` });
      const heavy = [entry, ...preloads].filter((u) => /charts|xlsx/i.test(u));
      report("bundle", "recharts / xlsx stay out of the first download", heavy.map((u) => `${u} is preloaded`));
    }
  }
}

// ── output ─────────────────────────────────────────────────────────────────
function tarjan(nodes, next) {
  let index = 0; const st = [], on = new Set(), idx = new Map(), low = new Map(), out = [];
  const strong = (v) => {
    idx.set(v, index); low.set(v, index); index++; st.push(v); on.add(v);
    for (const w of next(v) || []) {
      if (!idx.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) { const c = []; let w; do { w = st.pop(); on.delete(w); c.push(w); } while (w !== v); out.push(c); }
  };
  for (const v of nodes) if (!idx.has(v)) strong(v);
  return out;
}

const W = Math.min(88, Math.max(...results.map((r) => r.check.length)) + 2);
console.log(`\nSHANTAZ ERP health check — ${rel(ROOT) || "."} (${files.length} source files)\n`);
console.log("GROUP    " + "CHECK".padEnd(W) + "RESULT  DETAIL");
console.log("-".repeat(9 + W + 8 + 30));
for (const r of results) {
  console.log(r.group.padEnd(9) + r.check.slice(0, W - 1).padEnd(W) + r.status.padEnd(8) + (r.detail || ""));
  for (const p of r.problems.slice(0, 15)) console.log(" ".repeat(9) + "  ✗ " + p);
  if (r.problems.length > 15) console.log(" ".repeat(9) + `  … ${r.problems.length - 15} more`);
}
const fails = results.filter((r) => r.status === "FAIL").length;
const warns = results.filter((r) => r.status === "WARN").length;
console.log(`\n${fails ? "FAIL" : "PASS"} — ${results.length} checks, ${fails} failed, ${warns} warnings, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ ok: !fails, results }, null, 2));
process.exit(fails ? 1 : 0);
