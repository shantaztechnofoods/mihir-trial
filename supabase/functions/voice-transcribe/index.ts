// Edge Function: voice-transcribe — turns a recorded voice note into TEXT.
// Deployed via the Supabase CLI / dashboard (NOT Vercel):
//   supabase functions deploy voice-transcribe        (verify JWT: ON)
//
// Owner requirement 2026-11-03: every voice note must become text in the box
// (reports need text), even on phones where browser dictation does not work
// (iPhone Safari, Firefox). The audio itself is only the backup.
//
// Request body:  { audioBase64: string, mimeType: string }   (≤ ~2 MB, ≤ 60 s)
// Response 200:  { text: string }      (may be "" when nothing was said)
// Response 4xx/5xx: { error: string }
//
// Rules:
//   - Caller must be a logged-in, active ERP user (same auth as ai-assistant).
//   - Gemini only gets the audio + a fixed instruction; it never sees any key
//     or any ERP data. Nothing is stored here; the audio is already saved as a
//     machine attachment by the app before this is called.
//   - Language as spoken: Gujarati → Gujarati script, Hindi → Devanagari,
//     English → English. No translation.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY         = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY            = Deno.env.get("GEMINI_API_KEY");
const GEMINI_MODEL              = "gemini-2.5-flash";
const GEMINI_URL                = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ~2 MB of audio → ~2.7 MB of base64. 60 s of Opus/AAC is far below this.
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const MAX_B64_CHARS   = Math.ceil(MAX_AUDIO_BYTES / 3) * 4 + 16;
const ALLOWED_MIME    = new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/aac", "audio/x-m4a", "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/flac"]);

const INSTRUCTION =
  "Transcribe exactly what is said, in the same language and script it is spoken (Gujarati/Hindi/English, mixed allowed). " +
  "Gujarati must be written in Gujarati script, Hindi in Devanagari, English in English. " +
  "Do not translate, do not add anything. Return only the text. If nothing is said, return an empty answer.";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Gemini's audio types: map browser recorder types onto what it accepts.
function geminiMime(m: string): string {
  const b = String(m || "").split(";")[0].trim().toLowerCase();
  if (b === "audio/x-m4a" || b === "audio/mp4") return "audio/mp4";
  if (b === "audio/mp3") return "audio/mpeg";
  if (b === "audio/x-wav") return "audio/wav";
  return b;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")   return json(405, { error: "Method not allowed" });

  try {
    // 1) Authenticate the caller (same pattern as ai-assistant).
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json(401, { error: "Missing Authorization header" });

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    let userId = "";
    try {
      const { data, error } = await userClient.auth.getUser();
      if (error || !data?.user) { console.error("[voice-transcribe] auth.getUser failed:", error?.message); return json(401, { error: "Invalid session" }); }
      userId = data.user.id;
    } catch (e) {
      console.error("[voice-transcribe] auth.getUser threw:", (e as Error).message);
      return json(401, { error: "Could not verify session" });
    }

    const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    try {
      const { data, error } = await service.from("users").select("status").eq("id", userId).single();
      if (error || !data) { console.error("[voice-transcribe] users lookup failed:", error?.message); return json(403, { error: "Profile not found" }); }
      if (data.status !== "active") return json(403, { error: "Account disabled" });
    } catch (e) {
      console.error("[voice-transcribe] users lookup threw:", (e as Error).message);
      return json(500, { error: "Could not load user profile" });
    }

    if (!GEMINI_API_KEY) return json(500, { error: "Transcription not configured (GEMINI_API_KEY missing)." });

    // 2) Validate input.
    let body: { audioBase64?: string; mimeType?: string };
    try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON body" }); }
    const audio = String(body.audioBase64 || "").replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
    const mime  = geminiMime(body.mimeType || "");
    if (!audio) return json(400, { error: "audioBase64 is required" });
    if (audio.length > MAX_B64_CHARS) return json(413, { error: "Audio too long (max ~2 MB / 60 s)" });
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) return json(400, { error: "audioBase64 is not valid base64" });
    if (!ALLOWED_MIME.has(mime)) return json(415, { error: `Unsupported audio type: ${mime || "(none)"}` });

    // 3) Ask Gemini for a verbatim transcript.
    const geminiReq = {
      contents: [{ role: "user", parts: [{ text: INSTRUCTION }, { inline_data: { mime_type: mime, data: audio } }] }],
      generationConfig: { temperature: 0 },
    };
    let resp: Response;
    try {
      resp = await fetch(GEMINI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify(geminiReq),
      });
    } catch (e) {
      console.error("[voice-transcribe] Gemini fetch threw:", (e as Error).message);
      return json(502, { error: "Transcription service unreachable" });
    }
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.error(`[voice-transcribe] Gemini returned ${resp.status}:`, errText.slice(0, 2000));
      return json(502, { error: `Transcription service error (${resp.status})` });
    }
    const data = await resp.json().catch(() => null);
    const parts: any[] = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p) => p.text || "").join("").trim();
    return json(200, { text });
  } catch (err) {
    console.error("[voice-transcribe] UNHANDLED ERROR:", (err as Error).message, (err as Error).stack);
    return json(500, { error: "Transcription internal error" });
  }
});
