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

// ── Server transcription (2026-11-03, owner): every voice note becomes TEXT,
// even where browser dictation does not work (iPhone Safari, Firefox). The
// Edge Function `voice-transcribe` returns { text } or { error }.
export const VOICE_TRANSCRIBE_FN = "voice-transcribe";
export const VOICE_TRANSCRIBE_MAX_BYTES = 2 * 1024 * 1024;
// 2026-11-04 (owner): the mic only WRITES TEXT — no audio is saved.
export const VOICE_WRITING_TEXT = "Writing…";
export const VOICE_WRITE_PROMPT = "Could not hear — please type";

export function bytesToBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let bin = "";
  const CH = 0x8000; // String.fromCharCode arg limit
  for (let i = 0; i < u8.length; i += CH) bin += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(bin);
}

export async function blobToBase64(blob) {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

// supabase-js invoke result → { ok, text, error }. FunctionsHttpError hides
// the function's own { error } on error.context (a Response).
export async function readTranscribeResult(res) {
  const { data, error } = res || {};
  if (error) {
    let detail = error.message || "request failed";
    try { const b = await error.context?.json(); if (b && b.error) detail = b.error; } catch {}
    return { ok: false, text: "", error: detail };
  }
  if (data && typeof data.error === "string" && data.error) return { ok: false, text: "", error: data.error };
  const text = data && typeof data.text === "string" ? data.text.trim() : "";
  if (!text) return { ok: false, text: "", error: "No words heard" };
  return { ok: true, text, error: "" };
}

// invoke = (name, { body }) => Promise<{ data, error }> (supabase.functions.invoke).
export async function transcribeVoiceBlob(blob, invoke) {
  if (typeof invoke !== "function") return { ok: false, text: "", error: "offline" };
  if (!blob || !blob.size) return { ok: false, text: "", error: "empty audio" };
  if (blob.size > VOICE_TRANSCRIBE_MAX_BYTES) return { ok: false, text: "", error: "audio too long" };
  try {
    const audioBase64 = await blobToBase64(blob);
    const res = await invoke(VOICE_TRANSCRIBE_FN, { body: { audioBase64, mimeType: baseMime(blob.type) || "audio/webm" } });
    return await readTranscribeResult(res);
  } catch (e) {
    return { ok: false, text: "", error: (e && e.message) || "request failed" };
  }
}

// Put the transcript into the box only if it is still empty (or holds our
// old placeholder); never overwrite what the worker typed meanwhile.
export function fillTranscript(prev, text) {
  const cur = clearVoiceText(String(prev || ""));
  return cur.trim() ? prev : String(text || "").trim();
}

export function readVoiceLang(storage) {
  try { const v = storage && storage.getItem(VOICE_LANG_KEY); if (v && VOICE_LANGS.some(([c]) => c === v)) return v; } catch {}
  return VOICE_LANG_DEFAULT;
}

// ── 2026-11-04 (owner): mic = text only ──────────────────────────────────
// Light tidy-up of browser dictation (the fallback when the server cannot
// write the words): drop filler words, collapse spaces, capitalise the first
// Latin letter, end with a full stop (। for Devanagari). Never translates.
const FILLERS = /(^|\s)(um+|uh+|umm+|hmm+|er+|ah+|अं+|ऊं+|हम्म+)(?=\s|[,.!?।]|$)/giu;
export function tidySpoken(text) {
  let t = String(text || "").replace(FILLERS, " ").replace(/\s+/g, " ").replace(/\s+([,.!?।])/g, "$1").trim();
  if (!t) return "";
  t = t.replace(/^([a-z])/, (c) => c.toUpperCase());
  if (!/[.!?।]$/.test(t)) t += /[\u0900-\u097F]/.test(t) ? "।" : ".";
  return t;
}

// Append spoken words to what is already in the box (space between).
export function appendSpoken(prev, text) {
  const add = String(text || "").trim();
  const cur = clearVoiceText(String(prev || ""));
  if (!add) return cur;
  return cur.trim() ? `${cur.replace(/\s+$/, "")} ${add}` : add;
}

// iPhone/iPad: browser dictation fights the recorder for the mic, so the
// live preview is skipped there (the server writes the words).
export function isAppleMobile(nav) {
  const ua = String((nav && nav.userAgent) || "");
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && Number(nav && nav.maxTouchPoints) > 1);
}

// ── 2026-11-05 (owner): spoken words never reached the box on phones ─────
// Android Chrome: browser dictation (SpeechRecognition) takes the mic away
// from the recorder, so the recorded clip was silent and the server heard
// nothing. Like iPhone, Android must not run dictation next to the recorder.
export function isAndroid(nav) {
  return /Android/i.test(String((nav && nav.userAgent) || ""));
}
// Run live dictation next to the recorder only on desktop browsers.
export function canDictateWhileRecording(nav) {
  return !isAppleMobile(nav) && !isAndroid(nav);
}

// Speech results → { finals, interim }. Rebuilt from ALL results each time
// (not appended), and Android's habit of repeating the earlier words inside
// each new final result ("belt", "belt is loose") is folded into one phrase.
export function mergeSpeechResults(results) {
  let finals = ""; let interim = "";
  const list = results ? Array.from({ length: results.length }, (_, i) => results[i]) : [];
  for (const res of list) {
    const t = String((res && res[0] && res[0].transcript) || "").trim();
    if (!t) continue;
    if (res.isFinal) {
      const a = finals.toLowerCase(); const b = t.toLowerCase();
      if (!finals) finals = t;
      else if (b.startsWith(a)) finals = t;      // cumulative repeat (Android)
      else if (a.endsWith(b)) { /* exact repeat */ }
      else finals = `${finals} ${t}`;
    } else interim = interim ? `${interim} ${t}` : t;
  }
  return { finals, interim };
}

// Mono 16-bit PCM WAV. The recorder's WebM/MP4 clip is turned into WAV
// before it goes to the voice-transcribe server: WAV is accepted by every
// speech model (WebM is not on Gemini's list of audio types).
export const VOICE_WAV_RATE = 16000;
export function encodeWav16(samples, sampleRate = VOICE_WAV_RATE) {
  const n = samples ? samples.length : 0;
  const out = new Uint8Array(44 + n * 2);
  const v = new DataView(out.buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, Number(samples[i]) || 0));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

// ── 2026-11-05 (owner: "the mic takes too long to write text") ───────────
// Android Chrome: the phone's own dictation works well ALONE (it only fails
// when the recorder runs next to it), and it writes the words the moment the
// worker stops talking — so Android uses dictation alone first. If dictation
// fails on that phone, the next tap records and asks the server instead.
export function canDictateAlone(nav) {
  return isAndroid(nav);
}

// Desktop: the live dictation words go into the box the moment Stop is
// tapped; the server's cleaner version replaces them if it arrives within
// this time. Later (or failed) → the live words simply stay.
export const VOICE_SERVER_WAIT_MS = 6000;

// Swap the live words we put at the END of the box for the server's text.
// If the worker already changed that part of the box, leave the box alone.
export function swapLiveText(prev, live, server) {
  const cur = String(prev || "");
  const l = String(live || "").trim();
  const s = String(server || "").trim();
  if (!l || !s) return cur;
  const trimmed = cur.replace(/\s+$/, "");
  if (!trimmed.endsWith(l)) return cur;
  return appendSpoken(trimmed.slice(0, trimmed.length - l.length), s);
}

// Cut the quiet part before the first and after the last spoken sound, so a
// smaller clip is sent (faster upload + faster model). Keeps `padMs` of
// air on each side. A clip with no sound above the threshold is returned
// unchanged (the server then says "nothing heard", as before).
export function trimSilence(samples, sampleRate = VOICE_WAV_RATE, { threshold = 0.012, padMs = 250, frameMs = 20 } = {}) {
  const n = samples ? samples.length : 0;
  if (!n) return samples;
  const frame = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
  const loud = (from) => {
    const to = Math.min(n, from + frame);
    let sum = 0;
    for (let i = from; i < to; i++) { const v = Number(samples[i]) || 0; sum += v * v; }
    return Math.sqrt(sum / Math.max(1, to - from)) >= threshold;
  };
  let first = -1;
  for (let i = 0; i < n; i += frame) if (loud(i)) { first = i; break; }
  if (first < 0) return samples;
  let last = first;
  for (let i = Math.floor((n - 1) / frame) * frame; i >= first; i -= frame) if (loud(i)) { last = Math.min(n, i + frame); break; }
  const pad = Math.round((sampleRate * padMs) / 1000);
  const a = Math.max(0, first - pad);
  const b = Math.min(n, last + pad);
  if (a === 0 && b === n) return samples;
  return typeof samples.subarray === "function" ? samples.subarray(a, b) : samples.slice(a, b);
}

// Short reason shown under the box when the words could not be written.
export function voiceFailText(error, canRetryByPhone) {
  const e = String(error || "");
  const base = VOICE_WRITE_PROMPT;
  if (/not allowed|denied|mic is off/i.test(e)) return "Mic is off — allow it in the browser";
  return canRetryByPhone ? `${base} — or tap 🎤 again` : base;
}
