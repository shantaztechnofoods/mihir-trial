// Google Drive backup (2026-11-24): pure helpers + the safety promises of the job,
// workflow, migration, edge function and Settings panel.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  groupTables, redact, redactRows, safeName, machineFolderName, cell, storageTarget, istStamp, expiredSnapshots, machineSlice, humanize,
} from "../scripts/drive-backup/lib.mjs";

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("drive backup: every table lands in a module folder; secrets and views never do", () => {
  const g = groupTables(["machine_log", "items", "audit_log", "backup_secrets", "backup_files", "v_dept_roster", "brand_new_table", "settings"]);
  const all = g.flatMap((m) => m.tables);
  assert.ok(all.includes("brand_new_table"), "unknown table → 09 Other");
  assert.equal(g.find((m) => m.tables.includes("brand_new_table")).folder, "09 Other");
  for (const t of ["backup_secrets", "backup_files", "v_dept_roster"]) assert.ok(!all.includes(t), `${t} must not be exported`);
  assert.equal(g[0].folder, "01 Machine Tracker");
});

test("drive backup: WhatsApp / AI keys in settings are hidden, normal values stay", () => {
  const rows = redactRows("settings", [{ key: "org", value: { companyName: "SHANTA G", waApiKey: "abc123456789012345", waGeminiKey: "AIzaXXXXXXXXXXXXXXXX", waAnthropicKey: "sk-ant-xxxxxxxxxxxx", bomKey: "M-10", emailAlerts: true, po: { companies: [{ name: "A", apiToken: "t" }] } } }]);
  const v = rows[0].value;
  assert.equal(rows[0].key, "org");
  assert.equal(v.companyName, "SHANTA G");
  assert.equal(v.bomKey, "M-10");
  assert.equal(v.emailAlerts, true);
  for (const k of ["waApiKey", "waGeminiKey", "waAnthropicKey"]) assert.match(v[k], /hidden/);
  assert.match(v.po.companies[0].apiToken, /hidden/);
  assert.deepEqual(redact({ password: "x", note: "ok" }), { password: "•••• hidden in backup", note: "ok" });
  assert.deepEqual(redactRows("items", [{ apiKey: "keep-in-items" }]), [{ apiKey: "keep-in-items" }], "only settings are redacted");
});

test("drive backup: names are Windows / Drive-for-desktop safe", () => {
  assert.equal(safeName('a/b\\c:d*e?"f<g>h|i. '), "a-b-c-d-e-f-g-h-i");
  assert.equal(machineFolderName({ id: 96, serial_no: "SRM112026001", bom_key: "SRM-20" }), "SRM112026001 (id 96)");
  assert.equal(machineFolderName({ id: 97, serial_no: null, bom_key: "M-10" }), "M-10 no serial (id 97)");
  assert.equal(humanize("serial_no"), "Serial No.");
  assert.equal(humanize("trialDate"), "Trial Date");
});

test("drive backup: timestamps become IST Excel dates; long text is cut, not lost", () => {
  const c = cell("2026-11-24T07:30:00+00:00");
  assert.equal(c.v.toISOString(), "2026-11-24T13:00:00.000Z"); // 1:00 PM IST as wall clock
  assert.ok(c.fmt);
  assert.equal(cell("2026-11-24").fmt, "dd-mmm-yyyy");
  assert.equal(cell(true).v, "Yes");
  assert.equal(cell({ a: 1 }).v, '{"a":1}');
  assert.match(cell("x".repeat(40000)).v, /cut, full text in _Raw data/);
  assert.equal(cell(null).v, null);
});

test("drive backup: stored files go to the right module / machine folder", () => {
  const mf = new Map([["96", "SRM112026001 (id 96)"]]);
  assert.equal(storageTarget("item-media", "bom-photos/x-r15.jpg"), "05 BOM and Checklists/BOM photos/x-r15.jpg");
  assert.equal(storageTarget("item-media", "designs/a.pdf"), "02 Item Master/Item photos and files/designs/a.pdf");
  assert.equal(storageTarget("machine-attachments", "96/Ready/1-photo.png", "image/png", mf), "01 Machine Tracker/Machines/SRM112026001 (id 96)/Photos/Ready/1-photo.png");
  assert.equal(storageTarget("machine-attachments", "96/Electrical/v.webm", "audio/webm", mf), "01 Machine Tracker/Machines/SRM112026001 (id 96)/Voice notes/Electrical/v.webm");
  assert.equal(storageTarget("machine-attachments", "999/x.png", "image/png", mf), "09 Other/Files/machine-attachments/999/x.png");
});

test("drive backup: per-machine slice picks only that machine's rows", () => {
  const data = {
    handover_events: [{ machine_id: 96 }, { machine_id: 5 }],
    audit_log: [{ serial_no: "SN1", ref: "M-10" }, { serial_no: null, ref: "96" }, { serial_no: "OTHER", ref: "x" }],
    outward_log: [{ serial_no: "SN1" }, { issue_id: 7 }, { serial_no: "Z" }],
  };
  const s = machineSlice({ id: 96, serial_no: "SN1", issue_id: 7 }, data);
  assert.equal(s.handover_events.length, 1);
  assert.equal(s.audit_log.length, 2);
  assert.equal(s.outward_log.length, 2);
});

test("drive backup: snapshot stamp is IST and only >90-day snapshots expire", () => {
  assert.equal(istStamp(Date.parse("2026-11-24T07:30:00Z")), "2026-11-24 1300");
  const now = Date.parse("2026-11-24T07:30:00Z");
  const old = expiredSnapshots([{ name: "2026-08-20 1300 (auto)" }, { name: "2026-09-01 2100 (auto)" }, { name: "notes" }], now);
  assert.deepEqual(old.map((f) => f.name), ["2026-08-20 1300 (auto)"]);
});

test("drive backup: workflow runs 1 PM + 9 PM IST, on demand, read-only token", () => {
  const wf = read(".github/workflows/drive-backup.yml");
  assert.match(wf, /cron: "30 7 \* \* \*"/);
  assert.match(wf, /cron: "30 15 \* \* \*"/);
  assert.match(wf, /workflow_dispatch:/);
  assert.match(wf, /contents: read/);
  assert.match(wf, /secrets\.SUPABASE_SERVICE_ROLE_KEY/);
});

test("drive backup: job writes only to its own tables / bucket", () => {
  const src = read("scripts/drive-backup/backup.mjs");
  const writes = [...src.matchAll(/sb\(`([^`]+)`,\s*\{\s*method:\s*"(POST|PATCH|DELETE|PUT)"/g)].map((m) => m[1]);
  const writes2 = [...src.matchAll(/sb\("([^"]+)",\s*\{\s*method:\s*"(POST|PATCH|DELETE|PUT)"/g)].map((m) => m[1]);
  const all = [...writes, ...writes2];
  assert.ok(all.length > 0);
  for (const w of all) {
    assert.ok(/^\/rest\/v1\/backup_(runs|secrets|files)|^\/storage\/v1\/object\/(list\/)?(erp-backups|\$\{bucket\})|^\/storage\/v1\/object\/list\//.test(w), `unexpected write target: ${w}`);
  }
});

test("drive backup: migration 071 keeps secrets away from app users", () => {
  const sql = read("supabase/migrations/071_drive_backup.sql");
  assert.match(sql, /REVOKE ALL ON public\.backup_secrets FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /REVOKE ALL ON public\.backup_files FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /is_super_admin\(\)/);
  assert.match(sql, /'erp-backups', 'erp-backups', false/);
  assert.ok(fs.existsSync(new URL("../supabase/migrations/071_drive_backup_rollback.sql", import.meta.url)));
});

test("drive backup: edge function is Super Admin only and audit-logs actions", () => {
  const fn = read("supabase/functions/drive-backup/index.ts");
  assert.match(fn, /role_key !== "super_admin"|role_key === "super_admin"/);
  assert.match(fn, /Super Admin only/);
  for (const t of ["drive_backup_connected", "drive_backup_requested", "drive_backup_downloaded"]) assert.ok(fn.includes(t), t);
  assert.match(fn, /drive\.file/, "narrow Drive scope: only files the backup made");
});

test("drive backup: Settings panel only for Super Admin, only in online mode", () => {
  const page = read("src/modules/settings/SettingsPage.jsx");
  assert.match(page, /\{isSuperAdmin && <DriveBackupPanel \/>\}/);
  const panel = read("src/modules/settings/DriveBackupPanel.jsx");
  assert.match(panel, /isSupabaseEnabled\(\)/);
  for (const s of ["Back up now", "Download latest (ZIP)", "Connect Google Drive", "1:00 PM and 9:00 PM"]) assert.ok(panel.includes(s), s);
});
