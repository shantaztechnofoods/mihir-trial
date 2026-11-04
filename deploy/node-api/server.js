// SHANTAZ ERP — run the Vercel serverless functions (api/*.js) and, optionally, the
// built frontend (dist/) on ANY machine with Node 20, no Vercel needed. Zero dependencies.
//
//   npm ci && npm run build                 # builds dist/ (VITE_* env vars set first)
//   node deploy/node-api/server.js          # http://localhost:3001  (PORT=… to change)
//
// Env: PORT (default 3001), DIST (default ./dist; set DIST=none to serve only /api),
//      plus whatever the functions read (only api/whatsapp-webhook.js: SUPABASE_URL,
//      SUPABASE_SERVICE_ROLE_KEY, CHAKRA_WEBHOOK_SECRET) — set them on the server, never in git.
// Only the WhatsApp module uses /api. With WhatsApp OFF (ERP LIVE today) /api is unused.
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const API_DIR = path.join(ROOT, "api");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain", ".webmanifest": "application/manifest+json" };

// Vercel-style response helpers the functions use: res.status(n).json(x) / .end()
function vercelRes(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { if (!res.headersSent) res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); return res; };
  res.send = (body) => { res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body)); return res; };
  return res;
}

function readBody(req, limit = 30 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on("data", (c) => { n += c.length; if (n > limit) { reject(new Error("body too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export async function loadHandlers(dir = API_DIR) {
  const out = {};
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith(".js")); } catch { return out; }
  for (const f of files) {
    const mod = await import(pathToFileURL(path.join(dir, f)).href);
    if (typeof mod.default === "function") out[f.slice(0, -3)] = { handler: mod.default, raw: mod.config?.api?.bodyParser === false };
  }
  return out;
}

export async function createServer({ dist = process.env.DIST || path.join(ROOT, "dist"), apiDir = API_DIR } = {}) {
  const handlers = await loadHandlers(apiDir);
  const serveDist = dist && dist !== "none";
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    try {
      if (url.pathname.startsWith("/api/")) {
        const name = url.pathname.slice(5).replace(/\/+$/, "");
        const h = handlers[name];
        vercelRes(res);
        if (!h) { res.status(404).json({ error: `no function ${name}` }); return; }
        req.query = Object.fromEntries(url.searchParams);
        if (!h.raw && req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
          const buf = await readBody(req);
          const txt = buf.toString("utf8");
          try { req.body = txt ? JSON.parse(txt) : {}; } catch { req.body = txt; }
        }
        await h.handler(req, res);
        return;
      }
      if (!serveDist) { res.statusCode = 404; res.end("not found"); return; }
      // Static file, else SPA fallback to index.html.
      const base = path.resolve(dist);
      let file = path.resolve(base, "." + path.posix.normalize(decodeURIComponent(url.pathname)));
      if (file !== base && !file.startsWith(base + path.sep)) { res.statusCode = 400; res.end(); return; }
      let st = await stat(file).catch(() => null);
      if (!st || st.isDirectory()) { file = path.join(base, "index.html"); st = await stat(file).catch(() => null); }
      if (!st) { res.statusCode = 404; res.end("dist/ not built — run npm run build"); return; }
      const ext = path.extname(file);
      res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
      res.setHeader("Cache-Control", file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache");
      res.end(await readFile(file));
    } catch (e) {
      if (!res.headersSent) { res.statusCode = 500; res.setHeader("Content-Type", "application/json"); }
      res.end(JSON.stringify({ error: String(e?.message || e) }));
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3001);
  const srv = await createServer();
  srv.listen(port, () => console.log(`[shantaz-erp] http://localhost:${port}  (api: ${API_DIR})`));
}
