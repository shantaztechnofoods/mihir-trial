// src/shared/voice/VoiceNote.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useEffect, useRef } from "react";
import { isSupabaseEnabled } from "../../config/env.js";
import { getSupabase } from "../../supabase/client.js";
import { signedUrlFor } from "../../stores/attachmentsStore.js";
import { VOICE_MAX_SECONDS, pickVoiceMime, baseMime, formatClock, micErrorMessage, transcribeVoiceBlob, VOICE_WRITING_TEXT, VOICE_WRITE_PROMPT, tidySpoken, appendSpoken, isAppleMobile, readVoiceLang, isAndroid, canDictateWhileRecording, mergeSpeechResults, encodeWav16, VOICE_WAV_RATE, VOICE_TRANSCRIBE_MAX_BYTES, voiceFailText, canDictateAlone, VOICE_SERVER_WAIT_MS, swapLiveText, trimSilence, VOICE_TRANSCRIBE_FN } from "../../utils/voiceNote.js";

// ── Voice (2026-11-03, changed 2026-11-04) ───────────────────────────────
// Since 2026-11-04 the 🎤 only writes TEXT (no audio is saved). Voice notes
// saved before that are ordinary machine attachments (audio/*) and still
// play in history below.


// Plays one saved voice note (signed URL in Supabase mode, data: URL locally).
export function VoicePlayButton({ attachment, big = false, label = "" }) {
  const [state, setState] = useState("idle"); // idle | loading | playing | error
  const audioRef = useRef(null);
  useEffect(() => () => { try { audioRef.current && audioRef.current.pause(); } catch {} }, []);
  const toggle = async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (state === "playing" && audioRef.current) { audioRef.current.pause(); setState("idle"); return; }
    setState("loading");
    const url = attachment.storagePath && attachment.storagePath.startsWith("data:") ? attachment.storagePath : await signedUrlFor(attachment);
    if (!url) { setState("error"); return; }
    try {
      const a = audioRef.current || new Audio();
      audioRef.current = a;
      a.src = url;
      a.onended = () => setState("idle");
      a.onerror = () => setState("error");
      await a.play();
      setState("playing");
    } catch { setState("error"); }
  };
  const size = 44; // min touch target; `big` only enlarges the icon
  return (
    <button type="button" data-voice-play={attachment.id} onClick={toggle} aria-label={state === "playing" ? "Pause voice note" : "Play voice note"}
            className="vn-play rounded-full flex items-center justify-center gap-1 font-black flex-shrink-0 transition-transform active:scale-[0.97]"
            style={{ minWidth: size, height: size, padding: label ? "0 14px" : 0, background: state === "error" ? "#fee2e2" : "#2640B0", color: state === "error" ? "#b91c1c" : "#fff", fontSize: big ? 18 : 15 }}>
      {state === "loading" ? "…" : state === "playing" ? "⏸" : state === "error" ? "!" : "▶"}{label ? <span className="text-[13px]">{label}</span> : null}
    </button>
  );
}

// "🎤 Voice note · <place> · <who> · <time>" with a play button.
export function VoiceNoteLine({ attachment, userName }) {
  const who = (userName && userName(attachment.uploadedBy)) || "";
  const when = attachment.uploadedAt ? new Date(attachment.uploadedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "";
  return (
    <div data-voice-note={attachment.id} className="flex items-center gap-2 min-w-0">
      <VoicePlayButton attachment={attachment} />
      <div className="min-w-0 text-[12px] leading-snug" style={{ color: "var(--text-strong, #0f172a)" }}>
        <span className="font-black">🎤 Voice note</span>
        {attachment.caption ? <span> · {attachment.caption}</span> : null}
        {who ? <span style={{ color: "var(--text-dim, #64748b)" }}> · {who}</span> : null}
        {when ? <span style={{ color: "var(--text-dim, #64748b)" }}> · {when}</span> : null}
      </div>
    </div>
  );
}

// Server transcription of a saved voice note (Edge Function voice-transcribe).
// Local/offline mode has no server: returns { ok:false }. `window.__erpVoiceTranscribe`
// is a test seam with the same shape as supabase.functions.invoke (e2e only).
export function transcribeVoice(blob) {
  const hook = typeof window !== "undefined" ? window.__erpVoiceTranscribe : null;
  let invoke = typeof hook === "function" ? hook : null;
  if (!invoke && isSupabaseEnabled()) {
    const client = getSupabase();
    if (client) invoke = (name, opts) => client.functions.invoke(name, opts);
  }
  return transcribeVoiceBlob(blob, invoke);
}

// 2026-11-05 (speed): wake the voice-transcribe server (and refresh the login
// token if it is about to expire) the moment 🎤 is tapped, so the real call
// after Stop does not pay the server's cold start. Sends no audio; the server
// answers { warm: true } at once (an older server answers 400 — harmless).
// Only in Supabase mode, at most once a minute.
let lastWarm = 0;
export function warmVoiceServer() {
  try {
    if (typeof window !== "undefined" && typeof window.__erpVoiceTranscribe === "function") return;
    if (!isSupabaseEnabled() || Date.now() - lastWarm < 60000) return;
    const client = getSupabase();
    if (!client) return;
    lastWarm = Date.now();
    client.functions.invoke(VOICE_TRANSCRIBE_FN, { body: { warm: true } }).catch(() => {});
  } catch { /* warming is only a speed-up */ }
}

// 2026-11-05 — the recorded clip (WebM on Chrome, MP4 on iPhone) is decoded
// in the browser and re-encoded as 16 kHz mono WAV before it is sent, so the
// speech model always gets a format it accepts. Any failure → original clip.
export async function voiceClipToWav(blob) {
  try {
    if (typeof window === "undefined" || !blob || !blob.size) return blob;
    const AC = window.AudioContext || window.webkitAudioContext;
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!AC || !OAC) return blob;
    const buf = await blob.arrayBuffer();
    const ctx = new AC();
    let decoded;
    try {
      decoded = await new Promise((res, rej) => {
        const p = ctx.decodeAudioData(buf, res, rej);
        if (p && typeof p.then === "function") p.then(res, rej);
      });
    } finally { try { ctx.close(); } catch {} }
    if (!decoded || !decoded.duration) return blob;
    const len = Math.max(1, Math.ceil(decoded.duration * VOICE_WAV_RATE));
    const off = new OAC(1, len, VOICE_WAV_RATE);
    const src = off.createBufferSource();
    src.buffer = decoded; src.connect(off.destination); src.start(0);
    const out = await off.startRendering();
    // Speed: drop the quiet lead-in / tail before upload (smaller clip).
    const wav = encodeWav16(trimSilence(out.getChannelData(0), VOICE_WAV_RATE), VOICE_WAV_RATE);
    if (wav.length > VOICE_TRANSCRIBE_MAX_BYTES) return blob;
    return new Blob([wav], { type: "audio/wav" });
  } catch { return blob; }
}

// Android: once the voice server has failed on this phone, the next 🎤 tap
// uses the phone's own dictation only (no recorder, so it gets the mic).
let serverVoiceDown = false;
// Android (2026-11-05): dictation alone is tried first; once it fails on this
// phone (no words, not just silence), the next tap records for the server.
let phoneDictationDown = false;

// Small 🎤 icon INSIDE the text box (pass the box as `children`).
// 2026-11-04 (owner): the mic only WRITES TEXT into the box — no audio is
// saved, no player, no "voice note saved". Tap 🎤 → "Listening… 0:05" + Stop
// inside the box; Stop → "Writing…" → the clip goes straight to the
// voice-transcribe Edge Function (clean sentences, same language/script, no
// translation) and is then discarded. Browser dictation (where it can run
// next to the recorder) is only a live preview + the fallback if the server
// fails. Both fail → the box turns red: "Could not hear — please type".
// The box's own required-check is unchanged. Old saved voice notes still
// play in history (VoicePlayButton / VoiceNoteLine).
export function VoiceNoteRecorder({ place, setText = null, disabled = false, children = null }) {
  const [phase, setPhase] = useState("idle"); // idle | starting | recording | writing
  const [secs, setSecs]   = useState(0);
  const [err, setErr]     = useState("");
  const [preview, setPreview] = useState("");
  const r = useRef({ rec: null, sr: null, stream: null, timer: null, t0: 0, chunks: [], finals: "", interim: "", discard: false, tx: 0, stopping: false, srErr: "", dictOnly: false, srDone: null });
  const fieldRef = useRef(null);
  const textRef = useRef(setText); textRef.current = setText;

  const flagBox = () => {
    try {
      const el = fieldRef.current && fieldRef.current.querySelector("input, textarea");
      if (!el) return;
      el.classList.remove("field-bad"); void el.offsetWidth; el.classList.add("field-bad");
      setTimeout(() => el.classList.remove("field-bad"), 2600);
    } catch { /* ignore */ }
  };
  const releaseMic = () => {
    const s = r.current;
    if (s.timer) { clearInterval(s.timer); s.timer = null; }
    try { s.sr && s.sr.stop(); } catch {}
    try { s.stream && s.stream.getTracks().forEach((t) => t.stop()); } catch {}
    s.stream = null;
  };
  useEffect(() => {
    r.current.discard = false; // StrictMode re-mount: un-stick the unmount flag
    return () => {
    const s = r.current; s.discard = true; s.tx++;
    try { if (s.rec && s.rec.state !== "inactive") s.rec.stop(); } catch {}
    releaseMic();
    };
  }, []);

  const liveText = () => { const s = r.current; return tidySpoken(`${s.finals} ${s.interim}`); };

  // Wait until browser dictation has delivered its last words (its onend),
  // at most `cap` ms. No dictation running → no wait at all.
  const dictationSettled = (cap) => {
    const done = r.current.srDone;
    if (!done) return Promise.resolve();
    return Promise.race([done, new Promise((res) => setTimeout(res, cap))]);
  };

  // Final text (2026-11-05, speed):
  //  * the clip is turned into WAV and sent to the server AT ONCE (in
  //    parallel with dictation finishing — no fixed pause first);
  //  * live dictation words (desktop) go into the box immediately and are
  //    swapped for the server's cleaner text when it arrives (≤ 6 s; later or
  //    failed → the live words stay);
  //  * no live words (iPhone) → "Writing…" until the server answers, as before.
  const writeOut = async (blob) => {
    const s = r.current;
    const tx = ++s.tx;
    setPhase("writing"); setErr("");
    const serverP = blob && blob.size ? voiceClipToWav(blob).then((wav) => transcribeVoice(wav)) : null;
    await dictationSettled(blob ? 400 : 700);
    if (s.discard || tx !== s.tx) return;
    const live = liveText();
    const srErr = s.srErr; s.srErr = "";
    s.finals = ""; s.interim = ""; s.chunks = [];
    setPreview("");
    const noteServerFail = (out) => {
      if (out && !out.ok && out.error && out.error !== "No words heard") {
        try { console.warn("[voice] server could not write the words:", out.error); } catch {}
        if (isAndroid(navigator) && (window.SpeechRecognition || window.webkitSpeechRecognition)) serverVoiceDown = true;
      }
    };
    if (live && serverP) {
      setPhase("idle");
      if (textRef.current) textRef.current((prev) => appendSpoken(prev, live));
      const out = await Promise.race([serverP, new Promise((res) => setTimeout(() => res(null), VOICE_SERVER_WAIT_MS))]);
      if (s.discard) return;
      noteServerFail(out);
      if (out && out.ok && textRef.current) textRef.current((prev) => swapLiveText(prev, live, String(out.text).trim()));
      return;
    }
    let out = { ok: false, text: "", error: "" };
    if (serverP) { out = await serverP; noteServerFail(out); }
    if (s.discard || tx !== s.tx) return;
    const text = out.ok ? String(out.text).trim() : live;
    setPhase("idle");
    if (!text) {
      // Android dictation alone heard nothing for a reason other than silence
      // → next tap records and asks the server instead.
      if (!blob && s.dictOnly && srErr && srErr !== "no-speech" && srErr !== "aborted" && srErr !== "not-allowed" && isAndroid(navigator)) phoneDictationDown = true;
      setErr(srErr === "not-allowed" ? voiceFailText("not allowed") : (blob ? voiceFailText(out.error, serverVoiceDown) : voiceFailText("", phoneDictationDown)));
      flagBox(); return;
    }
    if (textRef.current) textRef.current((prev) => appendSpoken(prev, text));
  };

  const stop = () => {
    const s = r.current;
    if (s.stopping) return;
    s.stopping = true;
    if (s.timer) { clearInterval(s.timer); s.timer = null; }
    if (s.rec && s.rec.state !== "inactive") { try { s.rec.stop(); return; } catch {} }
    // No recorder (dictation-only browser): finish with the live text.
    releaseMic(); writeOut(null);
  };

  const onRecStop = () => {
    const s = r.current;
    releaseMic();
    if (s.discard) return;
    const type = baseMime((s.rec && s.rec.mimeType) || "") || "audio/webm";
    const blob = new Blob(s.chunks, { type }); // in memory only — never uploaded or stored
    writeOut(blob);
  };

  const startDictation = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    try {
      const sr = new SR();
      let endRes = null;
      r.current.srDone = new Promise((res) => { endRes = res; });
      sr.lang = readVoiceLang(window.localStorage);
      sr.continuous = true; sr.interimResults = true;
      sr.onresult = (e) => {
        const s = r.current;
        const m = mergeSpeechResults(e.results);
        s.finals = m.finals; s.interim = m.interim;
        setPreview(liveText());
      };
      sr.onerror = (e) => { r.current.srErr = (e && e.error) || ""; };
      sr.onend = () => {
        const s = r.current;
        if (endRes) { endRes(); endRes = null; }
        if (s.sr === sr) s.sr = null;
        // Dictation-only (no recorder): the phone stops listening by itself
        // after a pause — write the words straight away.
        if (!s.rec && !s.discard && !s.stopping && s.dictOnly) stop();
      };
      sr.start();
      return sr;
    } catch { r.current.srDone = null; return null; }
  };

  const start = async () => {
    if (disabled || phase !== "idle") return;
    setErr(""); setPreview("");
    const s = r.current;
    s.finals = ""; s.interim = ""; s.chunks = []; s.stopping = false; s.rec = null; s.sr = null; s.srErr = ""; s.dictOnly = false; s.srDone = null;
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : null;
    const hasSR = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    // Android with dictation: dictation ALONE first (instant words); the
    // recorder + server only after dictation failed on this phone.
    const dictateAlone = hasSR && canDictateAlone(navigator) && (!phoneDictationDown || serverVoiceDown);
    const canRecord = !!(md && md.getUserMedia && typeof window.MediaRecorder !== "undefined") && !dictateAlone;
    if (canRecord) warmVoiceServer();
    if (!canRecord && !hasSR) { setErr(micErrorMessage({ name: "unsupported" })); flagBox(); return; }
    setPhase("starting");
    if (canRecord) {
      let stream;
      try { stream = await md.getUserMedia({ audio: true }); }
      catch (e) { setPhase("idle"); setErr(micErrorMessage(e)); return; }
      if (s.discard) { stream.getTracks().forEach((t) => t.stop()); return; }
      const mime = pickVoiceMime((m) => window.MediaRecorder.isTypeSupported(m));
      let rec = null;
      try { rec = new window.MediaRecorder(stream, mime ? { mimeType: mime } : undefined); }
      catch { try { rec = new window.MediaRecorder(stream); } catch { rec = null; } }
      if (!rec) { stream.getTracks().forEach((t) => t.stop()); if (!hasSR) { setPhase("idle"); setErr(micErrorMessage({ name: "unsupported" })); return; } }
      else {
        s.stream = stream; s.rec = rec;
        rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) s.chunks.push(ev.data); };
        rec.onstop = onRecStop;
        rec.start(1000);
      }
    }
    // Live preview: desktop only while recording — on iPhone/iPad AND Android
    // phone dictation takes the mic from the recorder (the clip goes silent).
    if (hasSR && (!s.rec || canDictateWhileRecording(navigator))) s.sr = startDictation();
    s.dictOnly = !s.rec && !!s.sr;
    if (!s.rec && !s.sr) { releaseMic(); setPhase("idle"); setErr(micErrorMessage({ name: "unsupported" })); return; }
    s.t0 = Date.now(); setSecs(0); setPhase("recording");
    s.timer = setInterval(() => {
      const el = (Date.now() - s.t0) / 1000;
      setSecs(el);
      if (el >= VOICE_MAX_SECONDS) stop();
    }, 200);
  };

  return (
    <div className="vn-box" data-voice-recorder={place}>
      <div ref={fieldRef} className={`vn-field${children ? "" : " vn-field-bare"}`}>
        {children}
        {(phase === "idle" || phase === "starting") && (
          <button type="button" data-voice-record disabled={disabled || phase === "starting"} onClick={start}
                  aria-label="Speak — words are written in the box" title="Speak"
                  className="vn-mic">
            {phase === "starting" ? <span className="vn-spin" aria-hidden="true" /> : (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" />
              </svg>
            )}
          </button>
        )}
        {phase === "writing" && <span className="vn-mic vn-mic-busy" aria-hidden="true"><span className="vn-spin" /></span>}
        {phase === "recording" && (
          <div data-voice-live className="vn-bar" role="status">
            <span className="vn-dot" aria-hidden="true" />
            <span className="vn-bar-text">Listening… <span className="tabular-nums" data-voice-clock>{formatClock(secs)}</span></span>
            <span className="vn-bar-max tabular-nums">/ {formatClock(VOICE_MAX_SECONDS)}</span>
            <button type="button" data-voice-stop onClick={stop} aria-label="Stop and write the words" className="vn-stop">
              <span aria-hidden="true" className="vn-stop-sq" />Stop
            </button>
          </div>
        )}
      </div>
      {phase === "recording" && preview && <div data-voice-preview className="vn-note vn-preview">{preview}</div>}
      {phase === "writing" && <div data-voice-writing className="vn-note vn-writing" role="status">{VOICE_WRITING_TEXT}</div>}
      {err && phase !== "writing" && <div data-voice-error className="vn-note" style={{ color: "#b91c1c" }}>{err}</div>}
    </div>
  );
}
