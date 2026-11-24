// src/modules/settings/DriveBackupPanel.jsx — Google Drive backup (Settings → Data & Backup, Super Admin).
// Twice a day (1:00 PM / 9:00 PM IST) a GitHub job copies every module's data to Excel, plus all
// photos / videos / voice notes, into the connected Google Drive (scripts/drive-backup/).
// This panel: connection status, "Back up now", "Download latest (ZIP)", last runs.
// Everything goes through the drive-backup edge function (Super Admin checked there).
import React, { useCallback, useEffect, useRef, useState } from "react";
import { isSupabaseEnabled } from "../../config/env.js";
import { driveBackup } from "../../stores/adminApi.js";

const fmt = (iso) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" });
  } catch { return String(iso); }
};
const RESULT = {
  ok:      { label: "Done",            color: "#15803d", bg: "rgba(22,163,74,0.10)" },
  partial: { label: "Done, with gaps", color: "#b45309", bg: "rgba(217,119,6,0.12)" },
  failed:  { label: "Failed",          color: "#b91c1c", bg: "rgba(220,38,38,0.10)" },
  running: { label: "Backing up…",     color: "#2640B0", bg: "rgba(46,80,214,0.10)" },
  queued:  { label: "Starting…",       color: "#2640B0", bg: "rgba(46,80,214,0.10)" },
};
const Pill = ({ status }) => {
  const r = RESULT[status] || { label: status, color: "#475569", bg: "rgba(17,24,39,0.06)" };
  return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ color: r.color, background: r.bg }}>{r.label}</span>;
};
const btn = "inline-flex items-center justify-center text-[12px] font-semibold h-9 px-3.5 rounded-xl border transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
const btnGhost = `${btn} border-slate-200 text-slate-700 bg-white hover:bg-slate-50`;
const btnPrimary = `${btn} text-white`;

export function DriveBackupPanel() {
  const live = isSupabaseEnabled();
  const [st, setSt] = useState(null);       // status payload
  const [busy, setBusy] = useState("");     // which button is working
  const [msg, setMsg] = useState(null);     // { tone, text }
  const watchUntil = useRef(0);
  const [watch, setWatch] = useState(0); // bumps after "Connect" so polling starts

  const load = useCallback(async () => {
    const r = await driveBackup("status");
    if (r.success) setSt(r);
    else setMsg({ tone: "err", text: r.notDeployed ? "Drive backup is not installed on the server yet." : r.error });
    return r;
  }, []);

  useEffect(() => { if (live) load(); }, [live, load]);

  // Poll while a backup is running, or for 3 minutes after "Connect" was pressed.
  const running = (st?.runs || []).some((r) => r.status === "queued" || r.status === "running");
  useEffect(() => {
    if (!live) return undefined;
    if (!running && Date.now() > watchUntil.current) return undefined;
    const t = setInterval(async () => {
      const r = await load();
      const stillRunning = (r?.runs || []).some((x) => x.status === "queued" || x.status === "running");
      if (!stillRunning && Date.now() > watchUntil.current) clearInterval(t);
    }, 8000);
    return () => clearInterval(t);
  }, [live, running, watch, load]);

  if (!live) {
    return (
      <div data-drive-backup className="p-4 rounded-xl border border-slate-200" style={{ background: "rgba(17,24,39,0.03)" }}>
        <div className="text-[13px] font-semibold text-slate-900">Google Drive backup</div>
        <div className="text-[11px] text-slate-500 mt-0.5">Available when the ERP is connected to the online database.</div>
      </div>
    );
  }

  const act = async (action) => {
    setBusy(action); setMsg(null);
    const r = await driveBackup(action);
    setBusy("");
    if (!r.success) { setMsg({ tone: "err", text: r.error }); return; }
    if (action === "connect" && r.url) {
      watchUntil.current = Date.now() + 3 * 60 * 1000;
      window.open(r.url, "_blank", "noopener");
      setMsg({ tone: "info", text: "Google sign-in opened in a new tab. Choose the Drive account and press Allow." });
      setWatch((n) => n + 1);
    } else if (action === "run") {
      setMsg({ tone: "info", text: r.alreadyRunning ? "A backup is already running." : "Backup started. It takes about 5–10 minutes." });
      await load();
    } else if (action === "download" && r.url) {
      window.location.href = r.url;
      setMsg({ tone: "info", text: `Downloading the backup from ${fmt(r.finishedAt)}.` });
    }
  };

  const runs = st?.runs || [];
  const last = runs[0];
  const lastDone = runs.find((r) => r.status === "ok" || r.status === "partial");
  const connected = Boolean(st?.connected);

  return (
    <div data-drive-backup className="p-4 rounded-xl border border-slate-200" style={{ background: "rgba(17,24,39,0.03)" }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-slate-900">Google Drive backup</span>
            {st && (connected
              ? <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ color: "#15803d", background: "rgba(22,163,74,0.10)" }}>✓ Connected</span>
              : <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ color: "#b45309", background: "rgba(217,119,6,0.12)" }}>Not connected</span>)}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Every day at 1:00 PM and 9:00 PM — Excel for every module, every machine's log, photos, videos and voice notes.
            {connected && st?.email ? ` Saved to ${st.email}.` : ""}
          </div>
          {last && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-slate-700">
              <span>Last backup:</span>
              <span className="font-semibold">{fmt(last.finished_at || last.started_at || last.requested_at)}</span>
              <Pill status={last.status} />
              {lastDone?.summary?.rows != null && last.status !== "failed" && (
                <span className="text-slate-500">{Number(lastDone.summary.rows).toLocaleString("en-IN")} rows · {lastDone.summary.files || 0} files</span>
              )}
            </div>
          )}
          {last?.status === "failed" && last.error && <div className="mt-1 text-[11px]" style={{ color: "#b91c1c" }}>{String(last.error).slice(0, 220)}</div>}
        </div>
        <div className="flex flex-wrap gap-2">
          {connected ? (
            <>
              <button type="button" className={btnPrimary} style={{ background: "#2640B0", borderColor: "#2640B0" }}
                      disabled={!!busy || running} onClick={() => act("run")}>
                {running ? "Backing up…" : busy === "run" ? "Starting…" : "Back up now"}
              </button>
              <button type="button" className={btnGhost} disabled={!!busy || !lastDone} onClick={() => act("download")}>
                {busy === "download" ? "Preparing…" : "Download latest (ZIP)"}
              </button>
              {st?.folderUrl && <a className={btnGhost} href={st.folderUrl} target="_blank" rel="noopener noreferrer">Open Drive folder</a>}
            </>
          ) : (
            <button type="button" className={btnPrimary} style={{ background: "#2640B0", borderColor: "#2640B0" }}
                    disabled={!!busy || (st && !st.configured)} onClick={() => act("connect")}>
              {busy === "connect" ? "Opening…" : "Connect Google Drive"}
            </button>
          )}
        </div>
      </div>

      {st && !st.configured && (
        <div className="mt-3 text-[11px] text-slate-500">Server setup is not finished (Google sign-in keys). The administrator completes this once.</div>
      )}
      {msg && (
        <div className="mt-3 text-[12px] px-3 py-2 rounded-lg" role="status"
             style={msg.tone === "err" ? { color: "#b91c1c", background: "rgba(220,38,38,0.08)" } : { color: "#1e3a8a", background: "rgba(46,80,214,0.08)" }}>
          {msg.text}
        </div>
      )}

      {runs.length > 1 && (
        <details className="mt-3">
          <summary className="text-[11px] font-semibold text-slate-500 cursor-pointer select-none">Recent backups</summary>
          <ul className="mt-2 divide-y divide-slate-200 text-[12px]">
            {runs.slice(0, 8).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="w-[120px] text-slate-700">{fmt(r.finished_at || r.started_at || r.requested_at)}</span>
                <span className="text-slate-500 w-[110px] truncate">{r.kind === "manual" ? (r.requested_by_name || "Back up now") : "Automatic"}</span>
                <Pill status={r.status} />
                {r.summary?.rows != null && <span className="text-slate-500">{Number(r.summary.rows).toLocaleString("en-IN")} rows · {r.summary.files || 0} files</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
