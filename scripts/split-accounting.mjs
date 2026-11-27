#!/usr/bin/env node
// SHANTAZ ERP — proof that the module-folder split (2026-11-04) is a PURE MOVE.
//
//   node scripts/split-accounting.mjs [base-ref] [--write]
//
// base-ref  a commit whose src/App.jsx is the single-file ERP the split was
//           generated from (default: origin/main). --write also saves the
//           report to docs/SPLIT-ACCOUNTING.md.
//
// What it proves (exit code 1 if any check fails):
//  1. Every line of the old src/App.jsx appears in the new files exactly as
//     many times as before, and no new file has a line that was not in
//     App.jsx. Compared as a normalised line MULTISET:
//       * import statements are left out on both sides (they are regenerated
//         per file — each file imports what it uses);
//       * a leading `export ` on a declaration is ignored (the split adds it);
//       * inside a dynamic import("./…/File.jsx") only the file name is
//         compared (the path is re-pointed to the file's new folder; section 2
//         proves the moved target file itself is unchanged);
//       * the two-line "moved verbatim" header of each new file is ignored;
//       * the VALUE of `const APP_BUILD = "…"` is ignored (the build tag is
//         bumped on every ship; the line itself must still exist), and so is
//         the value of `const SHELL_API = N` (src/app/shellVersion.js);
//       * blank lines and trailing spaces are ignored.
//     "New files" = every file under src/ that carries the header line
//     "moved verbatim from the former single-file src/App.jsx".
//  2. Every whole file moved with git mv (src/pages/*, src/components/*) is
//     identical to its old version apart from import lines (and, as in 1,
//     the folder part of a dynamic import("./…/File.jsx") — only the file
//     name is compared, e.g. LoginPage's lazy LoginBrand3D import).
//  3. Each module index.js holds only `export { … } from "./…";` lines (no
//     logic hides in a barrel).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const BASE = args.find((a) => !a.startsWith("--")) || "origin/main";
const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const HEADER = "moved verbatim from the former single-file src/App.jsx";

// ── module-move mode (base is already on the module-folder layout) ─────────
// `node scripts/split-accounting.mjs <base>` where <base> has no src/App.jsx
// (any commit after the 2026-11-04 split). Proves a later move between
// folders / re-pointed imports is pure:
//  A. Across all of src/**/*.{js,jsx,mjs}: the multiset of non-import code
//     lines at <base> equals the one in the working tree, after the same
//     normalisation as above, plus:
//       * `import("…/index.js").then((m) => ({ default: m.X }))` counts as
//         `import("F")` where index.js says `export { default as X } from "./F"`
//         (a lazy import re-pointed through the module's public index.js);
//       * comment-only lines are not code (changed ones are counted as info).
//  B. A NEW code file is allowed only if nothing in src imports it (so it
//     cannot change the bundle, e.g. a metadata constant read by scripts).
//     Exception (folder-replace Phase C, docs/FOLDER-REPLACE.md §7): a new
//     src/modules/<m>/handlers.js imported ONLY by src/app/App.jsx — its
//     lines are counted in A (they are the handler bodies moved out of
//     src/app/App.jsx). App.jsx imports it directly, not through index.js,
//     so the module's lazily loaded pages stay out of the main bundle.
//  C. Every module index.js still holds only re-exports.
//  D. Phase C wiring lines are the only lines allowed to be new, and only in
//     these exact shapes (the block interiors may hold only identifier lists,
//     so no logic can hide in them):
//       src/app/App.jsx        `  const shell = {` … `  };`  (shorthand keys only)
//                              `  const { a, b } = createXxxHandlers(shell);` (one or more lines)
//       src/modules/*/handlers.js
//                              `export function createXxxHandlers(shell) {`
//                              `  const { a, b } = shell;` (one or more lines)
//                              `  return { a, b };` (one or more lines) and the closing `}`
//     shell.call (docs/SHELL-CONTEXT.md "Cross-module calls", SHELL_API 5):
//       src/app/App.jsx        `  const shellRegistry = {};`, `  const call = makeShellCall(shellRegistry);`,
//                              `  Object.assign(shellRegistry, { "m.name": handleX, … });` (one line, or a
//                              block whose interior lines are only `"m.name": handleX,` pairs)
//       src/modules/*/handlers.js (inside the factory)
//                              `  const handleX = (...args) => call("m.name", ...args);` (adapter)
//       src/app/shellCall.js   new file imported only by App.jsx whose code lines equal SHELL_CALL_SRC below
//     hooks (a handler that uses a React hook, e.g. useCallback — it must run before App's
//     auth-gate early returns, where the shell object does not exist yet; SHELL_API 8):
//       src/app/App.jsx        `  const { a } = useXxxHooks({ b, c });` (identifier lists only)
//       src/modules/*/hooks.js imported only by App.jsx: `export function useXxxHooks(hookShell) {`
//                              `  const { b, c } = hookShell;`, `  return { a };` and the closing `}`
//     src/app/shellVersion.js is metadata (nothing in src imports it; scripts/tests read
//     SHELL_API / SHELL_CALLS): left out of A on both sides while that holds.
const SHELL_CALL_SRC = [
  "export function makeShellCall(registry) {",
  "  return (name, ...args) => {",
  "    const fn = registry[name];",
  "    if (typeof fn !== \"function\") throw new Error(`shell.call: unknown \"${name}\"`);",
  "    return fn(...args);",
  "  };",
  "}",
];
const CALL_PAIRS = /^"[a-z][\w-]*\.[A-Za-z][\w$]*"\s*:\s*[A-Za-z_$][\w$]*(\s*,\s*"[a-z][\w-]*\.[A-Za-z][\w$]*"\s*:\s*[A-Za-z_$][\w$]*)*\s*,?$/;
const CALL_PAIR_LINE = /^\s*"[a-z][\w-]*\.[A-Za-z][\w$]*"\s*:\s*[A-Za-z_$][\w$]*\s*,?\s*$/;
const IDS_LINE = /^\s*[A-Za-z_$][\w$]*(\s*,\s*[A-Za-z_$][\w$]*)*\s*,?\s*$/;
const IDS_INLINE = /^[A-Za-z_$][\w$]*(\s*,\s*[A-Za-z_$][\w$]*)*\s*,?$/;
// Returns { keep: lines still counted, wiring: lines taken out (allowed shapes), bad: problems }.
function phaseCWiring(file, lines) {
  const keep = [], wiring = [], bad = [];
  const isApp = file === "src/app/App.jsx";
  const isHooks = /^src\/modules\/[^/]+\/hooks\.js$/.test(file);
  const isHandlers = /^src\/modules\/[^/]+\/handlers\.js$/.test(file) || isHooks;
  const FACTORY = isHooks ? /^export function use[A-Z][\w$]*Hooks\(hookShell\) \{\s*$/ : /^export function create[A-Z][\w$]*Handlers\(shell\) \{\s*$/;
  const SRC = isHooks ? "hookShell" : "shell";
  const code = (l) => !/^\s*(\/\/|\/\*|\*)/.test(l) && l.trim() !== "";
  // A multi-line `<open>` … `<close>` block whose interior is identifier lists only.
  const block = (i, closeRe) => {
    let j = i + 1;
    while (j < lines.length && !closeRe.test(lines[j])) {
      if (code(lines[j]) && !IDS_LINE.test(lines[j])) return { end: -1, why: `non-identifier line inside a wiring block: ${lines[j].trim()}` };
      j++;
    }
    return j < lines.length ? { end: j } : { end: -1, why: "wiring block is not closed" };
  };
  let factoryOpen = false, closingSeen = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m;
    if (isApp && /^ {2}const shell = \{\s*$/.test(l)) {
      const b = block(i, /^ {2}\};\s*$/);
      if (b.end < 0) { bad.push(`${file}: ${b.why}`); keep.push(l); continue; }
      wiring.push(...lines.slice(i, b.end + 1).filter(code)); i = b.end; continue;
    }
    if (isApp && (/^ {2}const shellRegistry = \{\};\s*$/.test(l) || /^ {2}const call = makeShellCall\(shellRegistry\);\s*$/.test(l))) { wiring.push(l); continue; }
    if (isApp && (m = l.match(/^ {2}Object\.assign\(shellRegistry, \{\s*(.*?)\s*\}\);\s*$/)) && CALL_PAIRS.test(m[1])) { wiring.push(l); continue; }
    if (isApp && /^ {2}Object\.assign\(shellRegistry, \{\s*$/.test(l)) {
      let j = i + 1;
      while (j < lines.length && !/^ {2}\}\);\s*$/.test(lines[j])) { if (code(lines[j]) && !CALL_PAIR_LINE.test(lines[j])) break; j++; }
      if (j < lines.length && /^ {2}\}\);\s*$/.test(lines[j])) { wiring.push(...lines.slice(i, j + 1).filter(code)); i = j; continue; }
      bad.push(`${file}: shellRegistry block holds something other than "m.name": handlerName pairs`); keep.push(l); continue;
    }
    if (isApp && (m = l.match(/^ {2}const \{\s*(.*?)\s*\} = use[A-Z][\w$]*Hooks\(\{\s*(.*?)\s*\}\);\s*$/)) && IDS_INLINE.test(m[1]) && IDS_INLINE.test(m[2])) { wiring.push(l); continue; }
    if (isApp && (m = l.match(/^ {2}const \{\s*(.*?)\s*\} = create[A-Z][\w$]*Handlers\(shell\);\s*$/)) && IDS_INLINE.test(m[1])) { wiring.push(l); continue; }
    if (isApp && /^ {2}const \{\s*$/.test(l)) {
      const b = block(i, /^ {2}\} = create[A-Z][\w$]*Handlers\(shell\);\s*$/);
      if (b.end >= 0) { wiring.push(...lines.slice(i, b.end + 1).filter(code)); i = b.end; continue; }
    }
    if (isHandlers && FACTORY.test(l) && !factoryOpen) { factoryOpen = true; wiring.push(l); continue; }
    if (isHandlers && factoryOpen) {
      if ((m = l.match(new RegExp(`^ {2}const \\{\\s*(.*?)\\s*\\} = ${SRC};\\s*$`))) && IDS_INLINE.test(m[1])) { wiring.push(l); continue; }
      if ((m = l.match(/^ {2}return \{\s*(.*?)\s*\};\s*$/)) && IDS_INLINE.test(m[1])) { wiring.push(l); continue; }
      if (!isHooks && /^ {2}const [A-Za-z_$][\w$]* = \(\.\.\.args\) => call\("[a-z][\w-]*\.[A-Za-z][\w$]*", \.\.\.args\);\s*$/.test(l)) { wiring.push(l); continue; }
      if (/^ {2}(const|return) \{\s*$/.test(l)) {
        const b = block(i, new RegExp(`^ {2}(\\} = ${SRC};|\\};)\\s*$`));
        if (b.end < 0) { bad.push(`${file}: ${b.why}`); keep.push(l); continue; }
        if (/^ {2}const/.test(l) !== new RegExp(`\\} = ${SRC};`).test(lines[b.end])) { bad.push(`${file}: mismatched wiring block at line ${i + 1}`); keep.push(l); continue; }
        wiring.push(...lines.slice(i, b.end + 1).filter(code)); i = b.end; continue;
      }
      if (/^\}\s*$/.test(l) && !closingSeen && lines.slice(i + 1).every((x) => !code(x))) { closingSeen = true; wiring.push(l); continue; }
    }
    keep.push(l);
  }
  if (isHandlers && (!factoryOpen || !closingSeen)) bad.push(`${file}: expected exactly one \`export function ${isHooks ? "useXxxHooks(hookShell)" : "createXxxHandlers(shell)"} {\` … \`}\` wrapping the whole file`);
  return { keep, wiring, bad };
}

function moveMode(baseSha) {
  const say2 = (s = "") => { report.push(s); console.log(s); };
  const codeFiles = (list) => list.filter((f) => /^src\/.*\.(m?js|jsx)$/.test(f));
  const baseFiles = codeFiles(git("ls-tree", "-r", "--name-only", baseSha, "--", "src").split("\n").filter(Boolean));
  const headFiles = codeFiles(walk("src"));
  const isComment = (l) => /^\s*(\/\/|\/\*|\*)/.test(l);
  const lazyIndex = (root, file, line, readF) => line.replace(/import\((["'])([^"']*\/index\.js)\1\)\.then\(\(\s*(\w+)\s*\)\s*=>\s*\(\{\s*default:\s*\3\.(\w+)\s*\}\)\)/g, (all, q, spec, _m, name) => {
    const idx = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
    const src = readF(idx);
    const m = src && src.match(new RegExp(`export \\{\\s*default as ${name}\\s*\\} from "\\.\\/([^"]+)";`));
    return m ? `import(${q}${m[1]}${q})` : all;
  });
  const wiringLines = [], wiringBad = [];
  const linesOf = (file, code, readF, side) => {
    const code2 = [], comments = [];
    const w = phaseCWiring(file, nonImportLines(code));
    if (side === "head") { wiringLines.push(...w.wiring.map((l) => `${file}: ${l.trim()}`)); wiringBad.push(...w.bad); }
    for (const l of w.keep) {
      if (!l.trim()) continue;
      if (isComment(l)) { comments.push(l.trim()); continue; }
      code2.push(norm(lazyIndex(".", file, l, readF)));
    }
    return { code: code2, comments };
  };
  const readBase = (f) => { try { return git("show", `${baseSha}:${f}`); } catch { return null; } };
  const readHead = (f) => (fs.existsSync(path.join(ROOT, f)) ? fs.readFileSync(path.join(ROOT, f), "utf8") : null);
  // B first: new code files nothing imports are metadata, kept out of A.
  const added = headFiles.filter((f) => !baseFiles.includes(f));
  const importersOf = (f) => headFiles.filter((g) => {
    if (g === f) return false;
    const rel = path.posix.relative(path.posix.dirname(g), f).replace(/\.(m?js|jsx)$/, "");
    const spec = (rel.startsWith(".") ? rel : `./${rel}`).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`["']${spec}(?:\\.(?:m?js|jsx))?["']`).test(readHead(g));
  });
  const addedInfo = added.map((f) => ({ f, importers: importersOf(f) }));
  // Phase C: src/modules/<m>/handlers.js imported only by src/app/App.jsx is a moved-code file (counted in A).
  const ownHandlersFile = (x) => /^src\/modules\/([^/]+)\/(handlers|hooks)\.js$/.test(x.f)
    && x.importers.length === 1 && x.importers[0] === "src/app/App.jsx";
  const metadataOnly = new Set(addedInfo.filter((x) => !x.importers.length).map((x) => x.f));
  // src/app/shellVersion.js: read only by scripts/tests (SHELL_API, SHELL_CALLS) — metadata on both sides while nothing imports it
  const SV = "src/app/shellVersion.js";
  const svMeta = headFiles.includes(SV) && !importersOf(SV).length;
  if (svMeta) metadataOnly.add(SV);
  // src/app/shellCall.js: the shell.call helper, imported only by App.jsx, fixed text (SHELL_CALL_SRC)
  const SC = "src/app/shellCall.js";
  const scInfo = addedInfo.find((x) => x.f === SC);
  let scOk = null;
  if (scInfo) {
    const codeL = nonImportLines(readHead(SC)).filter((l) => l.trim() && !isComment(l)).map((l) => l.trimEnd());
    scOk = scInfo.importers.length === 1 && scInfo.importers[0] === "src/app/App.jsx" && JSON.stringify(codeL) === JSON.stringify(SHELL_CALL_SRC);
    metadataOnly.add(SC);
    if (scOk) wiringLines.push(...codeL.map((l) => `${SC}: ${l.trim()}`));
  }
  const A = [], B = [], cA = [], cB = [];
  for (const f of baseFiles.filter((x) => !(svMeta && x === SV))) { const r = linesOf(f, readBase(f), readBase, "base"); A.push(...r.code); cA.push(...r.comments); }
  for (const f of headFiles.filter((x) => !metadataOnly.has(x))) { const r = linesOf(f, readHead(f), readHead, "head"); B.push(...r.code); cB.push(...r.comments); }
  const d = diff(multiset(A), multiset(B));
  const dc = diff(multiset(cA), multiset(cB));
  let good = !d.missing.length && !d.extra.length;
  say2(`# Module move — line accounting`);
  say2();
  say2(`Generated by \`node scripts/split-accounting.mjs ${baseSha.slice(0, 12)}\` (module-move mode: base is on the module-folder layout). Exit code 0 = pure move.`);
  say2();
  say2(`## A. Code lines across src/ (imports excluded)`);
  say2();
  say2(`| | non-blank, non-import, non-comment lines |`);
  say2(`|---|---|`);
  say2(`| base | ${A.length} |`);
  say2(`| working tree (without metadata-only new files) | ${B.length} |`);
  say2(`| missing | ${d.missing.reduce((a, [c]) => a + c, 0)} |`);
  say2(`| extra | ${d.extra.reduce((a, [c]) => a + c, 0)} |`);
  for (const [c, l] of d.missing.slice(0, 40)) say2(`- MISSING ×${c}: \`${l.trim().slice(0, 140)}\``);
  for (const [c, l] of d.extra.slice(0, 40)) say2(`- EXTRA ×${c}: \`${l.trim().slice(0, 140)}\``);
  say2(`- info: comment-only lines changed: ${dc.missing.reduce((a, [c]) => a + c, 0)} removed, ${dc.extra.reduce((a, [c]) => a + c, 0)} added`);
  say2();
  say2(`## B. New code files (must not be imported by anything in src)`);
  say2();
  if (!added.length) say2(`- none`);
  for (const x of addedInfo) {
    const { f, importers } = x;
    if (x.f === SC) { if (!scOk) good = false; say2(`- ${SC}: shell.call helper — ${scOk ? "imported only by src/app/App.jsx, code lines equal the allowed text (listed in D)" : "NOT the allowed text or imported by something other than App.jsx"}`); continue; }
    if (ownHandlersFile(x)) { say2(`- ${f}: Phase C ${f.endsWith("/hooks.js") ? "hooks" : "handlers"} file, imported only by src/app/App.jsx (its lines ARE counted in A)`); continue; }
    if (importers.length) good = false;
    say2(`- ${f}: ${importers.length ? `IMPORTED by ${importers.join(", ")}` : "not imported by any src file (metadata only; its lines are not counted in A)"}`);
  }
  const removed = baseFiles.filter((f) => !headFiles.includes(f));
  if (svMeta) say2(`- ${SV}: metadata (not imported by any src file; SHELL_API / SHELL_CALLS read by scripts/tests) — left out of A on both sides`);
  if (removed.length) say2(`- removed/moved away: ${removed.join(", ")} (their lines are counted in A)`);
  say2();
  say2(`## C. Module index.js files hold only re-exports`);
  say2();
  for (const f of walk("src/modules").filter((x) => x.endsWith("/index.js")).sort()) {
    const bad = fs.readFileSync(path.join(ROOT, f), "utf8").split("\n")
      .filter((l) => l.trim() && !l.startsWith("//") && !/^export \{[^}]+\} from "\.\/[^"]+";$/.test(l));
    if (bad.length) good = false;
    say2(`- ${f}: ${bad.length ? "LOGIC FOUND: " + bad[0] : "re-exports only"}`);
  }
  say2();
  say2(`## D. Phase C wiring lines (shell object, createXxxHandlers(shell), handlers.js frame)`);
  say2();
  if (wiringBad.length) good = false;
  for (const b of wiringBad) say2(`- BAD: ${b}`);
  say2(`- ${wiringLines.length} wiring line(s) in the working tree, all in the allowed shapes (identifier lists only; not counted in A on either side)`);
  for (const l of wiringLines.filter((x) => !/^\S+: [A-Za-z_$][\w$]*(\s*,\s*[A-Za-z_$][\w$]*)*\s*,?$/.test(x))) say2(`  - \`${l.slice(0, 160)}\``);
  say2();
  say2(`**Result: ${good ? "PURE MOVE — every code line accounted for" : "FAILED — see above"}**`);
  if (WRITE) fs.writeFileSync(path.join(ROOT, "docs/MOVE-ACCOUNTING.md"), report.join("\n") + "\n");
  return good ? 0 : 1;
}

// Lines that are not part of an import statement. Import statements start at
// column 0 with `import ` and end at the line holding `from "…";` (or are a
// one-line side-effect import).
function nonImportLines(code) {
  const out = [];
  let inImport = false;
  for (const line of code.split("\n")) {
    if (!inImport && /^import\s/.test(line)) {
      if (/^import\s+["'][^"']+["'];?\s*$/.test(line) || /\bfrom\s+["'][^"']+["'];?\s*(\/\/.*)?$/.test(line)) continue;
      inImport = true;
      continue;
    }
    if (inImport) {
      if (/\bfrom\s+["'][^"']+["'];?\s*(\/\/.*)?$/.test(line)) inImport = false;
      continue;
    }
    out.push(line);
  }
  return out;
}
const dynImport = (l) => l.replace(/import\((["'])(?:\.\.?\/)+(?:[^"']*\/)?([^"'/]+)\1\)/g, "import($1$2$1)");
const norm = (l) => l
  .replace(/^export (?=(async )?(function|const|let|var|class) )/, "")
  // the build tag value is release metadata (scripts/ship.sh bump changes it on every ship)
  .replace(/^(const APP_BUILD = )"[^"]*";/, '$1"<build tag>";')
  // the shell version number is release metadata too (bumped when the Phase C shell object gains keys)
  .replace(/^(const SHELL_API = )\d+;/, "$1<shell version>;")
  .replace(/import\((["'])(?:\.\.?\/)+(?:[^"']*\/)?([^"'/]+)\1\)/g, "import($1$2$1)")
  .trimEnd();
function multiset(lines) {
  const m = new Map();
  for (const l of lines) { if (!l.trim()) continue; m.set(l, (m.get(l) || 0) + 1); }
  return m;
}
const total = (m) => [...m.values()].reduce((a, b) => a + b, 0);
function diff(a, b) {
  const missing = [], extra = [];
  for (const [l, c] of a) { const d = c - (b.get(l) || 0); if (d > 0) missing.push([d, l]); }
  for (const [l, c] of b) { const d = c - (a.get(l) || 0); if (d > 0) extra.push([d, l]); }
  return { missing, extra };
}
function walk(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
}

const report = [];
const say = (s = "") => { report.push(s); console.log(s); };
let ok = true;

// ── 1. App.jsx line multiset ────────────────────────────────────────────────
const baseSha = git("rev-parse", BASE).trim();
let oldApp;
const hasOldApp = git("ls-tree", "--name-only", baseSha, "--", "src/App.jsx").trim() === "src/App.jsx";
if (!hasOldApp) process.exit(moveMode(baseSha));
try { oldApp = git("show", `${baseSha}:src/App.jsx`); }
catch { console.error(`${BASE} has no src/App.jsx — pass the commit the split was generated from`); process.exit(2); }
const newFiles = walk("src").filter((f) => /\.(js|jsx)$/.test(f) && fs.readFileSync(path.join(ROOT, f), "utf8").includes(HEADER)).sort();
const before = multiset(nonImportLines(oldApp).map(norm));
const afterLines = [];
const perFile = [];
for (const f of newFiles) {
  const ls = nonImportLines(fs.readFileSync(path.join(ROOT, f), "utf8"))
    .filter((l) => !l.includes(HEADER) && !/^\/\/ \(module-folder split, 2026-11-04\)/.test(l)).map(norm);
  perFile.push([f, ls.filter((l) => l.trim()).length]);
  afterLines.push(...ls);
}
const after = multiset(afterLines);
const d1 = diff(before, after);
say(`# Module-folder split — line accounting`);
say();
say(`Generated by \`node scripts/split-accounting.mjs ${baseSha.slice(0, 12)} --write\` — base \`${baseSha.slice(0, 12)}\` is the last main commit with the single-file src/App.jsx (${oldApp.split("\n").length} lines). Re-run it any time; exit code 0 = pure move.`);
say();
say(`## 1. Old src/App.jsx vs the ${newFiles.length} files it was split into`);
say();
say(`| | non-blank, non-import lines |`);
say(`|---|---|`);
say(`| old src/App.jsx | ${total(before)} |`);
say(`| new files (sum) | ${total(after)} |`);
say(`| missing from new | ${d1.missing.reduce((a, [c]) => a + c, 0)} |`);
say(`| extra in new | ${d1.extra.reduce((a, [c]) => a + c, 0)} |`);
say();
for (const [c, l] of d1.missing.slice(0, 40)) say(`- MISSING ×${c}: \`${l.trim().slice(0, 140)}\``);
for (const [c, l] of d1.extra.slice(0, 40)) say(`- EXTRA ×${c}: \`${l.trim().slice(0, 140)}\``);
if (d1.missing.length || d1.extra.length) ok = false;
say(`<details><summary>Per-file line counts</summary>`);
say();
say(`| file | lines from App.jsx |`);
say(`|---|---|`);
for (const [f, n] of perFile) say(`| ${f} | ${n} |`);
say();
say(`</details>`);
say();

// ── 2. whole-file moves ─────────────────────────────────────────────────────
say(`## 2. Whole files moved (git mv)`);
say();
say(`| old | new | lines | identical apart from imports |`);
say(`|---|---|---|---|`);
const renames = git("diff", "--name-status", "-M50%", baseSha, "--", "src").split("\n")
  .filter((l) => /^R\d*\t/.test(l)).map((l) => l.split("\t").slice(1));
for (const [from, to] of renames) {
  if (!fs.existsSync(path.join(ROOT, to))) continue;
  const a = multiset(nonImportLines(git("show", `${baseSha}:${from}`)).map((l) => dynImport(l.trimEnd())));
  const b = multiset(nonImportLines(fs.readFileSync(path.join(ROOT, to), "utf8")).map((l) => dynImport(l.trimEnd())));
  const d = diff(a, b);
  const same = !d.missing.length && !d.extra.length;
  if (!same) ok = false;
  say(`| ${from} | ${to} | ${total(b)} | ${same ? "yes" : "NO"} |`);
  for (const [c, l] of [...d.missing, ...d.extra].slice(0, 10)) say(`|  |  |  | differs ×${c}: \`${l.trim().slice(0, 100)}\` |`);
}
say();

// ── 3. barrels hold no logic ────────────────────────────────────────────────
say(`## 3. Module index.js files hold only re-exports`);
say();
for (const f of walk("src/modules").filter((x) => x.endsWith("/index.js")).sort()) {
  const bad = fs.readFileSync(path.join(ROOT, f), "utf8").split("\n")
    .filter((l) => l.trim() && !l.startsWith("//") && !/^export \{[^}]+\} from "\.\/[^"]+";$/.test(l));
  if (bad.length) ok = false;
  say(`- ${f}: ${bad.length ? "LOGIC FOUND: " + bad[0] : "re-exports only"}`);
}
say();
say(`**Result: ${ok ? "PURE MOVE — every line accounted for" : "FAILED — see above"}**`);

if (WRITE) fs.writeFileSync(path.join(ROOT, "docs/SPLIT-ACCOUNTING.md"), report.join("\n") + "\n");
process.exit(ok ? 0 : 1);
