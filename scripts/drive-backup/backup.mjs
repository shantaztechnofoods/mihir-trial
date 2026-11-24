#!/usr/bin/env node
// SHANTAZ ERP — Google Drive backup job (READ-ONLY on ERP data).
//
// Runs in GitHub Actions (.github/workflows/drive-backup.yml) at 1:00 PM and
// 9:00 PM IST, and on "Back up now" (Settings → Data & Backup). It:
//   1. reads every ERP table with the service-role key (GET only; the only
//      writes are to the backup's own tables: backup_runs / backup_files /
//      backup_secrets, and the private erp-backups Storage bucket),
//   2. builds one MASTER Excel per module + one Activity.xlsx per machine,
//      raw JSON of every table, and copies every stored photo / video / voice
//      note / PDF into the matching module or machine folder,
//   3. uploads it to the connected Google Drive ("SHANTAZ ERP Backup (Trial)"),
//      keeps a dated Snapshot copy of the MASTER files (90 days),
//   4. stores the same tree as a ZIP in Storage (latest 3) for "Download ZIP".
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (required)
//      RUN_ID (set by "Back up now"), BACKUP_ROOT_NAME, DRY_RUN=1 + OUT_DIR=… (local test: no Drive, no Storage writes)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import ExcelJS from "exceljs";
import { zipSync } from "fflate";
import {
  ROOT_NAME_DEFAULT, ZIP_KEEP, groupTables, redactRows, SHEET_NAMES, humanize, cell, columnsOf, keyValueRows,
  machineSlice, machineFolderName, storageTarget, istStamp, expiredSnapshots, safeName,
} from "./lib.mjs";

const SB = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const DRY = process.env.DRY_RUN === "1";
const OUT_DIR = process.env.OUT_DIR || "";
const ROOT_NAME = process.env.BACKUP_ROOT_NAME || ROOT_NAME_DEFAULT;
const RUN_ID = (process.env.RUN_ID || "").trim();
const FIXTURE = process.env.FIXTURE_DIR || ""; // local test: read tables from <dir>/<table>.json instead of Supabase
if (!FIXTURE && (!SB || !KEY)) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required"); process.exit(2); }

const sbHeaders = (extra = {}) => ({ apikey: KEY, ...(KEY.startsWith("sb_") ? {} : { Authorization: `Bearer ${KEY}` }), ...extra });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const started = Date.now();
const stamp = istStamp(started);
const problems = [];

async function sb(pathname, opts = {}) {
  const r = await fetch(`${SB}${pathname}`, { ...opts, headers: sbHeaders(opts.headers) });
  if (!r.ok) throw new Error(`${opts.method || "GET"} ${pathname.split("?")[0]} → ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r;
}

// ── run bookkeeping ─────────────────────────────────────────────────────────
let runId = RUN_ID;
async function runUpdate(patch) {
  if (DRY || FIXTURE || !runId) return;
  await sb(`/rest/v1/backup_runs?id=eq.${encodeURIComponent(runId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
}
async function runStart() {
  if (DRY || FIXTURE) return;
  if (runId) return runUpdate({ status: "running", started_at: new Date(started).toISOString() });
  const r = await sb("/rest/v1/backup_runs", {
    method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ kind: "scheduled", status: "running", requested_by_name: "Automatic (1 PM / 9 PM)", started_at: new Date(started).toISOString() }),
  });
  runId = String((await r.json())[0].id);
}

// ── read ERP data (GET only) ────────────────────────────────────────────────
async function readTable(t, cols) {
  if (FIXTURE) return JSON.parse(fs.readFileSync(path.join(FIXTURE, `${t}.json`), "utf8"));
  const order = cols.includes("id") ? "id" : cols.includes("key") ? "key" : cols[0];
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const r = await sb(`/rest/v1/${t}?select=*${order ? `&order=${order}.asc` : ""}&offset=${from}&limit=1000`);
    const page = await r.json();
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}
async function readAll() {
  const spec = FIXTURE ? null : await (await sb("/rest/v1/", { headers: { Accept: "application/openapi+json" } })).json();
  const names = FIXTURE ? fs.readdirSync(FIXTURE).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)) : Object.keys(spec.definitions || {});
  const modules = groupTables(names);
  const data = {};
  for (const m of modules) for (const t of m.tables) {
    const cols = spec ? Object.keys(spec.definitions?.[t]?.properties || {}) : [];
    data[t] = redactRows(t, await readTable(t, cols));
    log(`read ${t}: ${data[t].length}`);
  }
  if (!data.backup_runs && !FIXTURE) data.backup_runs = await readTable("backup_runs", ["id"]).catch(() => []);
  return { modules, data };
}

async function listBucket(bucket, prefix = "") {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await sb(`/storage/v1/object/list/${bucket}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: "name", order: "asc" } }),
    });
    const items = await r.json();
    for (const it of items) {
      const full = prefix ? `${prefix}/${it.name}` : it.name;
      if (it.id == null) out.push(...(await listBucket(bucket, full)));
      else out.push({ bucket, path: full, size: it.metadata?.size ?? null, mime: it.metadata?.mimetype || "" });
    }
    if (items.length < 1000) break;
  }
  return out;
}
async function listStorage() {
  if (FIXTURE) return [];
  const buckets = (await (await sb("/storage/v1/bucket")).json()).map((b) => b.id).filter((id) => id !== "erp-backups");
  const all = [];
  for (const b of buckets) all.push(...(await listBucket(b)));
  return all;
}
const download = async (o) => Buffer.from(await (await sb(`/storage/v1/object/${o.bucket}/${o.path.split("/").map(encodeURIComponent).join("/")}`)).arrayBuffer());

// ── Excel ───────────────────────────────────────────────────────────────────
function addSheet(wb, name, rows, preferred = []) {
  const ws = wb.addWorksheet(safeName(name).slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
  const cols = columnsOf(rows, preferred);
  if (!cols.length) { ws.addRow(["(no rows)"]); return ws; }
  ws.columns = cols.map((c) => ({ header: humanize(c), key: c, width: 12 }));
  const widths = cols.map((c) => humanize(c).length + 2);
  for (const r of rows) {
    const vals = cols.map((c) => cell(r[c]));
    const row = ws.addRow(vals.map((x) => x.v));
    vals.forEach((x, i) => {
      if (x.fmt) row.getCell(i + 1).numFmt = x.fmt;
      const len = x.fmt ? 17 : x.v == null ? 0 : Math.min(String(x.v).length, 60);
      if (len + 2 > widths[i]) widths[i] = len + 2;
    });
  }
  ws.columns.forEach((c, i) => { c.width = Math.min(Math.max(widths[i], 8), 60); });
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FF0F172A" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
  head.alignment = { vertical: "middle" };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  return ws;
}
const newBook = () => { const wb = new ExcelJS.Workbook(); wb.creator = "SHANTAZ ERP backup"; wb.created = new Date(started); return wb; };
const bookBuffer = async (wb) => Buffer.from(await wb.xlsx.writeBuffer());

async function moduleMaster(mod, data) {
  const wb = newBook();
  addSheet(wb, "About this backup", [
    { field: "Module", value: mod.folder.replace(/^\d+\s/, "") },
    { field: "Backup taken (IST)", value: stamp.replace(/ (\d\d)(\d\d)$/, " $1:$2") },
    ...mod.tables.map((t) => ({ field: `Rows in ${SHEET_NAMES[t] || t}`, value: (data[t] || []).length })),
    { field: "Note", value: "Times are India time (IST). Secret keys in Settings are hidden. Full raw data: _Raw data (JSON)." },
  ]);
  for (const t of mod.tables) addSheet(wb, SHEET_NAMES[t] || t, data[t] || [], ["id", "serial_no", "bom_key", "code", "name"]);
  return bookBuffer(wb);
}

function flattenHistory(h) {
  return (Array.isArray(h) ? h : []).map((e, i) => (e && typeof e === "object" ? { step: i + 1, ...e } : { step: i + 1, value: e }));
}
async function machineBook(m, data) {
  const s = machineSlice(m, data);
  const { history, trial_certificate, ...rest } = m;
  const wb = newBook();
  addSheet(wb, "Machine", keyValueRows(rest));
  addSheet(wb, "Stage history", flattenHistory(history));
  addSheet(wb, "Stage moves", s.handover_events);
  addSheet(wb, "Checklists", s.checklist_responses);
  addSheet(wb, "Pending items", s.pending_handover_items);
  addSheet(wb, "Pending receipts", s.pending_item_receipts);
  addSheet(wb, "Dept ratings", s.department_ratings);
  addSheet(wb, "Photos and files", s.machine_attachments);
  addSheet(wb, "Material issued", s.outward_log);
  addSheet(wb, "Trial certificate", keyValueRows(trial_certificate || {}));
  addSheet(wb, "Activity log", s.audit_log);
  const hash = crypto.createHash("sha256").update(JSON.stringify([m, s])).digest("hex");
  return { buf: await bookBuffer(wb), hash };
}

async function backupLog(runs) {
  const wb = newBook();
  const cur = { id: runId || "(this run)", kind: RUN_ID ? "manual" : "scheduled", status: "running", requested_at: new Date(started).toISOString() };
  const rows = [cur, ...runs.filter((r) => String(r.id) !== String(runId))].map((r) => ({
    run: r.id, type: r.kind, result: r.status, by: r.requested_by_name, requested_at: r.requested_at,
    finished_at: r.finished_at, rows: r.summary?.rows, files: r.summary?.files, error: r.error,
  }));
  addSheet(wb, "Backup runs", rows);
  return bookBuffer(wb);
}

const README = (email) => [
  "SHANTAZ ERP — automatic backup",
  "",
  "Runs every day at 1:00 PM and 9:00 PM (India time), and whenever a Super Admin presses",
  "Settings → Data & Backup → Back up now.",
  "",
  "01 … 09            one folder per ERP module, each with a MASTER Excel file (always the latest data)",
  "01 Machine Tracker/Machines/<serial>/   one folder per machine: Activity.xlsx (everything logged for",
  "                   that machine) + Photos / Videos / Voice notes / Files",
  "Snapshots/<date time>/   copies of all MASTER files as they were at that backup (kept 90 days)",
  "_Raw data (JSON)/  exact copy of every table, used to restore the database",
  "_Backup Log.xlsx   every backup run: time, result, rows, files",
  "",
  "Secret keys (WhatsApp / AI keys in Settings) are hidden in this backup. Times are IST.",
  email ? `Connected Google account: ${email}` : "",
].join("\r\n");

// ── Google Drive (drive.file scope: the job only sees what it created) ─────
let token = null; let tokenAt = 0; let driveEmail = null;
async function driveToken() {
  if (token && Date.now() - tokenAt < 45 * 60 * 1000) return token;
  const r = await fetch(`${SB}/functions/v1/drive-backup`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}`, apikey: KEY },
    body: JSON.stringify({ action: "token" }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.access_token) throw new Error(`Drive token: ${body.error || r.status}`);
  token = body.access_token; tokenAt = Date.now(); driveEmail = body.email || null;
  return token;
}
async function drive(url, opts = {}, tries = 4) {
  for (let i = 0; ; i++) {
    const r = await fetch(url.startsWith("http") ? url : `https://www.googleapis.com${url}`, {
      ...opts, headers: { Authorization: `Bearer ${await driveToken()}`, ...(opts.headers || {}) },
    });
    if (r.ok) return r;
    if (i < tries && [403, 429, 500, 502, 503].includes(r.status)) { await new Promise((s) => setTimeout(s, 1500 * 2 ** i)); continue; }
    throw new Error(`Drive ${opts.method || "GET"} ${url.split("?")[0]} → ${r.status} ${(await r.text()).slice(0, 300)}`);
  }
}
const FOLDER = "application/vnd.google-apps.folder";
const q = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const children = new Map(); // folderId → Map(name → {id, mimeType})
async function listChildren(folderId) {
  if (children.has(folderId)) return children.get(folderId);
  const map = new Map(); let pageToken = "";
  do {
    const r = await drive(`/drive/v3/files?q=${encodeURIComponent(`'${q(folderId)}' in parents and trashed=false`)}&fields=nextPageToken,files(id,name,mimeType,size)&pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ""}`);
    const b = await r.json();
    for (const f of b.files || []) map.set(f.name, f);
    pageToken = b.nextPageToken || "";
  } while (pageToken);
  children.set(folderId, map);
  return map;
}
async function ensureFolder(name, parentId) {
  const kids = await listChildren(parentId);
  const hit = kids.get(name);
  if (hit && hit.mimeType === FOLDER) return hit.id;
  const r = await drive("/drive/v3/files?fields=id,name,mimeType", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] }),
  });
  const f = await r.json(); kids.set(name, f); children.set(f.id, new Map());
  return f.id;
}
const folderCache = new Map();
async function ensurePath(rootId, rel) {
  let id = rootId; let acc = "";
  for (const part of rel.split("/").filter(Boolean)) {
    acc += `/${part}`;
    if (!folderCache.has(acc)) folderCache.set(acc, await ensureFolder(part, id));
    id = folderCache.get(acc);
  }
  return id;
}
async function putFile(parentId, name, buf, mime) {
  const kids = await listChildren(parentId);
  const existing = kids.get(name);
  const init = await drive(existing
    ? `/upload/drive/v3/files/${existing.id}?uploadType=resumable&fields=id`
    : "/upload/drive/v3/files?uploadType=resumable&fields=id", {
    method: existing ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": mime, "X-Upload-Content-Length": String(buf.length) },
    body: JSON.stringify(existing ? {} : { name, parents: [parentId] }),
  });
  const loc = init.headers.get("location");
  const r = await drive(loc, { method: "PUT", headers: { "Content-Type": mime }, body: buf });
  const f = await r.json(); kids.set(name, { id: f.id, name, mimeType: mime });
  return f.id;
}
async function rootFolder(secrets) {
  if (secrets.drive_root_id) {
    try {
      const f = await (await drive(`/drive/v3/files/${secrets.drive_root_id}?fields=id,trashed`)).json();
      if (!f.trashed) return f.id;
    } catch { /* deleted or not ours any more → make a new one */ }
  }
  const r = await drive("/drive/v3/files?fields=id", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: ROOT_NAME, mimeType: FOLDER }) });
  const id = (await r.json()).id;
  await saveSecret("drive_root_id", id);
  await saveSecret("drive_root_url", `https://drive.google.com/drive/folders/${id}`);
  return id;
}

async function readSecrets() {
  const rows = await (await sb("/rest/v1/backup_secrets?select=key,value")).json();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
const saveSecret = (key, value) => sb("/rest/v1/backup_secrets?on_conflict=key", {
  method: "POST", headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
  body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
});
async function uploadedFiles() {
  const rows = await (await sb("/rest/v1/backup_files?select=src,drive_id,size&limit=100000")).json();
  return new Map(rows.map((r) => [r.src, r]));
}
const markUploaded = (src, drive_id, size) => sb("/rest/v1/backup_files?on_conflict=src", {
  method: "POST", headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
  body: JSON.stringify({ src, drive_id, size, uploaded_at: new Date().toISOString() }),
});

const MIME = { ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".json": "application/json", ".txt": "text/plain" };
const splitPath = (p) => { const i = p.lastIndexOf("/"); return i < 0 ? ["", p] : [p.slice(0, i), p.slice(i + 1)]; };

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  await runStart();
  log(`backup ${stamp} run=${runId || "-"} dry=${DRY}`);
  const { modules, data } = await readAll();
  const tree = new Map(); // relative path → Buffer  (generated files)
  const gen = []; // { path, buf, hash? } — generated files to publish

  for (const mod of modules) {
    const p = `${mod.folder}/${mod.master}`;
    const buf = await moduleMaster(mod, data); tree.set(p, buf); gen.push({ path: p, buf, master: true });
  }
  const machineFolders = new Map();
  for (const m of data.machine_log || []) {
    const folder = machineFolderName(m);
    machineFolders.set(String(m.id), folder);
    const { buf, hash } = await machineBook(m, data);
    const p = `01 Machine Tracker/Machines/${folder}/Activity.xlsx`;
    tree.set(p, buf); gen.push({ path: p, buf, hash });
  }
  for (const [t, rows] of Object.entries(data)) {
    const p = `_Raw data (JSON)/${t}.json`;
    const buf = Buffer.from(JSON.stringify(rows, null, 1)); tree.set(p, buf); gen.push({ path: p, buf });
  }

  const objects = await listStorage();
  const files = []; // { src, path, size, buf }
  for (const o of objects) {
    try {
      files.push({ src: `${o.bucket}/${o.path}`, path: storageTarget(o.bucket, o.path, o.mime, machineFolders), size: o.size, mime: o.mime, buf: await download(o) });
    } catch (e) { problems.push(`file ${o.bucket}/${o.path}: ${e.message}`); }
  }
  for (const f of files) tree.set(f.path, f.buf);

  const rows = Object.values(data).reduce((n, r) => n + r.length, 0);
  const summary = {
    rows, files: files.length, machines: (data.machine_log || []).length,
    tables: Object.fromEntries(Object.entries(data).map(([t, r]) => [t, r.length])),
  };

  if (DRY || FIXTURE) {
    if (OUT_DIR) {
      tree.set("_Backup Log.xlsx", await backupLog(data.backup_runs || []));
      tree.set("README.txt", Buffer.from(README(null)));
      for (const [p, buf] of tree) { const f = path.join(OUT_DIR, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf); }
      fs.writeFileSync(path.join(OUT_DIR, "_summary.json"), JSON.stringify(summary, null, 1));
    }
    log("dry run done", JSON.stringify({ rows, files: files.length, generated: gen.length }));
    return;
  }

  // Drive
  const secrets = await readSecrets();
  await driveToken();
  const root = await rootFolder(secrets);
  const driveUrl = `https://drive.google.com/drive/folders/${root}`;
  const hashes = JSON.parse(secrets.gen_hashes || "{}");
  let uploaded = 0; let skipped = 0;
  const masterIds = [];
  for (const g of gen) {
    const [dir, name] = splitPath(g.path);
    try {
      if (g.hash && hashes[g.path] === g.hash) { skipped++; continue; }
      const id = await putFile(await ensurePath(root, dir), name, g.buf, MIME[path.extname(name)] || "application/octet-stream");
      if (g.master) masterIds.push({ id, name, dir });
      if (g.hash) hashes[g.path] = g.hash;
      uploaded++;
    } catch (e) { problems.push(`${g.path}: ${e.message}`); }
  }
  await saveSecret("gen_hashes", JSON.stringify(hashes));
  const done = await uploadedFiles();
  let newFiles = 0;
  for (const f of files) {
    const prev = done.get(f.src);
    if (prev && Number(prev.size) === Number(f.size ?? f.buf.length)) continue;
    const [dir, name] = splitPath(f.path);
    try {
      const id = await putFile(await ensurePath(root, dir), name, f.buf, f.mime || "application/octet-stream");
      await markUploaded(f.src, id, f.size ?? f.buf.length); newFiles++;
    } catch (e) { problems.push(`${f.path}: ${e.message}`); }
  }
  // Snapshot: dated copies of every MASTER file (server-side copy, no re-upload)
  const snapRoot = await ensurePath(root, "Snapshots");
  const snapName = `${stamp} (${RUN_ID ? "manual" : "auto"})`;
  const snapId = await ensureFolder(snapName, snapRoot);
  for (const mf of masterIds) {
    try {
      await drive(`/drive/v3/files/${mf.id}/copy?fields=id`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: mf.name, parents: [snapId] }) });
    } catch (e) { problems.push(`snapshot ${mf.name}: ${e.message}`); }
  }
  let trashed = 0;
  for (const old of expiredSnapshots([...(await listChildren(snapRoot)).values()].filter((f) => f.mimeType === FOLDER))) {
    try { await drive(`/drive/v3/files/${old.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) }); trashed++; }
    catch (e) { problems.push(`retention ${old.name}: ${e.message}`); }
  }
  const logBuf = await backupLog(data.backup_runs || []);
  tree.set("_Backup Log.xlsx", logBuf);
  const readme = Buffer.from(README(driveEmail));
  tree.set("README.txt", readme);
  try { await putFile(root, "_Backup Log.xlsx", logBuf, MIME[".xlsx"]); await putFile(root, "README.txt", readme, MIME[".txt"]); }
  catch (e) { problems.push(`log/readme: ${e.message}`); }

  // ZIP → Storage (private erp-backups), keep the newest ZIP_KEEP
  let zipPath = null;
  try {
    const entries = {};
    for (const [p, buf] of tree) entries[`SHANTAZ ERP Backup ${stamp}/${p}`] = [new Uint8Array(buf), { level: /\.(jpe?g|png|webm|mp4|pdf|xlsx)$/i.test(p) ? 0 : 6 }];
    const zip = Buffer.from(zipSync(entries));
    zipPath = `SHANTAZ-ERP-Backup-${stamp.replace(" ", "-")}.zip`;
    await sb(`/storage/v1/object/erp-backups/${zipPath}`, { method: "POST", headers: { "Content-Type": "application/zip", "x-upsert": "true" }, body: zip });
    const list = await (await sb("/storage/v1/object/list/erp-backups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefix: "", limit: 1000, sortBy: { column: "name", order: "desc" } }) })).json();
    const old = list.filter((o) => o.id && o.name.endsWith(".zip")).map((o) => o.name).sort().reverse().slice(ZIP_KEEP);
    if (old.length) await sb("/storage/v1/object/erp-backups", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: old }) });
    summary.zip_mb = +(zip.length / 1048576).toFixed(1);
  } catch (e) { problems.push(`zip: ${e.message}`); zipPath = null; }

  Object.assign(summary, { uploaded, unchanged: skipped, new_files: newFiles, snapshots_trashed: trashed, seconds: Math.round((Date.now() - started) / 1000), problems: problems.slice(0, 20) });
  await runUpdate({ status: problems.length ? "partial" : "ok", finished_at: new Date().toISOString(), summary, drive_url: driveUrl, zip_path: zipPath, error: problems.length ? `${problems.length} problem(s): ${problems[0]}` : null });
  log("done", JSON.stringify(summary));
  if (problems.length) console.warn(problems.join("\n"));
}

main().catch(async (e) => {
  console.error(e);
  try { await runUpdate({ status: "failed", finished_at: new Date().toISOString(), error: String(e.message || e).slice(0, 1000) }); } catch { /* ignore */ }
  process.exit(1);
});
