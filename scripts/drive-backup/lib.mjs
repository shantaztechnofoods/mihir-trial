// Pure helpers for the Google Drive backup job (unit-tested in tests/driveBackup.test.mjs).
// No network, no file system — keep it that way so the test can import it.

export const ROOT_NAME_DEFAULT = "SHANTAZ ERP Backup (Trial)";
export const SNAPSHOT_KEEP_DAYS = 90;
export const ZIP_KEEP = 3;
export const IST_OFFSET_MIN = 330;

// Module folders, in the order they appear in Drive. Every table the database
// has but this list does not name goes to "09 Other" — nothing is skipped
// except SKIP_TABLES (secrets / the job's own bookkeeping).
export const MODULES = [
  { folder: "01 Machine Tracker", master: "Machine Tracker MASTER.xlsx", tables: ["machine_log", "handover_events", "pending_handover_items", "pending_item_receipts", "checklist_responses", "department_ratings", "machine_attachments", "employee_signatures"] },
  { folder: "02 Item Master", master: "Item Master MASTER.xlsx", tables: ["items", "item_history"] },
  { folder: "03 Inward Outward Stock", master: "Inward Outward Stock MASTER.xlsx", tables: ["inward_log", "outward_log", "stock_movements"] },
  { folder: "04 Purchase and Vendors", master: "Purchase and Vendors MASTER.xlsx", tables: ["purchase_orders", "vendors", "follow_ups"] },
  { folder: "05 BOM and Checklists", master: "BOM and Checklists MASTER.xlsx", tables: ["bom_definitions", "checklist_templates"] },
  { folder: "06 Pending Stock", master: "Pending Stock MASTER.xlsx", tables: ["pending_log"] },
  { folder: "07 Audit Trail", master: "Audit Trail MASTER.xlsx", tables: ["audit_log"] },
  { folder: "08 Users and Settings", master: "Users and Settings MASTER.xlsx", tables: ["users", "roles", "settings", "backup_runs"] },
];
export const OTHER_MODULE = { folder: "09 Other", master: "Other MASTER.xlsx", tables: [] };
export const SKIP_TABLES = new Set(["backup_secrets", "backup_files"]);

export const SHEET_NAMES = {
  machine_log: "Machines", handover_events: "Stage moves", pending_handover_items: "Pending items",
  pending_item_receipts: "Pending receipts", checklist_responses: "Checklist answers", department_ratings: "Dept ratings",
  machine_attachments: "Photos and files", employee_signatures: "Signatures", items: "Items", item_history: "Item history",
  inward_log: "Inward", outward_log: "Outward", stock_movements: "Stock movements", purchase_orders: "Purchase orders",
  vendors: "Vendors", follow_ups: "PO follow-ups", bom_definitions: "BOMs", checklist_templates: "Checklist templates",
  pending_log: "Pending stock", audit_log: "Audit log", users: "Users", roles: "Roles", settings: "Settings", backup_runs: "Backup runs",
};

/** Group table names into module buckets; unknown tables land in "09 Other". */
export function groupTables(tableNames) {
  const known = new Set(MODULES.flatMap((m) => m.tables));
  const present = new Set(tableNames.filter((t) => !SKIP_TABLES.has(t) && !t.startsWith("v_")));
  const out = MODULES.map((m) => ({ ...m, tables: m.tables.filter((t) => present.has(t)) }));
  const other = [...present].filter((t) => !known.has(t)).sort();
  if (other.length) out.push({ ...OTHER_MODULE, tables: other });
  return out.filter((m) => m.tables.length);
}

const SECRET_KEY = /(api.?key|token|secret|password|passwd|credential|^(wa|gemini|anthropic|openai|google|github|sentry).*key$)/i; // + camelCase "…Key" (waApiKey, waGeminiKey) below
// camelCase "…Key" only when the value looks like a key (long string) — keeps e.g. bomKey "M-10" visible.
const isSecretKey = (k, v) => SECRET_KEY.test(k) || (/[a-z]Key$/.test(k) && typeof v === "string" && v.length >= 16);
/** Deep copy with every secret-looking value replaced (settings hold WhatsApp / AI keys). */
export function redact(value, depth = 0) {
  if (depth > 20 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const o = {};
    for (const [k, v] of Object.entries(value)) {
      o[k] = isSecretKey(k, v) && v != null && v !== "" && typeof v !== "boolean" ? "•••• hidden in backup" : redact(v, depth + 1);
    }
    return o;
  }
  return value;
}
export const redactRows = (table, rows) => (table === "settings" ? rows.map((r) => ({ ...r, value: redact(r.value) })) : rows);

/** Windows / Drive-for-desktop safe file or folder name. */
export const safeName = (s) => String(s ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 120) || "unnamed";

export function machineFolderName(m) {
  const sn = String(m.serial_no || "").trim();
  return safeName(sn ? `${sn} (id ${m.id})` : `${m.bom_key || "Machine"} no serial (id ${m.id})`);
}

export const humanize = (col) => String(col).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bId\b/g, "ID").replace(/\bNo\b/g, "No.");

const ISO_TS = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** IST wall-clock as a Date whose UTC fields hold IST (Excel has no time zones). */
export const toIstWall = (ms) => new Date(ms + IST_OFFSET_MIN * 60000);

/** One cell: { v, fmt } — timestamps become IST Excel dates, JSON becomes text. */
export function cell(v) {
  if (v == null || v === "") return { v: null };
  if (typeof v === "boolean") return { v: v ? "Yes" : "No" };
  if (typeof v === "number") return { v };
  if (typeof v === "string") {
    if (ISO_TS.test(v)) { const t = Date.parse(v); if (Number.isFinite(t)) return { v: toIstWall(t), fmt: "dd-mmm-yyyy hh:mm" }; }
    if (ISO_DATE.test(v)) return { v: new Date(`${v}T00:00:00Z`), fmt: "dd-mmm-yyyy" };
    return { v: v.length > 32000 ? `${v.slice(0, 32000)} …(cut, full text in _Raw data)` : v };
  }
  const s = JSON.stringify(v);
  return { v: s.length > 32000 ? `${s.slice(0, 32000)} …(cut, full text in _Raw data)` : s };
}

/** Column list for a set of rows (first-seen order, preferred columns first). */
export function columnsOf(rows, preferred = []) {
  const seen = new Set(preferred.filter((c) => rows.some((r) => r && c in r)));
  for (const r of rows) for (const k of Object.keys(r || {})) seen.add(k);
  return [...seen];
}

/** Flatten an object one level for key/value sheets. */
export const keyValueRows = (obj) => Object.entries(obj || {}).map(([field, value]) => ({ field: humanize(field), value }));

/** Rows that belong to one machine, per table. */
export function machineSlice(m, data) {
  const idOf = (r) => String(r.machine_id ?? "");
  const mid = String(m.id);
  const sn = String(m.serial_no || "");
  const by = (t) => (data[t] || []).filter((r) => idOf(r) === mid);
  return {
    handover_events: by("handover_events"),
    pending_handover_items: by("pending_handover_items"),
    pending_item_receipts: by("pending_item_receipts"),
    checklist_responses: by("checklist_responses"),
    department_ratings: by("department_ratings"),
    machine_attachments: by("machine_attachments"),
    outward_log: (data.outward_log || []).filter((r) => (sn && r.serial_no === sn) || (m.issue_id != null && String(r.issue_id) === String(m.issue_id))),
    audit_log: (data.audit_log || []).filter((r) => (sn && r.serial_no === sn) || String(r.ref || "") === mid || (sn && String(r.ref || "").includes(sn))),
  };
}

/** Sub-folder for a stored machine file. */
export function attachmentSubfolder(mime = "", kind = "") {
  const t = String(mime || "").toLowerCase();
  if (t.startsWith("image/")) return "Photos";
  if (t.startsWith("video/")) return "Videos";
  if (t.startsWith("audio/") || /voice/i.test(kind)) return "Voice notes";
  return "Files";
}

/** "2026-11-24 1300" in IST — the snapshot folder name. */
export function istStamp(ms = Date.now()) {
  const d = toIstWall(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

/** Snapshot folders older than keepDays (by the IST stamp in their name). */
export function expiredSnapshots(folders, nowMs = Date.now(), keepDays = SNAPSHOT_KEEP_DAYS) {
  const cutoff = nowMs - keepDays * 86400000;
  return folders.filter((f) => {
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2})(\d{2})/.exec(f.name || "");
    if (!m) return false;
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - IST_OFFSET_MIN * 60000;
    return t < cutoff;
  });
}

/**
 * Where a Storage object goes inside the backup tree.
 *   item-media/bom-photos/…            → 05 BOM and Checklists/BOM photos/…
 *   item-media/(designs|photos)/…      → 02 Item Master/Item photos and files/…
 *   machine-attachments/<id>/<dept>/f  → 01 Machine Tracker/Machines/<machine>/<Photos|Videos|Voice notes|Files>/<dept>/f
 *   anything else                      → 09 Other/Files/<bucket>/…
 * machineFolders: Map(String(machine id) → folder name).
 */
export function storageTarget(bucket, path, mime = "", machineFolders = new Map()) {
  if (bucket === "item-media" && path.startsWith("bom-photos/")) return `05 BOM and Checklists/BOM photos/${path.slice("bom-photos/".length)}`;
  if (bucket === "item-media") return `02 Item Master/Item photos and files/${path}`;
  if (bucket === "machine-attachments") {
    const [id, ...rest] = path.split("/");
    const folder = machineFolders.get(String(id));
    if (folder && rest.length) {
      const file = rest.pop();
      return ["01 Machine Tracker/Machines", folder, attachmentSubfolder(mime, file), ...rest.map(safeName), safeName(file)].join("/");
    }
  }
  return `09 Other/Files/${bucket}/${path}`;
}
