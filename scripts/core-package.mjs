#!/usr/bin/env node
// SHANTAZ ERP — build the "core" package for ERP LIVE (folder-replace releases).
//
//   node scripts/core-package.mjs [--against <path-to-live-clone>] [--out <dir>] [--date YYYY-MM-DD] [--force]
//
// Core = CORE_PATHS in src/shared/coreVersion.js: src/shared, src/stores,
// src/utils, src/app/layout, src/*.css and package.json "dependencies".
// Writes (default) /mnt/user-data/outputs/live-packages/<date>-core-v<N>/:
//   files/<same paths as the repo>      every core file, copied as-is
//   files/package.dependencies.json     package.json "dependencies" only
//   FILES.txt                           path · lines · sha256 · status vs Live
//   BRIEF.md                            what it is + steps for the Live chat
// --against only READS a Live checkout to mark files new/changed/same and to
// list npm packages and shell files (src/config, src/auth, …) core needs.
// It never writes outside --out. Steps: docs/FOLDER-REPLACE.md.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { walk, parseImports, parseExports, resolveRel, coreVersion } from "./lib/module-scan.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const LIVE = opt("--against") ? path.resolve(opt("--against")) : null;
const DATE = opt("--date") || new Date().toISOString().slice(0, 10);
const FORCE = args.includes("--force");
const { CORE_VERSION, CORE_PATHS } = await import(path.join(ROOT, "src/shared/coreVersion.js"));
const OUT = path.resolve(opt("--out") || `/mnt/user-data/outputs/live-packages/${DATE}-core-v${CORE_VERSION}`);

if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE)) { console.error("--date must be YYYY-MM-DD"); process.exit(2); }
if (LIVE && !fs.existsSync(path.join(LIVE, "src"))) { console.error(`${LIVE} does not look like an ERP checkout`); process.exit(2); }
if (LIVE && (OUT === LIVE || OUT.startsWith(LIVE + path.sep))) { console.error("--out must not be inside the Live checkout"); process.exit(2); }
if (fs.existsSync(OUT) && !FORCE) { console.error(`${OUT} already exists — pass --force to rebuild it`); process.exit(2); }

const git = (...a) => { try { return execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return "?"; } };
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

// 1. collect core files
const files = [];
for (const p of CORE_PATHS) {
  const f = p.replace(/#.*$/, "");
  if (f === "package.json") continue;
  if (f.includes("*")) {
    const dir = path.posix.dirname(f);
    const re = new RegExp(`^${path.posix.basename(f).replace(/\./g, "\\.").replace(/\*/g, "[^/]*")}$`);
    for (const e of fs.readdirSync(path.join(ROOT, dir))) if (re.test(e) && fs.statSync(path.join(ROOT, dir, e)).isFile()) files.push(`${dir}/${e}`);
  } else files.push(...walk(ROOT, f));
}
files.sort();
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const deps = pkg.dependencies || {};

// 2. compare with Live (read-only)
const liveHas = (f) => LIVE && fs.existsSync(path.join(LIVE, f));
const status = (f) => {
  if (!LIVE) return "-";
  if (!liveHas(f)) return "new";
  return fs.readFileSync(path.join(LIVE, f)).equals(fs.readFileSync(path.join(ROOT, f))) ? "same" : "changed";
};
const liveOnly = [];
if (LIVE) {
  for (const p of CORE_PATHS) {
    const f = p.replace(/#.*$/, "");
    if (f === "package.json" || f.includes("*")) continue;
    for (const lf of walk(LIVE, f)) if (!files.includes(lf)) liveOnly.push(lf);
  }
}
let liveDeps = {};
if (LIVE) liveDeps = JSON.parse(fs.readFileSync(path.join(LIVE, "package.json"), "utf8")).dependencies || {};
const npmNew = Object.keys(deps).filter((n) => LIVE && !liveDeps[n]).sort();
const npmChanged = Object.keys(deps).filter((n) => LIVE && liveDeps[n] && liveDeps[n] !== deps[n]).sort();

// 3. what core needs from outside core (src/config, src/auth, src/supabase, assets, …)
const inCore = (f) => files.includes(f);
const outside = new Map();
for (const f of files.filter((x) => /\.(m?js|jsx)$/.test(x))) {
  for (const imp of parseImports(fs.readFileSync(path.join(ROOT, f), "utf8"))) {
    if (!imp.spec.startsWith(".")) continue;
    const to = resolveRel(ROOT, f, imp.spec.replace(/\?.*$/, ""));
    if (inCore(to)) continue;
    const e = outside.get(to) || { names: new Set(), from: new Set() };
    imp.names.forEach((n) => e.names.add(n));
    e.from.add(f);
    outside.set(to, e);
  }
}
const outsideRows = [...outside.entries()].sort().map(([to, e]) => {
  let live = "-";
  if (LIVE) {
    if (!liveHas(to)) live = "MISSING in Live";
    else if (/\.(m?js|jsx)$/.test(to)) {
      const ex = parseExports(fs.readFileSync(path.join(LIVE, to), "utf8"));
      const lost = [...e.names].filter((n) => n !== "*" && !ex.has(n) && !ex.has("*"));
      live = lost.length ? `Live lacks: ${lost.join(", ")}` : "ok";
    } else live = "ok";
  }
  return { to, names: [...e.names].sort(), from: [...e.from].sort(), live };
});
const blockers = outsideRows.filter((r) => r.live !== "ok" && r.live !== "-");

// 3b. Live code outside core that imports core files: (i) names the Trial
// core no longer exports (would break the Live build), (ii) which Live module
// folders import a core file this package CHANGES (their behaviour may move —
// Machine Tracker is LOCKED in Live: owner's "haan" needed).
const reverseLost = [];
const touched = {};
if (LIVE) {
  const liveCode = walk(LIVE, "src").filter((f) => /\.(m?js|jsx)$/.test(f) && !inCoreLive(f));
  for (const f of liveCode) {
    for (const imp of parseImports(fs.readFileSync(path.join(LIVE, f), "utf8"))) {
      if (!imp.spec.startsWith(".")) continue;
      const to = resolveRel(LIVE, f, imp.spec.replace(/\?.*$/, ""));
      if (!files.includes(to)) continue;
      if (/\.(m?js|jsx)$/.test(to)) {
        const ex = parseExports(fs.readFileSync(path.join(ROOT, to), "utf8"));
        const lost = imp.names.filter((n) => n !== "*" && !ex.has(n) && !ex.has("*"));
        if (lost.length) reverseLost.push(`${f} imports ${lost.join(", ")} from ${to}`);
      }
      const m = f.match(/^src\/modules\/([^/]+)\//);
      if (m && status(to) === "changed") (touched[m[1]] ||= new Set()).add(to);
    }
  }
}
function inCoreLive(f) {
  return /^src\/(shared|stores|utils|app\/layout)\//.test(f) || /^src\/[^/]+\.css$/.test(f);
}

// 4. write
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "files"), { recursive: true });
const rows = [];
const all = sha(Buffer.concat(files.map((f) => Buffer.concat([Buffer.from(f + "\n"), fs.readFileSync(path.join(ROOT, f))]))));
for (const f of files) {
  const buf = fs.readFileSync(path.join(ROOT, f));
  fs.mkdirSync(path.dirname(path.join(OUT, "files", f)), { recursive: true });
  fs.writeFileSync(path.join(OUT, "files", f), buf);
  rows.push(`${f}\t${buf.toString("utf8").split("\n").length}\t${sha(buf)}\t${status(f)}`);
}
fs.writeFileSync(path.join(OUT, "files/package.dependencies.json"), JSON.stringify({ dependencies: deps }, null, 2) + "\n");
const counts = { new: 0, changed: 0, same: 0 };
for (const f of files) { const s = status(f); if (s in counts) counts[s]++; }
fs.writeFileSync(path.join(OUT, "FILES.txt"), [
  `# core v${CORE_VERSION} — ${files.length} files · from MIHIR TRIAL ${git("rev-parse", "--short", "HEAD")} · content sha256 ${all}`,
  `# path\tlines\tsha256\tstatus vs Live (${LIVE ? LIVE : "no --against given"})`,
  ...rows,
  "files/package.dependencies.json\t-\t-\tmerge into Live package.json \"dependencies\"",
  "",
].join("\n"));

const b = [];
b.push(`# Core package v${CORE_VERSION} — MIHIR TRIAL → ERP LIVE`, "");
const dirty = git("status", "--porcelain", "--", "src/shared", "src/stores", "src/utils", "src/app/layout", "src", "package.json");
b.push(`* Built ${DATE} from MIHIR TRIAL \`${git("rev-parse", "HEAD")}\` (branch \`${git("rev-parse", "--abbrev-ref", "HEAD")}\`)${dirty && dirty !== "?" ? " **+ uncommitted changes — rebuild from a clean commit before sending**" : ""}`);
b.push(`* Core content sha256: \`${all}\``);
b.push(`* Core = ${CORE_PATHS.map((p) => `\`${p}\``).join(", ")} (\`src/shared/coreVersion.js\`).`);
b.push(`* ${files.length} files${LIVE ? `: ${counts.new} new, ${counts.changed} changed, ${counts.same} same vs Live (${LIVE}, Live CORE_VERSION ${coreVersion(LIVE)})` : ""}. Full list: FILES.txt.`);
b.push("", "## What it is", "");
b.push("The shared code every module folder is built against. A module package whose MODULE.json says `requiresCore` ≤ " + CORE_VERSION + " fits on top of it. Apply this BEFORE any module folder that needs it (module-check says `needs core v" + CORE_VERSION + "`).");
b.push("It changes no module folder, no `src/app/App.jsx`, no database.");
if (LIVE) {
  const t = Object.entries(touched).sort();
  b.push("", "## Live modules whose imported core files change", "");
  if (!t.length) b.push("none");
  for (const [m, set] of t) b.push(`* \`${m}\`${m === "machine-tracker" ? " — **LOCKED in Live: owner must say \"haan\" for this core package**" : ""}: ${[...set].sort().join(", ")}`);
  if (reverseLost.length) b.push("", "**STOP — Live code imports names this core no longer exports:**", ...reverseLost.map((x) => `* ${x}`));
}
b.push("", "## Live chat — apply", "");
b.push("1. ERP LIVE repo: `git status` clean, latest `main`, new branch `promote/core-v" + CORE_VERSION + "-" + DATE + "`, tag the start `before-core-v" + CORE_VERSION + "`.");
b.push("2. Copy everything under `files/src/` over Live's `src/` (same paths). Do NOT delete Live files that are not in the package" + (liveOnly.length ? ` (Live-only core files today: ${liveOnly.join(", ")})` : "") + ".");
b.push("3. Merge `files/package.dependencies.json` into Live `package.json` → `dependencies` (keep Live's `name`, `scripts`, devDependencies), then `npm install` (updates package-lock.json).");
if (npmNew.length) b.push(`   New npm packages for Live: ${npmNew.map((n) => `\`${n}@${deps[n]}\``).join(", ")}.`);
if (npmChanged.length) b.push(`   Version changes: ${npmChanged.map((n) => `\`${n}\` ${liveDeps[n]} → ${deps[n]}`).join(", ")}.`);
b.push("4. Keep Live's own build tag: `src/shared/buildInfo.js` comes from Trial with `APP_BUILD = \"auto\"`; if Live still hand-sets `APP_BUILD` / `APP_BUILD_TAG` (src/main.jsx), set both to Live's new tag so they match (regression test).");
b.push("5. `npm test && npm run build`. Red → `git checkout before-core-v" + CORE_VERSION + " -- src package.json package-lock.json`, stop, report.");
b.push("6. One push to `main` (Vercel Hobby limit), live-verify every enabled module (machines, reports, settings, users, roles).");
b.push("7. Now module folders with `requiresCore` ≤ " + CORE_VERSION + " can be dropped in (docs/FOLDER-REPLACE.md §3).");
b.push("", "## Files outside core that core imports (must exist in Live)", "");
if (!outsideRows.length) b.push("none");
for (const r of outsideRows) b.push(`* \`${r.to}\` — ${r.names.length ? r.names.join(", ") : "side effect / asset"} — ${r.live}`);
if (blockers.length) b.push("", `**STOP: ${blockers.length} of these are missing or lack names in Live — bring them in the same promotion (App-shell change, review line by line) or the build fails.**`);
b.push("", "## Never", "", "* Never apply this to MIHIR TRIAL, never point Live at the Trial Supabase.", "* Never copy `src/app/App.jsx` from Trial with it.", "");
fs.writeFileSync(path.join(OUT, "BRIEF.md"), b.join("\n"));

console.log(`core v${CORE_VERSION}: ${files.length} files → ${OUT}`);
if (LIVE) console.log(`vs Live: ${counts.new} new, ${counts.changed} changed, ${counts.same} same; npm new: ${npmNew.join(", ") || "none"}; outside-core blockers: ${blockers.length}; Live names lost: ${reverseLost.length}; Live modules touched: ${Object.keys(touched).sort().join(", ") || "none"}`);
process.exit(blockers.length || reverseLost.length ? 1 : 0);
