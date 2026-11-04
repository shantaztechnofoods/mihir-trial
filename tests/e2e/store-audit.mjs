// Store modules audit (fix/store-audit-1): decimal quantities, over-remove,
// duplicate item codes, single audit row per item change, Issue All sharing
// stock between machines, inward auto-fulfill audit, export buttons.
import { launch, loginAdmin, ls, makeOk } from "./lib/helpers.mjs";
const { ok, done } = makeOk();

const seed = () => {
  const pw = (s) => btoa(unescape(encodeURIComponent(s)));
  localStorage.clear();
  localStorage.setItem("erp_users", JSON.stringify([{ id: "super_admin_001", username: "admin", password: pw("admin123"), fullName: "Super Admin", role: "super_admin", status: "active" }]));
  const it = (code, name, unit, stock, min) => ({ id: code, code, name, unit, stock, min, max: 0, status: "safe", trend: [stock, stock, stock, stock, stock], history: [{ date: "01 Nov 2026", event: "Opening", change: 0, qty: stock }], location: "R1", lastPurchaseRate: 10, vendor: "", vendorLinks: [] });
  localStorage.setItem("erp_items", JSON.stringify({
    Mechanical: [it("BOLT-M8", "Bolt M8", "Nos", 100, 10)],
    Electrical: [it("WIRE-2", "Wire 2mm", "Meter", 50, 5)],
    Hardware:   [it("GREASE", "Grease", "Kg", 5, 1)],
  }));
  localStorage.setItem("erp_bomdefs", JSON.stringify({ "M-10": { label: "Kneading Machine 10kg", rackCapacity: 2, items: [{ code: "BOLT-M8", qty: 8 }] } }));
  const row = (code, name, unit, category, pendingQty, issueId, serialNo) => ({ code, name, unit, category, pendingQty, issueQty: 0, bomKey: "M-10", bomLabel: "Kneading Machine 10kg", date: "01 Nov 2026", issueId, serialNo });
  localStorage.setItem("erp_pending", JSON.stringify([
    row("BOLT-M8", "Bolt M8", "Nos", "Mechanical", 20, 9001, "SN-1"),
    row("BOLT-M8", "Bolt M8", "Nos", "Mechanical", 90, 9002, "SN-2"),
    row("GREASE", "Grease", "Kg", "Hardware", 2, 9003, "SN-3"),
  ]));
};

const { b, p, errs } = await launch(seed, { width: 1440, height: 900 });
await loginAdmin(p);
const nav = async (name) => { await p.locator("button, a").filter({ hasText: name }).first().click(); await p.waitForTimeout(900); };
const stock = async (code) => { const all = await ls(p, "erp_items"); for (const arr of Object.values(all)) { const f = arr.find((i) => i.code === code); if (f) return f.stock; } return null; };
const audit = async () => (await ls(p, "erp_audit")) || [];
const row = (code) => p.locator("tr").filter({ has: p.locator("td", { hasText: new RegExp(`^${code}$`) }) }).first();

// ── Item Master: quick add / remove with decimals, over-remove refused ──
await nav("Item Master");
await row("GREASE").locator("button[title='Add Stock']").click();
await p.locator("input[placeholder='Enter quantity']").fill("2.5");
await p.getByRole("button", { name: /Confirm Add/ }).click(); await p.waitForTimeout(500);
ok("quick Add Stock keeps decimals (5 + 2.5 = 7.5 Kg)", (await stock("GREASE")) === 7.5, String(await stock("GREASE")));
await row("GREASE").locator("button[title='Remove Stock']").click();
await p.locator("input[placeholder='Enter quantity']").fill("10");
ok("removing more than on hand shows a clear error", await p.locator("[data-qs-err]").isVisible());
await p.getByRole("button", { name: /Confirm Remove/ }).click(); await p.waitForTimeout(400);
ok("over-remove does not change stock", (await stock("GREASE")) === 7.5);
await p.locator("input[placeholder='Enter quantity']").fill("1.25");
await p.getByRole("button", { name: /Confirm Remove/ }).click(); await p.waitForTimeout(500);
ok("quick Remove Stock 1.25 → 6.25", (await stock("GREASE")) === 6.25, String(await stock("GREASE")));
const adj = (await audit()).filter((a) => a.type === "stock_adjust");
ok("stock_adjust audit rows carry the real moved qty", adj.length === 2 && adj.some((a) => a.qty === 2.5) && adj.some((a) => a.qty === -1.25), JSON.stringify(adj.map((a) => a.qty)));

// ── Add Item: duplicate code + negative minimum refused; one audit row per add ──
await p.getByRole("button", { name: "+ Add Item" }).click(); await p.waitForTimeout(400);
await p.locator("input[placeholder='e.g. Hydraulic Oil ISO 46']").fill("Another bolt");
await p.locator("input[placeholder='e.g. OIL-HYD46']").fill("bolt-m8");
await p.locator("input[placeholder='0']").first().fill("5");
await p.locator("input[placeholder^='Alert triggered']").fill("-1");
await p.getByRole("button", { name: /Save Item/ }).click(); await p.waitForTimeout(400);
ok("duplicate item code is refused with a message", await p.getByText(/BOLT-M8 is already used/).isVisible());
ok("negative minimum is refused", await p.getByText("Minimum cannot be negative").isVisible());
const countBolt = Object.values(await ls(p, "erp_items")).flat().filter((i) => i.code === "BOLT-M8").length;
ok("no second BOLT-M8 was saved", countBolt === 1);
await p.locator("input[placeholder='e.g. OIL-HYD46']").fill("NUT-M8");
await p.locator("input[placeholder^='Alert triggered']").fill("2");
await p.getByRole("button", { name: /Save Item/ }).click(); await p.waitForTimeout(700);
ok("valid new item saved", Object.values(await ls(p, "erp_items")).flat().some((i) => i.code === "NUT-M8"));
const addRows = (await audit()).filter((a) => a.ref === "NUT-M8");
ok("exactly one audit row for the new item (was two)", addRows.length === 1 && addRows[0].type === "item_created", JSON.stringify(addRows.map((a) => a.type)));

// ── Edit Item (store-audit-2): a code used by a BOM cannot be renamed; a free one can ──
const allCodes = async () => Object.values(await ls(p, "erp_items")).flat().map((i) => i.code);
await row("BOLT-M8").locator("button[title='Edit']").click(); await p.waitForTimeout(400);
await p.locator("input[placeholder='e.g. OIL-HYD46']").fill("BOLT-X");
await p.getByRole("button", { name: /Save Changes/ }).click(); await p.waitForTimeout(500);
ok("renaming a code used in a BOM is refused with the reason", await p.getByText(/Code cannot change — used in BOM M-10/).isVisible());
ok("BOLT-M8 keeps its code (BOM + shortfalls still point at it)", (await allCodes()).includes("BOLT-M8") && !(await allCodes()).includes("BOLT-X"));
await p.keyboard.press("Escape"); await p.waitForTimeout(300);
await row("NUT-M8").locator("button[title='Edit']").click(); await p.waitForTimeout(400);
await p.locator("input[placeholder='e.g. OIL-HYD46']").fill("NUT-M10");
await p.getByRole("button", { name: /Save Changes/ }).click(); await p.waitForTimeout(700);
ok("an unused item's code can still be changed", (await allCodes()).includes("NUT-M10") && !(await allCodes()).includes("NUT-M8"));

// ── Export button downloads ──
const [dl1] = await Promise.all([p.waitForEvent("download", { timeout: 5000 }).catch(() => null), p.getByRole("button", { name: "Export", exact: true }).first().click()]);
ok("Item Master Export downloads a file", !!dl1 && /item-master/.test(dl1.suggestedFilename()), dl1 ? dl1.suggestedFilename() : "no download");

// ── Inward: decimal qty + auto-fulfill audit ──
await nav("Inward");
const pickItem = async (code) => { const box = p.locator("input[placeholder='Search items by name or code…']").first(); await box.click(); await box.fill(code); await p.waitForTimeout(300); await box.press("Enter"); await p.waitForTimeout(300); };
await pickItem("WIRE-2");
await p.locator("input[placeholder='Enter quantity']").fill("2.5");
await p.getByRole("button", { name: /Submit Inward/ }).click(); await p.waitForTimeout(700);
ok("Inward keeps decimals (50 + 2.5 = 52.5 m)", (await stock("WIRE-2")) === 52.5, String(await stock("WIRE-2")));
ok("inward log records 2.5", ((await ls(p, "erp_inward")) || []).some((e) => e.code === "WIRE-2" && e.qty === 2.5));
await pickItem("GREASE");
await p.locator("input[placeholder='Enter quantity']").fill("0.5");
await p.getByRole("button", { name: /Submit Inward/ }).click(); await p.waitForTimeout(700);
const greasePend = ((await ls(p, "erp_pending")) || []).find((e) => e.code === "GREASE");
ok("0.5 Kg inward auto-fulfils the Grease shortfall (2 → 1.5)", greasePend && greasePend.pendingQty === 1.5, JSON.stringify(greasePend));
ok("auto-fulfil on inward is in the audit", (await audit()).some((a) => a.type === "pending_fulfilled" && a.itemCode === "GREASE" && a.qty === 0.5));
const [dl2] = await Promise.all([p.waitForEvent("download", { timeout: 5000 }).catch(() => null), p.getByRole("button", { name: /Export Log/ }).click()]);
ok("Inward Export Log downloads a file", !!dl2 && /inward-log/.test(dl2.suggestedFilename()));

// ── Manual outward with a decimal ──
await nav("Outward");
const manualBox = p.locator("input[placeholder='Search inventory item by name or code…']").first();
await manualBox.click(); await manualBox.fill("GREASE"); await p.waitForTimeout(300); await manualBox.press("Enter"); await p.waitForTimeout(300);
const before = await stock("GREASE");
await p.locator("input[placeholder='Enter quantity']").last().fill("0.25");
await p.getByRole("button", { name: /Issue Stock/ }).click(); await p.waitForTimeout(700);
ok("Manual Outward issues 0.25 Kg (was refused / truncated)", (await stock("GREASE")) === Math.round((before - 0.25) * 10000) / 10000, `${before} → ${await stock("GREASE")}`);

// ── Pending: Issue All Available shares stock between two machines ──
await nav("Pending Stock");
await p.getByRole("button", { name: /Issue All Available/ }).click(); await p.waitForTimeout(500);
await p.getByRole("button", { name: /Confirm & Issue/ }).click(); await p.waitForTimeout(1000);
const pend = (await ls(p, "erp_pending")) || [];
const bolt2 = pend.find((e) => e.code === "BOLT-M8" && e.issueId === 9002);
ok("Bolt stock fully issued (100 → 0)", (await stock("BOLT-M8")) === 0, String(await stock("BOLT-M8")));
ok("second machine keeps its real shortfall (90 − 80 = 10 still pending)", bolt2 && bolt2.pendingQty === 10, JSON.stringify(bolt2));
ok("first machine's 20 bolts fulfilled", !pend.some((e) => e.code === "BOLT-M8" && e.issueId === 9001));
const issuedTotal = (await audit()).filter((a) => a.type === "pending_fulfilled" && /Batch/.test(a.action)).reduce((s, a) => s + (a.qty || 0), 0);
ok("audit says exactly 100 bolts + grease issued, not more", issuedTotal <= 100 + 2, String(issuedTotal));

// ── Clear All asks first; Cancel keeps every shortfall ──
const pendBefore = ((await ls(p, "erp_pending")) || []).length;
let asked = "";
p.once("dialog", (d) => { asked = d.message(); d.dismiss(); });
await p.getByRole("button", { name: "Clear All" }).click(); await p.waitForTimeout(500);
ok("Clear All asks for confirmation", /cannot be undone/.test(asked), asked.slice(0, 60));
ok("cancelling Clear All keeps pending lines", ((await ls(p, "erp_pending")) || []).length === pendBefore && pendBefore > 0);

ok("no page errors", errs.length === 0, errs.join(" | "));
await done(b);
