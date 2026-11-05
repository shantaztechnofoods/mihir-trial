#!/usr/bin/env python3
"""Pick browser suites (tests/e2e/*.mjs).

  e2e-pick.py --shard K N          suites for CI shard K of N (CI uses N=8; longest-first into the lightest
                                   bin, by the CI-measured seconds in tests/e2e/timings.txt)
  e2e-pick.py --changed <base>     suites related to files changed since <base> (incl. uncommitted);
                                   reasons go to stderr. The FULL suite always runs in CI.

Changed-file -> suite map: a changed suite runs itself; hunks in the screen code (src/app,
src/modules, src/shared — the former src/App.jsx, split 2026-11-04) are mapped by the top-level
component they sit in; other src files by path. Anything unknown -> SMOKE.
"""
import os
import re
import subprocess
import sys

ROOT = os.environ.get("E2E_PICK_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
E2E = os.path.join(ROOT, "tests", "e2e")
SMOKE = ["go-live-workflows", "mobile-sweep"]          # whole-app walk-through, phone + desktop
MT = ["go-live-workflows", "pending-part-or-comment", "sender-undo", "staff-hold", "mt-polish", "back-closes-popup"]

# (regex on the App.jsx component name OR on a file path, suites). First match wins.
COMPONENT_MAP = [
    (r"^(InventoryPage|InwardPage|AddItemModal|ItemImportModal|EditItemModal|QuickStock\w*|Item\w*|ClearDemoDataModal)$", ["store-audit", "perf-budget", "no-delete"]),
    (r"^(OutwardPage|BOM\w*|Bom\w*|RackFill\w*)$", ["bom-unselected", "fill-rack-pending-item", "store-audit", "no-delete"]),
    (r"^(PendingPage|Pending\w*)$", ["bom-unselected", "part-received-completes", "store-audit"]),
    (r"^(HistoryPage|HR\w*|ReportCenterPage|Report\w*|fmtTs|inDateRange)$", ["reports-v2", "reports-pdf", "perf-budget"]),
    (r"^(VendorsPage|Vendor\w*|OrderPipelinePage|POSearchCenter|PurchasePage|PO\w*|ApprovalsPage|AnalyticsPage)$", ["perf-budget", "store-audit", "no-delete"]),
    (r"^(DashboardPage|MyDashboard\w*)$", ["dashboard-line", "my-dashboard", "go-live-workflows"]),
    (r"^(SettingsPage|Settings\w*|Checklist\w*)$", ["settings-bom-organised", "compact-checklist", "dept-staff-create"]),
    (r"^(Machine\w*|MT\w*|Mt\w*|Rack\w*|Trial\w*|Handover\w*|Accept\w*|Finish\w*|Hold\w*|Ready\w*|Delay\w*)$", MT + ["ready-popup", "delay-reasons", "trial-signature-report"]),
    (r"^(Voice\w*|Mic\w*)$", ["voice-note", "voice-transcribe"]),
    (r"^(LoginPage|Login\w*|readBootShell|adoptBootAnimations|probeHero|heroMode)$", ["login-speed"]),
]
PATH_MAP = [
    (r"^(src/main\.jsx|src/app/(LoginPage|loginBoot|loadApp)|src/shared/components/(LoginBrand3D|shantazLogo)|src/auth/AuthContext|scripts/vite-login-boot|index\.html|vite\.config)", ["login-speed"] + SMOKE),
    (r"^tests/e2e/lib/", SMOKE),
    (r"^src/realtime/|liveSync", ["live-sync"]),
    (r"online|offline", ["offline"]),
    (r"voice", ["voice-note", "voice-transcribe"]),
    (r"^src/modules/users-roles/|^src/auth/|^src/stores/admin", ["dept-staff-create"]),
    (r"^src/modules/audit-trail/|^src/auth/audit", ["perf-budget"]),
    (r"^src/utils/(handover|rackSlots|pendingJobs|workCalendar|checklist|bomCost)", MT + ["bom-unselected", "assembly-start-checklist"]),
    (r"^src/utils/(poTemplate|gst|parseDate|itemImport|storeQty|store)", ["store-audit", "reports-v2"]),
    (r"^src/stores/", ["store-audit", "go-live-workflows"]),
    # module folders (fallback when a changed declaration matches no COMPONENT_MAP rule)
    (r"^src/modules/(machine-tracker|trial-certificate|pending-jobs)/", MT + ["ready-popup", "delay-reasons", "trial-signature-report"]),
    (r"^src/modules/bom/", ["bom-unselected", "fill-rack-pending-item", "bom-photo", "settings-bom-organised"]),
    (r"^src/modules/inventory/", ["store-audit", "bom-unselected", "perf-budget"]),
    (r"^src/modules/reports/", ["reports-v2", "reports-pdf", "perf-budget"]),
    (r"^src/modules/(purchase|analytics)/", ["perf-budget", "store-audit"]),
    (r"^src/modules/settings/", ["settings-bom-organised", "compact-checklist", "dept-staff-create"]),
    (r"^src/modules/dashboard/", ["dashboard-line", "my-dashboard", "go-live-workflows"]),
    (r"^src/shared/components/(LazyCharts|useProgressiveCount|MoreRowsNote|DebouncedSearchInput)", ["perf-budget"]),
    (r"^(src/|index\.html|vite\.config|package(-lock)?\.json|public/)", SMOKE),   # shared shell, styles, deps
]
NO_E2E = re.compile(r"^(docs/|supabase/|scripts/|\.github/|tests/[^e]|tests/e[^2]|.*\.md$|\.gitignore$|\.nvmrc$)")


def all_suites():
    return sorted(f[:-4] for f in os.listdir(E2E) if f.endswith(".mjs"))


def timings():
    t = {}
    try:
        for line in open(os.path.join(E2E, "timings.txt")):
            parts = line.split()
            if len(parts) == 2 and not line.startswith("#"):
                t[parts[0]] = float(parts[1])
    except OSError:
        pass
    return t


def shard(k, n):
    t = timings()
    suites = sorted(all_suites(), key=lambda s: -t.get(s, 30.0))   # unknown suites count as 30 s
    bins = [[0.0, []] for _ in range(n)]
    for s in suites:                                                # longest first into the lightest bin
        b = min(bins, key=lambda x: x[0])
        b[0] += t.get(s, 30.0)
        b[1].append(s)
    return bins[k - 1][1]


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True).stdout


SCREEN = re.compile(r"^src/(App\.jsx$|(app|modules|shared)/.*\.jsx?$)")


def app_components(base, path="src/App.jsx"):
    """Top-level declarations of a screen-code file whose lines changed (in the new file)."""
    full = os.path.join(ROOT, path)
    if not os.path.exists(full):
        return {"(deleted file)"}
    if path in git("ls-files", "-o", "--exclude-standard").split():   # new, untracked: every line
        lines = list(range(1, open(full, encoding="utf-8").read().count("\n") + 2))
    else:
        diff = git("diff", "-U0", base, "--", path)
        lines = []
        for m in re.finditer(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", diff, re.M):
            start, count = int(m.group(1)), int(m.group(2) or 1)
            lines += list(range(start, start + max(count, 1)))
    if not lines:
        return set()
    src = open(full, encoding="utf-8").read().split("\n")
    decl = re.compile(r"^(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*=)")
    owner, names, cur = {}, set(), "(top)"
    want = set(lines)
    for i, line in enumerate(src, 1):
        m = decl.match(line)
        if m:
            cur = m.group(1) or m.group(2)
        if i in want:
            # build-tag lines are bumped on every PR: they test nothing
            if re.match(r"^const APP_BUILD = ", line):
                continue
            names.add(cur)
    return names


def changed(base):
    files = set(git("diff", "--name-only", base).split()) | set(git("ls-files", "-o", "--exclude-standard").split())
    picked, why = [], []

    def add(suites, reason):
        new = [s for s in suites if s not in picked and os.path.exists(os.path.join(E2E, s + ".mjs"))]
        picked.extend(new)
        why.append(f"{reason} -> {', '.join(suites) or 'nothing'}")

    for f in sorted(files):
        m = re.match(r"^tests/e2e/([^/]+)\.mjs$", f)
        if m:
            add([m.group(1)], f)
            continue
        if f == "tests/e2e/timings.txt" or NO_E2E.match(f):
            why.append(f"{f} -> no browser suite (unit tests / CI cover it)")
            continue
        if SCREEN.match(f):
            for name in sorted(app_components(base, f)):
                for rx, suites in COMPONENT_MAP:
                    if re.match(rx, name):
                        add(suites, f"{f}:{name}")
                        break
                else:
                    # no component rule: fall back to the module folder, then to the smoke walk-through
                    for rx, suites in PATH_MAP:
                        if re.search(rx, f) and suites is not SMOKE:
                            add(suites, f"{f}:{name}")
                            break
                    else:
                        add(SMOKE, f"{f}:{name} (no specific suite)")
            continue
        if f == "src/main.jsx" and set(re.findall(r"^[+-](?![+-]).*$", git("diff", "-U0", base, "--", f), re.M)) <= {
            l for l in re.findall(r"^[+-](?![+-]).*$", git("diff", "-U0", base, "--", f), re.M) if "APP_BUILD_TAG" in l}:
            why.append(f"{f} -> build tag only, no suite")
            continue
        for rx, suites in PATH_MAP:
            if re.search(rx, f):
                add(suites, f)
                break
        else:
            add(SMOKE, f"{f} (no specific suite)")
    return picked, why


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "--shard":
        if not 1 <= int(sys.argv[2]) <= int(sys.argv[3]):
            sys.exit(f"shard {sys.argv[2]} is outside 1..{sys.argv[3]}")
        print("\n".join(shard(int(sys.argv[2]), int(sys.argv[3]))))
    elif len(sys.argv) == 3 and sys.argv[1] == "--changed":
        picked, why = changed(sys.argv[2])
        for w in why:
            print("  " + w, file=sys.stderr)
        print("\n".join(picked))
    else:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
