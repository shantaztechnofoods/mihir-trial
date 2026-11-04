#!/bin/bash
# Migration 063 — real concurrency check: two sessions append to the same
# machine at the same moment (Hold + stage change). Session A holds the row
# lock for 2 s; session B starts meanwhile, waits, then appends. Both entries
# must be present afterwards. Run after: bash tests/db/build_local_db.sh 063
# (and after 063_history_append_tests.sql, or on a fresh build — it seeds its own rows).
set -u
DB=${DB:-erp_test}
P() { su postgres -c "psql -q -X -At -d $DB -c \"$1\""; }
A=d0000000-0000-0000-0000-000000000001
B=d0000000-0000-0000-0000-000000000002
P "INSERT INTO auth.users (id, email) VALUES ('$A','ca@t'),('$B','cb@t') ON CONFLICT DO NOTHING" >/dev/null
P "UPDATE public.users SET role_key='Admin', status='active' WHERE id IN ('$A','$B')" >/dev/null
P "DELETE FROM public.machine_log WHERE id=501" >/dev/null 2>&1
P "INSERT INTO public.machine_log (id,bom_key,serial_no,stage,status,history,current_department) VALUES (501,'M-C','SN-501','Assembly','active','[]','Assembly')" >/dev/null

session() { # uid, sleep-after, entries, updates, expected
  cat <<SQL | su postgres -c "psql -q -X -At -d $DB" 2>&1
BEGIN;
SELECT set_config('request.jwt.claim.sub', '$1', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
SELECT public.machine_append_history(501, '$3'::jsonb, '$4'::jsonb, $5) ->> 'ok';
SELECT pg_sleep($2);
COMMIT;
SQL
}
session $A 2 '[{"stage":"Assembly","note":"Put ON HOLD (A)"}]' '{"hold_active":true,"hold_reason":"waiting"}' NULL > /tmp/063_a.out &
PA=$!
sleep 0.5
session $B 0 '[{"stage":"Mechanical","note":"Stage change (B)"}]' '{"stage":"Mechanical","current_department":"Mechanical"}' "'Assembly'" > /tmp/063_b.out &
PB=$!
wait $PA $PB
H=$(P "SELECT history::text FROM public.machine_log WHERE id=501")
S=$(P "SELECT stage || '/' || hold_active FROM public.machine_log WHERE id=501")
ok=0; fail=0
chk() { if [ "$2" = "1" ]; then echo "PASS  $1"; ok=$((ok+1)); else echo "FAIL  $1"; fail=$((fail+1)); fi; }
chk "session A returned ok" "$(grep -c '^true$' /tmp/063_a.out)"
chk "session B returned ok" "$(grep -c '^true$' /tmp/063_b.out)"
chk "hold entry present"   "$(echo "$H" | grep -c 'Put ON HOLD (A)')"
chk "stage entry present"  "$(echo "$H" | grep -c 'Stage change (B)')"
chk "both changes applied (Mechanical/true)" "$([ "$S" = "Mechanical/true" ] && echo 1 || echo 0)"
# Second race: two stage changes from the same old stage — only one may win.
P "UPDATE public.machine_log SET hold_active=false, hold_reason=null WHERE id=501" >/dev/null
session $A 2 '[{"note":"A to Electrical"}]' '{"stage":"Electrical","current_department":"Electrical"}' "'Mechanical'" > /tmp/063_c.out &
PA=$!; sleep 0.5
cat <<SQL | su postgres -c "psql -q -X -At -d $DB" > /tmp/063_d.out 2>&1 &
BEGIN;
SELECT set_config('request.jwt.claim.sub', '$B', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
SELECT public.machine_append_history(501, '[{"note":"B to Trial"}]'::jsonb, '{"stage":"Trial","current_department":"Trial"}'::jsonb, 'Mechanical') ->> 'stale';
COMMIT;
SQL
PB=$!
wait $PA $PB
S2=$(P "SELECT stage FROM public.machine_log WHERE id=501")
H2=$(P "SELECT history::text FROM public.machine_log WHERE id=501")
chk "first stage change won (Electrical)" "$([ "$S2" = "Electrical" ] && echo 1 || echo 0)"
chk "second stage change reported stale" "$(grep -c '^true$' /tmp/063_d.out)"
chk "stale change left no history entry" "$(echo "$H2" | grep -c 'B to Trial' | sed 's/^0$/1/;t;s/.*/0/')"
rm -f /tmp/063_[abcd].out
echo "$ok PASSED"; echo "$fail FAILED"
