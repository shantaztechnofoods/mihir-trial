#!/usr/bin/env node
// SHANTAZ ERP — computed-style snapshot of one module's screens, to prove a CSS move is pure.
//
//   node scripts/style-snapshot.mjs <base-url> <out.json> [--module item-master]
//   node scripts/style-snapshot.mjs --diff <a.json> <b.json>
//
// Snapshot: local-mode build (VITE_USE_SUPABASE=false) served at <base-url>. Seeds a small item
// set (safe / warning / critical rows), signs in as admin, and for light + dark × desktop
// (1440×900, mouse) + phone (390×844, touch → pointer: coarse) records the FULL computed style
// (every property getComputedStyle lists) of every element in <body>, for these states:
// the module page, its add dialog, its detail dialog, and a hovered row button (desktop).
// Values are stored deduplicated (one table of distinct style strings per file).
// Diff: exits 0 when every state has the same elements with the same computed styles,
// 1 otherwise and prints the first differences (element path, property, a → b).
// Animations are settled by emulating prefers-reduced-motion and waiting for the DOM to go quiet.
import fs from "node:fs";
import pw from "/usr/local/lib/node_modules_global/playwright/index.js";

const args = process.argv.slice(2);

const normIds = (s) => s.replace(/url\("#[^"]*"\)/g, 'url("#<local-id>")');

if (args[0] === "--diff") {
  const [A, B] = [args[1], args[2]].map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
  if (JSON.stringify(A.props) !== JSON.stringify(B.props)) { console.log("DIFFERENT — the two snapshots list different CSS properties (different browsers?)"); process.exit(1); }
  let bad = 0, shown = 0, elems = 0;
  for (const key of Object.keys(A.states)) {
    const a = A.states[key], b = B.states[key];
    if (!b) { console.log(`state ${key}: missing in second snapshot`); bad++; continue; }
    if (a.length !== b.length) { console.log(`state ${key}: ${a.length} vs ${b.length} elements`); bad++; }
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      elems++;
      const [pa, sa] = a[i], [pb, sb] = b[i];
      if (pa !== pb) { bad++; if (shown++ < 20) console.log(`state ${key}: element ${i} path ${pa} vs ${pb}`); continue; }
      // Each snapshot has its own style table, so compare the VALUES, never the indices.
      // React useId() ids inside url("#…") (e.g. SVG gradient fills) differ between builds/runs: normalised.
      const ta = normIds(A.table[sa]), tb = normIds(B.table[sb]);
      if (ta === tb) continue;
      const va = ta.split("\u0001"), vb = tb.split("\u0001");
      bad++;
      for (let k = 0; k < A.props.length; k++) {
        if (va[k] !== vb[k] && shown < 40) { shown++; console.log(`state ${key}: ${pa}  ${A.props[k]}: ${va[k]} → ${vb[k]}`); }
      }
    }
  }
  console.log(`${bad ? "DIFFERENT" : "IDENTICAL"} — ${Object.keys(A.states).length} states, ${elems} elements compared, ${A.props.length} properties each, ${bad} difference(s)`);
  process.exit(bad ? 1 : 0);
}

const [BASE, OUT] = args;
if (!BASE || !OUT) { console.error("usage: node scripts/style-snapshot.mjs <base-url> <out.json> | --diff a.json b.json"); process.exit(2); }

const seed = () => {
  const pwd = (s) => btoa(unescape(encodeURIComponent(s)));
  localStorage.clear();
  localStorage.setItem("erp_users", JSON.stringify([{ id: "super_admin_001", username: "admin", password: pwd("admin123"), fullName: "Super Admin", role: "super_admin", status: "active" }]));
  const it = (code, name, unit, stock, min, status) => ({ id: code, code, name, unit, stock, min, max: 200, status, trend: [stock, stock, stock, stock, stock], history: [{ date: "01 Nov 2026", event: "Opening", change: 0, qty: stock }], location: "R1", lastPurchaseRate: 10, vendor: "", vendorLinks: [] });
  localStorage.setItem("erp_items", JSON.stringify({
    Mechanical: [it("BOLT-M8", "Bolt M8", "Nos", 100, 10, "safe"), it("NUT-M8", "Nut M8", "Nos", 3, 10, "critical")],
    Electrical: [it("WIRE-2", "Wire 2mm", "Meter", 12, 10, "warning"), it("RELAY-1", "Relay 24V", "Nos", 40, 5, "safe")],
    Hardware: [it("GREASE", "Grease", "Kg", 0, 1, "critical")],
  }));
  for (const k of ["erp_pos", "erp_vendors", "erp_pending", "erp_followups", "erp_handovers", "erp_pending_handover_items", "erp_checklist_responses", "erp_dept_ratings", "erp_attachments", "erp_machines", "erp_inward", "erp_outward", "erp_audit"]) localStorage.setItem(k, "[]");
  localStorage.setItem("erp_bomdefs", "{}");
};

const capture = (p) => p.evaluate(() => {
  const props = [...getComputedStyle(document.body)].sort();
  const path = (el) => { const parts = []; for (let e = el; e && e !== document.body; e = e.parentElement) { const i = [...e.parentElement.children].indexOf(e); parts.push(`${e.tagName.toLowerCase()}:${i}`); } return parts.reverse().join(">"); };
  const out = [];
  for (const el of document.body.querySelectorAll("*")) {
    const cs = getComputedStyle(el);
    out.push([path(el), props.map((k) => cs.getPropertyValue(k)).join("\u0001")]);
  }
  return { props, out };
});

const settle = (p) => p.evaluate(() => new Promise((res) => {
  let last = performance.now(); const t0 = last;
  const mo = new MutationObserver(() => { last = performance.now(); });
  mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  const tick = () => { const n = performance.now(); if (n - last >= 400 || n - t0 >= 4000) { mo.disconnect(); res(); } else setTimeout(tick, 50); };
  setTimeout(tick, 50);
}));

const snap = { props: null, table: [], states: {} };
const tableIdx = new Map();
const store = (key, r) => {
  snap.props ||= r.props;
  snap.states[key] = r.out.map(([pth, s]) => { if (!tableIdx.has(s)) { tableIdx.set(s, snap.table.length); snap.table.push(s); } return [pth, tableIdx.get(s)]; });
};

const b = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  for (const theme of ["light", "dark"]) {
    for (const vp of [{ name: "desktop", viewport: { width: 1440, height: 900 } }, { name: "phone", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]) {
      const ctx = await b.newContext({ viewport: vp.viewport, hasTouch: !!vp.hasTouch, isMobile: !!vp.isMobile, reducedMotion: "reduce" });
      const p = await ctx.newPage();
      await p.goto(BASE, { waitUntil: "networkidle" });
      await p.evaluate(seed);
      await p.evaluate((t) => localStorage.setItem("erp_theme_mode", t), theme);
      await p.reload({ waitUntil: "networkidle" });
      await p.locator("#login-username").fill("admin");
      await p.locator("#login-password").click();   // read-only until focused (anti-autofill), as tests/e2e/lib/helpers.mjs login()
      await p.locator("#login-password").fill("admin123");
      await p.getByRole("button", { name: "Sign In" }).click();
      await p.locator("#login-username").waitFor({ state: "detached", timeout: 20000 });
      await settle(p);
      // open Item Master: sidebar on desktop; on phone the "All pages" button opens the same sidebar (as tests/e2e/mobile-sweep.mjs)
      if (vp.name === "phone") { await p.locator('[aria-label="All pages"]').click(); await settle(p); }
      await p.locator("aside button.sb-item").filter({ hasText: /^\s*Item Master/ }).first().click();
      await p.locator(".wu-imrow, [data-item-row], table").first().waitFor({ timeout: 15000 }).catch(() => {});
      await settle(p);
      const k = `${theme}/${vp.name}`;
      store(`${k}/page`, await capture(p));
      if (vp.name === "desktop") {
        const btn = p.locator(".wu-rowbtn").first();
        if (await btn.count()) { await btn.hover(); await settle(p); store(`${k}/row-hover`, await capture(p)); await p.mouse.move(1, 1); await settle(p); }
      }
      // add dialog
      const add = p.locator("button").filter({ hasText: /Add Item|New Item|^\+\s*Item/ }).first();
      if (await add.isVisible().catch(() => false)) {
        await add.click(); await settle(p); store(`${k}/add-dialog`, await capture(p));
        await p.keyboard.press("Escape"); await settle(p);
      }
      // detail dialog: click the first item name
      const name = p.locator("text=Bolt M8").first();
      if (await name.isVisible().catch(() => false)) {
        await name.click(); await settle(p); store(`${k}/detail-dialog`, await capture(p));
        await p.keyboard.press("Escape"); await settle(p);
      }
      await ctx.close();
    }
  }
} finally { await b.close(); }
fs.writeFileSync(OUT, JSON.stringify(snap));
console.log(`${OUT}: ${Object.keys(snap.states).length} states (${Object.keys(snap.states).join(", ")}), ${snap.table.length} distinct styles`);
