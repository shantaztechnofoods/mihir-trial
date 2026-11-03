// Machine Tracker polish (2026-11-03). LOCAL TEST DATA ONLY.
// Rack crates never overlap with a long serial, the build tag hides while a
// dialog is open, and sending a machine from the rack asks "Are you sure?".
import fs from "fs";
import { launch, login, makeOk, ls } from "./lib/helpers.mjs";
const src = fs.readFileSync(new URL("./go-live-workflows.mjs", import.meta.url), "utf8");
const m = src.match(/const seed = \(\) => \{[\s\S]*?\n\};\n/); const baseSeed = eval("(" + m[0].replace("const seed = ", "").replace(/;\s*$/, "") + ")");
const LONG = "SHZ/RM10/2026-27/000123-A";
const seed = new Function(`(${baseSeed.toString()})();
  const defs = JSON.parse(localStorage.getItem("erp_bomdefs"));
  defs["R-10"] = { label: "Rotary Moulder 10 inch", rackCapacity: 2, items: [{ code: "N-1", qty: 2 }] };
  localStorage.setItem("erp_bomdefs", JSON.stringify(defs));
  const ms = JSON.parse(localStorage.getItem("erp_machines"));
  ms.push({ id: 66, bomKey: "R-10", bomLabel: "Rotary Moulder 10 inch", serialNo: "${LONG}", stage: "BOM Issued", status: "active", currentDepartment: "BOM Issued", departmentEnteredAt: new Date().toISOString(), rackSlot: "R-10-1#1", createdDate: "01 Nov 2026", history: [] });
  localStorage.setItem("erp_machines", JSON.stringify(ms));`);
const { ok, done } = makeOk();
const { b, p, errs } = await launch(seed);
const gotoMT = async () => { await p.locator("button, a").filter({ hasText: /^Machine Tracker/ }).first().click(); await p.waitForTimeout(900); };
await login(p, "admin", "admin123"); await gotoMT();

// ── 1. Long serial: no crate overlaps its neighbour, at desktop and phone ──
const overlap = () => p.evaluate(() => {
  const sets = [...document.querySelectorAll(".rack-shelf > .rack-set")];
  const bad = [];
  for (const s of sets) {
    const r = s.getBoundingClientRect();
    for (const c of s.querySelectorAll(".rack-crate")) { const cr = c.getBoundingClientRect(); if (cr.right > r.right + 1 || cr.left < r.left - 1) bad.push(c.dataset.slot); }
  }
  for (let i = 1; i < sets.length; i++) { const a = sets[i - 1].getBoundingClientRect(), z = sets[i].getBoundingClientRect(); if (Math.abs(a.top - z.top) < 2 && a.right > z.left + 1) bad.push(`set ${i}`); }
  const cell = document.querySelector(`[data-serial="SHZ/RM10/2026-27/000123-A"]`);
  const sn = cell && [...cell.querySelectorAll(".font-mono")].find((e) => e.textContent.includes("SHZ/"));
  return { bad, found: !!cell, truncated: !!sn && sn.scrollWidth > sn.clientWidth && sn.getAttribute("title") === "SHZ/RM10/2026-27/000123-A", hscroll: document.documentElement.scrollWidth > window.innerWidth + 1 };
});
for (const [w, h] of [[1280, 800], [390, 844]]) {
  await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(400);
  const o = await overlap();
  ok(`${w}px: the long-serial crate is on the rack and no crate overlaps another`, o.found && o.bad.length === 0, JSON.stringify(o.bad));
  ok(`${w}px: the long serial is truncated with the full text in its title`, o.truncated);
  ok(`${w}px: no sideways page scroll`, !o.hscroll);
}
// the #97 alignment stays: every M crate in a row has the same top
const tops = await p.evaluate(() => [...document.querySelectorAll(".rack-shelf > .rack-set")].slice(0, 2).map((s) => [...s.querySelectorAll(".rack-crate")].map((c) => Math.round(c.getBoundingClientRect().top))));
ok("rack rows stay aligned (M with M, R with R)", tops.length === 2 && tops[0][0] === tops[1][0] && tops[0][1] === tops[1][1], JSON.stringify(tops));
await p.setViewportSize({ width: 1280, height: 800 }); await p.waitForTimeout(300);

// ── 8. Send to Mechanical asks first; No keeps it; Yes runs the same handler ──
const badge = () => p.evaluate(() => { const e = document.getElementById("erp-build-badge"); return !!e && getComputedStyle(e).display !== "none"; });
ok("build tag shows while no dialog is open", await badge());
const send = p.locator("[data-rack-send]").first();
ok("assembled rack machine shows Send to Mechanical", await send.count() === 1);
await send.click(); await p.waitForTimeout(400);
const ask = p.locator("[data-rack-send-ask]");
ok("tapping Send asks 'Are you sure? Send M-10 · SN-104 to Mechanical?'", await ask.count() === 1 && /Are you sure\?/.test(await ask.innerText()) && /Send M-10 · SN-104 to Mechanical\?/.test(await ask.innerText()));
ok("nothing is sent before Yes", !(await ls(p, "erp_handovers")).find((h) => h.id === 22)?.releasedAt);
// ── 6. the build tag hides while a dialog is open ──
ok("build tag hidden while the confirm is open", !(await badge()));
for (const sel of ["[data-rack-send-no]", "[data-rack-send-yes]"]) {
  const bb = await p.locator(sel).boundingBox(); ok(`${sel} is at least 48px tall`, bb && bb.height >= 47.5, bb && bb.height);
}
await p.locator("[data-rack-send-no]").click(); await p.waitForTimeout(300);
ok("No closes and keeps the machine on the rack", await ask.count() === 0 && !(await ls(p, "erp_handovers")).find((h) => h.id === 22)?.releasedAt && !!(await ls(p, "erp_machines")).find((x) => x.id === 4)?.rackSlot);
await send.click(); await p.waitForTimeout(300);
await p.locator("[data-rack-send-yes]").click(); await p.waitForTimeout(1000);
ok("Yes sends it (hand-over released, rack slot cleared)", !!(await ls(p, "erp_handovers")).find((h) => h.id === 22)?.releasedAt && !(await ls(p, "erp_machines")).find((x) => x.id === 4)?.rackSlot);
ok("build tag back after the dialog closes", await badge());

// ── 6. Phone popups: Cancel is 48px, the build tag is hidden ──
await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(400);
const issue = p.locator("button", { hasText: /^Report Issue$/ }).first();
await issue.scrollIntoViewIfNeeded(); await issue.click(); await p.waitForTimeout(500);
const cancel = p.locator(".modal-backdrop button.mt-cancel").first();
const cb = await cancel.boundingBox();
ok("phone Report Issue: Cancel is at least 48px and inside the screen", cb && cb.height >= 47.5 && cb.y + cb.height <= 844, JSON.stringify(cb));
ok("phone: build tag hidden while Report Issue is open", !(await badge()));
await cancel.click(); await p.waitForTimeout(300);

ok("no page errors", errs.length === 0, errs.join(" | "));
await done(b);
