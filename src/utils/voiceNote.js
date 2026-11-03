// Voice notes (2026-11-03) — pure helpers for the 🎤 Record button in
// Machine Tracker. A voice note is an ordinary machine attachment (same
// table, same bucket, same upload path); it is recognised by its audio/*
// mime type. Nothing here touches storage or React.

export const VOICE_MAX_SECONDS = 60;
// Put into a text box that is still empty after a voice note was saved, so
// the existing "must not be empty" checks see it as filled. Plain text: the
// saved data shape does not change.
export const VOICE_FALLBACK_TEXT = "🎤 Voice note";
// Speech-to-text languages. Same localStorage key and default as the Report
// Issue dictation, so a worker picks the language once per phone.
export const VOICE_LANGS = [["gu-IN", "ગુજરાતી"], ["hi-IN", "हिंदी"], ["en-IN", "English"]];
export const VOICE_LANG_KEY = "erp_voice_lang";
export const VOICE_LANG_DEFAULT = "hi-IN";

// Chrome/Android/Firefox record WebM/Opus; iPhone Safari records MP4/AAC.
const CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
export function pickVoiceMime(isTypeSupported) {
  if (typeof isTypeSupported !== "function") return "";
  for (const m of CANDIDATES) { try { if (isTypeSupported(m)) return m; } catch {} }
  return "";
}

// "audio/webm;codecs=opus" -> "audio/webm". Storage content type uses the base.
export function baseMime(mime) {
  return String(mime || "").split(";")[0].trim().toLowerCase();
}

export function voiceExt(mime) {
  const b = baseMime(mime);
  if (b === "audio/mp4" || b === "audio/aac" || b === "audio/x-m4a") return "m4a";
  if (b === "audio/ogg") return "ogg";
  if (b === "audio/mpeg") return "mp3";
  return "webm";
}

export function voiceFileName(place, ts, mime) {
  const slug = String(place || "note").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "note";
  return `voice-${slug}-${Number(ts) || 0}.${voiceExt(mime)}`;
}

// Caption = where it was recorded, e.g. "Accept checklist: Oil level".
export function voiceCaption(place, item) {
  const p = String(place || "Voice note").trim();
  const i = String(item || "").trim();
  return (i ? `${p}: ${i}` : p).slice(0, 160);
}

export function isVoiceAttachment(a) {
  if (!a) return false;
  if (baseMime(a.mimeType).startsWith("audio/")) return true;
  return /^voice-.*\.(webm|m4a|ogg|mp3)$/i.test(String(a.fileName || ""));
}

// Voice notes of one machine, newest first.
export function voiceNotesFor(attachments, machineId) {
  return (Array.isArray(attachments) ? attachments : [])
    .filter((a) => a && String(a.machineId) === String(machineId) && isVoiceAttachment(a))
    .sort((x, y) => String(y.uploadedAt || "").localeCompare(String(x.uploadedAt || "")));
}

export function formatClock(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function micErrorMessage(err) {
  const n = (err && (err.name || err.error)) || "";
  if (n === "NotAllowedError" || n === "SecurityError" || n === "PermissionDeniedError" || n === "not-allowed") return "Mic is off — allow it in the browser";
  if (n === "NotFoundError" || n === "DevicesNotFoundError") return "No mic found on this device";
  if (n === "NotReadableError" || n === "TrackStartError") return "Mic is busy in another app";
  if (n === "unsupported") return "Recording is not supported on this browser";
  return "Could not start the mic";
}

// Text box helpers: fill only an empty box; clear only our own placeholder.
export function fillVoiceText(text) {
  return String(text || "").trim() ? text : VOICE_FALLBACK_TEXT;
}
export function clearVoiceText(text) {
  return String(text || "").trim() === VOICE_FALLBACK_TEXT ? "" : text;
}
// Append a dictated phrase to whatever is in the box (replacing our placeholder).
export function appendTranscript(text, phrase) {
  const add = String(phrase || "").trim();
  const cur = clearVoiceText(String(text || ""));
  if (!add) return cur;
  return cur.trim() ? `${cur.replace(/\s+$/, "")} ${add}` : add;
}

export function readVoiceLang(storage) {
  try { const v = storage && storage.getItem(VOICE_LANG_KEY); if (v && VOICE_LANGS.some(([c]) => c === v)) return v; } catch {}
  return VOICE_LANG_DEFAULT;
}
