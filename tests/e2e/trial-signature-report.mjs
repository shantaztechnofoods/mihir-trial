// Trial signatures reach the final reports (2026-11-04).
// Real UI flow, LOCAL TEST DATA ONLY: a machine at Trial gets its Trial
// Certificate filled and signed (Finish & Transfer → certificate → confirm),
// Ready is accepted with a drawn signature, then the Company full report and
// the Customer report must both show the Trial signature as an image with
// the signer's name, department and date — and the Company report must list
// every signature captured on the way (certificate + acceptance).
import fs from "fs";
import { launch, loginAdmin, gotoMachineTracker, makeOk } from "./lib/helpers.mjs";
const src = fs.readFileSync(new URL("./go-live-workflows.mjs", import.meta.url), "utf8");
const seedSrc = src.match(/const seed = \(\) => \{[\s\S]*?\n\};\n/)[0].replace("const seed = ", "").replace(/;\s*$/, "");
const addTrialMachine = () => {
  const ms = JSON.parse(localStorage.getItem("erp_machines") || "[]");
  ms.push({ id: 6, bomKey: "M-10", bomLabel: "Kneading Machine 10kg", serialNo: "SN-106", stage: "Trial", status: "active", currentDepartment: "Trial",
    departmentEnteredAt: new Date(Date.now() - 20 * 60e3).toISOString(), createdDate: "27 Oct 2026", history: [] });
  localStorage.setItem("erp_machines", JSON.stringify(ms));
};
const { ok, done } = makeOk();
const { b, p, errs } = await launch(`(${seedSrc})(); (${addTrialMachine.toString()})();`, { width: 1280, height: 900 });
await loginAdmin(p); await gotoMachineTracker(p);

const draw = async () => {
  const c = p.locator("canvas").last(); await c.scrollIntoViewIfNeeded(); const bb = await c.boundingBox();
  await p.mouse.move(bb.x + 20, bb.y + bb.height * 0.7); await p.mouse.down();
  for (let i = 1; i <= 12; i++) await p.mouse.move(bb.x + 20 + i * (bb.width - 40) / 12, bb.y + bb.height * (i % 2 ? 0.3 : 0.7));
  await p.mouse.up();
  await p.getByRole("button", { name: "Save Signature" }).last().click(); await p.waitForTimeout(200);
};

// 1. Trial → Ready: the certificate, signed by the Trial head.
await p.locator('button[title="Finish Trial → Ready"]').first().click(); await p.waitForTimeout(500);
ok("Trial certificate form opens", await p.getByText("Machine Trial Certificate").count() >= 1);
await p.locator('input[placeholder="Name (required)"]').fill("Tina Trialhead");
await p.getByRole("button", { name: /Draw signature/ }).first().click(); await p.waitForTimeout(200);
await draw();
await p.locator('input[placeholder="Name (optional)"]').fill("Sanjay Service");
await p.getByRole("button", { name: /Draw signature/ }).first().click(); await p.waitForTimeout(200);
await draw();
await p.getByRole("button", { name: /Preview Certificate/ }).click(); await p.waitForTimeout(300);
await p.locator("[data-cert-confirm]").check(); await p.locator("[data-cert-submit]").click(); await p.waitForTimeout(900);
const m6 = await p.evaluate(() => JSON.parse(localStorage.getItem("erp_machines")).find((m) => m.id === 6));
ok("certificate saved with the Trial signature", !!(m6 && m6.trialCertificate && String(m6.trialCertificate.trialBySignature).includes("<svg")));

// 2. Accept into Ready with a drawn signature.
const ho = await p.evaluate(() => JSON.parse(localStorage.getItem("erp_handovers")).find((h) => h.machineId === 6 && h.status === "pending"));
ok("a Trial → Ready hand-over is waiting", !!ho);
await p.locator(`[data-card-accept="${ho.id}"]`).first().click({ timeout: 5000 }).catch(async () => { await p.getByRole("button", { name: /Accept/ }).first().click(); });
await p.waitForTimeout(500);
await p.getByRole("button", { name: /Draw|Sign/ }).first().click({ timeout: 1500 }).catch(() => {});
await draw();
await p.locator("[data-accept-confirm]").click(); await p.waitForTimeout(1000);
const ho2 = await p.evaluate((id) => JSON.parse(localStorage.getItem("erp_handovers")).find((h) => h.id === id), ho.id);
ok("Ready accepted with a signature", ho2 && ho2.status === "accepted" && String(ho2.acceptedSignatureSvg || "").includes("<svg"));

// 3. Company full report: the signature register lists the Trial signature.
const openFromMenu = async (kind, machineId) => {
  await p.locator("[data-reports-menu]").click(); await p.waitForTimeout(300);
  await p.locator(`[data-report-option="${kind}"] [data-report-machine-pick]`).selectOption(String(machineId));
  await p.locator(`[data-report-open="${kind}"]`).click(); await p.waitForTimeout(700);
};
const close = async () => { await p.getByRole("button", { name: "Close report" }).last().click(); await p.waitForTimeout(300); };
const sigRows = () => p.evaluate(() => [...document.querySelectorAll("[data-report-signatures] [data-report-sig-row]")].map((r) => ({
  text: r.innerText.replace(/\s+/g, " "), img: !!(r.querySelector("img") && r.querySelector("img").naturalWidth > 0) })));
const dateRe = /\b\d{2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}\b/;
await openFromMenu("company", 6);
let rows = await sigRows();
const trial = rows.find((r) => /Tina Trialhead/.test(r.text));
ok("company report: Trial signature listed with an image", trial && trial.img, JSON.stringify(rows));
ok("company report: Trial signature shows department and date", trial && /Trial/.test(trial.text) && dateRe.test(trial.text), trial && trial.text);
ok("company report: service engineer signature listed", rows.some((r) => /Sanjay Service/.test(r.text) && r.img));
ok("company report: Ready acceptance signature listed", rows.some((r) => /Accept/.test(r.text) && /Ready/.test(r.text) && r.img), JSON.stringify(rows));
ok("company report: signature count in the summary matches the register", (await p.locator("[data-report-sig-count]").innerText()).trim() === String(rows.length));
await close();

// 4. Customer report: the full certificate (section 3) carries the Trial signature with name and date.
// 2026-11-06 (reports v4) — owner rule: the trial signatures print once, on the certificate inside the report.
await openFromMenu("customer", 6);
const ccert = await p.evaluate(() => { const s = document.querySelector("[data-report-trial]"); const img = s && s.querySelector(".tc-sigimg img");
  return { text: s ? s.innerText.replace(/\s+/g, " ") : "", img: !!(img && img.naturalWidth > 0) }; });
ok("customer report: Trial signature shown on the certificate with name and date", ccert.img && /Tina Trialhead/.test(ccert.text) && /Machine Set and Trial By/i.test(ccert.text) && /\b\d{2} [A-Z][a-z]{2} \d{4}\b/.test(ccert.text), ccert.text.slice(-300));
await close();
ok("no page errors", errs.length === 0, errs.join(" | "));
await done(b);
