// src/modules/machine-tracker/parts.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useEffect } from "react";
import { senderUndoState, formatUndoCountdown } from "../../utils/handoverLogic.js";
import { signedUrlFor } from "../../stores/attachmentsStore.js";

// 2026-11-03 (owner-approved) — SENDER UNDO button with a live countdown.
// Ticks every second on its own (the tracker's nowTick is 60 s) and hides
// itself the moment the window closes or the hand-over is accepted.
export function SenderUndoButton({ handover, user, onUndo }) {
  const [now, setNow] = useState(Date.now());
  const st = senderUndoState(handover, user, now);
  useEffect(() => {
    if (!st.allowed) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [st.allowed]);
  if (!st.allowed) return null;
  return (
    <button data-needs-net type="button" data-sender-undo={handover.id} onClick={() => onUndo(handover)}
            className="min-h-[48px] self-start sm:self-auto px-4 rounded-xl text-[15px] font-black transition-all active:scale-[0.97] inline-flex items-center justify-center gap-1.5 shrink-0"
            style={{ background: "#f59e0b", color: "#1f1300" }}>
      ↩ Undo <span className="tabular-nums" data-sender-undo-clock>({formatUndoCountdown(st.remainingMs)})</span>
    </button>
  );
}

// ── Phase B — Attachment link with signed-URL resolution ──
// For Supabase-stored attachments, the storage_path is a bucket path, not a
// public URL. This component resolves a 1h signed URL on demand (click).
export function AttachmentLink({ attachment }) {
  const [resolving, setResolving] = useState(false);
  const open = async (e) => {
    e.preventDefault();
    if (!attachment) return;
    // Local-mode data: URLs can open directly.
    if (attachment.storagePath && attachment.storagePath.startsWith("data:")) {
      window.open(attachment.storagePath, "_blank", "noopener");
      return;
    }
    setResolving(true);
    const url = await signedUrlFor(attachment);
    setResolving(false);
    if (url) window.open(url, "_blank", "noopener");
    else alert("Could not open file. Ensure migration 024 is applied and the 'machine-attachments' bucket exists.");
  };
  return (
    <a href="#" onClick={open} className="text-blue-300 hover:text-blue-200 underline">
      {attachment.fileName || "(unnamed)"}{resolving ? "…" : ""}
    </a>
  );
}

export function ModalX({ onClose, disabled = false, label = "Close" }) {
  return (
    <button type="button" aria-label={label} title={label} data-modal-close onClick={onClose} disabled={disabled}
            className="absolute top-2.5 right-2.5 z-10 w-9 h-9 rounded-full flex items-center justify-center text-[15px] font-black transition-colors disabled:opacity-40"
            style={{ background: "rgba(17,24,39,0.07)", color: "var(--text-dim)" }}>✕</button>
  );
}
