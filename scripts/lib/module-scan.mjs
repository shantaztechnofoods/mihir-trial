// SHANTAZ ERP — static scanner for module folders (folder-replace releases).
//
// Read-only. Given a repo root (Trial or a Live clone) it answers, from the
// code itself (no browser, no build):
//   * which files a module folder imports outside itself — other modules (and
//     the names it takes from their index.js), core files (src/shared,
//     src/stores, src/utils, src/auth, src/config, src/realtime, src/supabase),
//     npm packages;
//   * which App.jsx functions (handle*, goToPage, logAudit, …) are wired into
//     the components App.jsx mounts from that module (resolving guarded.* and
//     outwardPageProps), and the prop names App.jsx passes;
//   * the core import closure (core files → core files → npm packages).
// Used by scripts/module-manifest.mjs, scripts/module-check.mjs,
// scripts/core-package.mjs and tests/moduleManifest.test.mjs.
import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";

export const CORE_DIRS = ["shared", "stores", "utils", "auth", "config", "realtime", "supabase"];
const CODE_RE = /\.(m?js|jsx)$/;

const read = (root, rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (root, rel) => fs.existsSync(path.join(root, rel));
const isFile = (root, rel) => { try { return fs.statSync(path.join(root, rel)).isFile(); } catch { return false; } };

export function walk(root, dir) {
  if (!exists(root, dir)) return [];
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(root, `${dir}/${e.name}`) : [`${dir}/${e.name}`]))
    .sort();
}

export function listModules(root) {
  if (!exists(root, "src/modules")) return [];
  return fs.readdirSync(path.join(root, "src/modules"), { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

// Remove comments (keeps strings) so commented-out imports are not counted.
function stripComments(code) {
  let out = "";
  let i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i], d = code[i + 1];
    if (c === "/" && d === "/") { while (i < n && code[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { i += 2; while (i < n && !(code[i] === "*" && code[i + 1] === "/")) { if (code[i] === "\n") out += "\n"; i++; } i += 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c; out += c; i++;
      while (i < n && code[i] !== q) { if (code[i] === "\\") { out += code[i++]; } out += code[i++]; }
      out += code[i++] || "";
      continue;
    }
    out += c; i++;
  }
  return out;
}

function parseBindings(clause) {
  // clause: text between `import` and `from`
  const names = [];
  const c = clause.trim();
  if (!c) return names;
  const brace = c.match(/\{([^}]*)\}/);
  if (brace) {
    for (const part of brace[1].split(",")) {
      const p = part.trim().replace(/^type\s+/, "");
      if (!p) continue;
      names.push(p.split(/\s+as\s+/)[0].trim());
    }
  }
  const rest = c.replace(/\{[^}]*\}/, "").replace(/,/g, " ").trim();
  if (/\*\s+as\s+\w+/.test(rest)) names.push("*");
  else if (rest && /^[A-Za-z_$][\w$]*$/.test(rest.split(/\s+/)[0])) names.push("default");
  return names;
}

// Every import / re-export / dynamic import in a file: [{ spec, names }]
export function parseImports(code) {
  const src = stripComments(code);
  const out = [];
  const stat = /^[ \t]*import\s+([\s\S]*?)\s+from\s*(["'])([^"']+)\2/gm;
  for (const m of src.matchAll(stat)) out.push({ spec: m[3], names: parseBindings(m[1]) });
  for (const m of src.matchAll(/^[ \t]*import\s*(["'])([^"']+)\1/gm)) out.push({ spec: m[2], names: [] });
  for (const m of src.matchAll(/^[ \t]*export\s+(\*|\{[^}]*\})\s*from\s*(["'])([^"']+)\2/gm)) {
    out.push({ spec: m[3], names: m[1] === "*" ? ["*"] : parseBindings(m[1]), reexport: true });
  }
  // const { a, b } = await import("x") → names a, b; any other import("x") → "*"
  const destructured = new Map();
  for (const m of src.matchAll(/\{([^{}]*)\}\s*=\s*await\s+import\(\s*(["'])([^"']+)\2\s*\)/g)) {
    destructured.set(m.index + m[0].indexOf("import("), m[1].split(",").map((x) => x.trim().split(/\s*:\s*/)[0]).filter(Boolean));
  }
  for (const m of src.matchAll(/\bimport\(\s*(["'])([^"']+)\1\s*\)/g)) {
    out.push({ spec: m[2], names: destructured.get(m.index) || ["*"], dynamic: true });
  }
  return out;
}

// Names a file exports.
export function parseExports(code) {
  const src = stripComments(code);
  const names = new Set();
  for (const m of src.matchAll(/^[ \t]*export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^[ \t]*export\s+default\b/gm)) names.add("default");
  for (const m of src.matchAll(/^[ \t]*export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(",")) {
      const p = part.trim();
      if (!p) continue;
      const as = p.split(/\s+as\s+/);
      names.add((as[1] || as[0]).trim());
    }
  }
  if (/^[ \t]*export\s+\*\s+from/m.test(src)) names.add("*");
  return names;
}

export function npmName(spec) {
  if (spec.startsWith("node:") || builtinModules.includes(spec.split("/")[0])) return null;
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

// Resolve a relative import to a repo-relative file path (or the raw guess).
export function resolveRel(root, fromFile, spec) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  for (const cand of [base, `${base}.js`, `${base}.jsx`, `${base}/index.js`, `${base}/index.jsx`]) {
    if (isFile(root, cand)) return cand;
  }
  return base;
}

// Classify a resolved repo path.
export function classify(rel) {
  let m = rel.match(/^src\/modules\/([^/]+)\/(.+)$/);
  if (m) return { kind: "module", module: m[1], file: m[2] };
  m = rel.match(/^src\/app\//);
  if (m) return { kind: "app" };
  m = rel.match(/^src\/([^/]+)\//);
  if (m && CORE_DIRS.includes(m[1])) return { kind: "core", group: m[1] };
  if (/^src\/[^/]+\.css$/.test(rel)) return { kind: "core", group: "css" };
  return { kind: "other" };
}

// All imports a module folder makes outside itself.
export function scanModuleFolder(root, mod) {
  const dir = `src/modules/${mod}`;
  const files = walk(root, dir);
  const res = { files, dependsOn: {}, deepImports: [], core: {}, coreNames: {}, npm: new Set(), app: [], other: [], missing: [] };
  for (const f of files.filter((x) => CODE_RE.test(x))) {
    for (const imp of parseImports(read(root, f))) {
      if (!imp.spec.startsWith(".")) {
        const n = npmName(imp.spec);
        if (n) res.npm.add(n);
        continue;
      }
      const to = resolveRel(root, f, imp.spec);
      if (to.startsWith(`${dir}/`)) continue;
      if (!isFile(root, to)) res.missing.push(`${f} -> ${imp.spec}`);
      const c = classify(to);
      if (c.kind === "module") {
        const set = (res.dependsOn[c.module] ||= new Set());
        imp.names.forEach((x) => set.add(x));
        if (c.file !== "index.js") res.deepImports.push(`${f} -> ${to}`);
      } else if (c.kind === "core") {
        (res.core[c.group] ||= new Set()).add(to);
        const set = (res.coreNames[to] ||= new Set());
        imp.names.forEach((x) => set.add(x));
      } else if (c.kind === "app") res.app.push(`${f} -> ${to}`);
      else res.other.push(`${f} -> ${to}`);
    }
  }
  return res;
}

// Core closure: every core file reachable from `start` core files (following
// relative imports that stay in core), plus the npm packages they import.
export function coreClosure(root, start) {
  const seen = new Set();
  const npm = new Set();
  const outside = [];
  const queue = [...start];
  while (queue.length) {
    const f = queue.shift();
    if (seen.has(f)) continue;
    seen.add(f);
    if (!isFile(root, f) || !CODE_RE.test(f)) continue;
    for (const imp of parseImports(read(root, f))) {
      if (!imp.spec.startsWith(".")) { const n = npmName(imp.spec); if (n) npm.add(n); continue; }
      const to = resolveRel(root, f, imp.spec);
      const c = classify(to);
      if (c.kind === "core") queue.push(to);
      else outside.push(`${f} -> ${to}`);
    }
  }
  return { files: [...seen].sort(), npm: [...npm].sort(), outside };
}

// ── App.jsx wiring ──────────────────────────────────────────────────────────
// Functions declared in the App component body (two-space indent) — the
// "handlers" a module's pages receive as props.
export function appFunctions(appCode) {
  const names = new Set();
  for (const m of appCode.matchAll(/^ {2}(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:React\.)?(?:useCallback\(\s*)?(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/gm)) names.add(m[1]);
  for (const m of appCode.matchAll(/^ {2}(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  return names;
}

// Text of an object literal / JSX element starting at `start` (balanced braces).
function balanced(code, start, open, close) {
  let depth = 0;
  for (let i = start; i < code.length; i++) {
    if (code[i] === open) depth++;
    else if (code[i] === close) { depth--; if (depth === 0) return code.slice(start, i + 1); }
  }
  return code.slice(start);
}

// One JSX element's opening tag (attributes incl. nested JSX in {...}).
function jsxElementAt(code, start) {
  let depth = 0;
  for (let i = start + 1; i < code.length; i++) {
    const ch = code[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (depth === 0 && ch === ">") return code.slice(start, i + 1);
  }
  return code.slice(start);
}

function objectAfter(code, re) {
  const m = re.exec(code);
  if (!m) return "";
  const at = code.indexOf("{", m.index + m[0].length - 1);
  return balanced(code, at, "{", "}");
}

// Names the App shell imports from each module (static and lazy imports).
export function appModuleImports(root, appRel = "src/app/App.jsx") {
  const out = {};
  if (!isFile(root, appRel)) return out;
  const code = read(root, appRel);
  for (const imp of parseImports(code)) {
    if (!imp.spec.startsWith(".")) continue;
    const to = resolveRel(root, appRel, imp.spec);
    const c = classify(to);
    if (c.kind === "app" && !imp.dynamic && isFile(root, to)) { appLazyHelper(root, to, imp.names, out); continue; }
    if (c.kind !== "module") continue;
    const e = (out[c.module] ||= { names: new Set(), files: new Set(), lazy: [] });
    e.files.add(c.file);
    if (imp.dynamic) {
      // const X = React.lazy(() => …import("…/File.jsx")…) — record X
      const lineRe = new RegExp(`(?:export\\s+)?const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*React\\.lazy\\([^\\n]*import\\(\\s*["']${imp.spec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`);
      const lm = code.match(lineRe);
      if (lm) e.lazy.push(lm[1]);
    } else imp.names.forEach((n) => e.names.add(n));
  }
  return out;
}

// A shell helper such as src/app/lazyPages.js that wraps module imports in
// React lazy(): `key: () => import("…/index.js")` loaders, then
// `export const X = page("key", …)` or `export const X = lazy(… import("…") …)`.
// The names App.jsx imports from it count as names imported from that module.
function appLazyHelper(root, rel, wanted, out) {
  const code = stripComments(read(root, rel));
  const modOf = (spec) => { const c = classify(resolveRel(root, rel, spec)); return c.kind === "module" ? c : null; };
  const byKey = {};
  for (const m of code.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:\s*\(\)\s*=>\s*import\(\s*["']([^"']+)["']\s*\)/gm)) byKey[m[1]] = modOf(m[2]);
  const add = (name, c) => {
    if (!c || !wanted.includes(name)) return;
    const e = (out[c.module] ||= { names: new Set(), files: new Set(), lazy: [] });
    e.files.add(c.file); e.lazy.push(name);
  };
  for (const m of code.matchAll(/^export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*[A-Za-z_$][\w$]*\(\s*["']([^"']+)["']/gm)) add(m[1], byKey[m[2]]);
  for (const m of code.matchAll(/^export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:React\.)?lazy\([^\n]*import\(\s*["']([^"']+)["']/gm)) add(m[1], modOf(m[2]));
}

// For each module: the App.jsx functions and props wired into the components
// App.jsx imports from it.
export function appWiring(root, appRel = "src/app/App.jsx") {
  const out = {};
  if (!isFile(root, appRel)) return out;
  const code = stripComments(read(root, appRel));
  const fns = appFunctions(code);
  const imports = appModuleImports(root, appRel);
  const guardedTxt = objectAfter(code, /\n\s*const guarded\s*=\s*\{/g);
  const guardMap = {};
  for (const m of guardedTxt.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:\s*G\.guard\([\s\S]*?,\s*([A-Za-z_$][\w$]*)\)\s*,?\s*$/gm)) guardMap[m[1]] = m[2];
  const spreads = {};
  for (const m of code.matchAll(/\n\s*const\s+([A-Za-z_$][\w$]*Props)\s*=\s*\{/g)) {
    spreads[m[1]] = objectAfter(code.slice(m.index), /const\s+[A-Za-z_$][\w$]*Props\s*=\s*\{/g);
  }
  const fnsIn = (txt, acc, depth = 0) => {
    for (const m of txt.matchAll(/\bguarded\.([A-Za-z_$][\w$]*)/g)) if (guardMap[m[1]]) acc.add(guardMap[m[1]]);
    for (const m of txt.matchAll(/[A-Za-z_$][\w$]*/g)) if (fns.has(m[0])) acc.add(m[0]);
    if (depth < 3) for (const m of txt.matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*Props)\b/g)) if (spreads[m[1]]) fnsIn(spreads[m[1]], acc, depth + 1);
    return acc;
  };
  const topKeys = (obj) => {
    const keys = new Set();
    let depth = 0;
    let expectKey = false;
    for (let i = 0; i < obj.length; i++) {
      const ch = obj[i];
      if ("({[".includes(ch)) { depth++; if (depth === 1) expectKey = true; continue; }
      if (")}]".includes(ch)) { depth--; continue; }
      if (depth !== 1) continue;
      if (ch === ",") { expectKey = true; continue; }
      if (expectKey && /[A-Za-z_$]/.test(ch)) {
        const m = obj.slice(i).match(/^([A-Za-z_$][\w$]*)\s*(?=[:,}\n])/);
        if (m) keys.add(m[1]);
        expectKey = false;
      } else if (expectKey && !/\s/.test(ch)) expectKey = false;
    }
    return keys;
  };
  // Prop names on one JSX opening tag (top level only; a spread {...xProps}
  // contributes that object's top-level keys).
  const propsIn = (tag) => {
    const props = new Set();
    let depth = 0;
    let buf = "";
    for (let i = 0; i < tag.length; i++) {
      const ch = tag[i];
      if (ch === "{") {
        if (depth === 0) {
          const sm = tag.slice(i).match(/^\{\s*\.\.\.\s*([A-Za-z_$][\w$]*)\s*\}/);
          if (sm) {
            props.add(`...${sm[1]}`);
            if (spreads[sm[1]]) topKeys(spreads[sm[1]]).forEach((k) => props.add(k));
          }
          buf += " ";
        }
        depth++;
        continue;
      }
      if (ch === "}") { depth--; if (depth === 0) buf += " "; continue; }
      if (depth === 0) buf += ch;
    }
    for (const m of buf.matchAll(/\s([A-Za-z_$][\w$]*)(?==|\s|\/|>)/g)) props.add(m[1]);
    return props;
  };
  for (const [mod, e] of Object.entries(imports)) {
    const comps = [...e.names, ...e.lazy].filter((n) => /^[A-Z]/.test(n));
    const w = (out[mod] ||= { handlers: new Set(), mounts: {}, shellNames: new Set([...e.names, ...e.lazy]) });
    for (const comp of comps) {
      const re = new RegExp(`<${comp}(?=[\\s/>])`, "g");
      for (const m of code.matchAll(re)) {
        const tag = jsxElementAt(code, m.index);
        fnsIn(tag, w.handlers);
        const p = (w.mounts[comp] ||= new Set());
        propsIn(tag.slice(comp.length + 1)).forEach((x) => p.add(x));
      }
    }
  }
  return out;
}

// ── Phase C: handlers.js + the App shell object ─────────────────────────────
// (docs/FOLDER-REPLACE.md §7, docs/SHELL-CONTEXT.md)
const idList = (txt) => txt.split(",").map((x) => x.trim()).filter(Boolean);

// Keys of `  const shell = { … };` in App.jsx (shorthand keys only), or null.
export function shellObjectKeys(appCode) {
  const m = appCode.match(/^ {2}const shell = \{\s*\n([\s\S]*?)^ {2}\};/m);
  if (!m) return null;
  return idList(m[1].split("\n").filter((l) => !/^\s*\/\//.test(l)).join(","));
}

// Names App.jsx takes from each createXxxHandlers(shell) call: { createXxxHandlers: [names] }.
export function appFactoryCalls(appCode) {
  const out = {};
  for (const m of appCode.matchAll(/^ {2}const \{([^}]*)\} = (create[A-Z][\w$]*Handlers)\(shell\);/gm)) out[m[2]] = idList(m[1].replace(/\/\/.*$/gm, ""));
  return out;
}

// A module's handlers.js: factory name, shell keys it destructures, names it returns.
export function handlerFactory(code) {
  const f = code.match(/^export function (create[A-Z][\w$]*Handlers)\(shell\) \{/m);
  if (!f) return null;
  const k = code.match(/^ {2}const \{([^}]*)\} = shell;/m);
  const r = [...code.matchAll(/^ {2}return \{([^}]*)\};/gm)].pop();
  const strip = (t) => t.replace(/\/\/.*$/gm, "");
  return { factory: f[1], shellKeys: k ? idList(strip(k[1])) : [], returns: r ? idList(strip(r[1])) : [] };
}

export function moduleHandlerFactory(root, mod) {
  const rel = `src/modules/${mod}/handlers.js`;
  return isFile(root, rel) ? handlerFactory(read(root, rel)) : null;
}

// ── manifest ────────────────────────────────────────────────────────────────
const sorted = (s) => [...s].sort();

// The fields of MODULE.json that come from the code (must match exactly).
export function derivedManifest(root, mod) {
  const scan = scanModuleFolder(root, mod);
  const wiring = appWiring(root)[mod];
  const core = {};
  for (const g of Object.keys(scan.core).sort()) core[g] = sorted(scan.core[g]).map((f) => f.replace(/^src\//, ""));
  const dependsOn = {};
  for (const m of Object.keys(scan.dependsOn).sort()) dependsOn[m] = sorted(scan.dependsOn[m]);
  const indexRel = `src/modules/${mod}/index.js`;
  const fac = moduleHandlerFactory(root, mod);
  return {
    exports: isFile(root, indexRel) ? sorted(parseExports(read(root, indexRel))) : [],
    dependsOn,
    handlers: wiring ? sorted(wiring.handlers) : [],
    // Phase C: handlers that live in this folder's handlers.js (only when it exists)
    ...(fac ? { ownHandlers: sorted(fac.returns) } : {}),
    stores: core.stores || [],
    shared: core.shared || [],
    core: Object.fromEntries(Object.entries(core).filter(([g]) => g !== "stores" && g !== "shared")),
    npm: sorted(scan.npm),
  };
}

export const DERIVED_KEYS = ["exports", "dependsOn", "handlers", "stores", "shared", "core", "npm"];
export const DECLARED_KEYS = ["name", "version", "frozen", "liveLock", "requiresCore", "migrations", "edgeFunctions", "serverless", "notes"];
// Present only in a folder that has handlers.js (Phase C): derived ownHandlers, declared requiresShell.
export const OPTIONAL_DERIVED_KEYS = ["ownHandlers"];
export const OPTIONAL_DECLARED_KEYS = ["requiresShell"];

// SHELL_API of a checkout (0 = no shell object yet, before Phase C).
export function shellApiVersion(root) {
  const rel = "src/app/shellVersion.js";
  if (!isFile(root, rel)) return 0;
  const m = read(root, rel).match(/export\s+const\s+SHELL_API\s*=\s*(\d+)/);
  return m ? Number(m[1]) : 0;
}

export function readManifest(root, mod) {
  const rel = `src/modules/${mod}/MODULE.json`;
  return isFile(root, rel) ? JSON.parse(read(root, rel)) : null;
}

// Edge Function names a folder calls directly (functions.invoke("x")).
export function directEdgeCalls(root, mod) {
  const names = new Set();
  for (const f of walk(root, `src/modules/${mod}`).filter((x) => CODE_RE.test(x))) {
    for (const m of read(root, f).matchAll(/functions\.invoke\(\s*["']([^"']+)["']/g)) names.add(m[1]);
  }
  return names;
}

// CORE_VERSION of a checkout (0 = before core versioning existed).
export function coreVersion(root) {
  const rel = "src/shared/coreVersion.js";
  if (!isFile(root, rel)) return 0;
  const m = read(root, rel).match(/export\s+const\s+CORE_VERSION\s*=\s*(\d+)/);
  return m ? Number(m[1]) : 0;
}

// Edge Functions reached through the core functions a folder imports
// (e.g. stores/adminApi.js `export const driveBackup = … callFn("drive-backup")`).
export function edgeCallsViaImports(root, mod) {
  const scan = scanModuleFolder(root, mod);
  const names = new Set();
  for (const [file, used] of Object.entries(scan.coreNames)) {
    if (!isFile(root, file) || !CODE_RE.test(file)) continue;
    const chunks = stripComments(read(root, file)).split(/^(?=export\s)/m);
    for (const ch of chunks) {
      const m = ch.match(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/);
      if (!m || !(used.has(m[1]) || used.has("*"))) continue;
      for (const c of ch.matchAll(/(?:callFn|functions\.invoke)\(\s*["']([a-z0-9-]+)["']/g)) names.add(c[1]);
    }
  }
  return names;
}

// Source text of one App-body function (from its `  const name =` line to the
// line before the next two-space-indented statement). Used to say which
// handler bodies differ between two checkouts (info only).
export function appFunctionSource(appCode, name) {
  const lines = appCode.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^ {2}(?:const|let|(?:async\\s+)?function)\\s+${name}\\b`).test(l));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !/^ {2}[^\s})\]]/.test(lines[end])) end++;
  return lines.slice(start, end).join("\n").trimEnd();
}
