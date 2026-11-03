// 2026-11-03 — Admin "Ready machines" popup. Pure, read-only helpers: which
// machines became READY since the admin last looked. Nothing here writes
// machine data; the only thing stored is a per-user "last seen" timestamp in
// localStorage (a per-viewer convenience — losing it just re-shows the last
// 24 hours).

export const READY_FIRST_WINDOW_MS = 24 * 60 * 60 * 1000;
export const READY_SEEN_KEY_PREFIX = "erp_ready_seen_";

// Only the factory owners see the popup; floor staff are never interrupted.
export const isReadyPopupRole = (user) => !!user && (user.role === "super_admin" || user.role === "Admin");

export const isReadyMachine = (m) => !!m && (m.status === "completed" || m.stage === "Ready");

// When the machine became Ready (ms), or null when unknown. The accept-into-
// Ready history row carries an exact ISO `at`; older rows only have the
// day-precision completedDate ("3 Nov 2026"), read as that day's start.
export function readyAtOf(m) { const r = readyInfoOf(m); return r ? r.at : null; }
export function readyInfoOf(m) {
  if (!isReadyMachine(m)) return null;
  const hist = Array.isArray(m.history) ? m.history : [];
  for (let i = hist.length - 1; i >= 0; i--) {
    const h = hist[i];
    if (h && h.stage === "Ready") {
      const t = Date.parse(h.at || "");
      if (!Number.isNaN(t)) return { at: t, exact: true };
      break;
    }
  }
  const d = Date.parse(m.completedDate || "");
  return Number.isNaN(d) ? null : { at: d, exact: false };
}

// Who signed the Trial (from the stored Trial Certificate), or "".
export function trialSignedBy(m) {
  const c = (m && m.trialCertificate) || null;
  if (!c) return "";
  return String(c.trialByName || c.checkByName || c.signedBy || c.checkedBy || "").trim();
}

// Machines that became Ready after `lastSeenMs`, newest first. With no
// last-seen (first ever open) only the last 24 hours are shown, so a factory
// with years of history never gets a huge list. Future-dated rows (clock skew)
// still count — they are new.
export function newReadySince(machines, lastSeenMs, nowMs = Date.now()) {
  const list = Array.isArray(machines) ? machines : [];
  const seen = Number(lastSeenMs);
  const cutoff = Number.isFinite(seen) && seen > 0 ? seen : nowMs - READY_FIRST_WINDOW_MS;
  const out = [];
  for (const m of list) {
    const r = readyInfoOf(m);
    if (r && r.at > cutoff) out.push({ machine: m, readyAt: r.at, exact: r.exact });
  }
  return out.sort((a, b) => b.readyAt - a.readyAt);
}

const keyFor = (userId) => `${READY_SEEN_KEY_PREFIX}${userId || "anon"}`;

export function readLastSeenReady(userId, storage = globalThis.localStorage) {
  try {
    const v = storage && storage.getItem(keyFor(userId));
    const n = v == null ? NaN : Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch { return null; }
}

export function writeLastSeenReady(userId, ms, storage = globalThis.localStorage) {
  try { storage && storage.setItem(keyFor(userId), String(Math.round(ms))); return true; } catch { return false; }
}

// "Today, 2:40 pm" / "Yesterday, 9:05 am" / "1 Nov, 4:10 pm".
// exact=false (date only) drops the time.
export function formatReadyWhen(ms, nowMs = Date.now(), exact = true) {
  if (ms == null || !Number.isFinite(ms)) return "";
  const d = new Date(ms), n = new Date(nowMs);
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(n) - day(d)) / 86400000);
  const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
  const label = diff === 0 ? "Today" : diff === 1 ? "Yesterday" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return exact ? `${label}, ${time}` : label;
}
