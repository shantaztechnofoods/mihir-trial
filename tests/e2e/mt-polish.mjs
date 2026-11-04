// Machine Tracker polish (2026-11-03). LOCAL TEST DATA ONLY.
// Rack crates never overlap with a long serial, the build tag hides while a
// dialog is open, and sending a machine from the rack asks "Are you sure?".
// Part 2: Fill Rack reasons, delay card vs Today, History panel, Report Issue
// copy + one recorder, and the ⚙️ Settings target.
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

// ── 3. A Fill Rack that is off says why, in plain sight, and is grey ──
const fills = await p.evaluate(() => [...document.querySelectorAll("[data-rack-fill]")].map((b) => ({ id: b.dataset.rackFill, off: b.disabled, bg: getComputedStyle(b).backgroundColor,
  why: (document.querySelector(`[data-rack-fill-why="${CSS.escape(b.dataset.rackFill)}"]`) || {}).textContent || "" })));
const off = fills.filter((f) => f.off);
ok("every disabled Fill Rack has a visible reason under it", off.length > 0 && off.every((f) => f.why.trim().length > 0), JSON.stringify(off.map((f) => f.why)));
ok("disabled Fill Rack is plain grey (not faded blue)", off.every((f) => f.bg === "rgb(229, 231, 235)"), off[0] && off[0].bg);
ok("an enabled Fill Rack shows no reason line", fills.filter((f) => !f.off).every((f) => !f.why));
if (off.length) {
  await p.locator(`[data-slot="${off[0].id}"]`).click(); await p.waitForTimeout(400);
  const pw = p.locator('.rack-panel [data-rack-action-why="fill"]');
  ok("rack panel: the same short reason is printed under its disabled Fill Rack", await p.locator('.rack-panel [data-action="fill"]').isDisabled() && (await pw.innerText()).trim() === off[0].why.trim(), await pw.innerText());
  ok("build tag hidden while the rack panel is open", await p.evaluate(() => getComputedStyle(document.getElementById("erp-build-badge")).display === "none"));
  await p.locator('.rack-panel button[aria-label="Close"]').click(); await p.waitForTimeout(300);
}

// ── 2. The copy matches the real rule and the delay card agrees with Today ──
const lateChip = p.locator('[data-mt-today-chip="hold"]');
const lateN = (await lateChip.count()) ? Number((await lateChip.innerText()).match(/\d+/)[0]) : 0;
const lateNow = await p.locator("[data-delay-late-now]").innerText().catch(() => "");
ok("delay card shows 'Late right now: N' from the same list as the Today line", lateNow.includes(`Late right now: ${lateN}`), `${lateNow} vs ${lateN}`);
ok("delay card says it counts recorded reasons", /Reasons recorded this month/.test(await p.locator("[data-delay-subtitle]").innerText()));
ok("no 'No delays … 🎉' while a machine is late", !(await p.locator("[data-delay-card]").innerText()).includes("🎉"));

// ── 7. History: empty stage history, one Customer report, Update Stage behind a toggle ──
const histBtn = p.locator("button", { hasText: /^History$/ }).first();
await histBtn.scrollIntoViewIfNeeded(); await histBtn.click(); await p.waitForTimeout(400);
ok("empty stage history says 'No stage moves yet'", await p.locator("[data-stage-history-empty]").first().innerText().then((t) => t.trim() === "No stage moves yet").catch(() => false));
ok("History panel has no second Customer report button", await p.locator("[data-history-customer-report]").count() === 0 && await p.locator("[data-card-customer-report]").count() > 0);
const tg = p.locator("[data-stage-edit-toggle]").first();
ok("Update Stage is hidden behind 'Change stage (admin)'", await tg.count() === 1 && await p.locator("[data-stage-edit-select]").count() === 0);
await tg.click(); await p.waitForTimeout(200);
ok("the toggle shows the same Update Stage select", await p.locator("[data-stage-edit-select]").count() === 1 && /Update Stage/.test(await p.locator("[data-stage-edit-select]").innerText()));
await p.locator('button[aria-label="Close stage change"]').click(); await p.waitForTimeout(200);
await p.locator("button", { hasText: /^Hide$/ }).first().click(); await p.waitForTimeout(300);

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
// 2. + 11. Report Issue copy and one recorder (2026-11-03: small 🎤 in the box, no language chips)
const rtext = await p.locator(".modal-backdrop").last().innerText();
ok("Report Issue says it never blocks Finish & Transfer", /never blocks Finish & Transfer/.test(rtext) && !/stays blocked/.test(rtext));
ok("Report Issue has one small 🎤 (text only), no second mic", await p.locator(".modal-backdrop [data-voice-record]").count() === 1 && await p.locator('.modal-backdrop button[title^="Voice input"]').count() === 0);
ok("no language chips (auto language)", await p.locator(".modal-backdrop [data-voice-lang], .modal-backdrop [data-voice-lang-cycle]").count() === 0);
await cancel.click(); await p.waitForTimeout(300);

// ── 9. Machine Tracker ⚙️ Settings opens the Machine Tracker settings ──
await p.setViewportSize({ width: 1280, height: 800 }); await p.waitForTimeout(300);
await p.locator("button", { hasText: "⚙️ Settings" }).first().click(); await p.waitForTimeout(700);
ok("⚙️ Settings opens Machine Tracker Settings (not Company)", /Machine Tracker Settings/.test(await p.locator("body").innerText()) && await p.locator("button", { hasText: /^Company$/ }).count() === 0);

ok("no page errors", errs.length === 0, errs.join(" | "));
await done(b);
