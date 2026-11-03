// 2026-11-01 — department-wise staff experience on the Machine Tracker.
// Source-level assertions (same style as rackSlots.test.mjs): every non-admin
// works from the compact department dashboard, machine history and the full
// report stay admin-only, and rack release stays with Admin / Production Head.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const app  = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
const mp   = app.slice(app.indexOf("function MachinePage("), app.indexOf("function MachinePage(") + 420000);

test("staffMode is derived from isAdminUser, and admins keep the full tracker", () => {
  assert.match(mp, /const isAdminUser = currentUser\?\.role === "super_admin" \|\| currentUser\?\.role === "Admin";/);
  assert.match(mp, /const staffMode\s*=\s*!isAdminUser;/);
  // the staff dashboard renders only in staffMode; the admin blocks only outside it
  assert.match(mp, /\{staffMode && \(\(\) => \{/);
  assert.match(mp, /data-staff-dashboard/);
  assert.match(mp, /\{!staffMode && \(\(\) => \{\s*const cards = \[/, "summary-box nav is admin only");
  assert.match(mp, /\{!staffMode && mtTab === "pending" && \(\(\) => \{/, "factory Pending Jobs tab is admin only");
  assert.match(mp, /\{!staffMode && \(\s*<div className="space-y-4">\s*\{listForTab\(\)\.map\(\(machine\) => \{/, "All Machines cards are admin only");
  assert.match(mp, /\{!staffMode && \(\(\) => \{\s*const view = mtTab === "transfer"/, "screen header is admin only");
});

test("staff dashboard: department header, the four sections, and no-department message", () => {
  assert.match(mp, /Your department\$\{myDepartments\.length === 1 \? "" : "s"\}:/);
  for (const t of ["To accept", "In your department", "Pending jobs for your department", "Awaiting release from rack"]) {
    assert.ok(mp.includes(`title="${t}"`), `section ${t}`);
  }
  assert.ok(mp.includes("No department assigned yet — ask your admin"), "no-department message");
  assert.match(mp, /if \(!isProdHead && !hasDepartments\) \{/, "nothing else is shown without a department");
  // strict filter: my departments only; a rack-parked hand-over is not mine to accept
  assert.match(mp, /const toAccept\s*=\s*askableHandovers\.filter\(\(h\) => myDepartments\.includes\(h\.toDepartment\)\);/);
  assert.match(mp, /const askableHandovers\s*=\s*pendingHandovers\.filter\(\(h\) => !isAwaitingRelease\(h\)\);/);
  assert.match(mp, /const myWorking = startedAll\.filter\(\(m\) => m\.status !== "completed" && !m\.pendingHandoverId && inMyDept\(m\)\);/);
  assert.match(mp, /const myJobs\s*=\s*\(pendingHandoverItems \|\| \[\]\)\.filter\(\(p\) => pendingItemIsOpen\(p\) && myDepartments\.includes\(p\.assignedDepartment\)\);/);
});

test("staff actions reuse the existing modals and are permission-gated; buttons are touch sized", () => {
  const sd = mp.slice(mp.indexOf("{staffMode && (() => {"), mp.indexOf("data-staff-dashboard") + 20000);
  assert.match(sd, /const canAccept\s*=\s*canAcceptHandover\(canDo\) && !!onAcceptHandover;/);
  assert.match(sd, /const canFinish\s*=\s*canFinishTransfer\(canDo\) && !!onFinishTransfer;/);
  assert.match(sd, /const canReport\s*=\s*!!onRaisePendingItem && canDo\("machines", "accept"\);/);
  assert.match(sd, /data-staff-accept=\{h\.id\}[\s\S]*?openAcceptModal\(h\)/);
  assert.match(sd, /data-staff-finish=\{m\.id\}[\s\S]*?openFinishModal\(m\)/);
  assert.match(sd, /data-staff-during=\{m\.id\}[\s\S]*?openDuringWorkModal\(m\)/);
  assert.match(sd, /data-staff-issue=\{m\.id\}[\s\S]*?setRaiseModal\(\{ machine: m \}\)/);
  assert.match(sd, /data-staff-jobs=\{m\.id\} onClick=\{\(\) => setJobsDrawer\(m\.id\)\}/);
  assert.match(sd, /setJobAction\(\{ item: p, action: "receive"/);
  assert.match(sd, /setJobAction\(\{ item: p, action: "complete"/);
  assert.match(sd, /const btn = "min-h-\[48px\][^"]*text-\[15px\]/, "action buttons ≥ 44px tall, ≥ 14px label");
  // nothing admin-only leaks into the staff layout
  for (const s of ["setPullBack(", "setReportMachineId(", "handleStageUpdate(", "summarizeMachineRatings(", "deptRatings"]) {
    assert.ok(!sd.includes(s), `${s} must not be in the staff dashboard`);
  }
});

test("machine history and the full report are admin-only", () => {
  assert.match(mp, /\{isComplete && isAdminUser && \(\s*<button type="button" data-card-report=\{machine\.id\} onClick=\{\(\) => setReportMachineId\(machine\.id\)\}/);
  assert.match(mp, /\{isAdminUser && <button type="button" data-history-report=\{machine\.id\} onClick=\{\(\) => setReportMachineId\(machine\.id\)\}/);
});

test("Report Center: Machine journey tab is admin-gated", () => {
  const rc = app.slice(app.indexOf("function ReportCenterPage("), app.indexOf("function ReportCenterPage(") + 60000);
  assert.match(rc, /currentUser = null,/);
  assert.match(rc, /const isAdminUser = currentUser\?\.role === "super_admin" \|\| currentUser\?\.role === "Admin";/);
  assert.match(rc, /useState\(isAdminUser \? "machine" : "factory"\)/);
  assert.match(rc, /\]\.filter\(\(t\) => t\.id !== "machine" \|\| isAdminUser\);/);
  assert.match(rc, /\{tab === "machine" && isAdminUser && \(\(\) => \{/);
  assert.match(app, /<ReportCenterPage[\s\S]*?currentUser=\{currentUser\} \/>,/);
});

test("rack release stays gated by canDo('machines','release') || isAdminUser", () => {
  assert.match(mp, /const canReleaseFromRack = canDo\("machines", "release"\) \|\| isAdminUser;/);
  assert.match(mp, /const faceCanSend\s*=\s*!!faceHo && \(canDo\("machines", "release"\) \|\| isAdminUser\) && !!onReleaseHandover;/);
  assert.match(mp, /const canSendFromRack = canDo\("machines", "release"\) \|\| isAdminUser;/);
  assert.match(mp, /\{canReleaseFromRack && onReleaseHandover && \(\s*<button type="button" data-staff-release=\{h\.id\}/);
  // the staff card opens the rack panel; the release call itself stays in the Rack View only
  assert.match(mp, /data-staff-release=\{h\.id\}[\s\S]*?if \(m\.rackSlot\) \{ setRackPanel\(m\.rackSlot\); return; \}/);
  // the rack view in staffMode is the Production Head's only; Pull Back stays admin
  assert.match(mp, /\{\(staffMode \? isProdHead : mtTab === "production"\) && \(/);
  assert.match(mp, /\{isAdminUser && onPullBackHandover && \(/);
});

test("staff My Dashboard (2026-11-03): button in the staff layout, read-only panel scoped to my departments", () => {
  const sd = mp.slice(mp.indexOf("{staffMode && (() => {"), mp.indexOf("data-staff-dashboard") + 20000);
  assert.match(sd, /\{!isProdHead && hasDepartments && \(\s*<button type="button" data-my-dashboard-open onClick=\{\(\) => setMyDashOpen\(true\)\}/);
  assert.match(mp, /\{staffMode && !isProdHead && hasDepartments && myDashOpen && \(\s*<StaffMyDashboard departments=\{myDepartments\}/);
  const dash = app.slice(app.indexOf("function StaffMyDashboard("), app.indexOf("function MachinePage("));
  assert.ok(dash.length > 0, "StaffMyDashboard is defined");
  assert.match(dash, /mine\.has\(r\.department\)/, "stars: my departments only");
  assert.match(dash, /mine\.has\(h\.fromDepartment\)/, "finished machines: my departments only");
  assert.match(dash, /h\.status !== "cancelled"/, "a pulled-back hand-over is not a finish");
  // read-only: no handler, store call or audit write in the panel
  for (const s of ["onAcceptHandover", "onFinishTransfer", "logAudit(", "createRating(", "overrideRating(", "setDeptRatings", "localStorage"]) {
    assert.ok(!dash.includes(s), `${s} must not be in My Dashboard`);
  }
  assert.match(dash, /data-my-dashboard-close[\s\S]{0,200}min-w-\[52px\] min-h-\[52px\]/, "big close button");
});
