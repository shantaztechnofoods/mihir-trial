// Edge Function: voice-transcribe — turns a recorded voice note into TEXT.
// Deployed via the Supabase CLI / dashboard (NOT Vercel):
//   supabase functions deploy voice-transcribe        (verify JWT: ON)
//
// Owner requirement 2026-11-03/04: the 🎤 writes TEXT into the box (reports
// need text), even on phones where browser dictation does not work (iPhone
// Safari, Firefox). No audio is kept.
//
// Request body:  { audioBase64: string, mimeType: string }   (≤ ~2 MB, ≤ 60 s)
// Response 200:  { text: string }      (may be "" when nothing was said)
// Response 4xx/5xx: { error: string }
//
// Rules:
//   - Caller must be a logged-in, active ERP user (same auth as ai-assistant).
//   - Gemini only gets the audio + a fixed instruction; it never sees any key
//     or any ERP data. Nothing is stored here, and since 2026-11-04 the app
//     does not store the audio either — the clip is sent straight here and
//     discarded; only the returned text is kept (in the remark box).
//   - Request shape is unchanged since 2026-11-03, so old and new app builds
//     both work with either deployed version.
//   - 2026-11-05 (speed): body { warm: true } (sent by the app when 🎤 is
//     tapped) only wakes this function up and answers { warm: true } after
//     the login check — no audio, no Gemini call. Preflight answers are
//     cached by the browser (Access-Control-Max-Age). Login check and body
//     read run in parallel; the "active user" check runs in parallel with
//     Gemini and still gates the answer. Gemini "thinking" is switched off
//     for this plain transcription (it only added seconds); a model that
//     rejects that setting is asked again without it.
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

// 2026-11-05: Google retires older model names for new API keys (a new key
// got 404 "gemini-2.5-flash is no longer available to new users"). Pick the
// model at run time: GEMINI_MODEL secret if set, else the preferred list; on a
// 404 ask Google which models this key may use and take the best match.
let resolvedModel: string | null = null;
// 404 = model gone for this key; 429/500/503 = busy -> try the next model.
const RETRY_NEXT = new Set([404, 429, 500, 503]);
const ATTEMPT_MS = 8000;
async function geminiFetch(body: unknown, prefer: string[], kind: "flash" | "pro"): Promise<Response> {
  const envModel = (Deno.env.get("GEMINI_MODEL") || "").trim();
  const tried = new Set<string>();
  const order = [resolvedModel, envModel, ...prefer].filter(Boolean) as string[];
  let last: Response | null = null;
  // Speed: a model that has not answered in ATTEMPT_MS is treated as busy and
  // the next model is tried, so one slow model never makes the user wait.
  const call = async (m: string): Promise<Response> => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ATTEMPT_MS);
    try {
      return await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY! },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
    } catch (e) {
      console.warn(`[gemini] ${m} timed out / failed:`, (e as Error).message);
      return new Response(JSON.stringify({ error: "timeout" }), { status: 503 });
    } finally { clearTimeout(t); }
  };
  for (const m of order) {
    if (tried.has(m)) continue; tried.add(m);
    const r = await call(m);
    if (!RETRY_NEXT.has(r.status)) { if (r.ok) resolvedModel = m; return r; }
    last = r;
  }
  try {
    const lr = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": GEMINI_API_KEY! } });
    const lj = await lr.json();
    const names: string[] = (lj?.models || [])
      .filter((x: any) => (x.supportedGenerationMethods || []).includes("generateContent"))
      .map((x: any) => String(x.name || "").replace(/^models\//, ""))
      .filter((n: string) => n.startsWith("gemini-") && !/(tts|image|embedding|live|audio|vision-only)/.test(n) && !/preview|exp/.test(n));
    const score = (n: string) => {
      const v = parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || "0");
      const tierOk = kind === "pro" ? (n.includes("pro") ? 2 : n.includes("flash") && !n.includes("lite") ? 1 : 0)
                                    : (n.includes("flash") && !n.includes("lite") ? 2 : n.includes("flash") ? 1 : 0);
      return tierOk * 1000 + v;
    };
    names.sort((a, b) => score(b) - score(a));
    for (const m of names) {
      if (tried.has(m)) continue; tried.add(m);
      const r = await call(m);
      if (!RETRY_NEXT.has(r.status)) { if (r.ok) { resolvedModel = m; console.log(`[gemini] using model ${m}`); } return r; }
      console.warn(`[gemini] ${m} returned ${r.status}, trying next`);
      last = r;
    }
  } catch (e) { console.error("[gemini] model list failed:", (e as Error).message); }
  return last as Response;
}

// ~2 MB of audio → ~2.7 MB of base64. 60 s of Opus/AAC is far below this.
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const MAX_B64_CHARS   = Math.ceil(MAX_AUDIO_BYTES / 3) * 4 + 16;
const ALLOWED_MIME    = new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/aac", "audio/x-m4a", "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/flac"]);

// 2026-11-04 (owner): the app keeps NO audio — this text is all that stays,
// so it must read neatly: proper sentences, punctuation, filler removed.
const INSTRUCTION =
  "You write down what a factory worker said, to be saved as a short written remark. " +
  "Write it in the same language and script it is spoken (Gujarati/Hindi/English, mixed allowed): " +
  "Gujarati in Gujarati script, Hindi in Devanagari, English in English. Do not translate. " +
  "Write clean, complete sentences with correct punctuation and capital letters (Hindi sentences end with ।). " +
  "Remove filler words (um, uh, hmm, matlab, wo, like), repeated words and false starts. " +
  "Keep every fact, number, part name and machine name exactly as said; do not add, explain or summarise. " +
  "Return only the text. If nothing is said, return an empty answer.";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age":       "86400",
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
    // 1) Authenticate the caller (same pattern as ai-assistant). The body is
    //    read at the same time (speed); nothing is done with it before the
    //    caller is verified.
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json(401, { error: "Missing Authorization header" });

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const bodyP = req.json().then((b) => ({ ok: true, b }), () => ({ ok: false, b: null }));
    let userId = "";
    try {
      const { data, error } = await userClient.auth.getUser();
      if (error || !data?.user) { console.error("[voice-transcribe] auth.getUser failed:", error?.message); return json(401, { error: "Invalid session" }); }
      userId = data.user.id;
    } catch (e) {
      console.error("[voice-transcribe] auth.getUser threw:", (e as Error).message);
      return json(401, { error: "Could not verify session" });
    }

    const parsed = await bodyP;
    if (!parsed.ok || !parsed.b || typeof parsed.b !== "object") return json(400, { error: "Invalid JSON body" });
    const body = parsed.b as { audioBase64?: string; mimeType?: string; warm?: boolean };
    // Warm-up ping from the app (🎤 tapped): the function is now loaded.
    if (body.warm === true && !body.audioBase64) return json(200, { warm: true });

    // 2) Active ERP user? Started now, awaited before any text is returned.
    const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const activeP: Promise<Response | null> = (async () => {
      try {
        const { data, error } = await service.from("users").select("status").eq("id", userId).single();
        if (error || !data) { console.error("[voice-transcribe] users lookup failed:", error?.message); return json(403, { error: "Profile not found" }); }
        if (data.status !== "active") return json(403, { error: "Account disabled" });
        return null;
      } catch (e) {
        console.error("[voice-transcribe] users lookup threw:", (e as Error).message);
        return json(500, { error: "Could not load user profile" });
      }
    })();

    if (!GEMINI_API_KEY) return (await activeP) || json(500, { error: "Transcription not configured (GEMINI_API_KEY missing)." });

    // 3) Validate input.
    const audio = String(body.audioBase64 || "").replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
    const mime  = geminiMime(body.mimeType || "");
    const bad =
      !audio ? json(400, { error: "audioBase64 is required" }) :
      audio.length > MAX_B64_CHARS ? json(413, { error: "Audio too long (max ~2 MB / 60 s)" }) :
      !/^[A-Za-z0-9+/]+={0,2}$/.test(audio) ? json(400, { error: "audioBase64 is not valid base64" }) :
      !ALLOWED_MIME.has(mime) ? json(415, { error: `Unsupported audio type: ${mime || "(none)"}` }) : null;
    if (bad) return (await activeP) || bad;

    // 4) Ask Gemini for a verbatim transcript (thinking off = much faster).
    const PREFER = ["gemini-flash-latest", "gemini-3.8-flash", "gemini-2.5-flash", "gemini-flash-lite-latest"];
    const contents = [{ role: "user", parts: [{ text: INSTRUCTION }, { inline_data: { mime_type: mime, data: audio } }] }];
    const askGemini = async (): Promise<Response> => {
      const r = await geminiFetch({ contents, generationConfig: { temperature: 0.1, thinkingConfig: { thinkingBudget: 0 } } }, PREFER, "flash");
      if (r.status !== 400) return r;
      console.warn("[voice-transcribe] model refused thinkingConfig, asking again without it");
      return await geminiFetch({ contents, generationConfig: { temperature: 0.1 } }, PREFER, "flash");
    };
    const geminiP: Promise<Response | Error> = askGemini().catch((e) => e as Error);
    const [denied, respOrErr] = await Promise.all([activeP, geminiP]);
    if (denied) return denied;
    if (respOrErr instanceof Error) {
      console.error("[voice-transcribe] Gemini fetch threw:", respOrErr.message);
      return json(502, { error: "Transcription service unreachable" });
    }
    const resp = respOrErr;
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
