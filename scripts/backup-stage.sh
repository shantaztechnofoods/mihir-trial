#!/usr/bin/env bash
# SHANTAZ ERP — stage the Desktop backup after a merge to main.
#   scripts/backup-stage.sh <last-synced-commit>     (the hash inside Desktop "Backup ERP\LIVE-VERSION.txt")
# Writes the NEW versions of every changed file to  /mnt/user-data/outputs/Backup-ERP/<path>  and the OLD versions
# to /mnt/user-data/outputs/Backup-ERP-prev/<path>, writes both LIVE-VERSION.txt files, and prints two ready-to-use
# JSON arrays for device_commit_files (files / devicePath use the Desktop folders "Backup ERP" and "Backup ERP - पिछला").
# Deleted files are listed so they can be moved to _to_delete (never deleted by us). .github/workflows/* is protected.
set -euo pipefail
cd "$(dirname "$0")/.."
OLD="${1:?usage: backup-stage.sh <last-synced-commit>}"; git fetch -q origin
NEW=$(git rev-parse origin/main); OUT=/mnt/user-data/outputs; CUR="$OUT/Backup-ERP"; PRV="$OUT/Backup-ERP-prev"
rm -rf "$PRV"; mkdir -p "$CUR" "$PRV"
python3 - "$OLD" "$NEW" "$CUR" "$PRV" <<'PY'
import subprocess, sys, os, json
old, new, cur, prv = sys.argv[1:5]
run = lambda *a: subprocess.run(a, capture_output=True, check=True).stdout
lines = run("git", "diff", "--name-status", "-M", f"{old}..{new}").decode().splitlines()
cur_items, prv_items, deleted = [], [], []
DESK, DESKP = "C:\\Users\\HP\\Desktop\\Backup ERP", "C:\\Users\\HP\\Desktop\\Backup ERP - \u092a\u093f\u091b\u0932\u093e"
def put(root, path, commit):
    d = os.path.join(root, path); os.makedirs(os.path.dirname(d), exist_ok=True)
    open(d, "wb").write(run("git", "show", f"{commit}:{path}"))
for ln in lines:
    parts = ln.split("\t"); st = parts[0][0]; path = parts[-1]
    if path.startswith(".github/workflows/"): print("SKIP (protected):", path, file=sys.stderr); continue
    if st in "AMRC":
        put(cur, path, new); cur_items.append({"stagedPath": f"{cur}/{path}", "devicePath": DESK + "\\" + path.replace("/", "\\")})
    if st in "MD": put(prv, path, old); prv_items.append({"stagedPath": f"{prv}/{path}", "devicePath": DESKP + "\\" + path.replace("/", "\\")})
    if st == "R": deleted.append(parts[1])
    if st == "D": deleted.append(path)
open(f"{cur}/LIVE-VERSION.txt", "w").write(new + "\n"); open(f"{prv}/LIVE-VERSION.txt", "w").write(old + "\n")
cur_items.append({"stagedPath": f"{cur}/LIVE-VERSION.txt", "devicePath": DESK + "\\LIVE-VERSION.txt"})
prv_items.append({"stagedPath": f"{prv}/LIVE-VERSION.txt", "devicePath": DESKP + "\\LIVE-VERSION.txt"})
print(f"changed files: {len(cur_items)-1}   deleted/renamed-away: {len(deleted)}   old={old[:7]} new={new[:7]}")
if deleted: print("MOVE TO _to_delete (stale on Desktop):", *deleted, sep="\n  ")
print("\n--- PREVIOUS folder (commit these first) ---"); print(json.dumps(prv_items))
print("\n--- CURRENT folder ---"); print(json.dumps(cur_items))
PY
