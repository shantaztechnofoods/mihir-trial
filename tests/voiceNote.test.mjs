// Voice notes (2026-11-03) — pure helpers behind the 🎤 Record button.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VOICE_MAX_SECONDS, VOICE_FALLBACK_TEXT, VOICE_LANGS, pickVoiceMime, baseMime, voiceExt, voiceFileName,
  voiceCaption, isVoiceAttachment, voiceNotesFor, formatClock, micErrorMessage, fillVoiceText,
  clearVoiceText, appendTranscript, readVoiceLang,
} from "../src/utils/voiceNote.js";

test("max length is 60 seconds", () => assert.equal(VOICE_MAX_SECONDS, 60));

test("languages: Gujarati, Hindi, English (Indian)", () => {
  assert.deepEqual(VOICE_LANGS.map(([c]) => c), ["gu-IN", "hi-IN", "en-IN"]);
});

test("pickVoiceMime prefers webm/opus, falls back to mp4 (iPhone), else empty", () => {
  assert.equal(pickVoiceMime((m) => m.startsWith("audio/webm")), "audio/webm;codecs=opus");
  assert.equal(pickVoiceMime((m) => m === "audio/mp4"), "audio/mp4");
  assert.equal(pickVoiceMime(() => false), "");
  assert.equal(pickVoiceMime(undefined), "");
  assert.equal(pickVoiceMime(() => { throw new Error("x"); }), "");
});

test("baseMime / voiceExt", () => {
  assert.equal(baseMime("audio/webm;codecs=opus"), "audio/webm");
  assert.equal(voiceExt("audio/webm;codecs=opus"), "webm");
  assert.equal(voiceExt("audio/mp4"), "m4a");
  assert.equal(voiceExt("audio/ogg;codecs=opus"), "ogg");
  assert.equal(voiceExt(""), "webm");
});

test("voiceFileName is safe and tagged", () => {
  assert.equal(voiceFileName("Accept checklist", 123, "audio/webm"), "voice-accept-checklist-123.webm");
  assert.equal(voiceFileName("", 5, "audio/mp4"), "voice-note-5.m4a");
  assert.match(voiceFileName("../../etc", 1, "audio/webm"), /^voice-[a-z0-9-]+-1\.webm$/);
});

test("voiceCaption says where it was recorded", () => {
  assert.equal(voiceCaption("Report Issue"), "Report Issue");
  assert.equal(voiceCaption("Accept checklist", "Oil level"), "Accept checklist: Oil level");
  assert.equal(voiceCaption("Late reason", "  "), "Late reason");
  assert.ok(voiceCaption("x", "y".repeat(500)).length <= 160);
});

test("isVoiceAttachment: audio mime or voice- file name; photos/pdf are not", () => {
  assert.ok(isVoiceAttachment({ mimeType: "audio/webm" }));
  assert.ok(isVoiceAttachment({ mimeType: "audio/mp4;codecs=mp4a" }));
  assert.ok(isVoiceAttachment({ mimeType: "", fileName: "voice-report-issue-1.webm" }));
  assert.ok(!isVoiceAttachment({ mimeType: "video/webm", fileName: "clip.webm" }));
  assert.ok(!isVoiceAttachment({ mimeType: "image/png" }));
  assert.ok(!isVoiceAttachment(null));
});

test("voiceNotesFor: one machine, voice only, newest first", () => {
  const list = [
    { id: 1, machineId: 7, mimeType: "audio/webm", uploadedAt: "2026-11-03T08:00:00Z" },
    { id: 2, machineId: 7, mimeType: "image/png", uploadedAt: "2026-11-03T09:00:00Z" },
    { id: 3, machineId: "7", mimeType: "audio/mp4", uploadedAt: "2026-11-03T10:00:00Z" },
    { id: 4, machineId: 8, mimeType: "audio/webm", uploadedAt: "2026-11-03T11:00:00Z" },
  ];
  assert.deepEqual(voiceNotesFor(list, 7).map((a) => a.id), [3, 1]);
  assert.deepEqual(voiceNotesFor(null, 7), []);
});

test("formatClock", () => {
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(7.9), "0:07");
  assert.equal(formatClock(60), "1:00");
  assert.equal(formatClock(-3), "0:00");
});

test("micErrorMessage: blocked mic gets the plain message", () => {
  assert.equal(micErrorMessage({ name: "NotAllowedError" }), "Mic is off — allow it in the browser");
  assert.equal(micErrorMessage({ name: "SecurityError" }), "Mic is off — allow it in the browser");
  assert.equal(micErrorMessage({ name: "NotFoundError" }), "No mic found on this device");
  assert.equal(micErrorMessage(null), "Could not start the mic");
});

test("fill / clear only touch an empty box or our own placeholder", () => {
  assert.equal(fillVoiceText(""), VOICE_FALLBACK_TEXT);
  assert.equal(fillVoiceText("   "), VOICE_FALLBACK_TEXT);
  assert.equal(fillVoiceText("belt loose"), "belt loose");
  assert.equal(clearVoiceText(VOICE_FALLBACK_TEXT), "");
  assert.equal(clearVoiceText("belt loose"), "belt loose");
});

test("appendTranscript keeps typed text, replaces placeholder, keeps the spoken script", () => {
  assert.equal(appendTranscript("", "बेल्ट ढीला है"), "बेल्ट ढीला है");
  assert.equal(appendTranscript("Belt", " loose "), "Belt loose");
  assert.equal(appendTranscript(VOICE_FALLBACK_TEXT, "પટ્ટો ઢીલો છે"), "પટ્ટો ઢીલો છે");
  assert.equal(appendTranscript("same", ""), "same");
});

test("readVoiceLang: stored valid code, default Hindi, storage errors tolerated", () => {
  assert.equal(readVoiceLang({ getItem: () => "gu-IN" }), "gu-IN");
  assert.equal(readVoiceLang({ getItem: () => "fr-FR" }), "hi-IN");
  assert.equal(readVoiceLang({ getItem: () => { throw new Error("blocked"); } }), "hi-IN");
  assert.equal(readVoiceLang(null), "hi-IN");
});
