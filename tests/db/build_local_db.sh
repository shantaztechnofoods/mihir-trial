#!/bin/bash
# Rebuild erp_test from the repo migrations. Usage: build.sh [last_migration_number]
set -e
LAST=${1:-058}
MIG=/home/claude/purchase_inventory_os/supabase/migrations
su postgres -c "psql -q -c 'DROP DATABASE IF EXISTS erp_test' -c 'CREATE DATABASE erp_test'" >/dev/null
su postgres -c "psql -q -v ON_ERROR_STOP=1 -d erp_test -f /tmp/erpdb/stubs.sql" >/dev/null
for f in $(ls $MIG/*.sql | grep -v rollback | sort); do
  n=$(basename $f | cut -c1-3)
  [ "$n" \> "$LAST" ] && break
  src=$f; if [ "$n" = "036" ]; then sed "s/^RELEASE FROM THE RACK/-- RELEASE FROM THE RACK/" $f > /tmp/erpdb/036_fixed.sql; src=/tmp/erpdb/036_fixed.sql; fi
  if ! out=$(su postgres -c "psql -q -v ON_ERROR_STOP=1 -d erp_test -f $src" 2>&1); then echo "FAILED: $(basename $f)"; echo "$out" | tail -5; exit 1; fi
done
echo "built through $LAST"
