// Voice search controller (2026-11-06). Loaded on the first tap of the mic
// in the global search (dynamic import), so none of this is in the main
// chunk. Reuses the app's existing voice pieces exactly as the Machine
// Tracker mic uses them — same recorder, same live browser dictation, same
// voice-transcribe Edge Function (transcribeVoice / voiceClipToWav /
// warmVoiceServer) — without changing them. No audio is stored.
//
//  * Desktop: recorder + live dictation -> words appear in the box while
//    speaking; on stop the server's cleaner text replaces them (<= 6 s).
//  * Android: phone dictation alone (instant words).
//  * iPhone: recorder only -> "Writing…" -> server text.
import { transcribeVoice, voiceClipToWav, warmVoiceServer } from "../../shared/voice/VoiceNote.jsx";
export { normalizeVoiceQuery } from "../../utils/voiceSearch.js";
import { pickVoiceMime, baseMime, micErrorMessage, mergeSpeechResults, canDictateWhileRecording, canDictateAlone, VOICE_SERVER_WAIT_MS } from "../../utils/voiceNote.js";

// A search is a few words: stop by itself after this long.
export const SEARCH_VOICE_MAX_MS = 15000;
// Search codes are English letters + numbers.
export const SEARCH_VOICE_LANG = "en-IN";

export function searchMicError(err) {
  const n = (err && (err.name || err.error)) || "";
  if (n === "NotAllowedError" || n === "SecurityError" || n === "PermissionDeniedError" || n === "not-allowed" || n === "service-not-allowed")
    return "Mic is blocked. Allow it from the lock icon in the address bar, or type.";
  return micErrorMessage(err);
}

// onState({ phase: "idle"|"starting"|"listening"|"writing", error }),
// onText(text, final) — raw spoken words (normalise in the caller).
export function createSearchVoice({ onState, onText }) {
  const s = { rec: null, sr: null, stream: null, chunks: [], finals: "", interim: "", srErr: "", srDone: null, timer: null, stopping: false, dead: false, phase: "idle" };
  const set = (phase, error = "") => { s.phase = phase; if (!s.dead) onState({ phase, error }); };
  const live = () => `${s.finals} ${s.interim}`.replace(/\s+/g, " ").trim();
  const release = () => {
    if (s.timer) { clearTimeout(s.timer); s.timer = null; }
    try { s.sr && s.sr.stop(); } catch {}
    try { s.stream && s.stream.getTracks().forEach((t) => t.stop()); } catch {}
    s.stream = null;
  };

  const finish = async (blob) => {
    if (s.dead) return;
    const serverP = blob && blob.size ? voiceClipToWav(blob).then((wav) => transcribeVoice(wav)) : null;
    if (s.srDone) await Promise.race([s.srDone, new Promise((r) => setTimeout(r, blob ? 400 : 700))]);
    if (s.dead) return;
    const heard = live();
    const srErr = s.srErr;
    s.finals = ""; s.interim = ""; s.chunks = []; s.rec = null; s.sr = null;
    if (heard) {
      onText(heard, true); set("idle");
      if (serverP) {
        const out = await Promise.race([serverP, new Promise((r) => setTimeout(() => r(null), VOICE_SERVER_WAIT_MS))]);
        if (!s.dead && out && out.ok) onText(String(out.text).trim(), true, heard);
      }
      return;
    }
    if (!serverP) { set("idle", srErr === "not-allowed" || srErr === "service-not-allowed" ? searchMicError({ error: srErr }) : "Didn't catch that. Tap the mic and try again, or type."); return; }
    set("writing");
    const out = await serverP;
    if (s.dead) return;
    if (out && out.ok) { onText(String(out.text).trim(), true); set("idle"); }
    else set("idle", "Didn't catch that. Tap the mic and try again, or type.");
  };

  const stop = () => {
    if (s.stopping || s.phase !== "listening") return;
    s.stopping = true;
    if (s.rec && s.rec.state !== "inactive") { try { s.rec.stop(); return; } catch {} }
    release(); finish(null);
  };

  const startDictation = (SR) => {
    try {
      const sr = new SR();
      let end = null;
      s.srDone = new Promise((r) => { end = r; });
      sr.lang = SEARCH_VOICE_LANG; sr.continuous = true; sr.interimResults = true;
      sr.onresult = (e) => { const m = mergeSpeechResults(e.results); s.finals = m.finals; s.interim = m.interim; const t = live(); if (t && !s.dead) onText(t, false); };
      sr.onerror = (e) => { s.srErr = (e && e.error) || ""; };
      sr.onend = () => { if (end) { end(); end = null; } if (!s.rec && !s.stopping && !s.dead && s.phase === "listening") stop(); };
      sr.start();
      return sr;
    } catch { s.srDone = null; return null; }
  };

  const start = async () => {
    if (s.dead || s.phase !== "idle") return;
    Object.assign(s, { rec: null, sr: null, chunks: [], finals: "", interim: "", srErr: "", srDone: null, stopping: false });
    const nav = typeof navigator !== "undefined" ? navigator : {};
    const md = nav.mediaDevices;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const alone = !!SR && canDictateAlone(nav);
    const canRecord = !!(md && md.getUserMedia && typeof window.MediaRecorder !== "undefined") && !alone;
    if (!canRecord && !SR) { set("idle", searchMicError({ name: "unsupported" })); return; }
    set("starting");
    if (canRecord) {
      warmVoiceServer();
      let stream;
      try { stream = await md.getUserMedia({ audio: true }); }
      catch (e) { set("idle", searchMicError(e)); return; }
      if (s.dead) { stream.getTracks().forEach((t) => t.stop()); return; }
      const mime = pickVoiceMime((m) => window.MediaRecorder.isTypeSupported(m));
      let rec = null;
      try { rec = new window.MediaRecorder(stream, mime ? { mimeType: mime } : undefined); } catch { try { rec = new window.MediaRecorder(stream); } catch { rec = null; } }
      if (!rec) stream.getTracks().forEach((t) => t.stop());
      else {
        s.stream = stream; s.rec = rec;
        rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) s.chunks.push(ev.data); };
        rec.onstop = () => { release(); if (s.dead) return; finish(new Blob(s.chunks, { type: baseMime(rec.mimeType || "") || "audio/webm" })); };
        rec.start(1000);
      }
    }
    if (SR && (!s.rec || canDictateWhileRecording(nav))) s.sr = startDictation(SR);
    if (!s.rec && !s.sr) { release(); set("idle", searchMicError({ name: "unsupported" })); return; }
    set("listening");
    s.timer = setTimeout(stop, SEARCH_VOICE_MAX_MS);
  };

  const cancel = () => {
    s.dead = true;
    try { if (s.rec && s.rec.state !== "inactive") s.rec.stop(); } catch {}
    release();
  };

  return { start, stop, cancel, get phase() { return s.phase; } };
}
