// drive-backup — Google Drive backup control (Settings → Data & Backup).
//
// Deploy with JWT verification OFF (Google's redirect back to this function
// carries no Supabase JWT); every POST action below checks the caller itself.
//
//   POST {action:"status"}    Super Admin → connection + last runs
//   POST {action:"connect"}   Super Admin → Google sign-in URL (one-time state)
//   GET  ?code=…&state=…      Google redirect → stores the refresh token, shows "Connected"
//   POST {action:"run"}       Super Admin → queues a run + starts the GitHub backup job
//   POST {action:"download"}  Super Admin → 10-minute signed URL of the latest ZIP
//   POST {action:"token"}     backup job (service-role key) → fresh Drive access token
//
// Secrets (Supabase → Edge Functions → Secrets):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET   Google Cloud OAuth client (Web application)
//   GITHUB_BACKUP_TOKEN                      fine-grained token: this repo, Actions = Read and write
//   GITHUB_REPO   (optional, default shantaztechnofoods/mihir-trial)
//   APP_URL       (optional, default https://mihir-trial.vercel.app)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") || "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";
const GITHUB_BACKUP_TOKEN = Deno.env.get("GITHUB_BACKUP_TOKEN") || "";
const GITHUB_REPO = Deno.env.get("GITHUB_REPO") || "shantaztechnofoods/mihir-trial";
const APP_URL = Deno.env.get("APP_URL") || "https://mihir-trial.vercel.app";
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/drive-backup`;
const SCOPE = "openid email https://www.googleapis.com/auth/drive.file";
const ZIP_BUCKET = "erp-backups";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const page = (status: number, title: string, text: string) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
      `<body style="font-family:system-ui,sans-serif;background:#f5f7fb;display:grid;place-items:center;min-height:100vh;margin:0">` +
      `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:28px 32px;max-width:420px;text-align:center">` +
      `<h1 style="font-size:18px;margin:0 0 8px">${title}</h1><p style="color:#475569;font-size:14px;margin:0 0 18px">${text}</p>` +
      `<a href="${APP_URL}" style="display:inline-block;background:#2640B0;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:10px">Back to the ERP</a></div></body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );

const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const getSecret = async (key: string) =>
  (await service.from("backup_secrets").select("value").eq("key", key).maybeSingle()).data?.value ?? null;
const setSecret = (key: string, value: string | null) =>
  service.from("backup_secrets").upsert({ key, value, updated_at: new Date().toISOString() });

async function superAdmin(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  if (!auth) return null;
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return null;
  const { data: caller } = await service.from("users").select("id, role_key, status, full_name").eq("id", user.id).single();
  return caller && caller.status === "active" && caller.role_key === "super_admin" ? caller : null;
}

async function audit(caller: { id: string; full_name: string; role_key: string }, type: string, action: string, details: Record<string, unknown> = {}) {
  await service.from("audit_log").insert({
    user_id: caller.id, user_name: caller.full_name, user_role: caller.role_key,
    type, module: "Settings", action, ref: "drive-backup", details,
  });
}

async function googleToken(params: Record<string, string>) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, ...params }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google token error: ${body.error || r.status} ${body.error_description || ""}`.trim());
  return body as { access_token: string; refresh_token?: string; id_token?: string; expires_in: number };
}

function emailFromIdToken(idToken?: string) {
  try {
    const p = idToken!.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(p + "===".slice((p.length + 3) % 4))).email || null;
  } catch { return null; }
}

async function handleCallback(url: URL) {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error")) return page(400, "Google Drive not connected", "Google sign-in was cancelled. Open Settings → Data & Backup and press Connect again.");
  if (!code || !state) return page(400, "Google Drive not connected", "This link is incomplete. Start again from Settings → Data & Backup.");
  const saved = await getSecret("oauth_state");
  const [savedState, expires, userId, userName] = String(saved || "").split("|");
  if (!savedState || savedState !== state || Date.now() > Number(expires))
    return page(400, "Google Drive not connected", "This sign-in link has expired. Open Settings → Data & Backup and press Connect again.");
  await setSecret("oauth_state", null);
  try {
    const tok = await googleToken({ code, grant_type: "authorization_code", redirect_uri: REDIRECT_URI });
    if (!tok.refresh_token) return page(400, "Google Drive not connected", "Google did not give long-term access. Press Connect again and allow access.");
    const email = emailFromIdToken(tok.id_token);
    await setSecret("google_refresh_token", tok.refresh_token);
    await setSecret("google_email", email);
    await audit({ id: userId, full_name: userName, role_key: "super_admin" }, "drive_backup_connected",
      `Google Drive backup connected${email ? ` (${email})` : ""}`);
    return page(200, "Google Drive connected ✓", `Backups will be saved in the Drive of ${email || "this Google account"}. You can close this tab.`);
  } catch (e) {
    return page(500, "Google Drive not connected", String((e as Error).message || e));
  }
}

async function latestRuns() {
  const { data } = await service.from("backup_runs")
    .select("id, kind, status, requested_by_name, requested_at, started_at, finished_at, summary, drive_url, zip_path, error")
    .order("requested_at", { ascending: false }).limit(10);
  return data || [];
}

async function dispatchJob(runId: number) {
  const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/drive-backup.yml/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_BACKUP_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "shantaz-erp-drive-backup",
    },
    body: JSON.stringify({ ref: "main", inputs: { run_id: String(runId) } }),
  });
  if (r.status !== 204) throw new Error(`GitHub did not start the backup (${r.status}): ${(await r.text()).slice(0, 200)}`);
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  if (req.method === "GET") return handleCallback(url);
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let body: { action?: string } = {};
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON body" }); }

  // The backup job: proves it holds a service-role key by reading backup_secrets with it.
  if (body.action === "token") {
    const key = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const probe = await createClient(SUPABASE_URL, key).from("backup_secrets").select("key").limit(1);
    if (!key || probe.error) return json(403, { error: "Service key required" });
    const refresh = await getSecret("google_refresh_token");
    if (!refresh) return json(409, { error: "Google Drive is not connected yet (Settings → Data & Backup → Connect Google Drive)" });
    try {
      const tok = await googleToken({ refresh_token: refresh, grant_type: "refresh_token" });
      return json(200, { access_token: tok.access_token, expires_in: tok.expires_in, email: await getSecret("google_email") });
    } catch (e) {
      return json(502, { error: String((e as Error).message || e) });
    }
  }

  const caller = await superAdmin(req);
  if (!caller) return json(403, { error: "Super Admin only" });

  if (body.action === "status") {
    return json(200, {
      configured: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GITHUB_BACKUP_TOKEN),
      connected: Boolean(await getSecret("google_refresh_token")),
      email: await getSecret("google_email"),
      folderUrl: await getSecret("drive_root_url"),
      runs: await latestRuns(),
    });
  }

  if (body.action === "connect") {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return json(409, { error: "Google sign-in is not set up yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing)." });
    const state = crypto.randomUUID();
    await setSecret("oauth_state", [state, Date.now() + 15 * 60 * 1000, caller.id, caller.full_name].join("|"));
    const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    auth.search = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: "code", scope: SCOPE,
      access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
    }).toString();
    return json(200, { url: auth.toString() });
  }

  if (body.action === "run") {
    if (!GITHUB_BACKUP_TOKEN) return json(409, { error: "Back up now is not set up yet (GITHUB_BACKUP_TOKEN missing)." });
    if (!(await getSecret("google_refresh_token"))) return json(409, { error: "Connect Google Drive first." });
    const since = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const { data: busy } = await service.from("backup_runs").select("id").in("status", ["queued", "running"]).gte("requested_at", since).limit(1);
    if (busy && busy.length) return json(200, { alreadyRunning: true, runId: busy[0].id });
    const { data: run, error } = await service.from("backup_runs")
      .insert({ kind: "manual", status: "queued", requested_by: caller.id, requested_by_name: caller.full_name })
      .select("id").single();
    if (error || !run) return json(500, { error: error?.message || "Could not queue the backup" });
    try {
      await dispatchJob(run.id);
    } catch (e) {
      await service.from("backup_runs").update({ status: "failed", finished_at: new Date().toISOString(), error: String((e as Error).message || e) }).eq("id", run.id);
      return json(502, { error: String((e as Error).message || e) });
    }
    await audit(caller, "drive_backup_requested", "Back up now requested (Google Drive)", { run_id: run.id });
    return json(200, { runId: run.id });
  }

  if (body.action === "download") {
    const { data } = await service.from("backup_runs").select("zip_path, finished_at").not("zip_path", "is", null)
      .in("status", ["ok", "partial"]).order("finished_at", { ascending: false }).limit(1).maybeSingle();
    if (!data?.zip_path) return json(404, { error: "No backup ZIP yet. Press Back up now first." });
    const { data: signed, error } = await service.storage.from(ZIP_BUCKET).createSignedUrl(data.zip_path, 600, { download: true });
    if (error || !signed) return json(500, { error: error?.message || "Could not create the download link" });
    await audit(caller, "drive_backup_downloaded", "Backup ZIP downloaded", { zip_path: data.zip_path });
    return json(200, { url: signed.signedUrl, finishedAt: data.finished_at });
  }

  return json(400, { error: "Unknown action" });
});
