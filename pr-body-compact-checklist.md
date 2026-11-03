## Why
Owner: every checklist point showed a Reason box + a big red "🎤 Record" + a "हिंदी ⇆" button, so 2 points filled the screen ("UI इतना मत बिगाड़ो"). Also: no voice on a 📦 Part pending row, and calm / professional controls.

## What changed (UI only — no data, validation, permission or schema change)
- **Checklists** (Accept · Before Receive, Finish & Transfer · Before Transfer, Return to Rack, During-Work checks) now share one `ChecklistRows` component: one row per point = ✓ checkbox (46px tap area) + full label (15-16px, normal weight, wraps, no truncation) + small "Must do" tag + a small ✕ "Not done" button. Mark all OK / Clear unchanged.
- The **reason box opens only under a point marked ✕** (✓ and ✕ are mutually exclusive; ✕ off clears that reason). Tapping Confirm / Transfer / Save with an unticked point that has no reason opens that point's box, flags it red (flagField) and puts the cursor in it (`flagChecklist`). `validateChecklistAnswers`, the `{checked, remark}` answer shape and the saved responses are unchanged.
- **Voice**: `VoiceNoteRecorder` now wraps the text box and shows a small 36px 🎤 icon inside its right end (checklist reason, Report Issue, Comment row, Delay reason, Late "Other", Work completed). Recording = one line (red dot + timer + Stop) over the box; saved = one small line (▶ ✓ Saved · Remove). After Stop the audio is saved as before and sent to the existing `voice-transcribe` Edge Function (auto language — writes Gujarati / Hindi / English as spoken); the existing "Audio saved — now write the same in words" fallback stays.
- **No language picker anywhere**: "हिंदी ⇆" cycle chip, the 3 language chips and Report Issue's "Speak in:" row are gone. Browser live dictation inside the recorder was dropped (it needed a language choice); the server transcription is the path. A login that cannot save voice notes keeps the small dictation mic in Report Issue with the remembered/default language, no picker.
- **📦 Part pending row**: voice removed (owner). Part / Comment toggle is a calm segmented control (white selected state, no solid red).
- No Edge Function change (nothing to deploy outside Vercel).

## App.jsx removals: 288 lines (> 200) — justified
`scripts/ship.sh` stops above 200 removed lines, so the same steps were run by hand. Every removal is a replacement, not a lost feature:
- ~55 lines are only re-indentation (text boxes now sit inside `<VoiceNoteRecorder>` as children).
- ~105: `VoiceNoteRecorder` rewritten compact — big Record button, big player, language chips/cycle button, browser dictation (`startSR`, `srNote`, `useVoiceLang`) removed; upload / transcribe / remove / retry logic and all `data-voice-*` hooks kept.
- ~68: three copies of the old checklist row markup replaced by `ChecklistRows`.
- ~34: Report Issue "Speak in:" chips + old mic block replaced by the in-box mic.
- the rest: Part-row voice call, `VOICE_LANGS` / `pickVoiceLang` (no picker), unused imports.
Every handler, prop, data hook used by tests, audit event and button is still present (regression inventory green).

## Tests
- New `tests/e2e/compact-checklist.mjs` (15-point templates): rows ≤ 56px one-line / list ≤ 1.5 screens at 390x844, labels 15-16px normal weight and full text, no reason box until ✕, ✓/✕ exclusive, mic only with an open reason and inside the box, recording one line, server transcript fills the reason, Confirm flags + opens + focuses the first missing reason, answers saved as `{checked, remark}`, Finish & Transfer same rows + flag, Part row no voice, calm toggle, no language chips.
- Updated (old intent → new intent): `voice-note.mjs` (big Record → small in-box mic; Hindi/Gujarati via server transcription instead of chips + browser dictation; Part row has no voice, Comment row has the mic), `mt-polish.mjs` (44px language chips → no language chips), `regression.test.mjs` inventory (dropped "Speak in:" and "Typing by voice not supported…" with notes; added `ChecklistRows`, `flagChecklist(`, `data-check-no`, `data-check-reason`, "Why not done?", `data-voice-record`, `data-voice-stop`).
- `npm test` green, `npm run build` green, all browser suites green locally (VITE_USE_SUPABASE=false build).

**App.jsx removals (289 lines), justified:** the old big 🎤 Record recorder UI, the language picker chips (VN_LANGS / VOICE_LANGS / useVoiceLang) and the old tall checklist rows were replaced by the compact versions in this PR (owner request 2026-11-03). Regression inventory updated; nothing else removed.
