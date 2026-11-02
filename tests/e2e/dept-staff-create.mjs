// Local-mode UI test (no Supabase): Add New User = Department Staff form.
//   VITE_USE_SUPABASE=false npx vite build --outDir /tmp/dist-e2e && npx vite preview --outDir /tmp/dist-e2e --port 5183 --strictPort &
//   node tests/e2e/dept-staff-create.mjs        LOCAL TEST DATA ONLY
import pw from "/usr/local/lib/node_modules_global/playwright/index.js";
const BASE = process.env.E2E_BASE || "http://localhost:5183/";
const b = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const res = []; const ok = (n, c, note = "") => { res.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${n}${note ? " — " + note : ""}`); };
const seed = () => { localStorage.clear(); localStorage.setItem("erp_users", JSON.stringify([
  { id: "super_admin_001", username: "admin", password: btoa("admin123"), fullName: "Super Admin", role: "super_admin", status: "active" }])); };
const login = async (p, u, pass) => { await p.locator("#login-username").fill(u); await p.locator("#login-password").click(); await p.locator("#login-password").fill(pass);
  await p.getByRole("button", { name: "Sign In" }).click(); await p.waitForTimeout(1500); };
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
await p.goto(BASE, { waitUntil: "networkidle" }); await p.evaluate(seed); await p.reload({ waitUntil: "networkidle" });
await login(p, "admin", "admin123");
await p.locator("button, a").filter({ hasText: /User Management|Users/ }).first().click(); await p.waitForTimeout(800);
await p.getByRole("button", { name: /Add (New )?User|\+ Add/ }).first().click(); await p.waitForTimeout(400);
const m = p.locator("form");
ok("Department Staff form is the default", await m.getByRole("tab", { name: "Department Staff" }).getAttribute("aria-selected") === "true");
ok("no Role dropdown in the Department Staff form", (await m.locator("select").count()) === 0);
ok("no mobile / status fields", (await m.getByText(/Mobile Number|Status/).count()) === 0);
ok("exactly four departments offered", (await m.locator('[role=radio]').allInnerTexts()).join(",") === "Assembly,Mechanical,Electrical,Trial");
await m.locator("input").first().fill("nodept"); await m.locator('input[type=password]').fill("pw123456");
await m.getByRole("button", { name: "Create User" }).click(); await p.waitForTimeout(400);
ok("department is required", (await p.getByText("Pick a department").count()) === 1);
await m.getByRole("tab", { name: "Other role" }).click();
ok("Other role tab keeps the Role dropdown", (await m.locator("select").count()) >= 1);
await m.getByRole("tab", { name: "Department Staff" }).click();
await p.keyboard.press("Escape");
await p.mouse.click(5, 5); await p.waitForTimeout(300);
for (const d of ["Assembly", "Mechanical", "Electrical", "Trial"]) {
  const u = "stf_" + d.toLowerCase();
  await p.getByRole("button", { name: /Add (New )?User|\+ Add/ }).first().click(); await p.waitForTimeout(300);
  const f = p.locator("form");
  await f.locator("input").first().fill(u); await f.locator('input[type=password]').fill("pw-" + d);
  await f.locator('[role=radio]', { hasText: new RegExp("^" + d + "$") }).click();
  await f.getByRole("button", { name: "Create User" }).click(); await p.waitForTimeout(500);
}
const users = await p.evaluate(() => JSON.parse(localStorage.getItem("erp_users")));
for (const d of ["Assembly", "Mechanical", "Electrical", "Trial"]) {
  const u = users.find((x) => x.username === "stf_" + d.toLowerCase());
  ok(`${d}: saved as dept_staff, active, department ${d}`, u && u.role === "dept_staff" && u.status === "active" && u.departments.length === 1 && u.departments[0] === d);
}
// log out, log in as each, reload, department/role persist
for (const d of ["Assembly", "Trial"]) {
  const pg = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  await pg.goto(BASE, { waitUntil: "networkidle" });
  await pg.evaluate((us) => { localStorage.clear(); localStorage.setItem("erp_users", JSON.stringify(us)); }, users);
  await pg.reload({ waitUntil: "networkidle" });
  await login(pg, "stf_" + d.toLowerCase(), "pw-" + d);
  ok(`${d} staff logs in immediately`, (await pg.locator("#login-username").count()) === 0);
  await pg.reload({ waitUntil: "networkidle" }); await pg.waitForTimeout(800);
  const still = (await pg.locator("#login-username").count()) === 0;
  const cu = await pg.evaluate(() => JSON.parse(localStorage.getItem("erp_users"))).then((us) => us.find((x) => x.username.endsWith(d.toLowerCase())));
  ok(`${d} staff still signed in after refresh, same role + department`, still && cu.role === "dept_staff" && cu.departments[0] === d);
  ok(`${d} staff has no admin pages`, (await pg.getByText(/^User Management$|^Role Management$/).count()) === 0);
}
await b.close();
const bad = res.filter((x) => !x).length; console.log(`\n${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0);
