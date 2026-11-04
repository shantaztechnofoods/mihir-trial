// deploy/node-api/server.js — the "host anywhere" Node server: Vercel-style /api
// functions + static dist/ with SPA fallback. Self-contained: builds a tiny fake dist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, loadHandlers } from "../deploy/node-api/server.js";

const dist = mkdtempSync(path.join(tmpdir(), "erp-dist-"));
mkdirSync(path.join(dist, "assets"));
writeFileSync(path.join(dist, "index.html"), "<!doctype html><div id=root>ERP</div>");
writeFileSync(path.join(dist, "assets", "app-abc.js"), "console.log(1)");

async function withServer(fn) {
  const srv = await createServer({ dist });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try { await fn(base); } finally { await new Promise((r) => srv.close(r)); }
}

test("every api/*.js function is loaded", async () => {
  const h = await loadHandlers();
  for (const n of ["whatsapp-send", "whatsapp-chats", "whatsapp-webhook"]) assert.ok(h[n], n);
  assert.equal(h["whatsapp-webhook"].raw, true, "webhook keeps its raw body (signature check)");
});

test("static files, SPA fallback, cache headers, no path escape", async () => {
  await withServer(async (b) => {
    let r = await fetch(`${b}/`); assert.equal(r.status, 200); assert.match(await r.text(), /ERP/);
    r = await fetch(`${b}/machines/123`); assert.equal(r.status, 200); assert.match(await r.text(), /ERP/, "deep link → index.html");
    r = await fetch(`${b}/assets/app-abc.js`); assert.equal(r.status, 200);
    assert.match(r.headers.get("cache-control"), /immutable/);
    assert.match(r.headers.get("content-type"), /javascript/);
    r = await fetch(`${b}/..%2f..%2fetc/passwd`); assert.notEqual(await r.text(), readFileSync("/etc/passwd", "utf8"));
  });
});

test("api: Vercel-style handler answers through the wrapper", async () => {
  await withServer(async (b) => {
    let r = await fetch(`${b}/api/whatsapp-send`, { method: "GET" });
    assert.equal(r.status, 405); assert.deepEqual(await r.json(), { error: "POST only" });
    r = await fetch(`${b}/api/whatsapp-send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(r.status, 400); assert.match((await r.json()).error, /Missing 'to'/);
    r = await fetch(`${b}/api/nope`, { method: "POST" }); assert.equal(r.status, 404);
  });
});

test("deploy files exist and nginx has the SPA fallback", () => {
  const conf = readFileSync(new URL("../deploy/nginx.conf", import.meta.url), "utf8");
  assert.match(conf, /try_files \$uri \$uri\/ \/index\.html;/);
  const df = readFileSync(new URL("../deploy/Dockerfile", import.meta.url), "utf8");
  assert.match(df, /npm run build/); assert.match(df, /COPY --from=build \/app\/dist \/usr\/share\/nginx\/html/);
  assert.doesNotMatch(df, /ARG SUPABASE_SERVICE_ROLE/, "never bake the service-role key");
  assert.ok(existsSync(new URL("../HOSTING-ANYWHERE.md", import.meta.url)));
});
