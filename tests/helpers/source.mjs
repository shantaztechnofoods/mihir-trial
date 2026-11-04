// Source-text helpers for the static tests.
//
// Until 2026-11-04 almost the whole ERP lived in one file, src/App.jsx, and
// the static tests read that file. The ERP is now split into module folders
// (src/app, src/modules/*, src/shared — see docs/ARCHITECTURE.md), so the
// tests read the same code from its new homes:
//
//   appSource()    every .js/.jsx file under src/ (sorted by path), joined.
//                  Use it for "is X still somewhere in the ERP" checks — the
//                  same corpus the old App.jsx checks covered, and more.
//   readSrc(p)     one file, path relative to the repo root ("src/...").
//   readSrcs(...p) several files joined in the order given — for checks that
//                  slice from one symbol to another across two files.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function readSrc(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

export function readSrcs(...rels) {
  return rels.map(readSrc).join("\n");
}

export function srcFiles(dir = "src") {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = `${d}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.(js|jsx|mjs)$/.test(e.name)) out.push(rel);
    }
  };
  walk(dir);
  return out;
}

// Rough comment stripper for "is X called in this file" checks: drops /* */
// blocks and // comments that start a line or follow whitespace (so "https://"
// inside a string survives).
export function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

let cached = null;
export function appSource() {
  if (cached == null) cached = srcFiles("src").map(readSrc).join("\n");
  return cached;
}

// Only the screen code (src/app + src/modules + src/shared) — a superset of the
// old src/App.jsx without stores/utils. For "no screen still shows X" checks
// where a util legitimately mentions X (e.g. in a comment).
export function uiSource() {
  return ["src/app", "src/modules", "src/shared"].flatMap((d) => srcFiles(d)).map(readSrc).join("\n");
}
